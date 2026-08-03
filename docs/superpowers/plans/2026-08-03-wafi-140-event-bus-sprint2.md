# WAFI-140 Sprint 2 — Idempotency, Offline Replay, and 8 More Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Sprint 1's two open gaps (subscriber double-processing, silent publish-failure loss)
and wire the events that have a real write site today, per the approved design spec.

**Architecture:** A local-only, at-most-once processed-event ledger (`local_event_processed_ledger`)
guards subscriber re-processing; a local-only publish-failure retry queue
(`local_event_publish_retries`) with exponential backoff and transient/permanent classification
recovers from failed `publishEvent()` calls. Both new tables use PowerSync's existing `{ localOnly:
true }` `Table` option (same mechanism `sync_dead_letter` already uses) — no Postgres migration, no
RLS, no publication wiring needed for either. Eight new typed events are wired at their real call
sites, six of them retrofitted onto the existing `executeBusinessOperation` wrapper, one published
directly (`device.registered`), and one (`customer.debt_changed`) published directly alongside an
existing `executeBusinessOperation` call since the wrapper supports only one event per write.

**Tech Stack:** Vue 3, TypeScript, PowerSync (`@powersync/web`), Vitest.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-03-wafi-140-event-bus-sprint2-design.md` — read in
  full before implementing any task; this plan assumes familiarity with it.
- **Scope correction found during planning, not in the design spec:** `supplier.receiving_posted`
  is dropped from this sprint. `useReceivingSheet.ts confirm()` calls `receiveStock()` in
  `src/services/inventory.service.ts`, which **already** publishes `stock.received` (wired in Sprint
  1) from that exact call site. Adding a second event there would be the identical
  same-call-site-double-fire redundancy Sprint 1 explicitly avoided for
  `customer.debt_changed`/`installment.due_paid` — so it is not built. This sprint wires **8**
  events (the design spec's 9-candidate list minus this one drop): `sale.returned`,
  `customer.debt_changed`, `cash.movement_recorded`, `stock.taken`, `product.price_changed`,
  `product.cost_updated`, `product.created`, `device.registered`.
- `device.registered`'s `staffId` is genuinely unavailable at first-run (before any staff/operator
  exists — this is the exact circular-bootstrap scenario `useDeviceRegistration.ts`'s own doc
  comment describes). Per Sprint 1's own precedent (`paySettlement`'s `shopId: ''`), this sprint
  emits `staffId: ''` when no session exists, not a blocking condition — documented in Task 8, not
  silently swallowed.
- `db.writeTransaction` is a real, already-used PowerSync API (`useReturnSheet.ts:162`) — the design
  spec's "confirm this against PowerSync's real API" caveat for the retry-then-delete atomicity is
  **confirmed real**, not hypothetical, for this codebase.
- Every new event's `type` field must be a `DomainEventType` value from a `const` object — never a
  raw string literal at a new call site (unchanged from Sprint 1's rule).
- `local_event_processed_ledger` / `local_event_publish_retries` are PowerSync `Table({...}, {
  localOnly: true })` instances, registered in `AppSchema` exactly like every synced table — this is
  the established pattern (`sync_dead_letter`, `schema.ts:322-331`), not a new mechanism.

---

### Task 1: Local-only tables — ledger + retry queue

**Files:**
- Modify: `src/data/powersync/schema.ts` (insert new `Table` definitions near `sync_dead_letter`,
  register in `AppSchema`)

**Interfaces:**
- Produces: `local_event_processed_ledger` (`subscriber_id`, `event_id`, `processed_at`) and
  `local_event_publish_retries` (`id`, `serialized_event`, `failure_kind`, `attempts`, `last_error`,
  `next_retry_at`, `created_at`) PowerSync local-only tables. Tasks 3 and 4 depend on both existing.

- [ ] **Step 1: Add the two `Table` definitions**

Insert directly below the existing `sync_dead_letter` block (`schema.ts:331`, after its closing
`}, { localOnly: true })`):

```ts
// WAFI-140 Sprint 2 — at-most-once guard for subscriber re-processing (design spec §3).
// Local-only: single-device replay protection only, not cross-device dedup (see spec §3).
const local_event_processed_ledger = new Table({
  subscriber_id: column.text,
  event_id:      column.text,
  processed_at:  column.text,
}, { localOnly: true })

// WAFI-140 Sprint 2 — publish-failure retry queue (design spec §4).
const local_event_publish_retries = new Table({
  serialized_event: column.text,  // JSON.stringify(DomainEvent) -- see design spec §4 for why
                                   // this duplicates events' own columns rather than referencing them
  failure_kind:     column.text,  // 'transient' | 'permanent'
  attempts:         column.integer,
  last_error:       column.text,
  next_retry_at:    column.text,  // ISO string
  created_at:       column.text,  // ISO string
}, { localOnly: true })
```

- [ ] **Step 2: Register both tables in `AppSchema`**

Add both names to the existing `export const AppSchema = new Schema({ ... })` block
(`schema.ts:445-480`), anywhere in the object:

```ts
  events,
  daily_event_counts,
  local_event_processed_ledger,
  local_event_publish_retries,
```

- [ ] **Step 3: Run the existing schema/type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors (pure additive schema change).

- [ ] **Step 4: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(WAFI-140): add local-only ledger + retry-queue tables"
```

---

### Task 2: `executeBusinessOperation` — allow `toEvent` to return `undefined`

**Files:**
- Modify: `src/composables/executeBusinessOperation.ts`
- Test: `src/composables/__tests__/executeBusinessOperation.test.ts` (create if it doesn't exist —
  check first with `find src/composables -iname "*executeBusinessOperation*"`)

**Interfaces:**
- Produces: `BusinessOperationHooks<T>.toEvent?: (result: T) => DomainEvent | undefined` — Task 7
  (product save retrofit) depends on being able to return `undefined` for a write that changed
  neither price nor cost.

- [ ] **Step 1: Write the failing test**

```ts
// src/composables/__tests__/executeBusinessOperation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/store/session.store', () => ({
  useSessionStore: () => ({ activeStaff: { role: 'owner' } }),
}))

import { publishEvent } from '@/services/events/publishEvent'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'

