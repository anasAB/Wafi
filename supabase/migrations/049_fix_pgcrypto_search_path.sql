-- WAFI-122: fix pgcrypto search_path — found via LIVE testing (Task 9's
-- two-session isolation test), not a code-read exercise.
--
-- switch_active_operator failed on the hosted Supabase project with:
--   "function digest(text, unknown) does not exist" (Postgres error 42883)
--
-- Cause: on Supabase-hosted projects, `CREATE EXTENSION pgcrypto` installs
-- its functions into the `extensions` schema, not `public` — this is
-- Supabase's own default/enforced behavior, not something migration 045's
-- plain `CREATE EXTENSION IF NOT EXISTS pgcrypto;` controls. The function's
-- `SET search_path = public, pg_temp` therefore never resolves `digest()`,
-- even though the extension is genuinely installed. This is invisible to
-- any code-read review and only surfaces against a real Supabase instance
-- (exactly what happened here).
--
-- Fix: add `extensions` to the function's search_path so `digest()` resolves
-- regardless of which schema Supabase installed pgcrypto into.

CREATE OR REPLACE FUNCTION public.switch_active_operator(
  p_device_id  uuid,
  p_session_id uuid,
  p_staff_id   uuid,
  p_pin        text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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

  -- Fail-closed lockout check, BEFORE any PIN comparison happens.
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

REVOKE ALL ON FUNCTION public.switch_active_operator(uuid, uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.switch_active_operator(uuid, uuid, uuid, text) TO authenticated, anon;
