# WAFI-147B: Server-Side Scheduled Report Generation — Design

**Date:** 2026-08-20
**Status:** Design approved, not yet implemented
**Depends on:** WAFI-147A (Report generation & on-demand viewer, shipped `fb283ea`), WAFI-153 (`profit_cache`)
**Enables:** WAFI-147C (automated WhatsApp delivery) — this spec establishes the producer boundary 147C will consume

## Background

WAFI-147 (Automatic Reports) was investigated 2026-08-18 and split into three independent capabilities:
147A (report generation + on-demand viewer, shipped), 147B (this spec — server-side wall-clock scheduling),
and 147C (automated WhatsApp delivery, blocked on a separate product/infra decision — WhatsApp Business API
is not set up).

The 13 reports specified in `WAFI_Event_Driven_Platform_Plan_v1.md:639-786` each name a wall-clock schedule
(e.g. "generated at midnight," "every Sunday at 9 AM," "1st of month at 9 AM"). No mechanism in this codebase
can execute anything independent of the app being open: WAFI-154's `local_deferred_jobs` queue is local-only,
drained on app-foreground/PowerSync-reconnect. No `pg_cron`, no Supabase Edge Function, no server-side
scheduled-job mechanism exists anywhere today. This is the gap WAFI-147B closes.

147A's `compute()` functions are client-oriented (call Vue composables, PowerSync, Dexie-adjacent client code)
and are not directly reusable server-side. WAFI-147B reimplements the needed primitives in SQL/plpgsql and
must match 147A's output contract, verified by contract tests — not by sharing code.

## Goals

- Execute report generation at wall-clock times independent of whether any client app is open.
- Produce a durable, versioned, self-describing report snapshot per shop/report/period that 147A's existing
  Reports viewer can render with no new client-side computation.
- Establish a producer boundary (persisted snapshot) that a future WAFI-147C delivery mechanism can consume
  without needing to understand accounting queries.
- Make report generation safe under retries, manual re-runs, and (later) additional trigger paths.

## Non-goals (explicitly deferred)

- **Per-shop configurable schedules.** The original WAFI-147 AC ("schedule configurable per shop") is not
  satisfied by this ticket. v1 ships fixed, spec-defined default schedules for all shops. The scheduler
  architecture resolves "what's due" as a step separate from generation specifically so a follow-up ticket
  can replace the fixed-schedule source with per-shop configuration without redesigning the generation
  pipeline. **Follow-up ticket required**, not an informal "later."
- **Shift-close event triggers (Daily Closing and Employee Summary).** Daily Closing names a dual trigger
  ("generated at shift close or midnight"); v1 implements the midnight wall-clock path only. Employee
  Summary ("generated per staff at shift close") has no wall-clock component at all and is deferred in full.
  Both are deferred to a later event-driven integration ticket, which will call
  `generate_report_snapshot(...)` directly (see the function-boundary invariant below) rather than through
  the cadence resolver. Whether that integration is a direct event consumer or routes through WAFI-156's
  Business Rules Engine is a decision for that later ticket, not this one.
