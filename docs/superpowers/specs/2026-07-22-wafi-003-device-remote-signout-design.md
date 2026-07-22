# WAFI-003: Self-Serve Device Registration — Remote Sign-Out Design

**Date:** 2026-07-22
**Status:** Approved
**Ticket:** WAFI-003 (P0, "Multi-device, device codes, remote sign-out")

## Context

Investigation before this design found multi-device registration, device
codes, and a self-serve owner-facing device list (`DevicesScreen.vue`) all
already work — see the exploration summary in the brainstorming conversation.
The one gap against the ticket's stated scope is **remote sign-out**: what
exists today (`useDevices.ts::setActive`) only flips a soft `is_active` flag
that a device notices at its *next shift-open after its next sync* — there is
no mechanism to actually invalidate a device's active login.

**Auth model this design depends on** (confirmed): every device in a shop
signs in with the *same* owner Supabase Auth account (email/password via
`LoginPage.vue`) — device identity is a separately-registered `code`
(`devices` table), not a separate Supabase Auth account. Staff identity on
top of that is the PIN layer (`useOperatorSwitch.ts`), unrelated to this
design.

Despite the shared login, Supabase Auth (GoTrue) still creates one row in
`auth.sessions` per sign-in — i.e. per device, since each device calls
`signInWithPassword` independently. Deleting that row invalidates that
specific device's refresh token without touching any other device's session,
even though they're all the same account. This is the mechanism this design
uses.

## Decisions from brainstorming

1. **Urgency:** the target device discovering it's signed out the next time
   it's online (via a failed token refresh) is sufficient — no push/realtime
   infrastructure. Matches the app's offline-first philosophy; a
   lost/stolen device is not usually actively online during the window that
   matters.
2. **UI:** fold into the existing deactivate toggle in `DevicesScreen.vue` /
   `useDevices.ts::setActive` rather than adding a second, confusingly
   similar button.

## What's changing

### 1. New migration: `067_device_session_revocation.sql`

Following the exact pattern of `045_switch_active_operator.sql` (tenant
check via `d.shop_id = public.auth_shop_id()`, `SECURITY DEFINER`, `REVOKE
ALL ... GRANT EXECUTE TO authenticated, anon` at the end):

