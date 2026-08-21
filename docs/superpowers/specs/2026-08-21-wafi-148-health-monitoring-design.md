# WAFI-148: Internal Health Monitoring — Design

**Date:** 2026-08-21
**Status:** Approved direction, ready for spec self-review

## Problem

Wafi tells the shop owner about their *business* (sales, profit, stock) but nothing
about the *health of the app itself*. Sync failures, offline duration, dead-letter
queue growth, and zombie shifts happen silently today — nobody notices until a customer
complains or a founder happens to query the database directly. The roadmap ticket's
one-line scope ("10 metrics: sync failures, offline duration, printer errors, drawer
mismatches. Owner-facing + team-facing") undersells how many real design decisions this
requires — this document is the result of working through them explicitly rather than
discovering them mid-implementation.

## Scope: 8 metrics, not 10

The ticket names "10 metrics" but only 4 examples are given. Rather than manufacture 6
more to hit a round number, the metric set was derived from what has genuine,
verifiable operational value in this specific codebase, validated one at a time against
whether an authoritative signal actually exists, whether it's capturable offline-safe,
batchable, and actionable (see Metric Contracts below). Two ticket-adjacent metrics
(printer/scanner failures) are explicitly **deferred**, not silently dropped:

> **Printer failure count** and **scanner failure count** are deferred because production
> hardware integration and authoritative hardware failure signals do not currently
> exist — the hardware abstraction layer CLAUDE.md describes ("every printer/scanner
> model is one driver file") is unbuilt; today there is only a single `SimulatedDriver`
> (`src/composables/usePrinter.ts`). Measuring failures of a simulated driver would not
> represent real production hardware reliability and risks coupling the health model to
> a temporary implementation. Revisit once real hardware drivers ship.

**WAFI-148 v1 intentionally delivers 8 trustworthy operational-health metrics rather than
forcing the ticket's original "10 metrics" wording.**

## What already exists — verified, not assumed

A full discovery audit (2026-08-20/21) found the following, changing the shape of the
ticket significantly from a from-scratch build:

- **Sync status** (`sync.store.ts`, `useSync.ts`) already tracks connected/offline/syncing,
  pending/blocked queue depth, and a 24h staleness flag off `lastSyncedAt` — but sync
  errors are only shown in-memory to the user, never persisted or logged anywhere.
- **Drawer mismatch** is already fully modeled: WAFI-066's reconciliation logic computes
  variance at shift close, and a `drawer_variance` business rule
  (`abs(variance) > 15`, `supabase/migrations/092_wafi156_business_rules.sql:50`) already
  fires owner notifications via the WAFI-156 rules engine. This metric is pure
  aggregation of an existing signal.
- **Never-closed/zombie shifts** are already fully modeled via WAFI-065's force-close
  guard (`supabase/migrations/026_cashier_shifts_zombie_guard.sql`, 18h+ threshold) —
  same situation, pure aggregation.
- **Device last-seen** (`last_seen_at`, `src/data/powersync/schema.ts:281`, "WAFI-130:
  stale-device pruning signal") already exists and is already used by
  `src/services/notifications/syncStalenessCheck.ts` for a related purpose.
- **Dead-letter tracking** (`src/data/powersync/dead-letter.ts`, `sync_dead_letter` table)
  is real but **purely local SQLite** — no server-side mirror exists anywhere in
  `supabase/migrations`. This directly shaped the authority model below.
- **Deferred job failures** (WAFI-154, `local_deferred_jobs`) has real per-row
  attempt/failure tracking, but is also **client-local only** — today the only way this
  data reaches the server at all is via a best-effort Sentry report
  (`reportDeferredJobDead.ts`), which silently disappears entirely if Sentry is
  unconfigured (dev builds, DSN unset). WAFI-148 must not repeat this gap.
- **PowerSync has no bucket-priority mechanism** in this app — one single `shop_data`
  stream, FIFO CRUD upload, no priority tiers. "Sync telemetry at lower priority" is not
  available without new PowerSync infrastructure (out of scope).
- **A direct-Supabase-RPC pattern already exists**, entirely separate from PowerSync's
  local-write-then-sync flow — used today for device registration, session revocation,
  business-rule updates, admin rollout flags (`register_device`, `switch_active_operator`,
  `set_rollout_flag`, etc.). This is the established precedent this design reuses for
  transport, rather than inventing a new mechanism.
- **`profit_cache`** (WAFI-153, `supabase/migrations/086_profit_cache_apply.sql`) is the
  established event-sourced Postgres read-model shape (per-shop aggregate + apply
  function + processed-events ledger + rebuild function) — `health_metrics` clones this
  shape for server-authoritative metrics.
- **WAFI-058's `can_view_*` permission-flag pattern** (`staff.permissions` JSONB,
  owner-granted, defaults off) is the established precedent for owner-vs-team visibility
  — reused here as `can_view_health_metrics`, rather than a hardcoded role check.
- **WAFI-156's rules engine cannot consume a new event type without code changes** —
  verified via direct inspection: `businessRuleSubscriber.ts` subscribes to a hardcoded
  closed list (`['sale.returned', 'shift.closed']`), and `execute_rule_action`'s SQL has
  hardcoded per-field and per-event-type `CASE` branches. There is also **no
  threshold-crossing (edge) detection anywhere** — the apparent "fires once" behavior of
  `drawer_variance` is an accident of `shift.closed` being a one-time discrete event, not
  a deliberate mechanism. This finding is why alerting is explicitly deferred (see below).

## Scope decision: dashboard-only v1, alerting deferred to WAFI-148A

Reusing WAFI-156 for health alerting turned out to require real new work — extending the
hardcoded event-type list, adding new field-extraction/entity-type branches to
`execute_rule_action`, **and** building threshold-crossing (edge-detection) state that
doesn't exist anywhere in the codebase today (without it, a metric that stays unhealthy
would generate a fresh notification every single reporting period — notification spam).
That's a real subsystem extension, not incidental reuse, and folding it into an
already-substantial ticket risked shipping a monitoring system that generates fatigue by
construction.

> **WAFI-148 v1: dashboard and health metrics only.** Proactive alerting is deferred to
> **WAFI-148A**, a follow-up that deliberately designs persisted threshold-crossing state,
> WAFI-156 event-vocabulary extension, and notification semantics — rather than hiding
> that scope inside this ticket.

## Architecture

### Two data paths, deliberately separate

```
Business operation                    Client operational events
      │                                       │
      ▼                                       ▼
PowerSync local DB              localOnly health accumulator
      │                                       │
      ▼                                periodic / reconnect
PowerSync shop_data stream                    │
                                               ▼
                                      direct Supabase RPC
                                               │
                                               ▼
                                    server health aggregation
```

Health telemetry uses a transport that **structurally cannot compete** with business
sync — a direct RPC call outside the PowerSync CRUD queue — rather than trying to
prioritize within PowerSync (which has no priority mechanism to begin with). This reuses
the codebase's existing direct-RPC pattern (already used for device/session/admin
operations) instead of building new PowerSync infrastructure.

