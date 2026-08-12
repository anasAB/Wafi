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

`defineDeferredSubscriber()` has a similar call shape to `runDurableSubscriber()` (same
`subscriberName`/`eventType`/`shopId` parameters), but instead of invoking a handler, it writes
one row to `local_deferred_jobs` and returns. The row itself is what "the event was durably
deferred" means — see Durability Invariant below.

**Precise dependency on WAFI-150, stated explicitly:** WAFI-154 reuses the *generalized*
retry-classification, backoff-policy, and failure-semantics primitives that WAFI-150 established
(`isTransientEventFailure`, the shared `[1, 5, 30, 120]`-minute backoff schedule) — it does **not**
reuse `runDurableSubscriber`'s inline execution path itself, and a deferred subscriber is not a
specialization of a durable one. The similarity in call shape above is a convenience for anyone
reading both side by side, not an inheritance relationship. This keeps the three-tier picture
accurate: Immediate and Durable both execute inline (the only difference is retry-on-failure);
Deferred never executes inline at all — it persists and returns, full stop — while still drawing
on the same underlying retry primitives Durable already established, rather than inventing a
fourth backoff schedule.

**Two distinct registration surfaces, one source of truth per concern** — a producer (the
deferred subscriber) never decides operational policy for a job type; a job type's definition
never decides which event produces it:

- **Producer decides** (`defineDeferredSubscriber`): which event triggers this, what `jobType`
  string to enqueue, the payload shape, and an optional `dedupeKey`.
- **Job type definition decides** (`registerJobHandler`): the handler function, `priority`, and
  `requiresNetwork`/`maxQueuedJobs` (per-type quota). Whether a job type is evictable is not a
  separate flag here — see Capacity & Eviction below: it is derived structurally from `priority`,
  so the two properties can never disagree.

This split avoids the same `priority`/`requiresNetwork` value being duplicated (and able to
drift) across every deferred subscriber that happens to enqueue the same job type — a job type's
operational policy is defined exactly once, regardless of how many event types eventually feed
it. The worker resolves both the handler and its policy from `registerJobHandler`'s registry when
it dequeues a row, keyed on `job_type` — mirroring how `retryPendingEventProcessing`'s
`handlers: Map<string, ...>` parameter already resolves a handler by name today.

### Same SQLite database, no new storage layer

`local_deferred_jobs` lives in the same PowerSync-backed SQLite database as every other local
table (`local_event_processing_retries`, `local_subscriber_processed_events`, etc.), accessed
through the same `db` from `@/data/powersync/db`. No IndexedDB, no separate queue store — this
matches every existing local-only table's convention (`{ localOnly: true }` in
`src/data/powersync/schema.ts`) and means job persistence gets the same crash-durability
guarantees (SQLite WAL) the rest of the app already relies on, for free.

**`local_deferred_jobs` is device-local and is never synchronized to Supabase or to another
device.** `{ localOnly: true }` is what enforces this architecturally — PowerSync never includes
this table in its sync protocol in either direction. This matters enough to state directly here,
not only under Cross-Device Coordination below: a deferred job's existence, status, and payload
are facts about one device's local work queue, never shop-wide state.

## Schema

