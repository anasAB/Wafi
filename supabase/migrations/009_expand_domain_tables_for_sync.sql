-- Wafi POS — Expand schema so all PowerSync bucket tables exist.
-- Safe migration: CREATE/ALTER IF NOT EXISTS only.

-- -------------------------------
-- Missing domain tables
-- -------------------------------

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_value  INTEGER NOT NULL,
  new_value  INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_id  UUID REFERENCES public.devices(id)
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_shop_created
  ON public.stock_adjustments (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product
  ON public.stock_adjustments (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency     TEXT NOT NULL CHECK (currency IN ('USD', 'SYP')),
  amount_usd   NUMERIC(12,2) NOT NULL CHECK (amount_usd >= 0),
  category     TEXT NOT NULL,
  expense_date DATE NOT NULL,
  notes        TEXT,
  photo_url    TEXT,
  paid_in_cash INTEGER NOT NULL DEFAULT 1 CHECK (paid_in_cash IN (0, 1)),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status  TEXT
);

CREATE INDEX IF NOT EXISTS idx_expenses_shop_date
  ON public.expenses (shop_id, expense_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  mobile      TEXT,
  address     TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_shop_active_name
  ON public.customers (shop_id, deleted, name);

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                  UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  customer_id              UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sale_id                  UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  amount_usd               NUMERIC(12,2) NOT NULL CHECK (amount_usd >= 0),
  currency                 TEXT NOT NULL CHECK (currency IN ('USD', 'SYP')),
  amount_raw               NUMERIC(12,2) NOT NULL CHECK (amount_raw >= 0),
  exchange_rate_at_payment NUMERIC(12,4),
  notes                    TEXT,
  paid_at                  DATE NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status              TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_shop_customer
  ON public.customer_payments (shop_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payments_sale
  ON public.customer_payments (sale_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.receipt_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  shop_name   TEXT,
  tax_number  TEXT,
  header_text TEXT,
  footer_text TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_settings_shop
  ON public.receipt_settings (shop_id);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  shop_id       UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  method        TEXT NOT NULL CHECK (method IN ('cash_usd', 'cash_syp', 'card')),
  amount_raw    NUMERIC(12,2) NOT NULL CHECK (amount_raw >= 0),
  currency      TEXT NOT NULL CHECK (currency IN ('USD', 'SYP')),
  amount_usd    NUMERIC(12,2) NOT NULL CHECK (amount_usd >= 0),
  exchange_rate NUMERIC(12,4),
  change_due    NUMERIC(12,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale
  ON public.sale_payments (sale_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_payments_shop_created
  ON public.sale_payments (shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  device_id        UUID NOT NULL REFERENCES public.devices(id),
  staff_id         UUID REFERENCES public.staff(id),
  opened_at        TIMESTAMPTZ NOT NULL,
  closed_at        TIMESTAMPTZ,
  opening_cash_usd NUMERIC(12,2) NOT NULL CHECK (opening_cash_usd >= 0),
  closing_cash_usd NUMERIC(12,2),
  closing_cash_syp NUMERIC(14,0),
  status           TEXT NOT NULL CHECK (status IN ('open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_shop_opened
  ON public.cashier_shifts (shop_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_status
  ON public.cashier_shifts (shop_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.returns (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                 UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  original_sale_id        UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  refund_method           TEXT NOT NULL CHECK (refund_method IN ('cash_usd', 'cash_syp', 'store_credit', 'transfer')),
  refund_amount_usd       NUMERIC(12,2) NOT NULL CHECK (refund_amount_usd >= 0),
  refund_amount_syp       NUMERIC(14,0) NOT NULL CHECK (refund_amount_syp >= 0),
  exchange_rate_at_return NUMERIC(12,4),
  reason                  TEXT,
  notes                   TEXT,
  shift_id                UUID REFERENCES public.cashier_shifts(id),
  sync_status             TEXT
);

CREATE INDEX IF NOT EXISTS idx_returns_shop_created
  ON public.returns (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_original_sale
  ON public.returns (original_sale_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.return_line_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      UUID NOT NULL REFERENCES public.returns(id) ON DELETE CASCADE,
  shop_id        UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty_returned   INTEGER NOT NULL CHECK (qty_returned > 0),
  unit_price_usd NUMERIC(12,2) NOT NULL CHECK (unit_price_usd >= 0),
  unit_price_syp NUMERIC(14,0) NOT NULL CHECK (unit_price_syp >= 0),
  restock        INTEGER NOT NULL CHECK (restock IN (0, 1)),
  sync_status    TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_lines_return
  ON public.return_line_items (return_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_shop_product
  ON public.return_line_items (shop_id, product_id);

CREATE TABLE IF NOT EXISTS public.return_reasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_return_reasons_shop_order
  ON public.return_reasons (shop_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  phone          TEXT,
  contact_person TEXT,
  address        TEXT,
  notes          TEXT,
  deleted        INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status    TEXT
);

CREATE INDEX IF NOT EXISTS idx_suppliers_shop_active_name
  ON public.suppliers (shop_id, deleted, name);

CREATE TABLE IF NOT EXISTS public.stock_receivings (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                    UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  supplier_id                UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  received_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  invoice_photo_url          TEXT,
  total_cost_usd             NUMERIC(12,2) NOT NULL CHECK (total_cost_usd >= 0),
  exchange_rate_at_receiving NUMERIC(12,4),
  notes                      TEXT,
  staff_id                   UUID REFERENCES public.staff(id),
  sync_status                TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_receivings_shop_received
  ON public.stock_receivings (shop_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_receivings_supplier
  ON public.stock_receivings (supplier_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_receiving_line_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id  UUID NOT NULL REFERENCES public.stock_receivings(id) ON DELETE CASCADE,
  shop_id       UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty_received  INTEGER NOT NULL CHECK (qty_received > 0),
  unit_cost_usd NUMERIC(12,2) NOT NULL CHECK (unit_cost_usd >= 0),
  cost_updated  INTEGER NOT NULL DEFAULT 0 CHECK (cost_updated IN (0, 1)),
  sync_status   TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_receiving_lines_receiving
  ON public.stock_receiving_line_items (receiving_id);
CREATE INDEX IF NOT EXISTS idx_stock_receiving_lines_shop_product
  ON public.stock_receiving_line_items (shop_id, product_id);

-- -------------------------------
-- Expand existing tables used by current app writes
-- -------------------------------

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS is_credit INTEGER NOT NULL DEFAULT 0 CHECK (is_credit IN (0, 1)),
  ADD COLUMN IF NOT EXISTS is_split INTEGER NOT NULL DEFAULT 0 CHECK (is_split IN (0, 1)),
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.cashier_shifts(id);

CREATE INDEX IF NOT EXISTS idx_sales_shop_credit_customer
  ON public.sales (shop_id, is_credit, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_shift
  ON public.sales (shift_id, created_at DESC);

ALTER TABLE public.sale_line_items
  ADD COLUMN IF NOT EXISTS unit_cost_usd NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (unit_cost_usd >= 0);

-- -------------------------------
-- Grants (mirror existing migration style)
-- -------------------------------

GRANT ALL ON TABLE public.stock_adjustments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.expenses TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.customers TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.customer_payments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.receipt_settings TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.sale_payments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.cashier_shifts TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.returns TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.return_line_items TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.return_reasons TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.suppliers TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.stock_receivings TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.stock_receiving_line_items TO anon, authenticated, service_role;
