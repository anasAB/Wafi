-- Wafi POS — WAFI-122: Accounting (Customer Credit) domain RLS enforcement.
--
-- DISCOVERY STEP (required before applying this migration):
-- Since this agent has no live database access, the exact current policy names
-- on these tables were not auto-discovered. The brief specifies that these
-- tables were created as part of the original migration 015 (expenses, customers,
-- customer_payments) and later additions (installment_plans in migration 033,
-- installment_dues in migration 033). The policy names should follow the standard
-- naming convention (_insert_all / _update_all / _delete_all / _select_all).
--
-- Before running the SQL below, in the Supabase SQL editor, run this discovery
-- query to confirm the policy names:
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN ('expenses','customers','customer_payments','installment_plans','installment_dues')
-- ORDER BY tablename, cmd;
--
-- The policy names for installment_plans and installment_dues are less certain
-- than those for the original 015 tables, since they were added later.
-- If the policy names differ from the ones specified below (e.g., custom suffixes
-- instead of _insert_all / _update_all), substitute the correct names in the
-- DROP POLICY statements before executing this migration.
--
-- RESIDUAL RISK: If the DROP POLICY statements use incorrect names (because
-- the actual policy names differ and were not corrected), those old wrongly-named
-- policies will survive alongside the new ones, potentially creating conflicting
-- RLS rules. After deployment, verify this did not occur by running the
-- verification query above to confirm only the expected new policies exist.

-- ============================================================================
-- expenses: owner/manager only (design spec §5.5).
-- Cashiers do not log expenses in this product's model.
-- No DELETE policy: expenses are never deleted (corrected via a new entry).
-- ============================================================================

DROP POLICY IF EXISTS expenses_select_all ON public.expenses;
DROP POLICY IF EXISTS expenses_insert_all ON public.expenses;
DROP POLICY IF EXISTS expenses_update_all ON public.expenses;
DROP POLICY IF EXISTS expenses_delete_all ON public.expenses;

DROP POLICY IF EXISTS expenses_select_owner_manager ON public.expenses;
CREATE POLICY expenses_select_owner_manager ON public.expenses
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));

DROP POLICY IF EXISTS expenses_insert_owner_manager ON public.expenses;
CREATE POLICY expenses_insert_owner_manager ON public.expenses
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));

DROP POLICY IF EXISTS expenses_update_owner_manager ON public.expenses;
CREATE POLICY expenses_update_owner_manager ON public.expenses
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));

-- ============================================================================
-- customers: gated by can_manage_customers permission (design spec §4.2).
-- ============================================================================

DROP POLICY IF EXISTS customers_insert_all ON public.customers;
DROP POLICY IF EXISTS customers_update_all ON public.customers;
DROP POLICY IF EXISTS customers_delete_all ON public.customers;

DROP POLICY IF EXISTS customers_insert_permission ON public.customers;
CREATE POLICY customers_insert_permission ON public.customers
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));

DROP POLICY IF EXISTS customers_update_permission ON public.customers;
CREATE POLICY customers_update_permission ON public.customers
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));

DROP POLICY IF EXISTS customers_delete_permission ON public.customers;
CREATE POLICY customers_delete_permission ON public.customers
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));

-- ============================================================================
-- customer_payments: gated by can_manage_customers permission.
-- Immutable: no UPDATE/DELETE policy (design spec §5.5).
-- ============================================================================

DROP POLICY IF EXISTS customer_payments_insert_all ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_update_all ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_delete_all ON public.customer_payments;

DROP POLICY IF EXISTS customer_payments_insert_permission ON public.customer_payments;
CREATE POLICY customer_payments_insert_permission ON public.customer_payments
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));

-- ============================================================================
-- installment_plans: gated by can_manage_customers permission for INSERT,
-- owner/manager only for UPDATE.
-- ============================================================================

DROP POLICY IF EXISTS installment_plans_insert_all ON public.installment_plans;
DROP POLICY IF EXISTS installment_plans_update_all ON public.installment_plans;

DROP POLICY IF EXISTS installment_plans_insert_permission ON public.installment_plans;
CREATE POLICY installment_plans_insert_permission ON public.installment_plans
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_customers'));

DROP POLICY IF EXISTS installment_plans_update_owner_manager ON public.installment_plans;
CREATE POLICY installment_plans_update_owner_manager ON public.installment_plans
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));

-- ============================================================================
-- installment_dues: owner/manager only for UPDATE.
-- ============================================================================

DROP POLICY IF EXISTS installment_dues_update_all ON public.installment_dues;

DROP POLICY IF EXISTS installment_dues_update_owner_manager ON public.installment_dues;
CREATE POLICY installment_dues_update_owner_manager ON public.installment_dues
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() IN ('owner','manager'));
