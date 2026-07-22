# WAFI-203: Operator Identity Must Be Server-Authoritative — Design

## Background

WAFI-202's design (`2026-07-22-wafi-202-sales-immutability-design.md`) tightens
`sales`/`returns` RLS to require strict attribution — `staff_id =
auth_staff_id()`, no owner/manager exception — via migration
`064_wafi202_sales_immutability.sql`. That migration is merged but explicitly
**not applied to production**, gated on this ticket, because two gaps in how
operator identity reaches the server would otherwise break checkout or
silently desync attribution:

1. **The login flow never confirms identity with the server at all.**
   `useShift.ts`'s `openShift()` — the path every cashier uses at the start of
   every shift — only calls `session.setActiveStaff(staff)` (local state). It
   never calls `switch_active_operator` (the RPC that stamps
   `device_sessions.active_staff_id`/`active_role`, which the JWT hook reads
   into the `staff_id`/`active_role` claims). Only the separate, explicit
   "switch operator" mid-shift flow (`useOperatorSwitch.ts`) calls the RPC —
   and even that only on its success path. This is confirmed as the root
   cause of all sampled production `sales` rows having `staff_id = NULL`: the
   *primary* path was never wired to server-side identity, not just a
   fallback of a secondary path.

2. **`useOperatorSwitch.ts`'s offline/error fallback sets local identity
   unconditionally.** On an undecodable `session_id`, an RPC network error, or
   any other thrown error, `switchTo()` calls `session.setActiveStaff(staff)`
   regardless — by design, so a network hiccup never blocks the local switch.
   But `supabase.auth.refreshSession()` (which mints the JWT carrying the new
   `staff_id` claim) only runs on the RPC's success path. A sale created
   after such a fallback is queued locally under the new operator's
   `staff_id`, but syncs later under a JWT whose `staff_id` claim never
   updated — so `staff_id = auth_staff_id()` rejects the row once the strict
   policy is live.

Both stem from the same root cause: operator identity is currently
client-authoritative ("switch locally, sync JWT best-effort") when it must be
server-authoritative ("JWT reflects identity, or identity hasn't changed
yet").

## Confirmed Constraints

- `switch_active_operator(p_device_id, p_session_id, p_staff_id, p_pin)`
  (migration `054_auth_role_helpers.sql`'s successor of 045/048) already does
  everything needed server-side: tenant check, PIN re-verification, lockout
  bookkeeping, and upserts `device_sessions` keyed on `session_id`. No server
  changes are required for this ticket — this is a client-only fix.
- PIN verification is already fully local (`usePinAuth.ts`'s `verifyPin`
  hashes against the synced `staff.pin_hash`/`pin_salt`) — the server RPC's
  PIN re-check is defense-in-depth, not the primary gate. Identity changes
  are not blocked by PIN verification itself, only by the RPC's *identity
  confirmation* step (updating `device_sessions` and the JWT).
- `openShift`'s existing resume branch (`existing.staffId === staff.id`, same
  operator reopening their own already-open shift) makes no server call
  today and is not a new identity claim — no change needed there.
- Device registration already requires connectivity (to create the `devices`
  row). Requiring connectivity once more, the first time a *specific staff
  member* is ever confirmed as an operator on a *specific device*, is
  consistent with that existing constraint, not a new offline-first
  violation.

## Design

### 1. Shared identity-establishment helper

Extract the RPC-call-plus-refresh logic currently inside
`useOperatorSwitch.ts`'s `switchTo()` into a standalone helper (same file or a
new `establishOperatorIdentity.ts`):

```ts
type EstablishResult =
  | { status: 'confirmed' }                 // RPC + refresh succeeded
  | { status: 'offline-same-identity' }      // no network needed, safe
  | { status: 'blocked'; reason: string }    // genuinely new identity, offline
```

`establishOperatorIdentity(staff: Staff, pin: string): Promise<EstablishResult>`:

1. Read `lastConfirmedOperatorId` (new persisted field, see below).
2. If `staff.id === lastConfirmedOperatorId` → return
   `{ status: 'offline-same-identity' }` immediately, no network call. The
   JWT already carries this staff's id from an earlier confirmation, and
   nothing else can have changed it since (see invariant below) — safe to
   proceed fully offline.
3. Otherwise, this is a genuinely new identity for this device. Attempt the
   RPC exactly as `switchTo()` does today (decode `session_id`, call
   `switch_active_operator`, `refreshSession()` on success).
   - RPC success → set `lastConfirmedOperatorId = staff.id`, return
     `{ status: 'confirmed' }`.
   - RPC failure (network error, undecodable `session_id`, thrown error) →
     return `{ status: 'blocked', reason: '...' }`. **Do not** set
     `session.activeStaff` — the caller must not proceed.
   - RPC returns `ok: false` (PIN mismatch server-side) → throw, same as
     today (`switchTo()`'s existing `'server-side PIN verification failed'`
     path) — this is a genuine auth failure, not an offline case.

**Invariant this preserves:** `lastConfirmedOperatorId` changes only in
lockstep with a successful RPC + `refreshSession()` — the exact same moment
the JWT's `staff_id` claim changes. So `staff.id === lastConfirmedOperatorId`
is always equivalent to "the JWT currently carries this staff's id," without
needing to decode the JWT to check.

