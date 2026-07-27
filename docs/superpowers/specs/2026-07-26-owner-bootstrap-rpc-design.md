# Design: Server-Atomic Owner Bootstrap (fixes circular self-serve signup lockout)

**Date:** 2026-07-26 (revised 2026-07-27 per code review, second pass same day)
**Status:** Approved, pending implementation plan

## Problem

Self-serve owner signup has been unable to complete first-run setup since the
WAFI-122 RLS hardening shipped (migrations 054-062), and this was never caught
because production had no working shop-provisioning trigger until this same
session fixed it (see `WAFI_Production_Readiness_Plan_v3.md`, WAFI-001
closeout) — nobody had exercised a real fresh signup against the hardened RLS
policies before today. The brother's shop (customer #0) was hand-seeded
directly via SQL, bypassing this path entirely.

**The circularity, confirmed via live reproduction (2026-07-26):**

1. Owner signs up (`signUpOwner`, `src/data/supabase/auth.ts`) — phone+password,
   metadata carries `shop_name`/`business_type`/`country`.
2. `provision_shop_for_new_user()` (migration 021, an `AFTER INSERT` trigger on
   `auth.users`) atomically creates the `shops` row. **This part works.**
3. `OwnerSetupScreen.vue` renders `StaffForm` with `force-role="owner"`, which
   calls `useStaff.ts`'s `createStaff()` — a **local-only** PowerSync/SQLite
   write (WAFI's offline-first architecture always writes locally first, then
   PowerSync uploads asynchronously). This inserts the owner's own `staff` row
   (PIN hash/salt, `role='owner'`).
4. Device registration (`useDeviceRegistration.ts`, `devices` table) is
   similarly local-first — `allocate_device_code()` computes the next device
   letter code server-side, but the actual `devices` row INSERT is still a
   local-only write that must separately sync up.
5. Uploading either queued INSERT requires the RLS policy (`staff_insert_owner`
   / `devices_insert_owner`, migration 055) to pass, which requires
   `auth_role() = 'owner'` (migration 054).
6. `auth_role()` reads the `active_role` JWT claim, stamped only by a custom
   access-token hook (migration 047) that reads `device_sessions.active_role`.
7. `device_sessions.active_role` is written **only** by `switch_active_operator()`
   (migration 045), a `SECURITY DEFINER` RPC that verifies the caller's PIN by
   looking up `public.staff WHERE id = p_staff_id ... AND is_active`
   **server-side**, and also requires the `devices` row to already exist
   server-side.
8. That RPC can never succeed for a brand-new owner, because the `staff` and
   `devices` rows it needs to verify against are still stuck in the local-only
   upload queue from step 3/4 — which can never upload, because of step 5.

Fully circular. Reproduced live: fresh signup → owner PIN setup → tapping
"open shift with 0" throws `Uncaught Error: server-side PIN verification failed`
from `establishOperatorIdentity` (`useOperatorSwitch.ts`), because
`switch_active_operator` finds no matching `staff` row and returns `false`.

## Why this needs a dedicated server-side fix, not a client patch or RLS relaxation

This sits in the exact RLS surface (`auth_role()`, `staff`/`devices` INSERT
policies) that migrations 054-068 (WAFI-122/202/203/001) hardened this same
session. Two approaches were considered:

- **Relax `staff_insert_owner`/`devices_insert_owner`** to also allow INSERT
  when `shop_id = auth_shop_id() AND NOT EXISTS (... staff/devices for that
  shop)`. Self-closing (only ever true once per shop) and narrowly scoped
  (always gated by the caller's own `auth_shop_id()`, never another shop's),
  but it's still a new kind of RLS escape hatch layered onto policies that
  were just hardened.
- **A dedicated atomic `SECURITY DEFINER` RPC** (chosen). Mirrors the existing,
  proven pattern: `provision_shop_for_new_user()` already solves the
  analogous shop-creation bootstrap the same way.

## Solution: `bootstrap_owner_identity()` RPC

