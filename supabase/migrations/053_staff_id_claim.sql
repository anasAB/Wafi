-- supabase/migrations/053_staff_id_claim.sql
-- WAFI-122: extend custom_access_token_hook (047/048) to also stamp a
-- staff_id claim, read from the same device_sessions row already looked up
-- for active_role -- one lookup, two claims, so they can never drift apart.
-- Fail-closed: staff_id defaults to JSON null (no staff identity) on any
-- miss, matching active_role's existing fail-closed 'cashier' default.
--
-- IMPORTANT: jsonb_set(target, path, new_value) returns SQL NULL for the
-- WHOLE jsonb value if new_value itself is SQL NULL (not JSON null) -- the
-- same trap migration 047's header comment already documents for the
-- claims-normalization step. to_jsonb(NULL::uuid) returns SQL NULL, so it
-- must be wrapped in COALESCE(..., 'null'::jsonb) before every jsonb_set
-- call below, or a missing staff_id would silently blank out ALL claims.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
