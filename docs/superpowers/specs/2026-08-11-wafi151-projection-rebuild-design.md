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

Both incremental (normal) processing and rebuild use the same version-controlled `applyEvent(event, projectionState)` handler per projection type. Rebuild is simply running `applyEvent` over the complete ordered event set, starting from an empty projection state, instead of once per incoming event.

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

**Incremental path must actually satisfy this, not just be assumed to.** The event bus is at-least-once; the incremental path needs explicit ordering and dedup or the invariant above doesn't hold in practice. This ticket does not need to build that from scratch — the existing durable subscriber machinery (`runDurableSubscriber.ts`, ledger table `local_subscriber_processed_events`) already gives at-least-once + idempotent + retry-safe delivery. WAFI-151 extends that existing mechanism rather than replacing it:

- Each projection's checkpoint (last successfully-applied `events.sequence` per scope) is tracked alongside the existing processed-event ledger.
- Incremental processing consumes events in `sequence` order and skips anything at or below the current checkpoint for that scope — re-delivery of an already-applied event is a no-op.
- A successful rebuild updates the checkpoint to the max replayed `sequence` for that scope, so subsequent incremental processing continues from there without reprocessing events the rebuild already covered.
- Replaying an already-applied event incrementally, after a rebuild, must be a no-op — this is an acceptance criterion (see below), not just a design aspiration.

## Canonical Replay Ordering

`events.id` is a `uuid` with no monotonic sequence. `occurred_at` is a business/domain timestamp that can collide or skew for offline-authored events and must not be used as a replay-ordering key.

**Decision:** Add `events.sequence BIGINT NOT NULL UNIQUE`, server-assigned for every newly inserted event, unique and totally ordered. Replay uses `ORDER BY sequence ASC`.

- `sequence` gives a stable, deterministic total order for replay. It is **not** claimed to represent literal database commit order or true causal order — under concurrent transactions, sequence allocation order and commit order can differ. What matters is that it is unique, stable, and total — not gaplessness or causal fidelity.
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

**Defining "relevant events" (must be explicit, not left to `occurred_at`):** for a scoped rebuild of projection P for shop S and date range `[from, to]`, "relevant" means *all events that can affect a projection row for (S, day) where day falls within [from, to]* — regardless of the event's own `occurred_at`. A rebuild that filters only by `occurred_at` within `[from, to]` would silently miss cross-day effects (e.g. a refund `occurred_at` several days after the sale it reduces, if the domain rule attributes the refund's effect back to the sale's day). Each projection's handler defines which events affect which day — this is domain logic that lives in the handler, not a generic date filter in the rebuild engine.

