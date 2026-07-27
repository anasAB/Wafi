-- Wafi POS — WAFI-001 closeout: fixes Vuln 1 and Vuln 2 from the 2026-07-22
-- security review (docs/security-review-2026-07-22.md).
--
-- Vuln 1 (High): migration 058 replaced cashier_shifts' SELECT policy with an
-- ownership-aware one but never dropped the wide-open update_all/delete_all
-- policies migration 015 generated generically (shop_id-only, no staff/role
-- check). Permissive policies of the same command type are OR'd together, so
-- the stale policy alone authorized any shop staff to tamper with or delete
-- any other staff member's shift. Fixed the same way migration 058 fixed
-- SELECT: drop the stale policy, replace with an ownership-or-manager check.
--
-- Vuln 2 (Medium): migration 064 (WAFI-202) added staff-attribution checks to
-- the sales-domain INSERT policies but explicitly deferred the same fix for
-- cashier_shifts and cash_movements (see 058's inline comment). Fixed by
-- adding the identical staff_id = auth_staff_id() check to both tables'
-- INSERT WITH CHECK clauses.

-- ============================================================================
-- Vuln 1: cashier_shifts UPDATE/DELETE — drop stale permissive policies,
-- replace with the same staff-or-manager ownership check already used for
-- SELECT (migration 058).
-- ============================================================================

DROP POLICY IF EXISTS cashier_shifts_update_all ON public.cashier_shifts;
DROP POLICY IF EXISTS cashier_shifts_delete_all ON public.cashier_shifts;
DROP POLICY IF EXISTS cashier_shifts_update_own_or_manager ON public.cashier_shifts;
DROP POLICY IF EXISTS cashier_shifts_delete_own_or_manager ON public.cashier_shifts;

CREATE POLICY cashier_shifts_update_own_or_manager ON public.cashier_shifts
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = (SELECT public.auth_staff_id())
    )
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = (SELECT public.auth_staff_id())
    )
  );

CREATE POLICY cashier_shifts_delete_own_or_manager ON public.cashier_shifts
  FOR DELETE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = (SELECT public.auth_staff_id())
    )
  );

-- ============================================================================
-- Vuln 2: cashier_shifts / cash_movements INSERT attribution — mirror the
-- WAFI-202 pattern from migration 064. Both tables' existing insert_all
-- policies were shop_id-only; replace with the same policy name so this is
-- re-runnable, adding a staff_id check.
-- ============================================================================

DROP POLICY IF EXISTS cashier_shifts_insert_all ON public.cashier_shifts;

CREATE POLICY cashier_shifts_insert_all ON public.cashier_shifts
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND staff_id = (SELECT public.auth_staff_id())
  );

DROP POLICY IF EXISTS cash_movements_insert_all ON public.cash_movements;

CREATE POLICY cash_movements_insert_all ON public.cash_movements
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND staff_id = (SELECT public.auth_staff_id())
  );
