# WAFI-150 — Durable Event Consumption & Event-Driven Audit Logging — Design Spec

## Problem statement

Today, `audit_log` coverage is manual: every feature that needs an audit
trail calls a `logAudit(...)`-style helper inline at its own write site
(auth, pin changes, shifts, discounts, expenses, products, customers,
returns, staff ledger, supplier receiving, installment plans, recovery
codes, etc.). Coverage depends entirely on a developer remembering to add
the call. WAFI-140 (Sprints 1–2) already publishes ~13 domain events onto
an event bus, but **nothing subscribes to it today** — `useEventSubscription(`
has zero application call sites outside tests. WAFI-150 closes this gap by
making audit logging a subscriber of the event bus rather than a scattered
manual responsibility.

## Architecture

WAFI-140 introduced durable event *publication* but intentionally stopped
at the producer boundary. Consumers today are either:

- **best-effort** (`useEventSubscription` — if the handler throws, the
  subscription dies silently, no retry, no resume), or
- **at-most-once** (`processProjectionAtMostOnce` — marks an event
  processed *before* running the action; explicitly documented as
  unsuitable for financial/durable writes).

Neither is acceptable for audit, where a silently-dropped entry can matter
months later during an investigation. WAFI-150 therefore has two
first-class deliverables, not one:

1. **A durable-subscriber primitive** for WAFI-140 — the missing
   consumer-side half of the reliability story the producer side already
   has (idempotent publish, retry queue, rate limiting, backoff+jitter).
2. **The audit subscriber** — the first consumer built on that primitive,
   replacing the manual `logAudit()` calls for every event type already
   wired to the bus.

This is *not* a prerequisite-ticket split. The framework gap was
discovered because audit exposed it, and audit is the reason the primitive
needs to exist; building the primitive with no real consumer would risk an
API that doesn't fit the one thing that actually needs it.

```
Producer (existing, WAFI-140 Sprint 1-2):
Business operation → publishEvent() → local_event_publish_retries → events table

Consumer (new, WAFI-150):
events table → runDurableSubscriber() → local_event_processing_retries → projection
                                                                             │
                                                                             ▼
                                                                   AuditSubscriber → audit_log
```

### Two consumption models, going forward

- **Lightweight subscriber** (`useEventSubscription` + optionally
  `processProjectionAtMostOnce`) — for projections where losing an event
  is acceptable: dashboard counters, temporary analytics, cache warming.
  Unchanged by this ticket.
- **Durable subscriber** (`runDurableSubscriber`, new) — for consumers
  where event loss is unacceptable: audit log, and future candidates
  (a regulatory ledger, a notification outbox).

`runDurableSubscriber` intentionally does not replace
`processProjectionAtMostOnce`. Dashboard/analytics projections keep using
the lightweight primitive; durable business consumers use the new one.
Migrating existing lightweight subscribers to durable is explicitly out of
scope — nothing forces that migration today.

## The durable-subscriber primitive

### API

```ts
function runDurableSubscriber<T>(opts: {
  subscriberName: string
  eventType: DomainEventType
  shopId: string
  handler: (event: DomainEvent<T>) => Promise<void>
}): { stop: () => void }
```

Object-argument form (not positional) so a future caller adding, say, a
`concurrency` or `sinceIso` option doesn't have to thread positional
placeholders through every existing call site.

### Subscriber identity is permanent

`subscriber_name` is a durable key, not a display label: it is half of the
ledger's dedup key (`(event_id, subscriber_name)` in
`local_subscriber_processed_events`) and appears in
`local_event_processing_retries` rows. Renaming a subscriber (e.g.
`audit` → `audit_v2`) has two possible effects, and the choice must be
made deliberately, not accidentally:

- **Keep the name unchanged** across a subscriber's internal refactors —
  its processed/retry history stays continuous.
- **Change the name** only when the intent is "treat this as a new
  subscriber that should reprocess history" (a full replay) — this is a
  deliberate operational action, not a side effect of a rename during
  cleanup.

This ticket does not need replay and does not build tooling for it — the
audit subscriber's `subscriber_name` (`'audit'`) should be treated as
effectively permanent once shipped. Documented here so a future
subscriber rename doesn't silently trigger an unintended full replay or
an unintended loss of retry continuity.

