# WAFI-138 — Staff Ledger & Settlement: Design Spec

**Date:** 2026-07-19
**Status:** Approved for planning
**Supersedes:** `docs/WAFI-138-139-staff-settlement-revised.md` (product/scope revision) for implementation-level detail. That document remains authoritative for product scope, Epic split (WAFI-138 vs WAFI-139), and the WAFI-122 hard-gate decision.

---

## Non-Goals

This feature intentionally does not:
- Calculate payroll, overtime, or tax.
- Approve leave or manage scheduling.
- Generate legally-binding payslips.
- Support split-currency payment within a single settlement.
- Provide automatic currency conversion between ledger entries and a settlement's chosen currency.
- Build conflict-resolution UI for concurrent offline finalization (see Offline Conflict Strategy).

If a future request expands into any of the above, treat it as a new Epic requiring a formal product-vision decision, not an extension of WAFI-138.

---

## Invariants (Must Never Be Broken)

1. `staff_ledger` is append-only; rows are never updated or deleted.
2. `finalize()` is the only function ever allowed to assign a ledger row's `settlement_id`.
3. A finalized settlement is immutable; later ledger entries never modify a historical settlement.
4. `markPaid()` records payment metadata only — it never recalculates financial values.
5. Historical settlements store name/role snapshots and display them regardless of later staff record changes.
6. Base salary is settlement metadata, never a `staff_ledger` entry.
7. Monetary values are stored internally in USD; SYP is derived for display using the entry's or settlement's own locked rate — never recomputed at read time from a live rate.
8. Only one `finalized`/`paid` settlement is allowed per `staff_id` per calendar month (enforced by DB constraint).
9. Every financial write emits exactly one audit log entry, enforced by a shared write wrapper, not by convention.
10. `finalize()` executes inside a single local-database transaction — all steps commit together or none do.
11. Corrections are new ledger entries, never edits to existing rows.
12. Ledger rows are atomic: partial application never mutates a ledger row. The original row is linked to the settlement as fully consumed; a new, separate `carry_forward` row is created for the unapplied remainder.

---

## Data Model

