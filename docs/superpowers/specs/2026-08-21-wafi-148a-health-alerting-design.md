# WAFI-148A: Health Alerting — Design

**Date:** 2026-08-21 (signed off 2026-08-22)
**Status:** ✅ **Implementation-plan ready**, with 3 explicit gates carried forward
rather than treated as resolved: (1) a schema-verification gate — confirm whether
concurrent open shifts per shop are possible, to run as the first implementation task,
before finalizing #8's evaluator/tests; (2) a product-sign-off gate on exact threshold
defaults, blocking config seeding only, not schema/RPC/cron/test implementation; (3) a
product-sign-off gate on the exact KPI target number, blocking feature completion/KPI
sign-off only, not instrumentation. See "Still open before implementation plan" at the
end and the implementation plan's gate placement.
**Plan:** `docs/superpowers/plans/2026-08-22-wafi-148a-health-alerting-plan.md`
**Depends on:** WAFI-148 (Internal Health Monitoring) — merged `16f3189`, **not yet
production-verified** (migrations 106-115 not yet deployed to hosted Supabase, pgTAP
suite not yet run against real Postgres). This spec should not begin implementation until
that verification lands, since 148A's evaluators read `health_metrics`/`health_gauges`
directly.

Every claim below is tagged **[148]** (inherited, verified behavior from WAFI-148),
**[existing]** (a pre-existing WAFI pattern reused here, not new), or **[148A-new]**
(new behavior this ticket introduces) — so implementation and review can tell inherited
fact from new decision at a glance.

## Problem / Objective

WAFI-148 shipped 8 health metrics and a dashboard — visibility only. **[148]** Nothing
notifies anyone when a metric crosses from healthy to bad; an owner only learns of a
problem by opening the health screen. WAFI-148A closes that gap: detect a health/operational
condition becoming alertable and create exactly one in-app notification per alert
episode — using **transition semantics** (healthy→bad edge detection) for reversible
conditions, and **period-bounded attainment semantics** (current value ≥ threshold, once
per shop-local day) for cumulative daily conditions, since the latter cannot detect a
true historical crossing without retaining value history (see Shape A, below). WAFI-148's
existing data is used where it's authoritative; a small new live query is added where it
isn't. **[148A-new, objective wording corrected round 3 — "exactly one notification per
transition" previously overstated what Shape A actually guarantees]**

## Scope & Non-Goals

**In scope — 7 health metrics + 1 operational alert condition** (not "8 metrics" — #8 is
deliberately not a `health_metrics` evaluation, see below):

| # | Signal | Source |
|---|---|---|
| 1 | Sync failures | `health_metrics.sync_failure_terminal` **[148]** |
| 2 | Offline duration | `health_metrics.offline_duration_seconds` **[148]** |
| 3 | Dead-letter count | `health_gauges.dead_letter_count` **[148]** |
| 4 | Drawer mismatches | `health_metrics.drawer_mismatch_count` **[148]** |
| 5 | Deferred-job failures | `health_metrics.deferred_job_failure_terminal` **[148]** |
| 6 | App errors | `health_metrics.app_error_count` **[148]** |
| 7 | Stale devices | live query, `devices.last_seen_at` **[148]** (metric had no stored row in 148 either) |
| 8 | Overdue shift | **[148A-new]** live query over open shifts' `opened_at` |

**`never_closed_shift_count` remains a WAFI-148 dashboard/reporting metric only.** It is
*not* the source for #8 — it only records a never-closed shift retrospectively, after a
later `shift.closed` reveals it, which cannot support a timely "this shift is overdue
right now" alert. The two metrics coexist and answer different questions; #8's live
query is new, independent data access. **[148A-new, scope clarification]**

**Explicitly excluded:** `active_device_day` and `telemetry_periods_dropped` are
denominators/telemetry-quality signals, not independently alertable **[148]**.

**Non-goals for v1:**
- Push, WhatsApp, email, or webhook delivery — v1 is `public.notifications` in-app only
  **[148A-new decision]**.
- Escalation tiers or repeat/reminder notifications while a condition remains bad —
  **[148A-new decision, product-approved]**.
- Sub-day (rolling-hour) windows for sync failures, deferred-job failures, or offline
  duration — **[148A-new decision, product-approved]**: v1 accepts day-cumulative
  semantics.
- Dollar-magnitude drawer-mismatch alerting — **[148A-new decision, product-approved]**:
  v1 alerts on count only.
- "You're healthy again" recovery notifications — recovery is silent **[148A-new decision]**.
- **Historical threshold-crossing semantics** (see Shape A section) — v1 uses *threshold
  attainment*, not a strict "value transitioned across the currently-configured
  threshold" model. **[148A-new decision, this revision]**

## What Already Exists — Verified, Not Assumed

- **`health_metrics`/`health_gauges`** (migration 107) — day-bucketed only
  (`PRIMARY KEY (shop_id, device_id, metric_key, period_start date)`), no sub-day window
  anywhere. Client-pushed counters (`report_health_metrics`, migration 108,
  `GREATEST`-merge, monotonic non-decreasing per device per day) vs. server-authoritative
  event-sourced counters (drawer mismatches, never-closed-shift count — trigger on
  `events` where `type='shift.closed'`, migration 113). `health_gauges.dead_letter_count`
  is a snapshot, overwritten in place, no history. Stale-device count has no stored row —
  live query over `devices.last_seen_at`. **[148]**
- **Storage grain vs. alert grain differ for metrics 1/2/5/6.** All four stored
  **per-device**, read **shop-wide** via `SUM(value) ... GROUP BY metric_key,
  period_start` (`useOwnerHealth.ts:259-264`, `useTeamHealth.ts:54-69`), "sum-then-divide,
  never average child rates" for the two rate metrics. `GREATEST` only dedups re-sends
  from the *same* device. **148A's evaluators for these four metrics must run the same
  shop-wide `SUM ... GROUP BY` aggregation before comparing to threshold.** **[148,
  148A-new requirement derived from it]**
