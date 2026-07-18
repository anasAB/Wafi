-- WAFI-131: per-shop feature flags — the Option C modular-pricing enforcement
-- point (CLAUDE.md week-1 architecture decision #3).
--
-- Mechanism: a JSONB column on shops (see ADR-008). The shops row already
-- syncs to every one of the shop's devices, flags are one blob per shop, and
-- the values are set by US server-side (support tooling / SQL) — the client
-- never writes them.
--
-- Semantics (mirrored in src/features/flags/flagRegistry.ts):
--   features IS NULL        → all packs on (legacy/grandfathered row)
--   key missing from object → OFF (new features default closed for old rows)
--   key true/false          → as stated

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS features jsonb;

-- Explicit grandfathering: existing pilot shops keep everything they have.
UPDATE public.shops
   SET features = '{"staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": false}'::jsonb
 WHERE features IS NULL;

-- Clients must never flip their own pack flags. shops has no client UPDATE
-- policy today (rows are provisioned server-side); this trigger keeps the
-- column safe even if a broader shops update policy is added later.
CREATE OR REPLACE FUNCTION public.protect_shop_features()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.features IS DISTINCT FROM OLD.features AND NOT (SELECT coalesce(current_setting('request.jwt.claims', true), '') = '') THEN
    -- Any request carrying a JWT (i.e. an end-user client) may not change flags.
    NEW.features := OLD.features;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_shop_features ON public.shops;
CREATE TRIGGER trg_protect_shop_features
  BEFORE UPDATE ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.protect_shop_features();
