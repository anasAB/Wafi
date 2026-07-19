-- WAFI-122 (architecture fix, post-implementation review):
--
-- ADR-009's original mechanism embedded device_id in signInWithPassword's
-- `options: { data: { device_id } }` so the Custom Access Token Hook could
-- read it back off the session and stamp `active_role` into the JWT. This
-- was confirmed BROKEN during Task 4's implementation review, for two
-- independent reasons:
--
--   1. signInWithPassword's `options` has no `data` field at all -- that
--      shape only exists on signUp's options. The device_id claim never
--      reaches the server on sign-in; the client-side change (commit
--      6f446c9) was a no-op and has been reverted.
--   2. Even if it had reached the server, it would land in
--      `auth.users.raw_user_meta_data` -- a single column on the ONE
--      account row per shop (WAFI-119's one-account-per-shop model), not
--      per-session state. Two devices signed into the same shop account
--      would stomp each other's value.
--
-- The fix: Supabase JWTs already carry a genuine per-session `session_id`
-- claim by default -- stable across token refreshes of the same login
-- session, changing only on a brand-new sign-in. This migration re-keys
-- the whole mechanism on `session_id` instead of `device_id`, so there is
-- NO client-side claim embedding at sign-in at all; the hook reads
-- `session_id` directly out of `event.claims`, which the platform
-- populates on its own.
--
-- `device_id` (the devices.id / device_sessions PK) is kept as informational
-- device-management context -- it identifies which physical device row this
-- is, but the hook's lookup key and the RPC's session-scoping now both run
-- through the new `session_id` column instead.
--
-- See ADR-009's "Design Correction (2026-07-19, post-implementation)"
-- section for the full narrative.
--
-- LIVE-VERIFICATION FLAG: this migration has NOT been verified against a
-- live Supabase instance. It is not yet confirmed that `session_id` is
-- genuinely present in the Auth Hook's `event.claims` object, nor that the
-- client SDK's `Session` object exposes `session_id` directly (a later task
-- needs to pass it to switch_active_operator) vs. requiring the client to
-- decode its own JWT payload manually. Do not ship without confirming both
-- against a real Supabase project.

-- New lookup path. device_id remains the table's PK / device-management
-- identity; session_id is now the hook's key. Nullable because a device row
-- can exist before any session has been recorded against it.
ALTER TABLE public.device_sessions
  ADD COLUMN IF NOT EXISTS session_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS device_sessions_session_id_key
  ON public.device_sessions (session_id)
  WHERE session_id IS NOT NULL;

