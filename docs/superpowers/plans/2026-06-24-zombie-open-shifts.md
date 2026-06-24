# WAFI-065 — Zombie open shifts in `/shifts/history`

> Date: 2026-06-24 · Owner: PO
> Source: CEO observation ("a lot of shifts never closed, piling up in shift history")
> + PO alignment review. This is **finishing skipped Epic 5 stories 5.3 and 5.7**, not a
> new feature.

**Priority:** P1 (data trust + daily annoyance) · **Pack:** Staff · **Area:** shifts
**Depends on:** WAFI-060 (adds the `force_closed_by` column this ticket sets).

---

## Problem

Shifts open but are never automatically closed, so `/shifts/history` fills with
perpetually-open ("zombie") shifts. Root causes, both specified in Epic 5 but never
built:
1. **No "one open shift per device" guard.** `openShift()`
   (`src/features/shifts/composables/useShift.ts:31`) inserts a new open row with no
   check for an existing open shift on the device, and there is **no DB uniqueness
   constraint**. Story 5.3's "shift already open by another cashier — must close first"
   AC is unimplemented, so opens accumulate.
2. **No force-close.** Story 5.5 / 5.7 / edge case #2 specify an owner force-close for
   abandoned shifts. The review found it **absent** (no auto-close, no force-close, no
   stale handling). Once a shift is orphaned (device lost, cashier went home, crash),
   there is no way to resolve it — it stays open forever.

## Why NOT just "auto-close them"

Auto-closing is the tempting fix and it is **wrong** — and Epic 5 already says so
(Story 5.2: sign-out and idle-timeout deliberately do **not** close shifts). A real
close requires a **counted** cash amount to produce variance, which is the entire point
of the Staff Pack ("see who's stealing"). Auto-closing fabricates a close with no
count, manufacturing fake variance data and corrupting the exact numbers the feature
exists to protect. We resolve zombies **explicitly and labelled**, never silently.

---

## The approach (4 parts, in priority order)

### Part 1 — Stop the bleeding: one open shift per device
- In `openShift()`, before inserting, check for an existing `status='open'` shift for
  this `device_id`. If one exists, **do not silently create a second** — surface Story
  5.3's flow: "وردية مفتوحة لـ[name] — يجب إغلاقها أولاً" with options:
  - **Notify** / "Cannot open" for non-owners, and
  - **Force close** (owner only) → routes into Part 2.
- Add a DB **partial unique index** as a backstop:
  `CREATE UNIQUE INDEX ... ON cashier_shifts (device_id) WHERE status = 'open'`.
  Keep it **per-device** — two *different* devices each having an open shift is normal;
  the bug is one device with two. (App-level check is primary because offline-first
  can't rely on a central constraint at write time; the index catches anything that
  slips through on sync/server.)

### Part 2 — Owner force-close (Epic 5 Story 5.7)
- On an open shift's detail (the WAFI-061 detail screen), show **"إغلاق إجبارياً"**
  (Force close) for the **owner only**.
- Flow: owner enters the expected cash amounts (the cashier never counted), or accepts
  the system-computed expected; the shift closes with `force_closed_by = <owner staff
  id>` and a note "force-closed without count" (epic edge case #2).
- Write an **audit-log** entry: who force-closed, which shift, when, why (epic audit
  table line 381). Uses the WAFI-060 snapshot mechanism so the forced close still stores
  a Z-report snapshot + variance.

### Part 3 — Make abandoned shifts visible, not hidden
- Flag any shift open past a sensible threshold (e.g. open beyond shop-close / >N hours)
  with a "مفتوحة منذ فترة طويلة" (long-open) badge and a filter in WAFI-061's history
  filter bar, so the owner can find and sweep them.
- This is also the hook point for the future owner alert (roadmap Use Case B).

### Part 4 — A distinct status for truly abandoned shifts (only if ever auto-handled)
- If we ever programmatically clear ancient orphans, give them
  **`status='abandoned'`**, never a fake `'closed'`. Extend the status CHECK to
  `('open','closed','abandoned')`.
- Abandoned shifts carry **no** counted cash / variance and are **excluded** from
  revenue and variance analytics, and clearly labelled, so they can never be mistaken
  for a genuine reconciled close.
- (Part 4 is a guard-rail; Parts 1–3 are the actual fix. Do not auto-abandon without a
  PO decision on the threshold.)

---

## Scope

**In:** the four parts above — app-level open guard + Story 5.3 prompt, DB partial
unique index, owner force-close with audit + snapshot, long-open visibility/filter,
`abandoned` status enum (schema only; no auto-sweep without sign-off).

**Out:** auto-closing with fabricated cash counts (explicitly rejected); idle-timeout
locking (that's WAFI-062 and does not close shifts); cross-device "same cashier on two
devices" reconciliation (epic edge case #3 — separate concern, note as follow-up).

## Edge cases

- **Owner force-closes a shift that the cashier is mid-sale on another device** → out
  of scope here (multi-device, edge #3); the per-device guard covers the single-device
  case which is the reported problem.
- **Force-close with no sales in the shift** → expected cash = opening cash; still
  writes snapshot + audit.
- **Offline force-close** → works locally, audit + snapshot queue for sync; never lost.
- **Partial unique index vs offline opens** → two devices opening offline don't violate
  it (different `device_id`); a single device that somehow has two open rows after a
  buggy sync → the index rejects the second on server apply; app must handle that
  rejection without stalling the queue (coordinate with WAFI-015).
- **Migrating today's existing zombies** → after deploy, the owner force-closes the
  backlog via Part 2; or a one-off documented script sets the oldest stale ones to
  `abandoned` (Part 4) — owner's call, audit-logged.
- **Non-owner hitting the open guard** → sees "must close first" / notify; never gets a
  force-close button.

## Acceptance Criteria

- [ ] Opening a shift when one is already open on the device does **not** create a
      second shift; the user sees the Story 5.3 prompt (block for non-owner, force-close
      option for owner).
- [ ] A partial unique index prevents two `open` shifts per device at the DB level;
      two different devices can each hold an open shift.
- [ ] The owner (only) can force-close an open shift from its detail; it records
      `force_closed_by`, a note, a Z-report snapshot (WAFI-060), and an audit entry.
- [ ] Force-close requires entering/accepting expected cash; no silent fabricated count.
- [ ] Long-open shifts are visibly flagged and filterable in history.
- [ ] If `abandoned` is used, those shifts are excluded from revenue/variance analytics
      and clearly labelled; nothing is auto-abandoned without the configured threshold +
      PO sign-off.
- [ ] No shift is ever auto-`closed` with a fabricated cash count.
- [ ] Works offline; force-close/audit/snapshot queue and never drop; the guard
      rejection never stalls the upload queue.

## Definition of Done

Test: attempt a second open on a device with an open shift → blocked (app) and DB index
rejects a forced duplicate. Test: owner force-close → shift `closed`, `force_closed_by`
set, audit entry present, snapshot stored. Existing zombie backlog cleared on the hosted
shop (force-close or documented one-off, audit-logged). Long-open filter verified. Build
green (`npm run build`); shift + audit tests pass; no regression to offline ring-sales.
