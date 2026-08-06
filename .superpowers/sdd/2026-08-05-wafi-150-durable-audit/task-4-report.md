# Task 4 Report: runDurableSubscriber primitive

## What was done

Created `src/services/events/runDurableSubscriber.ts` exporting:
- `DurableEvent<T>` interface (extends `DomainEvent<T>` with `eventId: string`, the originating `events.id` row).
- `runDurableSubscriber<T>(opts)` — wraps `useEventSubscription` with a durable-delivery layer:
  1. Checks `local_subscriber_processed_events` for `(subscriber_name, event_id)` — skips (no handler call) if already processed.
  2. Builds a `DurableEvent<T>` from the raw `EventRow` (mapping snake_case DB columns to the camelCase `DomainEvent` shape, plus `eventId: row.id`).
  3. Calls `opts.handler(event)`. On success, writes a `local_subscriber_processed_events` row (ledger write happens ONLY after the handler resolves).
  4. On failure, calls `enqueueForProcessingRetry(subscriberName, event, errorMessage)` (Task 3's function, which itself classifies transient vs. permanent and writes `local_event_processing_retries`) and swallows any error from that call — the handler's error is never rethrown, so `useEventSubscription`'s watch loop is never killed.

Created `src/services/events/__tests__/runDurableSubscriber.test.ts` with the 5 tests specified in the brief (dedup skip, eventId pass-through, success writes ledger only, transient failure enqueues retry without ledger write, permanent failure enqueues without throwing back into the caller).

Implementation and test files were written verbatim per the task brief, since the brief specifies exact code. No deviations were needed — Task 3's `enqueueForProcessingRetry` signature, `useEventSubscription`'s `EventRow` shape, and `logger.ts` all matched what the brief assumed.

## Invariant verification

The core invariant (handler errors never propagate into `useEventSubscription`'s watch loop, and the ledger write happens only after handler success) is enforced by the `try { await handler(...); await ledgerInsert() } catch { await enqueueForProcessingRetry(...).catch(() => {}) }` structure — no `throw` in the catch branch, and the ledger insert is unreachable from the catch path.

## Test output

```
npx vitest run src/services/events/__tests__/runDurableSubscriber.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Type-check

```
npx vue-tsc -b --noEmit
```
No output — clean pass.

## Commit

`9614622` — `feat(WAFI-150): add runDurableSubscriber primitive`
(2 files changed: `src/services/events/runDurableSubscriber.ts`, `src/services/events/__tests__/runDurableSubscriber.test.ts`)

## Fix round (review follow-up)

Two issues raised by review of runDurableSubscriber.ts:

1. **Critical:** `db.getOptional` dedup lookup ran outside the try/catch. A rejection
   (e.g. transient "database is locked") would propagate out of the async function
   passed to `useEventSubscription`, permanently killing that subscription's watch
   loop -- defeating the primitive's purpose. Fixed by moving the dedup lookup inside
   the same try block as `opts.handler(event)`, so any failure anywhere in the function
   body is caught and routed to the retry queue, never propagated.

2. **Important:** If `opts.handler(event)` succeeded but the subsequent ledger insert
   threw, the catch block logged "handler failed" -- misleading, since the handler had
   already succeeded. Fixed by tracking a `handlerSucceeded` boolean set immediately
   after `await opts.handler(event)` returns; the catch block now logs "handler
   succeeded but ledger write failed, event will be redelivered" when that flag is set,
   vs. "handler failed, queuing for retry" otherwise.

### New test

Added `does not propagate when the dedup lookup itself rejects, and routes to the retry
queue` in `src/services/events/__tests__/runDurableSubscriber.test.ts`: mocks
`db.getOptional` to reject, asserts the captured handler resolves (not throws), that
`opts.handler` was never called, and that a retry-queue row was written.

### Test output

```
 RUN  v4.1.7
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Type-check

`npx vue-tsc -b --noEmit` -- clean, no output.

### Commit

