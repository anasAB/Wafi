# WAFI-007: Complete Audit Event Wiring Design

**Date:** 2026-07-23
**Status:** Approved
**Ticket:** WAFI-007 (P1, 1 sprint, "32+ event types, financial write wrapper, append-only")

## Context

Investigation found this ticket's headline requirements are already met:

- **46 distinct event types** are logged via `useAuditLog.ts` (536 lines) — well past the "32+" bar.
- **Append-only is solid, not just RLS-level**: migration `018_audit_log_append_only.sql`
  both revokes UPDATE/DELETE grants from `anon`/`authenticated` AND installs a
  `BEFORE UPDATE OR DELETE` trigger that raises for every role except a
  bypass-RLS superuser. No `SECURITY DEFINER` function anywhere writes to
  `audit_log`.
- A real, working viewer (`AuditLogPage.vue`, 1375 lines) exists with
  filtering, search, and pagination.

Two real gaps remain:

1. **"Financial write wrapper"** — the ticket's title implies a guarantee
   mechanism. Reading `useAuditLog.ts`'s own code comments shows this
   codebase deliberately treats sale/financial audit logging as **best-effort,
   never blocking** ("offline-first, the sale matters more than its log
   line" — confirmed against the real call site in `usePayment.ts`, where
   `logSaleCompleted` runs after the sale's transaction has already
   committed and UI state has already updated). A wrapper that makes audit
   logging a hard runtime guarantee (e.g. failing the sale if the log write
   fails) would **contradict this deliberate, existing decision** and is
   out of scope. What's missing instead is a **structural** guarantee: a
   single call site every financial-write composable goes through, so a
   *future* feature can't forget to wire up logging — with today's
   best-effort failure semantics preserved exactly as they are.

   This already exists, partially: `src/features/staff-ledger/composables/
   executeFinancialWrite.ts` is exactly this pattern (`write()` then
   `audit(result)`, "so a write can never ship without exactly one audit
   entry" per its own doc comment) — but it's scoped to the staff-ledger
   feature only, used by 2 of the 6 financial-write composables that exist
   (`useStaffLedger.ts`, `useStaffSettlement.ts`), and hardcodes a
   `can_view_expenses` permission check that's wrong for the other 4
   (sales, returns, cash movements, installments don't require that
   specific permission).

2. **`AuditLogPage.vue`'s filter dropdown is stale** — `eventOptions`
   (lines 47–77) lists only 28 of the 46 logged event types. Newer events
   (`operator.switched`, `installment_plan.*`, `device.*`,
   `staff_ledger.*`, `staff_settlement.*`, `category.*`, `auth.*`,
   `sync.dead_letter_discarded`) are logged and stored correctly, but a
   user can't filter the viewer by them.

## What's changing

### 1. Relocate and generalize `executeFinancialWrite`

Move `src/features/staff-ledger/composables/executeFinancialWrite.ts` to
`src/composables/executeFinancialWrite.ts` — matching this codebase's
existing convention for cross-feature composables (`useCan.ts`,
`useConnectionStatus.ts`, etc. already live there, as opposed to
feature-scoped `src/features/*/composables/`).

Generalize its permission check from hardcoded `can_view_expenses` to an
optional parameter:

```ts
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'

/**
 * Every financial-write composable calls this instead of writing + auditing
 * separately, so a write can never ship without exactly one audit entry
 * (originally WAFI-138 Invariant 9, generalized in WAFI-007 beyond
 * staff-ledger to every financial-write composable). Preserves this
 * codebase's existing best-effort audit semantics exactly: `write()` must
 * succeed for `audit()` to run at all, but a failure inside `audit()` itself
 * is `useAuditLog`'s own `_log`/`_logSensitive` distinction to handle (this
 * wrapper does not add its own try/catch around `audit()` — it doesn't
 * change failure semantics, only guarantees the call happens).
 */
export async function executeFinancialWrite<T>(
  write: () => Promise<T>,
  audit: (result: T) => Promise<void>,
  requiredPermission?: keyof StaffPermissions,
): Promise<T> {
  if (requiredPermission) {
    const session = useSessionStore()
    if (!canUserDo(session.activeStaff, requiredPermission)) {
      throw new Error(`permission denied: ${requiredPermission} required`)
    }
  }
  const result = await write()
  await audit(result)
  return result
}
```

`useStaffLedger.ts`/`useStaffSettlement.ts` update their import path and
pass `'can_view_expenses'` explicitly (behavior unchanged). The other 4
call sites (below) pass no permission argument — each is already gated at
the route/component level (WAFI-058 pattern: "never trust the router
alone" was the stated rationale for staff-ledger's *own* check, but sales/
returns/cash-movements/installments don't have an equivalent
single-permission gate to duplicate here; adding one would be scope creep
beyond what this ticket asked for).

### 2. Retrofit the remaining 4 call sites

Each of these currently does `await <db write>` then `await log*(...)`
directly, inline, in its own async function — restructure each to route
through `executeFinancialWrite`, preserving exact write logic and log
arguments (no behavior change):

- `src/features/payment/usePayment.ts` — the sale-completion path
  (`db.writeTransaction(...)` then `logSaleCompleted(saleId, ...)`).
- `src/features/returns/composables/useReturnSheet.ts` — return processing
  (`logReturnProcessed(...)`).
- `src/features/shifts/composables/useCashMovements.ts` — both `record()`
  (`logCashMovementRecorded`) and `voidMovement()`
  (`logCashMovementVoided`) — two separate financial writes in this file,
  each wrapped independently.
- `src/features/installments/composables/useInstallmentPlan.ts` — three
  separate writes: `createPlan()`, `recordDuePayment()`, `cancelPlan()`,
  each already calling its own `log*` function — each wrapped
  independently.

### 3. Backfill `AuditLogPage.vue`'s event filter

Add the ~18 missing event-type options to `eventOptions` so every event
`useAuditLog.ts` can produce is filterable in the viewer. This is additive
to an existing array literal — no structural change to the page.

## Testing

- Unit test for the generalized `executeFinancialWrite`: write succeeds →
  audit called with the write's result, returns the write's result;
  `requiredPermission` provided and denied → throws before `write()` runs;
  `requiredPermission` omitted → no permission check, write proceeds.
- For each of the 4 retrofitted composables: existing tests (if any) must
  still pass unchanged after the restructuring (this is a refactor, not a
  behavior change) — confirm by running each composable's existing test
  file before and after.
- `AuditLogPage.vue`: a test (or extension of an existing one) confirming
  the filter dropdown's option count/coverage matches `useAuditLog.ts`'s
  actual event set (so this doesn't silently drift again).

## Out of scope

- Any change to `useAuditLog.ts`'s `_log`/`_logSensitive` failure
  semantics — untouched.
- A hard runtime guarantee (transactional coupling, DB trigger) forcing
  every financial write to have a successful audit entry — deliberately
  rejected per the Context section above.
- Reconciling `sale.deleted` vs. a hypothetical `sale.voided` naming — a
  cosmetic difference, not a functional gap, not raised as a real problem.
- Any new event types beyond the existing 46 — the count already exceeds
  the ticket's "32+" bar.
