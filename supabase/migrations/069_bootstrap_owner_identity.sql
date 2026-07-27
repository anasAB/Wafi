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
SET search_path = public, extensions, pg_temp
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

  -- Structural guard against a blank-credential bootstrap (found in final
  -- whole-branch review): a client bug (or any future/malicious caller) can
  -- reach this function with an empty name/PIN while bootstrap_completed_at
  -- is still NULL server-side (e.g. resumePendingBootstrap() replaying a
  -- PendingBootstrap record whose RPC call never actually reached the
  -- server). Without this check, that call would sail through the gate
  -- above and permanently brick the owner account with a blank name and a
  -- PIN hash for the empty string. Reject unconditionally, regardless of
  -- which client or code path is calling.
  IF p_pin IS NULL OR p_pin = '' OR p_staff_name IS NULL OR trim(p_staff_name) = '' THEN
    RETURN 'invalid_state';
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

-- Narrower than switch_active_operator's grants (migration 045): this
-- function creates an owner identity and only ever needs to run for a
-- signed-in owner post-signup -- auth_shop_id() resolves to NULL for an
-- unauthenticated (anon) caller, so anon would always get 'invalid_state'
-- anyway, but there's no reason to grant EXECUTE on an identity-creating
-- SECURITY DEFINER function to anon when nothing legitimate ever calls it
-- that way (flagged in final whole-branch review, 2026-07-27).
-- REVOKE ALL FROM public only revokes the implicit public-role grant; it
-- does NOT revoke the explicit `TO anon` grant this function's original
-- version made. Re-runnable environments (like production, where an
-- earlier version of this migration already ran) need that explicit grant
-- pulled back too, or the anon EXECUTE right silently survives a
-- CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) TO authenticated;
