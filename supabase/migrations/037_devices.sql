-- Wafi POS — WAFI-055 (Real Auth epic, Decision 3): per-device registration.
--
-- Codes are server-allocated permanent letters (A, B, C, ...) per shop, so two
-- devices on the same shop never collide on a sale-number sequence. A device
-- that registers offline gets a unique temporary code (T-<random>) and
-- reconciles to a permanent one on next sync (useDeviceRegistration.ts, Task 8).

CREATE TABLE IF NOT EXISTS public.devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL,
  code          text NOT NULL,
  is_temporary  boolean NOT NULL DEFAULT false,
  registered_at timestamptz NOT NULL DEFAULT now(),
  sync_status   text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_shop_code
  ON public.devices (shop_id, code);

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
