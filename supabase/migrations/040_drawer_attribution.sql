-- WAFI-120: drawer unification — anything that moves physical cash carries
-- shift_id + device_id.
--
-- The Z-report's variance (the product's core anti-theft number) attributed
-- cash expenses and credit collections by TIME WINDOW, which double-counts
-- them across overlapping shifts the moment a second device exists. This adds
-- direct linkage columns; the Z-report attributes rows with shift_id directly
-- and falls back to the time window only for legacy null rows.
--
-- Expand-only: nullable columns, historical rows stay null. (039 is reserved
-- by the in-flight denomination-counting migration.)

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS shift_id  uuid,
  ADD COLUMN IF NOT EXISTS device_id text;

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS shift_id  uuid,
  ADD COLUMN IF NOT EXISTS device_id text;

-- No FK to cashier_shifts on purpose: offline devices may sync a payment
-- before the shift row arrives; the link is informational attribution, and a
-- reject-on-missing-parent would dead-letter valid writes.

CREATE INDEX IF NOT EXISTS idx_expenses_shift
  ON public.expenses (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_payments_shift
  ON public.customer_payments (shift_id) WHERE shift_id IS NOT NULL;

-- Existing RLS policies scope by shop_id at row level and cover new columns.
