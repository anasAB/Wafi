-- WAFI-003: remote sign-out. Folds into the existing device-deactivation
-- toggle (useDevices.ts::setActive) rather than adding a separate button --
-- deactivating a device now also revokes its actual Supabase Auth session,
-- not just the soft is_active flag it previously only enforced at its next
-- shift-open after sync.
--
-- No schema change: device_sessions.session_id already exists (migration
-- 048), populated by switch_active_operator() on every PIN switch. But
-- establishOperatorIdentity's offline-same-identity shortcut (WAFI-203)
-- returns without calling switch_active_operator when the same operator
-- resumes on an already-trusted device, so session_id can go stale across a
-- sign-out/sign-in cycle. record_device_session_id() keeps it fresh on
-- every sign-in, independent of PIN-switch activity.
--
-- See docs/superpowers/specs/2026-07-22-wafi-003-device-remote-signout-design.md.

CREATE OR REPLACE FUNCTION public.record_device_session_id(
  p_device_id  uuid,
  p_session_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT d.shop_id INTO v_shop_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.shop_id = public.auth_shop_id();

  IF v_shop_id IS NULL THEN
    RETURN;  -- not this account's device; silently no-op, mirrors switch_active_operator's fail-closed style
  END IF;

  INSERT INTO public.device_sessions (device_id, shop_id, session_id, updated_at)
  VALUES (p_device_id, v_shop_id, p_session_id, now())
  ON CONFLICT (device_id) DO UPDATE
    SET session_id = excluded.session_id,
        updated_at = excluded.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_device_session_id(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.record_device_session_id(uuid, uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.revoke_device_session(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id    uuid;
  v_session_id uuid;
BEGIN
  SELECT d.shop_id INTO v_shop_id
  FROM public.devices d
  WHERE d.id = p_device_id AND d.shop_id = public.auth_shop_id();

  IF v_shop_id IS NULL THEN
    RETURN;  -- not this account's device
  END IF;

  SELECT ds.session_id INTO v_session_id
  FROM public.device_sessions ds
  WHERE ds.device_id = p_device_id;

  IF v_session_id IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE id = v_session_id;
  END IF;
  -- v_session_id NULL means this device has no device_sessions row yet
  -- (never switched an operator, never called record_device_session_id) --
  -- nothing to revoke, not an error.
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_device_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_device_session(uuid) TO authenticated, anon;
