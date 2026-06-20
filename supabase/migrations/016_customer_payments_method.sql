-- Wafi POS — Add a payment `method` to customer_payments.
--
-- Why: cash drawer / Z-report reconciliation must count credit collections that
-- physically enter the till, but NOT collections settled by bank wire, USDT, or
-- hawala. The table previously recorded only `currency` (denomination), with no
-- way to tell cash from non-cash, so cash credit-payments were left out of the
-- drawer entirely (every shift that collected credit showed a phantom surplus).
--
-- Cash detection downstream is `method = 'cash'`, split by `currency`.
-- Existing rows keep method NULL (unknown) — they predate the field and are
-- historical, so they are excluded from reconciliation (conservative, no
-- retroactive change to past variances).

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS method TEXT
    CHECK (method IS NULL OR method IN ('cash', 'transfer', 'usdt', 'hawala'));

COMMENT ON COLUMN public.customer_payments.method IS
  'How the credit payment was collected. Only ''cash'' enters the cash drawer / Z-report; currency holds the denomination.';