```ts
// src/data/powersync/schema.ts — WAFI-154

const local_deferred_jobs = new Table({
  job_type:          column.text,     // e.g. 'test.sleep' (v1's only real registrant)
  shop_id:           column.text,
  payload:           column.text,     // JSON.stringify'd, same convention as events.payload
  priority:          column.text,     // 'critical' | 'normal' | 'low' -- stamped from the job
                                       // type's registerJobHandler policy at enqueue time, not
                                       // supplied by the producer (see Call-Site Convention)
  requires_network:  column.integer,  // 0 | 1 (SQLite has no boolean) -- same stamping rule
  dedupe_key:        column.text,     // nullable — see Dedup section
  status:            column.text,     // 'queued' | 'running' | 'completed' | 'dead' | 'evicted'
  attempts:          column.integer,
  last_error:        column.text,     // nullable
  next_retry_at:     column.text,     // ISO string, nullable (only meaningful while queued+retrying)
  worker_id:         column.text,     // nullable — set on running, cleared on return-to-queued.
                                       // v1 always has exactly one process-local worker per app
                                       // instance, so this is a single fixed identity generated
                                       // once at worker init (e.g. a random id per app session),
                                       // not a pool of distinguishable workers. Kept as a real
                                       // column anyway (cheap) so lease ownership is explicit and
                                       // future multi-worker designs don't have to assume `running`
                                       // alone identifies ownership.
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
itself, not by a `SELECT`-then-`INSERT` race. Selection is bounded by the global 1,000-row
ceiling (see Capacity & Eviction) — a full scan over `(shop_id, status, priority, enqueued_at)`
at that size is trivial on the target device class; `next_retry_at` is deliberately left out of
this index for v1 rather than added pre-emptively, and is only worth revisiting if production
telemetry ever shows drain selection itself as a measurable cost.

**Payload size guidance:** a job's `payload` must be a small set of references/scalars (IDs,
timestamps, short strings) — e.g. `{ saleId: '...' }` — never a hydrated domain object (a full
sale with its line items, customer, and product records). The handler is responsible for
fetching whatever data it needs at execution time, not receiving it pre-hydrated from the
producer. This matters doubly on the target device class: `payload` round-trips through
`JSON.stringify`/`JSON.parse` on every enqueue, drain claim, and (via `serialized_event`-style
logging, if ever added) diagnostic dump, and a large payload multiplies that cost needlessly. No
hard byte-limit constant is introduced in v1 — this is stated as an architectural rule for every
future job type to follow, not enforced by a runtime check, since no real job type exists yet to
calibrate a concrete number against; a hard limit can be added once production telemetry shows a
job type actually needs the guardrail.

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
  (fixed lease duration, e.g. 5 minutes — generous relative to any realistic handler) are set when
  a worker claims a row. On every drain pass, before claiming new work, the worker first reclaims
  any `running` row whose `lease_expires_at` has passed: `status = 'queued', worker_id = NULL,
  started_at = NULL, lease_expires_at = NULL`. This is the direct fix for the "app crashes
  mid-handler, job stuck in `running` forever" failure mode — same shape as WAFI-151's
  advisory-lock-scoped recovery, applied here as a row-level lease instead of a Postgres advisory
  lock (this queue is purely client-local, so there's no cross-device contention to guard against
  — only cross-restart).
  **Explicit invariant: the lease is a crash-recovery mechanism, not a hard execution timeout.**
  It does not — and cannot, from client-side JavaScript — forcibly halt a still-running handler.
  If a lease expires while the original handler is genuinely still executing (e.g. the app was
  never actually killed, just slow), a later drain pass may reclaim and re-run the same job while
  the original async handler call is still unresolved — resulting in overlapping async
  executions on the same JavaScript thread (async interleaving, not multi-threaded concurrency;
  see the Concurrency section's terminology note). This is a deliberately accepted v1
  trade-off, not an oversight: closing it properly would require distributed-lock-style
  fencing tokens, which is disproportionate for a single-device local PWA queue. **Handlers must
  therefore be idempotent** — the same requirement `runDurableSubscriber` already places on its
  handlers, extended to cover concurrent-with-itself execution, not just sequential re-delivery.
- **`dead` is a distinct terminal state from a retryable `queued`.** **Initial v1
  `MAX_ATTEMPTS: 5`** — a starting operational constant in code, not an architectural
  requirement, matching how the capacity defaults above are framed. A row that has *exhausted*
  its attempt budget moves to `dead` and is never re-selected by the worker's claim query (which
  only ever selects `status = 'queued'`) — this is the direct fix for "exhausted retries silently
  becoming eligible again on the next foreground/reconnect," which a same-status
  `failed`-with-a-flag design would risk if any query forgot to check the flag.
  **`attempts` increments at claim time, not only on handler failure** — a worker claiming a row
  (`queued` → `running`) increments `attempts` immediately, so a crash-and-reclaim cycle spends
  one attempt even if the handler never got a chance to throw. Without this, `MAX_ATTEMPTS` would
  under-count real execution attempts and a job stuck in a claim/crash loop could retry
  indefinitely. Concretely: `queued (attempts=0)` → claim → `running (attempts=1)` → crash →
  reclaim → `queued (attempts=1)` → claim → `running (attempts=2)`, and so on.
  **Exact boundary rule, since attempts is now incremented at claim rather than at failure:** the
  worker may claim and execute any `queued` row whose claim brings `attempts` up to
  `MAX_ATTEMPTS` — reaching the limit on a claim is not itself a reason to skip execution. Only
  *after* that attempt's handler call fails does the row transition to `dead`, rather than back
  to `queued`. So with `MAX_ATTEMPTS = 5`, a row genuinely gets 5 real executions (or
  claim-then-crash cycles), not 4 — the fifth claim still runs the handler.
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

**Rule:** higher-priority eligible jobs always run before lower-priority ones; FIFO **within the
same priority, across all job types** is the tiebreak — the `ORDER BY priority, enqueued_at`
query makes no reference to `job_type`, so three unrelated `normal`-priority jobs (a PDF, a
report, a digest) process strictly in enqueue order relative to each other, not grouped by type.
A `low` job enqueued five minutes before a `critical` job never blocks it — priority governs both
what runs first and what gets evicted first, one consistent ordering concept rather than two.

## Concurrency

Jobs are drained and executed **sequentially, one at a time**, on the client — matching every
existing retry-queue loop in this codebase (`retryPendingEventProcessing`'s `for` loop). No
worker pool, no `Promise.all` over multiple jobs. This is a deliberate simplicity choice for v1:
cheap Android devices are the target, SQLite writes from concurrent handlers would need their own
locking story, and nothing about today's problem (event handlers blocking checkout) requires
parallel execution — only removing handlers from the checkout path does.

**Terminology note, deliberately precise:** when a lease expires while its original handler is
still unresolved (see the lease invariant above), the resulting duplicate execution is **async
interleaving on a single JavaScript thread**, not concurrent or parallel execution in the
multi-threaded sense. Two `await`-suspended calls to the same handler can genuinely interleave
their continuations, which is exactly why the handler-idempotency requirement exists — but this
document deliberately avoids the word "concurrent" for this case so a future engineer doesn't
reach for Web Workers or a thread pool to "fix" something that isn't a threading problem.

**The drain loop must yield to the browser/JS event loop between job executions.** A drain
processing a large backlog (e.g. after a week offline) must not monopolize the main thread —
without a yield point, a `visibilitychange` (app backgrounded) event cannot be dispatched until
the synchronous portion of the loop finishes, meaning the app would keep draining in the
background well past the point the OS/browser expects it to be idle. Concretely: after each job
finishes (success, failure, or lease-driven skip), the drain loop yields control back to the
event loop (the exact primitive — a `setTimeout(0)`, a microtask, or equivalent — is an
implementation detail, not an architectural requirement) and then re-checks whether the app is
still foregrounded before claiming the next row; if not, the drain loop stops where it is,
leaving remaining eligible rows `queued` for the next trigger.

**Single-flight guard on `drainDeferredJobs`.** The two triggers (foreground, reconnect) can fire
close together — a reconnect event arriving while a foreground-triggered drain is still running
must not start a second, overlapping drain loop. `drainDeferredJobs(shopId)` tracks whether a
drain is already in flight for that shop and, if so, the second call reuses the in-flight
promise rather than starting a competing loop. This is a distinct concern from the per-row lease:
the lease protects a single row across process *restarts*; the single-flight guard protects
against two live loops in the *same* running process racing each other to claim rows.

## Durability Invariant

**Enqueueing a job is a synchronous, awaited `INSERT` that must complete before the deferred
subscriber's handler-shaped call returns success to `useEventSubscription`'s dispatch loop.**

This is the one guarantee the whole tier rests on. It is explicitly *not* "hand the job to an
in-memory queue and return immediately" — that shape has a crash window (event fires → job held
only in memory → process dies before the write lands → job is silently lost) that write-then-return
closes. The handler itself never runs inline and is never awaited by the subscriber; only the
persistence of the *intent* to run it is awaited.

**Precise semantic boundary, stated explicitly because it is easy to misread:** "the event was
successfully processed" means **"the deferred work was durably enqueued,"** never **"the
deferred work completed."** A `sale.completed` event that fed a `receipt.pdf.generate` deferred
subscriber is fully, correctly processed the instant that row lands in `local_deferred_jobs` —
regardless of whether the PDF job later succeeds, retries, or ends up `dead`. The event bus and
the deferred queue are deliberately decoupled once the enqueue succeeds; nothing about "the sale
event is processed" implies "a receipt was generated," and no code anywhere should conflate the
two. This is exactly why the Failure Observability section below is necessary — without it, a
job's eventual `dead` state is invisible past this boundary to anything outside the one device
that queued it.

```ts
// Sketch — src/services/events/deferredSubscriber.ts
//
// Producer-side: knows only WHAT to enqueue and WHEN (which event triggers it),
// never HOW the job type is operationally handled — that's registerJobHandler's job.
export function defineDeferredSubscriber<T>(opts: {
  subscriberName: string
  eventType: DomainEventType
  shopId: string
  jobType: string
  toJobPayload: (event: DomainEvent<T>) => unknown
  dedupeKey?: (event: DomainEvent<T>) => string | undefined
}): { stop: () => void } {
  return useEventSubscription<T>(
    opts.eventType,
    async (row) => {
      // Durability invariant: this INSERT is awaited before this handler returns,
      // which is what useEventSubscription's dispatch loop treats as "processed."
      // enqueueDeferredJob looks up opts.jobType's registered policy (priority,
      // requiresNetwork, maxQueuedJobs) and stamps it onto the row -- the producer
      // never supplies or duplicates that policy itself.
      await enqueueDeferredJob({
        jobType: opts.jobType,
        shopId: opts.shopId,
        payload: opts.toJobPayload(rowToDomainEvent(row)),
        dedupeKey: opts.dedupeKey?.(rowToDomainEvent(row)),
      })
    },
    { shopId: opts.shopId },
  )
}

