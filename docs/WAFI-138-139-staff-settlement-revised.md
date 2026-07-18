# WAFI-138 / WAFI-139 — Staff Settlement (Employee Payment)

**Date revised:** 2026-07-19
**Source:** Product Design Review panel (see review transcript) + founder response.
**Status:** Revised per review — supersedes the original single-Epic WAFI-138 draft.

---

## 🚨 Product Boundary Statement (unchanged, read first)

The Staff Settlement feature exists strictly to support store operations, cash accountability, and month-end cash reconciliation. It is **NOT** a general HR or payroll system. Any feature that primarily serves HR administration (automated overtime rules, vacation tracking, tax deductions, complex scheduling) is explicitly OUT OF SCOPE unless the core product vision is formally changed.

---

## What changed in this revision

| # | Change | Why |
|---|---|---|
| 1 | WAFI-122 (server-side role enforcement) is now a **hard, required dependency of WAFI-138b only** — not the whole Epic, and not "highly recommended." | This feature exposes salary, advances, and personal debt — the most sensitive data category in the product. Client-side-only gating on this data is unacceptable, even temporarily. WAFI-138a (ledger CRUD, no cross-device settlement) does **not** require it and can ship independently. |
| 2 | Added an explicit **offline finalization assumption** that must be verified and documented before 138b ships. | The "one Finalized settlement per employee per month" constraint plus locked-exchange-rate finalization is exactly the shape of feature that breaks under concurrent offline writes. Rather than build speculative conflict-resolution UI, the team must first confirm and record whether concurrent finalization is actually reachable in the current device/role model. |
| 3 | Split into **two tickets** instead of three sub-tickets under one Epic: **WAFI-138** (ledger + settlement, i.e. former 138a+138b) and **WAFI-139** (employee profile/performance, former 138c). | 138c has no financial coupling and was sharing a release train for no reason. Cleaner roadmap, independently prioritizable. |
| 4 | Added `employee_id`-only identity invariant. | Ledger and settlement records must reference `employee_id` exclusively — never name or phone — for all matching/aggregation logic. This is what makes the rehire edge case (name reappears, balance reappears) actually correct, and it was implicit rather than stated. |
| 5 | Added settlement numbering to Definition of Done. | Cheap, prevents "which settlement are you talking about" support ambiguity. Shop-scoped human-readable identifier, e.g. `#2026-03-AHMED-01`. |
| 6 | UI vocabulary explicitly decoupled from ledger enum names. | Database keeps `Advance / Bonus / Penalty / Carry_Forward / Write_Off / Correction`. Owner-facing UI shows plain-language actions: "Bonus," "Advance," "Forgive Debt," "Fix Previous Payment." No architecture change — a copy/labeling requirement only. |
| 7 | Carry-Forward-as-synthetic-ledger-row is called out as requiring an ADR. | This is an architectural decision (chosen over a normalized "applied" event model), not an implementation detail, and needs to be discoverable outside this ticket. See `docs/adr/ADR-XXX-carry-forward-ledger-row.md` (to be authored alongside 138 implementation). |
| 8 | Effort estimate revised from 1.5 weeks to **3-4 weeks** for WAFI-138 (ledger + settlement) alone; WAFI-139 estimated separately, ~2-3 days. | Original estimate did not account for RLS, dual-currency snapshot logic, partial-application math, the mandated "ripple effect" audit, and QA on the two hardest edge cases (Partial Advance, Negative Balance Carry-Forward) — all under offline conditions. |
| 9 | Adoption nudge (reminder to run month-end settlement) explicitly deferred, not forgotten. | Not MVP. Candidate to ride on the existing WhatsApp daily digest mechanism (already on the v1 roadmap) rather than requiring new infrastructure. Tracked as a forward-reference, not a requirement of this ticket. |
| 10 | Owner Dashboard reporting (outstanding advances, outstanding settlements, employees awaiting payment) explicitly deferred, not forgotten. | Not MVP. Forward-referenced for a future dashboard ticket once WAFI-138/139 data exists to report on. |

---

## WAFI-138 — Employee Ledger & Settlement (formerly 138a + 138b)

**Priority:** Important (High stickiness for Staff Pack)
**Effort:** ~3-4 weeks
**Dependencies:**
- Epic 5 (Cashier Shifts & Identity) — required, already shipped per project history.
- **WAFI-122 (Server-Side Role Enforcement) — REQUIRED before any ledger/settlement API is exposed. Not optional, not "recommended." This gate applies specifically from the point ledger data becomes readable/writable via API — i.e., it blocks shipping the write/read endpoints, not necessarily the schema/migration work itself.**

### Description
Build a lightweight, owner-facing "Employee Payment" (دفع الموظف) workflow that lets shop owners calculate and finalize month-end payouts for staff. The system aggregates a unified Employee Ledger (advances, bonuses, penalties, carry-forwards) combined with read-only operational data (POS activity days). The owner builds the settlement by toggling and applying ledger items, finalizes an immutable snapshot, and marks it as paid.