describe('executeBusinessOperation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not call publishEvent when toEvent returns undefined', async () => {
    const result = await executeBusinessOperation(
      async () => ({ changed: false }),
      {
        audit: async () => {},
        toEvent: () => undefined,
      },
    )
    expect(result).toEqual({ changed: false })
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('still calls publishEvent when toEvent returns a DomainEvent', async () => {
    await executeBusinessOperation(
      async () => ({ changed: true }),
      {
        audit: async () => {},
        toEvent: () => ({
          type: 'expense.recorded', entityId: 'e1', payload: {}, payloadVersion: 1,
          staffId: 's1', shopId: 'shop1', occurredAt: '2026-08-03T00:00:00.000Z',
        }),
      },
    )
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/__tests__/executeBusinessOperation.test.ts`
Expected: FAIL on the first test — `toEvent`'s return type doesn't currently allow `undefined`
without a type error, and the current implementation calls `publishEvent` unconditionally whenever
`hooks.toEvent` is truthy (which it always is here, since the hook itself is always provided).

- [ ] **Step 3: Update the type and the call site**

```ts
// src/composables/executeBusinessOperation.ts
export interface BusinessOperationHooks<T> {
  /** Awaited — a financial write is not considered complete until its audit row exists. */
  audit: (result: T) => Promise<void>
  /** Optional and fire-and-forget. Omit entirely for writes with no event contract yet
   *  (e.g. installments, out of WAFI-152's scope) rather than inventing a fake mapping
   *  onto an unrelated DomainEventType just to satisfy this wrapper's shape.
   *
   *  @remarks At most ONE DomainEvent per write — this hook has no plural form. A write
   *  that can produce more than one meaningful fact (e.g. a product edit changing both
   *  price and cost) must pick one, or return `undefined` for "no event this write" — see
   *  WAFI-140 Sprint 2 design spec §5a for a call site working around this limitation.
   *  Multiple events per write remain unsupported until a future revision of this
   *  wrapper (e.g. a plural `toEvents` hook). */
  toEvent?: (result: T) => DomainEvent | undefined
}
```

```ts
export async function executeBusinessOperation<T>(
  write: () => Promise<T>,
  hooks: BusinessOperationHooks<T>,
  requiredPermission?: keyof StaffPermissions,
): Promise<T> {
  if (requiredPermission) {
    const session = useSessionStore()
    if (!canUserDo(session.activeStaff, requiredPermission)) {
      throw new Error(`permission denied: ${requiredPermission} required`)
    }
  }
  const result = await write()
  await hooks.audit(result)
  const event = hooks.toEvent?.(result)
  if (event) {
    // Fire-and-forget: publishing must never block the caller or turn a
    // publish/bus failure into a write failure.
    void publishEvent(event).catch(() => {})
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/__tests__/executeBusinessOperation.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Run the full existing test suite (regression check)**

Run: `npx vitest run`
Expected: PASS, no regressions — every Sprint 1 `toEvent` hook still returns a real `DomainEvent`
unconditionally, so this is a widening (not breaking) type change.

- [ ] **Step 6: Commit**

```bash
git add src/composables/executeBusinessOperation.ts src/composables/__tests__/executeBusinessOperation.test.ts
git commit -m "feat(WAFI-140): allow toEvent to return undefined for no-event writes"
```

---

### Task 3: 8 new event types + payloads in `domainEvent.types.ts`

**Files:**
- Modify: `src/services/events/domainEvent.types.ts` (append new domain groups; extend
  `DomainEventType` union)

**Interfaces:**
- Produces: `ReturnsEventType` (`Returned`), `CustomerEventType.DebtChanged` (already declared in
  Sprint 1 but never wired — now used), `CashEventType` (`MovementRecorded`), `StockTakeEventType`
  (`Taken`), `ProductEventType` (`PriceChanged`, `CostUpdated`, `Created`), `DeviceEventType`
  (`Registered`) — plus one payload interface per event. Tasks 5-8 depend on these exact names.

- [ ] **Step 1: Append the new event-type groups and extend the union**

Add below the existing `StaffEventType` block, before `export type DomainEventType = ...`:

```ts
export const ReturnsEventType = {
  Returned: 'sale.returned',
} as const
export type ReturnsEventType = typeof ReturnsEventType[keyof typeof ReturnsEventType]

export const CashEventType = {
  MovementRecorded: 'cash.movement_recorded',
} as const
export type CashEventType = typeof CashEventType[keyof typeof CashEventType]

export const StockTakeEventType = {
  Taken: 'stock.taken',
} as const
export type StockTakeEventType = typeof StockTakeEventType[keyof typeof StockTakeEventType]

export const ProductEventType = {
  PriceChanged: 'product.price_changed',
  CostUpdated:  'product.cost_updated',
  Created:      'product.created',
} as const
export type ProductEventType = typeof ProductEventType[keyof typeof ProductEventType]

export const DeviceEventType = {
  Registered: 'device.registered',
} as const
export type DeviceEventType = typeof DeviceEventType[keyof typeof DeviceEventType]
```

Update the union (replace the existing `DomainEventType` line):

```ts
export type DomainEventType =
  | ExpenseEventType | InventoryEventType | CustomerEventType | SalesEventType | StaffEventType
  | ReturnsEventType | CashEventType | StockTakeEventType | ProductEventType | DeviceEventType
```

- [ ] **Step 2: Append the new payload interfaces**

Add at the end of the file:

```ts
// WAFI-140 Sprint 2 payloads (design spec §6).

export interface ReturnedPayload {
  returnId: string
  saleId: string
  refundAmountUsd: number
  restockedItemCount: number
}

export interface DebtChangedPayload {
  customerId: string
  /** Negative for a debt decrease (the only case this sprint wires -- a return). */
  deltaUsd: number
  newBalanceUsd: number
  reason: 'return'
}

export interface CashMovementRecordedPayload {
  movementId: string
  shiftId: string
  direction: import('@/features/shifts/cashMovement.types').CashMovementDirection
  category: import('@/features/shifts/cashMovement.types').CashMovementCategory
  currency: import('@/features/shifts/cashMovement.types').CashCurrency
  amountUsd: number
}

export interface StockTakenPayload {
  sessionId: string
  productCount: number
  unexplainedVarianceCount: number
}

export interface ProductPriceChangedPayload {
  productId: string
  oldPriceUsd: number
  newPriceUsd: number
}

export interface ProductCostUpdatedPayload {
  productId: string
  oldCostUsd: number
  newCostUsd: number
}

export interface ProductCreatedPayload {
  productId: string
  name: string
  categoryId: string | null
}

export interface DeviceRegisteredPayload {
  deviceId: string
  deviceCode: string
  isTemporary: boolean
}
```

(`DeviceRegisteredPayload` swaps the design spec's placeholder `deviceName` for the real fields
`useDeviceRegistration.ts` actually produces — `code`/`isTemporary` — confirmed against the real
function signature in Task 8.)

- [ ] **Step 3: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS — this is a pure additive change, nothing references the new types yet.

- [ ] **Step 4: Commit**

```bash
git add src/services/events/domainEvent.types.ts
git commit -m "feat(WAFI-140): add 8 Sprint 2 event types and payload interfaces"
```

---

### Task 4: `processProjectionAtMostOnce` ledger guard + `dailyEventCountsProjection` retrofit

**Files:**
- Create: `src/services/events/processProjectionAtMostOnce.ts`
- Modify: `src/services/events/dailyEventCountsProjection.ts`
- Test: `src/services/events/__tests__/processProjectionAtMostOnce.test.ts`
- Modify: `src/services/events/__tests__/dailyEventCountsProjection.test.ts` (invert the
  double-count test into a no-double-count test, per design spec §7)

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`, `logger` (Task 5 introduces this — see note below).
- Produces: `SubscriberId` const object, `processProjectionAtMostOnce(subscriberId: SubscriberId,
  eventId: string, action: () => Promise<void>): Promise<void>`.

**Note on `logger`:** this task and Task 5 both need a `logger.error` wrapper. Implement it once,
here, since this task runs first:

```ts
// src/services/events/logger.ts
/** Thin wrapper around console.error (WAFI-140 Sprint 2) -- introduced so a future real
 *  alerting/telemetry integration (Sprint 3) is a change to this one module, not a
 *  grep-and-replace across every call site this ticket adds. */
export const logger = {
  error: (...args: unknown[]) => console.error(...args),
}
```

- [ ] **Step 1: Write the failing test for `processProjectionAtMostOnce`**

```ts
// src/services/events/__tests__/processProjectionAtMostOnce.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/logger', () => ({ logger: { error: vi.fn() } }))

import { db } from '@/data/powersync/db'
import { logger } from '@/services/events/logger'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

describe('processProjectionAtMostOnce', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the action on first insert', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('insert into local_event_processed_ledger'),
      [SubscriberId.DailyEventCounts, 'e1'],
    )
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('skips the action when the ledger insert rejects (already processed)', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
    const action = vi.fn().mockResolvedValue(undefined)
    await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action)
    expect(action).not.toHaveBeenCalled()
  })

  it('logs (not swallows) when the action itself throws, after the ledger commit', async () => {
    const action = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('processProjectionAtMostOnce'),
      SubscriberId.DailyEventCounts, 'e1', expect.any(Error),
    )
  })

  it('runs independently per subscriber for the same eventId', async () => {
    const action1 = vi.fn().mockResolvedValue(undefined)
    const action2 = vi.fn().mockResolvedValue(undefined)
    await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action1)
    await processProjectionAtMostOnce('another_subscriber' as any, 'e1', action2)
    expect(action1).toHaveBeenCalledTimes(1)
    expect(action2).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/processProjectionAtMostOnce.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `processProjectionAtMostOnce`**

```ts
// src/services/events/processProjectionAtMostOnce.ts
import { db } from '@/data/powersync/db'
import { logger } from './logger'

export const SubscriberId = {
  DailyEventCounts: 'daily_event_counts_projection',
} as const
export type SubscriberId = typeof SubscriberId[keyof typeof SubscriberId]

/** At-most-once, NOT exactly-once (WAFI-140 Sprint 2 design spec §3): if the process
 *  crashes between the ledger insert and `action()` running, this row is marked
 *  processed forever and `action()` never retries. This helper intentionally does not
 *  guarantee eventual execution -- "at most once" means 0-or-1 executions.
 *
 *  Acceptable today only because the sole caller (`daily_event_counts`) is a
 *  best-effort dashboard number, not a financial ledger. Any future subscriber whose
 *  action is a financial write must NOT use this helper -- it needs a real
 *  transactional guarantee this ledger does not provide. */
export async function processProjectionAtMostOnce(
  subscriberId: SubscriberId,
  eventId: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await db.execute(
      `insert into local_event_processed_ledger (subscriber_id, event_id, processed_at) values (?, ?, ?)`,
      [subscriberId, eventId, new Date().toISOString()],
    )
  } catch {
    return // already processed (unique-violation on subscriber_id+event_id) -- skip silently
  }
  try {
    await action()
  } catch (err) {
    // Mandatory: the ledger row is already committed, so a swallowed throw here means
    // the event is now silently, permanently skipped with zero trace.
    logger.error('[processProjectionAtMostOnce] subscriber action threw after ledger commit', subscriberId, eventId, err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/processProjectionAtMostOnce.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Retrofit `dailyEventCountsProjection.ts` to use the ledger**

```ts
// src/services/events/dailyEventCountsProjection.ts
import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

/**
 * Reference read-model (Sprint 1 design spec §7). WAFI-140 Sprint 2 closes the
 * documented double-count limitation by guarding each row through the processed-event
 * ledger before incrementing.
 */
export function startDailyEventCountsProjection(shopId: string): { stop: () => void } {
  return useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, row.id, async () => {
        const day = row.occurred_at.slice(0, 10)
        await db.execute(
          `INSERT INTO daily_event_counts (shop_id, event_type, day, count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT (shop_id, event_type, day) DO UPDATE SET count = daily_event_counts.count + 1`,
          [shopId, SalesEventType.Completed, day],
        )
      })
    },
    { shopId },
  )
}
```

- [ ] **Step 6: Invert the existing double-count test**

In `src/services/events/__tests__/dailyEventCountsProjection.test.ts`, replace the test titled
`'double-counts on duplicate handler execution -- documented at-least-once limitation, not a bug'`
with:

```ts
  it('does NOT double-count when the same row is delivered twice (ledger guard, WAFI-140 Sprint 2)', async () => {
    const sameRow = {
      id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
      payload: JSON.stringify({ saleId: 'sale-1' }),
      staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
    }
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [sameRow] } },
      { rows: { _array: [sameRow] } }, // same row delivered twice (crash-and-replay simulation)
    ]) as any)

    // First call: ledger insert succeeds -> execute called for the ledger insert AND the increment (2 calls).
    // Second call: ledger insert rejects (unique violation) -> action skipped, execute called 0 more times.
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // ledger insert #1
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // increment #1
      .mockRejectedValueOnce(new Error('UNIQUE constraint failed')) // ledger insert #2 -> skipped

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    // Exactly one increment call (the second delivery's ledger insert rejected before reaching it).
    const incrementCalls = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => sql.toLowerCase().includes('insert into daily_event_counts'),
    )
    expect(incrementCalls).toHaveLength(1)
    stop()
  })