A new `SECURITY DEFINER` Postgres function, added via a new migration
(`069_bootstrap_owner_identity.sql`).

### Minimal, non-security-deciding parameters

Per code review: a function receiving role, permissions, hashes, salts, and a
device code from the client is a function letting the client make security
decisions it shouldn't. Every one of those is now derived or computed
server-side instead:

```sql
bootstrap_owner_identity(
  p_device_id   uuid,   -- client-generated, persisted BEFORE calling (idempotency key)
  p_staff_id    uuid,   -- client-generated, persisted BEFORE calling (idempotency key)
  p_staff_name  text,
  p_pin         text    -- RAW pin, never a pre-computed hash — server hashes it
) RETURNS text          -- see "Return type" below
```

Removed from the original draft's 8-parameter signature, and why:

- **`p_permissions` (jsonb) — removed.** Owner permissions are never
  client-supplied. The function hardcodes the exact `OWNER_PERMISSIONS` set
  already defined in `src/features/staff/staff.types.ts` (all nine flags
  `true`) as a literal jsonb value — there is nothing to compute, since owner
  permissions never vary.
- **`p_role` — never existed as a param, stays that way.** Hardcoded
  `'owner'` inside the function body.
- **`p_device_code` / `p_is_temporary` — removed.** The function always runs
  online (see "Offline handling" below), so it always allocates a real,
  permanent code via the existing `allocate_device_code()` logic inline —
  the temporary-code fallback in `useDeviceRegistration.ts` exists for
  registering additional devices that might happen offline later; it doesn't
  apply to this one online-only bootstrap moment.
