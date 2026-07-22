-- Wafi POS — WAFI-055 (Real Auth epic, Decision 3): per-device registration.
--
-- Codes are server-allocated permanent letters (A, B, C, ...) per shop, so two
-- devices on the same shop never collide on a sale-number sequence. A device
-- that registers offline gets a unique temporary code (T-<random>) and
-- reconciles to a permanent one on next sync (useDeviceRegistration.ts, Task 8).

-- public.devices already exists (001_initial_schema.sql: id, shop_id,
-- device_code, registered_at, uq_device_code_per_shop unique(shop_id, device_code)).
-- useDeviceRegistration.ts (and this migration's own policies/index below)
-- were written against a `code` column, not `device_code` — rename to match
-- what the application actually reads/writes, then add the new columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'device_code'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'code'
  ) THEN
    ALTER TABLE public.devices RENAME COLUMN device_code TO code;
  END IF;
END $$;

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS sync_status text;

-- uq_device_code_per_shop (001_initial_schema.sql) already enforces
-- uniqueness on (shop_id, code) post-rename; no separate index needed.

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devices_select_all ON public.devices;
DROP POLICY IF EXISTS devices_insert_all ON public.devices;
DROP POLICY IF EXISTS devices_update_all ON public.devices;
CREATE POLICY devices_select_all ON public.devices
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY devices_insert_all ON public.devices
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY devices_update_all ON public.devices
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

-- Allocates the next free permanent letter code (A, B, C, ..., Z, AA, AB, ...)
-- for a shop. Called by useDeviceRegistration.ts when a device is online.
CREATE OR REPLACE FUNCTION public.allocate_device_code(p_shop_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_code  text;
  v_n     integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.devices
    WHERE shop_id = p_shop_id AND is_temporary = false;
  v_n := v_count;
  v_code := '';
  LOOP
    v_code := chr(65 + (v_n % 26)) || v_code;
    v_n := v_n / 26 - 1;
    EXIT WHEN v_n < 0;
  END LOOP;
  RETURN v_code;
END;
$$;

DO $$
DECLARE
  pub_name text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = pub_name AND schemaname = 'public' AND tablename = 'devices'
      ) THEN
        EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.devices', pub_name);
      END IF;
    END IF;
  END LOOP;
END $$;
