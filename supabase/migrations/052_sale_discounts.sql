-- 052_sale_discounts.sql
-- WAFI-100: capped/audited line + sale discounts.
-- Caps are OWNER-EDITABLE from the client (unlike shops.features in ADR-008/041,
-- which is server-only) — do NOT add a client-update-blocking trigger here.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS cashier_discount_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (cashier_discount_cap_pct >= 0 AND cashier_discount_cap_pct <= 100),
  ADD COLUMN IF NOT EXISTS manager_discount_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 15
    CHECK (manager_discount_cap_pct >= 0 AND manager_discount_cap_pct <= 100);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_discount_type TEXT
    CHECK (sale_discount_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS sale_discount_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sale_discount_amount_usd NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (sale_discount_amount_usd >= 0);

ALTER TABLE public.sale_line_items
  ADD COLUMN IF NOT EXISTS discount_type TEXT
    CHECK (discount_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount_usd NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (discount_amount_usd >= 0);
