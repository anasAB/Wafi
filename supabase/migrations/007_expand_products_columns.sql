-- Wafi POS — Expand products table to match current app schema
-- Fixes PGRST204 for missing products.category (and prevents repeated missing-column errors)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price_usd NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost_price_usd >= 0),
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS current_stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_status TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_products_shop_active
  ON public.products (shop_id, deleted, is_active);