// Job-type-side: owns every operational policy decision for this job type, exactly
// once, regardless of how many deferred subscribers eventually enqueue it.
export function registerJobHandler(opts: {
  jobType: string
  handler: (job: DeferredJob) => Promise<void>
  priority: 'critical' | 'normal' | 'low'
  requiresNetwork: boolean
  maxQueuedJobs: number
}): void {
  // Evictability is derived structurally from priority, never a separate field --
  // see Capacity & Eviction. This makes `priority: 'critical', evictable: true` (or
  // the reverse contradiction) an impossible state rather than a bug to catch in review.
  jobTypeRegistry.set(opts.jobType, { ...opts, evictable: opts.priority !== 'critical' })
}
```

Registration order matters: `registerJobHandler` calls must run before the corresponding
`defineDeferredSubscriber` can successfully enqueue (mirrors the existing constraint that
`retryPendingEventProcessing`'s `handlers` map must already contain an entry before a retry for
that subscriber can be replayed) — enforced in practice by registering all job types once at app
init, before any subscribers start.

## Failure Observability

**The gap:** because `local_deferred_jobs` is `{ localOnly: true }` and the Durability Invariant
means the event bus reports success the instant the row is enqueued, there is no path by which
Supabase, an operator dashboard, or the shop owner would otherwise learn that a job later reached
`dead`. Left unaddressed, a device could locally accumulate silently-failed receipt generations
indefinitely — the retention purge (7 days) would delete the *evidence* of the failure at the
same time as the failure itself, with nobody ever alerted.

**What this ticket does NOT do:** it does not sync `local_deferred_jobs` (that would violate the
device-local invariant this whole design rests on), and it does not make individual job handlers
responsible for reporting their own terminal failure (`receipt.pdf.generate`'s handler has no
business knowing it's "the final attempt" or how to notify a backend — that's queue-lifecycle
knowledge, and pushing it into every handler is exactly the kind of leaky abstraction this tier
exists to avoid).

**What this ticket does instead: reuse the existing Sentry integration (WAFI-023), not build a
new synced-event mechanism.** This codebase already has a durable, already-PII-scrubbed,
already-shop-scoped channel for "something needs a human's attention" —
`src/sentry.ts`/`initSentry`. A `dead` transition is exactly that kind of signal, not a new
category of domain fact that needs its own event type, retention policy, and RLS story on the
Postgres side. Concretely: the worker itself (not the handler) calls a single
`reportDeferredJobDead(row)` helper at the moment it writes `status = 'dead'`, which calls
`Sentry.captureMessage` (or `captureException` if `last_error` carries a real `Error`) with
structured context — `job_type`, `shop_id`, `attempts`, `last_error` — and explicitly **never**
the job's `payload` (consistent with WAFI-023's existing PII-scrubbing posture; a job payload may
contain a customer-identifying reference the Sentry pipeline shouldn't see even scrubbed).

This keeps the invariant precise and revisable:

> A deferred job's queue state is device-local and never synchronized. Terminal failure
> (`dead`) of a job type must still produce an observable signal through the application's
> existing durable telemetry mechanism (Sentry), owned by the worker itself — never by
> individual job handlers, and never by syncing the queue.

**Scope note:** if `VITE_SENTRY_DSN` is unset (per `initSentry`'s existing no-op-outside-DSN
behavior), this degrades to the same "no monitoring configured" state every other error in the
app already has in that condition — not a new gap introduced by this ticket. No new environment
variable or backend table is required.

## Dedup / Coalescing

A job type may supply a `dedupeKey` function. If the computed key collides with an existing
`queued` or `running` row of the same `job_type` (enforced by the partial unique index above,
not a `SELECT`-then-`INSERT` check — closes the race where two events fire close together and
both observe "not found" before either inserts), the new enqueue is a **successful no-op**, not
a failure: `enqueueDeferredJob` catches exactly the unique-constraint-violation for
`(job_type, dedupe_key)` and resolves normally rather than rethrowing, because "this work is
already represented by an active queued job" is the intended outcome, not an error condition.
**Any other `INSERT` failure** (disk I/O, a genuinely corrupt row, etc.) **is not caught this
way and propagates**, per the Durability Invariant below — the distinction matters precisely
because both are technically "the INSERT didn't create a new row," but only one of them means
the work is safely represented.

**Implementation constraint, not optional:** this distinction must be made using the database
layer's **structured SQLite error information** (e.g. an exposed `SQLITE_CONSTRAINT`/
`SQLITE_CONSTRAINT_UNIQUE` code), never by string-matching the error message. Whichever SQLite
wrapper the client persistence layer uses (PowerSync's own wrapper, `wa-sqlite`, etc.) must be
verified during implementation to actually expose this distinction as structured data before this
catch is written — if it only surfaces a generic `Error` with no code, that gap must be closed
first (e.g. wrapping the constraint name into a typed error) rather than falling back to message
matching, which is exactly the kind of fragile check a future SQLite/wrapper version upgrade
could silently break.

Once a row reaches `completed`/`dead`/`evicted`, the same key is
eligible to be enqueued again — the uniqueness constraint's `WHERE status IN ('queued',
'running')` clause scopes it to active work only, so `daily-summary:2026-08-12` can run once
today and legitimately run again if some future job type reuses the same key on a later day or
after an explicit reset.

## Capacity & Eviction

- **Per-`job_type` quota**, set via `registerJobHandler`'s `maxQueuedJobs` — a runaway producer of
  one job type cannot starve the queue for every other job type. **Initial v1 default: 200**,
  a starting constant in code, not an architectural requirement — subject to adjustment per job
  type once real production telemetry exists.
- **Global hard ceiling**, a single constant shared across all job types — a safety ceiling given
  the device class, independent of how per-type quotas are distributed. **Initial v1 default:
  1,000 queued rows total**, likewise a configurable starting point, not a fixed architectural
  number.
- **Evictability is derived structurally from priority, never a separate flag:**
  `evictable = priority !== 'critical'`. There is exactly one source of truth for "can this job
  type's queued work be sacrificed under pressure" — priority itself — so a `critical` job type
  marked evictable, or a `normal`/`low` job type marked non-evictable, is not a state the schema
  or registry can represent, rather than a misconfiguration to catch in code review.
- **Eviction candidate selection**, when either cap is hit by a new enqueue: among `queued` rows
  whose job type's priority is not `critical`, pick lowest-priority first, then oldest
  (`enqueued_at`) within that priority — same ordering concept as execution, applied in reverse.
- **A `critical` job type is never silently evicted**, by construction. If capacity is exhausted
  and no non-`critical` candidate exists, the new enqueue **fails loudly** — the deferred
  subscriber's `enqueueDeferredJob` call throws.
  **Invariant, elevated beyond just this eviction section:** a deferred job that cannot be
  durably persisted is treated as an event-processing failure, full stop — never as a silently
  dropped or silently degraded deferred write. Per the Durability Invariant above, the deferred
  subscriber's `INSERT` either succeeds (event processing succeeds) or fails (event processing
  fails and falls back to the existing publish/processing retry path). A capacity-exhausted
  non-evictable job type is simply one concrete way that `INSERT` can fail — the invariant itself
  is general, not eviction-specific. This is a deliberately rare, alarm-worthy condition in
  practice, not a normal operating mode; a real operational consequence worth naming explicitly
  is that a persistent capacity problem on a non-evictable job type will keep failing that
  event's processing repeatedly across retries until the queue drains — the correct trade-off
  (never silently losing critical work) but a real one, not a free one.
- **An eviction is a state transition, not a delete.** The row moves to `status = 'evicted'`
  with `finished_at` set — observable via the same retention-bounded table, not silently
  discarded. A future operator/dashboard can query "how many jobs got evicted this week" as a
  real signal that quotas are undersized.

**Exact `enqueueDeferredJob` algorithm, and why it must be one transaction:**

```
enqueue(job):
  1. dedupe collision on (job_type, dedupe_key)?  -- see Dedup section
       yes → resolve successfully, no-op, stop here
  2. count of queued rows for this job_type >= maxQueuedJobs?
       yes → evict oldest evictable row of THIS job_type (fails loudly if none evictable)
  3. total queued row count (all types) >= global ceiling?
       yes → evict oldest lowest-priority evictable row GLOBALLY (fails loudly if none evictable)
  4. INSERT the new row
