-- Wafi POS — WAFI-101: unknown-barcode quick-add & open-item sale line.
--
-- 'quick_add'  — created inline from an unknown-barcode scan; surfaced in
--                Back Office as "needs review" until the owner fills in cost.
-- 'open_item'  — a one-off cart line with no catalog product (is_active=0,
--                current_stock pinned at 0, never shown in the POS grid or
--                stock/dead-stock/low-stock/reorder logic). Reuses the sale/
--                return pipeline as a real (hidden) product row rather than
--                threading a nullable product_id through every consumer.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS created_via text;
