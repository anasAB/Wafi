-- Wafi POS — In-shift cash management (Use Case A). An append-only ledger of cash
-- entering/leaving the drawer mid-shift (pay-in / pay-out / drop to safe), so
-- legitimate movements stop surfacing as a false shift shortage.
--
-- Self-contained: creates the table, its per-shop RLS (matching migration 015's
-- auth_shop_id() scoping), and adds it to the PowerSync publication. Do NOT edit
-- migration 015 — on a fresh DB it runs before this table exists and skips it.
--
-- Ledger discipline: SELECT + INSERT policies only (no UPDATE/DELETE). A mistake is
-- corrected by a reversing row (voids_movement_id), never by editing/deleting —
-- mirroring the append-only audit log (018) and immutable Z-report (025/060).

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id                 uuid PRIMARY KEY,
  shop_id            uuid NOT NULL,
  device_id          text NOT NULL,
  shift_id           uuid NOT NULL,
  staff_id           uuid REFERENCES public.staff(id),
  direction          text NOT NULL CHECK (direction IN ('in', 'out')),
  category           text NOT NULL,
  currency           text NOT NULL CHECK (currency IN ('USD', 'SYP')),
  -- SYP amounts are integer (WAFI-035); USD keeps cents. NUMERIC stores both; the
  -- integer-SYP rule is enforced at input + in the composable, not by the column.
  amount             numeric NOT NULL CHECK (amount > 0),
  note               text,
  voids_movement_id  uuid REFERENCES public.cash_movements(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Movements are summed/listed per shift, so index by shift_id.
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON public.cash_movements (shift_id);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

-- Per-shop scoping via the same helper migration 015 uses, wrapped in a scalar
-- subquery so the STABLE function runs once per statement (Supabase RLS perf
-- pattern). SELECT + INSERT only → the ledger is append-only (no UPDATE/DELETE
-- policy is ever created, mirroring audit_log in migration 015/018).
DROP POLICY IF EXISTS cash_movements_select_all ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_insert_all ON public.cash_movements;
CREATE POLICY cash_movements_select_all ON public.cash_movements
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY cash_movements_insert_all ON public.cash_movements
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));

-- Add to the PowerSync publication using the same defensive pattern as migration
-- 010: handle both publication names, only add when the publication exists and the
-- table is not already a member (idempotent / re-runnable).
DO $$
DECLARE
  pub_name text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name)
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = pub_name AND schemaname = 'public' AND tablename = 'cash_movements'
       ) THEN
      EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.cash_movements', pub_name);
    END IF;
  END LOOP;
END $$;
