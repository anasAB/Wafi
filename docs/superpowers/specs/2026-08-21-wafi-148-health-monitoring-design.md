# WAFI-148: Internal Health Monitoring — Design

**Date:** 2026-08-21
**Status:** Implementation-ready — self-review round 3 applied 2026-08-21

## Prerequisite: shop timezone does not currently exist

Verified: no `timezone`/`time_zone` column exists anywhere in `supabase/migrations` or
`shops`. Every daily-granularity metric in this design depends on "whose day" a
period boundary falls on, so this is a real schema gap, not a nuance — **a
`shops.timezone` column (IANA name, e.g. `Asia/Damascus`) must be added as part of this
ticket's first migration**, not assumed to already exist. See "Period boundaries and
timezone" below for why device-local or UTC dates are unsafe here.

**Backfill policy for existing shops — must not assume a single default.** Defaulting
every existing shop to `'Asia/Damascus'` would be wrong for any shop outside Syria
(the CLAUDE.md context explicitly notes international signups from Lebanon, Iraq,
Jordan are accepted opportunistically), and there's no reliable existing column to
derive a real timezone from. The column must be added **nullable**, with health-metric
computation simply not running for a shop until its timezone is set — this is an
onboarding/settings requirement (surface a one-time "set your shop's timezone" prompt),
not a migration-time guess. No shop may begin producing health metrics with an
undefined period timezone.

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

**"Accepted" means the server processed this observation, not that the submitted value
is now the current server value.** Because of `GREATEST()`, if two reports for the same
device/metric/period race or arrive out of order (e.g. a retry resending an older
cached value after a newer one already landed), the server keeps the higher value and
still returns "accepted" for the older one — the client must not interpret "accepted"
as "the server's stored value now equals what I sent." This only matters for the
decision to delete a closed-period local row (safe either way, since deleting the local
row doesn't affect the server's already-higher authoritative value), never for
correctness of the stored value itself.

