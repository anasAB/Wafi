-- supabase/migrations/062_configuration_domain_rls.sql
-- WAFI-122: Configuration domain -- receipt_settings, exchange_rates,
-- shop_feature_flags, shops. All writes owner-only.
--
-- Discovery (no live DB access available; confirming via schema inspection
-- of migrations 001, 009, 041):
-- - receipt_settings created in 009; migration 015 gave it broad scoped policies
-- - exchange_rates created in 001; migration 015 gave it broad scoped policies
-- - shop_feature_flags: NOT a separate table (migration 041 adds a features
--   JSONB column to shops instead). shops itself has NO client write policies
--   today (rows are provisioned server-side); migration 041 protects the
--   features column via trigger. No new policy needed.
-- - shops: NOT in migration 015's policy loop. Has no write policies today.
--   No new policy needed.

DROP POLICY IF EXISTS receipt_settings_select_all ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_insert_all ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_update_all ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_delete_all ON public.receipt_settings;

CREATE POLICY receipt_settings_select_all ON public.receipt_settings
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS receipt_settings_insert_owner ON public.receipt_settings;
CREATE POLICY receipt_settings_insert_owner ON public.receipt_settings
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');
DROP POLICY IF EXISTS receipt_settings_update_owner ON public.receipt_settings;
CREATE POLICY receipt_settings_update_owner ON public.receipt_settings
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner')
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');

DROP POLICY IF EXISTS exchange_rates_select_all ON public.exchange_rates;
DROP POLICY IF EXISTS exchange_rates_insert_all ON public.exchange_rates;
DROP POLICY IF EXISTS exchange_rates_update_all ON public.exchange_rates;
DROP POLICY IF EXISTS exchange_rates_delete_all ON public.exchange_rates;

CREATE POLICY exchange_rates_select_all ON public.exchange_rates
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS exchange_rates_insert_owner ON public.exchange_rates;
CREATE POLICY exchange_rates_insert_owner ON public.exchange_rates
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');
-- No UPDATE/DELETE policy: exchange_rates history is append-only -- each
-- rate change is a new row, which is what makes the rate-lock invariant
-- auditable (design spec §5.8).
