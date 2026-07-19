-- WAFI-122: Custom Access Token Hook — stamps active_role into every minted
-- JWT for a session that has already embedded a device_id claim (embedded
-- once at sign-in, see Task 4's client change). Fails closed to 'cashier' on
-- any lookup miss, per ADR-009's Architecture Guidelines.
--
-- Supabase's Auth Hooks contract: the function receives `event` shaped as
-- { "user_id": "<uuid>", "claims": { ...existing claims incl. any prior
-- device_id... } } and must return { "claims": { ...same shape, mutated } }.
-- This function must be registered in the Supabase Dashboard under
-- Authentication → Hooks → Customize Access Token (JWT) Claims — see Task 3
-- Step 3 (migration 047, superseding the plan's original 046 reference,
-- which was reassigned to an unplanned review-fix migration); the SQL alone
-- does nothing until that dashboard wiring exists.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims     jsonb;
  v_device   text;
  v_role     text;
BEGIN
  claims := event -> 'claims';
  v_device := claims ->> 'device_id';

  IF v_device IS NULL THEN
    -- No device_id claim yet on this session (e.g. first token before the
    -- client has completed device registration) — fail closed.
    claims := jsonb_set(claims, '{active_role}', '"cashier"');
    RETURN jsonb_build_object('claims', claims);
  END IF;

  SELECT active_role INTO v_role
  FROM public.device_sessions
  WHERE device_id = v_device::uuid;

  IF v_role IS NULL THEN
    v_role := 'cashier';
  END IF;

  claims := jsonb_set(claims, '{active_role}', to_jsonb(v_role));
  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Per Supabase's Auth Hooks requirements: the auth admin role must be able to
-- execute this function, and it must NOT be callable by ordinary clients.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
