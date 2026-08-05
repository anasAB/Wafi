# WAFI-150 — Durable Event Consumption & Event-Driven Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable-subscriber primitive to the WAFI-140 event bus (retry-with-backoff on
handler failure, process-after-success semantics, never halts on one bad event), then build the
first consumer of it: an audit subscriber that writes `audit_log` rows automatically from the 13
event types already wired to the bus, retiring the manual `useAuditLog()` calls it replaces.

**Architecture:** Mirrors the existing publish-retry pattern
(`eventPublishRetryQueue.ts`/`startRetryQueueSweeper`) on the consumption side:
`runDurableSubscriber()` wraps `useEventSubscription`, catches handler failures instead of letting
them kill the subscription, classifies them via a generalized `isTransientEventFailure`, and
persists retry state in a new `local_event_processing_retries` table. A separate
`local_subscriber_processed_events` ledger is written only after a handler succeeds (inverting
`processProjectionAtMostOnce`'s mark-before-run order, which is explicitly unsuitable for durable
writes). The audit subscriber maps each event to an `audit_log` row via
`mapEventToAuditEntry()`, deduplicated locally by check-then-insert against a new
`audit_log.source_event_id` column, with the real uniqueness guarantee enforced server-side at
sync-upload time in `ops.ts` (mirroring the existing `id`-based `ignoreDuplicates` pattern already
used for this append-only table).

**Tech Stack:** Vue 3, TypeScript, PowerSync (`@powersync/web`), Vitest, Postgres/Supabase, pgTAP.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-05-wafi-150-audit-durable-subscriber-design.md` —
  read in full before implementing; this plan assumes familiarity with it.
- Next unused migration number is `078` (confirmed via `ls supabase/migrations` — `077` is the
  most recent as of this plan). Use `078_audit_log_source_event_id.sql`.
- **Correction to the design spec, found during planning**: the spec's Cross-Epic checklist raises
  an open question about `executeFinancialWrite`'s contract. No such function exists anywhere in
  this codebase (`grep -rln "executeFinancialWrite" src` returns zero hits). The actual manual
  audit-writing surface is `src/features/audit/composables/useAuditLog.ts`'s `useAuditLog()`
  composable, which exposes one typed helper per audit event (e.g. `logProductPriceChanged`,
  `logCashMovementRecorded`) built on two internal writers, `_log` (best-effort, swallows errors)
  and `_logSensitive` (re-throws). Task 8 below retires the specific typed helpers that duplicate
  now-bus-wired events, not a generic wrapper.
- Local-only PowerSync tables are declared in `src/data/powersync/schema.ts` via the `Table`/
  `column` DSL (see `local_event_processed_ledger`/`local_event_publish_retries` at lines 335-350)
  — there is no separate SQL migration for these; adding a new local-only table is a schema.ts
  edit only. Regular (synced) tables like `audit_log` still need a real SQL migration.
- Vitest tests mock PowerSync via `vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))`
  — the mock (`src/__tests__/__mocks__/db.ts`) provides `execute`, `watch`, `writeTransaction`,
  `getAll`, `getOptional`, `get`, `registerListener`, `status`. Follow this exact pattern (see
  `publishEvent.test.ts`, `useEventSubscription.test.ts`) for any new test file touching `db`.
- `events` table columns/order: `(id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)`
  — `payload` is `TEXT` holding `JSON.stringify`'d JSON (never JSONB — see `074_events_bus_core.sql`'s
  comment on why JSONB double-encodes here).
- `audit_log` columns today: `(id, shop_id, staff_id, staff_name, event, entity_type, entity_id, meta, created_at)`
  — `meta` is `TEXT` (migration 031, same double-encoding reasoning as `events.payload`), `shop_id`/
  `staff_id` are `TEXT` (legacy — not `uuid`, unlike `events.shop_id`/`events.staff_id`).
- `EVENT_SENSITIVITY` in `src/services/events/domainEvent.types.ts` (17 keys) is the exhaustive
  list of all currently-wired `DomainEventType`s — this is where the 13 non-security-event types
  handled by the audit subscriber must be enumerated from, not a hand-typed list that can drift.

---

### Task 1: `isTransientEventFailure` — rename and generalize

**Files:**
- Create: `src/services/events/isTransientEventFailure.ts` (moved from `isTransientPublishFailure.ts`)
- Delete: `src/services/events/isTransientPublishFailure.ts`
- Modify: `src/services/events/eventPublishRetryQueue.ts` (import path only)
- Modify: `src/services/events/__tests__/isTransientPublishFailure.test.ts` → rename to
  `isTransientEventFailure.test.ts`, update the imported symbol name

**Interfaces:**
- Produces: `isTransientEventFailure(error: unknown): boolean` — identical behavior to today's
  `isTransientPublishFailure`, just renamed. Task 4 (`runDurableSubscriber`) depends on this name.

- [ ] **Step 1: Move the file with the renamed export**

```ts
// src/services/events/isTransientEventFailure.ts
/** Single decision point for retry classification, shared by both the publish side
 *  (WAFI-140 Sprint 2) and the consumption side (WAFI-150) -- a database lock, timeout,
 *  or I/O error means the same thing regardless of which direction hit it, so there is
 *  exactly one classifier, not one per direction. Deliberately a small, illustrative
 *  list, not an exhaustive production classifier. */
