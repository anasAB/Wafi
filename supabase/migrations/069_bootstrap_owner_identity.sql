-- supabase/migrations/069_bootstrap_owner_identity.sql
-- Fixes a launch-blocking circular bootstrap bug: a brand-new self-serve
-- owner's `staff` row and first `devices` row are created client-side
-- (offline-first), but uploading either to Supabase requires
-- auth_role() = 'owner', which is only ever set by switch_active_operator()
-- succeeding -- which itself requires those same rows to already exist
-- server-side. Fully circular; confirmed via live reproduction in
-- production, 2026-07-26. See
-- docs/superpowers/specs/2026-07-26-owner-bootstrap-rpc-design.md for the
-- full design and rationale (including why this is a dedicated RPC, not a
-- relaxed RLS policy, and why the gate is an explicit completion marker
-- rather than staff.role='owner' existence).

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS bootstrap_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.bootstrap_owner_identity(
  p_device_id  uuid,
  p_staff_id   uuid,
  p_staff_name text,
  p_pin        text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id  uuid;
  v_code     text;
  v_salt     text;
  v_hash     text;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RETURN 'invalid_state';
  END IF;

  -- Idempotency / retry safety: gated on the explicit completion marker,
  -- not on staff.role, so this stays meaningful even if WAFI later grows
  -- ownership transfer, co-owners, or imported shops (see design doc).
  IF EXISTS (
    SELECT 1 FROM public.shops
    WHERE id = v_shop_id AND bootstrap_completed_at IS NOT NULL
  ) THEN
    RETURN 'already_bootstrapped';
  END IF;

  v_code := public.allocate_device_code(v_shop_id);
  v_salt := encode(gen_random_bytes(16), 'hex');
  -- Same hash formula switch_active_operator() (migration 045) verifies
  -- against, so a PIN set here works immediately for a normal operator
  -- switch later.
  v_hash := encode(digest(v_salt || p_pin, 'sha256'), 'hex');

  INSERT INTO public.devices (id, shop_id, code, is_temporary, registered_at, sync_status)
  VALUES (p_device_id, v_shop_id, v_code, false, now(), 'synced')
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    -- Owner permissions are never client-supplied -- hardcoded to the same
    -- all-true set as OWNER_PERMISSIONS in src/features/staff/staff.types.ts.
    INSERT INTO public.staff (id, shop_id, name, pin_hash, pin_salt, role, permissions, is_active, created_at)
    VALUES (
      p_staff_id, v_shop_id, p_staff_name, v_hash, v_salt, 'owner',
      '{"can_view_reports":true,"can_manage_products":true,"can_manage_customers":true,'
      '"can_view_expenses":true,"can_manage_settings":true,"can_manage_inventory":true,'
      '"can_manage_suppliers":true,"can_manage_stock_take":true,"can_view_staff_ledger":true}',
      true, now()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      -- Two concurrent bootstrap calls (e.g. a double-tap firing overlapping
      -- requests) can both pass the completion-marker gate above before
      -- either commits. Only one INSERT into public.staff can satisfy
      -- uq_staff_one_active_owner_per_shop (partial unique index on
      -- shop_id WHERE role='owner' AND is_active=true, migration 003); the
      -- loser hits unique_violation here instead of raising to the caller.
      -- This guards ONLY that specific index race on the staff INSERT --
      -- it must not be relied on to catch unique_violation from any other
      -- constraint (e.g. uq_device_code_per_shop on public.devices), which
      -- would be a distinct bug and should propagate to the caller instead
      -- of being misreported as 'already_bootstrapped'.
      RETURN 'already_bootstrapped';
  END;

  INSERT INTO public.device_sessions (device_id, shop_id, active_staff_id, active_role, updated_at)
  VALUES (p_device_id, v_shop_id, p_staff_id, 'owner', now())
  ON CONFLICT (device_id) DO UPDATE
    SET active_staff_id = excluded.active_staff_id,
        active_role     = excluded.active_role,
        updated_at      = excluded.updated_at;

  UPDATE public.shops SET bootstrap_completed_at = now() WHERE id = v_shop_id;

  RETURN 'success';
END;
$$;

-- Mirrors switch_active_operator's grants exactly (migration 045).
REVOKE ALL ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) TO authenticated, anon;