```

- [ ] **Step 7: Run tests to verify both pass**

Run: `npx vitest run src/services/events/__tests__/processProjectionAtMostOnce.test.ts src/services/events/__tests__/dailyEventCountsProjection.test.ts`
Expected: PASS (4/4 and 2/2 respectively — the projection file now has the original "upserts an
increment" test plus the new no-double-count test).

- [ ] **Step 8: Commit**

```bash
git add src/services/events/logger.ts src/services/events/processProjectionAtMostOnce.ts \
        src/services/events/dailyEventCountsProjection.ts \
        src/services/events/__tests__/processProjectionAtMostOnce.test.ts \
        src/services/events/__tests__/dailyEventCountsProjection.test.ts
git commit -m "feat(WAFI-140): add processProjectionAtMostOnce ledger guard, close double-count gap"
```

---

### Task 5: Publish-failure retry queue

**Files:**
- Create: `src/services/events/isTransientPublishFailure.ts`
- Create: `src/services/events/eventPublishRetryQueue.ts`
- Modify: `src/services/events/publishEvent.ts`
- Modify: `src/__tests__/__mocks__/db.ts` (add `registerListener` to the mock)
- Test: `src/services/events/__tests__/isTransientPublishFailure.test.ts`
- Test: `src/services/events/__tests__/eventPublishRetryQueue.test.ts`
- Test: `src/services/events/__tests__/publishEvent.test.ts` (extend with the new enqueue behavior)

**Interfaces:**
- Consumes: `local_event_publish_retries` (Task 1), `logger` (Task 4).
- Produces: `isTransientPublishFailure(error: unknown): boolean`, `enqueueForRetry<T>(event:
  DomainEvent<T>, errorMessage: string): Promise<void>`, `retryPendingEventPublishes(): Promise<void>`,
  `getRetryQueueStats(): Promise<{ pendingCount: number; permanentCount: number; oldestPendingAt:
  string | null; oldestPendingAge: string | null }>`, `startRetryQueueSweeper(): { stop: () => void }`.

- [ ] **Step 1: Write the failing test for `isTransientPublishFailure`**

```ts
// src/services/events/__tests__/isTransientPublishFailure.test.ts
import { describe, it, expect } from 'vitest'
import { isTransientPublishFailure } from '@/services/events/isTransientPublishFailure'