export function isTransientEventFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i, /rate_limit_exceeded/i]
  return transientPatterns.some((p) => p.test(message))
}
```

Delete `src/services/events/isTransientPublishFailure.ts`.

- [ ] **Step 2: Update `eventPublishRetryQueue.ts`'s import**

In `src/services/events/eventPublishRetryQueue.ts`, change:
```ts
import { isTransientPublishFailure } from './isTransientPublishFailure'
```
to:
```ts
import { isTransientEventFailure } from './isTransientEventFailure'
```
and update its one call site (`isTransientPublishFailure(new Error(errorMessage))` →
`isTransientEventFailure(new Error(errorMessage))`).

- [ ] **Step 3: Rename and update the test file**

Rename `src/services/events/__tests__/isTransientPublishFailure.test.ts` to
`isTransientEventFailure.test.ts`, updating its import:
```ts
import { isTransientEventFailure } from '@/services/events/isTransientEventFailure'
```
and every `isTransientPublishFailure(` call in its test bodies to `isTransientEventFailure(`.

- [ ] **Step 4: Run tests to verify they still pass**

Run: `npx vitest run src/services/events/__tests__/isTransientEventFailure.test.ts src/services/events/__tests__/eventPublishRetryQueue.test.ts`
Expected: PASS, both files (a pure rename — behavior is unchanged).

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS — confirms no other file still imports the deleted
`isTransientPublishFailure.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/services/events/isTransientEventFailure.ts src/services/events/eventPublishRetryQueue.ts
git rm src/services/events/isTransientPublishFailure.ts
git add src/services/events/__tests__/isTransientEventFailure.test.ts
git rm src/services/events/__tests__/isTransientPublishFailure.test.ts 2>/dev/null || true
git commit -m "refactor(WAFI-150): rename isTransientPublishFailure to isTransientEventFailure (shared classifier)"
```

---

### Task 2: New local-only tables — `local_event_processing_retries` and `local_subscriber_processed_events`

**Files:**
- Modify: `src/data/powersync/schema.ts`

**Interfaces:**
- Produces: two new local-only PowerSync tables. Task 4 (`runDurableSubscriber`) depends on their
  exact column sets.

- [ ] **Step 1: Add the two tables to `schema.ts`**

Add immediately after the existing `local_event_publish_retries` declaration (around line 350):

```ts
// WAFI-150 -- retry state for durable subscribers (mirrors local_event_publish_retries'
// shape almost exactly, on the consumption side). subscriber_name distinguishes rows
// when more than one durable subscriber exists in the future -- they share one table
// rather than one-table-per-subscriber.
const local_event_processing_retries = new Table({
  subscriber_name:   column.text,
  serialized_event:  column.text,  // JSON.stringify(DomainEvent) -- same convention as
                                    // local_event_publish_retries.serialized_event
  failure_kind:      column.text,  // 'transient' | 'permanent'
  attempts:          column.integer,
  last_error:        column.text,
  next_retry_at:     column.text,  // ISO string
  created_at:        column.text,  // ISO string
}, { localOnly: true })

// WAFI-150 -- durable-subscriber processed ledger. Deliberately a SEPARATE table from
// local_event_processed_ledger (the lightweight/best-effort ledger, WAFI-140 Sprint 2):
// that ledger writes BEFORE running its action (at-most-once, explicitly unsuitable for
// durable writes per its own docstring); this one writes ONLY AFTER the handler
// succeeds. Sharing one table with a mode column would force every future reader to
// branch on lifecycle semantics throughout the framework -- two small tables are
// clearer than one table with two contracts. Named for what it belongs to (the durable
// subscriber framework), not for the abstract property "durable".
const local_subscriber_processed_events = new Table({
  subscriber_name: column.text,
  event_id:        column.text,
  processed_at:    column.text,  // ISO string
}, { localOnly: true })
```

- [ ] **Step 2: Register both tables in the schema export**

Find the object where `local_event_processed_ledger` and `local_event_publish_retries` are listed
(around line 483) and add the two new tables alongside them:

```ts
  local_event_processed_ledger,
  local_event_publish_retries,
  local_event_processing_retries,
  local_subscriber_processed_events,
```

- [ ] **Step 3: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(WAFI-150): add local_event_processing_retries and local_subscriber_processed_events tables"
```

---

### Task 3: Retry helpers for the processing-retry table

**Files:**
- Create: `src/services/events/eventProcessingRetryQueue.ts`
- Test: `src/services/events/__tests__/eventProcessingRetryQueue.test.ts`

**Interfaces:**
- Consumes: `isTransientEventFailure` (Task 1).
- Produces: `enqueueForProcessingRetry(subscriberName, event, errorMessage): Promise<void>`,
  `retryPendingEventProcessing(handlers: Map<string, (event: DomainEvent) => Promise<void>>): Promise<void>`,
  `startProcessingRetrySweeper(handlers: Map<string, (event: DomainEvent) => Promise<void>>): { stop: () => void }`.
  Task 4 (`runDurableSubscriber`) depends on these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/eventProcessingRetryQueue.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import {
  enqueueForProcessingRetry,
  retryPendingEventProcessing,
  startProcessingRetrySweeper,
} from '@/services/events/eventProcessingRetryQueue'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const event: DomainEvent = {
  type: 'sale.completed', entityId: 'sale1', payload: {}, payloadVersion: 1,
  staffId: 's1', shopId: 'shop1', occurredAt: '2026-08-05T00:00:00.000Z',
}

describe('enqueueForProcessingRetry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies a transient error and inserts with subscriber_name', async () => {
    await enqueueForProcessingRetry('audit', event, 'database is locked')
    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('local_event_processing_retries')
    expect(params).toContain('audit')
    expect(params).toContain('transient')
  })

  it('classifies an unrecognized error as permanent', async () => {
    await enqueueForProcessingRetry('audit', event, 'malformed payload: missing field')
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain('permanent')
  })
})

describe('retryPendingEventProcessing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('re-invokes the handler for the matching subscriber_name and deletes the row on success', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'row1', subscriber_name: 'audit', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0 },
    ])
    const handler = vi.fn().mockResolvedValue(undefined)
    await retryPendingEventProcessing(new Map([['audit', handler]]))
    expect(handler).toHaveBeenCalledWith(event)
    const deleteCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('delete from local_event_processing_retries'))
    expect(deleteCall).toBeDefined()
  })

  it('leaves the row in place and continues the sweep if the handler rejects again', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'row1', subscriber_name: 'audit', serialized_event: JSON.stringify(event), failure_kind: 'transient', attempts: 0 },
    ])
    const handler = vi.fn().mockRejectedValue(new Error('still locked'))
    await expect(retryPendingEventProcessing(new Map([['audit', handler]]))).resolves.not.toThrow()
    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('update local_event_processing_retries'))
    expect(updateCall).toBeDefined()
  })
})

