# Epic 5 Remediation — Cashier Shifts & Identity gap closure

> Date: 2026-06-24 · Owner: PO
> Source: PO critical alignment review of Epic 5 (`epic_05_cashier_shifts_identity.md`)
> against the implementation on branch `wafi-058-owner-only-financials`.
>
> Purpose: close **every** gap found in the Implementation Status review. One ticket
> per area; each is independently pickup-ready with acceptance criteria + definition
> of done. **Nothing in the status table is dropped** — see the Coverage Matrix below;
> two sub-items (one-shift-per-device guard, owner force-close) are intentionally owned
> by the zombie-shifts ticket (WAFI-065) to avoid double-work, and are cross-referenced.

---

## Coverage Matrix — every reviewed gap maps to a ticket

| Epic 5 story | Gap found in review | Ticket |
|---|---|---|
| 5.1 Employees + roles | Permission checks scattered (inline `can_view_reports` in components), not a single `canUserDo` source per DoD | **WAFI-063** |
| 5.2 PIN sign-in | Idle-timeout PIN re-entry (15 min) not found | **WAFI-062** |
| 5.3 Open shift w/ cash count | No `opening_cash_syp` — dual-currency opening cash not captured (Sacred Rule #2) | **WAFI-059** |
| 5.3 Open shift w/ cash count | "Shift already open by another cashier → block/force" not enforced | **WAFI-065** (zombie ticket) |
| 5.4 Sale attribution | `shift_id` + `employee_id` on sales — not verified | **WAFI-064** |
| 5.5 Close shift w/ variance | `variance_syp/usd`, `close_note` not persisted; >5% mandatory-note flow impossible | **WAFI-060** |
| 5.6 Z-report print | Z-report recomputed from live data, not a stored immutable snapshot | **WAFI-060** |
| 5.7 Shift history | No filters, no shift-detail drill-down, hardcoded `LIMIT 50` | **WAFI-061** |
| 5.7 Shift history | Owner force-close button missing | **WAFI-065** (zombie ticket) |
| 5.8 Audit log | Full action coverage + append-only DB constraint not verified | **WAFI-064** |

Suggested order: **WAFI-059 → WAFI-060 → WAFI-061 → WAFI-062 → WAFI-063 → WAFI-064**, with **WAFI-065** (zombie) runnable in parallel after WAFI-059/060 land their migration (shared columns).

> **Schema caveat for all tickets:** the gaps below are read from migration `009`
> (`cashier_shifts`). Before adding columns, confirm no later `ALTER TABLE` already
> added them. New columns ship as one forward migration (next free number); follow the
> build-deploy gotcha (a TS error in tests blocks `npm run build`).

---

## WAFI-059 — Capture opening cash in BOTH currencies (SYP + USD)

**Priority:** P1 (Sacred Rule #2) · **Pack:** Staff · **Area:** shifts / data model

### Problem
`cashier_shifts` (migration 009) stores `opening_cash_usd` only — there is **no
`opening_cash_syp`** column, and `openShift()` (`src/features/shifts/composables/useShift.ts:31-47`)
inserts USD only. SYP is the **primary** currency for Syrian shops, so every shift's
SYP variance is computed against a missing/zero baseline. Epic 5 Story 5.3 explicitly
requires both "نقدي ليرة" (Cash SYP) and "نقدي دولار" (Cash USD) at open, and the
field table (epic lines 625-626) lists `opening_cash_syp` as required (≥ 0).

### Scope
**In:**
- Add `opening_cash_syp NUMERIC(14,0) NOT NULL DEFAULT 0 CHECK (opening_cash_syp >= 0)`
  to `cashier_shifts` (forward migration). Mirror SYP precision used by `closing_cash_syp`.
- `openShift()` accepts and persists `openingCashSyp`; add `openingCashSyp` to the
  `CashierShift` type and `rowToShift`.
- `LockScreen.vue` open-cash step captures both SYP and USD (epic Screen 2: two inputs,
  SYP focused first).
- Feed opening SYP into the cash reconciliation baseline (`cashReconciliation.ts`) so
  expected SYP = opening SYP + cash sales SYP + payments SYP − expenses SYP − refunds SYP.
- "Last shift closed with … SYP + … USD" hint above the inputs (epic Story 5.3 AC).

**Out:** changing how closing cash works (already dual-currency); the empty-input
"continue with 0?" warning if it already exists — verify, don't rebuild.

### Edge cases
- Empty SYP and/or USD at open → warning "لم تدخل العد — هل تريد الاستمرار بـ 0؟"
  with Confirm/Cancel (epic Story 5.3 AC); allowed but flagged.
- Existing open shifts created before the migration → `opening_cash_syp` defaults to 0;
  their SYP variance is historically unknowable — do not back-fill a fake number.
- Offline open → both values persist locally and queue for sync (Sacred Rule #1).
- SYP is integer-only (no decimals) consistent with WAFI-035.

### Acceptance Criteria
- [ ] Opening a shift records both opening cash SYP and USD; both persist and survive
      a refresh/restart (`loadActiveShift` returns them).
- [ ] Close-shift expected-SYP includes the opening SYP balance (hand-checked on one
      mixed shift: opening SYP + cash sales − cash expenses = expected SYP).
- [ ] The "last closed with X SYP + Y USD" hint shows the previous shift's closing
      amounts on the open screen.
- [ ] Empty input(s) trigger the confirm-with-zero warning, not a silent 0.
- [ ] Migration applies cleanly forward; pre-existing open shifts default to 0 without
      error.

### Definition of Done
Unit test: open with SYP=50000, USD=35 → reconciliation expected-SYP baseline = 50000.
Verified on device in Arabic RTL. Migration applied to the hosted shop. Build green
(`npm run build`), shift tests pass.

---

## WAFI-060 — Persist immutable shift-close evidence (variance, note, Z-report snapshot)

**Priority:** P1 (theft-detection integrity) · **Pack:** Staff · **Area:** shifts / data model / audit

### Problem
`closeShift()` (`useShift.ts:49-68`) writes only `status`, `closed_at`,
`closing_cash_usd`, `closing_cash_syp`. The schema has **no** `variance_syp`,
`variance_usd`, `close_note`, `force_closed_by`, or `z_report_data` columns (epic
field table lines 629-634). Consequences:
1. The >5% variance mandatory-note flow (Story 5.5) is impossible — nowhere to store
   the note.
2. The Z-report is **recomputed from live data** every time it's viewed
   (`useZReport.compute`), so a later product edit, deletion, or exchange-rate change
   **retroactively rewrites a historical Z-report** — violating Story 5.6 ("data
   intact, cannot be edited") and edge case #11. The one artifact whose purpose is
   immutable evidence is mutable. This guts the "see who's stealing" value prop.

### Scope
**In:**
- Add columns to `cashier_shifts` (forward migration): `variance_syp NUMERIC(14,0)`,
  `variance_usd NUMERIC(12,2)`, `close_note TEXT`, `force_closed_by UUID REFERENCES
  staff(id)`, `z_report_data JSONB` (all nullable; set at close).
- At close, compute and **persist** variance per currency and snapshot the full
  Z-report payload (the exact figures `useZReport.compute` produced) into
  `z_report_data`.
- Shift history + reprint read the **stored snapshot**, never recompute, for closed
  shifts. (Open-shift live preview may still compute.)
- >5% variance: require a `close_note` before confirming (epic Story 5.5 AC); persist it.

**Out:** the force-close path (uses `force_closed_by`, owned by **WAFI-065**); UI
filters/detail (WAFI-061). This ticket only guarantees the data is captured immutably.

### Edge cases
- Z-report references a product/customer later deleted → snapshot shows the captured
  values (independent of current state) — this is the whole point.
- Exchange rate changes after close → historical Z-report unchanged (reads snapshot).
- Variance > 5% with empty note → block confirm with the Arabic prompt; never close
  without the note.
- Offline close → snapshot + variance computed and stored locally; queue for sync;
  Z-report prints from the local snapshot (Story 5.9).
- Closed shift is immutable → no UI affordance edits `z_report_data`, `variance_*`, or
  `close_note` after close.

### Acceptance Criteria
- [ ] Closing a shift persists `variance_syp`, `variance_usd`, and a complete
      `z_report_data` snapshot.
- [ ] Reopening/reprinting a **closed** shift renders identical figures **after** a
      relevant product cost/price edit and after an exchange-rate change (snapshot, not
      recompute).
- [ ] A close with >5% variance cannot complete without a `close_note`; the note
      persists and shows in history.
- [ ] No UI path edits or deletes a closed shift's stored figures.
- [ ] Works offline; snapshot prints from local data.

### Definition of Done
Test: close a shift, snapshot the Z-report total; mutate the sold product's cost;
re-read the closed shift → total unchanged. Test: >5% variance blocks close until note
entered. Migration applied. Build green; shift + audit tests pass.

---

## WAFI-061 — Shift history depth: filters, shift-detail drill-down, pagination

**Priority:** P2 · **Pack:** Staff · **Area:** shifts / UI

### Problem
`ShiftHistoryScreen.vue` lists open + closed shifts but is missing Story 5.7
essentials: **no filters** (cashier / date range / variance status), **no shift-detail
drill-down** (the screen that shows the Z-report data + every sale, expense, and
customer payment in the shift + the cashier note), and a hardcoded `LIMIT 50`
(`useShift.ts:96`) that silently hides older shifts.

### Scope
**In:**
- Filter bar: cashier, date range, variance status (any / match only / variance only) —
  epic Story 5.7 AC + Screen 8.
- Shift-detail screen (epic Screen 9): header (cashier, dates, duration, totals),
  Z-report section (from the WAFI-060 snapshot for closed shifts), collapsible lists of
  sales (linking to each sale detail), expenses, and customer payments during the shift,
  plus the cashier's note.
- Replace the hardcoded `LIMIT 50` with pagination or an explicit, surfaced cap (no
  silent truncation — show "load more" or a count).
- Variance colour rules: green (match), yellow (<5%), red (≥5%) on each row.

**Out:** the owner force-close button on an open shift's detail (owned by **WAFI-065**);
reprint Z-report (already exists; just ensure it reads the snapshot).

### Edge cases
- Owner/Manager visibility only (cashier cannot view other shifts — Story 5.5/5.7);
  respect WAFI-058 financial gating inside the detail (mask money for ungranted staff,
  as `ZReportScreen` already does).
- Large history (hundreds of shifts) → pagination keeps the list responsive on a cheap
  Android.
- Open shift in the list → detail shows live/partial data, clearly labelled "مفتوحة".
- Empty / filtered-to-nothing → "لا توجد ورديات" / no-results state.

### Acceptance Criteria
- [ ] History can be filtered by cashier, date range, and variance status; filters
      combine and clear.
- [ ] Tapping a shift opens a detail screen showing Z-report data + sales + expenses +
      customer payments + note for that shift.
- [ ] Closed-shift detail reads the WAFI-060 snapshot (consistent with reprint).
- [ ] No silent truncation: older shifts are reachable (pagination or surfaced cap).
- [ ] Variance colour-coding correct on rows and detail.
- [ ] Financial figures masked for staff without `can_view_reports` (WAFI-058).

### Definition of Done
Seed >50 shifts → all reachable. Filter combinations verified. Detail drill-down
verified against a known shift's sales/expenses/payments. Build green; no regression in
WAFI-058 permission tests.

---

## WAFI-062 — Idle-timeout PIN re-entry (lock without closing the shift)

**Priority:** P2 · **Pack:** Staff · **Area:** shifts / session / security

### Problem
Epic Story 5.2 + Screen 11 require: after N minutes idle the app dims and requires PIN
re-entry to continue, **without closing the shift**, configurable (5 / 15 / 30 / 60 /
never), default 15. This was **not found** in the review. Without it, an unattended,
signed-in device is wide open — undermining the accountability the Staff Pack sells.
`LockScreen.vue` already has the PIN-entry building block to reuse.

### Scope
**In:**
- Idle timer (resets on interaction) that, on expiry, shows the PIN re-entry overlay
  (Screen 11: dimmed previous screen, operator photo/name, keypad, "تسجيل خروج" link).
- Correct PIN → resume exactly where the user was; the **open shift is untouched**.
- "تسجيل خروج" from the overlay → full sign-out (shift still NOT auto-closed — Story 5.2).
- Setting in settings: 5 / 15 / 30 / 60 / never (default 15).

**Out:** auto-closing shifts on timeout (explicitly forbidden — see WAFI-065 rationale);
changing lockout-after-5-wrong-attempts (already exists).

### Edge cases
- Timeout fires mid-sale (epic edge case #4) → the in-progress sale completes / is not
  lost; the **next** action requires PIN re-entry.
- "Never" setting → timer disabled.
- Wrong PIN at re-entry → same shake/clear as sign-in; 5-wrong lockout rules still apply.
- Offline → works fully offline (uses cached PIN hash).
- App backgrounded/foregrounded (PWA) → timer behaves correctly across visibility changes.

### Acceptance Criteria
- [ ] After the configured idle period the app locks with a PIN re-entry overlay and
      does **not** close the shift.
- [ ] Correct PIN resumes the prior screen with the shift intact.
- [ ] The timeout is configurable (5/15/30/60/never), default 15, and "never" disables it.
- [ ] A sale in progress when the timer fires is not lost; re-entry is required for the
      next action.
- [ ] Wrong-PIN handling and the 5-attempt lockout still apply at re-entry.

### Definition of Done
Manual test on device: idle past the threshold → lock → re-enter → shift still open,
same screen. Mid-sale timeout test passes. Setting persists and applies. Build green.

---

## WAFI-063 — Centralize permission checks through one source (`canUserDo`)

**Priority:** P2 (maintainability + correctness) · **Pack:** Staff · **Area:** permissions

### Problem
Epic 5 DoD: "All permission checks go through `canUserDo(user, action)` — no hardcoded
role checks in UI components," so the framework can be swapped in v1.5 without touching
UI. Today checks are split: `isRouteAllowed` gates routes (good), but components read
permissions inline, e.g. `session.activeStaff?.permissions?.can_view_reports` in
`ZReportScreen.vue:18`. These scattered reads are the "hardcoded checks in components"
the DoD warned against (just expressed as flags instead of roles). When the permission
model evolves (WAFI-010 server side, or v1.5 custom permissions), each inline read is a
separate edit and a place to get it wrong.

### Scope
**In:**
- A single permission accessor (e.g. `canUserDo(staff, action)` or a thin
  `can(action)` composable) that wraps `permissionsForRole` / the permissions object;
  `isRouteAllowed` and components both call it.
- Replace inline `staff.permissions?.xxx` reads in components (start with
  `ZReportScreen.vue`; sweep for others) with the accessor.
- Keep the WAFI-058 owner-grantable semantics intact — this is a refactor, not a
  behaviour change.

**Out:** changing the permission matrix or WAFI-058 behaviour; server-side enforcement
(WAFI-010).

### Edge cases
- Owner always-true and "manager cannot self-escalate settings" semantics
  (`permissionsForRole`) must be preserved exactly — reuse it, don't reimplement.
- No active staff → fail closed (same as `isRouteAllowed` today).
- The refactor must not change any existing WAFI-058 test outcome.

### Acceptance Criteria
- [ ] A single accessor is the only way components and the router ask "can this staff do
      X"; no component reads `permissions.<flag>` directly.
- [ ] Behaviour is identical to today (WAFI-058 tests pass unchanged).
- [ ] Adding a new gated action requires touching one place + the matrix, not each
      component (demonstrated by the diff).

### Definition of Done
Grep shows no direct `permissions?.can_` reads left in `.vue` components (all via the
accessor). All existing permission tests pass unmodified. Build green.

---

## WAFI-064 — Verify-and-close: sale attribution (5.4) + audit-log integrity (5.8)

**Priority:** P2 (verification; may convert to fixes) · **Pack:** Staff · **Area:** sales / audit

### Problem
Two Epic 5 stories could not be confirmed in the review and must be verified; if the
guarantee is absent, this ticket carries the fix.
- **5.4 Sale attribution:** every sale must store `employee_id` (operator who completed
  it) **and** `shift_id` (current shift). Not verified in the reviewed files.
- **5.8 Audit log:** the DB must reject UPDATE/DELETE on audit entries (append-only,
  epic line 653) and cover the full action list (epic table lines 369-384). Existence
  confirmed (`useAuditLog`), completeness + the DB-level append-only guarantee not.

### Scope
**In (verify; fix if missing):**
- Confirm sales write `employee_id` + `shift_id`, and that these surface on sale detail,
  customer transaction history, and sales history rows (Story 5.4 ACs).
- Confirm a DB constraint/trigger blocks UPDATE and DELETE on audit entries (not just
  the absence of UI). If only client-side, add the DB-level guard.
- Confirm the audit action list is covered (price/cost change, stock adjustment, balance
  adjustment, expense edit/delete, payment edit/delete, employee add/edit/deactivate,
  exchange-rate change, shift force-close, PIN lockout, shop-setting change). List any
  missing action types as follow-up sub-tasks.

**Out:** cryptographic tamper-evidence (v2); server-side role enforcement of audit
reads (WAFI-010).

### Edge cases
- Operator switch within a shift (WAFI-053) → attribution = the operator who
  **completes** the sale (locked PO decision); verify it follows the switch.
- Offline → attribution and audit entries created locally, never dropped on sync
  (Story 5.9); audit entries cannot be removed from the queue.
- Sale completed after idle timeout fired mid-sale (WAFI-062 edge) → still attributed.

### Acceptance Criteria
- [ ] A rung sale persists `employee_id` + `shift_id`; both appear on sale detail,
      customer history, and sales-history rows.
- [ ] Attribution follows operator switch (completer is recorded).
- [ ] A direct UPDATE or DELETE against an audit entry is rejected at the DB level.
- [ ] The audit action coverage list is checked off; any gaps are filed as named
      sub-tasks (or fixed here).

### Definition of Done
Test: ring a sale → assert `employee_id` + `shift_id` set; switch operator mid-shift →
next sale attributes to the new operator. Test: attempt UPDATE/DELETE on an audit row →
rejected. Coverage list reviewed and recorded in this ticket. Build green.

---

## Notes for the dev

- Two reviewed sub-items — **one-shift-per-device guard** (5.3) and **owner
  force-close** (5.7) — are deliberately **not** here; they live in the zombie-shifts
  ticket **WAFI-065** (`plans/2026-06-24-zombie-open-shifts.md`) because they are the
  core of that fix. WAFI-065 depends on the `force_closed_by` column added by WAFI-060.
- All shift schema changes should land as as few forward migrations as possible
  (ideally WAFI-059 + WAFI-060 share one) to reduce migration churn (WAFI-036/037).
- Respect WAFI-058 financial masking everywhere money is shown.
