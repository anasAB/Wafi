# WAFI-148A: Health Alerting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn WAFI-148's 8 dashboard-only health metrics into exactly-one-notification-
per-alert-episode in-app alerting, without extending WAFI-156 into a generic threshold
engine and without introducing notification spam.

**Architecture:** Two alert-state shapes (period-bounded/monotonic "Shape A" for metrics
1/2/4/5/6; reversible/transition-tracked "Shape B" for metrics 3/7/8, plus a new live
overdue-shift condition), converging on one shared claim layer
(`claim_health_alert_period` / `claim_health_alert_transition` /
`resolve_health_alert_transition`) that is the sole writer of both new state tables and
`public.notifications`. Three evaluator types feed that layer: event-derived (metric #4,
extends the existing `shift.closed` trigger), foreground state-derived (metrics 1/2/5/6,
extends the `syncStalenessCheck.ts` registry pattern), and scheduled state-derived
(metrics 3/7/8, new `pg_cron` jobs).

**Tech Stack:** Same as WAFI-148 — PostgreSQL/PL-pgSQL (Supabase-hosted), pgTAP for
server tests, Vue 3 + TypeScript for the client-side foreground evaluator, `pg_cron`
(established by WAFI-147B) for scheduled evaluation.

**Spec:** `docs/superpowers/specs/2026-08-21-wafi-148a-health-alerting-design.md` —
signed off 2026-08-22 after 4 revisions. This plan implements that spec exactly; it does
not repeat the spec's rationale, only the concrete steps. **Read the spec's "Still open"
section before starting Task 1** — three items are explicit gates, not resolved
decisions, and are placed precisely in the task list below rather than silently assumed.

**Depends on:** WAFI-148 migrations 106-115 must be deployed to the hosted Supabase
project and its pgTAP suite must have run against real Postgres before this plan's
migrations ship (per WAFI-148's own outstanding status — this is not a new dependency
introduced by 148A, it's inherited and restated so it isn't missed). **Enforced as Task
0/Gate 0 below**, not left as prose only.

## Global Constraints (carried from the spec — do not re-derive, just apply)

- **`period_start` for Shape A is always shop-local day**, derived server-side from
  `shops.timezone`, never `CURRENT_DATE` on a UTC session, never client-supplied.
- **Shape-A aggregation for metrics 1/2/5/6 is always `SUM(value) ... GROUP BY
  metric_key, period_start` across all the shop's devices** — storage is per-device,
  the alert grain is shop-wide. Reuse the existing `useOwnerHealth.ts` aggregation
  logic/SQL rather than re-deriving it.
- **No evaluator ever inserts into `health_alert_state_a`, `health_alert_state_b`, or
  `public.notifications` directly.** Every evaluator calls the shared claim functions;
  only a successful claim proceeds to notify.
- **`entity_id` on `health_alert_state_b` is a plain UUID, never a foreign key.**
- **`notification_settings.enabled = false` skips claiming entirely** (Option A) —
  the evaluator exits before calling the claim layer; it never claims-but-suppresses.
- **Feature-flag disable never deletes/resets alert state**; re-enable re-evaluates
  fresh (Shape A) or reconciles current condition (Shape B) before any new transition.
- **No escalation tiers, no repeat-while-bad notifications, no "recovered" notifications**
  in this ticket.
- **#8's threshold must leave cadence-and-jitter-aware margin below WAFI-065's 18h
  force-close window** — not merely "< 18h."
- **All new server entry points share one authorization contract** (see spec's Security /
  Authorization Contract section) — safe `search_path`, no trusted caller-supplied
  `shop_id`, tightly scoped `EXECUTE` privilege.

---

## File Structure

**New server (Supabase):**
- `supabase/migrations/116_wafi148a_health_alert_state_a.sql` — schema
- `supabase/migrations/117_wafi148a_health_alert_state_b.sql` — schema
- `supabase/migrations/118_wafi148a_claim_functions.sql` — `claim_health_alert_period`,
  `claim_health_alert_transition`, `resolve_health_alert_transition`