### `staff_ledger`
```sql
CREATE TYPE staff_ledger_entry_type AS ENUM
  ('advance', 'bonus', 'penalty', 'carry_forward', 'write_off', 'correction');

CREATE TYPE staff_ledger_source_type AS ENUM ('manual', 'shift', 'settlement');

CREATE TABLE public.staff_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id),
  entry_type staff_ledger_entry_type NOT NULL,
  amount_usd NUMERIC NOT NULL CHECK (amount_usd > 0),
  currency_entered TEXT NOT NULL CHECK (currency_entered IN ('usd','syp')),
  locked_rate NUMERIC,
  note TEXT,
  source_type staff_ledger_source_type NOT NULL DEFAULT 'manual',
  source_id UUID,
  created_by_staff_id UUID NOT NULL REFERENCES public.staff(id),
  client_operation_id UUID NOT NULL UNIQUE,
  settlement_id UUID REFERENCES public.staff_settlements(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK ((locked_rate IS NULL) = (currency_entered = 'usd'))
);
```
- `amount_usd` is always positive. Direction is entirely determined by `entry_type` (advance/penalty/carry_forward reduce a settlement; bonus increases it; write_off removes an outstanding debt; correction's effect is documented in its own `note`).
- `settlement_id` starts `NULL` (outstanding) and is set exactly once, only by `finalize()`.
- `client_operation_id` guards against duplicate inserts from offline write retries.
- `source_type`/`source_id` give audit lineage (e.g. a future shift-variance-sourced penalty), without requiring a join for the common `manual` case.

### `staff_settlements`
```sql
CREATE TYPE staff_settlement_status AS ENUM ('draft','finalized','paid');
CREATE TYPE staff_settlement_payment_method AS ENUM ('cash','bank','other');

CREATE TABLE public.staff_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id),
  settlement_number TEXT NOT NULL,
  period_month DATE NOT NULL,
  status staff_settlement_status NOT NULL DEFAULT 'draft',
  base_salary_usd NUMERIC,
  settlement_currency TEXT CHECK (settlement_currency IN ('usd','syp')),
  locked_rate NUMERIC,
  applied_amount_usd NUMERIC,
  final_amount_usd NUMERIC,
  notes TEXT,
  staff_name_snapshot TEXT,
  staff_role_snapshot TEXT,
  finalized_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_by_staff_id UUID REFERENCES public.staff(id),
  payment_method staff_settlement_payment_method,
  client_operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK ((locked_rate IS NULL) = (settlement_currency IS NULL OR settlement_currency = 'usd'))
);
-- No blanket UNIQUE here: a Draft may exist freely per staff+month.
-- Only Finalized/Paid rows are constrained, via the partial index below.

CREATE UNIQUE INDEX staff_settlements_one_finalized_per_period
  ON public.staff_settlements (shop_id, staff_id, period_month)
  WHERE status IN ('finalized', 'paid');
```
- `settlement_number`: `{YYYYMM}-{last 6 chars of id, uppercased}`, e.g. `202603-4F92B1`. Human-referenceable, collision-proof (not name-based), generated client-side at Draft creation from the row's own `id` — no server sequence required.
- A Draft may exist freely without competing for uniqueness; only Finalized/Paid rows are constrained to one per staff per month.

---

## Composables

`src/features/staff-ledger/composables/useStaffLedger.ts`
- `addLedgerEntry({ staffId, entryType, amountUsd | amountSyp, note, sourceType?, sourceId? })` — via `executeFinancialWrite()`.
- `getOutstandingEntries(staffId)` — entries where `settlement_id IS NULL`, grouped by `currency_entered` (per-currency subtotals; no blended total).

`src/features/staff-ledger/composables/useStaffActivity.ts`
- `getPosActivityDays(staffId, periodMonth)` — read-only: `SELECT DISTINCT date(opened_at) FROM cashier_shifts WHERE shop_id=? AND staff_id=?` for the month. Kept separate from the ledger composable since it is operational reporting, not a financial mutation, and other future consumers (an employee dashboard) shouldn't need to import ledger code to use it.

`src/features/staff-ledger/composables/useStaffSettlement.ts`
- `createDraft(staffId, periodMonth)` → returns `{ settlement, resumed: boolean }`. If a draft already exists for that staff+month, `resumed: true` and the UI shows "Resuming existing draft for March" rather than silently substituting it.
- `applyLedgerEntry(settlementId, ledgerEntryId, applyAmountUsd)` — in-memory only until finalize; validates `applyAmountUsd <= remaining` here (UI-facing validation), re-validated again in `finalize()`.
- `finalize(settlementId, { settlementCurrency, baseSalaryUsd, notes })` — the only writer of `settlement_id`. Executes as a single local-DB write transaction, in this exact order:
  1. Lock exchange rate.
  2. Re-read outstanding ledger entries fresh (not from stale UI state).
  3. Re-validate every applied amount ≤ remaining.
  4. Create `carry_forward` rows for any unapplied remainders.
  5. Set `settlement_id` on every consumed ledger row.
  6. Write the settlement snapshot (status → `finalized`, name/role snapshot, locked rate, totals).
  7. Write the audit entry.
  8. Commit.

  On a unique-constraint violation (a second device raced and already finalized this staff+month): abort the transaction, reload the existing finalized settlement, and surface "This settlement was already finalized" — no auto-merge, no silent overwrite.
- `markPaid(settlementId, { paymentMethod })` — sets `paid_at`/`paid_by_staff_id`/`payment_method`, status → `paid`. Performs no financial recalculation.

**`executeFinancialWrite()`** — a shared wrapper used by every mutating function above. Guarantees exactly one audit log entry per write by construction (the wrapper calls `useAuditLog()` itself), so a future function added to this feature cannot skip audit logging by omission.

**Defense in depth:** every write function above checks `can_view_expenses` internally (via the existing `permissionsForRole`/staff permissions check) and throws if absent — in addition to route-level gating in `src/router/permissions.ts`. The router is not trusted as the sole enforcement point.

---

## Permission Gating

Reuses the existing `can_view_expenses` flag (owner-grantable to managers, default-off, per the existing `permissionsForRole` pattern in `staff.types.ts`). No new permission field. Owner: always true. Manager: grantable by owner. Cashier: never has access to this flag, screen, or composable writes.

---

## Offline Conflict Strategy

*(Renamed from "Offline Finalization Assumption" — this is an intentional product decision, not a passive assumption.)*

Concurrent finalization of the same `staff_id` + `period_month` from two offline devices is judged not to be a realistic scenario in v1: settlements are typically run by a single owner, or an owner and one trusted manager who rarely act on the same staff member's settlement simultaneously. The unique index on `(shop_id, staff_id, period_month) WHERE status IN ('finalized','paid')` is the safety net, not a UI feature: if violated at sync time, the losing device's `finalize()` fails with a clear "already finalized" message (see `finalize()` step above) and the user is directed to review the existing settlement. No conflict-merge UI is built for this release. Revisit if manager-level finalization access becomes common enough to make concurrent attempts likely.

---

## UI / Workflow Notes

- **Finalize** and **Mark as Paid** both disable all inputs and show a progress indicator for the duration of the write, and block double-submission.
- **Finalize** requires a confirmation dialog: "This action cannot be edited later." / Cancel / Finalize.
- **Mark as Paid** requires a confirmation dialog with explicit payment method selection (Cash / Bank / Other) before confirming.
- Explicit empty-state copy:
  - Ledger, no outstanding entries: "No outstanding entries."
  - Draft, no ledger movements this month: "No financial movements for this month."
  - Settlement history, none yet: "No finalized settlements."
- Staff-list search: noted as a nice-to-have for shops with many staff; **deferred**, not part of this ticket's scope.
- Owner-facing labels map from enum values as follows (UI copy only, no schema impact): `advance` → "Advance / سلفة", `bonus` → "Bonus / مكافأة", `penalty` → "Penalty / خصم", `write_off` → "Forgive Debt / إسقاط الدين", `correction` → "Fix Previous Payment / تصحيح دفعة سابقة"; `carry_forward` is never a selectable owner action — system-generated only, shown as "Remaining Balance."

---

## Testing Plan

- Vitest unit tests: partial-application math (including SYP→USD conversion at the entry's own locked rate, not the settlement's), negative-balance settlements, per-currency subtotal grouping, `client_operation_id` de-duplication on retry.
- Component tests for the settlement draft screen: Partial Advance and Negative Balance Carry-Forward flows (the two named edge cases from the product ticket).
- **Crash-recovery test:** simulate an interruption partway through `finalize()`'s transaction and verify no partial commit — either the full snapshot exists or none of it does.
- **Permission tests:** owner ✓, manager-with-`can_view_expenses` ✓, cashier ✗ — explicit, not incidental.
- **Snapshot-integrity test:** rename a staff member after their settlement is finalized; the historical settlement must still display the old `staff_name_snapshot`.
- Manual offline QA pass: create ledger entries offline → finalize offline → sync → verify the finalized snapshot is unchanged post-sync and a second device sees the correct outstanding balance.

---

## Definition of Done

- Migration for `staff_ledger` and `staff_settlements` (enums, constraints, RLS) — carries the Offline Conflict Strategy paragraph as a SQL comment.
- ADR authored: `docs/adr/ADR-008-carry-forward-ledger-row.md`, referencing this spec and invariant #12.
- `executeFinancialWrite()` shared wrapper implemented and used by every mutating function in this feature.
- Vitest coverage per Testing Plan above, including crash-recovery and permission tests.
- UI renders correctly in RTL, empty states as specified, plain-language labels (not raw enum names).
- Ripple-effect check: this feature's composables write only to `staff_ledger` and `staff_settlements` — no writes to `cashier_shifts`, `sale_payments`, or any Z-report-feeding table.
- PR includes an invariants-impact note covering: dual-currency locking, single-currency-per-settlement constraint, and the Offline Conflict Strategy.
- **WAFI-122 confirmed shipped and enforced on all `staff_ledger`/`staff_settlements` API access before this ticket merges to main.**

---

## Open Items Explicitly Deferred (not blockers for this spec)

- Materialized/projected ledger balance (currently computed by summing outstanding rows on read) — revisit if per-staff ledger history grows large enough to matter.
- Staff-list search UI.
- Adoption nudge (WhatsApp digest reminder) and Owner Dashboard reporting on outstanding settlements — tracked in `docs/WAFI-138-139-staff-settlement-revised.md`, out of scope here.