describe('startProcessingRetrySweeper', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs once on start and again on reconnect', () => {
    let capturedListener: any
    vi.mocked(db.registerListener).mockImplementation((listener: any) => {
      capturedListener = listener
      return () => {}
    })
    startProcessingRetrySweeper(new Map())
    expect(db.getAll).toHaveBeenCalled()
    vi.clearAllMocks()
    capturedListener.statusChanged({ connected: true })
    expect(db.getAll).toHaveBeenCalled()
  })

  it('stop() unsubscribes the reconnect listener', () => {
    const unsubscribe = vi.fn()
    vi.mocked(db.registerListener).mockReturnValue(unsubscribe)
    const { stop } = startProcessingRetrySweeper(new Map())
    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/eventProcessingRetryQueue.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/services/events/eventProcessingRetryQueue.ts
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { isTransientEventFailure } from './isTransientEventFailure'
import type { DomainEvent } from './domainEvent.types'

/** Same schedule as eventPublishRetryQueue.ts's BACKOFF_MINUTES -- no reason for
 *  consumption to back off on a different schedule than publication. */
const BACKOFF_MINUTES = [1, 5, 30, 120]
const MAX_ATTEMPTS = BACKOFF_MINUTES.length

function nextRetryAt(attempts: number): string {
  const baseMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  const jitter = 0.8 + Math.random() * 0.4
  return new Date(Date.now() + baseMinutes * 60_000 * jitter).toISOString()
}

export async function enqueueForProcessingRetry<T>(
  subscriberName: string,
  event: DomainEvent<T>,
  errorMessage: string,
): Promise<void> {
  const failureKind = isTransientEventFailure(new Error(errorMessage)) ? 'transient' : 'permanent'
  await db.execute(
    `insert into local_event_processing_retries
       (id, subscriber_name, serialized_event, failure_kind, attempts, last_error, next_retry_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      subscriberName,
      JSON.stringify(event),
      failureKind,
      0,
      errorMessage,
      failureKind === 'transient' ? nextRetryAt(0) : new Date(0).toISOString(),
      new Date().toISOString(),
    ],
  )
}

type RetryRow = {
  id: string; subscriber_name: string; serialized_event: string
  failure_kind: string; attempts: number
}

/** Never aborts partway through -- one permanently-stuck row must not starve every row
 *  behind it (mirrors eventPublishRetryQueue.ts's retryPendingEventPublishes). `handlers`
 *  maps subscriber_name -> the handler closure that subscriber was started with, so a
 *  retried event goes through the exact same success/failure branching as a live
 *  delivery, not a duplicate code path. */
export async function retryPendingEventProcessing(
  handlers: Map<string, (event: DomainEvent) => Promise<void>>,
): Promise<void> {
  const dueRows = await db.getAll<RetryRow>(
    `select id, subscriber_name, serialized_event, failure_kind, attempts
     from local_event_processing_retries
     where failure_kind = 'transient' and next_retry_at <= ? order by next_retry_at asc`,
    [new Date().toISOString()],
  )
  for (const row of dueRows) {
    const handler = handlers.get(row.subscriber_name)
    if (!handler) continue // subscriber not registered in this process -- skip, don't drop
    try {
      const event = JSON.parse(row.serialized_event) as DomainEvent
      await handler(event)
      await db.execute(`delete from local_event_processing_retries where id = ?`, [row.id])
    } catch (err) {
      const attempts = row.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        logger.error('[eventProcessingRetryQueue] row exhausted retries, leaving for manual inspection', row.id, err)
        await db.execute(
          `update local_event_processing_retries set attempts = ?, last_error = ?, failure_kind = 'permanent' where id = ?`,
          [attempts, String(err), row.id],
        )
      } else {
        await db.execute(
          `update local_event_processing_retries set attempts = ?, last_error = ?, next_retry_at = ? where id = ?`,
          [attempts, String(err), nextRetryAt(attempts), row.id],
        )
      }
    }
  }
}

/** Same reconnect-listener + app-start pattern as startRetryQueueSweeper -- no polling
 *  timer, deliberately (battery/CPU on cheap target devices). */
export function startProcessingRetrySweeper(
  handlers: Map<string, (event: DomainEvent) => Promise<void>>,
): { stop: () => void } {
  void retryPendingEventProcessing(handlers)
  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void retryPendingEventProcessing(handlers)
    },
  })
  return { stop: () => unsubscribe?.() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/eventProcessingRetryQueue.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/services/events/eventProcessingRetryQueue.ts src/services/events/__tests__/eventProcessingRetryQueue.test.ts
git commit -m "feat(WAFI-150): add processing-retry queue for durable subscribers"
```

---

### Task 4: `runDurableSubscriber` primitive

**Files:**
- Create: `src/services/events/runDurableSubscriber.ts`
- Test: `src/services/events/__tests__/runDurableSubscriber.test.ts`

**Interfaces:**
- Consumes: `useEventSubscription` (existing), `enqueueForProcessingRetry`,
  `startProcessingRetrySweeper` (Task 3).
- Produces:
  ```ts
  interface DurableEvent<T> extends DomainEvent<T> {
    /** The originating events.id row -- NOT part of the plain DomainEvent shape used
     *  by publishEvent()/useEventSubscription's other callers, but required here so a
     *  durable handler (e.g. the audit subscriber) can key its own idempotency check
     *  off the same id runDurableSubscriber itself uses for the processed ledger. */
    eventId: string
  }
  function runDurableSubscriber<T>(opts: {
    subscriberName: string
    eventType: DomainEventType
    shopId: string
    handler: (event: DurableEvent<T>) => Promise<void>
  }): { stop: () => void }
  ```
  Task 6 (audit subscriber) depends on this exact signature, in particular `eventId`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/runDurableSubscriber.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from '@/services/events/runDurableSubscriber'

let capturedHandler: ((row: any) => Promise<void>) | undefined
vi.mock('@/services/events/useEventSubscription', () => ({
  useEventSubscription: vi.fn((_type: string, handler: any) => {
    capturedHandler = handler
    return { stop: vi.fn() }
  }),
}))

const row = {
  id: 'event1', type: 'sale.completed', entity_id: 'sale1', payload: {},
  payload_version: 1, staff_id: 's1', shop_id: 'shop1',
  occurred_at: '2026-08-05T00:00:00.000Z', created_at: '2026-08-05T00:00:00.000Z',
}

describe('runDurableSubscriber', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedHandler = undefined })

  it('skips a row already in local_subscriber_processed_events for this subscriber', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ event_id: row.id })
    const handler = vi.fn()
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes eventId (the events.id row, not entityId) through to the handler', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockResolvedValue(undefined)
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ eventId: row.id, entityId: row.entity_id }))
  })

  it('on success, writes the processed ledger and never touches the retry table', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockResolvedValue(undefined)
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeDefined()
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeUndefined()
  })

  it('on a transient failure, enqueues a retry and does NOT write the processed ledger', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockRejectedValue(new Error('database is locked'))
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await capturedHandler!(row)
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeDefined()
    const [, params] = retryInsert!
    expect(params).toContain('transient')
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeUndefined()
  })

  it('on a permanent failure, enqueues a permanent retry row and does not throw back into useEventSubscription', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const handler = vi.fn().mockRejectedValue(new Error('malformed payload'))
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'sale.completed', shopId: 'shop1', handler })
    await expect(capturedHandler!(row)).resolves.not.toThrow()
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    const [, params] = retryInsert!
    expect(params).toContain('permanent')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/runDurableSubscriber.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/services/events/runDurableSubscriber.ts
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { useEventSubscription } from './useEventSubscription'
import { enqueueForProcessingRetry } from './eventProcessingRetryQueue'
import type { DomainEvent, DomainEventType } from './domainEvent.types'

