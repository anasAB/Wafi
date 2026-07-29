# WAFI-010: Installment Plans + Returns Integration — Design

**Date:** 2026-07-29
**Status:** Approved, pending spec self-review
**Scope:** Phase 1 only (full-sale returns). Phase 2 (partial-return proration) is explicitly deferred.

## Problem

`useReturnSheet.ts` (returns) and `useInstallmentPlan.ts` (installment plans) have zero
awareness of each other. Confirmed via code audit 2026-07-29: no query in the returns
flow ever looks up `installment_plans`, and `cancelPlan()` is never called from a return.

Concretely: a customer buys something on an installment plan, later returns it (in full
or piecemeal across multiple return transactions) — the plan stays `active`, its
`installment_dues` keep being scheduled/reminded (`useSendInstallmentReminder`,
`useInstallmentsDueAlert`), and there is no audit link between the return and any plan
adjustment. The shop keeps trying to collect money for goods it no longer has, or (in
the defaulted case) an owner loses visibility into whether an overdue debt was resolved
by a return.

## Business rule

> A return never modifies paid installment history. It reduces the financed
> balance conceptually by ending the plan when the entire sale is returned, and
> touches nothing when the plan has already run its course (`completed`/`cancelled`).
> Partial returns and `defaulted` plans are explicitly out of automatic scope in
> Phase 1 — they require manual owner review, not silent code-driven adjustment.

Phase 2 (not in this spec) will add real proration: reducing `total_amount_usd` and
regenerating only *pending* dues for partial returns, per the phased plan agreed during
brainstorming.

## Scope: Phase 1

### 1. Detecting a full-sale return

A "full-sale return" is defined **cumulatively**, not per-transaction: after this
return is applied, every original line item in the sale has been fully returned. This
correctly captures the case where Item A was returned in Return #1 and Item B is
returned later in Return #2 — Return #2 is a full-sale return even though no single
transaction contains both items.

Computed in `useReturnSheet.confirm()` using data already loaded into `lines.value`
(`originalQty`, `alreadyReturnedQty`) — no new query required:

```
isFullSaleReturn = lines.value.every(line =>
  line.alreadyReturnedQty + (line.selected ? line.qtyToReturn : 0) >= line.originalQty
)
```

### 2. Plan lookup

Inside the same `db.writeTransaction` as the rest of `confirm()`, query:

```sql
SELECT id, status FROM installment_plans WHERE sale_id = ? AND status IN ('active', 'defaulted')
```

At most one row (a sale has exactly one plan, linked via `sale_id`, per `createPlan`).

### 3. Decision table

| Plan status found | Return completeness | Action |
|---|---|---|
| none (`completed`/`cancelled`, or no plan) | any | Return proceeds exactly as today. No warning — nothing outstanding to act on. |
| `active` | full-sale | Auto-cancel: void pending dues, set plan `cancelled`, audit-logged with `reason: 'sale_returned'`. |
| `active` | partial | Return proceeds; plan **not** mutated; surface warning (see below). |
| `defaulted` | full or partial | Return proceeds; plan **never** auto-cancelled; surface warning (see below). A defaulted plan already represents an active collections situation — silently erasing that debt via a routine return is a business decision the owner must make explicitly, not a side effect. |

### 4. Auto-cancel implementation

Extract the two `UPDATE` statements currently inline in `useInstallmentPlan.cancelPlan()`
into a shared helper so both the manual-cancel path and the return path use identical
SQL:

```ts
// useInstallmentPlan.ts
async function cancelPlanWithinTx(tx: Transaction, planId: string): Promise<void> {
  await tx.execute(
    `UPDATE installment_dues SET status = 'voided' WHERE plan_id = ? AND status = 'pending'`,
    [planId],
  )
  await tx.execute(
    `UPDATE installment_plans SET status = 'cancelled' WHERE id = ?`,
    [planId],
  )
}

async function cancelPlan(planId: string, reason: 'manual' | 'sale_returned' = 'manual', returnId?: string): Promise<void> {
  await executeFinancialWrite(
    async () => {
      await db.writeTransaction(async (tx) => {
        await cancelPlanWithinTx(tx, planId)
      })
    },
    () => logInstallmentPlanCancelled(planId, { reason, returnId }),
  )
}
```