-- switch_active_operator: identical body to migration 046's lockout-aware
-- version (PIN re-verification, tenant boundary via devices.shop_id =
-- auth_shop_id(), fail-closed lockout check before any PIN comparison,
-- identical treatment of "staff not found" vs "PIN mismatch", lockout
-- bookkeeping) -- the ONLY change is that both upsert branches now also
-- set session_id = p_session_id, and the function takes an additional
-- p_session_id parameter.
CREATE OR REPLACE FUNCTION public.switch_active_operator(
  p_device_id  uuid,
  p_session_id uuid,
  p_staff_id   uuid,
  p_pin        text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- First-pass lockout policy constants. Tune freely; not a final policy.
  MAX_FAILED_ATTEMPTS CONSTANT integer := 5;
  LOCKOUT_DURATION     CONSTANT interval := interval '30 seconds';

  v_shop_id        uuid;
  v_pin_hash       text;
  v_pin_salt       text;
  v_role           text;
  v_computed       text;
  v_failed_attempts integer;
  v_locked_until    timestamptz;
BEGIN
  -- The device must belong to the caller's own shop -- SECURITY DEFINER
  -- bypasses RLS, so this check is the only tenant boundary inside the
  -- function body.
  SELECT d.shop_id INTO v_shop_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.shop_id = public.auth_shop_id();

  IF v_shop_id IS NULL THEN
    RETURN false;
  END IF;

  -- Fail-closed lockout check, BEFORE any PIN comparison happens. A device
  -- that has no device_sessions row yet has never failed, so it is treated
  -- as failed_attempts = 0 / locked_until = NULL (unlocked). This runs
  -- before the PIN hash is even looked up, so a locked-out caller gets
  -- identical behavior (a plain `false`) regardless of whether the staff_id
  -- or PIN it supplied would otherwise have been valid -- no timing or
  -- response-shape signal is leaked about the device's lock state.
  SELECT ds.failed_attempts, ds.locked_until
    INTO v_failed_attempts, v_locked_until
  FROM public.device_sessions ds
  WHERE ds.device_id = p_device_id;

  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN false;
  END IF;

  SELECT s.pin_hash, s.pin_salt, s.role INTO v_pin_hash, v_pin_salt, v_role
  FROM public.staff s
  WHERE s.id = p_staff_id AND s.shop_id = v_shop_id AND s.is_active;

  -- Both "staff not found / inactive" and "PIN mismatch" are treated
  -- identically below as a failed attempt, so neither the caller's response
  -- nor the lockout bookkeeping distinguishes which failure occurred.
  IF v_pin_hash IS NOT NULL THEN
    v_computed := encode(digest(coalesce(v_pin_salt, '') || p_pin, 'sha256'), 'hex');
  END IF;

  IF v_pin_hash IS NULL OR v_computed <> v_pin_hash THEN
    v_failed_attempts := coalesce(v_failed_attempts, 0) + 1;

    INSERT INTO public.device_sessions (device_id, session_id, shop_id, failed_attempts, locked_until, updated_at)
    VALUES (
      p_device_id,
      p_session_id,
      v_shop_id,
      v_failed_attempts,
      CASE WHEN v_failed_attempts >= MAX_FAILED_ATTEMPTS THEN now() + LOCKOUT_DURATION ELSE NULL END,
      now()
    )
    ON CONFLICT (device_id) DO UPDATE
      SET session_id      = p_session_id,
          failed_attempts = v_failed_attempts,
          locked_until    = CASE WHEN v_failed_attempts >= MAX_FAILED_ATTEMPTS
                                  THEN now() + LOCKOUT_DURATION
                                  ELSE NULL
                             END,
          updated_at      = now();

    RETURN false;
  END IF;

  -- Success: PIN matches and the device was not locked. Reset lockout state
  -- as part of the same upsert that records the new active operator and the
  -- current session_id.
  INSERT INTO public.device_sessions (device_id, session_id, shop_id, active_staff_id, active_role, failed_attempts, locked_until, updated_at)
  VALUES (p_device_id, p_session_id, v_shop_id, p_staff_id, v_role, 0, NULL, now())
  ON CONFLICT (device_id) DO UPDATE
    SET session_id      = excluded.session_id,
        active_staff_id = excluded.active_staff_id,
        active_role     = excluded.active_role,
        failed_attempts = 0,
        locked_until    = NULL,
        updated_at      = excluded.updated_at;

  RETURN true;
END;
$$;

-- Drop the old 3-arg signature (device_id, staff_id, pin) now superseded by
-- the 4-arg (device_id, session_id, staff_id, pin) signature above -- these
-- are different overloads by Postgres's rules (different parameter list),
-- so the old one must be explicitly removed or it remains callable and
-- never sets session_id.
DROP FUNCTION IF EXISTS public.switch_active_operator(uuid, uuid, text);

REVOKE ALL ON FUNCTION public.switch_active_operator(uuid, uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.switch_active_operator(uuid, uuid, uuid, text) TO authenticated, anon;

-- custom_access_token_hook: identical fail-closed structure to migration
-- 047 + its two review fixes (non-object claims normalized to '{}' up
-- front; exception-guarded cast+lookup falling back to 'cashier' on any
-- error) -- the ONLY change is reading `session_id` instead of `device_id`
-- out of claims, and looking up device_sessions by session_id instead of
-- device_id. session_id is a platform-populated claim already present on
-- event.claims by default; no client action is required to put it there
-- (unlike the broken device_id approach, which needed sign-in to embed it).
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims     jsonb;
  v_session  text;
  v_role     text;
BEGIN
  -- event may be missing the "claims" key entirely (SQL NULL from ->),
  -- or "claims" may be present but hold the JSON literal null, or any
  -- other non-object JSON value (scalar/array). jsonb_set requires an
  -- object (or array) target once the path is non-empty -- calling it on
  -- a JSON null or other scalar raises "cannot set path in scalar",
  -- which is NOT caught by COALESCE (jsonb '{"claims": null}' -> 'claims'
  -- returns a genuine jsonb null, not SQL NULL). Normalize any non-object
  -- value to an empty object up front so every downstream jsonb_set call
  -- is guaranteed a safe target.
  claims := event -> 'claims';
  IF claims IS NULL OR jsonb_typeof(claims) <> 'object' THEN
    claims := '{}'::jsonb;
  END IF;
  v_session := claims ->> 'session_id';

  IF v_session IS NULL THEN
    -- No session_id claim present (should not normally happen -- Supabase
    -- populates this by default -- but fail closed defensively) -- fail
    -- closed.
    claims := jsonb_set(claims, '{active_role}', '"cashier"');
    RETURN jsonb_build_object('claims', claims);
  END IF;

  -- Narrowly scoped: only the cast + lookup are guarded, so a malformed
  -- (non-UUID) session_id claim falls through to the same fail-closed
  -- 'cashier' path as a missing claim or missing row, without masking
  -- unexpected errors elsewhere in the function.
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

-- Per Supabase's Auth Hooks requirements: the auth admin role must be able to
-- execute this function, and it must NOT be callable by ordinary clients.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