**Invariant: health telemetry is never on the correctness path.** If the RPC is
unavailable, the local accumulator keeps the data and the POS continues selling
uninterrupted. Health reporting is observational, never authoritative business data —
if telemetry storage itself fails, checkout must still succeed.

### Three metric authority classes

This is the single most important invariant in this design — getting it wrong risks a
future developer accidentally making a server-derived metric client-writable, or vice
versa.

1. **Cumulative client-authoritative** (metrics 1, 2, 5, 6) — a period's value only ever
   increases while the period is open. Server upsert uses
   `SET value = GREATEST(health_metrics.value, EXCLUDED.value)`, which makes the RPC
   naturally idempotent: resending the same or a stale cumulative value is a no-op, and
   an event recorded between send and ack is simply included in the next report. A
   closed period's local row is deleted only once the server's response confirms
   acceptance of that exact `(metric_key, period_start)` — an **open/current period's
   local row is never deleted**.

2. **Server-authoritative** (metrics 4, 7, 8) — event-sourced, derived entirely from data
   that already exists server-side (existing `shift.closed` events, `last_seen_at`,
   WAFI-065 force-close records). These use `SET value = computed_value` (plain
   overwrite, rebuildable per the WAFI-153 pattern) — **never `GREATEST()`**, because a
   projection rebuild/correction that lowers a previously-wrong value must actually take
   effect, not be stuck at the old high-water mark.

