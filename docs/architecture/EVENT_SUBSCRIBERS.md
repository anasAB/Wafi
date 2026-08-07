# Event Subscribers — Convention Guide

This doc exists so the next event-bus consumer (WAFI-144/145/146 and beyond) copies an
established pattern instead of re-deriving one. Written as part of WAFI-143, the first
ticket to ship two subscribers side by side with genuinely different failure profiles.

## Two subscriber categories

### Lightweight (`useEventSubscription` + `processProjectionAtMostOnce`)

**Use when:** the consumer is a read model — dashboard metrics, analytics, temporary
projections. Losing an event is acceptable because the projection can be silently
rebuilt from source data with nobody worse off.

**Characteristics:** no guaranteed delivery; no persistent retry queue; the only
protection against double-counting on redelivery is the at-most-once processed ledger
(`processProjectionAtMostOnce`), which is single-device and does not survive a fresh
resync from scratch.

**Examples:** `dailyEventCountsProjection.ts` (WAFI-140), `dashboardRevenueProjection.ts`
(WAFI-143).

### Durable (`runDurableSubscriber`)

**Use when:** a user action requires follow-up, the record is compliance/audit-relevant,
or an operational workflow genuinely depends on delivery. Losing this delivery would
matter to the business.

**Characteristics:** persistent retry queue (`local_event_processing_retries`) with
backoff+jitter; a handler is retried until it succeeds or is marked permanently failed
(surfaced for operator review, never silently dropped); idempotency is a hard
requirement (see below), not optional.

**Examples:** `auditSubscriber.ts` (WAFI-150), `notificationSubscriber.ts` (WAFI-143).

## The decision rule

Ask: **"can this be silently rebuilt from source data with nobody worse off?"** If yes,
lightweight. If losing this delivery would actually matter to the business, durable.

## Idempotency requirement (durable subscribers only)

A durable handler MUST be safe to invoke more than once for the same event —
`runDurableSubscriber`'s at-least-once delivery plus its own retry mechanism both mean a
handler can run twice for the same underlying event. The standard mechanism: the target
table gets a `source_event_id` column plus a unique index, checked with a
check-then-insert in the handler and enforced again at sync-upload time in
`src/data/powersync/ops.ts`'s `runOp` (see `audit_log`'s and `notifications`' special
cases there for the exact pattern). Make the index **partial**
(`WHERE source_event_id IS NOT NULL`) if the table also has legacy/manual rows with no
originating event (`audit_log`'s case); make it unqualified if every row always
originates from an event (`notifications`' case). This is not a per-subscriber
reinvention — copy the existing pattern, don't design a new one.

## Wiring convention

Every subscriber is a `start*(shopId: string): { stop: () => void }` function, called
exactly once inside `src/App.vue`'s `onMounted` block, alongside the existing sweepers
(`startRetryQueueSweeper`, `startDailyEventCountsProjection`,
`startEventTableCleanupSweeper`, `startAuditSubscribers`, `startDashboardRevenueProjection`,
`startNotificationSubscribers`). A subscriber that exists but is never called here is a
dormant consumer — this exact bug already happened twice (WAFI-140 Sprint 1's
`dailyEventCountsProjection` and, per its own design spec, nearly happened again) — check
this explicitly, don't assume wiring "obviously" happened because the file exists.

## File location convention

Flat under `src/services/events/`, one file per subscriber, named for what it does (e.g.
`notificationSubscriber.ts`), not which ticket added it (never
`wafi143Subscriber.ts`). No `publishers/`/`subscribers/`/`projections/` subdirectory
split — this repo's event-bus code has always been flat, and restructuring existing
files is out of scope for any single subscriber-adding ticket.

## Minimum test bar

Every subscriber needs:
1. A pure mapping-function test (`mapEventToX(event): X | null`) covering at least one
   "produces an entry" case, one "returns null, event doesn't qualify" case, and one
   "returns null, unrelated event type" case (protects the mapping boundary against a
   future refactor accidentally widening what the subscriber reacts to).
2. A delivery test — feed a synthetic event row through the subscriber's `start*()`
   handler and assert the expected DB write happened.

Durable subscribers additionally require:
3. A redelivery/dedup test — deliver the same event twice, assert exactly one write
   happened, not two.
