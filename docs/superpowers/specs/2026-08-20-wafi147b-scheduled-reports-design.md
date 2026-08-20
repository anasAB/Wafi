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

The 13 reports specified in `WAFI_Event_Driven_Platform_Plan_v1.md:639-786` comprise **12 reports with a
wall-clock schedule** (e.g. "generated at midnight," "every Sunday at 9 AM," "1st of month at 9 AM") and
**one purely event-triggered report, Employee Summary**, generated per staff member at shift close with no
wall-clock component at all (see Schedule scope below). No mechanism in this codebase can execute anything
independent of the app being open: WAFI-154's `local_deferred_jobs` queue is local-only, drained on
app-foreground/PowerSync-reconnect. No `pg_cron`, no Supabase Edge Function, no server-side scheduled-job
mechanism exists anywhere today. This is the gap WAFI-147B closes, for the 12 wall-clock reports.

147A's `compute()` functions are client-oriented (call Vue composables, PowerSync, Dexie-adjacent client code)
and are not directly reusable server-side. WAFI-147B reimplements the needed primitives in SQL/plpgsql and
must match 147A's output contract, verified by contract tests — not by sharing code.

## Goals

- Execute report generation at wall-clock times independent of whether any client app is open.
- Produce a durable, versioned, self-describing report snapshot for each v1 wall-clock-generated
  shop/report/period (the 12 reports in Schedule scope below — not Employee Summary, which is out of scope
  for this ticket) that 147A's existing Reports viewer can render with no new client-side computation.
- Establish a producer boundary (persisted snapshot) that a future WAFI-147C delivery mechanism can consume
  without needing to understand accounting queries.
- Make report generation safe under retries, manual re-runs, missed/delayed execution, and (later)
  additional trigger paths — including one item's own error never aborting other items' processing in the
  same run (see Failure isolation below for the precise transactional guarantee this does and does not
  provide).
- State explicitly what a scheduled snapshot does and does not guarantee about data finality, so this isn't
  left as an unstated assumption for implementation to discover.

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
  schedule resolution, not the 12 report-generation functions.
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
needs to leave Postgres.

**Correction on trust-model precedent:** an earlier draft of this spec claimed this mirrors
`apply_daily_event_count` (WAFI-151) and `execute_rule_action` (WAFI-156) as "server-authoritative,
service_role/cron-invoked only" precedent. That comparison doesn't hold — checked directly against their
migrations, both of those functions are `GRANT EXECUTE ... TO authenticated` (and `apply_daily_event_count`
additionally to `anon`), because both are legitimately client-invoked (PowerSync ops path, business-rule
triggers). Neither is an example of a cron/service-only function in this codebase today; 147B introduces
that pattern fresh, it doesn't reuse an existing one. Per pg_cron's own model, a scheduled job runs with the
permissions of whatever database role scheduled it (stored as job metadata, defaulting to `current_user` at
schedule time) — there is no generic Postgres concept of "the cron role." The concrete requirement is
therefore: **a dedicated trusted database role schedules and owns these jobs**, and only that role (plus the
functions' owner) has `EXECUTE` on `generate_scheduled_reports`/`generate_report_snapshot`. `authenticated`
and `anon` have no `EXECUTE` grant on either. Which specific role that is (e.g. a Supabase-project-level
service/admin role vs. a newly created dedicated role) is an implementation decision to make against the
actual target Supabase project's available roles — not assumed here as `service_role` specifically.

**Deployment prerequisite (verify before finalizing the migration):** a non-superuser role scheduling/owning
pg_cron jobs needs appropriate access to the `cron` schema and its objects on a managed Supabase project —
this is not automatically available to every role by default. Before the migration creating these jobs is
finalized, verify against the actual target Supabase project which roles can create/own cron jobs, and
choose the dedicated role accordingly; do not assume the spec's intended role model is available until that
is checked against the real environment.

**Implementation invariant — cron scheduler timezone.** pg_cron's default scheduler timezone is GMT and is
configurable via `cron.timezone`; Supabase Cron is built directly on pg_cron, and Supabase Postgres projects
themselves default to UTC. The effective pg_cron scheduler timezone must be verified as UTC before scheduling
the jobs — the SQL cron expressions (`0 0 * * *`, etc.) must not rely on an unverified instance timezone
matching UTC by coincidence. If the target environment's effective cron timezone differs, configure
`cron.timezone` appropriately if permitted, or otherwise ensure the schedules execute at the specified UTC
times (e.g. by offsetting the cron expressions to compensate) — a managed Supabase project may not permit
changing this server-level setting, so this is a verify-and-adapt step, not an assumed configuration change.

`generate_scheduled_reports(cadence)` is intentionally the **only** thing pg_cron calls. It is a thin
resolver: given a cadence, find shops with a report of that cadence due, and invoke the shared per-report
generation function for each. This keeps the door open for the shift-close trigger (or any future trigger)
to call the same per-report generation function directly, bypassing the cadence resolver.

**Explicit function-boundary invariant** — two distinct responsibilities, never merged:

- **Cadence resolver** — `generate_scheduled_reports(cadence, scheduled_for timestamptz DEFAULT NULL)`. The
  slot is a first-class parameter, not an internal detail: when pg_cron invokes it with no argument, the
  function resolves `scheduled_for` to the most recent canonical slot at-or-before actual execution time
  (per Scheduled-slot semantics below); when a caller passes `scheduled_for` explicitly, that exact slot is
  used instead — this is what makes retry-the-same-slot and recover-a-specific-missed-slot a direct call
  with an explicit argument, not an internal behavior recovery has to reason about indirectly. Responsible
  for: determining which report types belong to this cadence, deriving the reporting period from the
  resolved `scheduled_for` (per "Period semantics" below — never from bare `now()`), determining applicable
  shops (defined precisely below), and invoking the generation primitive once per (shop, report_type,
  period), isolating each call's failure per "Failure isolation" below. Never computes a report itself.
- **Generation primitive** — `generate_report_snapshot(shop_id, report_type, period_start, period_end,
  scheduled_for)`. Responsible for: computing the report, constructing the canonical `Report`/`ReportSection`
  JSON, inserting the snapshot and emitting its per-recipient notifications atomically (see Idempotency
  below), and respecting the natural-key uniqueness constraint. **Within WAFI-147B v1**, this is the only
  function that ever writes a snapshot row — a future correction/regeneration ticket (see Data-finality
  policy's follow-up) will necessarily introduce another server-side write path when it's built and
  separately reviewed; this is a v1 scope statement, not a permanent architectural rule. `scheduled_for` is
  nullable/omittable for future non-wall-clock callers (e.g. the deferred shift-close integration), which
  have no scheduled slot to record.

  **Input-coherence validation invariant:** the natural-key uniqueness constraint prevents *duplicate*
  snapshots, but says nothing about whether `(report_type, period_start, period_end, scheduled_for)` is
  itself a *sensible* combination — a trusted caller could otherwise pass, e.g., `report_type =
  'weekly_summary'` with a one-day period and a Sunday `scheduled_for`, and the database would accept it
  silently. For v1's wall-clock report types (the 12 in Schedule scope below, when `scheduled_for` is
  non-null), `generate_report_snapshot` must validate that `period_start`/`period_end` are exactly what that
  `report_type`'s cadence and Period-semantics rule would derive from the given `scheduled_for` — i.e. derive
  the expected period internally from `(report_type, scheduled_for)` and reject the call if the supplied
  `period_start`/`period_end` don't match, rather than trusting the caller's period calculation independently.
  This closes the gap where correctness would otherwise depend on every caller (resolver, operator recovery)
  re-deriving Period semantics correctly on its own with no cross-check. Non-wall-clock callers (future
  shift-close, where `scheduled_for` is null) are explicitly out of this validation's scope — that future
  ticket defines its own coherence rule for event-triggered periods, not inheriting this one.

**Applicable shops (v1 definition):** a shop is eligible for scheduled generation if `shops.is_active = true`
(`001_initial_schema.sql`; defaults to `true`, no separate soft-delete column exists on `shops` today — if
one is added before implementation, re-check this predicate against the schema as it exists then). v1 does
not additionally gate on a reports-feature flag or onboarding-completeness check — every active shop gets
every report/cadence in the Schedule scope table below; per-shop opt-out/configuration is the deferred
follow-up ticket named in Non-goals.

This split is what makes the deferred shift-close trigger (Daily Closing and Employee Summary) a future
one-line integration rather than a redesign: `shift.closed` handler → `generate_report_snapshot(...)`
directly, never through `generate_scheduled_reports(...)`.

**Security invariants for both functions** (both are `SECURITY DEFINER`):

- A fixed `search_path` is set explicitly on function definition (e.g. `SET search_path = public, pg_catalog`)
  — never inherited from the caller — to prevent search-path hijacking.
- No unsafe dynamic SQL (`EXECUTE` on unsanitized string-built queries) where a parameterized query suffices.
- Neither function is exposed as a client-callable RPC. Scheduled/dedicated-role-invoked only — "no direct
  client write path" is an enforced invariant (no `GRANT EXECUTE` to `authenticated`/`anon`), not merely a
  stated intention. See the trust-model correction above the diagram: this is a fresh pattern for this
  codebase, not a reuse of an existing cron-only function.
- **Trusted-caller rule (precise version):** `generate_report_snapshot(...)` does take an explicit
  `shop_id` parameter, and that is correct — the cadence resolver, the admin-only operator recovery wrapper,
  and (later) event-trigger callers such as `shift.closed` all legitimately pass a specific shop. What the
  invariant actually forbids is an **untrusted caller supplying arbitrary shop scope**: only trusted
  server-side callers may invoke this function at all (enforced by the `EXECUTE` grant restriction above,
  not by the parameter shape), and each such caller is responsible for having independently established —
  before calling — that the (shop, report_type, period) it's requesting is one that caller is actually
  authorized to trigger (the resolver, by iterating applicable shops due for that cadence/slot; the recovery
  wrapper, by whatever admin-authorization check gates it; a future event trigger, by the event itself
  naming its own shop). No caller, trusted or not, may cause a snapshot to be generated for a shop that
  particular call path hasn't legitimately determined is in scope.

### Data-finality policy (what "generated for a completed period" means)

This is the load-bearing semantic the rest of the design depends on, and it must be stated explicitly rather
than left implied. The spec previously said both "completed preceding window" (implying the period's data
is final) and "immutable, never replaced" (implying point-in-time capture) without reconciling them —
`profit_cache`'s own apply logic (`086_profit_cache_apply.sql`) accumulates late-arriving corrections into a
day's row (e.g. a return processed after its sale day increments that day's `cogs_reversal_usd` after the
day has already "ended"), so "the wall-clock period ended" and "all data for that period has arrived" are
demonstrably not the same fact in this architecture.

