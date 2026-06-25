# In-Shift Cash Management — Design

> Date: 2026-06-25
> Status: Approved (pending spec review)
> Pack: Staff (+$5/mo) — protects the variance number the pack is sold on
> Sacred Rules touched: Arabic + dual currency (2), Offline-first (1)
> Origin: PO alignment review 2026-06-24/25 (Use Case A). Benchmark: Square, Loyverse, Lightspeed, Clover.
> Depends on: Epic 5 shift/variance plumbing (WAFI-059 opening cash, WAFI-060 immutable close evidence) — landed.

## Problem

The shift variance number ("did the drawer end where it should?") is the headline the
Staff Pack is sold on — it answers "is anyone stealing?". But the drawer legitimately
changes during the day for reasons that are **not sales, expenses, refunds, or credit
payments**: a supplier paid in cash, large bills dropped to a safe, the owner taking cash
out, a float top-up. Today the system knows none of these, so each one surfaces at close
as a **shortage** — a false theft signal. A POS that cries theft when nobody stole gets
abandoned, and the variance number stops being trusted (and so does the pack). This is
table-stakes in every comparable POS and is currently missing.

## Decisions (locked during brainstorming, 2026-06-25)

1. **Who can record:** the cashier running the shift can record movements — not owner/manager
   only. Blocking cashiers recreates the false-shortage problem (a cashier who pays a supplier
   with no manager present can't record it). The anti-fraud control is **immutable logging**
   (who + reason + time), not gating.
2. **Reason capture:** fixed category chips + an optional free-text note. Fast at the counter,
   groupable for owner review, with "Other" for edge cases.
3. **Corrections:** **void-with-reason** only. A recorded movement is never edited or deleted;
   a mistake is corrected by a reversing void row. Both stay visible and audit-logged —
   matching the append-only audit log (migration 018) and immutable Z-report (WAFI-060).
4. **Overdraw (pay-out/drop > cash the system shows):** **warn but allow**. The physical
   drawer is the source of truth; refusing to record a real-world action violates working
   principle #9 and just pushes the cashier to not record it. The warning + the resulting
   variance surface the discrepancy for review.
5. **Entry points:** **both** the cash-drawer drill-down screen (its natural home) and a quick
   action from the POS shift area.
6. **Dual currency:** USD and SYP both, each reconciling against its own drawer (mirrors the
   existing dual-drawer reconciliation). Each movement is single-currency.
7. **Dedicated table** (`cash_movements`), not a reuse of `expenses` — drawer movements are
   not business costs; conflating them would corrupt both the expense report and the profit
   calculation.

## Architecture

```
cash_movements (new table, RLS-scoped by shop_id, PowerSync-published)
  ├─ direction: 'in' | 'out'
  ├─ category:  fixed enum (directional)
  ├─ currency:  'USD' | 'SYP'   (each movement single-currency)
  ├─ amount:    raw in that currency (SYP integer per WAFI-035)
  ├─ shift_id, device_id, staff_id, shop_id, created_at
  └─ voids_movement_id: nullable → the movement this row reverses

reconciliation:
  computeCashReconciliation(input + cashPayIns{Usd,Syp} + cashPayOuts{Usd,Syp})
    expectedUsd = openingCashUsd + cashUsdSales + cashCreditPaymentsUsd + cashPayInsUsd
                  − cashExpensesUsd − cashRefundsUsd − cashPayOutsUsd
    expectedSyp = (same shape, SYP terms)
  useZReport: two SUM(amount) GROUP BY direction queries scoped by shift_id (per currency),
              fold into computeCashReconciliation; new fields land in the snapshot for free.
```

**Categories** (each fixed to one direction; UI shows only the categories valid for the chosen direction):
- **Out:** `paid_supplier` (دفع لمورد) · `drop_to_safe` (إيداع للخزنة) · `owner_withdrawal` (سحب المالك) · `other` (أخرى)
- **In:** `float_topup` (تغذية الصندوق) · `other` (أخرى)

## Components

- **Migration `027_cash_movements.sql`** — create `cash_movements`; add it to the table list in
  `015_rls_tenant_scoping.sql` scoping (per-shop `shop_id = auth_shop_id()`, append-only is NOT
  required here — voids replace edits, but UPDATE/DELETE should still be denied to keep the trail
  honest: grant INSERT + SELECT only, like a ledger); add to the PowerSync publication
  (`010_*` pattern). SYP amounts stored as integer.
- **`cash-movements` feature module** under `src/features/shifts/` (it belongs to the shift
  lifecycle) or a sibling `src/features/cash-movements/` — implementer's call, following the
  feature-first convention. Contains:
  - **`cashMovement.types.ts`** — `CashMovement`, `CashMovementCategory`, `CASH_MOVEMENT_CATEGORIES` (category→direction map + Arabic labels).
  - **`useCashMovements.ts`** — `record(input)`, `voidMovement(id, reason)`, `listForShift(shiftId)`, and `liveDrawer(shiftId)` (the running expected-cash figure per currency, for the overdraw check). All local-DB, offline-first. Writes audit-log entries on record + void.
  - **`RecordCashMovementSheet.vue`** — direction toggle → category chips (filtered by direction) → currency → amount → optional note → confirm. Inline overdraw warning. SYP integer-only input.
  - **`CashMovementsList.vue`** — list of this shift's movements; voided rows struck through; void action (owner/manager + the recording cashier). Reused on the drill-down (live) and `ShiftDetailScreen` (review).
- **`computeCashReconciliation`** (`cashReconciliation.ts`) — add optional `cashPayInsUsd/Syp`,
  `cashPayOutsUsd/Syp` (default 0, so existing callers/tests are unaffected).
- **`useZReport.ts`** — two new queries (pay-ins, pay-outs) summed by direction+currency scoped
  by `shift_id`; pass into `computeCashReconciliation`; add the four fields to `ZReportMetrics`
  and the Z-report print lines (under the existing "حساب الصندوق" block).
- **Entry points** — a button on the cash-drawer drill-down screen (`epic3-drill-down-cash-drawer`)
  and a quick action in the POS shift area, both opening `RecordCashMovementSheet`.

## Data flow

Cashier (mid-shift) taps "حركة نقدية" → picks direction/category/currency/amount/note → confirm.
If the amount exceeds `liveDrawer(shiftId)` for that currency, an inline warning shows but
confirm still works. A row is inserted into `cash_movements` (local), audit-logged, and synced
when online. At close, `useZReport` sums the shift's movements into the reconciliation, so
`expectedUsd/Syp` already account for them and variance reflects only the unexplained gap. The
movements are part of the Z-report snapshot persisted at close (immutable). A mistaken movement
is corrected by `voidMovement`, which inserts an opposite-direction row referencing the original;
both remain in the list and the sums net to zero.

## Error handling & edge cases

- **Overdraw** (out/drop > live drawer for that currency) → inline warning, allow confirm.
- **Void of a void** → not permitted; record a fresh movement instead.
- **Movement against a non-open shift** (closed / abandoned / force-closed) → blocked; there is
  no live drawer to move. The entry points are only shown while a shift is open on this device.
- **Amount ≤ 0** → rejected. **SYP non-integer** → rejected (WAFI-035 rule applied here from day one).
- **Offline** → fully local; syncs like every other table.
- **Multi-device** → movements carry `device_id` + `shift_id`, so (unlike expenses/credit
  payments, which scope by time window) they attribute cleanly to one shift with no double-count.

## Permissions

- **Record:** any operator running the shift (owner, manager, cashier). No new permission flag.
- **Void:** the operator who recorded it, or owner/manager. (Voids are themselves logged, so this
  is about reducing accidental cross-voiding, not security.)
- **Review:** the movements list on `ShiftDetailScreen` follows the existing financial-visibility
  gate (`can_view_reports`) for the amounts, consistent with WAFI-058.

## Out of scope (defer)

- **Owner anomaly alerts** on large/frequent pay-outs (that's roadmap Use Case B — depends on the
  WhatsApp epic; this feature produces the data it would consume).
- **Cross-currency movements** in a single entry (e.g. drop USD + SYP together) — record two.
- **Server-side enforcement** of who may record/void — client-gated like the rest of per-staff
  permissions until WAFI-010 (server-side role enforcement) lands. Tenant isolation (shop-vs-shop)
  is already server-enforced via migration 015.
- **Reasoned cash-count mid-shift** (blind recount) — separate feature.

## Definition of Done

- [ ] `cash_movements` table created (migration 027), RLS-scoped per shop, PowerSync-published, INSERT+SELECT only.
- [ ] Record sheet: direction → directional category chips → currency → amount → optional note; SYP integer-only; overdraw warns but allows.
- [ ] Cashier (not just owner/manager) can record; record + void both audit-logged.
- [ ] Void-with-reason inserts a reversing row; original + void both visible; sums net to zero; a void can't be voided.
- [ ] `computeCashReconciliation` and `ZReportMetrics` include pay-ins/pay-outs per currency; Z-report print + snapshot show them.
- [ ] Movements list on the cash-drawer drill-down (live) and `ShiftDetailScreen` (review, amount-gated by `can_view_reports`).
- [ ] Both entry points wired (drill-down + POS shift quick action); shown only while a shift is open.
- [ ] Blocked against closed/abandoned/force-closed shifts.
- [ ] Works offline; existing reconciliation callers/tests unaffected (new terms default 0).
- [ ] Unit tests: reconciliation per currency, void nets to zero, SYP integer, shift_id scoping, snapshot capture, overdraw-warn-but-allow, cashier-can-record.
