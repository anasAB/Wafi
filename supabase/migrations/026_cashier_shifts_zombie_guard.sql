-- Wafi POS — WAFI-065 (zombie open shifts): finishes the skipped Epic 5 guards
-- around `cashier_shifts`. Two independent, idempotent changes on one table → one
-- migration.
--
-- Part 1 — one open shift per device (backstop):
--   openShift() now checks for an existing open shift on the device before
--   inserting (app-level, primary — offline-first can't rely on a server constraint
--   at write time). This partial unique index is the server-side backstop for
--   anything that slips through on sync: a single device may hold AT MOST one 'open'
--   shift. It is intentionally PER DEVICE — two *different* devices each holding an
--   open shift is normal; the bug is one device with two. Closed/abandoned rows are
--   excluded by the WHERE clause, so a device accumulates unlimited history, only
--   never two simultaneously-open rows.
--   On sync apply, a duplicate forced through offline is rejected here; the client
--   upload queue must tolerate that rejection without stalling (WAFI-015).
--
-- Part 4 — 'abandoned' status (schema only):
--   Reserve a distinct status for truly orphaned shifts so they are NEVER recorded
--   as a fake 'closed' with fabricated cash. Abandoned shifts carry no counted
--   cash/variance and are excluded from revenue/variance analytics. Nothing is
--   auto-abandoned here — this only widens the CHECK so the value is legal when a
--   future, PO-approved sweep (or a documented one-off) sets it.

-- Part 4: widen the status enum. The inline CHECK from migration 009 is named
-- `cashier_shifts_status_check`; drop-if-exists then re-add so this is re-runnable.
ALTER TABLE public.cashier_shifts
  DROP CONSTRAINT IF EXISTS cashier_shifts_status_check;
ALTER TABLE public.cashier_shifts
  ADD CONSTRAINT cashier_shifts_status_check
  CHECK (status IN ('open', 'closed', 'abandoned'));

-- Part 1: at most one open shift per device.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_shifts_one_open_per_device
  ON public.cashier_shifts (device_id)
  WHERE status = 'open';

COMMENT ON INDEX public.uq_cashier_shifts_one_open_per_device IS
  'WAFI-065: a device may hold at most one open shift (partial unique). Backstop to the app-level guard in openShift(); different devices may each hold one open shift.';
