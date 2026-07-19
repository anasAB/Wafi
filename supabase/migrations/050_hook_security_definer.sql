-- WAFI-122: fix custom_access_token_hook's RLS visibility — found via LIVE
-- testing (Task 9's two-session isolation test), not a code-read exercise.
--
-- Reproduced live: switch_active_operator correctly wrote
-- device_sessions.active_role = 'owner' for the caller's session_id
-- (confirmed by direct Table Editor inspection immediately after), but the
-- very next minted access token (issued ~0.3s later) still carried
-- active_role = 'cashier'. This ruled out a timing/race explanation.
--
-- Cause: custom_access_token_hook was declared LANGUAGE plpgsql STABLE only
-- -- NOT SECURITY DEFINER. Without SECURITY DEFINER, the function runs with
-- the INVOKER's privileges. Supabase invokes Auth Hooks as `supabase_auth_admin`,
-- which is not among the roles device_sessions' RLS SELECT policy grants
-- access to (`FOR SELECT TO anon, authenticated`, migration 044). So the
-- hook's `SELECT active_role FROM device_sessions WHERE session_id = ...`
-- was being silently blocked by RLS, returning zero rows every time --
-- `v_role` always ended up NULL and the fail-closed default ('cashier')
-- fired unconditionally, regardless of what was actually stored.
--
-- Fix: make the hook SECURITY DEFINER, owned by a role that bypasses RLS
-- (the migration-running role, matching every other SECURITY DEFINER
-- function in this codebase, e.g. switch_active_operator itself), with a
-- pinned search_path per this repo's existing SECURITY DEFINER convention.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claims     jsonb;
  v_session  text;
  v_role     text;
BEGIN
  claims := event -> 'claims';
  IF claims IS NULL OR jsonb_typeof(claims) <> 'object' THEN
    claims := '{}'::jsonb;
  END IF;
  v_session := claims ->> 'session_id';

  IF v_session IS NULL THEN
    claims := jsonb_set(claims, '{active_role}', '"cashier"');
    RETURN jsonb_build_object('claims', claims);
  END IF;

  BEGIN
    SELECT active_role INTO v_role
    FROM public.device_sessions
    WHERE session_id = v_session::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_role := 'cashier';
  END;

  IF v_role IS NULL THEN
    v_role := 'cashier';
  END IF;

  claims := jsonb_set(claims, '{active_role}', to_jsonb(v_role));
  RETURN jsonb_build_object('claims', claims);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