### Identity Invariant (new — must be enforced from the first migration)
All ledger entries, settlements, and any aggregation/display logic reference employees **exclusively by `employee_id`**. Employee name and role are only ever used as **display snapshots** (`employee_name_snapshot`, `employee_role_snapshot`) captured at settlement finalization time. Name or phone number must never be used as a matching key anywhere in ledger or settlement logic. This is what guarantees correct behavior when an employee is soft-deleted and later reactivated (rehire case): their `employee_id` persists, so their historical settlements and any outstanding negative ledger balance reappear correctly regardless of name changes in between.

### Offline Finalization Assumption (new — must be resolved and documented before implementation of the finalize action)
Before building the "Finalize" action, the team must explicitly determine and document one of the following:
- **(a)** Confirm that concurrent offline finalization of the same employee/month across two devices is not reachable given the current device/role model (e.g., only one `can_view_financials`-holding device per shop in practice), and record this as the stated assumption with its supporting reasoning.
- **(b)** If concurrent finalization is reachable (e.g., owner + manager both hold `can_view_financials` on separate devices), define and implement an explicit conflict behavior — reject-second-sync, first-sync-wins, or a surfaced conflict-resolution prompt — rather than relying on the database unique constraint to fail silently or ambiguously at sync time.

This decision must be written into the ticket/PR before the Finalize workflow ships. Building speculative conflict-resolution UI without first checking (a) is explicitly discouraged — resolve the ambiguity, don't default to the heaviest solution.

### Core Architecture & Golden Rules (unchanged from original spec)
- **Ledger Immutability:** The Settlement screen never edits underlying ledger rows directly. It only reads them.
- **The "Carry Forward" Trade-off:** When a partial application occurs (e.g., applying $70 of a $100 advance), the system creates a synthetic `Carry_Forward` ledger row for the remaining $30. This is chosen over a fully normalized "Applied" event model for v1 simplicity. **This decision requires an ADR** (see Definition of Done). Future engineers must not "fix" this into a derived-balance model without a major version bump.
- **Salary is Metadata:** Base Salary is the reason for the payment, not an adjustment to the employee's balance. Stored on the `employee_settlements` snapshot table, never in `employee_ledger`.
- **Settlement Consumes Ledgers:** A settlement takes a hard snapshot of the ledger as of the settlement timestamp. Later ledger entries do not modify historical settlements.
- **Strict Status Workflow:** Draft → Finalized (locked snapshot) → Paid.
- **Period Definition:** Calendar Month (v1).
- **Single Currency per Settlement:** A settlement record is finalized and paid in one currency only (USD or SYP). Split-currency payments for a single settlement are out of scope.

### Cross-Currency Ledger Display (new — must be resolved before settlement screen UI work)
When ledger entries exist in more than one currency for an employee (e.g., a USD advance and a SYP salary), the pre-settlement ledger view must not silently sum them into one number. Decide and document one of:
- **(a)** Display per-currency subtotals (e.g., "$100 USD outstanding · 500,000 SYP outstanding") with no combined total until a settlement currency is chosen, or
- **(b)** Show a combined total only after the owner has selected a settlement currency, using the rate locked at that moment, with entries in the non-selected currency clearly flagged as "not included — settle separately."

Do not auto-convert or silently combine currencies at any point before the owner has explicitly chosen a settlement currency.

### UI Vocabulary (new — clarifies existing enum requirement, no schema change)
Database/enum layer keeps: `Advance, Bonus, Penalty, Carry_Forward, Write_Off, Correction`.
Owner-facing UI must translate these into plain, task-oriented language, e.g.:
- `Advance` → "Advance" / "سلفة"
- `Bonus` → "Bonus" / "مكافأة"
- `Penalty` → "Penalty" / "خصم"
- `Write_Off` → "Forgive Debt" / "إسقاط الدين"
- `Correction` → "Fix Previous Payment" / "تصحيح دفعة سابقة"
- `Carry_Forward` → never manually created by the owner; system-generated only, shown as "Remaining Balance" in the UI, not exposed as a selectable action.

This is a UI/copy requirement, not an architecture change — internal types and API contracts are unaffected.

### Acceptance Criteria (unchanged unless noted)
- Unified Ledger: a single `employee_ledger` table stores all financial movements. Adding new ledger types requires a PR review (no dynamic types in v1).
- POS Activity & Performance: accurately displays distinct POS activity days for the selected period (performance metrics themselves move to WAFI-139).
- Flexible Application: owner can toggle ledger items on/off and edit the "Amount to Apply." Partial applications automatically generate a `Carry_Forward` ledger entry.
- Immutable Snapshots: finalizing a settlement creates a locked snapshot. Historical settlements cannot be mutated by future ledger entries. Settlement notes are locked upon finalization.
- Status Workflow: Draft → Finalized → Paid. Payment metadata (`paid_at`, `paid_by`, `payment_method`) captured on Paid.
- Employee Snapshotting: settlement stores `employee_id`, `employee_name_snapshot`, `employee_role_snapshot`.
- Dual-Currency Support: snapshot stores native USD amounts and the locked exchange rate at finalization. SYP is derived for display only.
- One Per Period: DB unique constraint — one Finalized settlement per `employee_id` per calendar month.
- **New:** Settlement Numbering: every settlement gets a shop-scoped, human-readable identifier (e.g., `#2026-03-AHMED-01`) generated at Draft creation, immutable thereafter.
- Permissions: gated by `can_view_financials` (Owner/Manager only). Cashiers cannot see this screen. **Enforcement must be server-side (WAFI-122), not client-only, before any ledger API is reachable.**
- Audit Trail: every ledger creation, settlement finalization, and payment action writes an immutable audit log entry, capturing the acting user's `employee_id`.
- Unpaid Finalization: an owner can finalize without marking Paid, and can create the next month's draft while the previous month remains unpaid (balance rolls over via the ledger).