describe('isTransientPublishFailure', () => {
  it('classifies busy/locked/IO errors as transient', () => {
    expect(isTransientPublishFailure(new Error('SQLITE_BUSY: database is locked'))).toBe(true)
    expect(isTransientPublishFailure(new Error('database is locked'))).toBe(true)
    expect(isTransientPublishFailure(new Error('I/O error'))).toBe(true)
  })

  it('classifies constraint/syntax errors as permanent', () => {
    expect(isTransientPublishFailure(new Error('UNIQUE constraint failed: events.id'))).toBe(false)
    expect(isTransientPublishFailure(new Error('syntax error near "insert"'))).toBe(false)
    expect(isTransientPublishFailure(new Error('no such column: payload_version'))).toBe(false)
  })

  it('defaults unrecognized errors to permanent (never retry forever on an unknown shape)', () => {
    expect(isTransientPublishFailure(new Error('something entirely unexpected'))).toBe(false)
    expect(isTransientPublishFailure('not even an Error instance')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/isTransientPublishFailure.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `isTransientPublishFailure`**

```ts
// src/services/events/isTransientPublishFailure.ts
/** Single decision point for retry classification (WAFI-140 Sprint 2 design spec §4) --
 *  every call site asks this function, none invents its own ad hoc rule. This is a
 *  deliberately small, illustrative list (design spec §4), not the exhaustive
 *  production classifier -- extending it with real error samples is Sprint 3 scope. */
export function isTransientPublishFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i]
  return transientPatterns.some((p) => p.test(message))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/isTransientPublishFailure.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Add `registerListener` to the db mock**

```ts
// src/__tests__/__mocks__/db.ts -- add this field to the exported `db` object
  registerListener: vi.fn().mockReturnValue(() => {}),
```

- [ ] **Step 6: Write the failing test for the retry queue module**

```ts
// src/services/events/__tests__/eventPublishRetryQueue.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/logger', () => ({ logger: { error: vi.fn() } }))

import { db } from '@/data/powersync/db'
import { logger } from '@/services/events/logger'
import {
  enqueueForRetry, retryPendingEventPublishes, getRetryQueueStats,
} from '@/services/events/eventPublishRetryQueue'
import { ExpenseEventType } from '@/services/events/domainEvent.types'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const event: DomainEvent<{ x: number }> = {
  type: ExpenseEventType.Recorded, entityId: 'e1', payload: { x: 1 }, payloadVersion: 1,
  staffId: 's1', shopId: 'shop1', occurredAt: '2026-08-03T00:00:00.000Z',
}

describe('eventPublishRetryQueue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enqueueForRetry inserts a transient-classified row with next_retry_at ~1 min out', async () => {
    await enqueueForRetry(event, 'database is locked')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('insert into local_event_publish_retries'),
      expect.arrayContaining([JSON.stringify(event), 'transient']),
    )
  })

  it('enqueueForRetry classifies a permanent failure and does not set attempts > 0', async () => {
    await enqueueForRetry(event, 'UNIQUE constraint failed')
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain('permanent')
  })

  it('retryPendingEventPublishes continues past a row that fails (does not abort the sweep)', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'r1', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0, next_retry_at: '2000-01-01' },
      { id: 'r2', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0, next_retry_at: '2000-01-01' },
    ])
    // r1's re-insert into `events` fails, r2's succeeds.
    vi.mocked(db.writeTransaction)
      .mockImplementationOnce(async () => { throw new Error('boom') })
      .mockImplementationOnce(async (fn: any) => fn({ execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }) }))

    await expect(retryPendingEventPublishes()).resolves.toBeUndefined()
    // Both rows were attempted despite r1 throwing.
    expect(db.writeTransaction).toHaveBeenCalledTimes(2)
  })

  it('getRetryQueueStats returns pendingCount, permanentCount, oldestPendingAt, oldestPendingAge', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{ n: 3 }])   // pendingCount query
      .mockResolvedValueOnce([{ n: 1 }])   // permanentCount query
      .mockResolvedValueOnce([{ created_at: '2026-08-03T00:00:00.000Z' }]) // oldest row query

    const stats = await getRetryQueueStats()
    expect(stats.pendingCount).toBe(3)
    expect(stats.permanentCount).toBe(1)
    expect(stats.oldestPendingAt).toBe('2026-08-03T00:00:00.000Z')
    expect(typeof stats.oldestPendingAge).toBe('string')
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/eventPublishRetryQueue.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 8: Implement the retry queue module**

```ts
// src/services/events/eventPublishRetryQueue.ts
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { isTransientPublishFailure } from './isTransientPublishFailure'
import type { DomainEvent } from './domainEvent.types'

/** 1 min, 5 min, 30 min, 2 hr, then stop (design spec §4). Indexed by `attempts` so far. */
const BACKOFF_MINUTES = [1, 5, 30, 120]
const MAX_ATTEMPTS = BACKOFF_MINUTES.length

function nextRetryAt(attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

export async function enqueueForRetry<T>(event: DomainEvent<T>, errorMessage: string): Promise<void> {
  const failureKind = isTransientPublishFailure(new Error(errorMessage)) ? 'transient' : 'permanent'
  await db.execute(
    `insert into local_event_publish_retries
       (id, serialized_event, failure_kind, attempts, last_error, next_retry_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      JSON.stringify(event),
      failureKind,
      0,
      errorMessage,
      failureKind === 'transient' ? nextRetryAt(0) : new Date(0).toISOString(),
      new Date().toISOString(),
    ],
  )
}

/** Inserts the retried event into `events` and deletes its retry row in one local
 *  transaction (design spec §4: confirmed real via `db.writeTransaction`, already used
 *  elsewhere in this codebase -- see useReturnSheet.ts). Never throws past the caller;
 *  the sweep below is responsible for continuing past a single row's failure. */
