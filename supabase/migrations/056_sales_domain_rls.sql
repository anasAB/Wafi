-- supabase/migrations/056_sales_domain_rls.sql
-- WAFI-122: Sales domain -- sales, sale_line_items, sale_payments, returns,
-- return_line_items, return_reasons.
--
-- DISCOVERY STEP (required before applying this migration):
-- Since this agent has no live database access, the exact current policy names
-- on these tables were not auto-discovered. The brief specifies that these
-- tables were created as part of the original 15_rls_tenant_scoping.sql loop
-- (migration 015), and the policy names should follow the standard naming
-- convention (_insert_all / _update_all / _delete_all / _select_all).
--
-- Before running the SQL below, in the Supabase SQL editor, run this discovery
-- query to confirm the policy names:
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN ('sales','sale_line_items','sale_payments','returns','return_line_items','return_reasons')
-- ORDER BY tablename, cmd;
--
-- Also confirm sales.staff_id exists:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='sales' AND column_name ILIKE '%staff%';
--
-- If the policy names differ from the ones specified below (e.g., custom suffixes
-- instead of _select_all), substitute the correct names in the DROP POLICY
-- statements before executing this migration.
--
-- CONFIRMED (post-implementation-review correction): returns has NO staff_id
-- column -- it was never added (only migration 017 added sales.staff_id).
-- returns DOES have a shift_id column (migration 009), referencing
-- cashier_shifts, which DOES have staff_id (migration 009). So "cashier's own
-- returns" is expressed via the same EXISTS-through-parent pattern already
-- used for sale_line_items/sale_payments below, joining through
-- cashier_shifts instead of sales.
--
-- INSERT/UPDATE stay open to every shop role (cashier must be able to ring
-- a sale) -- the restriction is on SELECT: cashier sees only their own
-- sales, owner/manager see everything. sale_line_items/sale_payments have
-- no direct staff_id column -- they inherit sales' scoping via EXISTS,
-- since a line item / payment is only ever meaningful in the context of
-- its parent sale.

DROP POLICY IF EXISTS sales_select_all ON public.sales;
DROP POLICY IF EXISTS sale_line_items_select_all ON public.sale_line_items;
DROP POLICY IF EXISTS sale_payments_select_all ON public.sale_payments;
DROP POLICY IF EXISTS returns_select_all ON public.returns;
DROP POLICY IF EXISTS return_line_items_select_all ON public.return_line_items;

DROP POLICY IF EXISTS sales_select_own_or_manager ON public.sales;
CREATE POLICY sales_select_own_or_manager ON public.sales
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR staff_id = public.auth_staff_id()
    )
  );

DROP POLICY IF EXISTS sale_line_items_select_own_or_manager ON public.sale_line_items;
CREATE POLICY sale_line_items_select_own_or_manager ON public.sale_line_items
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.id = sale_line_items.sale_id AND s.staff_id = public.auth_staff_id()
      )
    )
  );

DROP POLICY IF EXISTS sale_payments_select_own_or_manager ON public.sale_payments;
CREATE POLICY sale_payments_select_own_or_manager ON public.sale_payments
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.id = sale_payments.sale_id AND s.staff_id = public.auth_staff_id()
      )
    )
  );

DROP POLICY IF EXISTS returns_select_own_or_manager ON public.returns;
CREATE POLICY returns_select_own_or_manager ON public.returns
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.cashier_shifts cs
        WHERE cs.id = returns.shift_id AND cs.staff_id = public.auth_staff_id()
      )
    )
  );

DROP POLICY IF EXISTS return_line_items_select_own_or_manager ON public.return_line_items;
CREATE POLICY return_line_items_select_own_or_manager ON public.return_line_items
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      public.auth_role() IN ('owner', 'manager')
      OR EXISTS (
        SELECT 1 FROM public.returns r
        JOIN public.cashier_shifts cs ON cs.id = r.shift_id
        WHERE r.id = return_line_items.return_id AND cs.staff_id = public.auth_staff_id()
      )
    )
  );

-- INSERT/UPDATE/DELETE policies for all six tables are left as-is from
-- migration 015 (open to every shop role, shop-scoped) -- INSERT must stay
-- open for the core POS flow; UPDATE/DELETE restrictions to "draft only" /
-- "nobody" require a sales.status column check this migration does not
-- have confirmed column values for, so is deferred to a follow-up (noted
-- in the plan's Task 12 verification script as a known gap to re-check
-- against the live schema before considering this domain fully closed).
-- Tracked as WAFI-202 (also covers the missing INSERT staff_id attribution
-- check across this domain and cash_movements/cashier_shifts).

-- return_reasons: config-like table, gate writes by can_manage_products
-- (shares the products config surface per design spec §5.2).
DROP POLICY IF EXISTS return_reasons_insert_all ON public.return_reasons;
DROP POLICY IF EXISTS return_reasons_update_all ON public.return_reasons;
DROP POLICY IF EXISTS return_reasons_delete_all ON public.return_reasons;

DROP POLICY IF EXISTS return_reasons_insert_permission ON public.return_reasons;
CREATE POLICY return_reasons_insert_permission ON public.return_reasons
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  );

DROP POLICY IF EXISTS return_reasons_update_permission ON public.return_reasons;
CREATE POLICY return_reasons_update_permission ON public.return_reasons
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  );

DROP POLICY IF EXISTS return_reasons_delete_permission ON public.return_reasons;
CREATE POLICY return_reasons_delete_permission ON public.return_reasons
  FOR DELETE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_manage_products')
  );
