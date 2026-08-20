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
- **Daily Closing's shift-close event trigger.** The spec names a dual trigger ("generated at shift close or
  midnight"). v1 implements the midnight wall-clock path only. The shift-close trigger is deferred to a later
  event-driven integration ticket, which will call the same idempotent generation function this spec defines.
  Whether that integration is a direct event consumer or routes through WAFI-156's Business Rules Engine is
  a decision for that later ticket, not this one.
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

### Schedule scope (v1)

Fixed defaults per the original spec, applied to all shops, all in UTC:

| Report | Cadence | Trigger (v1) |
|---|---|---|
| Daily Closing | daily | midnight UTC only (shift-close deferred) |
| Cash Flow Report | daily | midnight UTC |
| Weekly Summary | weekly | Sunday 09:00 UTC |
| Inventory Health | weekly | Sunday 09:00 UTC |
| Discount Report | weekly | Sunday 09:00 UTC |
| Returns Report | weekly | Sunday 09:00 UTC |
| Credit Report | weekly | Sunday 09:00 UTC |
| Dead Stock Report | weekly | Sunday 09:00 UTC |
| Monthly Business Health | monthly | 1st 09:00 UTC |
| Profit Trend Report | monthly | 1st 09:00 UTC |
| Top Customers Report | monthly | 1st 09:00 UTC |
| Top Products Report | monthly | 1st 09:00 UTC |

(13 reports named in the source spec; confirm the 13th — Employee Summary — cadence against
`WAFI_Event_Driven_Platform_Plan_v1.md:639-786` during implementation planning if not already covered above.)

No settings screen, no per-shop override, in v1.

### Idempotency

A unique constraint on `(shop_id, report_type, period_start, period_end)` on the snapshot table is the
authoritative duplicate-prevention mechanism — not the scheduler, not a run log. Generation is an
upsert-that-no-ops-on-conflict: if a snapshot already exists for that natural key, the call is a safe no-op,
never a second snapshot and never a replacement. This makes safe by construction:
- pg_cron retrying a failed/timed-out job
- Manual re-invocation of `generate_scheduled_reports` for operational recovery
- Future additional triggers (shift-close) racing or duplicating the midnight run for the same period

Regenerating a snapshot because its source data was corrected is a distinct, explicit future operation
(not built in v1) — not a side effect of retry logic.

The "report ready" in-app notification insert must independently be idempotent against the snapshot's
natural key, so a cron retry that finds an existing snapshot (no-op) does not re-fire the notification, and
so a notification is never sent before its snapshot exists.

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

### In-app notification

On successful generation (new snapshot row actually inserted, not a no-op), emit a lightweight in-app
signal — e.g. a row in an existing/new notifications mechanism — informing the owner a given report is
ready. This is a downstream consumer of a successful snapshot, not the scheduler's core responsibility.
Exact mechanism (dedicated table vs. reuse of an existing notification system, if one exists) to be
determined during implementation planning by checking current notification infrastructure in the codebase.

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

## Testing

- pgTAP coverage for `generate_scheduled_reports` and the per-report generation functions: idempotency
  (calling twice for the same period produces one row), correct period boundaries, correct notification
  emission (once, only on actual insert).
- Contract tests comparing server-generated `Report`/`ReportSection` JSON against 147A's existing
  live-computed JSON for equivalent fixture data, per report type.
- Same recurring limitation as WAFI-150/151/143: no live Postgres/Supabase instance reachable in a sandboxed
  session — pg_cron scheduling itself (does the job actually fire at the configured time) can only be
  hand-verified against a real Supabase project, not exercised in an automated test.

## Follow-up tickets (to be filed, not silently deferred)

1. Per-shop configurable report schedules (replaces fixed defaults; UI + storage + validation).
2. Shop-local timezone-correct scheduling (depends on populating `shops.timezone` authoritatively).
3. Daily Closing shift-close event trigger, calling the same idempotent generation function as the
   midnight cron path.
4. WAFI-147C: automated WhatsApp delivery, consuming the snapshot producer boundary defined here — blocked
   on WhatsApp Business API setup.