async function attemptRetry(row: {
  id: string; serialized_event: string; failure_kind: string; attempts: number
}): Promise<'succeeded' | 'failed'> {
  const event = JSON.parse(row.serialized_event) as DomainEvent
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `insert into events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(), event.type, event.entityId, JSON.stringify(event.payload),
          event.payloadVersion, event.staffId, event.shopId, event.occurredAt, new Date().toISOString(),
        ],
      )
      await tx.execute(`delete from local_event_publish_retries where id = ?`, [row.id])
    })
    return 'succeeded'
  } catch (err) {
    const attempts = row.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      logger.error('[eventPublishRetryQueue] row exhausted retries, leaving for manual inspection', row.id, err)
      await db.execute(
        `update local_event_publish_retries set attempts = ?, last_error = ? where id = ?`,
        [attempts, String(err), row.id],
      )
    } else {
      await db.execute(
        `update local_event_publish_retries set attempts = ?, last_error = ?, next_retry_at = ? where id = ?`,
        [attempts, String(err), nextRetryAt(attempts), row.id],
      )
    }
    return 'failed'
  }
}

/** Must never abort partway through -- one permanently-stuck row must not starve every
 *  row behind it in next_retry_at order (design spec §4). */
export async function retryPendingEventPublishes(): Promise<void> {
  const dueRows = await db.getAll<{
    id: string; serialized_event: string; failure_kind: string; attempts: number
  }>(
    `select id, serialized_event, failure_kind, attempts from local_event_publish_retries
     where failure_kind = 'transient' and next_retry_at <= ? order by next_retry_at asc`,
    [new Date().toISOString()],
  )
  for (const row of dueRows) {
    try {
      await attemptRetry(row)
    } catch (err) {
      // attemptRetry already handles its own failures internally; this catch exists so a
      // truly unexpected throw (e.g. a bug in attemptRetry itself) still can't stop the sweep.
      logger.error('[eventPublishRetryQueue] unexpected error processing row, continuing sweep', row.id, err)
    }
  }
}

function formatAge(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}

export async function getRetryQueueStats(): Promise<{
  pendingCount: number; permanentCount: number
  oldestPendingAt: string | null; oldestPendingAge: string | null
}> {
  const [pendingRow] = await db.getAll<{ n: number }>(
    `select count(*) as n from local_event_publish_retries where failure_kind = 'transient'`,
  )
  const [permanentRow] = await db.getAll<{ n: number }>(
    `select count(*) as n from local_event_publish_retries where failure_kind = 'permanent'`,
  )
  const [oldestRow] = await db.getAll<{ created_at: string }>(
    `select created_at from local_event_publish_retries order by created_at asc limit 1`,
  )
  return {
    pendingCount: pendingRow?.n ?? 0,
    permanentCount: permanentRow?.n ?? 0,
    oldestPendingAt: oldestRow?.created_at ?? null,
    oldestPendingAge: oldestRow ? formatAge(oldestRow.created_at) : null,
  }
}

/** Runs the sweep on app start and every PowerSync reconnect transition, reusing the
 *  connector's own status listener (same mechanism useSync.ts's bindPowerSync already
 *  uses) rather than a new polling timer. */
export function startRetryQueueSweeper(): { stop: () => void } {
  void retryPendingEventPublishes()
  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void retryPendingEventPublishes()
    },
  })
  return { stop: () => unsubscribe?.() }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/eventPublishRetryQueue.test.ts`
Expected: PASS (4/4)

- [ ] **Step 10: Wire `publishEvent()` to enqueue on failure**

```ts
// src/services/events/publishEvent.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { enqueueForRetry } from './eventPublishRetryQueue'
import type { DomainEvent } from './domainEvent.types'

export const eventPublishFailureCount = ref(0)

export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  try {
    await db.execute(
      `insert into events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(), event.type, event.entityId, JSON.stringify(event.payload),
        event.payloadVersion, event.staffId, event.shopId, event.occurredAt, new Date().toISOString(),
      ],
    )
  } catch (err) {
    eventPublishFailureCount.value += 1
    logger.error('[publishEvent] failed to persist event, queuing for retry', event.type, err)
    await enqueueForRetry(event, err instanceof Error ? err.message : String(err)).catch(() => {
      // even the retry-queue write can fail (e.g. local disk full) -- this event is
      // genuinely lost, same as Sprint 1's behavior, but now the rare/logged case.
    })
  }
}
```

- [ ] **Step 11: Extend `publishEvent.test.ts`**

Add to the existing `describe('publishEvent', ...)` block:

```ts
  it('enqueues the failed event for retry instead of only counting it', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('database is locked'))
    await publishEvent(baseEvent)
    // second db.execute call (from enqueueForRetry) inserts into the retry table
    const retryCall = vi.mocked(db.execute).mock.calls.find(
      ([sql]) => sql.includes('local_event_publish_retries'),
    )
    expect(retryCall).toBeDefined()
  })
```

- [ ] **Step 12: Run all Task 5 tests together**

Run: `npx vitest run src/services/events/__tests__/`
Expected: PASS, full directory.

- [ ] **Step 13: Commit**

```bash
git add src/services/events/isTransientPublishFailure.ts src/services/events/eventPublishRetryQueue.ts \
        src/services/events/publishEvent.ts src/__tests__/__mocks__/db.ts \
        src/services/events/__tests__/isTransientPublishFailure.test.ts \
        src/services/events/__tests__/eventPublishRetryQueue.test.ts \
        src/services/events/__tests__/publishEvent.test.ts
git commit -m "feat(WAFI-140): add publish-failure retry queue with backoff and classification"
```

---

### Task 6: Wire `sale.returned` + `customer.debt_changed` (`useReturnSheet.ts`)

**Files:**
- Modify: `src/features/returns/composables/useReturnSheet.ts`
- Test: `src/features/returns/composables/__tests__/useReturnSheet.test.ts` (extend existing file —
  locate it first with `find src/features/returns -iname "*.test.ts"`)

**Interfaces:**
- Consumes: `ReturnsEventType`, `CustomerEventType`, `ReturnedPayload`, `DebtChangedPayload` (Task 3);
  `fetchOutstandingBalanceUsd` from `@/features/customers/composables/useCustomerBalance` (already
  exported, no change needed).
- Produces: `confirm()` now also emits `sale.returned` always, plus `customer.debt_changed` when the
  original sale was a credit sale.

- [ ] **Step 1: Fetch `is_credit` in `load()`**

In `load()`'s sale-header query (`useReturnSheet.ts:58-63`), add `s.is_credit`:

```ts
    const saleResult = await db.execute(
      `SELECT s.id, s.display_sale_number, s.customer_id, c.name AS customer_name, s.sale_discount_amount_usd, s.is_credit
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`,
      [saleId],
    )
```

Add a new ref near the top of the file (alongside the other refs, `useReturnSheet.ts:15-22`):

```ts
  const isCreditSale = ref(false)
```

and set it in `load()` right after the existing `hasCustomer.value` assignment (`:68`):

```ts
    isCreditSale.value = !!sale.is_credit
```

- [ ] **Step 2: Write the failing test**

Add to the existing test file (adjust the mock setup to match its established pattern — read the
file first to match its existing `db` mock/fixture style):

```ts
  it('publishes sale.returned always, and customer.debt_changed only for a credit sale', async () => {
    // Arrange the mock sale-header row to include is_credit: 1, and mock
    // fetchOutstandingBalanceUsd's underlying query result appropriately for this test's db mock.
    const { publishEvent } = await import('@/services/events/publishEvent')
    vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'store_credit'
    await sheet.confirm()

    const types = vi.mocked(publishEvent).mock.calls.map(([e]) => e.type)
    expect(types).toContain('sale.returned')
    // if the fixture's sale row has is_credit: 1, this must also be present:
    expect(types).toContain('customer.debt_changed')
  })
```

(This step's exact assertions depend on the test file's existing fixture shape — align the mocked
`db.execute`/`db.getAll` return values for the sale-header and balance queries with whatever
convention the existing file already uses; the point being tested is unchanged: `sale.returned`
always fires, `customer.debt_changed` only for `is_credit = 1`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/returns/composables/__tests__/useReturnSheet.test.ts`
Expected: FAIL — `confirm()` doesn't publish either event yet.

- [ ] **Step 4: Add the `toEvent` hook**

At the top of `useReturnSheet.ts`, add to the type-only imports:

```ts
import {
  ReturnsEventType, CustomerEventType,
  type ReturnedPayload, type DebtChangedPayload,
} from '@/services/events/domainEvent.types'
import { fetchOutstandingBalanceUsd } from '@/features/customers/composables/useCustomerBalance'
```

Replace the `executeBusinessOperation` call's hooks object (`useReturnSheet.ts:310-319`):

```ts
      {
        audit: async ({ cancelledPlanId }) => {
          await Promise.all([
            logReturnProcessed(returnId, saleId, refundAmountUsd),
            cancelledPlanId
              ? logInstallmentPlanCancelled(cancelledPlanId, { reason: 'sale_returned', returnId })
              : Promise.resolve(),
          ])
        },
        toEvent: () => ({
          type: ReturnsEventType.Returned,
          entityId: returnId,
          payload: {
            returnId, saleId, refundAmountUsd,
            restockedItemCount: selectedLines.filter(l => l.restock && !l.isOpenItem).length,
          } satisfies ReturnedPayload,
          payloadVersion: 1,
          staffId: useSessionStore().activeStaff?.id ?? '',
          shopId,
          occurredAt: now,
        }),
      },
```

`executeBusinessOperation`'s `toEvent` only supports one event per write (Task 2's documented
limitation) — `customer.debt_changed` cannot go through the same hook. Publish it directly, right
after `executeBusinessOperation` resolves, inside `confirm()`:

```ts
    const { warning } = await executeBusinessOperation(
      /* ...unchanged write function and audit/toEvent hooks above... */
    )

    if (isCreditSale.value && customerId.value) {
      const newBalanceUsd = await fetchOutstandingBalanceUsd(customerId.value, shopId)
      void publishEvent<DebtChangedPayload>({
        type: CustomerEventType.DebtChanged,
        entityId: customerId.value,
        payload: {
          customerId: customerId.value,
          deltaUsd: -refundAmountUsd,
          newBalanceUsd,
          reason: 'return',
        },
        payloadVersion: 1,
        staffId: useSessionStore().activeStaff?.id ?? '',
        shopId,
        occurredAt: now,
      }).catch(() => {})
    }

    return { warning }
```

Add `import { publishEvent } from '@/services/events/publishEvent'` to the top of the file.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/returns/composables/__tests__/useReturnSheet.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full existing returns test suite (regression check)**

Run: `npx vitest run src/features/returns/`
Expected: PASS, no regressions — this is additive (new event calls only, no business-write shape
change).

- [ ] **Step 7: Commit**

```bash
git add src/features/returns/composables/useReturnSheet.ts src/features/returns/composables/__tests__/useReturnSheet.test.ts
git commit -m "feat(WAFI-140): publish sale.returned and customer.debt_changed from returns"
```

---

### Task 7: Wire `cash.movement_recorded` (`useCashMovements.ts`)

**Files:**
- Modify: `src/features/shifts/composables/useCashMovements.ts`
- Test: `src/features/shifts/composables/__tests__/useCashMovements.test.ts` (locate first)

**Interfaces:**
- Consumes: `CashEventType`, `CashMovementRecordedPayload` (Task 3).
- Produces: `record()` now also emits `cash.movement_recorded`. `voidMovement()` is deliberately
  left unwired this sprint — a void is a rarer, audit-sensitive path (`logCashMovementVoided` is
  already `_logSensitive`), and firing an event for it is out of this sprint's approved scope; not
  silently forgotten, just not built.

- [ ] **Step 1: Write the failing test**

```ts
  it('record() publishes cash.movement_recorded with the movement id as entityId', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    const { record } = useCashMovements()
    await record({ shift: fakeOpenShift, direction: 'in', category: 'float_topup', currency: 'USD', amount: 20 })

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cash.movement_recorded',
      payload: expect.objectContaining({ direction: 'in', category: 'float_topup', currency: 'USD', amountUsd: 20 }),
    }))
  })
```

(Adapt `fakeOpenShift` to whatever fixture the existing test file already uses for a `CashierShift`
with `status: 'open'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/shifts/composables/__tests__/useCashMovements.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the `toEvent` hook to `record()`**

```ts
// src/features/shifts/composables/useCashMovements.ts -- add to imports
import { CashEventType, type CashMovementRecordedPayload } from '@/services/events/domainEvent.types'
```

Replace `record()`'s `executeBusinessOperation` call (`useCashMovements.ts:70-77`):

```ts
  async function record(input: RecordCashMovementInput): Promise<string> {
    if (input.shift.status !== 'open') {
      throw new Error('لا يمكن تسجيل حركة نقدية على وردية غير مفتوحة')
    }
    if (!(input.amount > 0)) {
      throw new Error('المبلغ يجب أن يكون أكبر من صفر')
    }
    if (input.currency === 'SYP' && !Number.isInteger(input.amount)) {
      throw new Error('مبلغ الليرة يجب أن يكون رقماً صحيحاً')
    }
    return executeBusinessOperation(
      () => insert({
        shiftId: input.shift.id, direction: input.direction, category: input.category,
        currency: input.currency, amount: input.amount, note: input.note ?? null,
        voidsMovementId: null,
      }),
      {
        audit: (id) => logCashMovementRecorded(id, input.direction, input.category, input.currency, input.amount),
        toEvent: (id) => ({
          type: CashEventType.MovementRecorded,
          entityId: id,
          payload: {
            movementId: id, shiftId: input.shift.id,
            direction: input.direction, category: input.category, currency: input.currency,
            amountUsd: input.amount,
          } satisfies CashMovementRecordedPayload,
          payloadVersion: 1,
          staffId: session.activeStaff?.id ?? '',
          shopId: device.shopId,
          occurredAt: new Date().toISOString(),
        }),
      },
    )
  }
```

(`amountUsd` here carries the raw `amount` regardless of `currency` — matching the design spec's
payload shape; a future ticket that needs a real USD conversion for SYP movements can extend this,
not assumed here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/shifts/composables/__tests__/useCashMovements.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full shifts test suite (regression check)**

Run: `npx vitest run src/features/shifts/`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/features/shifts/composables/useCashMovements.ts src/features/shifts/composables/__tests__/useCashMovements.test.ts
git commit -m "feat(WAFI-140): publish cash.movement_recorded from useCashMovements.record()"
```

---

### Task 8: Wire `stock.taken` (`useStockTake.ts`)

**Files:**
- Modify: `src/features/stock-take/composables/useStockTake.ts`
- Test: `src/features/stock-take/composables/__tests__/useStockTake.test.ts` (locate first)

**Interfaces:**
- Consumes: `StockTakeEventType`, `StockTakenPayload` (Task 3).
- Produces: `confirmSession()`'s final status-commit write now goes through
  `executeBusinessOperation`, retaining its existing `logStockTakeCompleted` audit call and adding
  `stock.taken`.

**Note:** this task retrofits only the session-completion write. The per-line `adjustStockBy` calls
inside the same function already publish `inventory.adjusted` independently (wired in Sprint 1, via
`inventory.service.ts`'s `adjustInventory`) — untouched by this task.

- [ ] **Step 1: Write the failing test**

```ts
  it('confirmSession publishes stock.taken with productCount and unexplainedVarianceCount', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    const stockTake = useStockTake()
    await stockTake.startSession(null)
    // ...record at least one variance line via recordCount, per the existing test file's fixtures...
    await stockTake.confirmSession()

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'stock.taken',
      payload: expect.objectContaining({ sessionId: expect.any(String) }),
    }))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/stock-take/composables/__tests__/useStockTake.test.ts`
Expected: FAIL.

- [ ] **Step 3: Retrofit `confirmSession()`**

Add to `useStockTake.ts`'s imports:

```ts
import { useSessionStore } from '@/store/session.store'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { StockTakeEventType, type StockTakenPayload } from '@/services/events/domainEvent.types'
```

Replace the tail of `confirmSession()` (`useStockTake.ts:183-192`, from `const now = ...` through
the final `return 'committed'`):

```ts
    const device = useDeviceStore()
    const staffId = useSessionStore().activeStaff?.id ?? ''
    const now = new Date().toISOString()
    const varianceCount = reviewLines.value.length
    const shrinkageUsd = totalShrinkageValueUsd.value

    await executeBusinessOperation(
      async () => {
        await db.execute(
          `UPDATE stock_take_sessions SET status = ?, completed_at = ?, sync_status = 'pending' WHERE id = ?`,
          ['completed', now, sessionId],
        )
        currentSession.value!.status = 'completed'
        currentSession.value!.completedAt = now
        return { sessionId, varianceCount, shrinkageUsd }
      },
      {
        audit: (r) => logStockTakeCompleted(r.sessionId, r.varianceCount, r.shrinkageUsd),
        toEvent: (r) => ({
          type: StockTakeEventType.Taken,
          entityId: r.sessionId,
          payload: {
            sessionId: r.sessionId, productCount: lines.value.length,
            unexplainedVarianceCount: r.varianceCount,
          } satisfies StockTakenPayload,
          payloadVersion: 1,
          staffId,
          shopId: device.shopId,
          occurredAt: now,
        }),
      },
    )
    return 'committed'
```

(`useDeviceStore` and `useAuditLog`'s `logStockTakeCompleted` are already imported/destructured
earlier in the function — reuse them, don't re-import or re-destructure.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/stock-take/composables/__tests__/useStockTake.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full stock-take test suite (regression check)**

Run: `npx vitest run src/features/stock-take/`
Expected: PASS, no regressions — the audit call fires with identical arguments as before, only its
call site moved into `hooks.audit`.

- [ ] **Step 6: Commit**

```bash
git add src/features/stock-take/composables/useStockTake.ts src/features/stock-take/composables/__tests__/useStockTake.test.ts
git commit -m "feat(WAFI-140): publish stock.taken from useStockTake.confirmSession()"
```

---

### Task 9: Wire `product.price_changed` / `product.cost_updated` / `product.created` (`useProducts.ts`)

**Files:**
- Modify: `src/features/products/composables/useProducts.ts`
- Test: `src/features/products/composables/__tests__/useProducts.test.ts` (locate first)

**Interfaces:**
- Consumes: `ProductEventType`, `ProductPriceChangedPayload`, `ProductCostUpdatedPayload`,
  `ProductCreatedPayload` (Task 3); relies on Task 2's `toEvent: undefined` support (a plain-update
  save with neither price nor cost changed emits no event).
- Produces: `save()`'s update branch emits `product.cost_updated` (if cost changed), else
  `product.price_changed` (if only price changed), else nothing; the insert branch always emits
  `product.created`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('save() update: emits product.cost_updated when cost changed (wins over a simultaneous price change)', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    // Arrange db.getOptional to return an existing row with price_usd: 10, cost_price_usd: 5.
    const { save } = useProducts()
    await save({ id: 'p1', shopId: 'shop1', nameAr: 'قلم', salePriceUsd: 12, costPriceUsd: 7, currentStock: 5, lowStockThreshold: 1, isActive: true })

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'product.cost_updated' }))
    expect(publishEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'product.price_changed' }))
  })

  it('save() update: emits product.price_changed when only price changed', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    // Arrange db.getOptional to return price_usd: 10, cost_price_usd: 5 (cost unchanged this time).
    const { save } = useProducts()
    await save({ id: 'p1', shopId: 'shop1', nameAr: 'قلم', salePriceUsd: 12, costPriceUsd: 5, currentStock: 5, lowStockThreshold: 1, isActive: true })

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'product.price_changed' }))
  })

  it('save() update: emits no event when neither price nor cost changed', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    vi.mocked(publishEvent).mockClear()
    // Arrange db.getOptional to return price_usd: 10, cost_price_usd: 5 (both unchanged).
    const { save } = useProducts()
    await save({ id: 'p1', shopId: 'shop1', nameAr: 'قلم محدث', salePriceUsd: 10, costPriceUsd: 5, currentStock: 5, lowStockThreshold: 1, isActive: true })

    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('save() insert: emits product.created', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    const { save } = useProducts()
    await save({ shopId: 'shop1', nameAr: 'منتج جديد', salePriceUsd: 10, costPriceUsd: 5, currentStock: 5, lowStockThreshold: 1, isActive: true })

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'product.created' }))
  })