- **WAFI-156** is strictly event-driven, single-event, single-field; cannot evaluate an
  aggregate like `health_metrics.value`; `rule_action_log`'s dedup key is per-triggering-
  event, not a time window or "currently alerting" state; no cooldown/re-arm/firing-state
  concept exists. **148A does not extend `business_rules` into a generic metric-threshold
  engine** — only metric #4 uses an event-driven evaluator, and it does so by extending
  the existing `shift.closed` trigger function directly, not by adding to
  `business_rules`. **[existing, decision confirmed]**
- **`public.notifications`** (migrations 079, 080) — schema, RLS (shop+recipient scoped,
  already supports team-role targeting), dedup (`UNIQUE(source_event_id) WHERE
  source_event_id IS NOT NULL` for event-sourced rows; no DB-level dedup for state-derived
  rows today), delivery (strictly in-app, no realtime channel, no push/WhatsApp/email
  anywhere in the codebase). `notification_settings (shop_id, type, enabled,
  threshold_json)` already exists for per-shop per-type config. **[existing]**
- **`syncStalenessCheck.ts`/`lowStockCheck.ts`** — real precedent that the *mechanism*
  (foreground check → threshold compare → notify) works; **not** evidence that their
  day-bucket dedup semantics ("once per day") are correct for a reversible condition —
  applying that unmodified would under-fire on legitimate recoveries/re-alerts, a
  plausible existing gap independent of 148A. **[existing precedent, semantics not
  carried forward]**
- **`pg_cron`** (WAFI-147B) — established precedent for scheduled server-side execution,
  reused here, not new infrastructure. **[existing, reused]**
- **WAFI-065's zombie-shift force-close guard** (migration 026, 18h+ threshold) already
  force-closes shifts left open too long. **This directly constrains #8's threshold**:
  the overdue-shift alert threshold must be meaningfully below 18h, or the alert becomes
  unreachable for any shift the guard would force-close first. **[148, cross-feature
  constraint identified this revision]**

## Evaluator Ownership

| # | Metric | Shape | Evaluator | Trigger | Recovery owner |
|---|---|---|---|---|---|
| 1 | Sync failures | A | Foreground state-derived | App-foreground check (see note below) | n/a — period reset |
| 2 | Offline duration | A | Foreground state-derived | App-foreground check | n/a — period reset |
| 3 | Dead-letter count | B | Scheduled state-derived (`pg_cron`) | Periodic server check | Same scheduled check |
| 4 | Drawer mismatches | A | Event-derived | `shift.closed` trigger extension | n/a — period reset |
| 5 | Deferred-job failures | A | Foreground state-derived | App-foreground check | n/a — period reset |
| 6 | App errors | A | Foreground state-derived | App-foreground check | n/a — period reset |
| 7 | Stale devices | B | Scheduled state-derived (`pg_cron`) | Periodic server check | Same scheduled check |
| 8 | Overdue shift | B | Scheduled state-derived (`pg_cron`), **mandatory** | Periodic server check | **`shift.closed` event, not the scheduled check** |

**On the "trigger" wording (issue #9):** the evaluator for metrics 1/2/5/6 is **not**
invoked automatically inside `report_health_metrics` itself. The actual chain is: client
calls `report_health_metrics` (writes `health_metrics`, unrelated transaction) → separately,
the app-foreground check registry (same registry `syncStalenessCheck.ts` already runs in)
runs its own query against current `health_metrics` totals and calls the claim RPC. These
are two independent triggers, not one causing the other. **[148A-new, clarified]**

**On #8's recovery (issue #2):** a scheduled check discovering "this shift is no longer
open" only happens on the next tick, adding up to the cron interval's worth of delay
before the owner would (silently) see the state clear — harmless for silent recovery, but
more importantly, **the scheduled check is not a reliable place to *detect* closure at
all if the shift row is deleted or archived** rather than merely flagged closed. The
authoritative recovery signal for #8 is the `shift.closed` event itself: the same trigger
extension that owns metric #4 also resolves any `ALERTING` row for that `shift_id` back to
`HEALTHY` in the same transaction as the close. This produces a clean invariant: **an
overdue-shift alert can only be `ALERTING` while its shift remains open.** **[148A-new,
this revision]**

**Verified (implementation-readiness review round 2), not assumed:** every currently
shipping path that ends an open shift — normal close (`staff.service.ts:211`) and
WAFI-065's force-close/zombie-guard (`staff.service.ts:282`, only started publishing
`shift.closed` on this same WAFI-148 branch) — goes through `StaffService` and reliably
publishes `shift.closed`. There is no `DELETE FROM cashier_shifts` path anywhere. The
invariant holds today. **One latent seam to record, not fix now:** `cashier_shifts.status`
reserves an `'abandoned'` value (migration 026) for a not-yet-built future sweep; that
schema comment explicitly says "nothing is auto-abandoned here" today. **If that future
sweep is ever implemented as a direct `UPDATE ... SET status='abandoned'` bypassing
`StaffService` rather than publishing `shift.closed`, it will silently break this
invariant** — any shift it abandons while `ALERTING` would be stuck permanently, since
#8 has no independent existing-state reconciliation pass (unlike #7, see below). This is
a constraint on that future ticket, not something 148A can fix pre-emptively, but it
must be written into that future sweep's own design when it's built, or #8 needs the same
existing-state reconciliation pattern #7 has just been given. **[148A-new, this
revision]**

Metrics #3 and #7 have no equivalent authoritative "resolved" event, so their recovery
stays owned by the same scheduled check that raises them — checking for the reverse
condition (gauge back under threshold; device seen recently) each tick.

**Correction (implementation-readiness review round 2) — #7's recovery cannot rely on
candidate enumeration alone.** The stale-device candidate query is explicitly scoped to
*eligible* devices (active, belonging to the shop, not deactivated/revoked,
onboarding-complete). A device that was `ALERTING` and is then deactivated, revoked, or
deleted **drops out of that candidate population entirely** — the scheduled check would
never see it again to evaluate `ALERTING → HEALTHY`, leaving the state row permanently
`ALERTING`. Candidate enumeration and recovery are therefore two distinct queries, not
one:
- **New-alert discovery:** current eligible-device candidates → stale? → claim if bad.
- **Recovery:** every existing `health_alert_state_b` row with `alert_key='stale_device'`
  and `state='ALERTING'` → is the device still stale *and* still eligible? → if the device
  is now fresh, **or** no longer belongs to the eligible population at all (deactivated,
  revoked, deleted), resolve to `HEALTHY`.

