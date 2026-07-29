# WAFI-010: Installment Plans + Returns Integration — Design

**Date:** 2026-07-29
**Status:** Approved, revised after user review (concurrent-returns race fixed, plan-lookup future-proofed, audit/warning semantics tightened)
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

**Must be computed from a fresh in-transaction read, not from the `lines.value`
snapshot taken when the sheet was opened** — see §8 for why (concurrent returns on the
same sale) and the exact query sequence to use. The conceptual check is the same either
way:

```
isFullSaleReturn = every product on the sale has
  (cumulative returned qty, including this return) >= original sale qty
```

### 2. Plan lookup

Inside the same `db.writeTransaction` as the rest of `confirm()`, query:

```sql
SELECT id, status FROM installment_plans WHERE sale_id = ?
```

At most one row — installment plans are linked 1:1 to a sale when they exist (0 rows
if the sale was never plan-financed).

Deliberately **not** filtered by status in the query itself. The business rule is
"`completed`/`cancelled` are terminal, everything else deserves attention" — not
"`active` and `defaulted` are the two special cases." Filtering in SQL would silently
absorb any future status value (e.g. a hypothetical `paused` or `disputed`) into
whichever bucket happens to match the `IN (...)` list, with no forcing function to
revisit this ticket. Fetching the plan unconditionally and branching in code (the
decision table below) means a new status value falls through to an explicit `default`
case instead of disappearing silently. **Note:** `defaulted` has no writer anywhere in
the current codebase (`useInstallmentPlan.ts` never sets it) — it exists in the type
union and schema comment but is currently unreachable. Handled defensively anyway,
since the schema permits it.

### 3. Decision table

| Plan status found | Return completeness | Action |
|---|---|---|
| `completed` / `cancelled` / no row | any | Return proceeds exactly as today. No warning — nothing outstanding to act on. |
| `active` | full-sale | Auto-cancel: void pending dues, set plan `cancelled`, audit-logged with `reason: 'sale_returned'`. |
| `active` | partial | Return proceeds; plan **not** mutated; surface warning (see below). |
| `defaulted` | full or partial | Return proceeds; plan **never** auto-cancelled; surface warning (see below). A defaulted plan already represents an active collections situation — silently erasing that debt via a routine return is a business decision the owner must make explicitly, not a side effect. |
| anything else (future status) | any | Treated the same as `active`+partial: return proceeds, plan untouched, generic manual-review warning. Never silently falls into the terminal (no-warning) branch. |

### 4. Auto-cancel implementation

Extract the two `UPDATE` statements currently inline in `useInstallmentPlan.cancelPlan()`
into a shared helper so both the manual-cancel path and the return path use identical
SQL:

`cancelPlanWithinTx` voids only dues with `status = 'pending'` — **paid dues are never
touched**, preserving the immutable-payment-history invariant stated in the business
rule above. It returns whether it actually changed anything (a plan already
`cancelled`/`completed` by a concurrent transaction, see §8, changes nothing), so the
caller's audit-logging decision is driven by the helper's own result rather than by
stale outside state:

```ts
// useInstallmentPlan.ts
async function cancelPlanWithinTx(tx: Transaction, planId: string): Promise<boolean> {
  const dueResult = await tx.execute(
    `UPDATE installment_dues SET status = 'voided' WHERE plan_id = ? AND status = 'pending'`,
    [planId],
  )
  const planResult = await tx.execute(
    `UPDATE installment_plans SET status = 'cancelled' WHERE id = ? AND status IN ('active', 'defaulted')`,
    [planId],
  )
  return (planResult as any).rowsAffected > 0
}

async function cancelPlan(planId: string, reason: 'manual' | 'sale_returned' = 'manual', returnId?: string): Promise<void> {
  await executeFinancialWrite(
    async () => {
      let cancelled = false
      await db.writeTransaction(async (tx) => {
        cancelled = await cancelPlanWithinTx(tx, planId)
      })
      return cancelled
    },
    (cancelled) => cancelled ? logInstallmentPlanCancelled(planId, { reason, returnId }) : Promise.resolve(),
  )
}
```