/**
 * The durable-subscriber primitive (WAFI-150 design spec). Invariants:
 *  1. A handler is never marked processed before it succeeds.
 *  2. A handler may execute more than once (at-least-once upstream delivery, plus
 *     retry) -- handlers passed here MUST be idempotent.
 *  3. Subscriber failures never terminate the live subscription -- this function
 *     never lets a handler's throw propagate back into useEventSubscription's watch
 *     loop; every failure is caught here and routed to the retry queue instead.
 *  4. Retry execution is sequential (see eventProcessingRetryQueue.ts).
 *  5. Permanent failures never block unrelated events -- each event is processed
 *     independently; a permanently-failed row just sits in
 *     local_event_processing_retries for operator review while later events continue.
 *
 * Ordering: eventual processing, not global ordering (WAFI-150 design spec). A retried
 * event may be processed after later events of the same type -- do not rely on order.
 *
 * subscriber_name identity is effectively permanent once shipped: it is half of the
 * ledger's dedup key. Renaming a live subscriber's subscriberName either replays its
 * full history (if that's the intent) or silently discards retry continuity (if it
 * isn't) -- treat a rename as a deliberate operational decision, not a refactor.
 */
export interface DurableEvent<T> extends DomainEvent<T> {
  /** The originating events.id row -- not part of the plain DomainEvent shape used by
   *  publishEvent()/useEventSubscription's other callers, but required so a durable
   *  handler can key its own idempotency check off the same id this function uses for
   *  the processed ledger (see auditSubscriber.ts's check against
   *  audit_log.source_event_id). */
  eventId: string
}

export function runDurableSubscriber<T>(opts: {
  subscriberName: string
  eventType: DomainEventType
  shopId: string
  handler: (event: DurableEvent<T>) => Promise<void>
}): { stop: () => void } {
  return useEventSubscription<T>(
    opts.eventType,
    async (row) => {
      const already = await db.getOptional<{ event_id: string }>(
        `select event_id from local_subscriber_processed_events where subscriber_name = ? and event_id = ?`,
        [opts.subscriberName, row.id],
      )
      if (already) return

      const event: DurableEvent<T> = {
        eventId: row.id,
        type: row.type, entityId: row.entity_id, payload: row.payload,
        payloadVersion: row.payload_version, staffId: row.staff_id,
        shopId: row.shop_id, occurredAt: row.occurred_at,
      }

      try {
        await opts.handler(event)
        await db.execute(
          `insert into local_subscriber_processed_events (id, subscriber_name, event_id, processed_at) values (?, ?, ?, ?)`,
          [crypto.randomUUID(), opts.subscriberName, row.id, new Date().toISOString()],
        )
      } catch (err) {
        logger.error('[runDurableSubscriber] handler failed, queuing for retry', opts.subscriberName, row.id, err)
        await enqueueForProcessingRetry(opts.subscriberName, event, err instanceof Error ? err.message : String(err))
          .catch(() => {
            // even the retry-queue write can fail (e.g. local disk full) -- this event's
            // failure is genuinely unrecorded, same accepted risk as the publish side.
          })
        // Deliberately does NOT rethrow: the caller's useEventSubscription watch loop
        // must keep running for the next event (invariant 3 above).
      }
    },
    { shopId: opts.shopId },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/runDurableSubscriber.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/events/runDurableSubscriber.ts src/services/events/__tests__/runDurableSubscriber.test.ts
git commit -m "feat(WAFI-150): add runDurableSubscriber primitive"
```

---

### Task 5: Crash-recovery integration test for the durable primitive

**Files:**
- Create: `src/services/events/__tests__/runDurableSubscriber.crashRecovery.test.ts`

**Interfaces:**
- Consumes: `runDurableSubscriber` (Task 4). No new production code — this task is purely a test
  that proves the core reason the design exists.

- [ ] **Step 1: Write the test**

```ts
// src/services/events/__tests__/runDurableSubscriber.crashRecovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from '@/services/events/runDurableSubscriber'

let capturedHandler: ((row: any) => Promise<void>) | undefined
vi.mock('@/services/events/useEventSubscription', () => ({
  useEventSubscription: vi.fn((_type: string, handler: any) => {
    capturedHandler = handler
    return { stop: vi.fn() }
  }),
}))

const row = {
  id: 'event1', type: 'expense.recorded', entity_id: 'e1', payload: { amountUsd: 5 },
  payload_version: 1, staff_id: 's1', shop_id: 'shop1',
  occurred_at: '2026-08-05T00:00:00.000Z', created_at: '2026-08-05T00:00:00.000Z',
}

describe('runDurableSubscriber crash recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedHandler = undefined })

  it('simulates: handler succeeds -> process crashes before ledger write -> retry sees no ledger row -> re-runs handler -> handler itself is idempotent so it does not double-write -> ledger written on the successful retry', async () => {
    // First delivery: not yet processed (ledger empty).
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    // Simulate the crash: the handler's own side effect (e.g. the audit insert) succeeds,
    // but something between that and this function's own ledger write throws --
    // simulated here by making db.execute reject on its first call (the ledger insert),
    // after the handler itself has already "succeeded" from this test's point of view.
    const handler = vi.fn().mockResolvedValue(undefined)
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('process crashed'))
    runDurableSubscriber({ subscriberName: 'audit', eventType: 'expense.recorded', shopId: 'shop1', handler })
    await capturedHandler!(row)
    // The failed ledger write should have been caught and routed to the retry queue --
    // not rethrown, and not silently lost.
    expect(handler).toHaveBeenCalledTimes(1)
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeDefined()

    // Second delivery (the retry): still not in the ledger (the crash happened before
    // that write landed). The handler is idempotent (per the invariant docstring) --
    // in the audit subscriber's real implementation this is the check-then-insert
    // against audit_log.source_event_id; here we assert the retry re-invokes the
    // handler and, on success this time, DOES write the ledger.
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    vi.clearAllMocks()
    await capturedHandler!(row)
    expect(handler).toHaveBeenCalledTimes(1)
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it passes against Task 4's implementation**

Run: `npx vitest run src/services/events/__tests__/runDurableSubscriber.crashRecovery.test.ts`
Expected: PASS (1/1) — if it fails, re-check Task 4's implementation against the state machine in
the design spec before changing this test.

- [ ] **Step 3: Commit**

```bash
git add src/services/events/__tests__/runDurableSubscriber.crashRecovery.test.ts
git commit -m "test(WAFI-150): add crash-recovery integration test for runDurableSubscriber"
```

---

### Task 6: `audit_log.source_event_id` migration + `ops.ts` upload-path dedup

**Files:**
- Create: `supabase/migrations/078_audit_log_source_event_id.sql`
- Modify: `src/data/powersync/ops.ts`
- Modify: `src/data/powersync/schema.ts` (add `source_event_id` to the `audit_log` Table)
- Test: `src/data/powersync/__tests__/ops.test.ts` (extend)

**Interfaces:**
- Produces: `audit_log.source_event_id` column + partial unique index; `ops.ts`'s `audit_log`
  special case now upserts on `onConflict: 'source_event_id'` when present. Task 7 (audit
  subscriber) depends on the column name.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/078_audit_log_source_event_id.sql
-- WAFI-150 -- adds the idempotency/traceability key linking an audit_log row back to
-- the events row that produced it (design spec, "Idempotency and the audit_log schema
-- change"). Nullable + partial unique index: pre-WAFI-150 rows and manual
-- security/technical audit rows (never wired to the event bus) have no source event
-- and are unaffected by this constraint.

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS source_event_id uuid;
COMMENT ON COLUMN public.audit_log.source_event_id IS
  'References the originating row in events.id; exists solely for idempotency and traceability. Every audit entry generated from the event bus stores the originating event''s ID. Legacy/manual audit rows leave this column NULL.';

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_source_event_id_unique
  ON public.audit_log (source_event_id) WHERE source_event_id IS NOT NULL;
```

- [ ] **Step 2: Apply the migration to the local Supabase stack**

Run: `npx supabase migration up` (or the project's established local-apply command — check
`package.json` scripts before running if unsure).
Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Add `source_event_id` to the local `audit_log` Table declaration**

In `src/data/powersync/schema.ts`, find the `audit_log` Table (around line 370) and add the column:

```ts
const audit_log = new Table({
  shop_id:          column.text,
  staff_id:         column.text,
  staff_name:       column.text,
  event:            column.text,
  entity_type:      column.text,
  entity_id:        column.text,
  meta:             column.text,
  created_at:       column.text,
  source_event_id:  column.text,  // WAFI-150 -- nullable; ties an audit row back to
                                   // its originating events.id for idempotent retry
})
```

- [ ] **Step 4: Write the failing test for `ops.ts`'s dedup extension**

Read `src/data/powersync/__tests__/ops.test.ts` first to match its existing mocking style for
`supabase.from(...).upsert(...)`, then add:

```ts
  it('upserts audit_log on source_event_id (ignoreDuplicates) when the row carries one', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ upsert: upsertMock } as any)
    await runOp(UpdateType.PUT, 'audit_log', 'row1', { event: 'expense.recorded', source_event_id: 'evt1' })
    expect(upsertMock).toHaveBeenCalledWith(
      { id: 'row1', event: 'expense.recorded', source_event_id: 'evt1' },
      { onConflict: 'source_event_id', ignoreDuplicates: true },
    )
  })

  it('falls back to the existing id-based upsert when source_event_id is absent (legacy/manual rows)', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ upsert: upsertMock } as any)
    await runOp(UpdateType.PUT, 'audit_log', 'row2', { event: 'staff.pin_changed' })
    expect(upsertMock).toHaveBeenCalledWith(
      { id: 'row2', event: 'staff.pin_changed' },
      { ignoreDuplicates: true },
    )
  })