- **`p_pin_hash` / `p_pin_salt` — removed, replaced by raw `p_pin`.** The
  server generates its own salt (`encode(gen_random_bytes(16), 'hex')`) and
  computes the hash using the exact same algorithm `switch_active_operator()`
  already verifies against (`sha256(salt || pin)`, hex-encoded via
  `pgcrypto`'s `digest()`) — so a hash the client invented can never diverge
  from what the server can actually verify later.

`p_device_id`/`p_staff_id` remain client-supplied because they double as the
idempotency key (see "Idempotency and retries" below) — the client generates
them once, persists them locally immediately, and must reuse the same values
on any retry rather than regenerating.

### Bootstrap gate: an explicit completion marker, not `role='owner'` existence

Per code review: gating on "does an owner staff row exist" conflates two
different questions — "has bootstrap run" and "does this shop currently have
an owner" — which are the same question today, but won't necessarily stay
the same once WAFI grows ownership transfer, co-owners, imported shops, or
restored backups (all plausible per the v3 roadmap's later phases). An
explicit marker keeps the bootstrap gate meaningful independent of whatever
the `staff` table's owner semantics grow into later.

New column, added in the same migration:

```sql
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS bootstrap_completed_at timestamptz;
```

The gate becomes "has bootstrap completed for this shop," not "does an owner
exist right now":

### Gate and body

```sql
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
    RETURN 'invalid_state';  -- no shop resolves for this caller at all
  END IF;

  -- Idempotency / retry safety: if THIS SHOP's bootstrap already completed
  -- (whether from this exact call having already succeeded, or a retry
  -- after a network timeout hid a successful response from the client),
  -- this is a no-op success, not a failure. Gated on the explicit
  -- bootstrap_completed_at marker, not on staff.role — see the header
  -- comment above on why role-based existence doesn't scale past this
  -- feature's current, single-owner shape.
  IF EXISTS (SELECT 1 FROM public.shops WHERE id = v_shop_id AND bootstrap_completed_at IS NOT NULL) THEN
    RETURN 'already_bootstrapped';
  END IF;

  v_code := public.allocate_device_code(v_shop_id);
  v_salt := encode(gen_random_bytes(16), 'hex');
  v_hash := encode(digest(v_salt || p_pin, 'sha256'), 'hex');

  INSERT INTO public.devices (id, shop_id, code, is_temporary, registered_at, sync_status)
  VALUES (p_device_id, v_shop_id, v_code, false, now(), 'synced')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.staff (id, shop_id, name, pin_hash, pin_salt, role, permissions, is_active, created_at)
  VALUES (p_staff_id, v_shop_id, p_staff_name, v_hash, v_salt, 'owner',
          '{"can_view_reports":true,"can_manage_products":true,"can_manage_customers":true,'
          '"can_view_expenses":true,"can_manage_settings":true,"can_manage_inventory":true,'
          '"can_manage_suppliers":true,"can_manage_stock_take":true,"can_view_staff_ledger":true}',
          true, now())
  ON CONFLICT (id) DO NOTHING;

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
```

(Exact grants mirror `switch_active_operator`: `REVOKE ALL ... FROM public`,
`GRANT EXECUTE ... TO authenticated, anon`.)

### Return type: named constants, not raw string literals

Per code review, bare string literals invite typos between the SQL side and
the client side. Both sides must reference the same three documented values
— define them once and import/reuse rather than retyping:

| Constant name | Value | Meaning |
|---|---|---|
| `BOOTSTRAP_SUCCESS` | `'success'` | bootstrap completed just now |
| `BOOTSTRAP_ALREADY_COMPLETE` | `'already_bootstrapped'` | this shop's `bootstrap_completed_at` was already set; idempotent no-op — the client treats this exactly like `BOOTSTRAP_SUCCESS` and proceeds |
| `BOOTSTRAP_INVALID_STATE` | `'invalid_state'` | no shop resolves for the caller at all (should not happen post the WAFI-001 provisioning-trigger fix; defensive) |

On the client (TypeScript) side, the implementation plan should define these
as a single exported `const` object/union type (e.g. in
`src/data/supabase/` alongside `auth.ts`) that the owner-bootstrap composable
imports, rather than comparing against inline string literals at each call
site.

### Idempotency and retries

Per code review's distributed-systems concern: RPC commits server-side, the
client never receives the response (network timeout), user retries — the
naive design would have the retry see "an owner already exists, but not
matching what I expected" and surface a false failure.

Fixed two ways:
1. **The existence check is by role, not by ID match** — `already_bootstrapped`
   fires whenever the shop already has *any* owner, regardless of whether the
   IDs match this call's parameters. A retry with the same persisted IDs, or
   even a retry after the client lost those IDs and generated new ones, both
   resolve to the same safe outcome.
2. **`ON CONFLICT (id) DO NOTHING`** on the `devices`/`staff` inserts means
   even a race between two near-simultaneous calls with the *same* persisted
   IDs (e.g. a double-tap) never errors.

The client is responsible for persisting `p_device_id`/`p_staff_id` locally
**before** calling the RPC (not after success), and reusing those exact
values on any retry within the same bootstrap attempt — this is what makes
retries safe rather than merely "probably fine."

## Client-side change

`OwnerSetupScreen.vue`'s bootstrap path changes from "write locally, hope it
syncs" to an explicit RPC call — the same pattern `establishOperatorIdentity`
(`useOperatorSwitch.ts`) already uses for regular operator switches:

1. Generate `device_id`/`staff_id` locally and **persist them immediately**
   as a "pending bootstrap" record — this is the crash-recovery anchor
   described below. Exact shape (per code review — define this precisely so
   it isn't reinvented ad hoc):

   ```ts
   interface PendingBootstrap {
     deviceId:     string    // uuid, generated once, reused on every retry
     staffId:      string    // uuid, generated once, reused on every retry
     createdAt:    string    // ISO timestamp, first-attempt time
     attemptCount: number    // incremented on each retry, for diagnostics/telemetry
   }
   ```

   Stored wherever the app already keeps small first-run state (e.g.
   alongside `device.store.ts`'s persisted fields) — a single record, since
   only one bootstrap can be in flight per device. No `pin` field: the PIN
   is never persisted, only used in-memory for the RPC call itself.

2. Call `bootstrap_owner_identity(device_id, staff_id, name, pin)`.
3. On `BOOTSTRAP_SUCCESS` or `BOOTSTRAP_ALREADY_COMPLETE`, **do not manually
   mirror rows into the local PowerSync DB.** Per code review, three
   hand-written local INSERTs duplicating the RPC's own logic is a second
   place this can drift from the server. Instead:
   a. Call `supabase.auth.refreshSession()` so the JWT's `active_role` claim
      becomes `'owner'`.
   b. Await PowerSync's normal sync cycle so the canonical
      `devices`/`staff`/`device_sessions` rows are pulled down from Supabase
      into the local DB the standard way. Poll the local DB for the expected
      `staff` row, bounded to a 10-second timeout.
4. Set `device.lastConfirmedOperatorId = staff_id`, so WAFI-203's existing
   offline-reentry path takes over normally for all future use on this
   device.
5. Clear the `PendingBootstrap` record from step 1 — bootstrap is now fully
   complete and reconciled.

### `refreshSession()` failure handling

Per code review: if the RPC commits successfully but the subsequent
`refreshSession()` call fails (network drop between the two calls), the
server-side state is correct (`bootstrap_completed_at` is set,
`device_sessions.active_role='owner'`) but the client's current JWT still
carries the old `active_role`, so PowerSync's next sync attempt would
authenticate as the pre-bootstrap role and fail to pull the new rows.

This is not a new failure class to invent handling for — it is exactly the
same "pending bootstrap, not yet reconciled" state as a crash before step 3
even started (see Lifecycle, case 3 below). The `PendingBootstrap` record is
not cleared until step 5, so re-entering the flow (next app launch, or an
explicit "Retry" tap) re-runs from step 2: the RPC call returns
`BOOTSTRAP_ALREADY_COMPLETE` immediately (cheap, no PIN re-entry required
since `PendingBootstrap` still has `staffId`/`deviceId`), and step 3 (refresh
+ sync) is simply retried. No separate retry mechanism needs designing for
`refreshSession()` specifically — it inherits the same recovery path as
every other post-RPC failure mode.

### Timeout behavior (step 3b's 10-second poll)

Per code review: "wait 10 seconds" needs a defined *then what*, or
implementers will each invent something different. On timeout:

- Show a clear, non-alarming state: "لا يزال قيد المزامنة — يمكنك المحاولة
  مرة أخرى أو المتابعة لاحقاً" ("still syncing — you can retry now or
  continue later").
- Offer exactly two actions: **Retry now** (re-runs step 3b's poll only,
  since the RPC itself already succeeded — no need to re-call it) and
  **Continue later** (leaves `PendingBootstrap` in place, lets the owner
  close the app; the next launch's boot-time check, per Lifecycle below,
  resumes automatically).
- Do **not** silently proceed past the timeout as if the local row existed —
  that would risk the app routing into POS/shift screens with no local
  `staff` row yet, reproducing a variant of today's bug.

**Offline handling (the initial RPC call, not the post-success sync):** first-run
setup already requires connectivity (signup itself is online-only via
Supabase Auth), so requiring connectivity for this one RPC call is not a new
regression against the offline-first discipline. On failure (network error,
RPC unreachable), show the same "needs internet to confirm your identity"
message pattern `useOperatorSwitch.ts`'s `NEEDS_CONNECTIVITY_MESSAGE` already
uses, and block progressing — do not fall back to a local-only write.

## Lifecycle: what happens if the owner closes the browser mid-setup?

Per code review, this needs an explicit answer rather than being left
implicit.

Per code review, "the local `staff` table is the source of truth" is
architecturally backwards — restated correctly:

> Bootstrap is considered complete once the canonical owner `staff` row
> exists on the server (`shops.bootstrap_completed_at` is set) and has been
> replicated into the local database. The application determines *local
> readiness* by checking for the replicated owner `staff` row — that check
> answers "is my local cache caught up," not "did bootstrap happen." Supabase
> remains the canonical source of truth throughout.

This distinction is what makes the boot-time check meaningful: the app
checks the **local** `staff` row specifically to decide whether it needs to
resume syncing (step 3b), not to decide whether bootstrap itself succeeded —
that question is only ever answered server-side, via the RPC's return value.

Three cases, checked on every app boot / entry into the owner-setup route:

1. **Closed before submitting the PIN form at all.** Nothing was created
   anywhere (local or server), no `PendingBootstrap` record exists. Owner
   sees `OwnerSetupScreen` again next time, starts fresh. No special
   handling needed — this is today's existing behavior and stays correct.
2. **RPC call in flight or failed before completion** (e.g. closed the tab
   mid-request). Next launch: the `PendingBootstrap` record from step 1
   above still holds the persisted `device_id`/`staff_id`. The app detects no
   local owner `staff` row, finds the pending record, and **automatically
   retries the same RPC call with the same persisted IDs** — resolving via
   the idempotency guarantees above (`BOOTSTRAP_SUCCESS` if it never
   actually ran server-side, `BOOTSTRAP_ALREADY_COMPLETE` if it did) —
   without asking the owner to redo PIN entry (the PIN was never persisted,
   but is also no longer needed if the server call already went through).
3. **RPC succeeded server-side, but the client crashed before the local
   sync/hydration in step 3 completed** (the scenario code review flagged as
   the biggest concern). Next launch: same detection (no local owner `staff`
   row, `PendingBootstrap` still present) triggers the same automatic retry
   path. The RPC call itself returns `BOOTSTRAP_ALREADY_COMPLETE` immediately
   (cheap; no PIN re-entry needed), and only steps 3-5 re-run: refresh
   session, wait for sync, set `lastConfirmedOperatorId`, clear
   `PendingBootstrap`.

### Acceptance criteria (per code review)

> Given bootstrap succeeds on the server but the client crashes before local
> persistence completes, when the owner signs in again, the application shall
> automatically reconcile its local state from the server and continue
> onboarding without requiring manual intervention.

> Given the RPC succeeds but the response never reaches the client (network
> timeout), when the application retries, then bootstrap completes without
> duplicate rows — enforced by the `ON CONFLICT (id) DO NOTHING` inserts and
> the `bootstrap_completed_at`-gated idempotency check.

> Given the owner taps "Continue" twice in quick succession (double-tap),
> then only one owner `staff` row and one `devices` row exist — the second
> call's gate check (or, in a genuine race, the `ON CONFLICT` clauses) makes
> the second call a no-op.

## Security notes

- The `bootstrap_completed_at` gate is scoped to the caller's own
  `auth_shop_id()` and self-closes after first use — it cannot be used to
  claim ownership of another shop, and cannot be re-triggered once a shop's
  bootstrap has completed.
- Device bootstrap only ever applies to the **first** device on a brand-new
  shop. Every subsequent device registration goes through the existing
  `devices_insert_owner` policy unaffected, since by then the shop already
  has staff and this RPC's gate no longer applies.
- No existing RLS policy is loosened. This is a net-new, narrowly-scoped,
  audit-friendly function — the same trust model as `provision_shop_for_new_user()`.
- Permissions, role, device code, and PIN hash/salt are never client-supplied
  — removing an entire class of "client lies about its own privileges" risk
  that the original 8-parameter draft would have carried.

## Out of scope

- Retroactively fixing any other shop that might be stuck in this same
  circular state today (none are currently known — the brother's shop was
  hand-seeded and never hit this path; the one test account that hit it was
  deleted per the user's choice during this session's live debugging).
- Any change to `switch_active_operator()`, `custom_access_token_hook()`, or
  the existing RLS policies themselves — all are correct in isolation for
  their own purpose; the gap was the absence of a bootstrap path, not a bug
  in them.
- A generalized "resumable multi-step onboarding" framework — the lifecycle
  handling above is scoped specifically to this one bootstrap RPC's
  crash-recovery, not a broader onboarding-state-machine rebuild.