```

Steps 2-4 (capacity check, any eviction, and the final `INSERT`) **must execute inside a single
SQLite transaction.** The worker's sequential drain loop is not the only caller that touches this
table — `enqueueDeferredJob` can be invoked by multiple deferred subscribers reacting to
different events arriving close together, and nothing about the event bus serializes those
calls. Without a single transaction, two concurrent enqueue calls could each read
`count(type) = 199` against a quota of 200, both decide no eviction is needed, and both insert —
silently exceeding the quota by one. Wrapping the read-decide-evict-insert sequence in one
transaction closes that race the same way the dedup partial-unique-index closes the dedup race,
by construction rather than by convention.

**Per-type eviction is evaluated first, independently of the global check** — a job type at its
own quota is trimmed regardless of how far below the global ceiling the queue as a whole sits.
The global check runs after, against whatever the queue looks like post-step-2. Because
evictability is derived from `priority !== 'critical'` (not a separate flag), a per-type eviction
of a `critical` job type is structurally impossible at step 2 just as it is at step 3 — there is
no path by which trimming one job type's quota could inadvertently threaten a `critical` job
type's rows, since `critical` rows are simply never eviction candidates in either step.

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

// Job-type definition: owns the operational policy, once, at app init.
registerJobHandler({
  jobType: 'receipt.pdf.generate',
  handler: async (job) => {
    await generateAndStoreReceiptPdf(job.payload as ReceiptPdfJobPayload)
  },
  priority: 'normal',       // implies evictable -- 'normal'/'low' are always evictable, 'critical' never is
  requiresNetwork: false,
  maxQueuedJobs: 200,
})

// Producer: only knows which event triggers it and what payload/dedupe key to send.
defineDeferredSubscriber({
  subscriberName: 'receiptPdfSubscriber',
  eventType: SalesEventType.Completed,
  shopId,
  jobType: 'receipt.pdf.generate',
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
| Worker drain takes a long time (large backlog after a week offline) | Sequential processing yields to the event loop between jobs and re-checks foreground state after each one; the drain stops mid-backlog the moment the app is backgrounded rather than continuing to run behind the OS's back, resuming from where it left off (rows simply remain `queued`) on the next trigger. |
| Foreground and reconnect triggers fire close together | `drainDeferredJobs`'s single-flight guard means the second trigger reuses the already-in-flight drain rather than starting a second loop that would race the first for the same rows. |
| A `dead` job's failure needs to reach someone outside the device | The worker calls `reportDeferredJobDead` (Sentry, per Failure Observability) at the exact moment a row transitions to `dead` — this is the only path by which a terminal local failure becomes visible off-device; no other mechanism does this. |

## Risks

| Risk | Mitigation |
|---|---|
| A handler is non-idempotent and a lease-reclaim re-runs a partially-completed (or, per the lease invariant, still-executing) job | Documented, explicit requirement — the lease is stated as a crash-recovery mechanism, not a hard execution timeout; handlers must be idempotent under both sequential re-delivery and concurrent-with-itself execution. Same category of requirement `runDurableSubscriber` already places on its handlers, extended one step further |
| Lease duration too short for a legitimately slow handler, causing a live job to be reclaimed and run twice concurrently | Lease duration set generously (minutes, not seconds) relative to any handler this tier is designed for (PDF/report generation, not long-running streams); a handler that genuinely needs longer must renew its own lease in a later iteration — out of scope for v1's synthetic test job. This risk is not eliminated (see the lease invariant above), only made rare |
| A claim/crash loop burns through `MAX_ATTEMPTS` without the handler ever completing a full execution | Accepted trade-off of counting `attempts` at claim time rather than only on handler failure — the alternative (not counting reclaim cycles) would let a job that crashes the app on every attempt retry forever; a small number of wasted attempts against a rare crash loop is preferable |
| Dedup key collision across unrelated job types | Uniqueness is `(job_type, dedupe_key)`, not `dedupe_key` alone — two different job types can safely reuse the same literal key string |
| Retention purge deletes a row a diagnostic dashboard was about to read | 7-day window is generous for manual debugging; no feature in this codebase currently depends on longer-lived job history — documented as a deliberate, revisitable choice, not an oversight |
| Eviction silently drops business-relevant work | `critical` priority is structurally never evicted (enqueue fails loudly instead); `normal`/`low` job types must be chosen deliberately by whoever defines them, with this consequence documented at the call site |
| Sequential-only execution becomes a throughput bottleneck if a future job type is genuinely slow at volume | Explicitly deferred — v1 has no such job type; revisit only when a real one exists rather than over-building concurrency now |
| A future engineer builds a producer for non-event-triggered jobs by calling `enqueueDeferredJob` directly, bypassing the intended "always via a deferred subscriber" pattern | Not prevented at the type level in v1 (the internal implementation is intentionally not welded shut to event-only callers) — documented as an accepted architectural looseness, revisit if it's actually exploited before this becomes a real problem |
| A large backlog drain never yields, blocking the main thread and delaying `visibilitychange` handling until the OS considers the tab unresponsive | Explicit requirement (Concurrency section): the drain loop yields after every job and re-checks foreground state before continuing — not an incidental performance nice-to-have, a correctness requirement for backgrounding to actually work |
| Two overlapping drain loops (foreground + reconnect firing close together) both claim rows, defeating the purpose of sequential execution | Single-flight guard on `drainDeferredJobs` — a second trigger while a drain is in flight reuses the existing promise rather than starting a competing loop |
| Dedup-conflict detection relies on string-matching a SQLite error message, which silently breaks on a wrapper/SQLite version upgrade that changes wording | Explicit implementation constraint: the distinction must use structured error information (an actual SQLITE_CONSTRAINT code), verified against the real wrapper during implementation, never a message-text check |
| A job type's payload is a large hydrated domain object, multiplying JSON serialization cost on every enqueue/claim on a cheap device | Documented architectural rule (not a runtime-enforced limit in v1, since no real job type exists yet to calibrate a number against): payloads carry references only, handlers fetch data at execution time |
| Two concurrent `enqueueDeferredJob` calls both observe a job type just under its quota and both insert, silently exceeding it | Capacity check + eviction + insert run inside one SQLite transaction, closing the same class of race the dedup partial-unique-index closes for dedup |
| A job's terminal `dead` failure is invisible to anyone outside the one device that queued it, with no alert ever firing | Failure Observability: the worker reports every `dead` transition through the existing Sentry integration (job_type/shop_id/attempts/last_error only, never the payload) — reusing existing infrastructure rather than building a new synced failure-event mechanism |

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
11. **FIFO within same priority, across different job types** — enqueue three `normal`-priority
    jobs of three *different* job types in sequence (e.g. one `test.a`, one `test.b`, one
    `test.a` again); assert they process in strict enqueue order regardless of type, proving
    ordering is not accidentally grouped by `job_type`.
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
16. **Dedup is atomic under a race, and the losing call resolves successfully, not with an
    error** — fire two enqueue calls with the same `dedupeKey` concurrently (`Promise.all`);
    assert exactly one `queued` row exists afterward (not zero, not two), **and** assert both
    `Promise.all` calls resolve without throwing — the second (constraint-violating) call must
    be observed by its caller as a successful no-op, per the Dedup/Coalescing section, not as an
    enqueue failure that would incorrectly propagate to the event-processing failure path.
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
21. **Enqueue failure propagates to event processing, never silently swallowed** — force
    `enqueueDeferredJob`'s `INSERT` to fail (e.g. a non-evictable job type at capacity, per test
    15's setup); assert the deferred subscriber's wrapped handler rejects, and that this
    rejection is observed by `useEventSubscription`'s dispatch loop as a genuine processing
    failure (i.e. it reaches the same failure path a durable subscriber's handler throw would)
    rather than being caught and discarded anywhere in between. This is the direct proof of the
    Durability Invariant's core promise: if the work cannot be durably deferred, the event is
    never falsely reported as successfully processed.
22. **Drain yields between jobs and aborts on backgrounding** — enqueue several jobs whose
    handlers record execution order into an array; simulate the app being backgrounded (flip the
    "is foregrounded" check the drain loop consults) in between two of those handler calls; assert
    the drain loop stops immediately after the currently-executing job and does not proceed to
    the remaining backlog, leaving those rows `queued`.
23. **Single-flight guard prevents overlapping drains** — start a `drainDeferredJobs` call whose
    first job's handler is a controllable, slow-resolving promise; while that first drain is still
    in flight, invoke `drainDeferredJobs` again (simulating a reconnect firing mid-foreground-drain);
    assert only one underlying claim loop actually runs (e.g. via a call-count spy on the claim
    query) and the second call resolves once the first drain's promise resolves, rather than
    independently claiming rows.
24. **Terminal `dead` failure reports through the existing telemetry mechanism** — force a job to
    exhaust `MAX_ATTEMPTS` and transition to `dead`; assert `reportDeferredJobDead` (or the
    Sentry call it wraps) is invoked exactly once with `job_type`/`shop_id`/`attempts`/
    `last_error`, and assert the job's `payload` is never included in that call's arguments.

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
