# WAFI-154: Deferred Execution Tier — Design Spec

**Status:** Draft, pending user review
**Ticket:** WAFI-154 (Background Job & Worker Framework), Macro-Phase 3
**Depends on:** WAFI-140 (Event Bus, shipped), WAFI-150 (Durable Subscribers, shipped — this
spec generalizes its retry primitive rather than duplicating it), WAFI-151 (Rebuild/Recovery,
shipped — its lease/lock conventions are the model for this spec's `running` lease)

## Problem

The event system has two execution modes today:

| Mode | Execution | Example |
|---|---|---|
| Immediate | Inline, blocks the publishing transaction | Inventory decrement |
| Durable (WAFI-150) | Inline, retried on failure via `runDurableSubscriber` | Audit log write |

Both run the handler **inline**, synchronously, the moment the event fires — durable adds
retry-on-failure, but never removes the handler from the critical path. There is no mode for
work that should never block the triggering action in the first place (PDF generation, batch
report assembly, daily digest composition) — work that is slow, not urgent, and doesn't need to
finish before the user moves on.

**Scoping note, confirmed with the product owner:** no such slow feature exists in the codebase
today (grepped for PDF generation — none found). This ticket is deliberately
infrastructure-ahead-of-need: build the execution tier and prove it end-to-end with a synthetic
test job type, so the first real slow feature (most likely PDF receipts) has a working pattern
to plug into rather than inventing its own ad-hoc async handling.

## Non-Goals

- **No continuous background execution while the app is backgrounded.** This is a PWA on
  cheap Android phones — there is no reliable OS-level background process to schedule against.
  The guarantee is "processed at the next eligible foreground or reconnect opportunity," not
  "runs the instant it's queued." Stating this explicitly matters: a later engineer must not
  build a feature that assumes the queue drains itself while the phone is asleep.
- **No migration of any existing feature onto this tier in this ticket.** The daily WhatsApp
  digest, notification sends, etc. stay exactly as they are. The first real production consumer
  is a separate, later ticket.
- **No polling timer.** Matches the existing retry-sweeper convention
  (`eventProcessingRetryQueue.ts`'s `startProcessingRetrySweeper`) — deliberate, for battery/CPU
  on the target device class.
- **No general-purpose "trigger a job from a button click" API.** Every deferred job is enqueued
  as a side effect of a domain event, mirroring how `runDurableSubscriber` is only ever invoked
  from an event handler today. The internal queue/worker implementation is not *architecturally*
  prevented from being reused by a future non-event-triggered producer, but no such producer API
  is built or exposed here.
- **No complex fairness/scheduling.** Priority-ordered, FIFO-within-priority is the entire
  scheduling model. No weighted round-robin, no starvation prevention beyond "critical always
  goes first."

## Architecture

```
Event Bus
   │
   ├── Immediate subscriber   → inline, blocks          (existing)
   ├── Durable subscriber     → inline + retry           (existing, WAFI-150)
   └── Deferred subscriber    → persist + return          (NEW, WAFI-154)
                                     │
                            local_deferred_jobs (same SQLite db as every other local table)
                                     │
                              Worker (opportunistic drain)
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
                completed         retryable        dead / evicted
             (bounded retention)  → back to queued  (bounded retention)
```

`defineDeferredSubscriber()` has the same call shape as `runDurableSubscriber()` (same
`subscriberName`/`eventType`/`shopId` parameters), but instead of invoking a handler, it writes
one row to `local_deferred_jobs` and returns. The row itself is what "the event was durably
deferred" means — see Durability Invariant below.

A **separate** `registerJobHandler(jobType, handler)` registry maps a `job_type` string to the
function the worker calls when it dequeues a row of that type — this indirection exists because
the worker (started once at app init, per shop) needs to resolve a handler for a job type without
knowing which deferred subscriber originally enqueued it, exactly mirroring how
`retryPendingEventProcessing`'s `handlers: Map<string, ...>` parameter already works today.

### Same SQLite database, no new storage layer

`local_deferred_jobs` lives in the same PowerSync-backed SQLite database as every other local
table (`local_event_processing_retries`, `local_subscriber_processed_events`, etc.), accessed
through the same `db` from `@/data/powersync/db`. No IndexedDB, no separate queue store — this
matches every existing local-only table's convention (`{ localOnly: true }` in
`src/data/powersync/schema.ts`) and means job persistence gets the same crash-durability
guarantees (SQLite WAL) the rest of the app already relies on, for free.

## Schema

```ts
// src/data/powersync/schema.ts — WAFI-154

const local_deferred_jobs = new Table({
  job_type:          column.text,     // e.g. 'test.sleep' (v1's only real registrant)
  shop_id:           column.text,
  payload:           column.text,     // JSON.stringify'd, same convention as events.payload
  priority:          column.text,     // 'critical' | 'normal' | 'low'
  requires_network:  column.integer,  // 0 | 1 (SQLite has no boolean)
  dedupe_key:        column.text,     // nullable — see Dedup section
  status:            column.text,     // 'queued' | 'running' | 'completed' | 'dead' | 'evicted'
  attempts:          column.integer,
  last_error:        column.text,     // nullable
  next_retry_at:     column.text,     // ISO string, nullable (only meaningful while queued+retrying)
  worker_id:         column.text,     // nullable — set on running, cleared on return-to-queued
  started_at:        column.text,     // ISO string, nullable — lease start, for stale-lease detection
  lease_expires_at:  column.text,     // ISO string, nullable — started_at + fixed lease duration
  enqueued_at:       column.text,     // ISO string
  finished_at:       column.text,     // ISO string, nullable — set on completed/dead/evicted, drives retention purge
}, { localOnly: true })
```

Two SQLite indexes/constraints, created via a `db.execute` migration step at app-init (matching
how other local-only tables initialize — this repo's local tables aren't part of the Postgres
migration numbering, since PowerSync's schema is client-defined):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS local_deferred_jobs_dedupe
  ON local_deferred_jobs (job_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS local_deferred_jobs_selection
  ON local_deferred_jobs (shop_id, status, priority, enqueued_at);
```

The partial unique index is the atomicity guarantee for dedup (see below) — enforced by SQLite
itself, not by a `SELECT`-then-`INSERT` race.

## State Machine

```
queued ──(worker claims)──> running ──(handler succeeds)──> completed
  ▲                            │
  │                            ├──(handler throws, attempts < MAX)──> queued (next_retry_at set)
  │                            │
  │                            └──(handler throws, attempts >= MAX)──> dead
  │
  └──(lease expired, reclaimed on next drain)──< running   [crash recovery]

queued ──(capacity eviction, job is evictable)──> evicted
```

- **`running` is a lease, not a terminal fact.** `worker_id` + `started_at` + `lease_expires_at`
  (fixed lease duration, e.g. 5 minutes — generous relative to any realistic handler, since a
  stuck handler should time out via its own logic, not the lease) are set when a worker claims a
  row. On every drain pass, before claiming new work, the worker first reclaims any `running` row
  whose `lease_expires_at` has passed: `status = 'queued', worker_id = NULL, started_at = NULL,
  lease_expires_at = NULL`. This is the direct fix for the "app crashes mid-handler, job stuck in
  `running` forever" failure mode — same shape as WAFI-151's advisory-lock-scoped recovery, applied
  here as a row-level lease instead of a Postgres advisory lock (this queue is purely
  client-local, so there's no cross-device contention to guard against — only cross-restart).
- **`dead` is a distinct terminal state from a retryable `queued`.** A row with
  `attempts >= MAX_ATTEMPTS` moves to `dead` and is never re-selected by the worker's claim query
  (which only ever selects `status = 'queued'`) — this is the direct fix for "exhausted retries
  silently becoming eligible again on the next foreground/reconnect," which a same-status
  `failed`-with-a-flag design would risk if any query forgot to check the flag.
  `isTransientEventFailure` classification still governs backoff scheduling exactly as it does
  today: a transient failure gets `next_retry_at` (shared `[1, 5, 30, 120]`-minute schedule,
  reusing the existing constant rather than a fourth copy of it); a classified-permanent failure
  moves straight to `dead` on its first failure without spending retry attempts on a certain
  outcome (mirrors `isTransientEventFailure`'s existing role in
  `eventProcessingRetryQueue.ts`).
- **`completed`/`evicted` are retained, then purged** — see Retention below, not kept forever.

## Priority & Ordering

Worker selection query, per drain pass:

```sql
SELECT * FROM local_deferred_jobs
WHERE shop_id = ?
  AND status = 'queued'
  AND (next_retry_at IS NULL OR next_retry_at <= ?)
  AND (requires_network = 0 OR ? = 1)  -- ?1 = "are we currently connected"
ORDER BY
  CASE priority WHEN 'critical' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC,
  enqueued_at ASC
LIMIT ?  -- batch size, see Concurrency below
```

**Rule:** higher-priority eligible jobs always run before lower-priority ones; FIFO within the
same `(job_type, priority)` is the tiebreak, not global FIFO. A `low` job enqueued five minutes
before a `critical` job never blocks it — priority governs both what runs first and what gets
evicted first, one consistent ordering concept rather than two.

## Concurrency

Jobs are drained and executed **sequentially, one at a time**, on the client — matching every
existing retry-queue loop in this codebase (`retryPendingEventProcessing`'s `for` loop). No
worker pool, no `Promise.all` over multiple jobs. This is a deliberate simplicity choice for v1:
cheap Android devices are the target, SQLite writes from concurrent handlers would need their own
locking story, and nothing about today's problem (event handlers blocking checkout) requires
parallel execution — only removing handlers from the checkout path does. A single sequential
drain loop, run to completion or until no more eligible rows exist, is sufficient.

## Durability Invariant

**Enqueueing a job is a synchronous, awaited `INSERT` that must complete before the deferred
subscriber's handler-shaped call returns success to `useEventSubscription`'s dispatch loop.**

This is the one guarantee the whole tier rests on. It is explicitly *not* "hand the job to an
in-memory queue and return immediately" — that shape has a crash window (event fires → job held
only in memory → process dies before the write lands → job is silently lost) that write-then-return
closes. The handler itself never runs inline and is never awaited by the subscriber; only the
persistence of the *intent* to run it is awaited.

```ts
// Sketch — src/services/events/deferredSubscriber.ts
export function defineDeferredSubscriber<T>(opts: {
  subscriberName: string
  eventType: DomainEventType
  shopId: string
  jobType: string
  priority: 'critical' | 'normal' | 'low'
  requiresNetwork: boolean
  toJobPayload: (event: DomainEvent<T>) => unknown
  dedupeKey?: (event: DomainEvent<T>) => string | undefined
}): { stop: () => void } {
  return useEventSubscription<T>(
    opts.eventType,
    async (row) => {
      // Durability invariant: this INSERT is awaited before this handler returns,
      // which is what useEventSubscription's dispatch loop treats as "processed."
      await enqueueDeferredJob({
        jobType: opts.jobType,
        shopId: opts.shopId,
        payload: opts.toJobPayload(rowToDomainEvent(row)),
        priority: opts.priority,
        requiresNetwork: opts.requiresNetwork,
        dedupeKey: opts.dedupeKey?.(rowToDomainEvent(row)),
      })
    },
    { shopId: opts.shopId },
  )
}
```

## Dedup / Coalescing

A job type may supply a `dedupeKey` function. If the computed key collides with an existing
`queued` or `running` row of the same `job_type` (enforced by the partial unique index above,
not a `SELECT`-then-`INSERT` check — closes the race where two events fire close together and
both observe "not found" before either inserts), the new enqueue is a no-op. Once that row
reaches `completed`/`dead`/`evicted`, the same key is eligible to be enqueued again — the
uniqueness constraint's `WHERE status IN ('queued', 'running')` clause scopes it to active work
only, so `daily-summary:2026-08-12` can run once today and legitimately run again if some future
job type reuses the same key on a later day or after an explicit reset.

## Capacity & Eviction

- **Per-`job_type` quota** (e.g. 200 queued rows) — a runaway producer of one job type cannot
  starve the queue for every other job type.
- **Global hard ceiling** (e.g. 1000 queued rows total, across all types) — a safety ceiling
  given the device class, independent of how quotas are distributed across types.
- **Eviction candidate selection**, when either cap is hit by a new enqueue: among `queued` rows
  that are marked evictable (see below), pick lowest-priority first, then oldest
  (`enqueued_at`) within that priority — same ordering concept as execution, applied in reverse.
- **`critical` jobs are never silently evicted.** If capacity is exhausted and no evictable
  candidate exists (e.g. the queue is entirely `critical` jobs), the new enqueue **fails loudly**
  — the deferred subscriber's `enqueueDeferredJob` call throws, which (per the durability
  invariant) means the *event processing itself* fails and falls back to the existing
  publish/processing retry path rather than silently dropping the deferred work. This is a
  deliberately rare, alarm-worthy condition, not a normal operating mode.
- **An eviction is a state transition, not a delete.** The row moves to `status = 'evicted'`
  with `finished_at` set — observable via the same retention-bounded table, not silently
  discarded. A future operator/dashboard can query "how many jobs got evicted this week" as a
  real signal that quotas are undersized.

## Retention

`completed` and `evicted` rows are not kept forever — that would just relocate the
unbounded-growth risk from the active queue to the table's history. On each drain pass, after
draining eligible work, purge:

```sql
DELETE FROM local_deferred_jobs
WHERE status IN ('completed', 'evicted')
  AND finished_at <= ?;  -- now - 7 days
```

Seven days is chosen as generous enough for manual debugging of "did that job actually run"
during development/early production, without being permanent history — no ticket in this
codebase currently needs deferred-job history beyond short-term diagnostics. `dead` rows are
retained the same way (same purge query extended to include `dead`) — a permanently-failed job
is exactly the kind of thing worth a short diagnostic window before disappearing.

## Worker Triggers

- **App foreground / visibility change** — attempt a full drain of every eligible `queued` row
  (network-independent jobs run immediately regardless of connectivity).
- **PowerSync reconnect** — attempt a drain, which now also picks up `requires_network = 1` rows
  that were sitting ineligible while offline.
- **No polling timer.** If a drain trigger is somehow missed while the app is fully backgrounded,
  the next foreground or reconnect event catches up — consistent with the stated non-goal that
  this tier does not promise continuous background execution.

Both triggers call the same single `drainDeferredJobs(shopId)` entry point — there is one drain
implementation, not two, parameterized by nothing (it always attempts every eligible row
regardless of which trigger fired it; "eligible" already encodes the connectivity check via
`requires_network`).

## Call-Site Convention (for the next feature that uses this)

```ts
// Example only — not built in this ticket. Documented here so the first real
// consumer (most likely PDF receipts) has a copy-pasteable starting point.
registerJobHandler('receipt.pdf.generate', async (job) => {
  await generateAndStoreReceiptPdf(job.payload as ReceiptPdfJobPayload)
})

defineDeferredSubscriber({
  subscriberName: 'receiptPdfSubscriber',
  eventType: SalesEventType.Completed,
  shopId,
  jobType: 'receipt.pdf.generate',
  priority: 'normal',
  requiresNetwork: false,
  toJobPayload: (event) => ({ saleId: event.payload.saleId }),
  dedupeKey: (event) => `receipt-pdf:${event.payload.saleId}`,
})
```

## Edge Cases

| Case | Behavior |
|---|---|
| App crashes while a job is `running` | Lease (`lease_expires_at`) expires; next drain reclaims the row back to `queued`, clearing `worker_id`/`started_at`. Handler must be idempotent (same requirement `runDurableSubscriber` already places on its handlers), since a reclaimed job may have partially executed before the crash. |
| Two events fire close together with the same `dedupeKey` | SQLite's partial unique index rejects the second `INSERT` atomically — no race window, no duplicate queued job. |
| Queue is completely full of `critical` jobs and a new `critical` job arrives | Enqueue fails loudly; the triggering event's processing fails and is retried via the existing event-processing retry path (not silently dropped). This is intentionally treated as an alarm condition. |
| A `requires_network: true` job sits queued for days because the device stays offline | Remains `queued`, never evicted purely for age (only capacity pressure triggers eviction) — reconnect eventually drains it. Its own per-type quota still applies if the type produces jobs faster than they can be network-drained. |
| A job type's handler is not registered (e.g. app version rolled back after a job type was removed) | `drainDeferredJobs` skips rows whose `job_type` has no registered handler, leaving them `queued` rather than crashing the drain loop for every other job type — mirrors `retryPendingEventProcessing`'s existing `if (!handler) continue`. |
| `dedupeKey` collides with a `dead` row from a previous run | Allowed — uniqueness only applies to `queued`/`running`. A permanently-failed daily summary from yesterday must not block today's summary from ever being queued. |
| Worker drain takes a long time (large backlog after a week offline) | Sequential processing continues until no eligible rows remain or the app is backgrounded again (drain simply doesn't resume until the next trigger) — no explicit time-box in v1; per-type/global quotas bound the backlog size in the first place. |

## Risks

| Risk | Mitigation |
|---|---|
| A handler is non-idempotent and a lease-reclaim re-runs a partially-completed job | Documented requirement, same as `runDurableSubscriber`'s existing handler contract — not a new burden, an existing one extended to this tier |
| Lease duration too short for a legitimately slow handler, causing a live job to be reclaimed and run twice concurrently | Lease duration set generously (minutes, not seconds) relative to any handler this tier is designed for (PDF/report generation, not long-running streams); a handler that genuinely needs longer must renew its own lease in a later iteration — out of scope for v1's synthetic test job |
| Dedup key collision across unrelated job types | Uniqueness is `(job_type, dedupe_key)`, not `dedupe_key` alone — two different job types can safely reuse the same literal key string |
| Retention purge deletes a row a diagnostic dashboard was about to read | 7-day window is generous for manual debugging; no feature in this codebase currently depends on longer-lived job history — documented as a deliberate, revisitable choice, not an oversight |
| Eviction silently drops business-relevant work | `critical` priority is structurally never evicted (enqueue fails loudly instead); `normal`/`low` job types must be chosen deliberately by whoever defines them, with this consequence documented at the call site |
| Sequential-only execution becomes a throughput bottleneck if a future job type is genuinely slow at volume | Explicitly deferred — v1 has no such job type; revisit only when a real one exists rather than over-building concurrency now |
| A future engineer builds a producer for non-event-triggered jobs by calling `enqueueDeferredJob` directly, bypassing the intended "always via a deferred subscriber" pattern | Not prevented at the type level in v1 (the internal implementation is intentionally not welded shut to event-only callers) — documented as an accepted architectural looseness, revisit if it's actually exploited before this becomes a real problem |

## Integration Test List

All against the real local SQLite (via `db`), not mocked, mirroring how WAFI-150/151's suites
exercise real Postgres — these are lifecycle proofs, not unit tests of isolated functions:

1. **Enqueue persists before return** — `defineDeferredSubscriber`'s wrapped handler does not
   resolve until the `INSERT` has committed; verified by asserting the row exists in
   `local_deferred_jobs` synchronously after the awaited call returns, no polling needed.
2. **Event flow does not execute the handler** — enqueue a `test.*` job with a handler that
   throws if called; assert the deferred subscriber's own call succeeds and the throwing handler
   is never invoked until an explicit `drainDeferredJobs` call.
3. **Offline job survives restart** — enqueue, simulate an app restart (fresh `db` handle against
   the same underlying file/connection), assert the row is still `queued` with all fields intact.
4. **Foreground drains offline-capable jobs** — a `requires_network: false` job queued while
   offline is picked up and completed by a foreground-triggered drain with no connectivity.
5. **Network-required job waits offline** — a `requires_network: true` job queued while offline
   is *not* selected by a foreground drain; remains `queued`.
6. **Reconnect drains network-required jobs** — the same job from test 5 is selected and
   completed once a reconnect-triggered drain runs with connectivity simulated as available.
7. **Retry uses the existing backoff schedule** — a transiently-failing handler causes
   `next_retry_at` to match the shared `[1, 5, 30, 120]`-minute schedule, not a separately
   invented schedule.
8. **Transient vs. permanent failure classification** — a transient-classified error (per
   `isTransientEventFailure`) returns the row to `queued` with an incremented `attempts`; a
   permanent-classified error moves the row straight to `dead` on its first failure.
9. **Stale running job recovers** — manually set a row to `running` with an expired
   `lease_expires_at`; assert the next drain reclaims it to `queued` (cleared `worker_id`/
   `started_at`) before claiming any new work.
10. **Priority ordering** — enqueue a `low` job before a `critical` job (same `job_type`); assert
    the drain processes the `critical` job first.
11. **FIFO within same priority** — enqueue two `normal` jobs of the same type in sequence;
    assert they process in enqueue order.
12. **Per-type quota enforced** — enqueue `N+1` jobs of one type against a quota of `N`; assert
    the oldest evictable row of that type is evicted, not a row of an unrelated type.
13. **Global cap enforced independently of per-type quotas** — enqueue jobs spread across
    multiple types, each under its own quota but summing past the global ceiling; assert eviction
    still triggers.
14. **Eviction respects priority** — with both `low` and `normal` jobs queued at capacity, assert
    the evicted row is always the `low` one (then oldest, if a tie).
15. **Critical jobs are never silently evicted** — fill the queue entirely with `critical` jobs
    up to capacity; assert the next enqueue attempt throws rather than evicting anything, and no
    row's status silently changes to `evicted`.
16. **Dedup is atomic under a race** — fire two enqueue calls with the same `dedupeKey`
    concurrently (`Promise.all`); assert exactly one `queued` row exists afterward, not zero and
    not two.
17. **Dedup key reusable after completion** — enqueue, drain to `completed`, enqueue again with
    the identical `dedupeKey`; assert the second enqueue succeeds and produces a new row.
18. **Completed jobs don't cause permanent queue growth** — enqueue and complete a job with
    `finished_at` artificially set past the 7-day retention window; assert the next drain's purge
    step removes it.
19. **Evicted and dead rows are also purged, not just completed** — same as test 18, extended to
    `evicted`/`dead` statuses.
20. **Unregistered job type doesn't block the drain loop** — enqueue a job of a type with no
    registered handler alongside a normal job of a registered type; assert the registered job
    still completes and the unregistered one remains `queued` (not crashed, not silently
    dropped).

## Out of Scope

- Any real production job type (PDF receipts, daily digest, batch reports) — this ticket ships
  the framework plus `test.*` synthetic job types used only by the integration suite above.
- A non-event-triggered enqueue API/producer.
- Worker concurrency beyond sequential single-job execution.
- Lease renewal for long-running handlers.
- An admin/operator UI for inspecting the deferred queue (dead-letter review, manual retry,
  eviction stats) — the table is queryable directly for now, same posture WAFI-150 took for its
  own retry queue at the time it shipped.
- Cross-device job coordination — this queue is purely local to one device; two devices for the
  same shop each run their own independent deferred queue, with no shared state (correct, since
  every job here is triggered by a locally-observed event, and the underlying event itself is
  already deduplicated shop-wide by the existing event-processing ledger before this tier ever
  sees it).
