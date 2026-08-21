-- WAFI-148: shop-local IANA timezone, required for every health-metric period
-- boundary. Nullable, no default -- defaulting every existing shop to one
-- timezone would be wrong for any shop outside Syria (WAFI accepts
-- opportunistic signups from Lebanon/Iraq/Jordan). Health metrics simply do
-- not compute for a shop until this is set via onboarding/settings.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.shops.timezone IS
  'IANA timezone name (e.g. Asia/Damascus). NULL until the owner configures it. '
  'All WAFI-148 health-metric period_start values are shop-local calendar dates '
  'derived from this column -- never UTC or device-local dates.';