- `supabase/migrations/119_wafi148a_shift_closed_trigger_extension.sql` — extends the
  existing `shift.closed` trigger to call metric #4's claim and #8's resolve
- `supabase/migrations/120_wafi148a_foreground_rpc.sql` — SECURITY DEFINER RPC for
  metrics 1/2/5/6
- `supabase/migrations/121_wafi148a_scheduled_checks.sql` — `pg_cron` job registrations +
  the three scheduled-check functions (#3, #7, #8)
- `supabase/migrations/122_wafi148a_notification_settings_seed.sql` — new alert types in
  `notification_settings`, **thresholds left as placeholders pending product sign-off
  (Gate 2 — see Task 9)**
- `supabase/tests/wafi148a_alert_state_schema.test.sql`
- `supabase/tests/wafi148a_claim_functions.test.sql`
- `supabase/tests/wafi148a_shape_a_evaluators.test.sql`
- `supabase/tests/wafi148a_shape_b_evaluators.test.sql`
- `supabase/tests/wafi148a_shift_closed_extension.test.sql`
- `supabase/tests/wafi148a_authorization.test.sql`

**New client:**
- `src/features/health/alerting/healthAlertCheck.ts` — foreground evaluator for metrics
  1/2/5/6, registered in the same registry `syncStalenessCheck.ts` uses
- `src/features/health/alerting/healthAlertTypes.ts` — shared types/enums for the new
  `notification_settings` types
- `src/router` / settings UI — extend the existing notification-settings screen with the
  new alert types (no new screen)

**New client tests:**
- `src/features/health/alerting/__tests__/healthAlertCheck.test.ts`

---

### Task 0 — Gate 0: WAFI-148 production-readiness (blocks Tasks 1-15 from shipping)

**This gate must be cleared before any of this plan's migrations are applied to the
hosted Supabase project — it does not block writing/testing code locally against a
throwaway Postgres instance.** 148A's evaluators read `health_metrics`/`health_gauges`
directly; if WAFI-148's own schema/RPCs are not confirmed correct in a real environment,
148A would be building alerting on top of an unverified foundation. This restates and
formalizes the plan's existing "Depends on" note as an actual gated task, per
implementation-readiness review round 4, rather than leaving it as prose easy to skip past.

- [ ] Confirm migrations 106-115 (WAFI-148) are deployed to the hosted Supabase project.
      **Still open** — no CLI access token / hosted DB connection string available as of
      2026-08-23; needs `supabase login` run interactively, then `supabase migration list
      --linked` against project `eazyrdnvsiyaaccvjbhb`.
- [x] Confirm WAFI-148's pgTAP suite has been run and passes against real Postgres (not
      just hand-verified/traced, per that ticket's own outstanding-risk note). **Done
      2026-08-23** — ran for real (docker + `supabase db reset`, 127 migrations, `supabase
      test db`) and found 8 genuine pre-existing fixture bugs across all 8
      `wafi148_*.test.sql` files (missing `auth.users` rows before FK'd shop inserts,
      missing `timezone_confirmed_at` against migration 115's readiness gate, a bare
      unwrapped RPC call whose `'ok'` return value was misparsed as a TAP line, a stale
      schema assertion, a non-existent composite-key overload, an orphan shop reference,
      and a plan-count mismatch missing its own claimed assertion). All fixed; the full
      `wafi148_*` + `wafi148a_*` suite now passes together locally. See commit fixing
      `supabase/tests/wafi148_*.test.sql`.
- [ ] Spot-check `health_metrics`/`health_gauges` schema and RPC behavior
      (`report_health_metrics`) against a real row in the hosted project — column
      types, `GREATEST`-merge behavior, and the day-bucketed primary key all match what
      this plan's evaluators assume. **Still open** — same hosted-access blocker as above;
      the local pgTAP suite (previous item) already exercises this behavior against a
      real (local) Postgres, but the hosted project itself hasn't been spot-checked.
- [ ] **Gate:** if any of the above fails, stop — do not begin Task 1. Fix or re-verify
      WAFI-148 first; 148A's migrations must not ship ahead of, or interleaved with, an
      unverified WAFI-148 foundation. **Not yet fully cleared** — local verification is
      done and passing; hosted-project deployment confirmation is still pending on CLI
      access (see above). Do not apply this plan's migrations to the hosted project until
      the two open items above are checked.

---

### Task 1 — Gate 1: verify concurrent-open-shift possibility (blocks Task 6 only)

**This must run before Task 6 (#8's evaluator) is finalized — not before Tasks 2-5.**
Nothing about Shape A, Shape B's tables/functions, metric #4, or metrics #3/#7 depends on
this answer; only #8's `entity_id` cardinality does.

**Already resolved, recorded here for traceability — do not redo.** The spec's "Still
open" section documents this was answered 2026-08-22: multiple shifts can be open
concurrently for one shop (only uniqueness guarantee is one-open-shift-per-*device*, not
per-shop — `supabase/migrations/026_cashier_shifts_zombie_guard.sql:33-38`). Decision: #8
keeps `shift_id` as its `entity_id`. Full evidence in
`.superpowers/sdd/2026-08-22-wafi-148a-health-alerting-plan/task-0-report.md`.

- [x] Inspect `cashier_shifts`' schema, constraints, indexes, and the shift-opening
      service code (`staff.service.ts`) to determine whether more than one shift can be
      open (`closed_at IS NULL`) concurrently for one shop. **Done — yes, possible.**
- [x] Record the finding directly in the spec's "Still open" section (update, don't
      leave stale) and in this task. **Done.**
- [x] If multiple concurrent open shifts are possible: #8 alerts per open shift, keyed by
      real `shift_id` as `entity_id` (already the spec's assumption — no plan change
      needed). **Confirmed — applies.**
- [ ] ~~If not possible: consider whether `entity_id` for #8 can safely be a per-shop
      sentinel instead of `shift_id`~~ — moot, multiple concurrent shifts are possible.

---

### Task 2: `health_alert_state_a` — schema

**Files:**
- Create: `supabase/migrations/116_wafi148a_health_alert_state_a.sql`
- Test: `supabase/tests/wafi148a_alert_state_schema.test.sql` (this task's assertions;
  Task 3 adds more to the same file)

- [ ] **Step 1: Write the failing pgTAP test** — table exists; columns `shop_id`,
      `metric_key`, `period_start`, `threshold_used`, `alerted_at` all `NOT NULL`;
      primary key is exactly `(shop_id, metric_key, period_start)`.
- [ ] **Step 2: Run test, verify it fails** (table doesn't exist yet).
- [ ] **Step 3: Write the migration** exactly per the spec's Shape A schema block —
      `NOT NULL` on all five columns, `PRIMARY KEY (shop_id, metric_key, period_start)`.
      No FK to `shops` is required by the spec; add one only if consistent with how
      `health_metrics` itself references `shops` (check migration 107's own pattern
      before deciding, don't diverge without reason).
- [ ] **Step 4: Run test, verify it passes.**

### Task 3: `health_alert_state_b` — schema

**Files:**
- Modify: `supabase/tests/wafi148a_alert_state_schema.test.sql`
- Create: `supabase/migrations/117_wafi148a_health_alert_state_b.sql`

- [ ] **Step 1: Write the failing pgTAP test** — table exists; all six columns `NOT
      NULL` except `last_notified_at` (nullable); `alert_key` has a `CHECK` constraint
      restricting it to exactly `('dead_letter_count','stale_device','overdue_shift')`
      (test both a valid insert and that an invalid `alert_key` value is rejected);
      `state` has a `CHECK` constraint restricting it to `('HEALTHY','ALERTING')`;
      primary key is exactly `(shop_id, alert_key, entity_id)`; **assert `entity_id` has
      no foreign-key constraint** (query `information_schema.table_constraints` /
      `key_column_usage` for the table and confirm no FK exists — this is a real
      assertion, not a formality, per the spec's explicit "never an FK" requirement).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Write the migration** per the spec's Shape B schema block, with both
      `CHECK` constraints and no FK on `entity_id`.
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Define and document the dead-letter sentinel constant.** Before writing
      `'00000000-0000-0000-0000-000000000000'` ad hoc, grep the codebase for an existing
      sentinel-UUID convention (the spec notes this check should happen before
      implementation). Document whichever constant is chosen in a code comment at every
      call site that uses it for `alert_key='dead_letter_count'`, not just in this
      migration's comment.

### Task 4: Shared claim/resolve functions

**Files:**
- Create: `supabase/migrations/118_wafi148a_claim_functions.sql`
- Create: `supabase/tests/wafi148a_claim_functions.test.sql`

- [ ] **Step 1: Write failing pgTAP tests for `claim_health_alert_period`:**
  - First claim for a `(shop_id, metric_key, period_start)` inserts the row, resolves the
    owner recipient, inserts exactly one `notifications` row, returns `true`.
  - Second claim for the same key returns `false`, inserts zero additional
    `notifications` rows, does not modify `threshold_used`/`alerted_at` on the existing row.
  - Two concurrent claims for the same key (simulate via two sessions/advisory-lock-free
    concurrent transactions in the test harness) result in exactly one successful claim
    and exactly one notification — **this is the round-3-priority correctness assertion,
    write it explicitly, don't treat single-caller tests as sufficient.**
- [ ] **Step 2: Run tests, verify they fail** (function doesn't exist).
- [ ] **Step 3: Implement `claim_health_alert_period`** — `INSERT ... ON CONFLICT
      (shop_id, metric_key, period_start) DO NOTHING RETURNING *`; on a returned row,
      resolve `recipient_role='owner'` the same way existing owner-targeted notification
      writers do, insert into `notifications`, return `true`; otherwise return `false`.
      `SECURITY DEFINER`, safe `search_path` set explicitly.
- [ ] **Step 4: Write failing pgTAP tests for `claim_health_alert_transition`:**
  - Missing row + call → creates row with `state='ALERTING'`, notifies, returns `true`
    (bootstrap case — no separate "create" path).
  - Existing `state='HEALTHY'` row + call → transitions to `ALERTING`, notifies, returns
    `true`.
  - Existing `state='ALERTING'` row + call → no change, no notification, returns `false`.
  - Concurrent claims on the same `(shop_id, alert_key, entity_id)` → exactly one
    successful claim, exactly one notification.
  - After a successful claim, `last_notified_at` is set to the notification's
    `created_at` (or the same `now()` value used for the insert — assert they match).
- [ ] **Step 5: Run tests, verify they fail.**
- [ ] **Step 6: Implement `claim_health_alert_transition`** exactly per the spec's
      4-step atomic contract (claim → check → resolve+notify+update `last_notified_at` →
      return). `SECURITY DEFINER`, safe `search_path`.
- [ ] **Step 7: Write failing pgTAP tests for `resolve_health_alert_transition`:**
  - Existing `ALERTING` row → resolves to `HEALTHY`, **inserts no notification** (recovery
    is silent — assert zero new `notifications` rows).
  - Missing row → no-op, no error.
- [ ] **Step 8: Run tests, verify they fail, then implement, then verify they pass.**
- [ ] **Step 9: Rollback test** (Transactional Guarantees #2 from the spec) — force the
      notification insert to fail inside `claim_health_alert_transition` (e.g. a test
      hook or a deliberately invalid recipient in a controlled test) and assert the whole
      transaction rolls back: no `health_alert_state_b` row change persists, a later
      claim can still succeed.
- [ ] **Step 10: Authorization tests** (new file `wafi148a_authorization.test.sql`) —
      assert none of these three functions are directly `EXECUTE`-able by the
      `authenticated` role (they're called only by the trigger, cron functions, and the
      foreground RPC — none of which are the raw `authenticated` role itself unless the
      project's existing RPC pattern says otherwise; verify against how `execute_rule_action`
      itself is locked down and mirror that, don't invent a new privilege model).

### Task 5: Metric #4 (drawer mismatches) — event-derived evaluator

**Files:**
- Create: `supabase/migrations/119_wafi148a_shift_closed_trigger_extension.sql`
- Create: `supabase/tests/wafi148a_shift_closed_extension.test.sql`

- [ ] **Step 1: Write failing pgTAP tests:**
  - A `shift.closed` event that pushes the shop's drawer-mismatch count for today ≥
    threshold results in exactly one notification, `source_event_id` set to that event's
    id.
  - A second `shift.closed` event the same day, still ≥ threshold, results in zero
    additional notifications (Shape A dedup).
  - **Ordering test (spec Transactional Guarantees #5):** the evaluator must observe the
    *post-projection* mismatch count, not a stale pre-projection value — construct a test
    where the projection write and the alert evaluation would disagree if evaluated out
    of order, and assert the alert fires based on the correct (post-projection) value.
  - **Duplicate-event test (spec, issue #17):** replay/duplicate-process the same
    `shift.closed` event (however the existing WAFI-148 projection idempotency test
    simulates this) and assert no second notification results.
  - **#8 resolve test:** a `shift.closed` event for a shift that was `ALERTING` in
    `health_alert_state_b` (`alert_key='overdue_shift'`) resolves that row to `HEALTHY` in
    the same transaction — depends on Task 6's `alert_key` existing; if Task 6 isn't done
    yet, stub this assertion and complete it after Task 6, don't skip it permanently.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Extend the existing `shift.closed` trigger function** to sequentially,
      within its existing transaction: (a) the existing drawer-mismatch projection write
      (unchanged), (b) call `claim_health_alert_period` for metric #4 with the
      post-projection `SUM`, (c) call `resolve_health_alert_transition` for
      `alert_key='overdue_shift'`, `entity_id` = that shift's id.
- [ ] **Step 4: Run tests, verify they pass.**

**✅ Tasks 1–6 complete** — concurrent-open-shift gate resolved; `health_alert_state_a`/`_b`
schema, shared claim/resolve functions, metric #4's event-derived evaluator, and metric
#8's scheduled evaluator all implemented, reviewed, and committed — see
`.superpowers/sdd/2026-08-22-wafi-148a-health-alerting-plan/progress.md` for full detail,
commit ranges, and review verdicts per task.

**⚠️ Task 0 (WAFI-148 production-readiness gate) is NOT confirmed resolved** — per this
task's own text, it does not block writing/testing code locally (which is all Tasks 1-6
have done, against no live Postgres at all, Docker unavailable throughout), so
implementation correctly proceeded. But it DOES gate actually shipping any of this
plan's migrations to the hosted Supabase project. This remains an open item to clear
before deployment — do not silently treat it as satisfied by local implementation
progress.

Continuing at Task 7.

### Task 6 — depends on Task 1's finding: Metric #8 (overdue shift) — scheduled evaluator

**Files:**
- Create: part of `supabase/migrations/120_wafi148a_scheduled_checks.sql` (already
  created by this task — implemented and reviewed clean, see ledger)
- Create: part of `supabase/tests/wafi148a_shape_b_evaluators.test.sql`

- [x] **Step 1: Confirm Task 1's finding is applied** — `entity_id` granularity for this
      metric is per-`shift_id` (or the simplified sentinel, only if Task 1 justified it).
- [ ] **Step 2: Write failing pgTAP tests:**
  - An open shift past threshold, never before evaluated, produces exactly one
    notification (bootstrap case).
  - The same open shift, still overdue, on a second scheduled run produces zero
    additional notifications.
  - Closing the shift (via the Task 5 trigger extension) resolves the state — **not**
    the scheduled check — assert the scheduled check alone, without any `shift.closed`
    event, does *not* resolve an already-closed... actually assert the inverse: a closed
    shift is simply absent from the open-shift candidate query, so the scheduled check
    correctly does nothing for it (the resolve already happened via Task 5).
  - Elapsed-duration comparison is timezone-independent — construct a shop in a
    non-UTC timezone and confirm the threshold comparison uses absolute `timestamptz`
    elapsed time, not a shop-local-day bucket comparison.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement the scheduled function** — enumerate open shifts
      (`closed_at IS NULL`) past the (still-placeholder, see Gate 2) threshold, call
      `claim_health_alert_transition` per candidate inside a per-candidate
      `BEGIN...EXCEPTION WHEN OTHERS THEN...END` block (no explicit `ROLLBACK`), logging
      any caught exception via the existing engineering error-log path.
- [ ] **Step 5: Register the `pg_cron` job** at a conservative interval (15-30 min,
      operational tuning, not architectural).
- [ ] **Step 6: Run tests, verify they pass.**

### Task 7: Metric #3 (dead-letter count) — scheduled evaluator

**Files:**
- Extend: `supabase/migrations/120_wafi148a_scheduled_checks.sql`
- Extend: `supabase/tests/wafi148a_shape_b_evaluators.test.sql`

- [ ] **Step 1: Write failing pgTAP tests:**
  - Gauge already over threshold at first evaluation (bootstrap) → one notification.
  - Gauge rises, falls back under threshold, rises again → exactly two notifications
    (one per `HEALTHY→ALERTING` transition), zero while it stays above threshold across
    multiple ticks.
  - Uses the defined sentinel `entity_id` from Task 3, Step 5 — assert the exact constant.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement the scheduled function** — read `health_gauges.dead_letter_count`
      per shop, call `claim_health_alert_transition` (rising) or
      `resolve_health_alert_transition` (falling) as appropriate, same per-candidate
      exception-isolation pattern as Task 6. Register in the same `pg_cron` job or a
      separate one — batch efficiency decision, not architectural.
- [ ] **Step 4: Run tests, verify they pass.**

### Task 8: Metric #7 (stale devices) — scheduled evaluator with dual-query recovery

**This is the task with the round-3 correctness fix — implement the two-query model
exactly, do not collapse it back into one query for "simplicity."**

**Files:**
- Extend: `supabase/migrations/120_wafi148a_scheduled_checks.sql`
- Extend: `supabase/tests/wafi148a_shape_b_evaluators.test.sql`

- [ ] **Step 1: Write failing pgTAP tests:**
  - New-candidate discovery: an eligible device goes stale → one notification.
  - Recovery via freshness: a stale, `ALERTING` device becomes fresh again → resolved to
    `HEALTHY` on the next tick.
  - **Recovery via disappearance (the round-3 fix):** a stale, `ALERTING` device is then
    deactivated/revoked (so it drops out of the eligible-candidate predicate entirely) →
    the *reconciliation* query (not the candidate query) still finds and resolves the
    `ALERTING` row to `HEALTHY` on the next tick. Explicitly assert this would fail if
    only the candidate query ran (i.e. the test should be written to actually exercise
    the second query's necessity, not just its presence).
  - Multi-device shop: two devices independently tracked, independent `entity_id` rows,
    no cross-device interference.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement two separate queries in the scheduled function:**
  - Query A (new-alert discovery): the exact eligible-device predicate from
    `syncStalenessCheck.ts` (active, belonging to shop, not deactivated/revoked,
    onboarding-complete), filtered to `now() - last_seen_at >= threshold`, call
    `claim_health_alert_transition` per candidate.
  - Query B (reconciliation): every existing `health_alert_state_b` row with
    `alert_key='stale_device'` and `state='ALERTING'`, independently check whether the
    device is now fresh **or** no longer in the eligible population at all, call
    `resolve_health_alert_transition` for either case.
  - Both wrapped in the same per-candidate exception-isolation pattern as Task 6/7.
- [ ] **Step 4: Add indexes** — `devices(shop_id, last_seen_at)` (plus whatever columns
      the reused eligibility predicate filters on) for Query A; a partial index
      `health_alert_state_b (shop_id, entity_id) WHERE alert_key='stale_device' AND
      state='ALERTING'` for Query B. Verify against `EXPLAIN` on realistic data volume
      before finalizing — the spec explicitly declines to mandate the exact index without
      seeing real query plans.
- [ ] **Step 5: Run tests, verify they pass.**

### Task 9 — Gate 2: notification_settings seeding (blocked on product thresholds)

**Files:**
- Create: `supabase/migrations/121_wafi148a_notification_settings_seed.sql`

- [x] **Step 1: Write the migration structurally**, with `threshold_json` values left as
      explicit placeholders (e.g. a clearly-named sentinel or a migration that fails
      loudly / is deliberately left uncommitted) rather than invented numbers — **do not
      guess production thresholds.**
- [x] **Step 2: Add threshold validation** at both the settings-UI write path and the
      evaluator read path (reject non-numeric, negative, null, or — for #8 specifically —
      zero; skip evaluation and log on invalid config, never fall back to an invented
      default at runtime).
- [x] **Step 3: This migration does not ship/apply with real values until product
      supplies the actual threshold defaults** (spec Gate 2). **Resolved 2026-08-23** —
      product confirmed suggested defaults (sync failures ≥5/day, offline duration
      ≥14400s/day, dead-letter ≥1, drawer mismatches ≥1/day, deferred-job failures
      ≥5/day, app errors ≥10/day, stale device ≥24h, overdue shift ≥12h). Per the
      migration's own reasoning these are NOT written into `notification_settings` by any
      migration — every shop still ships with all 8 types off until the owner explicitly
      enables one. The confirmed numbers are surfaced only as placeholder ghost text in
      the Settings UI (`HEALTH_THRESHOLD_SUGGESTED_DEFAULT` in
      `NotificationSettingsScreen.vue`) so an owner has a sane number to accept or
      override. Documented in migration 121's own comment block.

### Task 10: Client-side foreground evaluator (metrics 1/2/5/6)

**Files:**
- Create: `src/features/health/alerting/healthAlertCheck.ts`
- Create: `src/features/health/alerting/healthAlertTypes.ts`
- Create: `src/features/health/alerting/__tests__/healthAlertCheck.test.ts`
- Create: `supabase/migrations/122_wafi148a_foreground_rpc.sql`
- Create: part of `supabase/tests/wafi148a_shape_a_evaluators.test.sql`

- [ ] **Step 1: Write failing pgTAP tests for the foreground RPC:**
  - Authenticated caller from shop A cannot evaluate/claim for shop B (authorization
    contract — derive shop membership server-side, never trust a caller-supplied
    `shop_id` parameter).
  - Multi-device shop: `SUM ... GROUP BY` aggregation matches `useOwnerHealth.ts`'s
    existing shop-wide totals exactly, for a shop with 3+ devices each reporting the
    metric.
  - Threshold attainment semantics: value crosses from below to at/above threshold →
    one notification; a subsequent threshold *decrease* mid-period does not retroactively
    fire or retract anything for a period already claimed.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement the RPC** — derives the caller's shop server-side (reuse the
      existing authorization pattern other client-callable RPCs use), runs the shared
      `SUM ... GROUP BY` aggregation (reuse `useOwnerHealth.ts`'s logic/SQL, don't
      re-derive), calls `claim_health_alert_period` per metric. `SECURITY DEFINER`, safe
      `search_path`, `EXECUTE` granted to `authenticated` only.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Write failing client test** for `healthAlertCheck.ts` — registered in the
      same foreground-check registry `syncStalenessCheck.ts` already runs in; calls the
      new RPC on app foreground; does not call it from inside `report_health_metrics`
      itself (these are two independent triggers, per the spec's clarification).
- [ ] **Step 6: Implement, run tests, verify they pass.**

### Task 11: Feature-flag gating (WAFI-155)

**Files:**
- Modify: relevant evaluator call sites (trigger, RPC, scheduled functions) to check the
  WAFI-155 flag before evaluating.

- [ ] **Step 1: Write failing tests:**
  - Flag off: no claims occur, existing state untouched.
  - Flag off while a Shape B condition recovers, then flag on: first post-re-enable
    evaluation resolves to `HEALTHY` without a spurious alert (uses Task 8's
    reconciliation query for #7; uses Task 6/7's mechanisms for #8/#3).
  - Flag off then on, Shape A: evaluates fresh against current value/threshold, no
    attempt to reconstruct missed history.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Add the flag check** to each evaluator entry point (before calling any
      claim function).
- [ ] **Step 4: Run tests, verify they pass.**

### Task 12: `notification_settings.enabled = false` behavior

**Files:**
- Modify: same evaluator call sites as Task 11.

- [ ] **Step 1: Write failing tests:**
  - Disabled type + bad condition → no claim occurs at all (not claim-but-suppress).
  - Disabled while bad → re-enabled while still bad → eligible to alert (not "already
    consumed").
  - **Disabled-then-recovered-then-re-enabled (round 3 addition):** bad while disabled →
    recovers while still disabled → bad again after re-enable → exactly one notification
    for the post-re-enable episode.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Add the enabled check** to each evaluator entry point, before the flag
      check or combined with it — evaluator exits before calling any claim function if
      disabled.
- [ ] **Step 4: Run tests, verify they pass.**

### Task 13: Settings UI — new alert types

**Files:**
- Modify: existing notification-settings screen/composable to surface the 8 new types.

- [ ] **Step 1:** Add the 8 new `notification_settings` types to the existing UI, with
      threshold input validation matching Task 9's server-side rules (reject invalid
      config at write time, not just at evaluation time).
- [ ] **Step 2:** Manual verification in a running dev instance — toggle each type,
      confirm settings persist and are read by the evaluators.

### Task 14 — Gate 3: KPI instrumentation (target number pending product)

**Files:**
- New instrumentation for `evaluation_started_at`, `evaluation_completed_at`,
  `evaluation_source`, `shop_id` per evaluator run (cron ticks, foreground-check
  invocations, trigger-driven evaluations).

- [ ] **Step 1:** Implement the instrumentation sufficient to derive median/p95/max
      "alert evaluation freshness" per shop, independent of any final target number.
- [ ] **Step 2:** Add the secondary correctness assertion to the test suite:
      `notifications.created_at` minus `health_alert_state_a.alerted_at` /
      `health_alert_state_b.state_changed_at` is ≈0 for every alert (asserts the
      claim-then-notify transaction invariant, not a product KPI).
- [x] **Step 3:** `KPI_OWNERSHIP.md` entry left as "instrumented, target pending product
      sign-off" — **do not mark it `Defined` until product supplies the actual target
      number** (Gate 3). **Resolved 2026-08-23** — product confirmed a 15-minute target
      for scheduled evaluators (#3/#7/#8), matching the `*/15 * * * *` cron cadence
      already implemented in migration 120 (no migration change needed — the cadence was
      already set at the value now confirmed as the target); p95 target 20 minutes.
      Foreground-check freshness (#1/#2/#5/#6) has no fixed numeric target by design — it
      is bounded by app-usage patterns, tracked as an observability signal only.
      `KPI_OWNERSHIP.md` updated with the confirmed target.

### Task 15: Full-branch verification

- [ ] Run the complete pgTAP suite against real Postgres (both this branch's tests and
      WAFI-148's own still-outstanding suite — per this plan's stated dependency, both
      must be clear before either ships).
- [ ] Run the full client test suite.
- [ ] Manual smoke test in a dev instance: trigger each of the 8 alert conditions,
      confirm exactly one notification per condition, confirm recovery/re-alert behavior
      for the 3 Shape B conditions.
- [ ] Fill in the WAFI-014 Cross-Epic Edge-Case Checklist (final review) and WAFI-032 KPI
      Ownership Checklist (final review) blocks in a final-review write-up, per
      `AI_PRINCIPAL_ENGINEER_REVIEW.md`'s required templates — do not mark KPI ownership
      `Defined` if Gate 3's target number is still outstanding; record it as `Backfill
      needed` instead, honestly, per that checklist's own instructions.
- [ ] Confirm Gates 0, 1, 2, 3 are each either resolved or explicitly still tracked as open
      before calling the ticket complete.
