-- supabase/migrations/127_wafi148a_health_alerting_enabled_missing_shop_fix.sql
-- WAFI-148A test-suite fix: _health_alerting_enabled(shop_id) (migration 123)
-- documents a fail-closed contract ("NULL/missing/malformed reads as
-- false, matching list_shops_for_rollout_admin's contract exactly") but its
-- implementation only applies coalesce() to a per-row expression:
--
--   SELECT coalesce(s.features -> 'rollout' -> 'health_alerting' = 'true'::jsonb, false)
--     FROM public.shops s
--    WHERE s.id = p_shop_id;
--
-- When p_shop_id does not match any row, the FROM/WHERE produces ZERO rows,
-- so the SQL function itself returns NULL overall -- the per-row coalesce()
-- never runs. This violates the documented fail-closed contract for a
-- non-existent shop id (caught by
-- supabase/tests/wafi148a_feature_flag_gating.test.sql's "a non-existent
-- shop id reads as disabled, not an error" assertion).
--
-- Fix: wrap the row lookup in a scalar subquery so the OUTER coalesce()
-- always runs, whether or not the shop exists. No other behavior changes.
CREATE OR REPLACE FUNCTION public._health_alerting_enabled(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT s.features -> 'rollout' -> 'health_alerting' = 'true'::jsonb
       FROM public.shops s
      WHERE s.id = p_shop_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public._health_alerting_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._health_alerting_enabled(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._health_alerting_enabled(uuid) FROM authenticated;
