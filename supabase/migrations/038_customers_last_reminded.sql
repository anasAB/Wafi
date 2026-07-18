-- Wafi POS — WAFI-104 (Collections Worklist): track when a customer was last
-- sent a WhatsApp collection reminder, so the worklist can sort by "recently
-- reminded last" and avoid re-nagging the same customer same-day.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;

-- SELECT * sync rule for customers (powersync.yaml) already covers new
-- columns automatically — no sync-rules change needed.
