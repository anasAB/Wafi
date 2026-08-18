-- supabase/migrations/095_wafi156_update_business_rule.sql
-- WAFI-156: the only write path for business_rules. Structurally accepts just
-- name/threshold/enabled -- there is no code path by which this RPC can touch
-- event_type/field/transform/operator/action, because they are not parameters
-- (spec §2.1).

CREATE OR REPLACE FUNCTION public.update_business_rule(
  p_rule_id   uuid,
  p_name      text,
  p_threshold numeric,
  p_enabled   boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_rule  public.business_rules;
  v_shop  uuid;
BEGIN
  v_shop := public.auth_shop_id();
  IF v_shop IS NULL THEN
    RETURN 'forbidden';
  END IF;

  -- Owner-only, same helper every other domain RLS policy in this codebase
  -- uses for this exact check (e.g. 058_cash_shifts_domain_rls.sql) -- checked
  -- here in the function body, not merely gated by a UI route, so a
  -- stale/tampered client-side active_role claim can't widen who this affects
  -- beyond what the JWT itself asserts.
  IF public.auth_role() != 'owner' THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO v_rule FROM public.business_rules WHERE id = p_rule_id AND shop_id = v_shop;
  IF NOT FOUND THEN
    RETURN 'forbidden';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN 'invalid_name';
  END IF;

  UPDATE public.business_rules
    SET name = p_name, threshold = p_threshold, enabled = p_enabled, updated_at = now()
    WHERE id = p_rule_id;

  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.update_business_rule(uuid, text, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_business_rule(uuid, text, numeric, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_business_rule(uuid, text, numeric, boolean) TO authenticated;
