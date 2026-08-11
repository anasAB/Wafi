# WAFI-151 — Projection Rebuild & Event Recovery — Design Spec

**Status:** Approved for implementation planning
**Date:** 2026-08-11
**Ticket:** WAFI-151 (Macro-Phase 3, P1, 1 sprint)
**Related:** WAFI-140/143/150 (event bus, already built), WAFI-153 (Read Models/CQRS — future, not built yet)

## Purpose

Establish a single, version-controlled recovery contract: **any derived projection must be reconstructible from the authoritative event log.** This ticket proves that contract against the two projections that exist today:

- `daily_event_counts` (Postgres, server-side, migration 074)
- `local_today_revenue_projection` (SQLite/PowerSync, client-side)

WAFI-153's future read models (`dashboard_metrics`, `profit_cache`, `inventory_summary`, etc.) adopt this same contract rather than requiring a new recovery design. WAFI-151 does **not** build those new read model tables — that is WAFI-153's job.

## Core Architectural Invariant

Both incremental (normal) processing and rebuild use the same version-controlled `applyEvent(event, projectionState)` contract and handler semantics per projection type. Where implementation can be shared (e.g. both consumers running the same code), the same handler is used; where runtime differences require separate implementations (see Postgres vs SQLite below), shared fixture-based contract tests prove equivalent results. Rebuild is running `applyEvent` over the complete authoritative event set **for the requested projection scope**, ordered canonically by `sequence`, starting from an empty projection state — "complete" means complete for that scope (a shop+range for server-side, the locally-synced window for client-side), not the projection's entire lifetime history in every case.

`projectionState` is an abstract representation of the projection's current derived state — it may be implemented as in-memory state, persisted database rows (deleted and reinserted, as the server-side implementation below does), or another projection-specific representation. WAFI-151 does not constrain how a given projection stores its state, only that the same `applyEvent` logic produces it whether called incrementally or during replay.

```
                 AUTHORITATIVE EVENT LOG
                         │
                         ▼
              applyEvent(event, state)
                    /           \
                   /             \
          Incremental            Replay
             │                     │
             ▼                     ▼
       Existing projection    Empty projection
                                   │
                                   ▼
                              Reconstructed
                                   │
                         ┌─────────┴─────────┐
                         ▼                   ▼
                    PostgreSQL            SQLite
                    projection           projection
```

The full guarantee is: **incremental processing and replay consume the same authoritative events, through the same handler, in the same canonical ordering.** All three conditions are required together — no single one is sufficient on its own — for "incremental == replay" to hold. Additional supporting requirements: idempotency/duplicate handling where applicable, and projection handlers whose semantics are valid under the canonical ordering (see below).

**Incremental path must actually satisfy this, not just be assumed to.** The event bus is at-least-once; the incremental path needs explicit dedup or the invariant above doesn't hold in practice. This ticket does not need to build that from scratch — the existing durable subscriber machinery (`runDurableSubscriber.ts`, ledger table `local_subscriber_processed_events`) already gives at-least-once + idempotent + retry-safe delivery. WAFI-151 extends that existing mechanism rather than replacing it — but with one important correction from an earlier draft of this spec:

**Skip logic must be per-event-ID, never a high-water `sequence` mark.** An earlier version of this design proposed "track the max applied `sequence` as a checkpoint, skip anything at or below it." That is unsafe, precisely because of the property already documented above: **sequence allocation order and commit order can differ.** Concretely: event A allocates `sequence=105` and event B allocates `sequence=106`, but B commits first. If the incremental path applies B and advances a high-water checkpoint to 106, then when A commits and arrives with `sequence=105 <= 106`, the checkpoint rule would skip it — permanently losing event A. This is not a rare edge case; it's the direct, inevitable consequence of a documented property of `sequence`, so the design must not rely on a mechanism that assumes the opposite.

The correct mechanism:

- **Processed-event identity is `(projection_name, event_id)`**, not event ID alone — the same event can feed multiple projections (e.g. a `sale.completed` event affects both `daily_event_counts` and, eventually, other WAFI-153 read models), and each projection's "have I applied this?" state must be tracked independently. If the existing `local_subscriber_processed_events` ledger's schema differs, this is the logical identity it must preserve, not a literal column prescription. A successful application records that exact `(projection_name, event_id)` pair; ledger entries are never shared across projections.
- The existing processed-event ledger (keyed by this `(projection_name, event_id)` identity, not by sequence) is the sole source of truth for "has this event been applied to this projection scope?" Incremental processing checks the ledger by that identity before applying, not a sequence threshold. Re-delivery of an already-applied event is a no-op, exactly as the existing durable-subscriber machinery already guarantees.
- `sequence` is used only to *order* replay/application deterministically where multiple events are visible at once — never to *decide whether to skip* an event. A lower-sequence event that becomes visible after a higher-sequence event has already been applied is still applied, exactly once, keyed by its own event ID.
- Rebuild records, in the same ledger, exactly the event IDs it applied — no more, no less. Rebuild does not advance any broader high-water mark; it only marks the specific events it replayed as processed for that scope.
- The lock described under Concurrency (below) serializes *projection mutation* for a scope. It does **not** prevent new events from being inserted into `events` during a rebuild — that's fine, because correctness no longer depends on the rebuild seeing every event that will ever exist. Any event not seen by the rebuild simply isn't marked processed, and subsequent incremental processing (checking the ledger by ID) applies it normally, once, whenever it becomes visible.
- Replaying an already-applied event ID incrementally, after a rebuild, must be a no-op — this is an acceptance criterion (see below), verified directly against the ledger.
- **Existing installations:** `daily_event_counts` and `local_today_revenue_projection` predate this ledger-based skip logic. Rollout must establish a safe starting ledger state — either by treating all events currently reflected in existing projection state as already-processed (backfilling ledger entries to match), or by forcing one rebuild per existing scope before ledger-based incremental skip logic is relied upon. Without this, existing projection state and a freshly-empty ledger would cause incremental processing to reapply already-counted events and double-count.

## Canonical Replay Ordering

`events.id` is a `uuid` with no monotonic sequence. `occurred_at` is a business/domain timestamp that can collide or skew for offline-authored events and must not be used as a replay-ordering key.

**Decision:** Add `events.sequence BIGINT NOT NULL UNIQUE`, server-assigned for every newly inserted event, unique and totally ordered. Replay uses `ORDER BY sequence ASC`.

- `sequence` gives a stable, deterministic total order for replay. It is **not** claimed to represent literal database commit order or true causal order — under concurrent transactions, sequence allocation order and commit order can differ. What matters is that it is unique, stable, and total — not gaplessness or causal fidelity. **Because allocation can precede commit, a lower-sequence event can become visible after a higher-sequence event has already committed and been applied.** The incremental and rebuild application logic (see Core Architectural Invariant) is designed to tolerate this without losing events — by keying "already applied" on event ID via the processed-event ledger, never on a `sequence` threshold.
- `occurred_at` remains the business timestamp for display/reporting and is never used for replay ordering.
- Migration `083` backfills `sequence` for existing rows using a documented, deterministic ordering: `created_at ASC`, then `id ASC` as tiebreak for exact duplicate timestamps. This establishes a canonical replay order for historical events; it does **not** claim to reconstruct true historical causal order. The migration must guarantee: no `NULL` sequence values (backfill runs before `NOT NULL` is enforced), no duplicate sequence values, and that events inserted concurrently with the backfill do not end up unsafely interleaved with historical rows in a way that matters for the projections in scope — since both current projections are commutative aggregates, exact interleaving between old and new rows during the migration window is acceptable, but this assumption is explicit and does not carry over to future order-sensitive projections. The migration must also account for client-side schema/sync coordination (PowerSync schema update, local SQLite migration, sync rule update) as part of the same rollout, not discovered afterward. The choice of `GENERATED ALWAYS AS IDENTITY` vs `GENERATED BY DEFAULT AS IDENTITY` is left to whichever the backfill mechanics require.
- Projection handlers must be correct under this ordering. Commutative aggregation (e.g. summing revenue) is safe regardless of order. Any projection whose correctness depends on event order (e.g. a state machine like `sale.completed` → `sale.refunded`) must not rely on `occurred_at` for that ordering — WAFI-151 only guarantees `sequence`-based determinism, and any such projection's handler must be written to be correct under `sequence` order specifically.
- `sequence` is server-assigned insertion order, **not business-causal order**. An offline-authored event can sync and receive its `sequence` after a later-occurring event's. WAFI-151 proves rebuild correctness only for projections that are safe under `sequence` order — the two projections in scope here are both commutative aggregates (counts, revenue sums), so this holds. **Future projections (WAFI-153+) whose correctness depends on business causality, aggregate lifecycle state, or event precedence must not assume `sequence` is causal order** unless the event log also captures explicit causal metadata (aggregate version, causation IDs, or predecessor relationships) — that metadata does not exist today and is not built by this ticket.
- `events.sequence` must be included in the PowerSync sync payload and the local SQLite schema. Client-side replay uses `ORDER BY sequence ASC` exactly like server-side replay — an event in scope that lacks a server-assigned `sequence` (e.g. a locally-authored, not-yet-synced event) must not be silently replayed; the rebuild aborts instead (see coverage check below).