### 2. Callers

**`useShift.ts`'s `openShift()`** (new-shift branch only — the resume branch
is untouched):

```ts
const result = await establishOperatorIdentity(staff, pin)
if (result.status === 'blocked') {
  return { status: 'identity-unconfirmed', reason: result.reason }
}
// 'confirmed' or 'offline-same-identity' — proceed as today
session.setActiveStaff(staff)
...
```

This requires threading `pin` into `openShift` (currently not a parameter —
`LockScreen.vue` already has it in scope from the PIN-entry step, so this is
a signature change, not new state) and a new `OpenShiftResult` variant
(`{ status: 'identity-unconfirmed' }`) alongside the existing
`opened`/`resumed`/`conflict`/`device-deactivated`. `LockScreen.vue` shows a
clear message on this result ("تحتاج إلى اتصال بالإنترنت لتأكيد هويتك — حاول
مرة أخرى" / "needs an internet connection to confirm your identity — try
again") and stays on the opening-cash step (no shift row is created, no
session change, nothing lost — the cashier retries once online).

**`useOperatorSwitch.ts`'s `switchTo()`** — replace the three duplicated
fallback blocks (undecodable `session_id`, RPC error, caught exception) with
a single call to the shared helper:

```ts
const result = await establishOperatorIdentity(staff, pin)
if (result.status === 'blocked') {
  throw new OperatorSwitchBlockedError(result.reason) // caller shows a message, keeps current operator active
}
session.setActiveStaff(staff)
await logOperatorSwitched(from?.id ?? null, from?.name ?? null, staff.id, staff.name)
```

`LockScreen.vue`'s `mode === 'switch'` branch catches this and shows the same
"needs internet" message, leaving the previous operator active — the shop
keeps selling uninterrupted under them.

Net effect: no queue, no "pending identity" UI state, no background retry
timer. A genuinely new identity is adopted locally if and only if the server
has already confirmed it.

### 3. Persisted `lastConfirmedOperatorId`

Add to `useDeviceStore` (persisted, per-device — this is bookkeeping about
*this device's* confirmed server-side state, the same home as `deviceId`/
`deviceCode`), not `useSessionStore` (which holds the current-actor concept,
a different thing). Set only inside `establishOperatorIdentity` on RPC
success. Never cleared on logout/lock — it reflects the last identity the
*server* confirmed for this device, which remains true until the next
successful switch, regardless of local lock-screen state.

**Rollout note:** devices already in the field have no
`lastConfirmedOperatorId` cached from before this ships. Their first
shift-open after upgrading will require connectivity once, even for a
returning cashier who was already confirmed under the old code path — a
one-time cost, not a recurring one.

### 4. Checkout-time fail-closed gate

`usePayment.ts`'s `confirm()`, before the existing idempotency check:

```ts
if (!sessionStore.activeStaff) {
  throw new Error('No active operator — cannot complete sale')
}
```

Belt-and-suspenders alongside #1/#2: even if some future code path manages
to reach checkout without an established operator, the write is refused
client-side before it ever reaches the (now strict) RLS policy. Mirrors the
fail-closed style already used in `auth_permissions()`/`can()`.

## Out of Scope

- Auto-retry / background reconciliation of a blocked identity change — the
  cashier retries manually by re-attempting the switch/login once online.
  Simpler, and avoids "pending identity" UI ambiguity (what permissions does
  the UI show while a switch is "pending"?). Revisit only if pilot feedback
  shows manual retry is a real friction point.
- `ForceCloseSheet`'s force-close flow — it does not create sales and does
  not change `device_sessions.active_staff_id` for the *forcing* owner's own
  identity in a way that affects sale attribution; not touched here.
- Any change to `switch_active_operator`, the JWT hook, or `device_sessions`
  schema — all already sufficient as-is.
- WAFI-201 (offline-sync confidentiality) — separate, already-accepted scope
  exclusion.

## Acceptance Criteria

- [ ] `openShift` (new-shift branch) calls `establishOperatorIdentity` before
      setting local active-staff state; the resume branch is unchanged.
- [ ] `switchTo` uses the same shared helper; its three duplicated fallback
      blocks are removed.
- [ ] Same-identity re-confirmation (`staff.id === lastConfirmedOperatorId`)
      never makes a network call.
- [ ] A genuinely new identity, attempted while offline, is blocked with a
      clear message; local state (`session.activeStaff`,
      `lastConfirmedOperatorId`) is left untouched; the previous operator
      (if any) remains active and can keep selling.
- [ ] `usePayment.confirm()` throws before any write when
      `sessionStore.activeStaff` is null.
- [ ] Unit tests: same-identity offline path, new-identity offline block,
      new-identity online success, RPC PIN-mismatch (unchanged throw
      behavior), checkout gate.
- [ ] `WAFI_Production_Readiness_Plan_v3.md`'s WAFI-203 row and WAFI-202's
      "Blocking Prerequisite" section updated once merged, unblocking
      migration `064` for production.

## Rollout Sequencing

This ticket must land, merge, and be verified before migration `064`
(WAFI-202) is applied to the production Supabase project — per that
migration's own header guard. No ordering constraint the other direction:
this ticket's client changes are safe to ship independently of the
migration's application timing.
