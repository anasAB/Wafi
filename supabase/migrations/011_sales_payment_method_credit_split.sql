-- Wafi POS — Allow 'credit', 'split' and 'installment' as sales.payment_method values.
--
-- Migration 009 added is_credit / is_split columns and the app (usePayment.ts)
-- writes payment_method = 'credit' for آجل sales and 'split' for multi-tender
-- sales. But the original CHECK from 001 only allowed cash_usd/cash_syp/card,
-- so every credit/split sale was rejected on upload (Postgres 23514) and — with
-- the throw-on-error upload connector — wedged the entire PowerSync upload queue.
--
-- 'installment' included here too: production (the brother's shop, ahead of this
-- migration ever being formally pushed there — see WAFI-001 closeout, 2026-07-26)
-- was found to have a hand-patched `sales_payment_method_check3` constraint already
-- permitting 'installment' for an existing sale row, with no migration file ever
-- having captured that change. This migration is written to match that reality
-- (and the installment_plans feature, migration 033) rather than reintroduce a
-- stricter constraint that would reject an already-live, legitimate value.
--
-- Safe: only swaps CHECK constraints, touches no data. Re-runnable, and reconciles
-- ANY previously-applied name for this constraint (original, check2, or the
-- undocumented hand-patched check3) down to one canonical definition.

DO $$
BEGIN
  -- Drop every known prior name for this constraint, whichever happen to exist,
  -- so re-running this file always converges on one canonical constraint instead
  -- of accumulating redundant ANDed CHECKs.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_payment_method_check'
  ) THEN
    ALTER TABLE public.sales DROP CONSTRAINT sales_payment_method_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_payment_method_check3'
  ) THEN
    ALTER TABLE public.sales DROP CONSTRAINT sales_payment_method_check3;
  END IF;

  -- Add the widened constraint if it isn't already there.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_payment_method_check2'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_payment_method_check2
      CHECK (payment_method IN ('cash_usd', 'cash_syp', 'card', 'credit', 'split', 'installment'));
  END IF;
END $$;
