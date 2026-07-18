-- WAFI-138: Staff Ledger & Settlement (دفع الموظف).
--
-- staff_ledger is an append-only financial ledger: advances, bonuses,
-- penalties, write-offs, corrections, and system-generated carry-forwards.
-- amount_usd is always positive; entry_type alone determines direction
-- (advance/penalty/carry_forward reduce a settlement, bonus increases it,
-- write_off removes an outstanding debt). This avoids the "double negative"
-- bug class where both the sign AND the type encode direction.
--
-- staff_settlements is the immutable month-end snapshot: finalize() is the
-- only writer of staff_ledger.settlement_id, and a finalized settlement is
-- never mutated by later ledger entries (see design spec Invariants).
--
-- See docs/superpowers/specs/2026-07-19-wafi-138-staff-ledger-settlement-design.md

CREATE TYPE public.staff_ledger_entry_type AS ENUM
  ('advance', 'bonus', 'penalty', 'carry_forward', 'write_off', 'correction');

CREATE TYPE public.staff_ledger_source_type AS ENUM ('manual', 'shift', 'settlement');

CREATE TYPE public.staff_settlement_status AS ENUM ('draft', 'finalized', 'paid');

CREATE TYPE public.staff_settlement_payment_method AS ENUM ('cash', 'bank', 'other');

CREATE TABLE IF NOT EXISTS public.staff_settlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL,
  staff_id              uuid NOT NULL REFERENCES public.staff(id),
  settlement_number     text NOT NULL,
  period_month          date NOT NULL,
  status                public.staff_settlement_status NOT NULL DEFAULT 'draft',
  base_salary_usd       numeric(12,2),
  settlement_currency   text CHECK (settlement_currency IN ('usd', 'syp')),
  locked_rate           numeric(12,4),
  applied_amount_usd    numeric(12,2),
  final_amount_usd      numeric(12,2),
  notes                 text,
  staff_name_snapshot   text,
  staff_role_snapshot   text,
  finalized_at          timestamptz,
  paid_at               timestamptz,
  paid_by_staff_id      uuid REFERENCES public.staff(id),
  payment_method        public.staff_settlement_payment_method,
  client_operation_id   uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  sync_status           text,

  CONSTRAINT staff_settlements_client_operation_id_key UNIQUE (client_operation_id),
  CONSTRAINT staff_settlements_rate_currency_check
    CHECK ((locked_rate IS NULL) = (settlement_currency IS NULL OR settlement_currency = 'usd'))
);

-- No blanket UNIQUE on (shop_id, staff_id, period_month) here: a Draft may
-- exist freely per staff+month. Only Finalized/Paid rows are constrained.
CREATE UNIQUE INDEX IF NOT EXISTS staff_settlements_one_finalized_per_period
  ON public.staff_settlements (shop_id, staff_id, period_month)
  WHERE status IN ('finalized', 'paid');

CREATE INDEX IF NOT EXISTS idx_staff_settlements_shop_staff
  ON public.staff_settlements (shop_id, staff_id, period_month DESC);

CREATE TABLE IF NOT EXISTS public.staff_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL,
  staff_id              uuid NOT NULL REFERENCES public.staff(id),
  entry_type            public.staff_ledger_entry_type NOT NULL,
  amount_usd            numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  currency_entered      text NOT NULL CHECK (currency_entered IN ('usd', 'syp')),
  locked_rate           numeric(12,4),
  note                  text,
  source_type           public.staff_ledger_source_type NOT NULL DEFAULT 'manual',
  source_id             uuid,
  created_by_staff_id   uuid NOT NULL REFERENCES public.staff(id),
  client_operation_id   uuid NOT NULL,
  settlement_id         uuid REFERENCES public.staff_settlements(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  sync_status           text,

  CONSTRAINT staff_ledger_client_operation_id_key UNIQUE (client_operation_id),
  CONSTRAINT staff_ledger_rate_currency_check
    CHECK ((locked_rate IS NULL) = (currency_entered = 'usd'))
);

CREATE INDEX IF NOT EXISTS idx_staff_ledger_shop_staff_outstanding
  ON public.staff_ledger (shop_id, staff_id, settlement_id, created_at DESC);

-- RLS — mirrors migration 033's auth_shop_id() scoping. Both tables need
-- UPDATE: staff_ledger.settlement_id is set once by finalize(), and
-- staff_settlements transitions draft -> finalized -> paid.
--
-- NOTE (WAFI-122 dependency): this RLS only scopes by shop_id, matching every
-- other table in this schema today. It does NOT restrict by staff role/
-- permission — that enforcement is WAFI-122's job. Until WAFI-122 ships,
-- can_view_expenses is a CLIENT-SIDE gate only. Do not expose these tables'
-- read/write endpoints to any untrusted client before WAFI-122 is confirmed
-- shipped (see product ticket docs/WAFI-138-139-staff-settlement-revised.md).
ALTER TABLE public.staff_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_ledger      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_settlements_select_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_insert_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_update_all ON public.staff_settlements;
CREATE POLICY staff_settlements_select_all ON public.staff_settlements
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_settlements_insert_all ON public.staff_settlements
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_settlements_update_all ON public.staff_settlements
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

DROP POLICY IF EXISTS staff_ledger_select_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_insert_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_update_all ON public.staff_ledger;
CREATE POLICY staff_ledger_select_all ON public.staff_ledger
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_ledger_insert_all ON public.staff_ledger
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_ledger_update_all ON public.staff_ledger
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

-- PowerSync publication (mirrors migration 033's pattern).
DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['staff_settlements', 'staff_ledger']
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
