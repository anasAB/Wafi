-- Fixes a login-blocking chicken-and-egg bug found live 2026-07-29: a new
-- device's `devices` row was self-registered via a plain client-side INSERT,
-- subject to `devices_insert_owner` RLS (055_identity_domain_rls.sql) --
-- owner-only. But `switch_active_operator()` (045) requires the `devices`
-- row to already exist server-side, and `active_role` only becomes
-- `'owner'` AFTER `switch_active_operator()` succeeds. For any device
-- without an already-registered code, that's a hard circular dependency:
-- registration needs `active_role='owner'`, which needs registration to
-- have already happened. A prior attempt to gate the client-side INSERT
-- behind `active_role='owner'` (client-only, no RPC) turned this from
-- "spurious 403, dead-lettered" into "login permanently blocked" and was
-- reverted in full.
--
-- Fix: register the device through a SECURITY DEFINER RPC, mirroring
-- bootstrap_owner_identity() (069) and record_device_session_id() (067) --
-- bypasses devices' owner-only RLS entirely, so it works for ANY
-- authenticated member of the shop regardless of active_role. This is safe
-- because the function only ever creates a new row scoped to the CALLER's
-- OWN shop (via auth_shop_id()) with a server-allocated code -- it grants no
-- ability to read or modify another device or another shop's rows, which is
-- the actual thing the owner-only RLS on this table exists to prevent.

CREATE OR REPLACE FUNCTION public.register_device(
  p_device_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id uuid;
  v_code    text;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Idempotent retry: a network blip can ack server-side while the client
  -- never sees the response; a retry with the same p_device_id must return
  -- the already-allocated code rather than erroring or allocating a second
  -- one for the same physical device.
  SELECT code INTO v_code FROM public.devices WHERE id = p_device_id AND shop_id = v_shop_id;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  v_code := public.allocate_device_code(v_shop_id);

  INSERT INTO public.devices (id, shop_id, code, is_temporary, registered_at, sync_status)
  VALUES (p_device_id, v_shop_id, v_code, false, now(), 'synced')
  ON CONFLICT (id) DO NOTHING;

  RETURN v_code;
END;
$$;

-- authenticated only: an unauthenticated (anon) caller always resolves
-- auth_shop_id() to NULL anyway (returning NULL, never a real code), so
-- there's no reason to grant EXECUTE to anon -- same reasoning
-- bootstrap_owner_identity's REVOKE FROM anon documents (069).
REVOKE ALL ON FUNCTION public.register_device(uuid) FROM public;
REVOKE ALL ON FUNCTION public.register_device(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_device(uuid) TO authenticated;
