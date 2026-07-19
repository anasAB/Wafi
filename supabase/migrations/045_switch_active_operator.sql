-- WAFI-122: server-side PIN re-verification + active-operator write.
--
-- This is the ONLY writer of device_sessions.active_role. It re-implements
-- usePinAuth.ts's exact hash algorithm (sha256(salt + pin), hex) in Postgres
-- via pgcrypto's digest(), so existing staff PINs verify without requiring a
-- reset. Returns true/false rather than raising, so the client can show a
-- plain "wrong PIN" message without parsing a Postgres error string.
--
-- See docs/adr/ADR-009-server-side-financial-role-enforcement.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  v_shop_id   uuid;
  v_pin_hash  text;
  v_pin_salt  text;
  v_role      text;
  v_computed  text;
BEGIN
  -- The device must belong to the caller's own shop — SECURITY DEFINER
  -- bypasses RLS, so this check is the only tenant boundary inside the
  -- function body.
  SELECT d.shop_id INTO v_shop_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.shop_id = public.auth_shop_id();

  IF v_shop_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.pin_hash, s.pin_salt, s.role INTO v_pin_hash, v_pin_salt, v_role
  FROM public.staff s
  WHERE s.id = p_staff_id AND s.shop_id = v_shop_id AND s.is_active;

  IF v_pin_hash IS NULL THEN
    RETURN false;
  END IF;

  v_computed := encode(digest(coalesce(v_pin_salt, '') || p_pin, 'sha256'), 'hex');

  IF v_computed <> v_pin_hash THEN
    RETURN false;
  END IF;

  INSERT INTO public.device_sessions (device_id, shop_id, active_staff_id, active_role, updated_at)
  VALUES (p_device_id, v_shop_id, p_staff_id, v_role, now())
  ON CONFLICT (device_id) DO UPDATE
    SET active_staff_id = excluded.active_staff_id,
        active_role     = excluded.active_role,
        updated_at      = excluded.updated_at;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.switch_active_operator(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.switch_active_operator(uuid, uuid, text) TO authenticated, anon;
