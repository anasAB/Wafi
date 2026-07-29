-- Fixes a regression of the exact bug migration 050 already diagnosed and
-- fixed once: custom_access_token_hook must be SECURITY DEFINER, because
-- Supabase invokes Auth Hooks as `supabase_auth_admin`, a role
-- device_sessions' RLS SELECT policy does not grant access to (`FOR SELECT
-- TO anon, authenticated`, migration 044). Without SECURITY DEFINER, the
-- hook's `SELECT active_role, active_staff_id FROM device_sessions WHERE
-- session_id = ...` is silently filtered to zero rows by RLS — no
-- exception, no error, just an empty result — so v_role/v_staff_id always
-- end up NULL and the fail-closed defaults ('cashier' / null) fire
-- unconditionally, regardless of what is actually stored.
--
-- Found live (2026-07-29): confirmed directly — a device_sessions row with
-- the exact session_id from the current JWT, active_role = 'owner', was
-- verified to exist via direct SQL query, yet the JWT it belonged to still
-- carried active_role: 'cashier'. Comparing `pg_proc.prosrc` for this
-- function against this repo's migrations showed the deployed body matches
-- migration 053's (staff_id-stamping) version byte-for-byte — but migration
-- 053's CREATE OR REPLACE FUNCTION omitted SECURITY DEFINER and SET
-- search_path entirely. CREATE OR REPLACE FUNCTION does not carry forward
-- properties (like SECURITY DEFINER) that aren't re-stated in the new
-- definition — they revert to Postgres's default (SECURITY INVOKER) — so
-- migration 053 silently undid migration 050's fix while extending the
-- function for an unrelated reason (adding the staff_id claim).
--
-- This migration is otherwise byte-for-byte identical to 053's function
-- body; the only change is restoring SECURITY DEFINER + the pinned
-- search_path, matching every other SECURITY DEFINER function in this
-- codebase's convention (e.g. switch_active_operator, bootstrap_owner_identity).

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
  v_staff_id uuid;
BEGIN
  claims := event -> 'claims';
  IF claims IS NULL OR jsonb_typeof(claims) <> 'object' THEN
    claims := '{}'::jsonb;
  END IF;
  v_session := claims ->> 'session_id';

  IF v_session IS NULL THEN
    claims := jsonb_set(claims, '{active_role}', '"cashier"');
    claims := jsonb_set(claims, '{staff_id}', 'null'::jsonb);
    RETURN jsonb_build_object('claims', claims);
  END IF;

  BEGIN
    SELECT active_role, active_staff_id INTO v_role, v_staff_id
    FROM public.device_sessions
    WHERE session_id = v_session::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_role := 'cashier';
    v_staff_id := NULL;
  END;

  IF v_role IS NULL THEN
    v_role := 'cashier';
  END IF;

  claims := jsonb_set(claims, '{active_role}', to_jsonb(v_role));
  claims := jsonb_set(claims, '{staff_id}', COALESCE(to_jsonb(v_staff_id), 'null'::jsonb));
  RETURN jsonb_build_object('claims', claims);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