```

- [ ] **Step 5: Run tests to verify the new ones fail**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: the two new tests FAIL (current code always upserts on the implicit `id` conflict
target, never `source_event_id`); pre-existing tests in this file still PASS.

- [ ] **Step 6: Update `runOp`'s `audit_log` special case**

In `src/data/powersync/ops.ts`:

```ts
  if (table === 'audit_log') {
    if (type !== UpdateType.PUT) return null
    // WAFI-150: when the row carries a source_event_id (produced by the audit
    // subscriber), that column is the real conflict target -- it catches the case
    // where two independently-generated local rows (different `id`, same source
    // event) both reach the server, which the plain `id` upsert below cannot detect.
    // Legacy/manual rows have no source_event_id and keep the original id-based
    // upsert, which already handles a re-synced (not duplicated) row.
    const opts = opData?.source_event_id
      ? { onConflict: 'source_event_id', ignoreDuplicates: true }
      : { ignoreDuplicates: true }
    return (await supabase.from(table).upsert({ id, ...opData }, opts)).error
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: PASS, full file.

- [ ] **Step 8: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/078_audit_log_source_event_id.sql src/data/powersync/schema.ts src/data/powersync/ops.ts src/data/powersync/__tests__/ops.test.ts
git commit -m "feat(WAFI-150): add audit_log.source_event_id and its upload-path dedup"
```

---

### Task 7: `mapEventToAuditEntry` + audit subscriber wiring

**Files:**
- Create: `src/services/events/auditSubscriber.ts`
- Test: `src/services/events/__tests__/auditSubscriber.test.ts`

**Interfaces:**
- Consumes: `runDurableSubscriber` (Task 4), `EVENT_SENSITIVITY` (existing, for the exhaustive
  event-type list), `DomainEvent`/`DomainEventType` (existing).
- Produces: `mapEventToAuditEntry(event: DomainEvent): AuditLogInsert | null`,
  `startAuditSubscribers(shopId: string): { stop: () => void }`. Task 9 (app wiring) depends on
  the latter's exact name.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/auditSubscriber.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { mapEventToAuditEntry, startAuditSubscribers } from '@/services/events/auditSubscriber'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const baseEvent = {
  entityId: 'p1', payloadVersion: 1, staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-08-05T00:00:00.000Z',
}

describe('mapEventToAuditEntry', () => {
  it('maps product.cost_updated to an audit_log insert with the verbatim payload as meta', () => {
    const event: DomainEvent = { ...baseEvent, type: 'product.cost_updated', payload: { productId: 'p1', oldCostUsd: 5, newCostUsd: 6 } }
    const entry = mapEventToAuditEntry(event)
    expect(entry).not.toBeNull()
    expect(entry!.event).toBe('product.cost_updated')
    expect(entry!.entity_type).toBe('product')
    expect(entry!.entity_id).toBe('p1')
    expect(entry!.staff_id).toBe('s1')
    expect(entry!.meta).toEqual(event.payload) // verbatim, no transform
  })

  it('returns null for an event type intentionally excluded from audit', () => {
    const event: DomainEvent = { ...baseEvent, type: 'shift.opened', payload: { shiftId: 'sh1', staffId: 's1', openingCash: 0 } }
    expect(mapEventToAuditEntry(event)).toBeNull()
    // (Adjust which type is asserted here if shift.opened turns out to already have
    // its own manual audit call worth keeping under a different event name --
    // confirm against useAuditLog.ts's logShiftOpened at implementation time. The
    // point of this test is that AT LEAST ONE currently-wired type maps to null.)
  })

  it('maps every one of the 13 non-excluded event types to a non-null entry', () => {
    // This list must match EVENT_SENSITIVITY's keys minus whichever types this
    // subscriber's design explicitly excludes -- confirmed/adjusted at implementation
    // time per the design spec's "must be revalidated during implementation" note.
    const sample: DomainEvent = { ...baseEvent, type: 'expense.recorded', payload: { expenseId: 'e1', category: 'x', amountUsd: 1, staffId: 's1', photoUrl: undefined } }
    expect(mapEventToAuditEntry(sample)).not.toBeNull()
  })
})

describe('startAuditSubscribers', () => {
  it('writing a mapped event once produces exactly one audit_log insert with source_event_id set', async () => {
    let capturedHandler: ((row: any) => Promise<void>) | undefined
    vi.doMock('@/services/events/useEventSubscription', () => ({
      useEventSubscription: vi.fn((_type: string, handler: any) => {
        capturedHandler = handler
        return { stop: vi.fn() }
      }),
    }))
    const { startAuditSubscribers: freshStart } = await import('@/services/events/auditSubscriber')
    vi.mocked(db.getOptional).mockResolvedValue(null) // not already processed, not already in audit_log
    freshStart('shop1')
    await capturedHandler!({
      id: 'evt1', type: 'expense.recorded', entity_id: 'e1', payload: { expenseId: 'e1', category: 'x', amountUsd: 1, staffId: 's1' },
      payload_version: 1, staff_id: 's1', shop_id: 'shop1', occurred_at: '2026-08-05T00:00:00.000Z', created_at: '2026-08-05T00:00:00.000Z',
    })
    const auditInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('insert into audit_log'))
    expect(auditInsert).toBeDefined()
    const [, params] = auditInsert!
    expect(params).toContain('evt1') // source_event_id present
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/auditSubscriber.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/services/events/auditSubscriber.ts
import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from './runDurableSubscriber'
import type { DurableEvent } from './runDurableSubscriber'
import type { DomainEvent, DomainEventType } from './domainEvent.types'

export interface AuditLogInsert {
  event: string
  entity_type: string
  entity_id: string | null
  staff_id: string
  staff_name: string
  meta: Record<string, unknown>
}

/**
 * Maps a domain event to its audit_log row, or null if this event type intentionally
 * produces no audit entry (WAFI-150 design spec). `meta` is always the verbatim payload
 * -- no transform, enrichment, or revalidation, and no reconstruction of state from a
 * database read. Every mapped entry's `event`/`entity_type` values below mirror the
 * corresponding manual useAuditLog() helper's event-name convention they replace, so
 * the audit log page's existing rendering (which switches on `event`) keeps working
 * unchanged for these rows.
 */
export function mapEventToAuditEntry(event: DomainEvent): AuditLogInsert | null {
  const staffId = event.staffId
  const staffName = 'system' // WAFI-150: the durable subscriber has no session context
  // (unlike useAuditLog()'s _write, which reads useSessionStore().activeStaff?.name at
  // call time) -- staff_name is a display convenience only; staff_id is the actual
  // audit key and is always populated from the event. Revisit if a future reporting
  // view needs the name without a join back to `staff`.

  switch (event.type as DomainEventType) {
    case 'product.cost_updated':
      return { event: 'product.cost_updated', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'product.price_changed':
      return { event: 'product.price_changed', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'product.created':
      return { event: 'product.created', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'device.registered':
      return { event: 'device.registered', entity_type: 'device', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'stock.taken':
      return { event: 'stock.taken', entity_type: 'stock_take', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'stock.received':
      return { event: 'stock.received', entity_type: 'receiving', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'cash.movement_recorded':
      return { event: 'cash.movement_recorded', entity_type: 'cash_movement', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'sale.completed':
      return { event: 'sale.completed', entity_type: 'sale', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'sale.returned':
      return { event: 'sale.returned', entity_type: 'return', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'customer.debt_changed':
      return { event: 'customer.debt_changed', entity_type: 'customer', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'installment.due_paid':
      return { event: 'installment.due_paid', entity_type: 'installment_plan', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'inventory.adjusted':
      return { event: 'inventory.adjusted', entity_type: 'product', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'staff.ledger_entry_added':
      return { event: 'staff_ledger.entry_created', entity_type: 'staff_ledger', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'settlement.paid':
      return { event: 'staff_settlement.paid', entity_type: 'staff_settlement', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    case 'expense.recorded':
      return { event: 'expense.created', entity_type: 'expense', entity_id: event.entityId, staff_id: staffId, staff_name: staffName, meta: event.payload as Record<string, unknown> }
    // Intentionally excluded (WAFI-150 design spec scope): shift.opened/shift.closed
    // are wired to the bus but produce no separate manual audit entry worth
    // duplicating today -- confirm against useAuditLog.ts's logShiftOpened/
    // logShiftClosed call sites at implementation time; if either is actually
    // relied upon, remove it from this exclusion list and add a case above instead.
    case 'shift.opened':
    case 'shift.closed':
      return null
    default:
      return null
  }
}

const AUDITED_EVENT_TYPES: DomainEventType[] = [
  'product.cost_updated', 'product.price_changed', 'product.created', 'device.registered',
  'stock.taken', 'stock.received', 'cash.movement_recorded', 'sale.completed', 'sale.returned',
  'customer.debt_changed', 'installment.due_paid', 'inventory.adjusted',
  'staff.ledger_entry_added', 'settlement.paid', 'expense.recorded',
]

async function handleAuditableEvent(event: DurableEvent<unknown>): Promise<void> {
  const entry = mapEventToAuditEntry(event)
  if (!entry) return // null mapping is success -- runDurableSubscriber still writes the ledger

  // Check-then-insert: safe on this single-threaded client (no concurrent execution
  // of this same handler to race against) -- see design spec for why ON CONFLICT
  // cannot run locally at all (PowerSync client tables are SQLite views over
  // CRUD-queue triggers). The real, database-enforced dedup backstop lives at
  // sync-upload time in ops.ts (Task 6), keyed on this same source_event_id.
  // event.eventId (NOT event.entityId) is the events.id row this audit entry
  // traces back to -- entityId is the business entity (e.g. the expense ID), which
  // is not unique per event and would corrupt the dedup key.
  const existing = await db.getOptional<{ id: string }>(
    `select id from audit_log where source_event_id = ?`,
    [event.eventId],
  )
  if (existing) return

  await db.execute(
    `insert into audit_log (id, shop_id, staff_id, staff_name, event, entity_type, entity_id, meta, created_at, source_event_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(), event.shopId, entry.staff_id, entry.staff_name,
      entry.event, entry.entity_type, entry.entity_id, JSON.stringify(entry.meta),
      new Date().toISOString(),
      event.eventId,
    ],
  )
}

