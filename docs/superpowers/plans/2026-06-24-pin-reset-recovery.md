# WAFI-056 — Forgotten / locked PIN recovery (staff cannot log themselves out of the shop)

> Date: 2026-06-24 · Owner: PO · Priority: P1 (operational blocker for staffed shops) · Pack: Staff · Area: staff / auth
> Source: PO scenario — "an employee forgot his PIN, how does he log in or reset it?"
> Builds on WAFI-012 (PIN hardening). Independent of the trip (the brother is on-site).

---

## Problem
Employees and managers have **no account of their own** — the shop has one Supabase
account (the owner's phone + password); staff unlock the already-signed-in shop with a
4-digit PIN as "operators". So there is nothing to send a reset link to, and a
self-service "forgot PIN" flow is impossible by design (and undesirable — it would
defeat per-operator attribution).

Today the only recovery is `useStaff.updateStaffPin()`, reachable **only** behind
`can_manage_settings` — i.e. **Owner only**. Three concrete gaps:

1. **A cashier who forgets their PIN cannot work until the owner is reachable.** Fine
   for customer #0 (owner on-site); a hard blocker for pilots where the owner is away
   (violates Working Principle #9 — "no feature should require calling someone").
2. **Resetting a PIN does not clear the lockout.** `updateStaffPin` never calls
   `usePinLockout.reset()`, so after 5 wrong tries the staff member stays locked on
   that device for 5 min even after a new PIN is set (`usePinLockout.ts`, `useStaff.ts:133`).
3. **The owner can lock *themselves* out.** Only the owner can reset PINs, so a
   forgotten owner operator-PIN is a circular lock that can brick the shop.

## PO decisions (locked 2026-06-24)
- **Who may reset a cashier's PIN:** Owner **and** Manager. A Manager may reset only a
  `cashier`'s PIN — never another manager's or the owner's. (Manager "runs the floor",
  so a blocked cashier mid-shift must not require the owner.)
- **Reset method:** direct-set. The authoriser types a new PIN; the employee may change
  it later (not forced). Accepted caveat: the authoriser briefly knows the PIN — a minor
  attribution hole, acceptable for small high-trust shops; revisit (temp-PIN + forced
  change) when scaling.

---

## Scope

### In
1. **In-person "Forgot PIN?" recovery from the lock screen.** On `LockScreen` / `PinPad`,
   add a "نسيت الرمز؟ / Forgot PIN?" affordance. The employee hands the device to an
   authorised operator who **authenticates as themselves** (their own PIN), then sets the
   employee a new PIN on the spot. This is the primary flow and works fully offline
   (local DB write + lockout clear).
2. **Authorisation rule** (single source of truth, used by both UI and the action):
   reset allowed iff `actor.role === 'owner'` **OR** (`actor.role === 'manager'` **AND**
   `target.role === 'cashier'`). No new permission flag required — express it as a role
   rule so it does not widen `can_manage_settings`.
3. **Clear the lockout on reset.** `updateStaffPin` (or the recovery action) calls
   `usePinLockout.reset(targetStaffId)` so the new PIN works immediately.
4. **Owner self-recovery.** From the same "Forgot PIN?" entry, an "I'm the owner" path
   lets the owner re-authenticate with the **shop account password** (Supabase re-auth)
   and set a new owner operator-PIN. Breaks the circular lock.
5. **Audit.** Every reset records the **actor** (who reset) and the **target** (whose PIN),
   distinct fields. Reuse `logPinChanged`; verify it captures the acting operator, not
   just the target — if it doesn't, add the actor.

### Out
- Self-service reset by the forgetful employee (impossible by design — explicitly not built).
- Temp-PIN + forced-change-on-first-login (deferred; revisit at scale).
- SMS/email recovery (no per-staff contact identity exists).
- Server-coordinated lockout (that's WAFI-010 / WAFI-012's deferred half).

---

## Edge cases (must all be handled)
- **Manager tries to reset an owner's or another manager's PIN** → denied in UI **and** in
  the action (defence in depth), with a clear message.
- **Target is currently locked out** → reset clears the lockout; new PIN works with no wait.
- **Offline, single device** (the common case) → entire in-person flow works with no network.
- **Offline + multi-device** → the new hash is a synced write; it only works on the
  employee's *other* device once it syncs. State this; do not claim instant cross-device.
- **Owner forgot own PIN while offline** → owner self-recovery needs the server (password
  re-auth), so it requires connectivity. Document the limitation; the in-person flow (a
  manager cannot rescue the owner) does not cover this — only account-password does.
- **Last/only owner** → must always have a working recovery path (account password); never
  a state where nobody can unlock the shop.
- **New PIN collides with another staff's PIN** → apply the same trivial-PIN / duplicate-PIN
  rules as create (WAFI-012); warn on duplicates.
- **Authoriser cancels mid-flow** → no partial write, employee's old PIN unchanged, no
  lockout change.
- **Reset while the target has an open shift / is the active operator** → allowed; does not
  corrupt shift attribution; if the target was the active operator, they re-enter with the
  new PIN.

---

## Acceptance Criteria
- [ ] A cashier who forgot their PIN gets a working new PIN **without the owner present**:
      a Manager (or Owner) authenticates from "Forgot PIN?" and sets it, offline, on the
      same device.
- [ ] A Manager **cannot** reset another Manager's or the Owner's PIN (blocked in UI and
      action).
- [ ] After any reset, the target's lockout is cleared — the new PIN works immediately,
      no cooldown.
- [ ] An Owner who forgot their own operator-PIN can recover by re-entering the shop
      account password and setting a new PIN.
- [ ] Every reset writes an audit entry naming both the actor and the target.
- [ ] The flow exists in `ar` + `en` and renders RTL correctly.
- [ ] No self-service path lets a logged-out employee reset their own PIN.

## Definition of Done
Tests: (a) manager→cashier reset succeeds and clears lockout; (b) manager→manager and
manager→owner resets are rejected; (c) owner self-recovery via password path; (d) audit
row carries actor + target. In-person flow verified on device offline, both languages.
Merged, `npm run build` green, existing staff/PIN tests pass.

## Touch points (orientation)
`src/features/staff/components/LockScreen.vue` · `PinPad.vue` · `composables/useStaff.ts`
(`updateStaffPin`) · `composables/usePinLockout.ts` (`reset`) · `composables/usePinAuth.ts`
· `router/permissions.ts` (role rule) · `src/features/audit/composables/useAuditLog.ts`
(`logPinChanged` actor) · `src/data/supabase/client.ts` (owner password re-auth) · i18n `ar`/`en`.