To make "day" itself deterministic and immune to timezone/DST drift, each event carries an immutable `event_projection_day` (derived once, at write time, from `occurred_at` + the shop's timezone at that moment) rather than being re-derived at replay time from current shop timezone metadata. This means a later shop timezone change cannot silently change which day historical events replay into.

**Execution (batched, per-scope transactions):**
1. Resolve the concrete scope(s) to rebuild — for a single shop+range, one scope; for `--all`, this expands to one scope per shop (see below).
2. For each scope, in its own transaction: `BEGIN` → delete rows in that scope → replay relevant events `ORDER BY sequence ASC` through the shared `applyEvent` handler → validate lightweight invariants (projection-specific — see below) → `COMMIT` on success, `ROLLBACK` on any replay/validation failure, leaving that scope's previous state fully intact.
3. Progress and per-scope success/failure are logged; a failure in one scope does not abort scopes already committed, and the CLI reports which scopes succeeded/failed for retry.

Postgres transaction isolation means readers observe either the old projection or the new one for a given scope — never a partially rebuilt state.

**`--all` is a batch of scoped rebuilds, not one global transaction.** A single all-shop, full-history transaction risks long-running-transaction lock contention, WAL bloat, and an unrecoverable multi-hour rollback on failure. `--all` iterates shops (and, within a shop, date ranges as needed) and rebuilds each as its own transaction under the same locking protocol as a manual scoped rebuild. A true single-transaction global rebuild with atomic all-or-nothing semantics is not built by this ticket; it would require the staging-table/atomic-swap strategy already deferred above.

**Validation invariants are projection-specific**, not one generic rule. For `daily_event_counts`: one row per (shop, day); `count` equals the number of replayed events for that key; `count >= 0` unless a future event type explicitly represents a negative adjustment. Each projection handler declares its own invariants — "no negative counts" is not asserted generically where a projection's domain allows it.

**Concurrency:** Rebuild and incremental subscriber writes for the same projection scope participate in the **same locking protocol.** It is not sufficient for rebuild alone to take a lock — the existing subscriber write path for that projection/scope must acquire the identical lock, or a concurrent incremental write can silently race with an in-progress rebuild and produce an inconsistent result.

This also closes a subtler race: without a shared lock, an event could be committed by an incremental write *during* a rebuild's replay window, after the rebuild has already read its event snapshot — producing a "successful" rebuild that silently omits that event. The invariant is: **a projection scope cannot be rebuilt concurrently with an incremental projection update for that same scope.**

**Lock granularity: shop+projection, not shop+day+projection.** A per-day lock would require rebuilds spanning multiple days to acquire many locks, which then needs a deterministic acquisition order to avoid deadlocking against incremental writers touching different days in a different order — solvable, but more machinery than a 1-sprint ticket needs. Instead, a scoped rebuild acquires a single Postgres transaction-scoped advisory lock keyed by `(shop_id, projection_name)` for its entire transaction, covering its whole requested date range; incremental writes to that projection for that shop take the same lock. This trades a small amount of concurrency (an incremental write for shop X is briefly blocked while any rebuild for shop X/that projection is running, even for a different day) for a lock protocol simple enough to verify correctness of in one sprint, with no deadlock-ordering logic required. Lock acquisition uses a bounded wait timeout; on timeout, the rebuild fails fast with a clear operator message rather than blocking normal writes indefinitely.

**Shared handler, avoiding server/client drift:** Postgres and SQLite are different runtime environments, and independently-written "equivalent" logic on each side is a real drift risk (date/timezone handling, numeric rounding, null handling). All monetary values are represented as integer minor units (or fixed-precision, never floating point) specifically so that server (Postgres) and client (SQLite) replay of the same events cannot diverge due to rounding. Where the `applyEvent` handler logic itself cannot be literally shared across the two runtimes, both implementations must be verified against the same fixture-based contract tests (same event fixtures in, same expected projection state out, run against both the Postgres and SQLite implementations) rather than relying on independent review to keep them in sync.

**Explicitly not built in this ticket:** staging-table + atomic-swap rebuilds. Deferred until projection size/rebuild duration make in-place transactional rebuild impractical.

## Client-Side Implementation (SQLite/PowerSync)

**Sync-stream change:** Add `events` and `daily_event_counts` to the PowerSync sync stream in `powersync.yaml`. Both are already present in the Postgres publication and the PowerSync client schema (`src/data/powersync/schema.ts`) — only the sync-rule query is missing today. The sync rule syncs only what `local_today_revenue_projection` actually needs — the event subset and window already established by that projection's existing "today" scope — not the shop's full historical event log. The client rebuild contract is correspondingly limited to scopes within that sync window; requesting a rebuild outside it fails the coverage check by design, not as an edge case to special-case later.

**Event schema versioning:** `events.payload_version` already exists on the event envelope. This ticket does not add an upcasting framework — a `payload_version` the current handler doesn't recognize causes the rebuild to fail loudly rather than guess at how to interpret it. Building general upcasting is deferred (see Follow-ups).

**Security acceptance criterion (not just plumbing):** the sync rule for both tables must be shop-scoped, matching the pattern used by every other table in the `shop_data` stream. Adding these tables to sync must not expose events belonging to other shops and must not weaken any existing server-side authorization (RLS or otherwise).

**Coverage check (required before any client rebuild):** an offline-first client may not have the complete event history for a requested scope due to sync timing. A rebuild must not silently produce an incomplete projection and report success.

**Architectural invariant (not an assumption):** `daily_event_counts` is defined as the server-authoritative count of the exact event subset required by `local_today_revenue_projection`, keyed by `(shop_id, day)`. This must hold by construction — the projection that populates `daily_event_counts` and the projection logic for `local_today_revenue_projection` must be counting the same event subset — otherwise the coverage check below is meaningless.

- The client coverage check compares its local count of that exact event subset against this authoritative count: `local COUNT(DISTINCT id) == daily_event_counts(shop_id, day)`.
- `COUNT(DISTINCT id)` is required, not plain `COUNT(*)` — a duplicated local row and a missing event can otherwise cancel out and produce a matching count while coverage is still incomplete. `events.id` is the local primary key, so distinctness is enforced by the schema; the check still uses `DISTINCT` explicitly rather than relying on that as an invisible precondition.
- **This is honestly a cardinality check against the last-synced authoritative count, not a mathematical proof of set equality.** It relies on `daily_event_counts` itself being current (see dependency note below) and does not detect a missing-plus-extra-event pair that happens to cancel out exactly. A stronger guarantee — e.g. a synced checksum/hash of the event set, or a `last_event_sequence` watermark on `daily_event_counts` — is a reasonable future improvement (see Follow-ups) but is not built in this ticket. The CLI output reports the rebuild as "coverage check passed against the synced count as of last sync," not as "coverage proven," to avoid overstating the guarantee.
- **Local events without a server-assigned `sequence` (not-yet-synced, locally-authored events) in the requested scope are treated as a coverage failure**, not silently included or silently excluded — the rebuild aborts rather than replaying a set that mixes sequenced and unsequenced events.
- **Match** → coverage check passes, rebuild proceeds via the shared `applyEvent` handler.
- **Mismatch, unavailable, or unsequenced local events present** → rebuild aborts, no projection changes are made, and the operator is told sync is incomplete and to retry after resyncing.
- No indefinite waiting inside the rebuild command. No best-effort/partial reconstruction mode — a command called "rebuild" must not claim success without a passed coverage check. (A separate approximate/preview reconstruction mode is explicitly out of scope.)

**Dependency on `daily_event_counts` correctness:** the client coverage check is only as trustworthy as the server-side `daily_event_counts` value it compares against. If server-side corruption of `daily_event_counts` is suspected, the server-side projection should be rebuilt first — the client coverage check does not independently verify server-side correctness, and this ticket does not add a mechanism to detect that corruption itself (see Follow-ups).

**Client-side concurrency:** client rebuild runs inside an exclusive local transaction, uses the same local `applyEvent` handler as incremental processing, and updates the same local checkpoint metadata (see Core Architectural Invariant) so that incremental processing after a rebuild does not re-apply events the rebuild already covered. SQLite's single-writer model means the rebuild transaction and any concurrent local incremental write cannot physically interleave; the checkpoint update at the end of the rebuild transaction is what prevents subsequent incremental processing from redoing work, not a separate locking mechanism.

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
2. `local_today_revenue_projection` rebuilds successfully when the coverage check passes, and safely refuses (no changes, clear message) when it does not — including when in-scope local events are missing a server-assigned `sequence`.
3. Rebuild and normal incremental processing produce identical results for the same event set (proves no drift between the two code paths), including after both have run against the same events in either order.
4. Replaying an already-applied event incrementally, after a rebuild has updated the checkpoint past it, is a no-op — verified directly, not just inferred from the ledger's existing idempotency.
5. Concurrent incremental writes to a shop being rebuilt cannot corrupt the result — verified under the shared shop+projection locking protocol; a rebuild that cannot acquire its lock within the bounded timeout fails fast with a clear message rather than blocking writes indefinitely.
6. A failed rebuild (replay or validation failure) leaves the target projection **and its checkpoint metadata** completely unchanged — verified by capturing the exact pre-rebuild state of both, forcing a replay/validation failure, and asserting the post-rebuild state is identical to what was captured (not merely "some rows still exist").
7. A failed client-side rebuild leaves the local projection and local checkpoint exactly as they were before the rebuild started (client-side equivalent of #6).
8. PowerSync sync rules for `events` and `daily_event_counts` are shop-scoped — a device cannot sync another shop's events or another shop's daily counts (security test).
9. Migration `083` adds `events.sequence`, backfills existing rows deterministically (`created_at ASC, id ASC`) with no null or duplicate values, and replay uses `ORDER BY sequence ASC` exclusively, never `occurred_at`. `events.sequence` is present in the PowerSync sync payload and local SQLite schema, and client-side replay uses it.
10. A scoped rebuild for (shop, day) includes events whose effect lands on that day regardless of the event's own `occurred_at` — verified with a fixture where an event's `occurred_at` falls outside the requested range but its `event_projection_day` falls inside it.
11. `--all` executes as a batch of independently-transactional per-scope rebuilds (verified: a forced failure on one shop's scope does not roll back or block already-committed scopes for other shops).

## Follow-ups / Not This Ticket

Explicitly deferred — real improvements, not required to prove the recovery contract for the two projections in scope:

- **Stronger coverage proof:** a synced checksum/hash of the event set, or a `last_event_sequence` watermark on `daily_event_counts`, so the client coverage check is closer to a proof of set equality than a cardinality check.
- **Server-side corruption detection for `daily_event_counts` itself:** today the client coverage check trusts it; nothing here verifies *it's* correct.
- **General event schema upcasting framework** beyond "fail loudly on an unrecognized `payload_version`."
- **Dry-run mode** (`--dry-run`): compute and report the replay result and diff against current state without mutating anything.
- **Rebuild summary/observability output:** projection name/version, scope, event count, min/max sequence replayed, rows changed, validation results, duration, checkpoint before/after.
- **Admin UI or automatic drift/corruption detection**, and any customer-facing surface — this ticket is CLI-only by design.
- **Staging-table + atomic-swap rebuild** for large projections where in-place transactional rebuild becomes impractical.
- **Event log erasure/GDPR strategy:** the event log is assumed append-only and never mutated or deleted, which this ticket's rebuildability guarantee depends on. If erasure requirements ever apply to event payloads, that needs its own design — deleting events breaks rebuildability for anything downstream.

## Risk Notes

| Risk | Mitigation |
|---|---|
| Read model corruption without recovery path | This ticket exists to close that gap (per plan risk register, WAFI-151 is P1 not P2) |
| Rebuild and incremental logic drift apart over time | Shared `applyEvent` handler is the single source of truth for both paths; cross-runtime (Postgres/SQLite) drift caught by shared fixture-based contract tests |
| Incremental subscriber processes events out of order or reprocesses them | Existing durable-subscriber ledger extended with a per-scope `sequence` checkpoint; sequence-ordered consumption; re-delivery below the checkpoint is a no-op |
| Scoped rebuild silently misses events that affect the target day from outside the requested date range | "Relevant events" defined by projection-key effect via `event_projection_day`, not by `occurred_at` filtering |
| Client coverage check passes against a stale or already-incorrect server-side count | Coverage check explicitly documented as a cardinality check against the last-synced count, not a proof of completeness; server-side `daily_event_counts` correctness is a stated dependency |
| Offline/pending local events lack a server-assigned sequence | Rebuild aborts if any in-scope local event lacks `sequence`, rather than silently including or excluding it |
| Long-running global rebuild blocks writes / risks partial multi-hour rollback | `--all` is a batch of independently-transactional per-scope rebuilds, never one global transaction |
| Rebuild races with concurrent incremental writes, including events committed mid-replay | Shared shop+projection locking protocol between rebuild and subscriber write paths |
| Money/rounding differences between Postgres and SQLite replay | Monetary values are integer minor units (or fixed-precision), never floating point |
| Migration 083 backfill interleaves old/new sequence values unsafely | Deterministic backfill order, `NOT NULL`/`UNIQUE` enforced only after backfill completes; interleaving is explicitly acceptable only because both current projections are commutative |
| Adding `events`/`daily_event_counts` to sync stream weakens shop isolation or over-syncs event history | Shop-scoped sync rule is a stated acceptance criterion, tested explicitly; sync scope limited to what `local_today_revenue_projection` already needs |
