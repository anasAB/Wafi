-- Wafi POS — Epic 5 remediation (WAFI-059 + WAFI-060): one forward migration that
-- closes two cashier_shifts gaps at once (shared table → one migration, per the
-- remediation plan's "as few forward migrations as possible" note).
--
-- WAFI-059 — dual-currency opening cash:
--   migration 009 captured opening_cash_usd only. SYP is the PRIMARY currency for
--   Syrian shops (Sacred Rule #2), so without opening_cash_syp every shift's SYP
--   variance is computed against a missing baseline. Add it NOT NULL DEFAULT 0 so
--   pre-existing open shifts stay valid (their historic SYP open is unknowable —
--   we do NOT back-fill a fake number; 0 + the "default" flag is honest).
--
-- WAFI-060 — immutable shift-close evidence:
--   closeShift() wrote only status/closed_at/closing_cash_*. With no place to store
--   the variance, the >5% mandatory-note flow was impossible, and the Z-report was
--   recomputed from live data on every view — so a later product/price/rate edit
--   retroactively rewrote a historical Z-report. These columns let close persist an
--   immutable snapshot (the figures are read back, never recomputed, for closed
--   shifts). force_closed_by is added here (nullable) because WAFI-065 owns the
--   force-close path but shares this table — adding it now avoids a second migration.
--
-- Expand-only + idempotent: ADD COLUMN IF NOT EXISTS only; no data touched.

ALTER TABLE public.cashier_shifts
  ADD COLUMN IF NOT EXISTS opening_cash_syp NUMERIC(14,0) NOT NULL DEFAULT 0
    CHECK (opening_cash_syp >= 0),
  ADD COLUMN IF NOT EXISTS variance_usd     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS variance_syp     NUMERIC(14,0),
  ADD COLUMN IF NOT EXISTS close_note       TEXT,
  ADD COLUMN IF NOT EXISTS force_closed_by  UUID REFERENCES public.staff(id),
  ADD COLUMN IF NOT EXISTS z_report_data    JSONB;

COMMENT ON COLUMN public.cashier_shifts.opening_cash_syp IS
  'Opening cash counted in SYP (primary currency). NOT NULL DEFAULT 0; rows predating WAFI-059 default to 0 (not back-filled — historic SYP open is unknowable).';
COMMENT ON COLUMN public.cashier_shifts.z_report_data IS
  'Immutable Z-report snapshot captured at close (WAFI-060). Read back verbatim for closed shifts — never recomputed — so a later product/price/exchange-rate edit cannot rewrite a historical Z-report.';
COMMENT ON COLUMN public.cashier_shifts.close_note IS
  'Cashier note required when |variance| exceeds 5% at close (WAFI-060 / Story 5.5).';
COMMENT ON COLUMN public.cashier_shifts.force_closed_by IS
  'Owner/manager who force-closed a zombie shift (WAFI-065). NULL for normal closes.';
