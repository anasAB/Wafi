-- Wafi POS — apply pending hosted-DB migrations (017–020), in order.
-- =============================================================================
-- Paste this whole file into the Supabase SQL editor for project
-- `eazyrdnvsiyaaccvjbhb` and run once. Every statement is idempotent and
-- expand-only (IF NOT EXISTS / DROP+recreate of constraints & policies only) —
-- safe to re-run; no row data is ever dropped or renamed.
--
-- WHY THIS IS NEEDED BEFORE GOLDEN-PATH V3/V6:
--   * 017 adds sales.staff_id. The client now WRITES this column (switch-operator
--     is merged), so without it every sale upload fails with a PostgREST error
--     and sync jams — V3 (ring + sync a sale) cannot pass.
--   * 018/019/020 back the Tier-2 accountability features (append-only audit,
--     salted PIN, Manager role). Needed only if those features are exercised; the
--     bare golden path needs just 017.
-- Mirrors the migration files under supabase/migrations/ — that directory stays
-- the source of record.
-- =============================================================================

-- ── 017 — sales.staff_id (operator attribution) ─────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff(id);
COMMENT ON COLUMN public.sales.staff_id IS
  'Operator who completed (confirmed) the sale. Nullable for rows predating operator attribution; shift_id remains the cash-period link.';

-- ── 018 — audit_log append-only (WAFI-009) ──────────────────────────────────
DROP POLICY IF EXISTS audit_log_update_all ON public.audit_log;
DROP POLICY IF EXISTS audit_log_delete_all ON public.audit_log;
REVOKE UPDATE, DELETE ON public.audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_log_block_modify()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON public.audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_modify();

-- ── 019 — per-staff PIN salt (WAFI-012) ─────────────────────────────────────
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS pin_salt TEXT;
COMMENT ON COLUMN public.staff.pin_salt IS
  'Per-staff random salt (hex) prepended to the PIN before SHA-256. NULL = legacy unsalted hash.';

-- ── 020 — Manager role (WAFI-013) ───────────────────────────────────────────
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE public.staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('owner','cashier','manager'));

-- =============================================================================
-- POST-APPLY VERIFICATION — run these and eyeball the results.
-- =============================================================================

-- 1) Columns exist (expect 2 rows: sales.staff_id, staff.pin_salt).
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'sales' AND column_name = 'staff_id')
    OR (table_name = 'staff' AND column_name = 'pin_salt'))
ORDER BY table_name;

-- 2) Manager role allowed by the CHECK (expect the constraint to include 'manager').
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.staff'::regclass AND conname = 'staff_role_check';

-- 3) audit_log has NO update/delete policy and HAS the block trigger.
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'audit_log' ORDER BY cmd;   -- expect only SELECT + INSERT
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.audit_log'::regclass AND NOT tgisinternal;     -- expect trg_audit_log_no_update

-- 4) (V6 prep) Append-only enforced for a normal client. As `authenticated`,
--    both of these MUST error with 'audit_log is append-only':
--    SET LOCAL ROLE authenticated;
--    UPDATE public.audit_log SET event = 'x' WHERE true;   -- expect: ERROR
--    DELETE FROM public.audit_log WHERE true;              -- expect: ERROR
--    RESET ROLE;