**Single-writer invariant**: this design assumes **exactly one logical device identity
is the writer for a given device-scoped client metric** — one authenticated device
session reporting its own local accumulator, not multiple tabs/webviews/processes
independently reporting under the same `device_id`. If this app ever allows multiple
concurrent sessions per registered device, `GREATEST()` semantics would need
reconsideration (two legitimate-but-different partial counts would produce a wrong
merged value, since the higher one isn't necessarily the union of both). Not believed
to be a current risk, but the assumption must be stated rather than left implicit.

`last_seen_at` means **reachability** ("this device could talk to the WAFI server") —
it does not mean "this device's business data is synchronized." A device can have a
healthy health-RPC connection while its actual sync pipeline is broken; that divergence
is exactly the kind of incident WAFI-148 exists to expose, so these two signals must stay
independent (`last_seen_at` is updated only by the health RPC, never conflated with
PowerSync's own connection status).

### RPC security boundary

**The health RPC is an allowlisted write path, not a free-form payload accepted at face
value.** The client must never be trusted to supply its own identity or to write outside
its allowed metric set:

- `device_id`/`shop_id` are **derived or verified server-side** from the authenticated
  session — never trusted from a payload field. The RPC must confirm the authenticated
  device actually owns/represents the `device_id` it's reporting for, and that device
  belongs to the shop it claims.
- **The client may write only its own authority-class-C metrics (1, 2, 5, 6) and the
  class-G gauge (3).** It must be structurally unable to write metrics 4, 7, or 8
  (drawer mismatch, stale device, never-closed shifts) — those are server-owned and
  server-computed only; no code path should let a client-supplied `metric_key` of
  `drawer_mismatch_count` (etc.) reach a write.
- `period_start` must be validated against the server's own shop-local calendar (see
  timezone section below) — not accepted as an arbitrary client-supplied date.
- `value` must be validated non-negative before being applied to `GREATEST()`/overwrite.

Every metric definition must identify its single source of truth and exactly one write
path — this is what prevents future accidental dual-writing of a server-authoritative
metric from client data.

### Period boundaries and timezone

**All health metric periods are keyed to the shop's configured IANA timezone
(`shops.timezone`), never the device's local clock and never UTC calendar dates.**
Without this, two devices in the same shop — or one device with a misconfigured OS
clock — can report the same real-world period under two different `period_start`
values (e.g. one device reporting `2026-08-21`, another `2026-08-20`, for the same
shop-operating day), corrupting both server-side aggregation and dashboard trends.
`period_start = local calendar date in shops.timezone`, computed the same way on both
client (for bucketing local accumulator writes) and server (for validating incoming
`period_start` values and for the owner dashboard's "yesterday" evaluation below).

### Local storage

```
local_health_metrics (localOnly: true)
  metric_key      text      -- one of: sync_failure_terminal, sync_terminal_total,
                             -- offline_duration_seconds, deferred_job_failure_terminal,
                             -- deferred_job_terminal_total, app_error_count,
                             -- active_device_day
  period_start    text      -- ISO date, shop-local calendar day (see timezone section)
  value           integer   -- cumulative value for that period so far
  updated_at      text

local_health_gauges (localOnly: true)
  gauge_key       text      -- 'dead_letter_count'
  value           integer
  observed_at     text
```

No `acknowledged` column — a persisted ack flag creates awkward semantics for an open
period whose value keeps changing after being marked acknowledged (is `value = 12`
still "acknowledged" after being reported at `value = 10`?). Instead: **a row is
deleted only when (a) its `period_start` is a fully closed shop-local day, and (b) the
server's most recent RPC response explicitly listed that exact `(metric_key,
period_start)` as accepted.** If the response is lost, the row simply persists and gets
resent next tick — the monotonic `GREATEST()` semantics already make this safe without
a separate flag.

**Daily granularity, not hourly, for v1** — a deliberate scope-narrowing choice, not a
neutral default. The dashboard's operational-visibility purpose doesn't need
hour-level resolution, and daily buckets keep the local table tiny — only **4 metrics
are client-cumulative** (sync failure rate and deferred-job failure rate each need a
terminal-failure counter *and* a terminal-total counter to compute a rate; offline
duration, app-error count, and `active_device_day` are single counters each), so worst
case is roughly `(2+2+1+1+1) metrics × 7 open days = 49 rows/device`, plus 1 gauge row,
plus the telemetry-drop meta-counter — never per-event row explosion, no hourly→daily
compaction machinery needed. Hourly granularity is explicitly out of scope for v1.

**Retention/overflow**: local rows are retained for **the current shop-local day plus
the six immediately preceding shop-local days** (an actual 7-calendar-day maximum, not
an ambiguous "older than 7 days"). On each periodic tick, any still-unacknowledged row
whose `period_start` falls outside that window is dropped, incrementing a small local
meta-counter `telemetry_periods_dropped`. This metadata is **diagnostic only — it never
participates in health status and is never presented to the owner** — it's surfaced
solely in the team dashboard as an honesty signal ("this device silently lost N days of
health data"). This bounds worst-case growth for a device offline for weeks without
threatening POS storage.

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
  never fires for that gap. **"Offline" is defined precisely as the existing WAFI
  sync/connectivity state transition already tracked in `useSync.ts`/`sync.store.ts`
  (loss of the app's operational server connection) — not raw
  `navigator.onLine`/browser connectivity, and not "sync is stale" alone.** A device
  with internet access but a broken PowerSync connection counts as offline by this
  definition; this must be confirmed against the exact transition `useSync.ts` already
  exposes during implementation rather than re-derived from scratch.
- **Stale Device Count** (current-state, metric 7) — represents *only* currently-ongoing
  server-observed unavailability, purely from `last_seen_at` staleness.

The moment a device reconnects and reports its offline interval, it's no longer
"currently stale" — so the server-inferred signal clears for that device at exactly the
point client-reporting would otherwise start overlapping it. **These two metrics
represent different temporal states — one historical/confirmed, one live/current — and
are never combined into a single duration calculation.** (A stale-device flag today can
still coexist with an offline-duration row from an earlier, already-closed period for
the same device; that's expected and not a conflict, since the two numbers are never
added together.) No interval-reconciliation logic is needed.

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
| 1 | Sync **Upload** Failure Rate | C | `terminal_failures / (terminal_failures + terminal_successes)`, device/day — see naming note below | 90d server / 7d local |
| 2 | Offline Duration | C | `sum(confirmed reconnect-cycle durations)` seconds, device/day | 90d server / 7d local |
| 3 | Dead-Letter Count | G | `COUNT(*)` of currently-unresolved rows in local `sync_dead_letter`, sampled at `observed_at` | Current-state only, no history |
| 4 | Drawer Mismatch Count | S (event-derived, rebuildable) | `COUNT(shift.closed events)` where `abs(variance) > 15` (threshold owned by the existing drawer/reconciliation rule — **WAFI-148 does not redefine it**) | 90d, rebuildable from source events |
| 5 | Deferred Job Failure Rate | C | `terminal_dead_jobs / (terminal_dead_jobs + terminal_completed_jobs)`, device/day | 90d server / 7d local |
| 6 | Unhandled App Error Count | C | **Two raw client-cumulative counters**, not one: `app_error_count` (authoritative from the app-side error signal — Sentry is a parallel diagnostic sink, never the source of truth, must not disappear if Sentry is unconfigured) and `active_device_day` (see locked definition below). Displayed rate = `SUM(app_error_count) / SUM(active_device_day)`, computed at query time, never stored as a rate | Both raw counters retained 90d server / 7d local — the rate is never stored on its own, since a rate without its components can't be re-aggregated at the shop level |
| 7 | Stale Device Count | S (current-state query, **not** event-sourced) | `COUNT(devices)` **where `devices.is_active = true`** and `now() - last_seen_at > STALE_DEVICE_THRESHOLD` (threshold is **policy/configuration**, not part of the metric formula — v1 candidate value chosen and documented during implementation) | Current-state only |
| 8 | Never-Closed Shift Count | S (event-derived, rebuildable) | `COUNT(*)` of shifts force-closed via the existing WAFI-065 zombie-shift guard — explicitly **not** the same as a merely-late close | 90d, rebuildable |

**Deferred:** Printer failure count, Scanner failure count — see Scope above.

**Naming note (metric 1):** the original candidate definition said "sync failures"
broadly, but the only instrumentable terminal-outcome signal found in this codebase is
the PowerSync **upload** CRUD queue's quarantine/success path (`ops.ts`,
`dead-letter.ts`). Download/pull failures are a structurally different path and are
**not represented by this metric** — hence "Sync Upload Failure Rate," not a general
"Sync Failure Rate." If download-side failure visibility becomes valuable later, it
needs its own metric and its own instrumentation, not silent inclusion here.

**Server-authoritative metrics are not all reconstructed the same way** — this
distinction must be explicit, not implied:
- **Metrics 4 and 8** are event-sourced and rebuildable per the exact WAFI-153
  `profit_cache` pattern: source events → deterministic apply function →
  processed-events ledger (idempotency) → rebuild function.
- **Metric 7** is not event-sourced at all — it's a live query derived from current
  `last_seen_at` state, with no event history and no rebuild function, since there's
  no "past state" to reconstruct.

**Metric 7 is scoped to `devices.is_active = true` only** — confirmed this flag already
exists (migration 042, "deactivation for lost/retired devices"). Without this scope, a
revoked/retired/decommissioned device would silently and permanently render its shop
"unhealthy" forever, since it will never check in again. The exact predicate is
"registered devices currently participating in health monitoring," not "every row ever
inserted into `devices`."

**Rebuildability has a retention dependency**: the 90-day rebuildable guarantee for
metrics 4 and 8 is only true as long as the underlying source events/data they're
derived from remain available for at least that same 90-day window. If event retention
is ever reduced below 90 days for unrelated reasons, health-metric rebuildability
silently breaks — this dependency must be tracked wherever event retention policy is
owned, not just here.

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
- **`active_device_day` — locked as a dedicated client-side counter, not a derived
  server signal.** It must represent genuine local device *usage*, not mere server
  reachability: a device that briefly checks in via the health RPC and then spends 12
  hours offline while being actively used locally must still count as one active
  device-day, while a device that's actively used all day but never manages to reach
  the server (exactly the failure mode this metric should catch) must not wrongly fall
  out of the denominator as "no data." **`device_sessions.updated_at` was considered and
  rejected** — verified it's bumped only by `switch_active_operator`/session-lockout/
  revocation events (migrations 045/046/048/067/069/096), i.e. it's an auth-lifecycle
  signal, not a general app-usage signal; a device used all day without a single
  operator switch would wrongly show zero activity. Instead: **`active_device_day` is
  set to `1` (idempotently — not incremented per interaction) the first time the app
  registers qualifying local foreground activity on a given shop-local day** (the exact
  interaction list — e.g. any POS screen navigation, any business operation — is an
  implementation detail, but it must be genuine foreground usage, not a passive
  background timer or the health RPC's own tick). This is a shop-wide denominator once
  aggregated (`SUM(active_device_day)` across devices); per-device error counts and the
  shop-level rate are reported as separate dimensions, not conflated. **Both raw
  counters (`app_error_count`, `active_device_day`) are retained for the full 90-day
  server history — never only the derived rate** — otherwise the rate could never be
  correctly re-aggregated to the shop level (point 1's sum-then-divide rule) or
  recomputed if the definition of "qualifying activity" is refined later.

## Visibility (Owner + Team dashboards)

### Owner Dashboard — one shop, plain language, status-first

**Evaluation window, made explicit:** historical metrics (1, 2, 4, 5, 6, 8) evaluate the
most recently completed shop-local calendar day ("yesterday," using the shop's
`timezone` from the Period boundaries section) — never today's partial, still-open
data, which would make the status unstable throughout the day. Current-state metrics
(3, 7) always evaluate live/latest-reported state. This gives the owner a simple mental
model: "yesterday's operations were healthy or needed attention, and this device is
currently reachable or not" — and it must be stated directly here, not left implicit in
the metric contracts.

A single top-level indicator per shop, with **explicit precedence, not per-screen
invention**:

```
any CRITICAL-policy condition present → 🔴 Issue
else any WARNING-policy condition present → 🟡 Attention
else at least one applicable metric has usable data and none are unhealthy → 🟢 Healthy
else → ⚪ No recent health data
```

**No-data never counts toward "Healthy"** — it simply contributes nothing to the status
unless a metric's specific policy says otherwise. Critically, this means "Healthy" is
not simply "the fall-through when nothing is Critical or Warning" — if *every* metric
that day is no-data (e.g. a device that never reported at all) or current-state metrics
are themselves stale, the dashboard must show an explicit **"No recent health data"**
state rather than defaulting to a false "Healthy," which would otherwise silently
contradict the no-data rule.

When healthy, the owner sees an explicit positive confirmation — **"Everything is working
normally"** — never a blank screen with no signal that monitoring is even active. When
not healthy, only the specific unhealthy metrics render, in plain product language, never
exposing internal vocabulary (terminal failures, dead-letter, stale heartbeat, denominator,
rate, RPC, sync queue):

> "Your tablet was offline for 3 hours yesterday."
> "Wafi had some application errors yesterday."
> "One shift required automatic closing yesterday."

The last message intentionally never surfaces internal shift IDs, staff/operator
identifiers, or device names to the owner — that level of detail belongs only in the
team view (below); the owner view stays within its plain operational-health scope.

**Multi-device shops need the message contextualized around affected device count, not
phrased as if the whole shop is unhealthy.** A shop with two tablets where only one is
stale should read "One of your tablets is currently unreachable," not "Your shop is
unhealthy" — the latter overstates the problem when the other device is fine. The
top-level status color logic (any-critical → Issue, etc.) is unaffected; this is a
message-phrasing requirement for implementation, not an architecture change.

**App-error owner policy is a threshold decision, not `count > 0`** — one harmless
isolated error shouldn't surface to the owner; the exact cutoff is a presentation-policy
choice made during implementation, not baked into the metric.

Gated by a new `can_view_health_metrics` flag on `staff.permissions`, following WAFI-058's
`can_view_*` convention exactly (owner-grantable, defaults off) — this flag controls only
the shop-facing dashboard, never the platform-wide team view.

### Team Dashboard — cross-shop, founder-only, full detail

Gated the same way `useRolloutAdmin.ts` gates admin tooling — a **separate, privileged
read path**, structurally distinct from `can_view_health_metrics` and from ordinary
shop-scoped RLS. **The exact authorization predicate is an open question for the
implementation plan, not something this spec should paper over as "founder/admin
claim"** — the product requirement is specifically *platform operational team access*
(the two co-founders), which may or may not be identical to whatever
`useRolloutAdmin.ts` currently checks for generic admin tooling. The implementation plan
must identify the precise predicate and confirm it cannot be satisfied by an ordinary
authenticated shop-owner/staff session, so an ordinary shop staff member can never see
cross-shop health data through it. This is a security-review item, not a metrics
decision.

- All 8 metrics — **the raw values required to interpret each metric, plus derived
  rates where applicable** (not a single "exact value" per metric uniformly: metric 3 is
  a gauge shown with its freshness age, metric 6 shows both its raw count and its
  derived rate, metric 7 is a live count with no historical value) — no traffic-light
  rounding.
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
  also flagged stale, the UI visually connects the two signals. **A current-state gauge
  is valid only together with its observation age**: once `observed_at` exceeds a
  configured freshness window (policy, exact value chosen during implementation — not
  part of the metric formula, same rule as every other threshold in this spec), the UI
  must label the value as **stale** rather than presenting a several-day-old count with
  the same visual confidence as a fresh one.
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

- **Prerequisite:** `shops.timezone` (IANA name) must be added — does not exist today.
  All period boundaries key off this, never device-local or UTC dates.
- 8 locked metrics, 2 explicitly deferred (printer/scanner, pending real hardware).
- Metric 1 is scoped as **Sync Upload Failure Rate**, not general "sync failure" —
  download/pull failures aren't instrumentable today and aren't represented.
- The health RPC is an allowlisted write path: server derives/verifies device/shop
  identity, client can write only its own class-C metrics + the class-G gauge, and
  cannot write class-S metrics under any payload shape.
- Owner dashboard evaluates the most recently completed shop-local day for historical
  metrics, live state for current-state metrics; an explicit "No recent health data"
  state exists so all-no-data can never silently render as "Healthy."
- `active_device_day` is a **dedicated client-side counter** (idempotent, set to 1 on
  first qualifying foreground activity per shop-local day) — `device_sessions.updated_at`
  was investigated and rejected as an auth-lifecycle signal, not a general-usage one.
  Both `app_error_count` and `active_device_day` are retained as raw components for the
  full 90-day history; the rate is always computed at query time, never stored.
- Server-authoritative metrics split three ways: **4 and 8** are server-owned
  event-sourced aggregates/projections (client cannot cause or modify them); **7** is a
  server-owned *live derived query* with no stored value and no event history at all —
  these are not interchangeable reconstruction mechanisms. Metric 7 is additionally
  scoped to `devices.is_active = true` so a retired/revoked device can never
  permanently render a shop unhealthy.
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
