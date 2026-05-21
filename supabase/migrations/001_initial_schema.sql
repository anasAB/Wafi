-- Wafi POS — Initial Schema
-- Run via: supabase db push  OR  paste into Supabase SQL Editor
-- Zero-downtime rules (ENFORCEMENT.md §6): expand only, never DROP/RENAME on live data.

CREATE TABLE IF NOT EXISTS shops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id            UUID PRIMARY KEY,
  shop_id       UUID NOT NULL REFERENCES shops(id),
  device_code   TEXT NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_device_code_per_shop UNIQUE (shop_id, device_code)
);

CREATE TABLE IF NOT EXISTS products (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id   UUID NOT NULL REFERENCES shops(id),
  name_ar   TEXT NOT NULL,
  name_en   TEXT,
  price_usd NUMERIC(10,2) NOT NULL CHECK (price_usd >= 0),
  barcode   TEXT,
  photo_url TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS sales (
  id                       UUID PRIMARY KEY,
  shop_id                  UUID NOT NULL REFERENCES shops(id),
  device_id                UUID NOT NULL REFERENCES devices(id),
  device_sequence          INTEGER NOT NULL,
  display_sale_number      TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL,
  total_usd                NUMERIC(10,2) NOT NULL,
  total_syp                NUMERIC(12,0) NOT NULL,
  exchange_rate_at_sale    NUMERIC(10,2) NOT NULL CHECK (exchange_rate_at_sale > 0),
  payment_method           TEXT NOT NULL CHECK (payment_method IN ('cash_usd','cash_syp','card')),
  amount_received          NUMERIC(12,2),
  amount_received_currency TEXT CHECK (amount_received_currency IN ('USD','SYP')),
  change_due               NUMERIC(12,2),
  CONSTRAINT uq_sale_number_per_shop UNIQUE (shop_id, display_sale_number)
);

CREATE TABLE IF NOT EXISTS sale_line_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        UUID NOT NULL REFERENCES sales(id),
  shop_id        UUID NOT NULL REFERENCES shops(id),
  product_id     UUID NOT NULL REFERENCES products(id),
  quantity       INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price_usd NUMERIC(10,2) NOT NULL CHECK (unit_price_usd >= 0),
  line_total_usd NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id   UUID NOT NULL REFERENCES shops(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  rate      NUMERIC(10,2) NOT NULL CHECK (rate > 0),
  set_at    TIMESTAMPTZ NOT NULL,
  set_by    TEXT NOT NULL DEFAULT 'owner'
);

-- Indexes for PowerSync query performance
CREATE INDEX IF NOT EXISTS idx_products_shop      ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_shop         ON sales(shop_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_shop    ON sale_line_items(shop_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale    ON sale_line_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_shop ON exchange_rates(shop_id, set_at DESC);

-- Uniqueness constraints for multi-device scenarios
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_per_shop
  ON products(shop_id, barcode)
  WHERE barcode IS NOT NULL;

-- Device query performance
CREATE INDEX IF NOT EXISTS idx_sales_device_created ON sales(device_id, created_at DESC);

-- Product lookup in sale line items
CREATE INDEX IF NOT EXISTS idx_sale_lines_product ON sale_line_items(product_id);