`useReturnSheet.confirm()` calls `cancelPlanWithinTx(tx, planId)` directly inside its
own existing transaction (it cannot call `cancelPlan()` itself, since that opens its own
transaction and its own `executeFinancialWrite` — nesting either would be wrong).

### 5. Audit trail

`logInstallmentPlanCancelled` gains an optional reason param:

```ts
const logInstallmentPlanCancelled = (
  planId: string, opts: { reason?: 'manual' | 'sale_returned'; returnId?: string } = {},
) => _log('installment_plan.cancelled', 'installment_plan', planId, opts)
```

Both audit events for a return-triggered cancellation fire from the same
`executeFinancialWrite` success callback in `useReturnSheet.confirm()`, in the same
commit as the write:

```ts
() => {
  logReturnProcessed(returnId, saleId, refundAmountUsd)
  if (cancelledPlanId) logInstallmentPlanCancelled(cancelledPlanId, { reason: 'sale_returned', returnId })
}
```

Manual cancellation (existing entry point, e.g. an owner cancelling a plan directly)
continues to call `cancelPlan(planId)` with the default `reason: 'manual'` — no call-site
changes needed there beyond the new optional param.

### 6. Warning surfaced to the cashier

For the `active`+partial and `defaulted` (any completeness) rows in the decision table,
`confirm()` returns a result object instead of `void`:

```ts
type ConfirmResult = { warning?: 'active_plan_not_adjusted' | 'defaulted_plan_not_adjusted' }
```

`ReturnSheet.vue` checks this after `await confirm()` and shows a dialog:

> ⚠️ "Return processed. This sale has an [active / defaulted] installment plan — it
> was NOT adjusted. Please review the plan manually."

The return itself is never blocked by this — refund, restock, and audit logging all
complete normally regardless of the warning.

### 7. Atomicity

Because the plan lookup, cancellation, refund insert, and stock adjustments all happen
inside the single existing `db.writeTransaction` in `useReturnSheet.confirm()`, a
failure at any step (e.g. the refund insert throwing after the plan was already
cancelled in-transaction) rolls back the entire transaction — the plan cancellation and
the return are atomic by construction, not by convention.

## Testing

1. Full-sale return (single transaction) with `active` plan → plan cancelled, dues
   voided, both audit events present with `reason: 'sale_returned'` and correct
   `returnId` linkage.
2. Full-sale return achieved **cumulatively** across two return transactions (Item A
   returned first, Item B returned later) → the second return correctly detects
   `isFullSaleReturn = true` and cancels the plan.
3. Full-sale return with `completed` or `cancelled` plan (or no plan) → unchanged
   existing behavior (regression test), no warning.
4. Partial return with `active` plan → refund processes, plan untouched, `warning:
   'active_plan_not_adjusted'` returned.
5. Full or partial return with `defaulted` plan → refund processes, plan untouched,
   `warning: 'defaulted_plan_not_adjusted'` returned.
6. Partial return with no plan → unchanged existing behavior (regression), no warning.
7. **Atomicity test**: force a failure partway through the transaction (e.g. the refund
   insert) after the plan-cancel `UPDATE`s have executed in-transaction, and assert the
   plan's status is rolled back to `active` (not left `cancelled`) and no `returns` row
   exists — proving the cancellation and the return commit or fail together.

## Explicitly out of scope (Phase 2)

- Proration: reducing `total_amount_usd` and regenerating pending dues on partial
  returns, while leaving paid dues immutable.
- Any UI to manually trigger the Phase-2 proration path.
- Automatic handling of `defaulted` plans — remains manual/owner-driven indefinitely
  unless a future ticket decides otherwise.