`useReturnSheet.confirm()` calls `cancelPlanWithinTx(tx, planId)` directly inside its
own existing transaction (it cannot call `cancelPlan()` itself, since that opens its own
transaction and its own `executeFinancialWrite` — nesting either would be wrong), and
only calls `logInstallmentPlanCancelled` when the helper's return value is `true`.

### 5. Audit trail

`logInstallmentPlanCancelled` gains an optional reason param:

```ts
const logInstallmentPlanCancelled = (
  planId: string, opts: { reason?: 'manual' | 'sale_returned'; returnId?: string } = {},
) => _log('installment_plan.cancelled', 'installment_plan', planId, opts)
```

Both audit events for a return-triggered cancellation are emitted only after the
enclosing transaction commits successfully — the callback-based wiring below is the
implementation of that guarantee, not the guarantee itself:

```ts
() => {
  logReturnProcessed(returnId, saleId, refundAmountUsd)
  if (planWasCancelled) logInstallmentPlanCancelled(cancelledPlanId, { reason: 'sale_returned', returnId })
}
```

Manual cancellation (existing entry point, e.g. an owner cancelling a plan directly)
continues to call `cancelPlan(planId)` with the default `reason: 'manual'` — no call-site
changes needed there beyond the new optional param.

**Audit-write failure semantics are unchanged by this ticket.** `executeFinancialWrite`
guarantees the audit *call* happens after a successful write commit; it does not
strengthen `useAuditLog`'s own best-effort failure handling. A financial write can still
succeed with its audit entry missing, exactly as today for every other financial-write
composable — this ticket does not introduce or fix that; see `executeFinancialWrite.ts`'s
own doc comment.

### 6. Warning surfaced to the cashier

For every non-terminal row in the decision table where the plan isn't auto-cancelled
(`active`+partial, `defaulted`, and the future-status fallback), `confirm()` returns a
result object instead of `void`:

```ts
type ConfirmResult = { warning?: { type: 'plan_requires_manual_review'; planStatus: string } }
```

A single warning shape parameterized by `planStatus` (rather than one enum value per
status) so a future plan status doesn't require a matching new enum value — the UI
message interpolates `planStatus` directly.

`ReturnSheet.vue` checks this after `await confirm()` and shows a message informing the
cashier the plan wasn't touched and needs manual review; the exact presentation
(dialog/toast/banner) is a UI decision left to implementation, not specified here.

The return itself is never blocked by this — refund, restock, and audit logging all
complete normally regardless of the warning.

### 7. `installment_dues.status` invariant (pending vs. overdue)

`cancelPlanWithinTx` voids dues `WHERE status = 'pending'`. This is correct only because
`installment_dues.status` has exactly three persisted values — `'pending' | 'paid' |
'voided'` (`installment.types.ts`) — and "overdue" is **not** one of them. Overdue is a
display-time bucket (`getDueBucket`, `DueBucket` type) computed from `due_date` vs.
today at read time; a due that is overdue is still stored as `status = 'pending'`. So
`WHERE status = 'pending'` already voids overdue-but-unpaid dues along with not-yet-due
ones — there is no separate persisted "overdue" state that this query could miss. This
invariant is load-bearing for §3/§4 and is called out explicitly here so a future schema
change (e.g. persisting an `'overdue'` status) doesn't silently break the void.

### 8. Atomicity and concurrency

**Same-transaction atomicity (as designed):** the plan lookup, cancellation, refund
insert, and stock adjustments all happen inside the single existing
`db.writeTransaction` in `useReturnSheet.confirm()`. A failure at any step (e.g. the
refund insert throwing after the plan was already cancelled in-transaction) rolls back
the entire transaction — the plan cancellation and the return are atomic by
construction, not by convention.

**Concurrent plan mutation (owner cancels while a return is in flight):** covered by
`cancelPlanWithinTx`'s `AND status IN ('active', 'defaulted')` guard (§4) and its
boolean return value — if another transaction already moved the plan to `cancelled` or
`completed` before this transaction's `UPDATE` runs, the guard clause matches zero rows,
the helper returns `false`, and no duplicate `sale_returned` audit entry is logged. Beyond
this guard, ordinary database transaction-isolation semantics apply; no additional
conflict-resolution logic is introduced by this ticket.