**Decision: Option A — a scheduled snapshot represents the server-visible state of the report at generation
time, not a guarantee of final/settled data.** Concretely:

- A snapshot is generated once, at (approximately) the scheduled wall-clock time, using whatever
  `profit_cache`/source data is visible in Postgres at that moment.
- Late-arriving or corrected source data (e.g. a return posted after its sale's period already snapshotted)
  does **not** retroactively modify an existing snapshot. The snapshot is immutable by design (see
  Immutability below), not merely by omission.
- Regenerating/correcting a snapshot to reflect later-arriving data is a distinct, explicit future operation
  (not built in v1) — this is consistent with, and now explicitly grounds, the existing "regeneration is a
  separate operation, not a retry side effect" rule in Idempotency below.
- This is an accepted v1 trade-off, not a bug: the alternative (Option B — wait for a data-finality watermark
  before snapshotting) would require designing a settlement-boundary/finality mechanism that does not exist
  anywhere in this event-driven architecture today, which is materially larger scope than "add a scheduler."
  **Follow-up ticket required** if late-data drift in scheduled snapshots (vs. the always-current
  `profit_cache`-backed live-compute path) proves to matter in practice — e.g. a Daily Closing snapshot for
  yesterday that's already slightly stale by the time the owner reads it because a late return posted at
  00:07 UTC.

**Acceptance criterion:** snapshot-backed reports in the Reports viewer must display their `generated_at`
(and, where meaningful, `scheduled_for`) timestamp so an owner can see this is an as-of figure, not a live,
continuously-updated one — e.g. "Generated at 00:01 UTC" rather than presenting the numbers with no
indication they're a point-in-time capture. This is required UI scope for 147B, not an optional polish
item, precisely because Option A above accepts that a snapshot can silently drift from what live compute
would now show. **This applies only to the snapshot-backed case** — per the Read path's snapshot-first-with-
live-fallback model, a report that falls through to 147A's existing live-compute path (no snapshot found)
retains 147A's existing presentation exactly as-is, with no generation timestamp shown and no "as-of"
framing; it must not be described or styled as if it were snapshot-generated. The two cases must be visibly
distinguishable to the viewer, not merged into one ambiguous presentation.

### Scheduled-slot semantics and missed/delayed execution

The cadence resolver must not derive the period to generate from `now()` at the moment it happens to run.
`now()`-based derivation breaks in two realistic scenarios: (1) the resolver runs late (e.g. Supabase was
briefly unavailable at the scheduled time and pg_cron's actual execution lands an hour or a day later), and
(2) an operator manually re-invokes the resolver for recovery and has no way to specify which missed period
they mean, versus accidentally generating whatever period `now()` implies at the moment they happen to run
the recovery command.

**Decision:** the resolver's API makes the slot explicit rather than burying it as an internal computation —
`generate_scheduled_reports(cadence, scheduled_for timestamptz DEFAULT NULL)` (see the function-boundary
invariant above):

```
generate_scheduled_reports(cadence, scheduled_for)
        │
        ├── scheduled_for omitted (pg_cron's normal call) ──→ resolve most recent canonical slot
        │                                                      at-or-before actual execution time
        │
        └── scheduled_for supplied explicitly (retry / recovery-at-cadence-level) ──→ use it as-is
                        │
                        ▼
        period_start / period_end   (derived deterministically from the resolved slot + cadence,
                                      per Period semantics)
                        │
                        ▼
        generate_report_snapshot(shop_id, report_type, period_start, period_end, scheduled_for)
```

**Precise resolution rule for the omitted case:** pg_cron does not hand its target function "the timestamp
it was supposed to run at" — a job simply executes whenever pg_cron actually runs it, which may lag the
intended time. When `scheduled_for` is omitted, `generate_scheduled_reports` determines **the most recent
canonical scheduled slot for that cadence at or before the actual execution time**, using the cadence's
fixed UTC schedule (00:00 daily / Sunday 09:00 weekly / 1st 09:00 monthly). Examples: executing at Sunday
09:04 (a few minutes late) resolves to that same Sunday 09:00 slot; executing at Monday 14:00 (much later,
e.g. after an outage) still resolves to the most recent Sunday 09:00 slot, not Monday's non-existent one;
executing 8 days later still resolves to only the latest Sunday 09:00 slot — **older missed slots are not
automatically caught up** (per the missed-slot policy below).

Retrying an entire cadence run for a specific slot (e.g. after an outer-transaction failure, per Failure
isolation below) calls `generate_scheduled_reports(cadence, scheduled_for := '2026-08-23 09:00:00+00')`
explicitly — this is now a direct, unambiguous call with an explicit argument, not an internal detail the
caller has to reason about indirectly. **Per-item operator recovery is a separate, narrower path**: it calls
`generate_report_snapshot(...)` directly for one specific shop/report/period (see below), bypassing the
cadence resolver entirely — used when only a handful of items from a run need regenerating, not the whole
cadence.

**Validation invariant — an explicitly-supplied `scheduled_for` must itself be a real canonical slot for
that cadence.** Making the parameter explicit (above) would otherwise let any trusted caller pass an
arbitrary timestamp — e.g. `generate_scheduled_reports('weekly', scheduled_for := '2026-08-19 13:37 UTC')`,
a Wednesday, which corresponds to no real weekly slot at all. `generate_scheduled_reports` must reject any
supplied `scheduled_for` that does not exactly match the cadence's canonical schedule (daily: `00:00 UTC`
only; weekly: `Sunday 09:00 UTC` only; monthly: `1st-of-month 09:00 UTC` only) — validated and rejected
*before* any report generation is attempted, not discovered as a downstream artifact inconsistency. Examples:
`weekly` + Sunday 09:00 → accepted; `weekly` + Sunday 10:00 → rejected; `weekly` + any Wednesday → rejected;
`monthly` + 1st 09:00 → accepted; `monthly` + 2nd 09:00 → rejected.

**Missed-slot policy (v1): no automatic catch-up — and this behaves differently by cadence, which must be
stated explicitly rather than left to be discovered operationally.** "No automatic catch-up" means: a late
execution always resolves to the latest canonical slot at-or-before the actual execution time (per the
resolution rule above), and never anything older. Whether that silently skips an older missed slot depends
on how much time passed and how frequent the cadence is:

- **Daily**, missed Tuesday, cron finally runs Wednesday 00:00 → resolves to Wednesday's slot; **Tuesday's
  slot is silently skipped** and never generated (skipping happens after roughly one cadence period of
  delay for daily).
- **Weekly**, cron finally runs Monday 14:00 (a day and change late) → resolves to the Sunday 09:00 slot
  that already passed, so that slot **is** processed, just late; nothing is skipped in this particular
  example (skipping would only occur after more than a full week of delay).

So "no catch-up" does not mean "a late run never processes a missed slot" — it means "a late run processes
at most the single latest slot, and never reaches further back than that," which for a short delay on an
infrequent cadence can still look like the missed slot got picked up, while for a longer delay or a frequent
cadence it looks like silent skipping. Both are the same rule; only the delay-vs-cadence-period ratio
changes which one an operator observes. This is a deliberate, tracked v1 limitation: automatic detection of
"a slot should have run but didn't, regardless of what the latest slot is now" requires its own mechanism
(comparing expected slots against `cron.job_run_details`, or a small owned schedule-slot ledger).
**Follow-up ticket required** for automatic missed-slot detection/catch-up if the operational experience
shows this is needed; v1 relies on the explicit operator recovery mechanism below for the rare case where a
specific missed slot needs to be manually regenerated.

**Explicit operator recovery mechanism (replaces "manual re-invocation of `generate_scheduled_reports`
for operational recovery," which was ambiguous about which period it would target):** operational recovery
calls `generate_report_snapshot(shop_id, report_type, period_start, period_end, scheduled_for := <the
original missed slot, not NULL>)` directly (or a thin admin-only wrapper over it) for the specific,
explicitly-named shop/report/period that needs regenerating — never "re-run the weekly scheduler now," which
would resolve against the wrong (current) slot rather than the missed one. **Preserving the original
`scheduled_for` on a recovered snapshot is required, not optional**: it is what lets `generated_at` (per
`clock_timestamp()` above) and `scheduled_for` diverge meaningfully in exactly the case operators need to
see it — e.g. `scheduled_for = 2026-08-23 09:00`, `generated_at = 2026-08-24 14:12`, immediately showing the
report was generated roughly a day late. Passing `scheduled_for := NULL` on a recovered wall-clock report
would erase that operational signal.

### Failure isolation

`generate_scheduled_reports(cadence)` invokes `generate_report_snapshot(...)` once per (shop, report_type)
due for that cadence — potentially many shops × several report types in one cron firing. **A failure
generating one (shop, report_type, period) must not abort processing of the other items in the same cadence
run.** Without an explicit rule here, an uncaught exception on item 88 of 200 would propagate out of the
resolver's loop and prevent items 89-200 from ever being attempted — a correctness bug, not merely an
inefficiency. (See below for the precise, narrower-than-it-sounds transactional guarantee this actually
provides once an exception is caught.)

**Decision (Option A — accepted for v1, stated precisely rather than overclaimed):** each
`generate_report_snapshot(...)` call is wrapped in a `BEGIN...EXCEPTION WHEN OTHERS` block inside the
resolver's per-item loop. PL/pgSQL's exception block is a genuine subtransaction boundary — an exception in
one item is caught there and does not abort the other items in the same top-level call — but PostgreSQL
does not allow transaction control (`COMMIT`) inside such a block; that is only available from a top-level
`CALL`/`DO` procedure context. **The actual guarantee this gives is narrower than "each item commits
independently," and the spec must not claim otherwise:**

- A failed item's exception is caught and does not abort the other items *within the same
  `generate_scheduled_reports(cadence)` invocation* — its subtransaction rolls back, the loop continues.
- All items processed in that invocation — the successful ones and the logged-and-skipped failed ones —
  remain part of one outer transaction that commits together only when `generate_scheduled_reports(cadence)`
  itself completes and its top-level call commits.
- If the *overall* cron invocation crashes or is killed before that outer transaction commits (e.g. the
  connection drops mid-run, not merely one item failing), everything processed so far in that run — including
  otherwise-successful items — rolls back with it, uncommitted.
- **Recovery from that catastrophic case relies on idempotent re-execution**, not on any per-item durability
  guarantee: re-invoking `generate_scheduled_reports(cadence, scheduled_for := <the same slot>)` — the
  explicit-slot form, not a bare re-run that would resolve against whatever the *current* latest slot
  happens to be by the time someone retries — safely regenerates whatever didn't make it into a committed
  transaction, and no-ops on whatever did (per the Idempotency natural key). This is why the Idempotency and
  Scheduled-slot mechanisms above are load-bearing here, not optional hardening — they are literally what
  makes Option A's outer-transaction model recoverable.
- **Option B (true per-item durability, each item committing independently regardless of the outer
  invocation's fate) would require a different execution mechanism** — e.g. a top-level procedure issuing
  explicit `COMMIT` per item, or invoking `generate_report_snapshot(...)` as separate top-level calls rather
  than from within one resolver invocation — which is a larger architecture change not justified for v1
  given how rare a mid-run crash actually is in practice, and given that idempotent re-execution already
  covers it.

What this construction *does* still guarantee, correctly: one item's own data/logic error (e.g. a malformed
report computation for one shop) never prevents the other items in the same run from succeeding — that
was, and remains, the real problem this section solves. What changed is only the honesty of the claim about
the crash case.

### Schedule scope (v1)

Fixed defaults per the original spec, applied to all shops, all in UTC. Period is the preceding calendar
reporting window as of the trigger time — see "Period semantics" below for the exact boundary rule per
cadence. ("Preceding calendar window" describes wall-clock boundaries only; it does not imply the
underlying data is finalized — see Data-finality policy below.)

**147B v1 implements exactly 12 generation types: 2 daily + 6 weekly + 4 monthly** (the rows below).
Employee Summary is the 13th report named in the original source spec overall, but it is event-triggered
with no wall-clock cadence and is excluded from 147B entirely (see above) — so "12" and "13" are both
correct depending on which count is being referenced, and this spec uses "12" for anything scoped to what
147B actually generates.

| Report | Cadence | Trigger (v1) | Period covered |
|---|---|---|---|
| Daily Closing | daily | 00:00 UTC (shift-close trigger deferred, see Non-goals) | previous UTC calendar day |
| Cash Flow Report | daily | 00:00 UTC | previous UTC calendar day |
| Weekly Summary | weekly | Sunday 09:00 UTC | preceding Mon–Sun UTC calendar week (the week that ended the day before, not the trigger day's own week) |
| Inventory Health | weekly | Sunday 09:00 UTC | preceding Mon–Sun UTC calendar week |
| Discount Report | weekly | Sunday 09:00 UTC | preceding Mon–Sun UTC calendar week |
| Returns Report | weekly | Sunday 09:00 UTC | preceding Mon–Sun UTC calendar week |
| Credit Report | weekly | Sunday 09:00 UTC | preceding Mon–Sun UTC calendar week |
| Dead Stock Report | weekly | Sunday 09:00 UTC | preceding Mon–Sun UTC calendar week |
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

Generation always covers a **preceding calendar reporting window** as of the trigger time, never the
in-progress current period — this is a statement about wall-clock boundaries, not about the underlying
data being final (see Data-finality policy above; "completed window" is deliberately avoided as terminology
here since it invites exactly that false inference). All periods are **half-open intervals**:
`period_start <= timestamp < period_end`. This avoids any assumption about sub-second precision at a
boundary (no `23:59:59.999999` reasoning) and composes cleanly in SQL
(`WHERE ts >= period_start AND ts < period_end`).

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
- Scheduler re-runs or operational retries after a failed/timed-out execution (pg_cron records run status and
  prevents overlapping concurrent executions of the same job, but does not itself provide an
  application-level retry guarantee — the safety property here is that whatever re-runs the job, at whatever
  layer, is always safe to do)
- Manual operator recovery calling `generate_report_snapshot(...)` directly for a specific missed
  shop/report/period (per the explicit operator recovery mechanism in Scheduled-slot semantics below —
  not re-invocation of `generate_scheduled_reports` itself, which would resolve against the wrong slot)
- Future additional triggers (shift-close) racing or duplicating the midnight run for the same period

Regenerating a snapshot because its source data was corrected is a distinct, explicit future operation
(not built in v1) — not a side effect of retry logic.

**Atomicity invariant (extended to cover the staff-section table, not just the main snapshot):** for the 4
composite report types, the artifact is now three parts — the main snapshot, its associated
`generated_report_staff_sections` row, and all "report ready" notification rows — and all three must be
inserted in the same PostgreSQL transaction inside `generate_report_snapshot(...)`. For the other 8 report
types, it's just the main snapshot + notifications, as before. The notification(s) are created only when the
main snapshot insert actually creates a new row (not on a no-op conflict). If any required insert fails —
the main snapshot, the staff-section row (when applicable), or any recipient's notification — the whole
transaction rolls back and a retry safely re-attempts all of it together. Without this extension, an
implementation could produce `main snapshot ✓, staff-section row ✗, notifications ✓, COMMIT` — a committed
snapshot whose associated gated data silently never got created, which the natural-key idempotency check
alone would not catch (the main snapshot already "exists," so a retry would no-op on it while the missing
staff section stays missing forever). Without this rule, a
snapshot committed in one transaction followed by a notification insert that fails separately would leave a
permanently notification-less snapshot — a later retry would see the snapshot already exists, no-op, and
never emit the notification. Each recipient notification is independently idempotent on
`(snapshot_id, recipient_user_id)` — not on the snapshot alone. A single snapshot can have multiple eligible
recipients (owner, and potentially manager/staff per the shop's authorization model — see In-app
notification below), so the natural key must include the recipient: `generate_report_snapshot(...)` resolves
eligible recipients and inserts one notification row per recipient, each independently no-op-on-conflict
against `(snapshot_id, recipient_user_id)`. This is kept as defense-in-depth per recipient, not as the
primary correctness mechanism — the transaction boundary is — while still allowing the same snapshot to
correctly notify multiple distinct users.

**Explicit failure rule:** since snapshot insert, recipient resolution, and all per-recipient notification
inserts happen in one transaction, a failure inserting *any* required recipient's notification rolls back
the entire transaction, including the snapshot itself — v1 does not permit a snapshot to exist in a
partially-notified state (e.g. 2 of 3 eligible recipients notified). This is a direct consequence of the
atomicity invariant already chosen above, stated explicitly here so a future change doesn't casually decide
"one malformed recipient shouldn't block report generation" without recognizing that would be a deliberate
weakening of this invariant, not a bug fix.

**Explicit distinction — creating a missing snapshot vs. correcting an existing one:** `generate_report_
snapshot(...)`'s insert-if-absent behavior is only ever valid for the first case. "A scheduled/missed slot
has no snapshot yet" (the resolver's normal case, and operator recovery's case) → calling
`generate_report_snapshot(...)` is the correct, allowed operation, and it succeeds by creating the row.
"A snapshot already exists but its underlying data needs correcting" (e.g. late-arriving data per the
Data-finality policy, or any other reason an existing snapshot might be considered stale/wrong) →
`generate_report_snapshot(...)` is **not** the right tool for this and will only ever no-op against it,
never modify it — correction requires the distinct future operation named in the Data-finality policy's
follow-up ticket, not a workaround built out of the v1 primitive. An operator should not attempt to "recover"
an existing-but-stale snapshot by calling `generate_report_snapshot(...)` expecting it to update anything.

### Persisted artifact

New table (name TBD at migration-writing time, e.g. `generated_reports`):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `shop_id` | `uuid NOT NULL REFERENCES shops(id)` | |
| `report_type` | `text NOT NULL` — constrained via a `CHECK` against a fixed list (or an actual Postgres `enum`; decide which at migration-writing time against how 147A's own report-type identifiers are already represented in the codebase, and reuse that representation rather than inventing a second) to **only the 12 wall-clock report identifiers this ticket implements** (the Schedule scope table below) — deliberately **not** all 13. Employee Summary must not be a valid value in the v1 constraint: its snapshot identity needs a `staff_id`/`shift_id` dimension this table doesn't have (see the schema caveat below), so allowing it as a value here would let a row be inserted that the natural key can't actually disambiguate. The future shift-close ticket extends both the constraint and the identity together, not the constraint alone. | |
| `period_start`, `period_end` | `timestamptz NOT NULL` each | half-open interval per Period semantics; `CHECK (period_start < period_end)` |
| `scheduled_for` | `timestamptz` (nullable) | the scheduled slot this snapshot was generated for (per Scheduled-slot semantics above) — distinct from `generated_at`; null for non-wall-clock-triggered snapshots (future shift-close callers) |
| `generated_at` | `timestamptz NOT NULL DEFAULT clock_timestamp()` | when generation actually ran, per-row — see the `clock_timestamp()` note below; may lag `scheduled_for` if the job ran late |
| `report_schema_version` | `integer NOT NULL` | see schema-version compatibility rule below |
| `report_data` | `jsonb NOT NULL` | the full computed `Report`/`ReportSection` JSON, matching 147A's existing contract exactly |

Unique constraint: `(shop_id, report_type, period_start, period_end)`.

**`generated_at` must use `clock_timestamp()`, not `now()`.** PostgreSQL's `now()`/`CURRENT_TIMESTAMP`
returns the *transaction's* start time, not wall-clock time at the moment a given statement executes. Since
`generate_scheduled_reports(cadence)` processes many (shop, report_type) items — potentially inside one
outer transaction per the Failure isolation model above — a `DEFAULT now()` column would record the same
timestamp (the resolver's transaction start) on every row in that run, even though item 200 actually
finished minutes after item 1. That directly contradicts this column's stated meaning ("when generation
actually ran"). `clock_timestamp()` returns the true current wall-clock time regardless of transaction
state and must be used instead, either as the column default or assigned explicitly inside
`generate_report_snapshot(...)` immediately before the insert.

**Immutability is schema-enforced, not merely a code convention.** No application code path performs
`UPDATE`/`DELETE` on this table in v1 by design (per the Data-finality policy above) — this must be backed
by an actual enforced boundary, not just an unwritten rule: no `UPDATE`/`DELETE` grants to any client role,
and the only server-side write path (`generate_report_snapshot`'s insert-if-absent) never issues `UPDATE` or
`DELETE` itself. If a future ticket needs a correction/regeneration path (per the Data-finality policy's
follow-up), it must be a new, explicit, separately-reviewed operation — not a capability quietly available
because the table happened to allow writes.

**Second table for gated section content (`generated_report_staff_sections`):** per the Read authorization
section below, the 4 composite report types with a `can_view_staff_performance`-gated section (Weekly
Summary, Monthly Business Health, Discount Report, Returns Report) never include that section's content in
the main table's `report_data`. Instead:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `generated_report_id` | `uuid NOT NULL REFERENCES generated_reports(id)` | the main snapshot this section belongs to; one-to-one |
| `shop_id` | `uuid NOT NULL REFERENCES shops(id)` | denormalized from the parent row rather than requiring a join purely to evaluate RLS/sync-rule scope — must always equal the parent `generated_reports.shop_id` for the same `generated_report_id` (enforce via the same transaction that inserts both, per Atomicity below; a mismatch would be a bug, not a legitimate state) |
| `section_data` | `jsonb NOT NULL` | the gated `ReportSection`'s content only, same JSON shape as any other section |

Unique constraint: `(generated_report_id)` (one gated-section row per main snapshot, when one exists — the
other 8 v1 report types never get a row here at all). RLS: `shop_id = auth_shop_id() AND
public.can('can_view_staff_performance')` — see Read authorization below for why `public.can(...)` (this
codebase's existing single-call-site permission-check primitive) is the correct predicate here, not a raw
role check or shop scope alone.

**Schema-version compatibility rule.** `report_schema_version = 1` for all v1 snapshots. The rule going
forward: the Reports viewer must continue to correctly render every schema version it may encounter in
stored data, or perform an explicit version-adaptation step before rendering — a schema version may not be
retired from the viewer's rendering support while snapshots using it still exist and remain readable. A
future version bump is a viewer capability addition, not a silent replacement of what the current viewer
understands.

Server-side generation functions reimplement the needed data primitives in SQL/plpgsql and construct the
same `Report`/`ReportSection` JSON shape 147A's client-side `compute()` functions produce. This is a
parity requirement, not a code-sharing one — verify via contract tests comparing server-generated JSON
against 147A's live-computed JSON for equivalent inputs, per report type, during implementation.

**What "parity" means, precisely — and why it must be defined per report type given the split-table design:**
an earlier draft defined parity as one blanket rule ("the server-generated snapshot must be structurally
and semantically equivalent to 147A's live output"), which is no longer true as stated once the 4 composite
reports' gated section lives in a separate table — the main snapshot alone is *by design* missing a section
147A's live output includes for an owner. The rule must distinguish **storage-representation parity**
(what's persisted) from **rendered-report parity** (what a given viewer ends up seeing), and state each
precisely:

- **The 8 v1 report types with no gated section:** storage-representation parity is the whole story —
  `generated_reports.report_data` alone must be structurally and semantically equivalent to 147A's live
  `Report`/`ReportSection` output for the same period, for any viewer (there's nothing to vary by viewer).
- **The 4 composite report types with a gated section (Weekly Summary, Monthly Business Health, Discount
  Report, Returns Report):** parity is defined per viewer authorization state, not as one artifact:
  - For a viewer **with** `can_view_staff_performance`: the *composition* of
    `generated_reports.report_data` + the (authorized) `generated_report_staff_sections.section_data` must
    be equivalent to 147A's live output for an owner-equivalent viewer.
  - For a viewer **without** `can_view_staff_performance`: `generated_reports.report_data` **alone** must be
    equivalent to 147A's live output for that same restricted viewer (i.e. 147A's own section-omitted
    output, not the full one).
  - `generated_reports.report_data` is therefore never expected to equal 147A's *full* live output for
    these 4 report types on its own — that is by design, not a parity gap.

In both cases, "equivalent" means structurally and semantically equivalent — not necessarily byte-for-byte
identical JSON (property ordering or serialization details outside the UI contract don't need to match).
Contract tests assert: same sections present (for the applicable viewer state), same fields per section,
same values, same row/column ordering where ordering is part of what the UI renders, same
totals/calculations, and same empty-state behavior.

### Read authorization (RLS) and sync/read mechanism

The snapshot table must not be readable across shop boundaries — it holds precomputed financial/reporting
data. `profit_cache` (`086_profit_cache_apply.sql`) is the precedent for the *shop-scope* half of this
(`profit_cache_select_own_shop ON public.profit_cache FOR SELECT USING (shop_id = public.auth_shop_id())`),
but that precedent is not sufficient here on its own — see below.

**Mandatory correction — the main snapshot table must also enforce `can_view_reports`, not shop membership
alone.** An earlier draft of this spec left `generated_reports`' RLS at plain `shop_id = auth_shop_id()`.
That is inconsistent with the feature this data belongs to: the existing `/reports` route itself requires
`meta: { permission: 'can_view_reports', feature: 'reporting_pack' }` (147A's spec, §5) — a shop member
without that permission cannot open the Reports UI at all, yet plain shop-scope RLS would still let that
same user's device query or sync the underlying `generated_reports` rows directly. A route guard is a
client-side check on how the UI is reached; it says nothing about what a table's RLS policy or PowerSync
sync rule independently allows. This codebase already has the exact primitive needed to close this
correctly: `public.can(flag text)` (`054_auth_role_helpers.sql`) — documented there as *"the single call
site for every permission-flag check in RLS policies… fail-closed, never errors open"* — is precisely the
mechanism `can_view_reports` (a per-staff-grantable custom permission, not a structurally-fixed role) needs
to be checked through in RLS, exactly as it's already the pattern for every other permission-gated RLS
policy in this codebase. `generated_reports`' RLS policy is therefore:
`shop_id = auth_shop_id() AND public.can('can_view_reports')` — both conditions required, matching the
existing UI gate at the data layer rather than only at the route layer. Same rule applies wherever
"eligible recipient" is resolved for the co-transactional notification (In-app notification below): a
recipient must hold `can_view_reports` for that shop, not merely belong to it — the earlier draft's
"holders of `can_view_reports`" language for notifications was already correct; the gap was specifically in
the table's own RLS policy not matching it.

The staff-section table's RLS additionally requires `public.can('can_view_staff_performance')` rather than
the raw `auth_role() = 'owner'` check an earlier draft proposed — `can()` already returns `true`
unconditionally for `auth_role() = 'owner'` (so the two are equivalent in practice, since
`can_view_staff_performance` is never grantable to a non-owner per 147A's spec), but routing through `can()`
matches this codebase's own single-call-site convention for permission checks rather than hand-rolling an
equivalent-but-parallel check, and stays correct automatically if that permission's grantability rule ever
changes.

No client `INSERT`/`UPDATE`/`DELETE` grants on either table (consistent with the Immutability rule above).

**Correction on what "147A's existing authorization model" actually is, checked directly against
147A's design spec (`docs/superpowers/specs/2026-08-18-wafi147a-automatic-reports-design.md` §5):** an
earlier draft of this section proposed reusing "147A's existing per-report authorization" as a stronger RLS
predicate than plain shop scope. That characterization is wrong — 147A's own spec states explicitly that its
`can_view_staff_performance` gating (Employee Summary whole-report gating; staff-ranking-section omission
within Weekly Summary/Monthly Health; staff-cut-section omission within Discount/Returns Report) **"describes
UI/report visibility, not a data-security boundary… it is not a new database/RLS boundary, and cannot be
one: 147A introduces no new sync surface or server read path, only computation over data already present on
the device."** 147A's authorization today is a client-side rendering filter over data every device in the
shop already has synced (raw `sales`/`sale_line_items`/etc.), not a server-enforced per-user predicate this
spec could reuse as a stronger RLS policy — there is no such predicate to reuse.

**This matters more for 147B than it did for 147A, because 147B genuinely does introduce a new sync
surface** (the snapshot table) — unlike 147A, which computed over data already present locally. Four of the
12 in-scope reports (Weekly Summary, Monthly Business Health, Discount Report, Returns Report) are composite
reports whose live-computed output includes a staff-ranking/staff-cut section 147A's spec says must be
omitted at render time for a viewer without `can_view_staff_performance`. **UI-layer filtering after sync is
not sufficient here, and an earlier draft of this spec was wrong to treat it as such**: once a snapshot's
full JSON — including that section's content — is synced to every device in the shop under plain
shop-scoped RLS, a cashier's device holds that data locally in its SQLite regardless of what the UI chooses
to render. That is a materially different risk from 147A's existing model (147A only ever computes over raw
`sales`/`sale_line_items` rows a device already has for operational reasons; 147B would be the first thing
to hand a cashier's device pre-aggregated staff-performance figures it has no operational reason to hold).
Treating this as equivalent to 147A's existing accepted trade-off, as an earlier draft did, was incorrect —
it must be resolved as a real decision, not asserted away.

**Resolution — split the gated section into a second, separately-secured table, using a genuine existing
server-side predicate:** `147A`'s own spec states `can_view_staff_performance` is structurally owner-only
("never grantable to a manager/cashier via `permissionsForRole`") — and this codebase already has exactly
the server-side predicate that maps to that: `auth_role()`, with an established RLS precedent already using
`auth_role() = 'owner'` (`058_cash_shifts_domain_rls.sql`). That means real server-side enforcement is
available here, not merely UI filtering pretending to be one.

Concretely, for the 4 composite reports with a gated section:

- The main snapshot's `report_data` (RLS/sync: shop-scope only, `auth_shop_id()`, as already specified)
  **never includes the staff-ranking/staff-cut section's content at all** — it is generated without that
  section, not generated-then-hidden.
- The gated section's content is persisted separately, in a second table (e.g. `generated_report_staff_sections`,
  FK to the main snapshot's `id`, with `shop_id` denormalized directly onto this table rather than requiring
  a join through the parent for authorization — see Persisted artifact below), with its own RLS policy:
  `shop_id = auth_shop_id() AND public.can('can_view_staff_performance')` (per the correction above). If
  this table is synced via PowerSync, its sync rule must independently enforce the same restriction — a
  non-owner device never receives these rows to sync, not merely fails to render them.
- The Reports viewer, for these 4 report types, fetches the main snapshot and (only when the reading
  device's own sync/RLS actually delivered one) the associated staff-section snapshot, and composes them —
  this still reuses 147A's existing section-level composition logic, just now backed by data that was never
  present on an unauthorized device in the first place, rather than data that was present but hidden.
- This is deliberately **not** full whole-report duplication (rejected as disproportionate) — only the one
  gated section per affected report is split out, everything else stays in the single main snapshot.
- The other 8 v1 reports (no gated section) are entirely unaffected by this — one table, shop-scope RLS,
  no split needed.

**Notification recipient eligibility follows the same reasoning:** none of the 12 v1 wall-clock reports are
whole-report-gated beyond `can_view_reports` (the existing `/reports` route permission) — Employee Summary,
the one whole-report-gated case, is out of 147B's scope entirely. So for v1, "eligible recipient" for a
"report ready" notification means holders of `can_view_reports` for that shop; no additional per-report
recipient filtering is needed today, but if a future wall-clock report is added with whole-report gating
(mirroring Employee Summary's), notification eligibility must be re-checked against that report's specific
gate, not just shop membership.

**Read mechanism decision required at implementation time:** decide, during implementation planning, whether
snapshots (both the main table and, where applicable, the staff-section table above) are (a) added to
`powersync.yaml`/`schema.ts` and synced to the client like `profit_cache`/`events` already are (consistent
with the existing pattern, works offline once synced — the expected default, since offline-first is one of
the three non-negotiable Sacred Rules), or (b) read via a direct online-only Supabase query/RPC (simpler,
but breaks the offline-first guarantee for this specific read, which per the Sacred Rules should not be done
without an explicit, deliberate exception). Whichever is chosen, implementation must confirm the shop-scope
RLS/sync-rule policy on the main table, and the additional `auth_role() = 'owner'` restriction on the
staff-section table, are both correctly enforced at the mechanism actually chosen — RLS alone if (b), RLS
*and* matching PowerSync sync rules if (a), per the security invariant above.

### Observability

If failure isolation (above) means one item's exception doesn't halt the cadence run, the overall
`cron.job_run_details` entry for that run can show "succeeded" even though individual (shop, report_type,
period) generations failed inside it — Supabase's cron job-run history reports the outer job's outcome, not
per-item application-level outcomes. **Requirement:** each failed (shop, report_type, period) attempt is
logged with enough context (shop id, report type, period bounds, scheduled slot, error detail) to identify
and manually retry it via the operator recovery mechanism above. A dedicated permanent `scheduler_run_log`
table is not required for v1 — structured logging (e.g. to whatever error-tracking/logging sink this
codebase already uses, per existing patterns such as WAFI-154's Sentry dead-letter reporting) is sufficient,
provided the logged context is enough to reconstruct the exact retry call.

**Rollback-survival requirement:** per-item failure logging must use a mechanism whose record survives a
catastrophic rollback of the surrounding `generate_scheduled_reports` transaction (per Failure isolation's
Option A above) — an external sink (Sentry, application logs) genuinely survives, since it's outside
PostgreSQL's transaction entirely; a logging table written inside the same transaction does not, and would
silently lose exactly the failure records an operator needs most (the ones from a run that never committed).
If a database-table log is chosen instead of an external sink for any reason, it must write via a mechanism
that commits independently of the surrounding transaction (e.g. `dblink`/a separate connection, or logging
before the item's own subtransaction rather than after) — this is not automatic and must be verified, not
assumed.

### Runtime/performance budget

A single cadence firing may generate up to 6 report types (the weekly cadence's count, the largest of the
three) × every active shop. Supabase's own guidance
keeps individual Cron job executions well under its resource/time limits (roughly a 10-minute practical
ceiling, plus concurrent-job limits) — this is a real constraint the implementation must be benchmarked
against, not assumed away. **Acceptance criterion:** before this ships, each cadence's job must be benchmarked separately against its
own load profile, since they differ — daily (all active shops × 2 reports: Daily Closing, Cash Flow), weekly
(all active shops × 6 reports: Weekly Summary, Inventory Health, Discount, Returns, Credit, Dead Stock), and
monthly (all active shops × 4 reports: Monthly Business Health, Profit Trend, Top Customers, Top Products)
— and each confirmed to stay within the target Supabase project's Cron execution budget (Supabase's own
guidance: individual jobs under roughly 10 minutes, no more than ~8 concurrent jobs — the three cadences
here don't overlap under normal fixed scheduling, so concurrency is not expected to be a concern, but the
per-job runtime ceiling is). This spec does not mandate batching now — the function-boundary design
(one `generate_report_snapshot(...)` call per item, failure-isolated) already supports batching being added
later (e.g. splitting one cadence's work across multiple smaller cron-scheduled batches) without redesigning
the generation primitive, if benchmarking shows a single firing is too large.

### In-app notification

On successful generation (new snapshot row actually inserted, not a no-op), emit a lightweight in-app
signal per eligible recipient — e.g. a row in an existing/new notifications mechanism, one per recipient —
indicating a given report is ready. This is a **co-transactional side effect** of successful generation
(committed atomically alongside the snapshot, per Idempotency above) — not an asynchronous "consumer" in the
sense WAFI-147C's future WhatsApp delivery will be. "Consumer" is reserved below for genuinely decoupled,
out-of-transaction future delivery. Exact mechanism (dedicated table vs. reuse of an existing notification
system, if one exists) to be determined during implementation planning by checking current notification
infrastructure in the codebase.

**Recipient resolution is decoupled from the snapshot.** The snapshot itself has no dependency on who gets
notified — it is keyed only by shop/report/period. Notification delivery separately resolves which
authorized users (owner, and potentially manager/staff depending on the shop's existing
authorization/notification model) are eligible recipients for that shop's "report ready" signal, then
inserts one notification row per eligible recipient (see the atomicity/idempotency rule in Idempotency
above — keyed on `(snapshot_id, recipient_user_id)`, not on the snapshot alone). Keeping the artifact itself
recipient-agnostic is deliberate: it is what lets WAFI-147C later attach a different delivery audience/
channel (WhatsApp) to the same snapshot without touching how the snapshot itself is produced.

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
falling through to the existing `compute()` call, **and**, for the 4 composite report types with a gated
section (per Read authorization above), fetch and compose the associated staff-section snapshot only when
the device's own sync/RLS actually delivered one — which is now a data-presence check, not a permission
check the client re-derives, since an unauthorized device never receives that row to begin with. This must
be listed as implementation scope, not assumed to happen incidentally.

**Period-boundary agreement is required for the lookup to ever match.** The viewer must derive
`period_start`/`period_end` using the exact same cadence-specific half-open-interval rules defined in
"Period semantics" above before querying for a snapshot — not its own independent notion of "this week" or
"this month." If the viewer computed, say, `[2026-08-10 00:00, 2026-08-16 23:59:59.999999]` while the
snapshot was stored as `[2026-08-10 00:00:00, 2026-08-17 00:00:00)`, the natural-key lookup would never
match and every report would silently always fall through to live compute, defeating the purpose of 147B
without any visible error. PostgreSQL (PL/pgSQL) and the client (TypeScript/Vue) are different runtimes —
neither can literally import a function from the other, and a shared package built solely to hold these
date calculations would be disproportionate. Instead: the period semantics defined in this document are the
single canonical contract; each runtime implements those exact rules natively (reusing 147A's existing
period logic in the viewer if it already has one, rather than inventing a second). Neither implementation
may derive its own notion of "week" or "month" independent of this contract. Cross-runtime period-parity
tests assert identical `(period_start, period_end)` results for representative dates across daily, weekly,
and monthly cadences, including the weekly week-boundary case — this is what actually guarantees agreement,
not a shared code artifact.

## Testing

- pgTAP coverage for `generate_scheduled_reports` (correct shops/report-types/period resolved per cadence)
  and `generate_report_snapshot` (idempotency — calling twice for the same natural key produces exactly one
  snapshot row; multi-recipient notification fan-out — a shop with N eligible recipients produces exactly N
  notification rows, one per `(snapshot_id, recipient_user_id)`, and calling twice never duplicates any of
  them; the snapshot+notification atomicity invariant — a forced failure after the snapshot insert rolls
  back the snapshot too, so a retry can safely redo both; and exact period-boundary values per cadence, per
  the Period semantics section above — including the weekly case explicitly, since it is the one most likely
  to regress to an off-by-one-week error).
- Security tests: confirm neither function is `EXECUTE`-granted to `authenticated`/`anon`, that
  `search_path` is fixed on both function definitions, and that both tables have no client
  `INSERT`/`UPDATE`/`DELETE` grants (immutability). For `generated_reports`: a working `SELECT`-only RLS
  policy scoped to `auth_shop_id()` (cross-shop read isolation — assert a shop A session cannot read shop
  B's snapshots). For `generated_report_staff_sections`: a working `SELECT`-only RLS policy requiring both
  `auth_shop_id()` *and* `auth_role() = 'owner'` — assert a shop-A-manager or shop-A-cashier session gets
  zero rows, not just a shop-B session.
- Failure-isolation test: force one (shop, report_type) generation to fail mid-cadence-run alongside several
  that succeed; assert the loop still processes every remaining item (the failure doesn't abort the run) and
  that, once `generate_scheduled_reports(cadence)` completes and its outer transaction commits, the
  successful items are present and the failed item is absent-and-logged for retry — per the Option A model
  (Failure isolation above), not a claim that each item commits independently of the others.
- Idempotent-recovery test, modeled as two separate pgTAP transactions rather than attempting to literally
  simulate a crashed connection from within one transaction: (1) in transaction A, generate several
  snapshots for a slot, then `ROLLBACK` (standing in for "the outer transaction never committed"); (2) in a
  fresh transaction B, invoke `generate_scheduled_reports(cadence, scheduled_for := <same slot>)` and assert
  every expected snapshot for that slot now exists exactly once. Separately, test that invoking the same
  slot twice *after* a successful commit produces no duplicates (the ordinary idempotency case, already
  covered above but worth keeping distinct from the rollback-recovery case).
- Scheduled-slot determinism test: invoking generation for an explicit past scheduled slot always resolves
  the same `period_start`/`period_end` regardless of the actual (possibly much later) execution time —
  proves the resolver isn't silently using `now()`.
- Scheduled-slot validation test: `generate_scheduled_reports('weekly', scheduled_for := <a Wednesday>)` and
  `('weekly', scheduled_for := <Sunday 10:00>)` are both rejected before any generation occurs; `('weekly',
  scheduled_for := <a real Sunday 09:00>)` and `('monthly', scheduled_for := <1st 09:00>)` are accepted;
  `('monthly', scheduled_for := <2nd 09:00>)` is rejected.
- Input-coherence validation test: `generate_report_snapshot(shop_id, 'weekly_summary', <a one-day period>,
  scheduled_for := <a real Sunday 09:00>)` is rejected because the period doesn't match what that
  `scheduled_for` derives for that report type — proves the primitive cross-checks rather than trusting a
  caller-supplied period unconditionally.
- Extended-atomicity test (composite report types only): force the staff-section insert to fail after the
  main snapshot insert succeeds within the same call; assert neither the main snapshot nor any notification
  row exists afterward — proves the three-part artifact is genuinely all-or-nothing, not just the
  two-part (snapshot + notification) case already covered for the 8 non-composite report types.
- `CHECK (period_start < period_end)` and the `report_type` value constraint are exercised directly (invalid
  inserts rejected at the database level, not only by application code discipline).
- `generated_at` test: assert two snapshots generated by the same `generate_scheduled_reports` invocation,
  with a deliberate delay injected between them, record different `generated_at` values — proves
  `clock_timestamp()` is in use rather than the transaction-start-pinned `now()`.
- `can_view_reports` access-matrix test on `generated_reports`: shop A + `can_view_reports` → snapshot
  visible; shop A without `can_view_reports` → invisible; shop B + `can_view_reports` → invisible (proves
  the policy is `AND`, not `OR`, between shop-scope and the permission check).
- `can_view_staff_performance` access-matrix test on `generated_report_staff_sections`: shop A owner →
  staff-section row visible; shop A manager/cashier (shop-scope satisfied, permission not) → invisible.
- Staff-section data-exposure test (the important one, stronger than a rendering test): as a
  non-`can_view_staff_performance` session, query/attempt to sync the staff-section table directly for a
  shop's Weekly Summary/Monthly Business Health/Discount/Returns snapshot and assert **zero rows are
  returned or synced** — not that the UI hides them. This proves the data itself never reaches an
  unauthorized device, which is the actual security property this design commits to; a rendering-only test
  would pass even if the underlying data leak still existed.
- Two-tier parity tests, matching the corrected contract above: for the 8 non-composite report types,
  `report_data` alone parity-tested against 147A's live output (one case). For the 4 composite report
  types, two separate cases: (a) `report_data` + the authorized `section_data` composed together,
  parity-tested against 147A's live output for an owner; (b) `report_data` alone, parity-tested against
  147A's live output for a viewer without `can_view_staff_performance` (147A's own section-omitted output,
  not the full one). Case (b) failing while (a) passes would indicate the main snapshot accidentally still
  contains gated content; case (a) failing while (b) passes would indicate the split composition is broken.
- Cross-runtime period-parity tests: assert the PL/pgSQL and TypeScript/Vue period-boundary computations
  produce identical `(period_start, period_end)` for representative dates across daily/weekly/monthly
  cadences, including the weekly week-boundary case — this is the actual guarantee behind the read path's
  snapshot lookup, not a shared code artifact.
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
   `generate_report_snapshot(...)` directly per shift, bypassing the cadence resolver — must also resolve
   Employee Summary's snapshot-identity schema caveat (staff/shift dimension, see Schedule scope above).
4. `TBD` — Snapshot correction/regeneration for late-arriving source data, if operational experience shows
   the Data-finality policy's point-in-time trade-off (Option A) causes user-visible staleness worth fixing.
5. `TBD` — Automatic missed-slot detection and catch-up, if relying on the manual operator recovery
   mechanism (Scheduled-slot semantics above) proves insufficient in practice.
6. WAFI-147C — automated WhatsApp delivery, consuming the snapshot producer boundary defined here — blocked
   on WhatsApp Business API setup.
