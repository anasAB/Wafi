-- supabase/migrations/114_wafi148_timezone_confirmed_at.sql
-- WAFI-148 follow-up: shops.timezone was assumed by this whole feature's
-- design to be nullable/no-default so its NULL-ness could signal "not yet
-- configured." Discovered while designing the onboarding UI: shops.timezone
-- has actually been NOT NULL DEFAULT 'UTC' since migration 084
-- (WAFI-151) -- migration 106's `ADD COLUMN IF NOT EXISTS` was therefore a
-- silent no-op, and every "IF v_timezone IS NULL" gate throughout this
-- feature (108/109/110/113, plus the client) has been dead code that could
-- never fire.
--
-- Fix: a shop's timezone can never actually be observed as unconfigured via
-- NULL, so we can't use NULL as the signal. Add an explicit confirmation
-- marker instead. timezone_confirmed_at IS NOT NULL becomes the single
-- canonical "is this shop's timezone actually configured" predicate,
-- everywhere -- replacing every prior `timezone IS NULL` check.
--
-- Existing shops are NOT backfilled to "confirmed": we have no way to know
-- whether their current 'UTC' value was ever actually chosen, so treating it
-- as confirmed would risk silently computing health metrics in the wrong
-- zone for exactly the shops this distinction exists to protect. Every
-- pre-existing shop starts unconfirmed and is prompted via bootstrap/settings.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS timezone_confirmed_at timestamptz;

COMMENT ON COLUMN public.shops.timezone_confirmed_at IS
  'Set only when the owner has explicitly confirmed/chosen shops.timezone '
  '(via confirm_shop_timezone(), at bootstrap or in Shop Settings). NULL means '
  'the current timezone value -- even if it happens to be the inherited '
  '''UTC'' default -- has never been explicitly confirmed. This column, not '
  'timezone IS NULL (which can never be true -- the column is NOT NULL '
  'DEFAULT ''UTC'' since migration 084), is the canonical predicate for '
  '"is this shop ready for WAFI-148 health-metric computation."';