- **Per-shop timezone-correct scheduling.** `shops.timezone` is dormant and unpopulated across the app today
  (same gap already documented in WAFI-151's write-up). v1 runs all cron schedules in UTC. This is an explicit,
  tracked limitation: "midnight" in v1 means 00:00 UTC, not each shop's local midnight. **Follow-up ticket
  required**: establish/populate authoritative shop timezone and migrate schedule resolution to shop-local
  wall-clock time. Report-generation code must not bake in UTC assumptions, so that follow-up only touches
  schedule resolution, not the 13 report-generation functions.
- **WhatsApp/automated delivery.** Owned entirely by WAFI-147C, which is separately blocked on WhatsApp
  Business API setup (Meta approval, message templates, secrets, delivery tracking). This spec only ensures
  147C will have a clean artifact (the persisted snapshot) to consume when it's unblocked.

## Architecture

### Scheduling mechanism: pg_cron

`pg_cron` (Postgres extension, available on Supabase-hosted Postgres) schedules thin wrapper jobs — one per
cadence (daily, weekly, monthly) — each calling a single shared, `SECURITY DEFINER` PL/pgSQL function:

```
pg_cron (daily 00:00 UTC)   ──┐
pg_cron (weekly Sun 09:00)  ──┼──→ generate_scheduled_reports(cadence) ──→ per-shop, per-report generation
pg_cron (monthly 1st 09:00) ──┘
```

Rationale: generation is pure-SQL/plpgsql against existing Postgres-side data (`profit_cache` and related
read primitives) with no external API calls. Introducing a Supabase Edge Function (Deno runtime) would add a
second language/runtime and cold-start latency for no benefit at this stage — there is nothing here that
needs to leave Postgres. This mirrors the existing trust model already used for `apply_daily_event_count`
(WAFI-151) and `execute_rule_action` (WAFI-156): a server-authoritative `SECURITY DEFINER` function, no
direct client write path, `service_role`/cron-invoked only.

`generate_scheduled_reports(cadence)` is intentionally the **only** thing pg_cron calls. It is a thin
resolver: given a cadence, find shops with a report of that cadence due, and invoke the shared per-report
generation function for each. This keeps the door open for the shift-close trigger (or any future trigger)
to call the same per-report generation function directly, bypassing the cadence resolver.

**Explicit function-boundary invariant** — two distinct responsibilities, never merged:

- **Cadence resolver** — `generate_scheduled_reports(cadence)`. Responsible only for: determining which
  report types belong to this cadence, determining which reporting period is due (per "Period semantics"
  below), determining applicable shops, and invoking the generation primitive once per (shop, report_type,
  period). Never computes a report itself.
- **Generation primitive** — `generate_report_snapshot(shop_id, report_type, period_start, period_end)`.
  Responsible for: computing the report, constructing the canonical `Report`/`ReportSection` JSON,
  inserting the snapshot and emitting its notification atomically (see Idempotency below), and respecting
  the natural-key uniqueness constraint. This is the **only** function that ever writes a snapshot row.

This split is what makes the deferred shift-close trigger (Daily Closing and Employee Summary) a future
one-line integration rather than a redesign: `shift.closed` handler → `generate_report_snapshot(...)`
directly, never through `generate_scheduled_reports(...)`.

**Security invariants for both functions** (both are `SECURITY DEFINER`):

- A fixed `search_path` is set explicitly on function definition (e.g. `SET search_path = public, pg_catalog`)
  — never inherited from the caller — to prevent search-path hijacking.
- No unsafe dynamic SQL (`EXECUTE` on unsanitized string-built queries) where a parameterized query suffices.
- Neither function is exposed as a client-callable RPC. `service_role`/cron-invoked only — "no direct client
  write path" is an enforced invariant (no `GRANT EXECUTE` to `authenticated`/`anon`), not merely a stated
  intention.
- `shop_id` is always resolved from server-side data the resolver already determined is due — the generation
  primitive never accepts an arbitrary caller-supplied `shop_id` from a context that could be untrusted.
  Even though no client path exists today, the function must not be written in a way that would silently
  become exploitable if a future ticket added one.

### Schedule scope (v1)

Fixed defaults per the original spec, applied to all shops, all in UTC. Period is the completed preceding
window as of the trigger time — see "Period semantics" below for the exact boundary rule per cadence.

| Report | Cadence | Trigger (v1) | Period covered |
|---|---|---|---|
| Daily Closing | daily | 00:00 UTC (shift-close trigger deferred, see Non-goals) | previous UTC calendar day |
| Cash Flow Report | daily | 00:00 UTC | previous UTC calendar day |
| Weekly Summary | weekly | Sunday 09:00 UTC | preceding completed Mon–Sun UTC calendar week (the week that ended the day before, not the trigger day's own week) |
| Inventory Health | weekly | Sunday 09:00 UTC | preceding completed Mon–Sun UTC calendar week |
| Discount Report | weekly | Sunday 09:00 UTC | preceding completed Mon–Sun UTC calendar week |
| Returns Report | weekly | Sunday 09:00 UTC | preceding completed Mon–Sun UTC calendar week |
| Credit Report | weekly | Sunday 09:00 UTC | preceding completed Mon–Sun UTC calendar week |
| Dead Stock Report | weekly | Sunday 09:00 UTC | preceding completed Mon–Sun UTC calendar week |
| Monthly Business Health | monthly | 1st 09:00 UTC | previous calendar month (full 1st–last day) |
| Profit Trend Report | monthly | 1st 09:00 UTC | previous calendar month |
| Top Customers Report | monthly | 1st 09:00 UTC | previous calendar month |
| Top Products Report | monthly | 1st 09:00 UTC | previous calendar month |

**Employee Summary (the 13th report) is deliberately absent from this table.** Its source spec
(`WAFI_Event_Driven_Platform_Plan_v1.md:679`) defines it as "generated per staff at shift close" — it has no
wall-clock cadence at all; it is purely event-triggered, once per staff member, at shift close. It is not an
unresolved gap in this table — it simply does not belong in a wall-clock schedule, and is deferred alongside
Daily Closing's shift-close trigger (see Non-goals) to the same later event-driven integration ticket.

**Schema caveat for that future ticket:** the v1 natural key `(shop_id, report_type, period_start,
period_end)` cannot uniquely identify an Employee Summary snapshot, because Employee Summary is per staff
member per shift — two different staff members' reports for the same shop and the same shift window would
collide on this key. This key is sufficient for v1's wall-clock-generated reports only; the future
shift-close integration ticket must extend the snapshot identity (e.g. adding a `staff_id`/`shift_id`
dimension) rather than assume the v1 key generalizes as-is.

No settings screen, no per-shop override, in v1.

### Period semantics

Generation always covers a **completed** window as of the trigger time, never the in-progress current
period. All periods are **half-open intervals**: `period_start <= timestamp < period_end`. This avoids any
assumption about sub-second precision at a boundary (no `23:59:59.999999` reasoning) and composes cleanly
in SQL (`WHERE ts >= period_start AND ts < period_end`).

- **Daily** (00:00 UTC trigger): `[previous UTC calendar day 00:00:00, trigger day 00:00:00)`. E.g. a
  2026-08-20 00:00 UTC trigger covers `[2026-08-19 00:00:00, 2026-08-20 00:00:00)`. At the moment the cron
  fires, "today" has zero elapsed data, so the report describes the day that just ended.
- **Weekly** (Sunday 09:00 UTC trigger): `[preceding Monday 00:00:00, following Monday 00:00:00)` — the
  Mon–Sun week that ended the day *before* the trigger day, not the trigger day's own week (at Sunday 09:00,
  that day's own week has only had 9 hours elapsed — using it would include ~15 hours of the future). E.g. a
  trigger on Sunday 2026-08-23 09:00 UTC covers `[2026-08-10 00:00:00, 2026-08-17 00:00:00)` — the week of
  Mon 2026-08-10 through Sun 2026-08-16.
- **Monthly** (1st 09:00 UTC trigger): `[first day of previous calendar month 00:00:00, first day of current
  calendar month 00:00:00)`.

This is a formal rule the generation function enforces, not something left to be inferred from the cron
expression — pgTAP boundary tests assert exact `period_start`/`period_end` values per cadence, including the
weekly off-by-one-week case above.

### Idempotency

A unique constraint on `(shop_id, report_type, period_start, period_end)` on the snapshot table is the
authoritative duplicate-prevention mechanism — not the scheduler, not a run log. Generation is
**insert-if-absent, no-op-on-conflict** (deliberately not called an "upsert" — that term implies an update
path, and this design explicitly forbids replacing an existing snapshot): if a snapshot already exists for
that natural key, the call is a safe no-op, never a second snapshot and never a replacement. This makes safe
by construction:
- pg_cron retrying a failed/timed-out job
- Manual re-invocation of `generate_scheduled_reports` for operational recovery
- Future additional triggers (shift-close) racing or duplicating the midnight run for the same period

Regenerating a snapshot because its source data was corrected is a distinct, explicit future operation
(not built in v1) — not a side effect of retry logic.

**Atomicity invariant:** the snapshot insert and its corresponding "report ready" notification insert must
occur in the same PostgreSQL transaction, inside `generate_report_snapshot(...)`. The notification is
created only when the snapshot insert actually creates a new row (not on a no-op conflict). If either insert
fails, the whole transaction rolls back and a retry safely re-attempts both together. Without this rule, a
snapshot committed in one transaction followed by a notification insert that fails separately would leave a
permanently notification-less snapshot — a later retry would see the snapshot already exists, no-op, and
never emit the notification. The notification's own unique natural key (e.g. on the snapshot's id, or the
same `(shop_id, report_type, period_start, period_end)`) is kept as defense-in-depth, not as the primary
correctness mechanism — the transaction boundary is.

### Persisted artifact

New table (name TBD at migration-writing time, e.g. `generated_reports`):

| Column | Notes |
|---|---|
| `shop_id` | |
| `report_type` | one of the 13 report identifiers already defined in 147A |
| `period_start`, `period_end` | the reporting period this snapshot covers |
| `generated_at` | timestamp of generation |
| `report_schema_version` | integer; lets the `Report`/`ReportSection` contract evolve without invalidating old snapshots' meaning |
| `report_data` | jsonb — the full computed `Report`/`ReportSection` JSON, matching 147A's existing contract exactly |

Unique constraint: `(shop_id, report_type, period_start, period_end)`.

Server-side generation functions reimplement the needed data primitives in SQL/plpgsql and construct the
same `Report`/`ReportSection` JSON shape 147A's client-side `compute()` functions produce. This is a
parity requirement, not a code-sharing one — verify via contract tests comparing server-generated JSON
against 147A's live-computed JSON for equivalent inputs, per report type, during implementation.

**What "parity" means, precisely:** given equivalent fixture data and identical reporting period boundaries,
the server-generated snapshot must be structurally and semantically equivalent to 147A's live
`Report`/`ReportSection` output — not necessarily byte-for-byte identical JSON (property ordering or
serialization details that aren't part of the UI contract don't need to match). Contract tests assert:
same sections present, same fields per section, same values, same row/column ordering where ordering is
part of what the UI renders, same totals/calculations, and same empty-state behavior (e.g. a section with
no data renders the same "nothing to show" state either way).

### In-app notification

On successful generation (new snapshot row actually inserted, not a no-op), emit a lightweight in-app
signal — e.g. a row in an existing/new notifications mechanism — indicating a given report is ready. This is
a downstream consumer of a successful snapshot, not the scheduler's core responsibility. Exact mechanism
(dedicated table vs. reuse of an existing notification system, if one exists) to be determined during
implementation planning by checking current notification infrastructure in the codebase.

**Recipient resolution is decoupled from the snapshot.** The snapshot itself has no dependency on who gets
notified — it is keyed only by shop/report/period. Notification delivery separately resolves which
authorized users (owner, and potentially manager/staff depending on the shop's existing
authorization/notification model) are eligible recipients for that shop's "report ready" signal at the time
the notification is created. Keeping the artifact recipient-agnostic is deliberate: it is what lets WAFI-147C
later attach a different delivery audience/channel (WhatsApp) to the same snapshot without touching how the
snapshot itself is produced.

This also defines the producer boundary WAFI-147C will need later:

```
generate_scheduled_reports (pg_cron)
        │
        ▼
  snapshot inserted (or no-op)
        │
        ├──→ in-app "report ready" notification   (WAFI-147B, this spec)
        │
        └──→ WhatsApp delivery                     (WAFI-147C, later — blocked on WhatsApp Business API)
```

### Read path (147A viewer)

Snapshot-first with live fallback:

1. Owner opens a report for a given period in the existing Reports viewer.
2. If a snapshot exists for `(shop_id, report_type, period_start, period_end)`, serve it directly — instant,
   no computation.
3. If no snapshot exists (period hasn't reached its scheduled generation time yet, or the shop predates
   147B's rollout, or the report type doesn't yet have server-side generation implemented), fall back to
   147A's existing live-compute path, unchanged.

No broken or missing-report states are introduced. No migration is required for historical shops/periods.

**Implementation-scope note:** this is not migrations/SQL-only work. The existing Reports viewer (147A)
needs a small, explicit client-side change to implement step 2 above — check for a matching snapshot before
falling through to the existing `compute()` call. This must be listed as implementation scope, not assumed
to happen incidentally.

## Testing

- pgTAP coverage for `generate_scheduled_reports` (correct shops/report-types/period resolved per cadence)
  and `generate_report_snapshot` (idempotency — calling twice for the same natural key produces exactly one
  row and one notification; the snapshot+notification atomicity invariant — a forced failure after the
  snapshot insert rolls back the snapshot too, so a retry can safely redo both; and exact period-boundary
  values per cadence, per the Period semantics section above — including the weekly case explicitly, since
  it is the one most likely to regress to an off-by-one-week error).
- Security tests: confirm neither function is `EXECUTE`-granted to `authenticated`/`anon`, and that
  `search_path` is fixed on both function definitions.
- Contract tests comparing server-generated `Report`/`ReportSection` JSON against 147A's existing
  live-computed JSON for equivalent fixture data, per report type.
- Same recurring limitation as WAFI-150/151/143: no live Postgres/Supabase instance reachable in a sandboxed
  session — pg_cron scheduling itself (does the job actually fire at the configured time) can only be
  hand-verified against a real Supabase project, not exercised in an automated test.

## Follow-up tickets (to be filed, not silently deferred)

Ticket IDs are not yet created; each `TBD` below must be replaced with a real ticket ID before this spec is
treated as closed, so these don't silently rot into undocumented "later" work.

1. `TBD` — Per-shop configurable report schedules (replaces fixed defaults; UI + storage + validation).
2. `TBD` — Shop-local timezone-correct scheduling (depends on populating `shops.timezone` authoritatively).
3. `TBD` — Shift-close event trigger for Daily Closing and Employee Summary, both calling
   `generate_report_snapshot(...)` directly per shift, bypassing the cadence resolver.
4. WAFI-147C — automated WhatsApp delivery, consuming the snapshot producer boundary defined here — blocked
   on WhatsApp Business API setup.
