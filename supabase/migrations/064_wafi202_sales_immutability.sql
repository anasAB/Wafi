-- supabase/migrations/064_wafi202_sales_immutability.sql
-- WAFI-202: sales, sale_line_items, sale_payments, returns, return_line_items
-- become append-only from the client's perspective (no UPDATE/DELETE for
-- anon/authenticated), and INSERT requires strict staff attribution --
-- staff_id = auth_staff_id(), no owner/manager exception.
--
-- Confirmed via live exploit test against production (2026-07-21): a
-- manager-role session could change total_usd on a completed sale and
-- forge staff_id attribution, since these five tables kept migration-015's
-- shop-scoped-only INSERT/UPDATE/DELETE policies (056_sales_domain_rls.sql
-- tightened SELECT only, deferring the rest -- tracked as WAFI-202).
--
-- Financial corrections are represented as new immutable events (returns)
-- rather than modifications of historical records -- confirmed no
-- legitimate client code path ever issues UPDATE on any of these five
-- tables (searched all of src/). sync_status is written once, as part of
-- the initial INSERT.
--
-- No owner/manager INSERT exception: switch_active_operator()
-- (045/048_session_id_active_role.sql) already provides a secure,
-- PIN-verified, audited path to act as another staff member. A second,
-- unauthenticated attribution path here would reopen the exact bypass
-- this migration exists to close.
--
-- These restrictions apply only to anon/authenticated application
-- sessions -- PostgreSQL superusers and service_role continue to bypass
-- RLS entirely, as designed.
--
-- Rollback: restore the original migration-015 INSERT/UPDATE/DELETE
-- policies for these five tables (shop-scoped only, no attribution/
-- immutability check). Policy-only rollback -- no data migration and no
-- schema rollback required.

-- ============================================================
-- sales
-- ============================================================
DROP POLICY IF EXISTS sales_insert_all ON public.sales;
DROP POLICY IF EXISTS sales_update_all ON public.sales;
DROP POLICY IF EXISTS sales_delete_all ON public.sales;

CREATE POLICY sales_insert_own ON public.sales
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND staff_id = public.auth_staff_id()
  );
-- No UPDATE/DELETE policy: sales is append-only.

-- ============================================================
-- sale_line_items (attribution via parent sale)
-- ============================================================
DROP POLICY IF EXISTS sale_line_items_insert_all ON public.sale_line_items;
DROP POLICY IF EXISTS sale_line_items_update_all ON public.sale_line_items;
DROP POLICY IF EXISTS sale_line_items_delete_all ON public.sale_line_items;

CREATE POLICY sale_line_items_insert_own ON public.sale_line_items
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_line_items.sale_id AND s.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.

-- ============================================================
-- sale_payments (attribution via parent sale)
-- ============================================================
DROP POLICY IF EXISTS sale_payments_insert_all ON public.sale_payments;
DROP POLICY IF EXISTS sale_payments_update_all ON public.sale_payments;
DROP POLICY IF EXISTS sale_payments_delete_all ON public.sale_payments;

CREATE POLICY sale_payments_insert_own ON public.sale_payments
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_payments.sale_id AND s.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.

-- ============================================================
-- returns (attribution via shift_id -> cashier_shifts.staff_id, since
-- returns has no direct staff_id column -- same join pattern
-- 056_sales_domain_rls.sql already uses for its SELECT policy)
-- ============================================================
DROP POLICY IF EXISTS returns_insert_all ON public.returns;
DROP POLICY IF EXISTS returns_update_all ON public.returns;
DROP POLICY IF EXISTS returns_delete_all ON public.returns;

CREATE POLICY returns_insert_own ON public.returns
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.cashier_shifts cs
      WHERE cs.id = returns.shift_id AND cs.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.

-- ============================================================
-- return_line_items (attribution via parent return)
-- ============================================================
DROP POLICY IF EXISTS return_line_items_insert_all ON public.return_line_items;
DROP POLICY IF EXISTS return_line_items_update_all ON public.return_line_items;
DROP POLICY IF EXISTS return_line_items_delete_all ON public.return_line_items;

CREATE POLICY return_line_items_insert_own ON public.return_line_items
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND EXISTS (
      SELECT 1 FROM public.returns r
      JOIN public.cashier_shifts cs ON cs.id = r.shift_id
      WHERE r.id = return_line_items.return_id AND cs.staff_id = public.auth_staff_id()
    )
  );
-- No UPDATE/DELETE policy: append-only.