**Schema change:** add `auth_session_id uuid` to `device_sessions`
(migration 044). This table is already server-only — not in `schema.ts`, not
in `powersync.yaml`, RLS-locked to owner-read-only with zero client write
policies (migration 044's own comment: "This is server-only state"). The
`devices` table itself is `SELECT *`-synced to every device in the shop
(confirmed in `powersync.yaml:41`), so `auth_session_id` must **not** go
there — every other device would receive it.

**Function 1 — `record_device_session(p_device_id uuid)` returns void:**
called by a device to record its own current Supabase Auth session id.
GoTrue JWTs include a native `session_id` claim (no custom
`custom_access_token_hook` change needed — confirmed against the existing
`auth.jwt()` pattern in migration 054).

```sql
CREATE OR REPLACE FUNCTION public.record_device_session(p_device_id uuid)
RETURNS void
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

  INSERT INTO public.device_sessions (device_id, shop_id, auth_session_id, updated_at)
  VALUES (p_device_id, v_shop_id, NULLIF(auth.jwt() ->> 'session_id', '')::uuid, now())
  ON CONFLICT (device_id) DO UPDATE
    SET auth_session_id = excluded.auth_session_id,
        updated_at      = excluded.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_device_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.record_device_session(uuid) TO authenticated, anon;
```

Note: this `INSERT ... ON CONFLICT DO UPDATE` only ever touches
`auth_session_id`/`updated_at` — it must not clobber `active_staff_id`/
`active_role` written by `switch_active_operator`. The `excluded` columns
referenced are exactly `auth_session_id`/`updated_at`, so this is safe by
construction as long as the `INSERT` column list omits
`active_staff_id`/`active_role` (Postgres fills omitted columns with their
existing value on conflict only if the column has a default — since
`active_role` has `NOT NULL DEFAULT 'cashier'`, a first-ever insert from
this function would set it to the default rather than leaving it unset;
this is fine because this function's `INSERT` only fires when no
`device_sessions` row exists yet for that device, i.e. before any operator
has ever switched — in that case there is no `active_role` to preserve).

**Function 2 — `revoke_device_session(p_device_id uuid)` returns void:**
owner-only (implicitly, since it requires the caller's `auth_shop_id()` to
own the device — same tenant check as above), deletes the target device's
`auth.sessions` row.

```sql
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

  SELECT ds.auth_session_id INTO v_session_id
  FROM public.device_sessions ds
  WHERE ds.device_id = p_device_id;

  IF v_session_id IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE id = v_session_id;
  END IF;
  -- v_session_id NULL means this device never signed in (or never called
  -- record_device_session) -- nothing to revoke, not an error.
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_device_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_device_session(uuid) TO authenticated, anon;
```

Both functions are callable by any authenticated device on the shop (not
just the owner's *active PIN role*), because — same as `switch_active_operator`
— tenant isolation is enforced by `auth_shop_id()`, and the ticket's existing
trust model already treats every device signed into the shop's account as
equally trusted at the Supabase Auth layer. Staff-role restriction on who can
reach this feature already exists at the client-UI layer: `/settings/devices`
(`src/router/index.ts:53`) has no permission of its own, but inherits
`can_manage_settings` from its parent `/settings` route (the router's own
comment confirms child routes merge parent meta) — so a staffer without that
permission cannot even open `DevicesScreen.vue`. No new permission check is
needed for this design.

### 2. Client: record the session on sign-in

In `src/store/device.store.ts`, the existing `onAuthStateChange` handler's
`SIGNED_IN` branch (which already resolves `shopId` via `refreshShopId()`)
gets one more call after `ensureDeviceRegistered()` succeeds: call
`record_device_session(deviceId)` once the device's own id is known. Guard
it the same way `lastSeenTouched` guards the existing heartbeat (once per
app session is enough — the session id doesn't change again until the next
sign-in).

### 3. Client: revoke on deactivate

In `src/features/devices/composables/useDevices.ts::setActive`, after the
existing `UPDATE devices SET is_active = ...` when deactivating
(`active === false`), call the new `revoke_device_session` RPC for that
device id. Reactivating (`active === true`) does **not** need to do
anything with sessions — a revoked device simply needs to sign in again via
`LoginPage.vue`, which is already handled correctly by `device.store.ts`'s
existing `SIGNED_OUT`/`SIGNED_IN` logic (confirmed during the WAFI-002
investigation).

### 4. Audit logging

`useAuditLog.ts::logDeviceActivation` already fires on deactivate/reactivate
— no new event type. Update its message/metadata for the deactivate case to
note the session was also revoked, so the audit trail reflects what actually
happened (e.g. append `sessionRevoked: true` to its metadata, not a new
event).

## Testing

- **pgTAP** (new suite or extending `wafi122_role_enforcement.test.sql`'s
  style — actually executable now that `037_devices.sql` and the fixture
  bugs are fixed): owner can revoke a device in their own shop; a
  cross-tenant caller cannot revoke a device in someone else's shop (mirrors
  the `switch_active_operator` tenant check); revoking a device with no
  recorded session is a safe no-op (no error).
- **Vitest:** `useDevices.ts::setActive(id, false)` calls the new RPC in
  addition to the existing `UPDATE devices` — mock the RPC and assert it's
  invoked with the right device id, and that `setActive(id, true)`
  (reactivate) does *not* call it.
- Manual/local verification: confirm `DELETE FROM auth.sessions WHERE id =
  ...` actually invalidates that session's refresh token against a real
  local Supabase stack (`npx supabase start`), since this is a
  community-documented technique this codebase hasn't used before — worth
  confirming for real rather than trusting by analogy, the same lesson from
  fixing the WAFI-122/202 suites.

## Out of scope

- Any near-real-time/push notification to the target device — explicitly
  decided against in brainstorming.
- Changing who is *allowed* to deactivate a device (existing self-lockout
  guard in `useDevices.ts::setActive` — the currently-active device cannot
  deactivate itself — is untouched).
- Any change to `switch_active_operator`'s PIN-based operator-switch flow;
  `device_sessions.active_role`/`active_staff_id` are untouched by this
  design's two new functions.
