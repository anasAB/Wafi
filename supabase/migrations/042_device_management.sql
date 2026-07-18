-- WAFI-130: device management on top of the existing self-registration (037).
--
-- Owners get a management surface: human labels ("كاشير ١"), last-seen for
-- pruning stale rows (a cleared browser re-registers as a NEW device — PWA
-- reality), and deactivation for lost/retired devices. Deactivation is
-- enforced at shift-open: a deactivated device cannot open new shifts after
-- its next sync; an already-open shift is allowed to close first.
--
-- Expand-only, nullable/defaulted columns.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS label        text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_active    boolean NOT NULL DEFAULT true;

-- Existing RLS policies (shop-scoped select/insert/update) already cover the
-- new columns; rename/deactivate rides the devices_update_all policy.