### Guarantees

- Sequential execution per subscriber (no concurrent handler invocations
  for the same `subscriberName`/`eventType` pair).
- Retry with backoff+jitter on transient handler failure.
- The event is marked processed **only after** `handler()` succeeds —
  never before.
- Permanent failures are surfaced (persisted, not silently dropped) —
  never auto-retried, never block later events.
- The live subscription never dies because a handler threw. A handler
  exception is caught at the invocation boundary; the underlying
  `useEventSubscription` watch loop keeps running for the next event.

### Invariants

1. A handler is never marked processed before it succeeds.
2. A handler may execute more than once (at-least-once delivery upstream,
   plus retry) — **handlers must be idempotent.**
3. Subscriber failures never terminate the live subscription.
4. Retry execution is sequential, not concurrent.
5. Permanent failures never block unrelated events — each event is
   processed independently.

### Ordering guarantee (explicitly weak)

Durable subscribers guarantee eventual processing, not global ordering. If
event A fails and event B (later, same type) succeeds, then A is retried
successfully afterward, the resulting audit log contains B before A.
**Subscribers must not rely on processing order for correctness.** This
mirrors the ordering philosophy `useEventSubscription` already documents
for the lightweight path.

### State machine

```
useEventSubscription delivers event
        │
        ▼
already in local_subscriber_processed_events for (event_id, subscriber_name)?
        │                                   │
       yes                                  no
        │                                   ▼
   skip (already done)              run handler(event)
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                            ▼
                          success                      throws
                              │                            │
                              ▼                            ▼
                 insert into                     isTransientEventFailure(err)?
                 local_subscriber_processed_events   │           │
                 (event marked processed)           yes          no
                                                       │           │
                                                       ▼           ▼
                                         insert into           insert into
                                         processing_retries    processing_retries
                                         (failure_kind:         (failure_kind:
                                          'transient',           'permanent' —
                                          next_retry_at           surfaced for
                                          w/ backoff+jitter)      operator review,
                                                                  never auto-retried,
                                                                  never blocks later
                                                                  events)
```

Retry execution: a sweeper (`startEventProcessingRetrySweeper`, same
reconnect-listener + app-start pattern as `startRetryQueueSweeper` —
`eventPublishRetryQueue.ts:128-136` — and the cleanup sweeper) runs once
on start and again on every reconnect transition; each run queries
`local_event_processing_retries` for `next_retry_at <= now()` and
re-invokes the same handler closure. **This is not a polling/interval
timer** — there is no `setInterval` anywhere in this pattern, matching
the existing sweepers exactly, which is deliberate on a battery/CPU-
constrained target device. A retried event goes through the identical
success/failure branching as a live delivery.

### New local tables

- **`local_event_processing_retries`** — mirrors
  `local_event_publish_retries`'s shape (id, serialized event,
  failure_kind, attempts, error message, next_retry_at with backoff+jitter,
  created_at), plus a `subscriber_name` column, so multiple durable
  subscribers can share one retry table rather than one table each.
- **`local_subscriber_processed_events`** — a *separate* table from the
  existing best-effort ledger (`local_event_processed_ledger`), not a
  shared table with a mode flag. They encode different lifecycle
  contracts (mark-then-run vs. run-then-mark-on-success); a shared table
  would force every future reader to branch on a mode column throughout
  the framework. Columns: `event_id`, `subscriber_name`, `processed_at`.
  Named for what it belongs to (the durable subscriber framework), not
  for the abstract property ("durable") — the framework is durable; the
  table records which events its subscribers have successfully processed.

### Shared failure classification

`isTransientPublishFailure` → renamed and relocated to
`src/services/events/isTransientEventFailure.ts`, used by both
`publishEvent.ts` and `runDurableSubscriber.ts`. Same pattern set (`busy`,
`locked`, `i/o error`, `timeout`, `disk.*unavailable`,
`rate_limit_exceeded`) — none of these are publish-specific; a database
lock or timeout means the same thing regardless of direction.

## The audit subscriber

### Mapping contract

```ts
function mapEventToAuditEntry(event: DomainEvent): AuditLogInsert | null
```