The scheduled #7 check must run both queries every tick. This is also why the earlier
feature-flag reconciliation claim ("the next evaluation run reconciles against current
condition") is only true once this second query exists — candidate-only enumeration
cannot fulfill that promise on its own.

## Alert-State Model

### Shape A — period-bounded, monotonic, no escalation
Metrics 1, 2, 4, 5, 6.

```
health_alert_state_a (
  shop_id        uuid NOT NULL,
  metric_key     text NOT NULL,
  period_start   date NOT NULL,     -- shop-local day, computed server-side — see below
  threshold_used numeric NOT NULL,  -- snapshot at alert time, audit only — see semantics below
  alerted_at     timestamptz NOT NULL,
  PRIMARY KEY (shop_id, metric_key, period_start)
)
```

**`period_start`'s timezone source, made explicit (issue #15, round 3):** derived
server-side from the shop's configured business timezone (`shops.timezone`, established
by WAFI-148), **never** from raw database `CURRENT_DATE` unless the session has
explicitly been set to that shop's timezone, and never from the client or evaluator's own
clock. This is the same convention WAFI-148 already uses for `event_projection_day` —
restated here explicitly because a naive `CURRENT_DATE` on a UTC-default session is
exactly the kind of mistake this convention exists to prevent.

**Shared claim helper, not five inline call sites (issue #2, round 3):** all five
Shape-A alerts (#1, #2, #4, #5, #6) call one shared function rather than each
implementing its own `INSERT ... ON CONFLICT` inline — the same reasoning that motivated
Shape B's shared claim layer applies here, and leaving Shape A as five independent
inline implementations would recreate the exact ad hoc risk the shared layer exists to
eliminate.

```
claim_health_alert_period(shop_id, metric_key, period_start, threshold_used, ...)
  RETURNS notified boolean
  -- atomically: INSERT ... ON CONFLICT (shop_id, metric_key, period_start) DO NOTHING
  -- RETURNING true; if claimed, resolves recipient, inserts the notification, and
  -- returns true; if not claimed (row already existed), returns false and does nothing
  -- else. Evaluators call this and only this — none insert into notifications directly.
```

**v1 semantics, stated explicitly (issue #3): threshold *attainment*, not historical
crossing.** A Shape-A alert fires when the current shop-wide cumulative value is ≥ the
*currently effective* threshold at evaluation time, and no alert has yet been claimed for
that period. This is a deliberate, named simplification: because no previous value is
retained, a strict "the value transitioned across whatever threshold was configured at
the moment of transition" model is not implementable without adding value history, which
is out of scope for v1.

**Concurrency semantics, made deterministic (round 4):** "currently effective threshold"
means the threshold and the aggregate are read from the same evaluator invocation, not
that the evaluator holds a lock preventing config changes mid-evaluation. Precisely: for a
given evaluation, the threshold and aggregate are read from the configuration/data visible
to that evaluation's own queries; a concurrent `notification_settings` threshold change
may take effect starting with the *next* evaluation and does not invalidate, retry, or
need to be detected by an evaluation already in progress. There is no requirement that the
threshold and aggregate come from a single atomic snapshot statement — ordinary read
consistency within the evaluator's transaction is sufficient, since `threshold_used` is
recorded for audit only and no correctness invariant depends on which of two
near-simultaneous threshold values was actually used.

Two direct consequences, stated so nobody re-derives them incorrectly later:
- A threshold lowered mid-period can make an already-elevated-but-previously-under-old-
  threshold value newly alertable the next time the evaluator runs — this is "attainment
  under current config," working as intended, not a bug.
- **Once a period's row exists, no subsequent threshold change re-fires or retracts it** —
  the row's mere existence is what suppresses re-firing for the rest of that period,
  regardless of any later config edits. `threshold_used` is recorded for audit only; no
  `threshold_version` is needed in the key, since v1 deliberately does not attempt to
  detect crossings relative to a specific historical threshold value (issue #4).
- Re-arm: automatic — the next day's `period_start` is a fresh key.

### Shape B — reversible, real transition tracking
Metrics 3, 7, 8.

```
health_alert_state_b (
  shop_id          uuid NOT NULL,
  alert_key        text NOT NULL CHECK (alert_key IN
                     ('dead_letter_count','stale_device','overdue_shift')),
  entity_id        uuid NOT NULL,  -- see entity_id policy below — NOT a foreign key
  state            text NOT NULL CHECK (state IN ('HEALTHY','ALERTING')),
  state_changed_at timestamptz NOT NULL,
  last_notified_at timestamptz,    -- nullable; audit/idempotency only — NOT a cooldown mechanism
  PRIMARY KEY (shop_id, alert_key, entity_id)
)
```

**`alert_key` is a `CHECK`-enforced closed set (issue #9, round 3):** a typo in SQL must
fail loudly, not silently open a new, unintended state namespace.

**`entity_id` is deliberately a plain UUID, not a foreign key (issue #7, round 3).** A
foreign key to `devices(id)` or a shifts table would make the required recovery behavior
(a deleted/deactivated device's `ALERTING` row must still be reconcilable to `HEALTHY`)
awkward or impossible under `ON DELETE` semantics — historical alert state must survive
the referenced entity disappearing. This applies to `#7`/device_id today and would apply
equally to `#8`/shift_id if shifts ever become deletable in the future (they are not
today — see the verified lifecycle above).

**Sentinel `entity_id` for `#3` (dead-letter count), defined explicitly rather than left
for implementation to invent (issue #10, round 3):** `entity_id =
'00000000-0000-0000-0000-000000000000'` (the nil UUID) for every `alert_key =
'dead_letter_count'` row, since that metric is shop-level, not per-entity. If the
project's existing conventions (check for a prior sentinel-UUID precedent elsewhere in
the schema before implementation) prefer a different fixed constant, use that instead —
the requirement is a single documented, deterministic constant, not this specific value.

**The atomic claim/notify contract, corrected (issue #1, round 3) — this was the most
important gap in revision 3.** The pseudocode previously shown only performed the state
claim and did not touch `last_notified_at`, leaving ambiguous whether the claim function
or the calling evaluator was responsible for the notification insert. Resolved
explicitly: **the claim function is the complete atomic unit — claim, recipient
resolution, notification insert, and `last_notified_at` update all happen inside it, in
one call, in the caller's existing transaction.** Evaluators never separately insert
notifications or update `last_notified_at` themselves.

```
claim_health_alert_transition(shop_id, alert_key, entity_id) RETURNS notified boolean
  -- atomically, in the caller's transaction:
  --  1. INSERT ... ON CONFLICT (shop_id, alert_key, entity_id)
  --     DO UPDATE SET state='ALERTING', state_changed_at=now()
  --     WHERE health_alert_state_b.state='HEALTHY'
  --     RETURNING true AS claimed
  --  2. if not claimed (row already 'ALERTING'): RETURN false, do nothing further
  --  3. if claimed: resolve recipient_role='owner' for shop_id, INSERT INTO
  --     notifications (...), UPDATE health_alert_state_b SET last_notified_at = now()
  --     WHERE (shop_id, alert_key, entity_id) = (...)
  --  4. RETURN true
```

```
resolve_health_alert_transition(shop_id, alert_key, entity_id) RETURNS void
  -- sets state='HEALTHY' unconditionally if a row exists; no-op if no row exists yet.
  -- Recovery is always silent — this function never inserts a notification.
```

**`last_notified_at`'s exact contract (clarified, round 2):** it records the timestamp of
the notification created by the *most recent successful* `HEALTHY → ALERTING` claim for
this row — a fact not otherwise recoverable once `state_changed_at` is overwritten by a
later transition (e.g. a subsequent recovery-then-re-alert cycle would otherwise leave no
record of when the *previous* episode's notification actually fired). It exists purely
for operational inspection/future notification-auditing and is **never read by any v1
decision logic** — no evaluator, claim, or resolve function branches on its value.

**Bootstrap/first-observation rule (issue #1 and #14): a missing row is treated as
implicit `HEALTHY`.** The claim function below handles "no row exists yet" and "row exists
with `state='HEALTHY'`" identically — both are eligible to transition to `ALERTING`. This
also directly answers issue #14: the first time 148A evaluates an already-bad condition
(e.g. dead-letter count already over threshold when this ships), that counts as a real
`HEALTHY → ALERTING` transition and produces an alert — which is the expected behavior
("tell me about problems," not "only problems that started after I turned this on").

The claim/notify contract — including the corrected atomic behavior — is defined once,
in full, in the schema block above (see "The atomic claim/notify contract, corrected").
`claim_health_alert_transition` and `resolve_health_alert_transition` are the **only**
things allowed to write `health_alert_state_b`; no evaluator writes this table, or
`public.notifications`, directly.

## The Alert Transition / Claim Layer (issue #19 — formalized)

```
             Alert Definition (threshold / severity / recipient / enabled)
                              │
            ┌─────────────────┴─────────────────┐
            │                                    │
     Event-derived evaluator              State-derived evaluator
     (shift.closed trigger, #4)      (foreground check #1/2/5/6;
                                       scheduled check #3/7/8)
            │                                    │
            └─────────────────┬──────────────────┘
                               ▼
              Alert Transition / Claim layer
        (claim_health_alert_transition / claim_health_alert_period /
                    resolve_health_alert_transition)
                               │
                               ▼
                     public.notifications
```

**Invariant: no evaluator inserts into `public.notifications` directly.** Every evaluator
— #4's trigger extension, the foreground-check RPC for #1/2/5/6, the scheduled-check
function for #3/7/8 — calls into the claim layer, and only a successful claim proceeds to
insert a notification, in the same transaction as the claim. This replaces having four
separate ad hoc claim+insert implementations (one per evaluator) with one shared,
independently testable contract (issue #19, and resolves the ambiguity in issue #5 about
what actually dedups #4: **the alert-state claim is the authoritative dedup mechanism for
all 8 alerts; `source_event_id` on the notification row is populated for #4 to preserve
provenance and is not itself relied on for transition dedup** — stated explicitly so a
future engineer doesn't assume the notifications table's own unique constraint is
protecting this metric).

## Transactional / Idempotency Guarantees

1. **Claim and notification insert happen in one Postgres transaction**, via the shared
   claim layer above.
2. **No partial-failure window** — if the notification insert fails after a successful
   claim, the whole transaction rolls back; state reverts to unclaimed/`HEALTHY`; next
   evaluation retries. Self-healing, no duplicate risk from retry.
3. **Concurrent evaluators cannot both succeed** — the `WHERE state='HEALTHY'` /
   `ON CONFLICT DO NOTHING` guard serializes conflicting writers on the same row; exactly
   one claim and one notification.
4. **Per-entity isolation within one scheduled batch (issue #7, resolved):** a single
   top-level PL/pgSQL function processing many candidates wraps each candidate in its own
   `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END;` block, with no explicit `ROLLBACK`
   statement inside it. **Correction (implementation-readiness review round 2):** a bare
   `ROLLBACK` is not valid inside a PL/pgSQL exception handler — PostgreSQL itself treats
   an exception block as an implicit subtransaction/savepoint: when the block's handler
   catches an exception, PostgreSQL automatically rolls back that candidate's persistent
   changes to the start of the block, while the enclosing transaction and every other
   candidate's already-applied claim+notify remain intact. The correct structure is:
   ```
   FOR candidate IN ... LOOP
     BEGIN
       -- claim; notification insert
     EXCEPTION WHEN OTHERS THEN
       -- log SQLSTATE/message via the existing engineering error-log path; continue
     END;
   END LOOP;
   ```
   This avoids needing a multi-transaction dispatcher (an external loop invoking one RPC
   call per candidate) — the whole batch stays one top-level transaction, one cron
   invocation, one commit.
5. **#4's transactional ordering (issue #10):** the alert-evaluation call for metric #4
   happens as a direct function call from within the same `shift.closed` trigger function
   that performs the drawer-mismatch projection write — a plain sequential call within the
   same transaction, not a separate query racing against the projection's commit. The
   evaluator therefore always sees the just-written, not-yet-committed-to-other-
   transactions mismatch count. This must be covered by a test asserting the evaluator
   observes the post-projection value, not a pre-projection snapshot.
6. **Recipient resolution (issue #6):** the claim function resolves `recipient_role =
   'owner'` the same way existing owner-targeted notification writers already do
   (querying `staff` for the shop's owner role). **Correction (round 2):** a PostgreSQL
   function does not create or own its own transaction — it executes inside whatever
   transaction the calling statement is already in (the trigger's transaction for #4, the
   cron function's transaction for #3/7/8, the RPC call's transaction for #1/2/5/6).
   Stated precisely: **recipient resolution and the notification insert occur in the same
   outer transaction as the claim function call**, not in a transaction the claim layer
   creates for itself. This keeps the whole evaluate→claim→notify chain as pure SQL
   callable from a trigger, a `pg_cron` job, or an RPC without an intermediate service,
   and without implying any autonomous-transaction behavior Postgres doesn't provide.
7. **Feature-flag interaction (issue #11):** disabling the WAFI-155 flag for 148A
   suppresses evaluation and claiming, but **never deletes or resets existing alert
   state**. On re-enable, the next evaluation run reconciles against the *current*
   condition before allowing any new transition — e.g. a Shape B row left `ALERTING`
   while the flag was off, whose condition has since actually recovered, is resolved to
   `HEALTHY` on the first post-re-enable check before any new alert could fire, exactly as
   it would have been resolved in real time had the flag stayed on. No special
   "flag-disabled" state value is introduced.
8. **`notification_settings.enabled = false` behavior (issue #12) — Option A, chosen
   explicitly:** a disabled alert type does not claim alert state at all; the evaluator
   exits before calling the claim layer. This means re-enabling a type does not consume
   the current period/episode — a condition that was already bad while disabled is fully
   eligible to alert once re-enabled, rather than being silently treated as "already
   used up." This was chosen over Option B (claim silently, suppress only the
   notification) specifically to avoid the failure mode of a user disabling notifications
   briefly and permanently losing that period's alert.
9. **Threshold validation (issue #13):** the evaluator must validate `threshold_json`
   before use — reject non-numeric, negative, null, or (for #8 specifically) zero
   thresholds. On invalid config, skip evaluation for that shop/metric and log an
   engineering error; **never fall back to an invented default at runtime.** Valid
   defaults are seeded via migration/config, not computed ad hoc in the evaluator.
10. **Recovery is independent of `notification_settings.enabled` (issue #3, round 3):**
    the existing-`ALERTING`-row reconciliation pass for #7/#8 runs regardless of whether
    that alert type is currently enabled — recovery updates `state`, it never claims or
    notifies, so there is nothing for the disabled-type skip-claiming rule (guarantee #8
    above) to suppress. Concretely: a condition can go bad while disabled, recover while
    still disabled, and go bad again after re-enable, and this must produce **exactly one**
    notification (for the post-re-enable episode) — not zero (if recovery were
    incorrectly gated on `enabled`) and not two. Added to the test matrix below.
11. **Feature-flag re-enable does not reconstruct missed history for Shape A (issue #4,
    round 3):** unlike Shape B, Shape A has no "what would have happened while disabled"
    to reconstruct — there is no state to roll forward. When evaluation resumes after
    re-enable, a Shape-A metric is simply evaluated fresh against its current cumulative
    value and current threshold, exactly as if this were the first evaluation of the
    period. No attempt is made to infer whether attainment "should have" happened at some
    earlier point while the flag was off.
12. **#8's threshold-safety requirement, strengthened (issue #5, round 3):** stating the
    requirement as merely "threshold < 18h" is insufficient — a threshold of, say, 17h59m
    combined with a 30-minute cron cadence could still miss the window entirely (a shift
    crossing the boundary between two ticks, then hitting the 18h force-close before the
    next tick observes it). The actual engineering invariant is: **the configured
    threshold must leave enough margin below the 18h force-close boundary for at least one
    scheduled evaluation to observe the overdue condition, given the selected cron cadence
    and expected scheduling jitter** — e.g. a 30-minute cadence needs materially more than
    30 minutes of margin, not an infinitesimal one. The exact number is still product's
    to set; this is the constraint product's choice must satisfy, not a specific value.
13. **#8's time basis is elapsed duration, not shop-local day bucketing (issue #6, round
    3):** `now() - opened_at >= threshold` is an absolute `timestamptz` comparison — no
    shop-timezone conversion is involved, unlike the day-bucketed Shape-A metrics and
    Shape A's `period_start`. Stated explicitly so this metric isn't mistakenly bucketed
    by shop-local day the way #1-6 are.

## Security / Authorization Contract (issues #11, #12, round 3 — not previously specified)

Every new server-side entry point this design introduces (`claim_health_alert_transition`,
`claim_health_alert_period`, `resolve_health_alert_transition`, the foreground-evaluation
RPC for #1/2/5/6, the scheduled `pg_cron` functions for #3/7/8, and the `shift.closed`
trigger extension for #4/#8) is `SECURITY DEFINER` or runs in a trusted server context,
and all of them share one authorization contract, stated explicitly rather than left to
each function's implementation to reinvent:

- **Never trust a caller-supplied `shop_id`.** The foreground RPC (the one entry point
  reachable from an authenticated client, unlike the trigger and cron functions which
  never take client input at all) must derive or verify the caller's shop membership
  server-side using the project's existing authorization pattern, the same way other
  client-callable RPCs already do — it must not accept and blindly trust a `p_shop_id`
  parameter.
- **Set a safe `search_path`** in every new `SECURITY DEFINER` function, per standard
  Postgres `SECURITY DEFINER` hardening practice.
- **Scope `EXECUTE` privilege tightly** — the foreground RPC is callable by authenticated
  shop members only; the claim/resolve functions and scheduled functions are not directly
  callable by any client role at all, only by the trigger, `pg_cron`, and the foreground
  RPC itself. **Mandatory implementation step, not left implicit:** `REVOKE EXECUTE` on
  `claim_health_alert_transition`, `resolve_health_alert_transition`,
  `claim_health_alert_period`, and every scheduled `pg_cron` function `FROM PUBLIC, anon,
  authenticated` — `SECURITY DEFINER` functions are executable by `PUBLIC` by default in
  Postgres, so omitting this revocation would leave every one of them directly callable by
  any authenticated client despite the design's stated intent. Grant `EXECUTE` only to the
  specific trusted principal(s) the project's existing convention uses for internal/
  service-role-only functions (check precedent before implementation — e.g. how WAFI-151's
  `rebuild_daily_event_counts_scope` or WAFI-155's `set_rollout_flag` scope their own
  `EXECUTE` grants). This revocation is a mandatory test in the implementation plan, not
  an optional hardening step — "not directly callable by any client role" is the
  requirement; this `REVOKE` is the enforcement mechanism for it.
- **Notification-write authority is uniform across all three execution contexts** (trigger,
  `pg_cron`, RPC) precisely because all three ultimately call the same `SECURITY DEFINER`
  claim functions — the notification insert never depends on the calling context's own
  `INSERT` privilege on `public.notifications`, avoiding the failure mode where "it works
  from the trigger but not from the RPC" because the two execution contexts have different
  ambient privileges. This is the concrete reason the claim functions must be the sole
  writers of `public.notifications` for 148A (restated from the Alert Transition/Claim
  Layer invariant above, now with the security rationale attached).

## Candidate Definitions (issues #15, #16 — must reuse existing predicates, not invent new ones)

- **#7 stale-device candidates:** must reuse the exact eligible-device predicate already
  implemented in `syncStalenessCheck.ts` (active, belonging to the shop, not
  deactivated/revoked, onboarding-complete) — not a new, independently-derived query. Any
  divergence from that predicate is a deliberate decision to record at implementation
  time, not an accident of re-deriving it from scratch.
- **#8 overdue-shift candidates:** open shifts (`closed_at IS NULL`) belonging to an
  active shop, compared by elapsed duration (see Transactional Guarantees #13), against a
  threshold satisfying the cadence-aware margin requirement (Transactional Guarantees
  #12), not merely "< 18h." Confirm at implementation time whether multiple concurrent
  open shifts per shop are possible; if so, #8 alerts per open shift, keyed by real
  `shift_id` as `entity_id`.
- **Indexing (round 3):** #7's scheduled check now runs two queries per tick — new-candidate
  discovery and existing-`ALERTING`-row reconciliation (see Shape B) — so both need
  index support: a `devices(shop_id, last_seen_at)`-style index (plus whatever columns
  the reused eligibility predicate filters on) for the candidate query, and a partial
  index such as `health_alert_state_b (shop_id, entity_id) WHERE alert_key='stale_device'
  AND state='ALERTING'` for the reconciliation query, since the table's primary key
  `(shop_id, alert_key, entity_id)` doesn't efficiently support filtering by `state`. Exact
  indexes to be finalized against real query plans at implementation time, not mandated
  here — but the implementation plan must include this review, not discover the need for
  it after a large-shop performance regression.
- **Shared aggregation source (issue #16, round 3):** the Shape-A `SUM ... GROUP BY`
  query for #1/2/5/6 should reuse the same helper/SQL the existing WAFI-148 dashboard
  read-path (`useOwnerHealth.ts`) already uses for shop-wide aggregation, not an
  independently-written equivalent — two hand-maintained copies of the same aggregation
  logic are exactly how a dashboard and its alerting can silently drift apart over time.

## Notification Integration

- Target table: `public.notifications`, no new columns required. **Exact `type` values,
  round 4 — not examples, the contract:** one new type per alert, following this
  codebase's existing `snake_case` event-type naming convention:
  - `health_alert_sync_failures` (#1)
  - `health_alert_offline_duration` (#2)
  - `health_alert_dead_letter_count` (#3)
  - `health_alert_drawer_mismatches` (#4)
  - `health_alert_deferred_job_failures` (#5)
  - `health_alert_app_errors` (#6)
  - `health_alert_stale_device` (#7)
  - `health_alert_overdue_shift` (#8)

  If the project's existing `type` naming convention (check precedent in
  `notification.types.ts`/existing `notification_settings` rows before implementation)
  prefers a different prefix or casing, apply that instead — the requirement is these
  exact eight identifiers under whatever prefix convention already exists, not a new
  ad hoc convention invented at implementation time. Verified safe against existing
  consumers (`NotificationBell.vue`/`NotificationCenterScreen.vue` switch on `severity`,
  not `type`; `notificationRouting.ts` falls back gracefully for an unmapped
  `entity_type`). **[148, verified non-breaking]**
- `entity_type`/`entity_id` populated per alert (`'device'` for #7, `'shift'` for #8,
  shop-level/null for the rest).
- `source_event_id` set for #4 only (provenance, not dedup — see above); `NULL` for all
  state-derived metrics.
- Recipient: owner (`recipient_role`) for all 8 in v1, resolved inside the claim layer
  (see Transactional Guarantees #6).
- Reuse `notification_settings` for per-shop enable/threshold config — **[existing,
  reused]**.
- **Offline-duration copy correction [148A-new, minor]:** WAFI-148's existing message
  wording ("your device was offline for N hours") is inaccurate for a shop-wide sum in a
  multi-device shop — 148A's message must read shop-wide, e.g. "Devices in your shop
  accumulated N hours offline today."

## Alert Definitions (threshold defaults are placeholders pending product sign-off)

| # | Metric | Condition | Severity | Recipient | Recovery |
|---|---|---|---|---|---|
| 1 | Sync failures | `SUM(sync_failure_terminal)` today ≥ N | WARNING | Owner | Period reset |
| 2 | Offline duration | `SUM(offline_duration_seconds)` today ≥ N | WARNING | Owner | Period reset |
| 3 | Dead-letter count | gauge ≥ N | CRITICAL | Owner | Scheduled check, reverse condition |
| 4 | Drawer mismatches | count today ≥ N | WARNING | Owner | Period reset |
| 5 | Deferred-job failures | `SUM(deferred_job_failure_terminal)` today ≥ N | WARNING | Owner | Period reset |
| 6 | App errors | `SUM(app_error_count)` today ≥ N | WARNING | Owner | Period reset |
| 7 | Stale device | per-device, `now() - last_seen_at` ≥ N hours | WARNING | Owner | Scheduled check, reverse condition |
| 8 | Overdue shift | per-shift, elapsed `now() - opened_at` ≥ N hours, shift still open, N chosen with cadence-aware margin below WAFI-065's 18h force-close window | CRITICAL | Owner | `shift.closed` event |

## KPI Ownership Checklist (design time)

**Revised again (round 2) — separating the correctness invariant from the actual
product KPI**, per the observation that "evaluation-to-notification latency" is
trivially ≈0 by construction (claim and notification insert are one transaction) and so
isn't a meaningful *product* KPI on its own — it's a correctness check that the
transactional design works as specified. The metric that actually reflects user-facing
value — how quickly an owner learns about a real problem — is **evaluation cadence**:
how often the condition is actually checked at all.

```
Qualifies for a KPI: yes — user-facing (owner-visible notifications)
Primary KPI: alert evaluation freshness (renamed from "condition evaluation freshness,"
  round 3, to make clear this measures the evaluator's cadence, not the condition's own
  behavior) — for each evaluator type: scheduled checks (#3/7/8) = actual pg_cron interval
  achieved; foreground checks (#1/2/5/6) = time between eligible app-foreground events for
  a given shop; event-driven (#4) = negligible, bounded by shift-close transaction
  latency. This is the metric that reflects real user-awareness delay, not the
  claim/notification transaction itself. Note (round 3): Shape A's true
  threshold-crossing time is still fundamentally unknowable (no value history is kept),
  so even this KPI is a proxy — it measures how often the shop was checked, not how late
  any specific alert was relative to when the underlying condition actually turned bad.
Target: pending product sign-off alongside threshold defaults — e.g. scheduled checks
  within the chosen cron interval (15-30 min starting point), foreground checks bounded
  by typical shop usage patterns (no numeric target without usage data)
Measurement source: needs new instrumentation — record evaluation_started_at,
  evaluation_completed_at, evaluation_source (scheduled/foreground/event), and shop_id per
  evaluator run, sufficient to derive median/p95/max freshness and cron lateness per shop
  — not just a single interval number
Secondary operational invariant (not a KPI, a correctness check): notification.created_at
  minus health_alert_state_a.alerted_at / health_alert_state_b.state_changed_at should be
  ≈0 for every alert, by construction — a nonzero gap here would indicate the
  claim-then-notify transaction invariant has been violated, and is worth asserting in
  tests (see Testing Strategy) rather than tracking as a product metric
KPI_OWNERSHIP.md updated: not yet — will update at final review
```

## Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Notifications, Business Rules, Cash/Shifts, Staff, Devices, Health
Monitoring, Feature Flags, Scheduled Jobs

Matrix rows consulted: Cash / Shifts, Staff — see DOMAIN INTERACTION MATRIX in
AI_PRINCIPAL_ENGINEER_REVIEW.md

Cross-feature decisions verified:
- recipient resolution reuses existing owner-role notification targeting, done inside the
  claim layer, not a new application-layer lookup
- shift.closed remains the sole authoritative writer for the drawer-mismatch projection;
  148A's evaluation call is sequenced after it within the same transaction, not racing it
- shift.closed is also the authoritative recovery signal for the overdue-shift alert,
  giving the invariant "an overdue-shift alert can only be ALERTING while its shift is open"
- WAFI-065's zombie-shift force-close guard (18h) constrains #8's threshold — must be set
  below that window or the alert is unreachable
- verified (not assumed) that every currently shipping shift-close path — normal close
  and WAFI-065 force-close — publishes `shift.closed`, so #8's recovery invariant holds
  today; the reserved-but-unbuilt `'abandoned'` status is flagged as a constraint on
  whatever future ticket implements it, not an open risk in 148A itself
- feature-flag disable/re-enable reconciles alert state against current condition rather
  than trusting stale state — for #7 this requires an explicit existing-state
  reconciliation query independent of candidate enumeration, since a deactivated device
  drops out of the eligible-candidate population entirely
- notification_settings.enabled=false skips claiming entirely (Option A), so disabling
  briefly never consumes a period's alert
- business_rules is deliberately not extended into a generic metric-threshold engine

Open cross-feature questions: whether multiple concurrent open shifts per shop are
possible (affects #8's entity_id granularity) — to confirm at implementation time against
the cashier_shifts schema, not assumed here
```

## Migration / Implementation Changes (summary — full list at plan time)

- New tables: `health_alert_state_a`, `health_alert_state_b`.
- New shared functions: `claim_health_alert_transition` and
  `resolve_health_alert_transition` (Shape B), `claim_health_alert_period` (Shape A —
  round 3: now a shared function, not inlined per call site; Shape A has no recovery
  counterpart by design, see Alert-State Model).
- New Security/Authorization contract applied uniformly to all of the above plus the
  foreground RPC and scheduled functions below (see Security / Authorization Contract).
- New `pg_cron` job(s) for #3/#7/#8, each a single PL/pgSQL function enumerating
  candidates with a per-candidate exception-handling block (see Transactional Guarantees
  #4). **#7's scheduled function specifically must run two queries per tick** — new-alert
  discovery over eligible candidates, and a separate existing-`ALERTING`-row
  reconciliation pass — not one combined query (see Alert-State Model, Shape B).
- Extend the existing `shift.closed` server trigger function to sequentially call: (a)
  the existing drawer-mismatch projection write, (b) metric #4's claim evaluation, (c)
  `resolve_health_alert_transition` for #8 against that shift's `shift_id` — all in the
  trigger's existing transaction.
- New client-side foreground evaluator (extends the `syncStalenessCheck.ts`/
  `lowStockCheck.ts` registry pattern) for #1/2/5/6, calling a new SECURITY DEFINER RPC
  performing the `SUM ... GROUP BY` aggregation and Shape-A claim server-side.
- New `notification_settings` rows / UI entries for the new alert types, with threshold
  validation applied at write time (reject invalid config at the settings UI, not just at
  evaluation time).

## Testing Strategy

- Concurrency: two simultaneous claims on the same Shape A period key / Shape B entity key
  produce exactly one notification each.
- Rollback: forced notification-insert failure after a successful claim; verify state
  reverts and a later evaluation can still claim.
- Batch isolation: one malformed candidate in a scheduled batch's per-candidate exception
  block must not block notifications for other candidates in the same run.
- Aggregation: multi-device shop, metrics #1/2/5/6, `SUM ... GROUP BY` matches the
  existing dashboard's shop-wide totals exactly.
- Timezone boundary: period computed consistently across a day rollover regardless of
  client clock skew.
- No-repeat: Shape B condition remains bad across multiple scheduled runs — exactly one
  notification for the initial transition, none afterward until recovery + re-alert.
- Bootstrap: a condition already bad at 148A's first evaluation produces exactly one
  alert (issue #14).
- #4 ordering: evaluator observes the post-projection mismatch count, not a stale/earlier
  value, within the same trigger transaction (issue #10).
- #8 recovery: closing an overdue shift resolves its alert state via the `shift.closed`
  event, not the next scheduled tick.
- #7 recovery via deactivation: stale device → alert → device deactivated/revoked before
  becoming fresh again → next scheduled run's existing-state reconciliation query (not the
  candidate query) resolves the row to `HEALTHY`.
- Feature-flag reconciliation: disable → condition recovers while disabled → re-enable →
  first post-re-enable evaluation resolves to HEALTHY without a spurious alert.
- Notification-settings disabled: disable a type while its condition is bad → re-enable →
  condition (still bad) is eligible to alert, not silently consumed.
- Invalid threshold config: evaluator skips and logs, never invents a default.
- **Disabled-then-recovered-then-re-enabled (round 3, issue #3):** condition goes bad
  while a type is disabled → recovers while still disabled → goes bad again after
  re-enable → exactly one notification, for the post-re-enable episode only (not zero,
  not two).
- **Duplicate/replayed `shift.closed` (round 3, issue #17):** the same event processed
  twice (or an equivalent duplicate-delivery scenario) must not produce a second
  drawer-mismatch (#4) notification for the same Shape-A period — the alert-state claim
  protects this as long as the underlying drawer-mismatch projection itself is idempotent
  under replay (already a WAFI-148 invariant, not new here); explicitly test the
  combination rather than assuming each half's idempotency composes correctly.
- pgTAP suite: inherits WAFI-148's own outstanding "not yet run against real Postgres"
  risk — 148A's migrations must not ship without clearing that gap for both tickets
  together.

## Rollout / Operational Considerations

- Ship behind the WAFI-155 feature-flag framework (its first real consumer).
- `pg_cron` job frequency for #3/#7/#8 is an operational tuning knob (start conservative,
  e.g. 15-30 min, adjust from observed load) — not an architectural decision.
- **Scheduled-invocation failure visibility (round 3, issue #18):** a complete failure of
  a scheduled job invocation (e.g. failure before candidate enumeration even begins, not
  just a single candidate's isolated failure) must be visible through the existing
  engineering error-log path — this is new operational infrastructure, and silent total
  failures would be worse than a single bad candidate. This follows from, but is distinct
  from, per-candidate isolation (Transactional Guarantees #4): **a failed top-level
  invocation cannot partially commit** (ordinary Postgres transaction semantics), so no
  alert is ever falsely consumed by a failed run — an unclaimed condition remains fully
  eligible on the next successful invocation. Stated explicitly so this self-healing
  property isn't left implicit.

## Explicit Deferred / Future Work

- Sub-day/rolling-hour windows for metrics 1/2/5.
- Dollar-magnitude drawer-mismatch alerting.
- Escalation tiers / repeat-while-bad notifications.
- "Recovered" notifications.
- Push/WhatsApp/email delivery channels.
- Strict historical threshold-crossing semantics for Shape A (would require value
  history — the v1 "attainment" model is a deliberate, documented simplification, not an
  oversight).
- `syncStalenessCheck.ts`'s existing day-bucket dedup may already under-serve legitimate
  stale-device re-alerts independent of 148A — worth a small standalone fix.

## Still open before this goes into an implementation plan

**Resolved this revision (round 3 — the 7 engineering-contract gaps):**
- ~~Atomic claim→notify→`last_notified_at` contract~~ — now one function, fully specified.
- ~~Shape-A claim duplicated across 5 call sites~~ — now a shared `claim_health_alert_period` function.
- ~~SECURITY DEFINER / authorization contract unspecified~~ — new Security / Authorization
  Contract section covers all new server-side entry points uniformly.
- ~~`entity_id` FK ambiguity~~ — explicitly a plain UUID, not a foreign key, and why.
- ~~Sentinel `entity_id` for #3 undefined~~ — nil UUID specified, with a note to check for
  an existing project convention first.
- ~~#8 threshold safety stated as "< 18h" only~~ — now a cadence-and-jitter-aware margin
  requirement.
- ~~Shop-timezone source for Shape-A `period_start` not pinned down~~ — explicitly
  `shops.timezone`, never raw `CURRENT_DATE` or client/evaluator clock.

**Still genuinely open — schema check and product sign-offs, not engineering gaps:**
- ~~Confirm whether multiple concurrent open shifts per shop are possible (affects #8's
  `entity_id` granularity) — schema check, not a design decision.~~ **Resolved (Task 0,
  2026-08-22):** Yes, multiple shifts can be open concurrently for one shop. The only
  uniqueness guarantee in the schema is `uq_cashier_shifts_one_open_per_device` (partial
  unique index on `device_id` where `status = 'open'`,
  `supabase/migrations/026_cashier_shifts_zombie_guard.sql:33-38`), whose own comment
  states two different devices each holding an open shift is normal — only one device
  holding two is the bug it guards against. The app-level guard in
  `src/features/shifts/composables/useShift.ts:155-163` (`findOpenShiftForDevice`) is
  likewise scoped to `shop_id AND device_id`, not `shop_id` alone. No constraint anywhere
  limits a shop to a single open shift. **Decision: #8 keeps `shift_id` as its
  `entity_id`** (already the spec's assumption) — a shop-level sentinel would collapse
  distinct overdue-vs-not-overdue shifts from different devices into one alert-state row.
  Full evidence in `.superpowers/sdd/2026-08-22-wafi-148a-health-alerting-plan/task-0-report.md`.
- Exact default threshold values per metric — product sign-off, not an engineering call.
- Exact KPI target number for alert evaluation freshness, once product has seen the
  cron-interval tradeoffs.
