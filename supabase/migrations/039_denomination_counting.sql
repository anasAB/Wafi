-- Wafi POS — WAFI-103: denomination-based cash counting at shift open/close.
--
-- Breakdown is stored as JSON text ({"500":2,"1000":1,...}); null means the
-- cashier used the "enter total directly" fallback for that side. The totals
-- (opening_cash_usd/syp, closing_cash_usd/syp) remain the source of truth for
-- all existing variance math — the breakdown is evidence alongside it, never
-- a second total.

ALTER TABLE public.cashier_shifts
  ADD COLUMN IF NOT EXISTS opening_breakdown text,
  ADD COLUMN IF NOT EXISTS closing_breakdown text;

-- Owner-configurable denomination list per currency (Settings). Mirrors the
-- return_reasons list pattern: simple per-shop rows, soft-deletable.
CREATE TABLE IF NOT EXISTS public.denomination_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  currency    text NOT NULL CHECK (currency IN ('USD', 'SYP')),
  value       numeric(14,2) NOT NULL CHECK (value > 0),
  sort_order  integer NOT NULL DEFAULT 0,
  deleted     integer NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sync_status text
);

CREATE INDEX IF NOT EXISTS idx_denomination_configs_shop_currency
  ON public.denomination_configs (shop_id, currency, deleted);

ALTER TABLE public.denomination_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS denomination_configs_select_all ON public.denomination_configs;
DROP POLICY IF EXISTS denomination_configs_insert_all ON public.denomination_configs;
DROP POLICY IF EXISTS denomination_configs_update_all ON public.denomination_configs;
CREATE POLICY denomination_configs_select_all ON public.denomination_configs
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY denomination_configs_insert_all ON public.denomination_configs
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY denomination_configs_update_all ON public.denomination_configs
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

GRANT ALL ON TABLE public.denomination_configs TO anon, authenticated, service_role;

DO $$
DECLARE
  pub_name text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = pub_name AND schemaname = 'public' AND tablename = 'denomination_configs'
      ) THEN
        EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.denomination_configs', pub_name);
      END IF;
    END IF;
  END LOOP;
END $$;