Returning `null` means "this event intentionally produces no audit
entry" — explicit, not an omission. Not every event on the bus deserves an
audit row (a future `heartbeat.received` or `cache.invalidated` should be
able to return `null` without anyone wondering if that's a bug).

**A `null` mapping still counts as handler success.** The durable
subscriber's ledger write happens after the handler returns normally,
regardless of whether it produced a row — `mapEventToAuditEntry` returning
`null` must still result in a `local_subscriber_processed_events` insert.
Skipping that insert would mean the event is redelivered and skipped
forever on every subsequent delivery, never actually settling.

**Domain events must never contain secrets or highly sensitive
credentials.** This is an event-bus-level invariant (belongs to WAFI-140,
not something audit invents), but WAFI-150 is the first place it has
real teeth: `meta` copies the payload verbatim into an append-only,
permanent table. A payload publisher is responsible for never including
raw PINs, unmasked full account numbers, or similar secrets — the audit
subscriber has no ability to redact after the fact, and is not the place
to add filtering logic (that would violate the "no transform" invariant
above). If this constraint isn't already documented for `publishEvent()`,
add it there as part of this ticket's implementation, since audit is what
surfaces the risk.

**Payload schema evolution**: `meta` will contain whatever shape a given
event type's payload had at the time it was published — old and new
shapes coexisting is expected, not a bug, per the existing platform-wide
policy (`WAFI_Production_Readiness_Plan_v3.md`: "Event Versioning Policy —
never modify payload, create v2, support both, deprecate after
migration," documented under WAFI-142). The audit subscriber does nothing
special to normalize this; any future reporting/compliance query over
`audit_log.meta` must already be written to tolerate multiple historical
payload versions, same as any other consumer of event payloads.

**The audit subscriber copies the published payload verbatim into
`meta`; it does not transform, enrich, or revalidate it.** This is an
invariant, not an implementation detail:

```
business operation → publishEvent() → payload frozen → audit subscriber → meta == payload
```

**The audit subscriber must not reconstruct business state from database
reads.** All audit information comes from the event itself. Reading
current state (e.g. `SELECT * FROM products` to enrich the entry) would
reintroduce a race between the read and the state at the time the event
was published, and is explicitly prohibited.

### Idempotency and the `audit_log` schema change

New migration (number TBD — confirm the next unused one via
`ls supabase/migrations` at implementation time; do not hardcode against
Sprint 3's 076/077, which may have already shipped and moved the
counter):

```sql
ALTER TABLE public.audit_log ADD COLUMN source_event_id uuid;
-- source_event_id references the originating row in events.id and exists
-- solely for idempotency and traceability. Every audit entry generated
-- from the event bus stores the originating event's ID. Legacy/manual
-- audit rows leave this column NULL.
CREATE UNIQUE INDEX audit_log_source_event_id_unique
  ON public.audit_log (source_event_id) WHERE source_event_id IS NOT NULL;
```

Nullable + partial index: pre-WAFI-150 rows and the still-manual
security/technical rows (see Scope, below) have no source event and are
unaffected by this constraint.

**Why check-then-insert locally, not `INSERT ... ON CONFLICT DO
NOTHING`:** PowerSync client tables are SQLite views backed by CRUD-queue
triggers; SQLite rejects `ON CONFLICT` against a view (the codebase
already documented this exact limitation in
`dailyEventCountsProjection.ts` — the unique constraint has no local
conflict target). A local check-then-insert is safe here specifically
*because* this is a single-threaded JS client with no concurrent
execution of the same subscriber's retry logic — the "two retries race
each other" scenario a multi-server backend would need to guard against
doesn't apply on this stack. The real risk window is *sequential*: a
crash between "audit insert committed locally" and "durable ledger row
written," followed by a retry. Check-then-insert closes that window
because there's nothing concurrent to defeat it.

```
handler(event):
  exists = SELECT 1 FROM audit_log WHERE source_event_id = event.id
  if exists: return  // already recorded — idempotent no-op, counts as success
  INSERT INTO audit_log (..., source_event_id) VALUES (..., event.id)
```

**Authoritative, database-enforced dedup lives at sync-upload time, not
locally** — extend `ops.ts`'s existing `audit_log` special case (which
already does `.upsert({ id, ...opData }, { ignoreDuplicates: true })` to
handle re-synced rows) with a second upsert path keyed on
`source_event_id` when present:

```ts
if (table === 'audit_log') {
  if (type !== UpdateType.PUT) return null
  return (await supabase.from(table)
    .upsert({ id, ...opData }, { onConflict: 'source_event_id', ignoreDuplicates: true }))
    .error
}
```

This is the real backstop: even if the local check-then-insert somehow
missed a duplicate (e.g. two independent local rows created before either
synced), the server-side partial unique index is the canonical source of
truth, and `ignoreDuplicates` absorbs the second row the same way it
already absorbs re-sent rows on `id` today.

Two mechanisms, two different failure modes — worth stating explicitly so
a reviewer doesn't wonder why both exist:
- `local_subscriber_processed_events` prevents *reprocessing* the same
  event under normal retry.
- `audit_log.source_event_id`'s unique index prevents a *duplicate audit
  row* specifically during the crash-recovery window between a committed
  insert and an unwritten ledger entry.

### Scope

WAFI-150 covers only the ~13 event types already wired to the bus
(WAFI-140 Sprints 1–2). It does **not** wire new domain events for
actions that currently only have a manual audit call — that is deferred
to a future ticket. Security/technical events (failed PIN, login
attempts, JWT refresh, permission denied, session timeout) are not domain
events and are explicitly out of scope; they keep their direct
`logAudit()` calls unless/until a future ticket promotes them to the bus.

### Manual-call retirement

The table below reflects the codebase as read during design (2026-08-05)
and **must be revalidated during implementation via a repository-wide
search** — treat it as illustrative, not a frozen inventory. By
implementation time additional manual calls may exist, or some listed
call sites may have changed.

**Implementation checklist** (normative — applies regardless of whether
the table below is still accurate):

For every event type handled by the audit subscriber:
1. Locate existing manual `logAudit(...)` call(s) for that operation.
2. Remove them once the subscriber produces an equivalent audit entry —
   this is "replace with subscriber-generated audit," not merely deleting
   code: ownership of audit-writing moves from the feature to the
   subscriber.
3. Verify exactly one audit row is produced per operation.

| Event | Manual call site (as of 2026-08-05) | Action |
|---|---|---|
| `product.cost_updated` | product save flow | Replace with subscriber-generated audit |
| `product.price_changed` | product save flow | Replace with subscriber-generated audit |
| `product.created` | product save flow | Replace with subscriber-generated audit |
| `device.registered` | registerDevice() | Replace with subscriber-generated audit |
| `stock.taken` | confirmSession() | Replace with subscriber-generated audit |
| `cash.movement_recorded` | useCashMovements.record() | Replace with subscriber-generated audit |
| `sale.returned` / `customer.debt_changed` | returns flow | Replace with subscriber-generated audit |
| `sale.completed`, `installment.due_paid`, `stock.received`, `inventory.adjusted` | verify at implementation time — if no manual call exists today, this is net-new coverage, not a removal | Replace if present, else add new coverage |

### Acceptance criteria

1. For every event type handled by the audit subscriber, exactly one
   audit row is produced per business operation.
2. No operation produces both a manual and subscriber-generated audit
   entry.
3. Events for which `mapEventToAuditEntry` returns `null` produce zero
   rows, by design.
4. `executeFinancialWrite` (or any other shared write+audit helper used by
   non-bus call sites) still audits every action it covered before this
   ticket. The PR must include a code-read confirmation that the helper
   was refactored to conditionally skip its own audit write only for the
   13 bus-wired event types, without changing behavior for security/
   technical or otherwise-not-bus-wired call sites.
5. A repository-wide search for `logAudit`-style calls matching the 13
   bus-wired event types turns up zero remaining call sites, or each
   remaining hit has an explicit documented reason for staying manual.

## Testing

- **Unit (Vitest, mocked `db`, following `publishEvent.test.ts` /
  `useEventSubscription.test.ts` conventions):**
  - `runDurableSubscriber.test.ts` — success writes ledger; transient
    failure enqueues retry with backoff/jitter and does not write ledger;
    permanent failure is queued and does not block a subsequent unrelated
    event; sweeper re-invokes handler on reconnect; retried handler
    invocation sees an already-inserted row and treats it as success
    (idempotent no-op), not a duplicate.
  - `isTransientEventFailure.test.ts` — relocated from
    `isTransientPublishFailure.test.ts`, same assertions, plus confirms
    it's imported by both `publishEvent.ts` and `runDurableSubscriber.ts`.
  - `auditSubscriber.test.ts` — `mapEventToAuditEntry` returns the correct
    shape per event type, returns `null` for intentionally-excluded
    types, and asserts `meta` is the verbatim payload (no transform). Also
    asserts that when the mapping returns `null`, the durable subscriber
    still writes a `local_subscriber_processed_events` row (no infinite
    redelivery of intentionally-skipped events).
- **Crash-recovery integration test** (the core reason this design
  exists — must be explicit, not implied): simulate handler success →
  audit row committed → process "crashes" before the ledger write →
  restart/retry → handler observes the existing row via check-then-insert
  → treats it as success → ledger row is written → done. Assert exactly
  one `audit_log` row exists at the end.
- **pgTAP**: assert the `audit_log_source_event_id_unique` partial index
  exists, and that a duplicate-`source_event_id` upsert via
  `ignoreDuplicates` at the `ops.ts` layer is silently absorbed (mirrors
  the existing `id`-based dedup behavior, now applied to the new conflict
  target).
- **Migration regression tests** — one per retired manual call: execute
  the business operation, assert exactly one `audit_log` row,
  `source_event_id` populated, and that the row was produced via the
  subscriber path (not the old manual call, which should no longer
  exist in that code path). This catches the three likely migration
  mistakes: forgot to remove the manual call (→ two rows), forgot to wire
  the subscriber (→ zero rows), subscriber forgot `source_event_id` (→
  dedup broken).

## Definition of Done

- All acceptance criteria above are met.
- Repository-wide search for `logAudit`-style calls at each of the 13
  bus-wired event types confirms zero remaining manual call sites, or
  each survivor has a documented reason (e.g. it's actually a
  security/technical event, not the business event it superficially
  resembles).
- Code-read confirmation attached to the PR that `executeFinancialWrite`
  (and any other shared write+audit helper touched) still audits every
  action it covered before this ticket for non-bus-wired call sites.

## Non-goals (explicitly deferred, do not build now)

- Configurable per-subscriber concurrency.
- Subscriber priorities.
- A dead-letter / permanent-failure operator UI (permanent failures are
  recorded and queryable, not surfaced in any UI yet).
- Metrics dashboards for subscriber health.
- A dependency graph across subscribers.
- Migrating existing lightweight subscribers (e.g.
  `startDailyEventCountsProjection`) to the durable primitive — nothing
  requires that today.
- Wiring new domain events for actions that don't yet publish to the bus
  (deferred; see Scope).
- Promoting security/technical audit events to the domain event model.

## Cross-Epic Edge-Case Checklist (design time)
Domains touched: Events (existing row — adds `runDurableSubscriber`,
`local_event_processing_retries`, `local_subscriber_processed_events`,
`isTransientEventFailure`), Audit (existing row — adds `source_event_id`
column, becomes an event consumer instead of purely a write-side
concern for every other domain).
Matrix rows consulted: `Audit` (writes `audit_log`, consumed by all
other domains today via manual calls), `Events` (writes `events`,
`daily_event_counts`, local-only tables; no consumer yet per the matrix's
own note "none yet — WAFI-143/144/145/146"). This ticket is the first
row update to Events' "Reports/Dashboards affected" column — Audit
becomes its first real consumer.
Open cross-feature questions:
- Do any of the 13 wired events' payloads omit information the current
  manual audit call includes (e.g. a manual call logging a field not in
  the published payload)? Must be checked per retired call site during
  implementation — if so, either the payload needs a version bump to add
  the field, or that specific audit call stays manual with a documented
  reason.
- `executeFinancialWrite`'s wrapper (WAFI-152/WAFI-138) is the shared
  write+audit helper several manual call sites use — does removing its
  audit-writing responsibility for bus-wired events change its contract
  for callers that pass audit metadata it no longer needs? Needs a code
  read at implementation time, not assumed here.
