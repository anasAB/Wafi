-- supabase/migrations/098_wafi156_update_business_rule_validate_threshold.sql
-- WAFI-156: whole-branch review fix (Task 12). The original update_business_rule
-- (095) wrote p_threshold unchecked -- an owner could set a negative or NaN
-- threshold, silently defeating the rule (e.g. a negative threshold with
-- operator='gt' matches every event of that type, effectively spamming
-- notifications with no server-side guardrail; the UI's min="0" is
-- client-only and trivially bypassed via a direct RPC call). Add a server-
-- side guard, same boundary-of-truth principle as every other invariant this
-- RPC already enforces in the function body rather than trusting the client.

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

  -- WAFI-156 whole-branch review fix: reject NaN and negative thresholds here,
  -- not just via the UI's min="0" (bypassable by any direct RPC call). A
  -- negative threshold would make this rule match every event of its type
  -- regardless of the operator, defeating the entire point of a threshold.
  IF p_threshold IS NULL OR p_threshold != p_threshold OR p_threshold < 0 THEN
    RETURN 'invalid_threshold';
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
