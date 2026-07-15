-- Wafi POS — Installment / layaway plans (التقسيط).
--
-- Structured payment plans (down payment + fixed term + schedule), distinct
-- from the informal on-account credit ledger (Epic 4). See
-- docs/superpowers/specs/2026-07-14-installment-plans-design.md.
--
-- Design notes:
--   - installment_plans.total_amount_usd/down_payment_usd and
--     installment_dues.amount_due_usd/amount_paid_usd are USD-internal,
--     matching every other ledger table in this schema.
--   - installment_dues.status only distinguishes 'pending' | 'paid' | 'voided'
--     at the DB level. The spec's upcoming/due/overdue buckets are DERIVED at
--     read time from due_date vs "today" (src/features/installments/
--     installment.types.ts dueBucket()) rather than stored — there is no
--     background scheduler in this offline-first architecture to keep a
--     stored bucket from going stale, matching how zombie-shift detection
--     already works read-time-only in this codebase.
--   - The down payment and every later due collection post through the
--     EXISTING customer_payments table (Epic 4), reusing its balance/statement
--     queries and its existing Z-report cash-drawer attribution
--     (useZReport.ts already sums customer_payments WHERE method='cash' by
--     time window — no shift/reconciliation code changes needed). The new
--     nullable due_id column tags a payment against a specific scheduled due;
--     sale_id is always populated too (the plan's originating sale), so no
--     existing customer_payments query needs to change.
--   - No append-only trigger on these two new tables (unlike audit_log):
--     status/amount_paid_usd are meant to be updated as dues get paid/voided.

CREATE TABLE IF NOT EXISTS public.installment_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL,
  customer_id       uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sale_id           uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  total_amount_usd  numeric(12,2) NOT NULL CHECK (total_amount_usd > 0),
  down_payment_usd  numeric(12,2) NOT NULL CHECK (down_payment_usd >= 0),
  term_count        integer NOT NULL CHECK (term_count > 0),
  term_frequency    text NOT NULL CHECK (term_frequency IN ('weekly', 'monthly')),
  start_date        date NOT NULL,
  status            text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'completed', 'defaulted', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  sync_status       text
);

CREATE INDEX IF NOT EXISTS idx_installment_plans_shop_customer
  ON public.installment_plans (shop_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.installment_dues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  shop_id         uuid NOT NULL,
  due_date        date NOT NULL,
  amount_due_usd  numeric(12,2) NOT NULL CHECK (amount_due_usd > 0),
  amount_paid_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid_usd >= 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'voided')),
  sync_status     text
);

CREATE INDEX IF NOT EXISTS idx_installment_dues_plan
  ON public.installment_dues (plan_id, due_date ASC);
CREATE INDEX IF NOT EXISTS idx_installment_dues_shop_status_date
  ON public.installment_dues (shop_id, status, due_date ASC);

-- Tag a customer_payments row against a specific scheduled due (nullable — the
-- down payment recorded at plan creation has no due_id; only subsequent
-- per-due collections set it).
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS due_id uuid REFERENCES public.installment_dues(id) ON DELETE SET NULL;

-- Widen sales.payment_method to allow 'installment' (mirrors migration 011,
-- which widened the same CHECK for 'credit'/'split').
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_payment_method_check2'
  ) THEN
    ALTER TABLE public.sales DROP CONSTRAINT sales_payment_method_check2;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_payment_method_check3'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_payment_method_check3
      CHECK (payment_method IN ('cash_usd', 'cash_syp', 'card', 'credit', 'split', 'installment'));
  END IF;
END $$;

-- RLS — mirrors migration 015's auth_shop_id() scoping. installment_plans and
-- installment_dues both need UPDATE (status/amount_paid_usd change over the
-- plan's life), unlike append-only tables such as audit_log/cash_movements.
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_dues  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installment_plans_select_all ON public.installment_plans;
DROP POLICY IF EXISTS installment_plans_insert_all ON public.installment_plans;
DROP POLICY IF EXISTS installment_plans_update_all ON public.installment_plans;
CREATE POLICY installment_plans_select_all ON public.installment_plans
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY installment_plans_insert_all ON public.installment_plans
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY installment_plans_update_all ON public.installment_plans
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

DROP POLICY IF EXISTS installment_dues_select_all ON public.installment_dues;
DROP POLICY IF EXISTS installment_dues_insert_all ON public.installment_dues;
DROP POLICY IF EXISTS installment_dues_update_all ON public.installment_dues;
CREATE POLICY installment_dues_select_all ON public.installment_dues
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY installment_dues_insert_all ON public.installment_dues
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY installment_dues_update_all ON public.installment_dues
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

-- PowerSync publication (mirrors migration 027's pattern).
DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['installment_plans', 'installment_dues']
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