```

(Align each test's `db.getOptional` mock return with whatever convention the existing
`useProducts.test.ts` file already uses — the four scenarios above are the ones that matter:
cost-changed wins, price-only, neither, and insert.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/products/composables/__tests__/useProducts.test.ts`
Expected: FAIL (4 new failures) — `save()` doesn't call `publishEvent` at all today.

- [ ] **Step 3: Retrofit `save()`**

Add to `useProducts.ts`'s imports:

```ts
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import {
  ProductEventType,
  type ProductPriceChangedPayload, type ProductCostUpdatedPayload, type ProductCreatedPayload,
} from '@/services/events/domainEvent.types'
```

Replace the update branch (`useProducts.ts:69-97`, from `if (data.id) {` through its `return
data.id`):

```ts
    if (data.id) {
      const old = await db.getOptional<{ price_usd: number; cost_price_usd: number }>(
        `SELECT price_usd, cost_price_usd FROM products WHERE id = ?`, [data.id]
      )
      const costChanged = old ? old.cost_price_usd !== data.costPriceUsd : false
      const priceChanged = old ? old.price_usd !== data.salePriceUsd : false
      const sql = costChanged
        ? `UPDATE products SET name_ar=?, name_en=?, barcode=?, category_id=?, subcategory_id=?,
           price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
           photo_url=?, is_active=?, cost_updated_at=?, updated_at=?, sync_status='pending' WHERE id=?`
        : `UPDATE products SET name_ar=?, name_en=?, barcode=?, category_id=?, subcategory_id=?,
           price_usd=?, cost_price_usd=?, current_stock=?, low_stock_threshold=?,
           photo_url=?, is_active=?, updated_at=?, sync_status='pending' WHERE id=?`
      const baseParams = [
        data.nameAr, data.nameEn ?? null, normalizedBarcode || null,
        data.categoryId ?? null, effectiveSubcategoryId ?? null,
        data.salePriceUsd, data.costPriceUsd, currentStock, data.lowStockThreshold,
        data.photoUrl ?? null, data.isActive ? 1 : 0,
      ]
      const params = costChanged
        ? [...baseParams, now, now, data.id]
        : [...baseParams, now, data.id]

      const staffId = useSessionStore().activeStaff?.id ?? ''

      await executeBusinessOperation(
        async () => {
          await db.execute(sql, params)
          await load()
          return { id: data.id!, name: data.nameAr }
        },
        {
          audit: async (r) => {
            if (priceChanged) await logProductPriceChanged(r.id, r.name, old!.price_usd, data.salePriceUsd)
            else await logProductUpdated(r.id, r.name)
          },
          // WAFI-140 Sprint 2 design spec §5a: at most one event per write. Cost wins
          // over price when both changed -- a framework limitation, not a claim that
          // cost matters more; see executeBusinessOperation.ts's toEvent JSDoc.
          toEvent: (r) => {
            if (costChanged) return {
              type: ProductEventType.CostUpdated, entityId: r.id,
              payload: { productId: r.id, oldCostUsd: old!.cost_price_usd, newCostUsd: data.costPriceUsd } satisfies ProductCostUpdatedPayload,
              payloadVersion: 1, staffId, shopId: data.shopId, occurredAt: now,
            }
            if (priceChanged) return {
              type: ProductEventType.PriceChanged, entityId: r.id,
              payload: { productId: r.id, oldPriceUsd: old!.price_usd, newPriceUsd: data.salePriceUsd } satisfies ProductPriceChangedPayload,
              payloadVersion: 1, staffId, shopId: data.shopId, occurredAt: now,
            }
            return undefined
          },
        },
      )
      return data.id
    } else {
```

Replace the insert branch's tail (`useProducts.ts:113-115`, `await load(); await
logProductCreated(id, data.nameAr); return id`):

```ts
      const staffId = useSessionStore().activeStaff?.id ?? ''
      await executeBusinessOperation(
        async () => {
          await load()
          return { id, name: data.nameAr }
        },
        {
          audit: (r) => logProductCreated(r.id, r.name),
          toEvent: (r) => ({
            type: ProductEventType.Created,
            entityId: r.id,
            payload: { productId: r.id, name: r.name, categoryId: data.categoryId ?? null } satisfies ProductCreatedPayload,
            payloadVersion: 1,
            staffId,
            shopId: data.shopId,
            occurredAt: now,
          }),
        },
      )
      return id
    }
