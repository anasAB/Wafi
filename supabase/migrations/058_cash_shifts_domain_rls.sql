-- Wafi POS — WAFI-122: Cash & Shifts domain RLS enforcement.
--
-- Scopes SELECT access to cashier_shifts and cash_movements by staff/shift
-- attribution, while keeping INSERT open (cashier must be able to open own shift
-- and record own movements). UPDATE/DELETE on cash_movements remain absent
-- (append-only ledger; mistakes corrected via reversing rows, not edits).
--
-- denomination_configs is owner-only for INSERT/UPDATE/DELETE (shop-wide config).

-- ============================================================================
-- cashier_shifts: owner/manager see all, cashier sees only their own shifts
-- ============================================================================

DROP POLICY IF EXISTS cashier_shifts_select_all ON public.cashier_shifts;

CREATE POLICY cashier_shifts_select_own_or_manager ON public.cashier_shifts
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = public.auth_staff_id()
    )
  );

-- ============================================================================
-- cash_movements: owner/manager see all, cashier sees only movements with
-- their staff_id. Direct staff_id column check (no EXISTS indirection).
-- ============================================================================

DROP POLICY IF EXISTS cash_movements_select_all ON public.cash_movements;

CREATE POLICY cash_movements_select_own_or_manager ON public.cash_movements
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = public.auth_staff_id()
    )
  );

-- Keep INSERT policy open (cashier must record own movements).
-- cash_movements is append-only: no UPDATE/DELETE policy created.
-- Existing insert policy from migration 027 stays as-is.

DROP POLICY IF EXISTS cash_movements_update_all ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_delete_all ON public.cash_movements;

-- ============================================================================
-- denomination_configs: owner-only INSERT/UPDATE/DELETE; SELECT remains open
-- to all shop users (it's a config list, not sensitive data).
-- ============================================================================

DROP POLICY IF EXISTS denomination_configs_select_all ON public.denomination_configs;
DROP POLICY IF EXISTS denomination_configs_insert_all ON public.denomination_configs;
DROP POLICY IF EXISTS denomination_configs_update_all ON public.denomination_configs;
DROP POLICY IF EXISTS denomination_configs_delete_all ON public.denomination_configs;

CREATE POLICY denomination_configs_select_all ON public.denomination_configs
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()));

CREATE POLICY denomination_configs_insert_owner ON public.denomination_configs
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');

CREATE POLICY denomination_configs_update_owner ON public.denomination_configs
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner')
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');

CREATE POLICY denomination_configs_delete_owner ON public.denomination_configs
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');
