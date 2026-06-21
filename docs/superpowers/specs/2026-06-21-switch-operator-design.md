# Switch Operator (no shift change) — Design

> Date: 2026-06-21
> Status: Approved (pending spec review)
> Pack: Staff
> Sacred Rules touched: Offline-first (1), Arabic (2)

## Problem

Owner and staff swap at the register several times a day. Today the only way to
change who is logged in is to close the shift and open a new one — but swapping
operators is **not** a cash-accountability event, and forcing a drawer count on
every swap is wrong and slow. The product currently conflates two distinct ideas:

- **Shift** — a cash-drawer accountability period (open with a count, close with a
  count + variance + Z-report).
- **Operator** — the person currently logged in, ringing sales, with a role.

This feature separates them: operators switch freely inside one open shift.

## Decisions (locked during brainstorming)

1. **One shift per working session.** The drawer is counted once at open and once at
   close. The shift stays open all day while operators swap. The Z-report breaks the
   shift's sales down per operator; cash variance is for the whole shift.
2. **Cart is preserved across a switch.** The new operator inherits the in-progress
   cart, including its locked exchange rate.
3. **Attribution = whoever completes the sale.** Because the cart can change hands, a
   sale is attributed to the operator active at confirmation (the one who takes
   payment). This is the only unambiguous rule.
4. **Trigger = account menu → reuse the existing lock/PIN prompt.** No new switcher
   UI, no idle auto-lock.

## Concept

"Switch operator" (تبديل المستخدم) changes the active operator without touching the
cash shift. Switching to a given person means entering *that person's* PIN, so
escalating to the owner inherently requires the owner's PIN — no separate
escalation mechanism is needed.

## Flow

1. "تبديل المستخدم" appears in the header account menu — always reachable.
2. Tapping it locks the session and shows the existing pick-your-face + PIN prompt
   (`StaffPinPrompt` / `LockScreen` reused).
3. The selected staff enters their PIN.
4. On success: the active operator changes, their role's client-side permissions
   apply immediately (sidebar + route guards re-evaluate), and the **open shift
   continues untouched**.
5. On cancel: the previous operator stays active; nothing changes.

## What persists vs changes

| Persists | Changes on switch |
|---|---|
| Open shift (same `cashier_shifts` row) | Active operator (`staff_id`) |
| In-progress cart + its locked exchange rate | Client-side permissions (sidebar, route guards) |
| Pending sync queue, synced data | The operator attributed to subsequent confirmed sales |

## Attribution

- A confirmed sale records the operator **active at confirmation** as its `staff_id`,
  and the current open shift as its `shift_id`.
- The Z-report groups the shift's sales by `staff_id` so the owner sees a per-operator
  breakdown within the single shift. Cash variance remains a single figure for the
  shift.

## Audit

Every switch writes an audit row: `event = operator.switched`, with `from` and `to`
staff (id + name) and timestamp. Switching is an accountability event and must be
visible in the (append-only) audit log.

## Error handling & edge cases

- **No shift open** → switching is just a re-login; allowed. (Ringing sales still
  follows whatever the existing "must open a shift" rule is — unchanged.)
- **Offline** → PIN verifies against the locally cached hash, so switching works
  offline, consistent with offline shift-open (Sacred Rule #1).
- **Cancel at PIN prompt** → previous operator remains; no state change.
- **Wrong PIN** → standard PIN error; subject to WAFI-012 lockout once that ships.
- **Switch with a cart open** → allowed; the cart is preserved and inherited (decision
  2). The locked exchange rate on the cart must survive the switch unchanged.

## Components touched

- Header account menu — add the "Switch operator" action.
- `LockScreen` / `StaffPinPrompt` — reused as the switch surface (no fork).
- The active-operator store — the switch writes the **same** store the route guards
  read (see dependency on WAFI-011).
- Sale confirmation path — stamp `staff_id` from the active operator at confirm time.
- `useZReport` — group by `staff_id` for the per-operator breakdown.
- Audit — emit `operator.switched`.

## Dependencies & interactions

- **WAFI-011 (blocking):** the codebase currently splits active staff across
  `sessionStore` (written by PIN login) and `shiftStore` (written by shift open), and
  the route guard reads the wrong one. Switching must update the single store the
  guards read, so WAFI-011 should be fixed first (or as part of this work) — otherwise
  permissions won't re-scope on switch.
- **Role-Enforcement epic:** this feature performs the *client-side* permission
  re-scope only. Server-side data re-scope on switch (and clearing sensitive cached
  data for a downgraded operator) is that epic's concern (KD-3), not this one.

## Out of scope

- Idle auto-lock of the register.
- A dedicated quick-switch screen (avatars-only fast switch).
- Per-operator cash accountability within a shift (decision 1 rejects this).
- Server-side enforcement of the re-scoped role (Role-Enforcement epic).

## Definition of Done

- [ ] "Switch operator" reachable from the header account menu on phone and desktop.
- [ ] Switching shows the existing PIN prompt; correct PIN changes the active operator
      and leaves the open shift untouched (no close/open, no cash count).
- [ ] Switching to the owner requires the owner PIN (verified via the auth itself).
- [ ] The in-progress cart and its locked rate survive the switch.
- [ ] A sale confirmed after a switch is attributed to the new operator; the Z-report
      shows a per-operator breakdown within the one shift.
- [ ] An `operator.switched` audit row is written on every switch.
- [ ] Works offline (PIN against cached hash); cancel leaves state unchanged.
- [ ] Permissions re-scope on switch (depends on the WAFI-011 store fix).
