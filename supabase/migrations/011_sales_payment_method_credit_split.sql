-- Wafi POS — Allow 'credit' and 'split' as sales.payment_method values.
--
-- Migration 009 added is_credit / is_split columns and the app (usePayment.ts)
-- writes payment_method = 'credit' for آجل sales and 'split' for multi-tender
-- sales. But the original CHECK from 001 only allowed cash_usd/cash_syp/card,
-- so every credit/split sale was rejected on upload (Postgres 23514) and — with
-- the throw-on-error upload connector — wedged the entire PowerSync upload queue.
--
-- Safe: only swaps a CHECK constraint, touches no data. Re-runnable.

DO $$
BEGIN
  -- Drop the old constraint by its auto-generated name if it is still present.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_payment_method_check'
  ) THEN
    ALTER TABLE public.sales DROP CONSTRAINT sales_payment_method_check;
  END IF;

  -- Add the widened constraint if it isn't already there.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_payment_method_check2'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_payment_method_check2
      CHECK (payment_method IN ('cash_usd', 'cash_syp', 'card', 'credit', 'split'));
  END IF;
END $$;
