-- WAFI-122: Staff Finance domain (renamed from "Payroll" per design spec
-- §5.6 -- this is advances/penalties/settlements, not payroll/compliance).
-- Renamed permission flag: can_view_staff_ledger (owner always passes via
-- can()'s built-in owner bypass).
--
-- Discovery (no live DB access available to this task; run before applying
-- to confirm existing policy names / status enum match the assumptions
-- below -- staff_ledger/staff_settlements were added in migration 043,
-- after migration 015's original RLS loop, so policy names here are a
-- best-effort guess, not confirmed against a live catalog):
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname='public' AND tablename IN ('staff_ledger','staff_settlements')
-- ORDER BY tablename, cmd;
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='staff_settlements' AND column_name ILIKE '%status%';
--
-- Controller has confirmed via direct schema inspection of migration 043 that
-- staff_settlements.status is public.staff_settlement_status ENUM with values
-- 'draft' / 'finalized' / 'paid' -- no schema risk on the enum values.

DROP POLICY IF EXISTS staff_ledger_select_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_insert_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_update_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_delete_all ON public.staff_ledger;

CREATE POLICY staff_ledger_select_permission ON public.staff_ledger
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
CREATE POLICY staff_ledger_insert_permission ON public.staff_ledger
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
-- No UPDATE/DELETE policy: staff_ledger is fully immutable (design spec §5.6).

DROP POLICY IF EXISTS staff_settlements_select_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_insert_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_update_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_delete_all ON public.staff_settlements;

CREATE POLICY staff_settlements_select_permission ON public.staff_settlements
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
CREATE POLICY staff_settlements_insert_permission ON public.staff_settlements
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_view_staff_ledger'));
CREATE POLICY staff_settlements_update_draft_only ON public.staff_settlements
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_view_staff_ledger')
    AND status = 'draft'
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_view_staff_ledger')
  );
-- No DELETE policy on either table: neither is ever deleted.
