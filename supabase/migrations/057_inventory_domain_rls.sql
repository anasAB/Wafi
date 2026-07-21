-- WAFI-122: Inventory domain. SELECT stays open shop-wide on every table
-- (POS/product-list screens need it for every role). Writes are gated by
-- an EXPLICIT, single-purpose permission flag per sub-domain -- no generic
-- can_manage_* catch-all (design spec §4.2): can_manage_products,
-- can_manage_inventory, can_manage_suppliers, can_manage_stock_take.
--
-- Discovery query (for reference / re-verification against the live DB --
-- this sandbox has no DB access, so policy names below were instead
-- confirmed by reading the migrations that created them: 015 (products,
-- stock_adjustments, suppliers, stock_receivings, stock_receiving_line_items),
-- 036 (categories, subcategories), 035 (stock_take_sessions, stock_take_lines).
-- 038_stock_take_scope_ids.sql only added columns, no policy changes. Residual
-- risk: none identified from the migration history, but this has NOT been
-- verified against a live pg_policies query -- run the query below before/after
-- applying to confirm no drift):
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN ('products','categories','subcategories','stock_adjustments','suppliers',
--                      'stock_receivings','stock_receiving_line_items','stock_take_sessions','stock_take_lines')
-- ORDER BY tablename, cmd;

DROP POLICY IF EXISTS products_insert_all ON public.products;
DROP POLICY IF EXISTS products_update_all ON public.products;
DROP POLICY IF EXISTS products_delete_all ON public.products;

CREATE POLICY products_insert_permission ON public.products
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY products_update_permission ON public.products
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY products_delete_permission ON public.products
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));

-- categories/subcategories share the products permission (same config
-- surface, per design spec §5.3).
DROP POLICY IF EXISTS categories_insert_all ON public.categories;
DROP POLICY IF EXISTS categories_update_all ON public.categories;
DROP POLICY IF EXISTS categories_delete_all ON public.categories;
CREATE POLICY categories_insert_permission ON public.categories
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY categories_update_permission ON public.categories
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY categories_delete_permission ON public.categories
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));

DROP POLICY IF EXISTS subcategories_insert_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_update_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_delete_all ON public.subcategories;
CREATE POLICY subcategories_insert_permission ON public.subcategories
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY subcategories_update_permission ON public.subcategories
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));
CREATE POLICY subcategories_delete_permission ON public.subcategories
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_products'));

-- stock_adjustments: append-only ledger -- INSERT only, gated by
-- can_manage_inventory (distinct flag from can_manage_products, per §4.2).
DROP POLICY IF EXISTS stock_adjustments_insert_all ON public.stock_adjustments;
DROP POLICY IF EXISTS stock_adjustments_update_all ON public.stock_adjustments;
DROP POLICY IF EXISTS stock_adjustments_delete_all ON public.stock_adjustments;
CREATE POLICY stock_adjustments_insert_permission ON public.stock_adjustments
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_inventory'));
-- No UPDATE/DELETE policy created: append-only, denied to everyone by
-- omission (matches audit_log's pattern, migration 018).

-- suppliers, stock_receivings, stock_receiving_line_items: can_manage_suppliers.
DROP POLICY IF EXISTS suppliers_insert_all ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update_all ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete_all ON public.suppliers;
CREATE POLICY suppliers_insert_permission ON public.suppliers
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY suppliers_update_permission ON public.suppliers
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY suppliers_delete_permission ON public.suppliers
  FOR DELETE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));

DROP POLICY IF EXISTS stock_receivings_insert_all ON public.stock_receivings;
DROP POLICY IF EXISTS stock_receivings_update_all ON public.stock_receivings;
DROP POLICY IF EXISTS stock_receivings_delete_all ON public.stock_receivings;
CREATE POLICY stock_receivings_insert_permission ON public.stock_receivings
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY stock_receivings_update_permission ON public.stock_receivings
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
-- No DELETE policy: a finalized receiving is never deleted (design spec §5.3).

DROP POLICY IF EXISTS stock_receiving_line_items_insert_all ON public.stock_receiving_line_items;
DROP POLICY IF EXISTS stock_receiving_line_items_update_all ON public.stock_receiving_line_items;
CREATE POLICY stock_receiving_line_items_insert_permission ON public.stock_receiving_line_items
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));
CREATE POLICY stock_receiving_line_items_update_permission ON public.stock_receiving_line_items
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_suppliers'));

-- stock_take_sessions/stock_take_lines: can_manage_stock_take.
DROP POLICY IF EXISTS stock_take_sessions_insert_all ON public.stock_take_sessions;
DROP POLICY IF EXISTS stock_take_sessions_update_all ON public.stock_take_sessions;
CREATE POLICY stock_take_sessions_insert_permission ON public.stock_take_sessions
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));
CREATE POLICY stock_take_sessions_update_permission ON public.stock_take_sessions
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));

DROP POLICY IF EXISTS stock_take_lines_insert_all ON public.stock_take_lines;
DROP POLICY IF EXISTS stock_take_lines_update_all ON public.stock_take_lines;
CREATE POLICY stock_take_lines_insert_permission ON public.stock_take_lines
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));
CREATE POLICY stock_take_lines_update_permission ON public.stock_take_lines
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.can('can_manage_stock_take'));
