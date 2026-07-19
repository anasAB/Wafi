-- WAFI-122 (review finding): server-side attempt-lockout for switch_active_operator.
--
-- Code review of Task 2 found that switch_active_operator() (migration 045) is
-- a network-exposed PIN-verification endpoint: it is callable directly over
-- Supabase's RPC endpoint by any authenticated/anon client, and PINs are only
-- 4 digits (10,000 combinations). The client-side usePinLockout throttle does
-- nothing against a scripted attacker calling the RPC directly, since it was
-- designed for a threat model where PIN verification never left the device.
-- This migration adds fail-closed lockout state enforced INSIDE the function
-- itself, so it cannot be bypassed by a client that skips its own throttle.
--
-- Policy (first pass, tunable later): after MAX_FAILED_ATTEMPTS (5) consecutive
-- failed attempts for a device, lock that device out for LOCKOUT_DURATION
-- (30 seconds). These numbers are not a final security policy -- just a
-- reasonable starting point that stops naive scripted brute force.
--
-- See docs/adr/ADR-009-server-side-financial-role-enforcement.md.

ALTER TABLE public.device_sessions
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    timestamptz;

CREATE OR REPLACE FUNCTION public.switch_active_operator(
  p_device_id uuid,
  p_staff_id  uuid,
  p_pin       text
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

    INSERT INTO public.device_sessions (device_id, shop_id, failed_attempts, locked_until, updated_at)
    VALUES (
      p_device_id,
      v_shop_id,
      v_failed_attempts,
      CASE WHEN v_failed_attempts >= MAX_FAILED_ATTEMPTS THEN now() + LOCKOUT_DURATION ELSE NULL END,
      now()
    )
    ON CONFLICT (device_id) DO UPDATE
      SET failed_attempts = v_failed_attempts,
          locked_until    = CASE WHEN v_failed_attempts >= MAX_FAILED_ATTEMPTS
                                  THEN now() + LOCKOUT_DURATION
                                  ELSE NULL
                             END,
          updated_at      = now();

    RETURN false;
  END IF;

  -- Success: PIN matches and the device was not locked. Reset lockout state
  -- as part of the same upsert that records the new active operator.
  INSERT INTO public.device_sessions (device_id, shop_id, active_staff_id, active_role, failed_attempts, locked_until, updated_at)
  VALUES (p_device_id, v_shop_id, p_staff_id, v_role, 0, NULL, now())
  ON CONFLICT (device_id) DO UPDATE
    SET active_staff_id = excluded.active_staff_id,
        active_role     = excluded.active_role,
        failed_attempts = 0,
        locked_until    = NULL,
        updated_at      = excluded.updated_at;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.switch_active_operator(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.switch_active_operator(uuid, uuid, text) TO authenticated, anon;