3. **Client-authoritative current-state gauge** (metric 3, dead-letter count only) — the
   one exception. `sync_dead_letter` has no server-side mirror at all, so the device is
   the only place this data exists. The client reports its live `COUNT(*)` as a
   snapshot, overwritten (not `GREATEST()`'d) on every report, carrying an
   `observed_at` timestamp. This is still a single source of truth — just not a server
   table — so it does not violate the "one authority per metric" rule, it's simply a
   different storage location. Unlike cumulative counters, this local gauge is **never
   deleted** after acknowledgment — it's continuously sampled and reported on the normal
   schedule, since dead-letter count can legitimately decrease (a team member resolves
   an issue) and the server must reflect that.

### RPC payload shape

```
report_health_metrics(device_id, {
  counters: [{ metric_key, period_start, value }, ...],   // class 1, cumulative
  gauges:   [{ gauge_key, value, observed_at }, ...],      // class 3, current-state
})
  → server: for each counter, UPSERT SET value = GREATEST(existing, incoming)
  → server: for each gauge, UPSERT SET value = incoming, observed_at = incoming.observed_at
  → server: UPDATE devices SET last_seen_at = now() WHERE id = device_id
  → returns: accepted list of (metric_key | gauge_key, period_start | null)
```

`last_seen_at` means **reachability** ("this device could talk to the WAFI server") —
it does not mean "this device's business data is synchronized." A device can have a
healthy health-RPC connection while its actual sync pipeline is broken; that divergence
is exactly the kind of incident WAFI-148 exists to expose, so these two signals must stay
independent (`last_seen_at` is updated only by the health RPC, never conflated with
PowerSync's own connection status).

### Local storage

```
local_health_metrics (localOnly: true)
  metric_key      text      -- e.g. 'sync_failure_terminal', 'offline_duration_seconds'
  period_start    text      -- ISO date, daily granularity
  value           integer   -- cumulative value for that period so far
  acknowledged    integer   -- 0/1, cleared only after server ack of a CLOSED period
  updated_at      text

local_health_gauges (localOnly: true)
  gauge_key       text      -- 'dead_letter_count'
  value           integer
  observed_at     text
```

**Daily granularity, not hourly, for v1** — a deliberate scope-narrowing choice, not a
neutral default. The dashboard's operational-visibility purpose doesn't need
hour-level resolution, and daily buckets keep the local table tiny (8 metrics × ≤7 open
days ≈ 56 rows/device, never per-event row explosion) — no hourly→daily compaction
machinery needed. Hourly granularity is explicitly out of scope for v1.

**Retention/overflow**: 7-day local cap. On each periodic tick, any local row with
`period_start` older than 7 days that's still unacknowledged is dropped, incrementing a
small local meta-counter `telemetry_periods_dropped` (surfaced in the team dashboard as
an honesty signal — "this device silently lost N days of health data" — rather than
swept under the rug). This bounds worst-case growth for a device offline for weeks
without threatening POS storage.

**Reporting cadence**: a 30-minute periodic tick while online, plus an immediate attempt
on reconnect (hooking the existing `useSync.ts` connectivity listener, not a new
detector).

**Offline-cycle idempotency**: a disconnect→reconnect cycle must be recorded exactly
once — the same reconnect callback firing twice (e.g. after an app restart or a
duplicate connectivity event) must not double-add the cycle's duration to the period's
cumulative value. The implementation needs a stable cycle identity (e.g. the
`offline_started_at` timestamp itself, cleared once consumed) to guard against this.

### Offline duration: two structurally distinct metrics, never merged

Rather than reconciling client-reported and server-inferred downtime into one number
(where double-counting risk actually lives), these are kept as two separate metrics that
answer two different questions and can never overlap in time:

- **Offline Duration** (historical, metric 2) — represents *only* completed,
  client-observed offline sessions (`offline_started_at` set on disconnect, duration
  added to the period's cumulative value on confirmed reconnect). **An unfinished
  offline interval is never estimated** — if a device never reconnects, this metric
  never fires for that gap.
- **Stale Device Count** (current-state, metric 7) — represents *only* currently-ongoing
  server-observed unavailability, purely from `last_seen_at` staleness.

The moment a device reconnects and reports its offline interval, it's no longer
"currently stale" — so the server-inferred signal clears for that device at exactly the
point client-reporting would otherwise start overlapping it. No interval-reconciliation
logic is needed; the two metrics are mutually exclusive in time by construction.

### Terminal outcome semantics (sync, deferred jobs)

Both sync-failure-rate and deferred-job-failure-rate operate on **logical operations,
not retry attempts**:

```
logical operation
 ├─ attempt 1 → fail   (not counted)
 ├─ attempt 2 → fail   (not counted)
 └─ attempt 3 → success → +1 terminal success
```

An operation that ultimately dead-letters/quarantines contributes exactly **+1 terminal
failure**, once, at the moment of quarantine — never once per retry.

## Metric Contracts

**Authority-class legend:** **C** = cumulative client-authoritative · **S** =
server-authoritative · **G** = client-authoritative current-state gauge

| # | Metric | Class | Formula | Retention |
|---|---|---|---|---|
| 1 | Sync Failure Rate | C | `terminal_failures / (terminal_failures + terminal_successes)`, device/day | 90d server / 7d local |
| 2 | Offline Duration | C | `sum(confirmed reconnect-cycle durations)` seconds, device/day | 90d server / 7d local |
| 3 | Dead-Letter Count | G | `COUNT(*)` of currently-unresolved rows in local `sync_dead_letter`, sampled at `observed_at` | Current-state only, no history |
| 4 | Drawer Mismatch Count | S | `COUNT(shift.closed events)` where `abs(variance) > 15` (threshold owned by the existing drawer/reconciliation rule — **WAFI-148 does not redefine it**) | 90d, rebuildable from source events |
| 5 | Deferred Job Failure Rate | C | `terminal_dead_jobs / (terminal_dead_jobs + terminal_completed_jobs)`, device/day | 90d server / 7d local |
| 6 | Unhandled App Error Count | C | Raw count is authoritative from the app-side error signal (Sentry is a parallel diagnostic sink, never the source of truth — must not disappear if Sentry is unconfigured); rate = `count / active_device_days` | 90d server / 7d local |
| 7 | Stale Device Count | S | `COUNT(devices)` where `now() - last_seen_at > STALE_DEVICE_THRESHOLD` (threshold is **policy/configuration**, not part of the metric formula — v1 candidate value TBD during implementation) | Current-state only |
| 8 | Never-Closed Shift Count | S | `COUNT(*)` of shifts force-closed via the existing WAFI-065 zombie-shift guard — explicitly **not** the same as a merely-late close | 90d, rebuildable |

**Deferred:** Printer failure count, Scanner failure count — see Scope above.

### Cross-cutting metric-contract rules

- **Aggregate rates from summed raw totals, never by averaging child rates.** A shop's
  sync failure rate is `SUM(terminal_failures) / SUM(terminal_outcomes)` across its
  devices — never `AVG(device_rate)`. (Two devices at 10% and 0.1% failure produce a
  shop rate of ~0.2% if their volumes differ by 100x — averaging the percentages would
  wrongly report ~5%.) Applies to metrics 1, 5, and 6's rate.
- **Zero vs. no-data are distinct and must never be conflated.** A rate metric with
  `denominator = 0` (no operations occurred) is **No data**, never "0% failure" — an
  inactive device/shop must not look artificially healthy. A count metric with
  `value = 0` (e.g. zero drawer mismatches) is a legitimate healthy zero. This rule lives
  once in the shared presentation/formatting layer (see Phase 5), never reimplemented
  per screen.
- **Presentation thresholds (owner "Attention"/"Issue" cutoffs, the v1 stale-device
  threshold) are policy, kept explicitly outside the metric's mathematical definition** —
  a metric formula must remain reusable and must never encode display/severity policy in
  the database model.
- **`active_device_day`** (metric 6's denominator) = a calendar day during which a device
  successfully checked in with WAFI (health RPC or any other server communication) at
  least once. This is a shop-wide denominator; per-device error counts and the shop-level
  rate are reported as separate dimensions, not conflated.

## Visibility (Owner + Team dashboards)

### Owner Dashboard — one shop, plain language, status-first

A single top-level indicator per shop, with **explicit precedence, not per-screen
invention**:

```
any CRITICAL-policy condition present → 🔴 Issue
else any WARNING-policy condition present → 🟡 Attention
else → 🟢 Healthy
```

**No-data never counts toward "Healthy"** — it simply contributes nothing to the status
unless a metric's specific policy says otherwise.

When healthy, the owner sees an explicit positive confirmation — **"Everything is working
normally"** — never a blank screen with no signal that monitoring is even active. When
not healthy, only the specific unhealthy metrics render, in plain product language, never
exposing internal vocabulary (terminal failures, dead-letter, stale heartbeat, denominator,
rate, RPC, sync queue):

> "Your tablet was offline for 3 hours yesterday."
> "Wafi had some application errors yesterday."
> "A shift had to be automatically closed."

**App-error owner policy is a threshold decision, not `count > 0`** — one harmless
isolated error shouldn't surface to the owner; the exact cutoff is a presentation-policy
choice made during implementation, not baked into the metric.

Gated by a new `can_view_health_metrics` flag on `staff.permissions`, following WAFI-058's
`can_view_*` convention exactly (owner-grantable, defaults off) — this flag controls only
the shop-facing dashboard, never the platform-wide team view.

### Team Dashboard — cross-shop, founder-only, full detail

Gated the same way `useRolloutAdmin.ts` gates admin tooling (founder/admin claim) — a
**separate, privileged read path**, structurally distinct from
`can_view_health_metrics` and from ordinary shop-scoped RLS. This must be explicitly
verified against the actual RLS/RPC implementation when built, so an ordinary shop
staff member can never see cross-shop health data through it.

- All 8 metrics, exact values — no traffic-light rounding.
- **Every rate is shown with its numerator and denominator alongside the computed
  value** (e.g. `2/1010 · 0.2%`), never as a bare percentage — this is what lets a team
  member immediately distinguish no-data from healthy and verify the sum-then-divide
  rule themselves. App-error rate is the one exception to "percentage" framing — shown
  as `12 errors · 4.0 per active device-day`, since forcing it into a percentage isn't
  meaningful; the shared formatter must support multiple rate *types*, not assume every
  rate is a percentage.
- **Per-device drill-down** for device-scoped metrics (1, 2, 3, 5, 6, 7) — a shop-level
  average can hide one severely broken device (e.g. shop average looks fine at ~0.2%
  while one tablet alone is at 37%).
- **Dead-letter gauge always carries its `observed_at` freshness** — "7 dead letters,
  last reported 8h ago" is required; the bare count without a timestamp is not
  acceptable, since the device could be offline and the value stale. If that device is
  also flagged stale, the UI visually connects the two signals.
- A general **"last health report: N min ago"** freshness indicator at the device/shop
  level — metadata explaining how current the client-derived data is, not a metric in
  its own right. Particularly relevant for offline duration, dead-letter, app errors,
  deferred jobs, and sync counters.
- Historical metrics (1, 2, 4, 5, 6, 8) get a simple daily sparkline/compact table over
  the 90-day window; current-state metrics (3, 7) show only their latest value.
  **Explicitly out of v1**: hourly charts, arbitrary date-range analytics, filtering,
  correlation visualizations — this is operational visibility, not another analytics
  product.

### Shared presentation contract

One formatting layer owns: zero-vs-no-data, rate-vs-count-vs-duration-vs-freshness
rendering, and severity-policy evaluation. Both dashboards are *consumers* of this layer,
never independent re-implementations of metric semantics.

## Alerting (explicitly out of scope for v1)

**In scope for WAFI-148:** dashboard and health metrics only.

**Explicitly out of scope, deferred to WAFI-148A:**
- A new health threshold-crossing (edge-detection) engine — nothing in the codebase
  today distinguishes "just crossed into unhealthy" from "still unhealthy," and without
  it a sustained bad metric would generate a fresh notification every single reporting
  period.
- Health-domain notification events.
- WAFI-156 subscriber/event-vocabulary extensions.
- New `execute_rule_action` health branches.
- Any email/Slack digest.
- Proactive health notifications of any kind.

WAFI-148A should design, deliberately: metric evaluation → persisted threshold state →
false→true edge detection → health threshold event → WAFI-156 extension → WAFI-145
notification — as its own properly-scoped design, rather than smuggled into this ticket.

## Summary of accumulated decisions (for implementers)

- 8 locked metrics, 2 explicitly deferred (printer/scanner, pending real hardware).
- 3 metric authority classes: cumulative client (`GREATEST()`), server-authoritative
  (overwrite/rebuildable), client-authoritative current-state gauge (overwrite, no
  ack-delete).
- Transport: bounded local accumulator (`localOnly` SQLite) → direct Supabase RPC,
  entirely outside the PowerSync CRUD queue — reusing an existing pattern, not new
  PowerSync infrastructure.
- Idempotent cumulative reporting via monotonic values, no separate batch-id ledger.
- Daily granularity only; 7-day local retention; 90-day server retention for historical
  metrics; current-state metrics keep no history.
- Offline duration and stale-device-count are deliberately separate, non-overlapping
  metrics rather than a merged/reconciled downtime number.
- Terminal-outcome counting only, never per-retry-attempt.
- Zero vs. no-data and all severity/threshold policy live in one shared presentation
  layer, never in the metric math.
- Owner view: plain language, status-first, explicit "everything normal" state,
  `can_view_health_metrics` permission gate.
- Team view: exact values, numerator/denominator always shown, per-device drill-down,
  freshness metadata, separate privileged read path — never inherits ordinary shop RLS.
- Dashboard-only v1; alerting is WAFI-148A, deliberately scoped as its own follow-up.