### Edge Case Register (unchanged, must be tested)
- Advance Exceeds Salary (Negative Settlement)
- Write-Offs (Forgiving Debt) — must be an explicit ledger entry, never a silent delete
- Rehiring an Employee — soft-delete reversed, historical settlements and negative balance reappear (relies on the `employee_id` invariant above)
- Multi-Currency Mismatch — see Cross-Currency Ledger Display above
- Mid-Month Salary Change — handled naturally since salary is manual entry per settlement
- Bonus After Settlement — added as a new ledger entry in the following month, never edits the closed month
- Accidental "Paid" Click — requires a `Correction` entry, no "un-pay"
- Employee Name Change — historical settlements display the name snapshot, not the current name

### Definition of Done
- Database migration for `employee_ledger` and `employee_settlements` with Row Level Security (RLS).
- **ADR authored** for the Carry-Forward synthetic-row decision (`docs/adr/`), referencing this ticket.
- **Offline Finalization Assumption documented** per the section above, before the Finalize action is implemented.
- Composable logic for ledger aggregation and partial-application math, covered by passing Vitest tests, including cross-currency display logic.
- UI renders correctly in RTL, handles empty states, respects financial permissions, and uses plain-language labels (not raw enum names) for all owner-facing actions.
- Settlement numbering implemented and immutable post-creation.
- "Ripple Effect" audit completed: verified that ledger changes do not accidentally mutate shift variances or historical snapshots.
- QA pass on the "Partial Advance" and "Negative Balance Carry-Forward" flows, offline.
- PR includes an invariants-impact note covering dual-currency locking, single-currency settlement constraint, and the offline finalization assumption.
- **WAFI-122 confirmed shipped and enforced on all ledger/settlement endpoints before this ticket is merged to main.**

---

## WAFI-139 — Employee Profile & Performance (formerly 138c)

**Priority:** Nice-to-have (decoupled from Staff Pack core value; can ship after or independently of WAFI-138)
**Effort:** ~2-3 days
**Dependencies:** None beyond existing shift/sale data models. Does not depend on WAFI-122 (read-only, non-financial, already covered by existing role gating) or on WAFI-138 shipping first.

### Description
A dedicated read-only tab showing non-financial context for an employee: transactions processed, manual discounts applied, and shift variance for a selected period.

### Rules
- Strictly informational. No financial calculations happen here, and this tab performs no ledger reads.
- Fully decoupled from the settlement workflow — deferrable without affecting WAFI-138's value.

---

## Deferred (not part of either ticket, forward-referenced only)

- **Adoption nudge:** reminder mechanism (dashboard card, badge, or WhatsApp digest inclusion) to prompt owners to run month-end settlement. Candidate: extend the existing WhatsApp daily digest rather than build new infrastructure.
- **Owner Dashboard reporting:** outstanding employee advances, outstanding settlements, employees awaiting payment. Requires WAFI-138 data to exist first; track as a future ticket once usage data is available.

---

## Data Analyst Lens & KPIs (unchanged)

**Events to track:**
- `settlement_finalized` (`employee_id`, `period`, `amount_usd`, `currency_used`, `has_negative_balance`)
- `settlement_paid` (`employee_id`, `period`, `time_to_pay_hours`, `payment_method`)
- `ledger_entry_created` (`type`, `amount_usd`)

**Product success KPIs:**
- % of active shops that finalize at least one settlement in-app per month.
- Average time from Draft to Paid status.
- % of employees with at least one recorded advance.

**Business insight (not a product KPI):**
- % of employees with a negative ledger balance at month-end.

---

## Integration Warnings (Ripple Effect) — updated

- **Permissions (WAFI-058 / WAFI-122):** WAFI-122 is now a **hard gate on WAFI-138**, not a warning. Do not expose ledger APIs to unauthenticated or cashier-level requests under any circumstance, temporary or otherwise.
- **Audit Log:** `employee_ledger` is a financial record. Every write must carry an audit log entry with the acting user's `employee_id`. No silent background updates to the ledger.
- **Offline sync:** confirm how `employee_ledger`/`employee_settlements` writes are handled by the existing sync engine (PowerSync/ElectricSQL/RxDB) — verify this is the same mechanism used for sales, or scope any bespoke handling explicitly, before implementation begins.
