-- WAFI-122: per-device active-operator role state.
--
-- device_sessions holds, for each registered device, which staff role is
-- CURRENTLY active on it (per PIN switch). This is server-only state — it is
-- never synced to any client (not in schema.ts, not in powersync.yaml) and is
-- written by exactly one function: switch_active_operator() (migration 045),
-- which re-verifies the staff PIN server-side before writing. No other write
-- path may ever touch active_role.
--
-- See docs/adr/ADR-009-server-side-financial-role-enforcement.md.

CREATE TABLE IF NOT EXISTS public.device_sessions (
  device_id       uuid PRIMARY KEY REFERENCES public.devices(id),
  shop_id         uuid NOT NULL,
  active_staff_id uuid REFERENCES public.staff(id),
  active_role     text NOT NULL DEFAULT 'cashier'
                    CHECK (active_role IN ('owner', 'manager', 'cashier')),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_shop ON public.device_sessions (shop_id);

-- RLS: readable/writable only by the owning shop's account, mirroring every
-- other table's auth_shop_id() scoping (migration 015). Note this RLS is
-- belt-and-suspenders only — the RPC in migration 045 is SECURITY DEFINER and
-- bypasses RLS internally, so RLS here protects against any other client
-- attempting a raw read/write, not the RPC's own operation.
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_sessions_select_own_shop ON public.device_sessions;
CREATE POLICY device_sessions_select_own_shop ON public.device_sessions
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));

-- No INSERT/UPDATE/DELETE policy for anon/authenticated: every write goes
-- through switch_active_operator() (SECURITY DEFINER), which is not subject
-- to RLS. This table has zero client-writable columns by design.