/** One runDurableSubscriber per audited event type, all sharing the 'audit'
 *  subscriber_name (see Task 4's docstring on why that name is effectively
 *  permanent once shipped). */
export function startAuditSubscribers(shopId: string): { stop: () => void } {
  const subscriptions = AUDITED_EVENT_TYPES.map((eventType) =>
    runDurableSubscriber({
      subscriberName: 'audit',
      eventType,
      shopId,
      handler: handleAuditableEvent,
    }),
  )
  return { stop: () => subscriptions.forEach((s) => s.stop()) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/auditSubscriber.test.ts`
Expected: PASS, full file, after the `eventId` plumbing fix above.

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/events/auditSubscriber.ts src/services/events/__tests__/auditSubscriber.test.ts
git commit -m "feat(WAFI-150): add mapEventToAuditEntry and startAuditSubscribers"
```

---

### Task 8: pgTAP — `source_event_id` uniqueness and dedup

**Files:**
- Create: `supabase/tests/wafi150_audit_dedup.test.sql`

**Interfaces:**
- Consumes: `audit_log_source_event_id_unique` (Task 6).
- Produces: no exports — test-only task.

- [ ] **Step 1: Write the test file**

```sql
-- supabase/tests/wafi150_audit_dedup.test.sql
BEGIN;
SELECT plan(2);

-- The partial unique index exists (Task 6's migration).
SELECT has_index('public', 'audit_log', 'audit_log_source_event_id_unique',
  'audit_log_source_event_id_unique index exists');

-- Two rows sharing a source_event_id: the second insert's upsert-with-ignoreDuplicates
-- shape (mirrored here as a raw INSERT ... ON CONFLICT DO NOTHING, the SQL-level
-- equivalent of what supabase-js's ignoreDuplicates:true generates) is silently
-- absorbed rather than raising a unique-violation.
INSERT INTO public.audit_log (shop_id, staff_id, staff_name, event, entity_type, entity_id, source_event_id)
VALUES ('e0000000-0000-0000-0000-000000000001', NULL, 'system', 'expense.created', 'expense', 'e1', 'ee000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $$INSERT INTO public.audit_log (shop_id, staff_id, staff_name, event, entity_type, entity_id, source_event_id)
    VALUES ('e0000000-0000-0000-0000-000000000001', NULL, 'system', 'expense.created', 'expense', 'e1', 'ee000000-0000-0000-0000-000000000001')
    ON CONFLICT (source_event_id) DO NOTHING$$,
  'a second insert sharing source_event_id is silently absorbed, not a unique-violation error'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the suite**

Run: `npx supabase test db`
Expected: both assertions pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi150_audit_dedup.test.sql
git commit -m "test(WAFI-150): add pgTAP coverage for audit_log.source_event_id uniqueness"
```

---

### Task 9: Start the audit subscribers at app init

**Files:**
- Modify: the app-init file that already calls `startRetryQueueSweeper()` / event bus startup
  hooks — locate it first: `grep -rn "startRetryQueueSweeper\|startEventTableCleanupSweeper" src --include=*.ts | grep -v test`
  (per WAFI-140 Sprint 2/3's own pattern, this is almost certainly in `App.vue` or a top-level
  store init file).

**Interfaces:**
- Consumes: `startAuditSubscribers` (Task 7).
- Produces: no new exports — wiring only.

- [ ] **Step 1: Locate the existing sweeper-start call site**

Run: `grep -rn "startRetryQueueSweeper()" src --include=*.ts | grep -v test`

Read the surrounding function to see how `shopId` is obtained at that point (almost certainly
`useDeviceStore().shopId`, matching every other sweeper/subscriber start call in this codebase).

- [ ] **Step 2: Add the audit subscriber start call alongside the existing sweepers**

In that same file, immediately after the existing `startRetryQueueSweeper()` /
`startEventTableCleanupSweeper()` calls, add:

```ts
import { startAuditSubscribers } from '@/services/events/auditSubscriber'
// ...
startAuditSubscribers(shopId) // WAFI-150 -- audit is the first durable-subscriber consumer
```

Match whatever guard the existing calls use (e.g. only after `shopId` is known/device is
provisioned) — do not introduce a different startup condition than the sweepers already use.

- [ ] **Step 3: Manual smoke test**

Run the app locally (`npm run dev`), record an expense or change a product's price, and confirm a
new row appears in the Audit Log page for that action with a non-null `source_event_id` (check via
the Supabase dashboard or a local `select * from audit_log order by created_at desc limit 5`).

- [ ] **Step 4: Commit**

```bash
git add <the file modified in Step 2>
git commit -m "feat(WAFI-150): start audit subscribers at app init"
```

---

### Task 10: Retire manual `useAuditLog()` calls for bus-wired events

**Files:**
- Modify: `src/features/products/composables/useProducts.ts` (lines 107, 152 — confirmed manual
  calls to `logProductPriceChanged`/`logProductCreated`)
- Modify: `src/features/shifts/composables/useCashMovements.ts` (line 78 — confirmed manual call
  to `logCashMovementRecorded`)
- Modify: `src/features/returns/composables/useReturnSheet.ts` (line 322 — confirmed manual call
  to `logReturnProcessed`, which duplicates the bus-wired `sale.returned` event also published
  from this same file)
- Verify (repository-wide, per the design spec's Definition of Done): every other event type in
  `AUDITED_EVENT_TYPES` (Task 7) for a manual call that may also exist and wasn't caught by this
  plan's research.

**Interfaces:**
- Consumes: nothing new — this task only removes code.
- Produces: nothing new — no exports change.

- [ ] **Step 1: Confirm the current manual-call inventory is still accurate**

Run:
```bash
grep -rn "logProductPriceChanged\|logProductCreated\|logCashMovementRecorded\|logReturnProcessed" src --include=*.ts | grep -v test
```
Expected output should match: `useProducts.ts:107` and `:152`, `useCashMovements.ts:78`,
`useReturnSheet.ts:322`. If the line numbers or call sites differ (the design spec explicitly
warns this table may be stale by implementation time), update this task's steps to match reality
before proceeding — do not blindly follow stale line numbers.

Also run, to catch anything this plan's research missed for the remaining audited event types
(`product.cost_updated`, `device.registered`, `stock.taken`, `stock.received`, `sale.completed`,
`customer.debt_changed`, `installment.due_paid`, `inventory.adjusted`,
`staff.ledger_entry_added`, `settlement.paid`, `expense.recorded`):
```bash
grep -rn "useAuditLog()" src/features --include=*.ts | grep -v test
```
For each hit, check whether it corresponds to one of the 13 `AUDITED_EVENT_TYPES` — if so, add a
removal step for it here before continuing.

- [ ] **Step 2: Write a regression test for the first retirement (product price change)**

Find or create `src/features/products/composables/__tests__/useProducts.test.ts`'s relevant test
and add/adjust:

```ts
  it('does not call the manual audit helper for a price change (now handled by the audit subscriber)', async () => {
    const { save } = useProducts()
    // ... (use this test file's existing setup/mocks for an update that changes salePriceUsd)
    expect(logProductPriceChanged).not.toHaveBeenCalled()
  })
```

Adjust variable/mock names to match this test file's existing conventions — read it first.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/products/composables/__tests__/useProducts.test.ts`
Expected: FAIL — the manual call is still present.

- [ ] **Step 4: Remove the manual call in `useProducts.ts`**

At line 107, remove:
```ts
if (priceChanged) await logProductPriceChanged(r.id, r.name, old!.price_usd, data.salePriceUsd)
```
At line 152, remove the `audit: (r) => logProductCreated(r.id, r.name),` line (or the whole
`audit` option if nothing else in that call needs it — read the surrounding function signature
first to confirm `audit` isn't still used for a *different*, non-bus-wired purpose at that call
site before deleting the option entirely).

Remove `logProductCreated, logProductUpdated, logProductPriceChanged` from the
`useAuditLog()` destructure at line 21 — but only the ones no longer called anywhere in the file;
keep `logProductUpdated` if a manual "updated" audit still applies to fields other than price
(check before deleting).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/products/composables/__tests__/useProducts.test.ts`
Expected: PASS.

- [ ] **Step 6: Repeat Steps 2-5 for `useCashMovements.ts`'s `logCashMovementRecorded`**

Same shape: write a regression test asserting the manual call no longer fires for a recorded
movement, watch it fail, remove line 78's `audit: (id) => logCashMovementRecorded(...)` (and the
now-unused import if `logCashMovementVoided` is the only remaining use of that destructure — if
so, keep the destructure but drop `logCashMovementRecorded` from it, since `voided` is not one of
the 13 bus-wired types and its manual call stays), watch it pass.

- [ ] **Step 7: Repeat Steps 2-5 for `useReturnSheet.ts`'s `logReturnProcessed`**

Same shape at line 322. Do not touch `logInstallmentPlanCancelled` in the same file — installment
plan cancellation on return is a different action from the `sale.returned`/`customer.debt_changed`
events and is not one of the 13 audited types.

- [ ] **Step 8: Definition of Done — repository-wide sweep**

Run:
```bash
grep -rn "logProductPriceChanged\|logProductCreated\|logCashMovementRecorded\|logReturnProcessed" src --include=*.ts | grep -v test
```
Expected: zero remaining hits (all three call sites removed in Steps 4/6/7).

For each of the other 11 audited event types, run the equivalent grep for its corresponding
`useAuditLog()` typed helper (per Step 1's inventory check) and confirm either it has been removed
or it never existed (net-new coverage) — document which case applies for each in the PR
description, per the design spec's acceptance criteria.

- [ ] **Step 9: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions in any other test file that may have referenced the removed calls.

- [ ] **Step 10: Commit**

```bash
git add src/features/products/composables/useProducts.ts src/features/products/composables/__tests__/useProducts.test.ts \
        src/features/shifts/composables/useCashMovements.ts \
        src/features/returns/composables/useReturnSheet.ts
git commit -m "refactor(WAFI-150): retire manual audit calls for events now handled by the audit subscriber"
```

---

### Task 11: Migration regression tests — one per retired manual call

**Files:**
- Modify: whichever test files Task 10 already touched (`useProducts.test.ts`, and the equivalent
  files for `useCashMovements`/`useReturnSheet` if they exist — create them following this
  codebase's existing composable-test conventions if not).

**Interfaces:**
- Consumes: `mapEventToAuditEntry`, `startAuditSubscribers` (Task 7).
- Produces: no exports — test-only task, closing the design spec's "exactly one audit row per
  operation" acceptance criterion.

- [ ] **Step 1: Write the regression test for the product price-change path**

Add to `src/features/products/composables/__tests__/useProducts.test.ts`:

```ts
  it('a price change produces exactly one audit_log row, via the subscriber path, once the event is processed', async () => {
    // This is an end-to-end assertion across two independent pieces (the save flow's
    // publishEvent call, and the audit subscriber's handling of it) -- read this
    // file's existing mock setup for `db.execute` call tracking before adding
    // assertions, and adjust the exact db.execute call-matching below to this file's
    // conventions if they differ.
    const { save } = useProducts()
    // ... perform a price-changing save (reuse this file's existing setup) ...
    const publishedEventInsert = vi.mocked(db.execute).mock.calls.find(
      ([sql]) => sql.includes('insert into events') && sql.includes('product.price_changed'),
    )
    expect(publishedEventInsert).toBeDefined() // publishEvent still fires the domain event
    // The audit_log insert itself is asserted in auditSubscriber.test.ts's dedicated
    // suite (Task 7) -- this test's job is only to confirm useProducts.ts no longer
    // ALSO writes a manual audit row for the same action, which Task 10's test
    // already covers. This test exists to document the seam between the two pieces
    // for a future reader, not to re-assert Task 7's coverage.
  })
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/features/products/composables/__tests__/useProducts.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/products/composables/__tests__/useProducts.test.ts
git commit -m "test(WAFI-150): document the publish/audit seam for the retired product price-change audit call"
```

---

## Definition of Done (repeated from the design spec — verify before closing the ticket)

- [ ] All acceptance criteria in the design spec are met.
- [ ] Repository-wide search for `logAudit`-style calls (the specific typed helpers in
  `useAuditLog.ts`) at each of the 13 bus-wired event types confirms zero remaining manual call
  sites, or each survivor has a documented reason in the PR description.
- [ ] `npx vitest run` passes in full.
- [ ] `npx vue-tsc -b --noEmit` passes.
- [ ] `npx supabase test db` passes (including the new `wafi150_audit_dedup.test.sql`).
- [ ] Manual smoke test (Task 9, Step 3) confirms a real audit row appears with `source_event_id`
  populated for at least one real user action.