**Concurrent returns on the same sale (the important one):** `isFullSaleReturn` (§1) as
originally scoped read `alreadyReturnedQty` from `lines.value`, populated when the
return sheet was *opened* — stale by the time `confirm()` runs if a second return on the
same sale was confirmed in between. Two cashiers opening separate return sheets for the
same sale, each returning a disjoint subset of lines, could each compute
`isFullSaleReturn = false` from their own stale snapshot even though the combined effect
of both returns exhausts every line — leaving an active plan on a fully-returned sale,
silently reproducing the exact bug this ticket exists to fix.

**Fix:** `isFullSaleReturn` must be (re-)computed *inside* the `db.writeTransaction`,
from a fresh read of `return_line_items`/`sale_line_items` at that moment — not from the
`lines.value` snapshot taken at sheet-load time. Sequence inside the transaction:

1. Insert this return's `returns`/`return_line_items` rows (as today).
2. Re-query total returned quantity per product for this `sale_id` from
   `return_line_items` (now including the row just inserted in step 1).
3. Compare against `sale_line_items.quantity` per product; `isFullSaleReturn` is true
   only if every product's cumulative returned quantity now meets its original quantity.
4. Proceed to the plan lookup/decision table using this freshly-computed value, not the
   `lines.value` snapshot.

This makes the two-return cumulative case (§1's original "Return #1 / Return #2"
example) correct even when the two returns are concurrent, not just sequential.

## Testing

1. Full-sale return (single transaction) with `active` plan → plan cancelled, dues
   voided (pending only — a pre-existing `paid` due on the same plan is asserted
   unchanged), both audit events present with `reason: 'sale_returned'` and correct
   `returnId` linkage.
2. Full-sale return achieved **cumulatively** across two *sequential* return
   transactions (Item A returned first, Item B returned later) → the second return
   correctly detects `isFullSaleReturn = true` (via the fresh in-transaction read, §8)
   and cancels the plan.
3. Full-sale return with `completed` or `cancelled` plan (or no plan) → unchanged
   existing behavior (regression test), no warning.
4. Partial return with `active` plan → refund processes, plan untouched, `warning:
   { type: 'plan_requires_manual_review', planStatus: 'active' }` returned.
5. Full or partial return with `defaulted` plan → refund processes, plan untouched,
   `warning: { type: 'plan_requires_manual_review', planStatus: 'defaulted' }` returned.
6. Partial return with no plan → unchanged existing behavior (regression), no warning.
7. **Atomicity test**: force a failure partway through the transaction (e.g. the refund
   insert) after the plan-cancel `UPDATE`s have executed in-transaction, and assert the
   plan's status is rolled back to `active` (not left `cancelled`) and no `returns` row
   exists — proving the cancellation and the return commit or fail together.
8. **No duplicate cancellation audit**: plan is `active`; a manual `cancelPlan(planId)`
   commits first (plan now `cancelled`); a full-sale return on the same sale is
   confirmed afterward → `cancelPlanWithinTx` matches zero rows (guard clause, §8),
   returns `false`, and no second `installment_plan.cancelled` audit entry with
   `reason: 'sale_returned'` is emitted for a plan that was already cancelled.
9. **Concurrent returns on the same sale**: sale has two line items (A, B) and an
   `active` plan. Simulate two return transactions each returning one line item, with
   the second transaction's in-transaction re-read (§8) occurring after the first has
   committed → the second return's freshly-computed `isFullSaleReturn` is `true` and it
   cancels the plan, proving the fix is not defeated by two return sheets having been
   opened from stale, pre-either-return snapshots.

## Explicitly out of scope (Phase 2)

- Proration: reducing `total_amount_usd` and regenerating pending dues on partial
  returns, while leaving paid dues immutable.
- Any UI to manually trigger the Phase-2 proration path.
- Automatic handling of `defaulted` plans — remains manual/owner-driven indefinitely
  unless a future ticket decides otherwise.
