-- Wafi POS — Guided stock-take / inventory reconciliation (الجرد).
--
-- A stock-take session snapshots expected_stock per product at session start,
-- then a counter enters counted_stock per line. On confirm, each non-zero
-- variance line writes a real stock_adjustments row (reason='stocktake') via
-- the EXISTING adjustStock() write path in useProducts.ts — no parallel
-- stock-mutation SQL. See docs/superpowers/specs/2026-07-14-guided-stock-take-design.md.

CREATE TABLE IF NOT EXISTS public.stock_take_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  status         text NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  created_by     text NOT NULL,
  scope          text,
  sync_status    text
);

CREATE INDEX IF NOT EXISTS idx_stock_take_sessions_shop_status
  ON public.stock_take_sessions (shop_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_take_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES public.stock_take_sessions(id) ON DELETE CASCADE,
  shop_id            uuid NOT NULL,
  product_id         uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  expected_stock     integer NOT NULL,
  counted_stock      integer,
  variance           integer,
  variance_value_usd numeric(12,2),
  sync_status        text
);

CREATE INDEX IF NOT EXISTS idx_stock_take_lines_session
  ON public.stock_take_lines (session_id);

ALTER TABLE public.stock_take_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_take_lines    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_take_sessions_select_all ON public.stock_take_sessions;
DROP POLICY IF EXISTS stock_take_sessions_insert_all ON public.stock_take_sessions;
DROP POLICY IF EXISTS stock_take_sessions_update_all ON public.stock_take_sessions;
CREATE POLICY stock_take_sessions_select_all ON public.stock_take_sessions
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_sessions_insert_all ON public.stock_take_sessions
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_sessions_update_all ON public.stock_take_sessions
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

DROP POLICY IF EXISTS stock_take_lines_select_all ON public.stock_take_lines;
DROP POLICY IF EXISTS stock_take_lines_insert_all ON public.stock_take_lines;
DROP POLICY IF EXISTS stock_take_lines_update_all ON public.stock_take_lines;
CREATE POLICY stock_take_lines_select_all ON public.stock_take_lines
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_lines_insert_all ON public.stock_take_lines
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY stock_take_lines_update_all ON public.stock_take_lines
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['stock_take_sessions', 'stock_take_lines']
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = pub_name AND schemaname = 'public' AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', pub_name, tbl);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