## Server-Side Implementation (Postgres — primary mechanism)

**Trigger:** `scripts/projections/rebuild.ts`, invoked via:

```
npm run projections:rebuild -- <projection> --shop <shop_id> --from <date> --to <date>
npm run projections:rebuild -- <projection> --all
```

- Scoped rebuild (shop + date range) is the default and expected operational mode ("shop X's numbers look wrong, fix just that").
- `--all` is explicit and required for full-history, all-shop rebuilds (used for projection algorithm changes / migrations). Making this explicit is deliberate: accidentally running a global rebuild should be harder than running a scoped one.
- The CLI calls the same canonical replay/projection logic used elsewhere — never a one-off hand-written SQL script duplicating projection logic.

**Defining "relevant events" — resolved to a single stored column, not handler-specific logic.** For the two projections in scope, **each event type affects exactly one projection day, and that day is the shop-local calendar date of `occurred_at`.** Neither `daily_event_counts` nor `local_today_revenue_projection` currently attributes an event's effect to a day other than its own occurrence day (e.g. a refund is not currently attributed back to the original sale's day) — this ticket does not change that domain behavior, only makes its day-bucketing deterministic and rebuild-safe. **Cross-day effect attribution (e.g. a refund crediting back to the sale's day) is out of scope for WAFI-151** and, if the domain ever requires it, is a WAFI-153+ concern requiring its own handler-level design — not something the generic rebuild engine tries to infer.

Given that, "relevant events" for a scoped rebuild of projection P for shop S and date range `[from, to]` means: *all events for shop S whose `event_projection_day` falls within [from, to]*. Rebuild selection is a single-column range query (`WHERE shop_id = S AND event_projection_day BETWEEN from AND to`), not per-projection custom relevance logic — this keeps the rebuild engine simple and is only safe because of the one-event-one-day constraint just stated.

**`event_projection_day` — new column, needs its own migration step within `083` (or a follow-up migration in the same rollout), not implied by adding `sequence` alone:**
- Added as `events.event_projection_day DATE`, computed and persisted **at event write time** from `occurred_at` + the shop's timezone at that moment — never re-derived at replay time from current shop timezone metadata, so a later shop timezone change cannot silently shift which day historical events replay into.
- **Historical backfill caveat, stated explicitly rather than assumed:** for existing rows, `event_projection_day` is backfilled using the best-available shop timezone data — the shop's current timezone, since no historical timezone snapshot is stored today. This is an accepted **data-quality limitation** for pre-existing events, not something commutativity makes "safe" — commutativity protects the aggregate's internal consistency under a given day assignment, it does not make a wrong day assignment correct. In the rare case a shop's timezone changed historically, a backfilled event could land on a different calendar day than it historically occurred on, for both the day it moves from and the day it moves to. The resulting `event_projection_day` is deterministic and stable *after* backfill (replaying it always produces the same day), which is what this ticket needs — it is not a claim of historical accuracy. New events, from this migration forward, use the shop's timezone in effect at event creation time, so this limitation applies only to the historical backfill window, not going forward.
- Must be `NOT NULL` for all projected event types once backfilled.
- Must be included in the PowerSync sync payload and local SQLite schema, and used by client-side replay for day attribution identically to server-side replay — otherwise server and client can silently disagree about which day an event belongs to.
- `daily_event_counts.day` is keyed by this same `event_projection_day`, not by a separate `occurred_at`-derived day — one canonical day-bucketing definition used everywhere (replay, incremental processing, the aggregate projection, and the client coverage check below), not several that can drift apart.

**Indexes:** a scoped rebuild's replay query and lock duration depend on an index on `events (shop_id, event_projection_day, sequence)` (or equivalent) server-side, and the corresponding local index client-side — noted here because it affects both correctness-adjacent concerns (lock hold time) even though the exact index definition is an implementation detail.

**Execution (batched, per-scope transactions):**
1. Resolve the concrete scope(s) to rebuild — for a single shop+range, one scope; for `--all`, this expands to one scope per shop (see below).
2. For each scope, in its own transaction: `BEGIN` → delete rows in that scope → replay relevant events `ORDER BY sequence ASC` through the shared `applyEvent` handler → validate lightweight invariants (projection-specific — see below) → `COMMIT` on success, `ROLLBACK` on any replay/validation failure, leaving that scope's previous state fully intact.
3. Progress and per-scope success/failure are logged; a failure in one scope does not abort scopes already committed, and the CLI reports which scopes succeeded/failed for retry.

Postgres transaction isolation means readers observe either the old projection or the new one for a given scope — never a partially rebuilt state.

**`--all` is a batch of scoped rebuilds, not one global transaction.** A single all-shop, full-history transaction risks long-running-transaction lock contention, WAL bloat, and an unrecoverable multi-hour rollback on failure. `--all` iterates shops and rebuilds each shop's full history as its own transaction under the same locking protocol as a manual scoped rebuild. For a shop with a very large event history, a single shop-wide transaction can itself still become large; the CLI should support further chunking by date range (e.g. per month) as needed, with per-chunk progress reporting, so implementation isn't forced into one all-or-nothing transaction per shop if volume makes that impractical. A true single-transaction global rebuild with atomic all-or-nothing semantics across the whole system is not built by this ticket; it would require the staging-table/atomic-swap strategy already deferred above.

**Validation invariants are projection-specific**, not one generic rule. For `daily_event_counts`: one row per (shop, day); `count` equals the number of replayed events for that key; `count >= 0` unless a future event type explicitly represents a negative adjustment. Each projection handler declares its own invariants — "no negative counts" is not asserted generically where a projection's domain allows it.

**Concurrency:** Rebuild and incremental subscriber writes for the same projection scope participate in the **same locking protocol.** It is not sufficient for rebuild alone to take a lock — the existing subscriber write path for that projection/scope must acquire the identical lock, or a concurrent incremental write can silently race with an in-progress rebuild and produce an inconsistent result.

The invariant is: **a projection scope cannot be rebuilt concurrently with an incremental projection update for that same scope** — this lock serializes *projection mutation*, preventing a rebuild's delete-and-reinsert from interleaving with an incremental subscriber's write to the same rows. **The lock does not, and does not need to, prevent new rows from being inserted into `events` during a rebuild.** That's a direct consequence of the ledger-based fix above: since correctness no longer depends on the rebuild seeing every event that will ever exist (only on marking exactly what it did apply), an event inserted during or after the rebuild's snapshot is simply picked up by subsequent incremental processing — checked against the ledger by ID, applied once, whenever it becomes visible. There is no scenario where such an event is silently lost, because nothing in this design advances a marker past events it hasn't actually seen.

**Lock granularity: shop+projection, not shop+day+projection.** A per-day lock would require rebuilds spanning multiple days to acquire many locks, which then needs a deterministic acquisition order to avoid deadlocking against incremental writers touching different days in a different order — solvable, but more machinery than a 1-sprint ticket needs. Instead, a scoped rebuild acquires a single Postgres transaction-scoped advisory lock keyed by `(shop_id, projection_name)` for its entire transaction, covering its whole requested date range; incremental writes to that projection for that shop take the same lock. This trades a small amount of concurrency (an incremental write for shop X is briefly blocked while any rebuild for shop X/that projection is running, even for a different day) for a lock protocol simple enough to verify correctness of in one sprint, with no deadlock-ordering logic required. Lock acquisition uses a bounded wait timeout; on timeout, the rebuild fails fast with a clear operator message rather than blocking normal writes indefinitely.

**Shared handler, avoiding server/client drift:** Postgres and SQLite are different runtime environments, and independently-written "equivalent" logic on each side is a real drift risk (date/timezone handling, numeric rounding, null handling). All monetary values are represented as integer minor units (or fixed-precision, never floating point) specifically so that server (Postgres) and client (SQLite) replay of the same events cannot diverge due to rounding. Where the `applyEvent` handler logic itself cannot be literally shared across the two runtimes, both implementations must be verified against the same fixture-based contract tests (same event fixtures in, same expected projection state out, run against both the Postgres and SQLite implementations) rather than relying on independent review to keep them in sync.

**Explicitly not built in this ticket:** staging-table + atomic-swap rebuilds. Deferred until projection size/rebuild duration make in-place transactional rebuild impractical.

## Client-Side Implementation (SQLite/PowerSync)

**Sync-stream change:** Add `events` and `daily_event_counts` to the PowerSync sync stream in `powersync.yaml`. Both are already present in the Postgres publication and the PowerSync client schema (`src/data/powersync/schema.ts`) — only the sync-rule query is missing today. The sync rule syncs only what `local_today_revenue_projection` actually needs — the event subset and window already established by that projection's existing "today" scope — not the shop's full historical event log. The client rebuild contract is correspondingly limited to scopes within that sync window; requesting a rebuild outside it fails the coverage check by design, not as an edge case to special-case later.

**Event schema versioning:** `events.payload_version` already exists on the event envelope. This ticket does not add an upcasting framework — an unrecognized `payload_version` causes a **loud failure in both paths**: rebuild fails replay/validation for the affected scope, and incremental processing fails/quarantines that event, rather than silently applying it under wrong assumptions. Neither path silently skips an event the other path fails on — that asymmetry would itself be a drift source. Building general upcasting is deferred (see Follow-ups).

**Security acceptance criterion (not just plumbing):** the sync rule for both tables must be shop-scoped, matching the pattern used by every other table in the `shop_data` stream. Adding these tables to sync must not expose events belonging to other shops and must not weaken any existing server-side authorization (RLS or otherwise).

**Coverage check (required before any client rebuild):** an offline-first client may not have the complete event history for a requested scope due to sync timing. A rebuild must not silently produce an incomplete projection and report success.

**Architectural invariant (not an assumption):** `daily_event_counts` is defined as the server-authoritative count of the exact event subset required by `local_today_revenue_projection`, keyed by `(shop_id, day)`. This must hold by construction — the projection that populates `daily_event_counts` and the projection logic for `local_today_revenue_projection` must be counting the same event subset — otherwise the coverage check below is meaningless.

- The client coverage check compares its local count of that exact event subset against this authoritative count: `local COUNT(*) == daily_event_counts(shop_id, day)`. Plain `COUNT(*)` is sufficient here — `events.id` is the local SQLite primary key, so duplicate local rows for the same event cannot exist by construction; `COUNT(DISTINCT id)` would add no additional guarantee.
- **This is honestly a cardinality check against the last-synced authoritative count, not a mathematical proof of set equality.** It relies on `daily_event_counts` itself being current (see dependency note below) and does not detect a missing-plus-extra-event pair that happens to cancel out exactly. A stronger guarantee — e.g. a synced checksum/hash of the event set, or a `last_event_sequence` watermark on `daily_event_counts` — is a reasonable future improvement (see Follow-ups) but is not built in this ticket. The CLI output reports the rebuild as "coverage check passed against the synced count as of last sync," not as "coverage proven," to avoid overstating the guarantee.
- **A missing `daily_event_counts` row for the requested day is treated as coverage-unavailable, not as an authoritative zero.** If the row simply hasn't synced yet, treating its absence as "zero events" would let a rebuild silently and incorrectly "pass" against local event count zero. Coverage passes only when a `daily_event_counts` row is present and matches — never inferred from absence. (Materializing explicit zero-count rows for empty-but-synced days is a possible future refinement if this proves too strict in practice; not built in this ticket.)
- **Local events without a server-assigned `sequence` (not-yet-synced, locally-authored events) in the requested scope are treated as a coverage failure**, not silently included or silently excluded — the rebuild aborts rather than replaying a set that mixes sequenced and unsequenced events.
- **Match** → coverage check passes, rebuild proceeds via the shared `applyEvent` handler.
- **Mismatch, missing authoritative row, or unsequenced local events present** → rebuild aborts, no projection changes are made, and the operator is told sync is incomplete and to retry after resyncing.
- No indefinite waiting inside the rebuild command. No best-effort/partial reconstruction mode — a command called "rebuild" must not claim success without a passed coverage check. (A separate approximate/preview reconstruction mode is explicitly out of scope.)
- **"Today" is the shop's current `event_projection_day` (shop-local), not the device's local calendar day.** A device timezone differing from the shop's would otherwise create an inconsistency between what the client considers "today" and how events are actually day-bucketed everywhere else in this design.

**Dependency on `daily_event_counts` correctness:** the client coverage check is only as trustworthy as the server-side `daily_event_counts` value it compares against. If server-side corruption of `daily_event_counts` is suspected, the server-side projection should be rebuilt first — the client coverage check does not independently verify server-side correctness, and this ticket does not add a mechanism to detect that corruption itself (see Follow-ups).

**Client-side concurrency:** client rebuild runs inside an exclusive local transaction, uses the same local `applyEvent` handler as incremental processing, and records the same local processed-event ledger entries (see Core Architectural Invariant) so that incremental processing after a rebuild treats the events the rebuild applied as already-applied by ID, not by any sequence threshold. SQLite's single-writer model means the rebuild transaction and any concurrent local incremental write cannot physically interleave; the ledger update at the end of the rebuild transaction is what prevents subsequent incremental processing from redoing work.

`local_today_revenue_projection`'s existing informal "best-effort, rebuild-from-source-if-wrong" behavior for *normal* incremental operation is unchanged by this ticket — the stricter coverage requirement applies specifically to the explicit rebuild command.

## Trigger Surface

Engineer-invoked CLI/dev-tooling only, for both server and client rebuilds. No admin UI, no customer-facing control, and no automatic corruption detection or self-healing in this ticket. This keeps WAFI-151 scoped to proving the rebuild primitive is correct; an admin UI or automatic drift detection can be built on top of it later once the primitive is trusted.

## Out of Scope

- New WAFI-153 read model tables (`dashboard_metrics`, `profit_cache`, `inventory_summary`, `customer_summary`, `staff_summary`)
- Staging-table + atomic-swap rebuild strategy
- Automatic corruption/drift detection
- Admin UI or any customer-facing rebuild trigger
- Best-effort/partial client-side rebuild mode

## Acceptance Criteria

1. `daily_event_counts` for a given shop + date range can be deleted and deterministically rebuilt to the same state via the CLI.
2. `local_today_revenue_projection` rebuilds successfully when the coverage check passes, and safely refuses (no changes, clear message) when it does not — including when in-scope local events are missing a server-assigned `sequence`, and when the authoritative `daily_event_counts` row for the requested day is absent (treated as unavailable, not zero).
3. Rebuild and normal incremental processing produce identical results for the same event set (proves no drift between the two code paths), including after both have run against the same events in either order.
4. Replaying an already-applied event ID incrementally, after a rebuild has recorded it in the processed-event ledger, is a no-op — verified directly against the ledger, not just inferred from general idempotency.
5. **An event whose `sequence` is lower than an already-applied event's, but which becomes visible only after that later event has committed, is still applied exactly once** — verified with a test that commits events out of sequence order and asserts neither is skipped nor double-applied. This directly tests the fix for the allocation-vs-commit-order race described above.
6. Concurrent incremental writes to a shop being rebuilt cannot corrupt the result — verified under the shared shop+projection locking protocol; a rebuild that cannot acquire its lock within the bounded timeout fails fast with a clear message rather than blocking writes indefinitely.
7. A failed rebuild (replay or validation failure) leaves the target projection **and its processed-event ledger entries** completely unchanged — verified by capturing the exact pre-rebuild state of both, forcing a replay/validation failure, and asserting the post-rebuild state is identical to what was captured (not merely "some rows still exist").
8. A failed client-side rebuild leaves the local projection and local ledger entries exactly as they were before the rebuild started (client-side equivalent of #7).
9. **Rebuilding a subset of days for a shop does not mark events processed for, or otherwise affect, other days** — verified by rebuilding one day and confirming an unrelated day's projection and ledger entries are untouched.
10. PowerSync sync rules for `events` and `daily_event_counts` are shop-scoped — a device cannot sync another shop's events or another shop's daily counts (security test).
11. Migration `083` adds `events.sequence` and `events.event_projection_day`, backfills both deterministically (`sequence` via `created_at ASC, id ASC`; `event_projection_day` via `occurred_at` + best-available shop timezone) with no null or duplicate `sequence` values, and replay uses `ORDER BY sequence ASC` exclusively, never `occurred_at`, for ordering. Both columns are present in the PowerSync sync payload and local SQLite schema, and client-side replay uses both identically to server-side replay.
12. A scoped rebuild for (shop, day) includes exactly the events whose `event_projection_day` falls in the requested range, regardless of the event's own `occurred_at` timestamp — verified with a fixture where an event's `occurred_at` falls outside the requested range but its `event_projection_day` (set at write time) falls inside it.
13. `--all` executes as a batch of independently-transactional per-shop (and, where chunked, per-date-range) rebuilds (verified: a forced failure on one shop's scope does not roll back or block already-committed scopes for other shops).
14. An event with an unsupported `payload_version` causes **both** rebuild and incremental processing to fail loudly without partially mutating projection state or ledger entries in either path.
15. After the ledger-initialization step (see Core Architectural Invariant): replaying any pre-existing event through the normal incremental path produces no projection mutation and no duplicate aggregation (it's already represented in both the projection and the ledger), while processing a newly-created event after rollout still applies exactly once (it isn't yet represented in either).
16. Server (Postgres) and client (SQLite) implementations of the shared `applyEvent` contract pass the same fixture-based contract tests, covering at minimum: duplicate delivery, out-of-order sequence visibility (per #5), timezone/DST boundary events, and unsupported `payload_version`.

## Follow-ups / Not This Ticket

Explicitly deferred — real improvements, not required to prove the recovery contract for the two projections in scope:

- **Stronger coverage proof:** a synced checksum/hash of the event set, or a `last_event_sequence` watermark on `daily_event_counts`, so the client coverage check is closer to a proof of set equality than a cardinality check.
- **Server-side corruption detection for `daily_event_counts` itself:** today the client coverage check trusts it; nothing here verifies *it's* correct.
- **General event schema upcasting framework** beyond "fail loudly on an unrecognized `payload_version`."
- **Dry-run mode** (`--dry-run`): compute and report the replay result and diff against current state without mutating anything.
- **Rebuild summary/observability output:** projection name/version, scope, event count, min/max sequence replayed, rows changed, validation results, duration, ledger entry count before/after.
- **Admin UI or automatic drift/corruption detection**, and any customer-facing surface — this ticket is CLI-only by design.
- **Staging-table + atomic-swap rebuild** for large projections where in-place transactional rebuild becomes impractical.
- **Event log erasure/GDPR strategy:** the event log is assumed append-only and never mutated or deleted, which this ticket's rebuildability guarantee depends on. If erasure requirements ever apply to event payloads, that needs its own design — deleting events breaks rebuildability for anything downstream.
- **Cross-day event effect attribution** (e.g. a refund crediting back to the original sale's day rather than its own occurrence day) — the two projections in scope don't need this today; if a future projection does, it's a WAFI-153+ handler-level design question, not a generic rebuild-engine feature.
- **Historical timezone snapshots for exact `event_projection_day` backfill accuracy** — this ticket backfills using best-available (current) shop timezone data; storing point-in-time timezone snapshots for perfect historical accuracy is deferred.
- **Materialized zero-count `daily_event_counts` rows** for empty-but-synced days, if the "missing row = coverage unavailable" rule proves too strict operationally.

## Risk Notes

| Risk | Mitigation |
|---|---|
| Read model corruption without recovery path | This ticket exists to close that gap (per plan risk register, WAFI-151 is P1 not P2) |
| Rebuild and incremental logic drift apart over time | Shared `applyEvent` handler is the single source of truth for both paths; cross-runtime (Postgres/SQLite) drift caught by shared fixture-based contract tests |
| A high-water `sequence` checkpoint permanently skips an event whose sequence was allocated before, but committed after, an already-applied higher-sequence event | Skip logic is keyed on event ID via the existing processed-event ledger, never on a `sequence` threshold; `sequence` is used only for ordering, never for skip decisions |
| Incremental subscriber processes events out of order or reprocesses them | Existing durable-subscriber ledger is the source of truth for "already applied," checked by event ID; re-delivery of an already-applied ID is a no-op |
| Scoped rebuild silently misses events that affect the target day from outside the requested date range | "Relevant events" resolved to a single stored column, `event_projection_day`, set at write time; cross-day attribution explicitly out of scope for the two projections here |
| `event_projection_day` computed inconsistently between server and client, or between replay and the aggregate projection | One canonical column, backfilled deterministically, synced to the client, used identically by `daily_event_counts`, server replay, and client replay |
| Client coverage check passes against a stale server-side count, or a missing row is mistaken for an authoritative zero | Coverage check explicitly documented as a cardinality check against the last-synced count, not a proof of completeness; a missing `daily_event_counts` row is treated as unavailable, never as zero |
| Offline/pending local events lack a server-assigned sequence | Rebuild aborts if any in-scope local event lacks `sequence`, rather than silently including or excluding it |
| Long-running global rebuild blocks writes / risks partial multi-hour rollback | `--all` is a batch of independently-transactional per-shop (and, if needed, per-date-range) rebuilds, never one global transaction |
| Rebuild races with concurrent incremental writes to the same scope | Shared shop+projection locking protocol between rebuild and subscriber write paths, serializing projection mutation (not event insertion — see Concurrency) |
| Money/rounding differences between Postgres and SQLite replay | Monetary values are integer minor units (or fixed-precision), never floating point |
| Migration 083 backfill interleaves old/new sequence values unsafely | Deterministic backfill order, `NOT NULL`/`UNIQUE` enforced only after backfill completes; interleaving is explicitly acceptable only because both current projections are commutative |
| Adding `events`/`daily_event_counts` to sync stream weakens shop isolation or over-syncs event history | Shop-scoped sync rule is a stated acceptance criterion, tested explicitly; sync scope limited to what `local_today_revenue_projection` already needs |
| Existing installations have projection state but no ledger entries, causing double-counting once ledger-based skip logic is enabled | Rollout backfills ledger entries to match existing projection state, or forces one rebuild per existing scope, before relying on ledger-based skip logic |
| Rebuild and incremental processing disagree on how to handle an unsupported `payload_version` | Both paths fail loudly on the same condition; neither silently skips what the other fails on |