```

(The INSERT `db.execute` call itself stays where it already is, immediately above this block,
unchanged — only the post-write `load()`/audit/event sequence moves into
`executeBusinessOperation`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/products/composables/__tests__/useProducts.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full products test suite (regression check)**

Run: `npx vitest run src/features/products/`
Expected: PASS, no regressions — `logProductPriceChanged`/`logProductUpdated`/`logProductCreated`
still fire with identical arguments; only their call sites moved into `hooks.audit`.

- [ ] **Step 6: Commit**

```bash
git add src/features/products/composables/useProducts.ts src/features/products/composables/__tests__/useProducts.test.ts
git commit -m "feat(WAFI-140): publish product.price_changed/cost_updated/created from useProducts.save()"
```

---

### Task 10: Wire `device.registered` (`useDeviceRegistration.ts`, bespoke)

**Files:**
- Modify: `src/features/devices/composables/useDeviceRegistration.ts`
- Test: `src/__tests__/features/useDeviceRegistration.test.ts` (existing file, per the grep in the
  design spec's research)

**Interfaces:**
- Consumes: `DeviceEventType`, `DeviceRegisteredPayload` (Task 3).
- Produces: `registerDevice()` now publishes `device.registered` directly (not via
  `executeBusinessOperation` — this is an RPC-backed flow, not a local-write-then-audit pair; see
  the design spec's stated exception). `staffId` is `''` when no session exists yet (the common
  case — first-run bootstrap, before any staff row exists), matching Sprint 1's `paySettlement`
  precedent for an unavoidable pre-existing identity gap.

- [ ] **Step 1: Write the failing test**

Add to the existing test file (match its established mock style):

```ts
  it('publishes device.registered with staffId from the active session if one exists', async () => {
    const { publishEvent } = await import('@/services/events/publishEvent')
    const { registerDevice } = useDeviceRegistration()
    await registerDevice('shop1')

    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'device.registered',
      payload: expect.objectContaining({ isTemporary: expect.any(Boolean) }),
    }))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useDeviceRegistration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the direct `publishEvent()` call**

```ts
// src/features/devices/composables/useDeviceRegistration.ts -- add to imports
import { publishEvent } from '@/services/events/publishEvent'
import { useSessionStore } from '@/store/session.store'
import { DeviceEventType, type DeviceRegisteredPayload } from '@/services/events/domainEvent.types'
```

Add a small local helper and call it from both return points inside `registerDevice`:

```ts
  async function registerDevice(shopId: string): Promise<{ id: string; code: string; isTemporary: boolean }> {
    const id = uuidv4()

    function publishRegistered(result: { id: string; code: string; isTemporary: boolean }) {
      // Bespoke publish (WAFI-140 Sprint 2 design spec §5): registerDevice is an RPC call +
      // local insert, not a local-write-then-audit pair -- it intentionally bypasses
      // executeBusinessOperation, which has no RPC-aware variant today.
      void publishEvent<DeviceRegisteredPayload>({
        type: DeviceEventType.Registered,
        entityId: result.id,
        payload: { deviceId: result.id, deviceCode: result.code, isTemporary: result.isTemporary },
        payloadVersion: 1,
        // First-run bootstrap has no staff row yet -- '' is a documented, pre-existing-shape
        // gap (mirrors paySettlement's shopId: '' from Sprint 1), not silently swallowed.
        staffId: useSessionStore().activeStaff?.id ?? '',
        shopId,
        occurredAt: new Date().toISOString(),
      }).catch(() => {})
      return result
    }

    try {
      const { data: code, error } = await supabase.rpc('register_device', { p_device_id: id })
      if (error) throw error
      if (code) return publishRegistered({ id, code, isTemporary: false })
    } catch {
      // Offline or the RPC is unreachable -- fall through to a temp code.
    }

    const tempCode = `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    await db.execute(
      `INSERT INTO devices (id, shop_id, code, is_temporary, registered_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, shopId, tempCode, 1, new Date().toISOString()]
    )
    return publishRegistered({ id, code: tempCode, isTemporary: true })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useDeviceRegistration.test.ts`
Expected: PASS (5/5 — the 4 pre-existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add src/features/devices/composables/useDeviceRegistration.ts src/__tests__/features/useDeviceRegistration.test.ts
git commit -m "feat(WAFI-140): publish device.registered from registerDevice()"
```

---

### Task 11: Documentation — DOMAIN INTERACTION MATRIX + readiness plan status

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md` (Events row in DOMAIN INTERACTION MATRIX)
- Modify: `WAFI_Production_Readiness_Plan_v3.md` (WAFI-140 status row)

**Interfaces:** none — documentation-only task.

- [ ] **Step 1: Update the Events row in the DOMAIN INTERACTION MATRIX**

In `AI_PRINCIPAL_ENGINEER_REVIEW.md`, replace the Sprint-1-era Events row with:

```
| Events | `events`, `daily_event_counts`, `local_event_processed_ledger` (local-only), `local_event_publish_retries` (local-only) | Sales, Returns, Customer Credit, Inventory, Staff, Expense, Cash/Shifts, Products, Devices (all event producers) | `useEventSubscription`, `processProjectionAtMostOnce`, `retryPendingEventPublishes`, `isTransientPublishFailure`, `getRetryQueueStats` | none yet (still no user-facing consumer — WAFI-143/144/145/146) |
```

- [ ] **Step 2: Update WAFI-140's status entry**

In `WAFI_Production_Readiness_Plan_v3.md`, replace the current Macro-Phase 2 row (added by the
Sprint 1 plan) with:

```
| Macro-Phase 2 (WAFI-152, WAFI-140, WAFI-150/143/144/145/146/142) | 🟡 In progress — WAFI-152 shipped 2026-07-31, WAFI-140 Sprint 1 shipped 2026-08-01, WAFI-140 Sprint 2 shipped [DATE] | WAFI-152 (Business Services Layer) done. WAFI-140 Sprint 1 (event bus core) done. WAFI-140 Sprint 2 (idempotency ledger, publish-failure retry queue with backoff/classification, 8 more events wired -- sale.returned, customer.debt_changed, cash.movement_recorded, stock.taken, product.price_changed/cost_updated/created, device.registered) done. `supplier.receiving_posted` was dropped as redundant with the already-firing `stock.received` event at the same call site. Sprint 3 (security hardening, rate limiting) not started. WAFI-150/143/144/145/146/142 not started. |
```

Fill `[DATE]` with the actual merge date at implementation time (do not leave the literal
placeholder in the committed file).

- [ ] **Step 3: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md WAFI_Production_Readiness_Plan_v3.md
git commit -m "docs(WAFI-140): update domain matrix and readiness plan status for Sprint 2"
```

---

## Final Verification

- [ ] Run `npx vue-tsc -b --noEmit` — no errors.
- [ ] Run `npx vitest run` — full suite passes, no regressions.
- [ ] Manually confirm (grep) no remaining call site constructs a `DomainEvent` object without
      `payloadVersion`.
- [ ] Manually confirm `git grep -n "supplier.receiving_posted"` returns no hits in `src/` — this
      event was deliberately not built (Global Constraints), only referenced in docs/specs.
- [ ] Manually confirm every new `executeBusinessOperation` retrofit (`useStockTake.ts`,
      `useProducts.ts`) still calls its pre-existing `useAuditLog()` function exactly once per
      operation — no duplicate or missing audit rows.
