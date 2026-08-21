# WAFI-148: Internal Health Monitoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two founders (team view) and each shop owner (owner view) a trustworthy
dashboard of Wafi's own operational health — sync reliability, offline duration, dead
letters, drawer mismatches, deferred-job failures, app errors, stale devices, and
never-closed shifts — collected without ever competing with business-critical
PowerSync sync or blocking checkout.

**Architecture:** Four client-derived metrics (sync upload failures, offline duration,
deferred-job failures, app errors) accumulate in a bounded local-only SQLite table and
report via a periodic + on-reconnect direct Supabase RPC, entirely outside PowerSync's
CRUD queue. One client-derived current-state gauge (dead-letter count) reports the same
way but with overwrite, not cumulative, semantics. Three metrics (drawer mismatch,
never-closed shifts, stale devices) are server-authoritative, computed entirely from
data that already exists server-side and never transmitted from the client. All 8 land
in one `health_metrics`/`health_gauges` read-model pair, cloning the `profit_cache`
event-sourced pattern for the event-derived ones. Two dashboards consume the same
formatting layer: an owner view (plain language, `can_view_health_metrics` permission
flag, mirrors `can_view_reports`) and a team view (`platform_admins` table, the same
predicate already used by `list_shops_for_rollout_admin`).

**Tech Stack:** PostgreSQL/PL-pgSQL (Supabase-hosted), pgTAP for server tests, Vue 3 +
TypeScript for client instrumentation and dashboards, PowerSync `localOnly` SQLite
tables for the bounded local accumulator, existing direct-Supabase-RPC pattern (same
category as `register_device`/`switch_active_operator`) for transport.

**Spec:** `docs/superpowers/specs/2026-08-21-wafi-148-health-monitoring-design.md` — this
plan implements that spec exactly as written (frozen after 4 self-review rounds).
Executors should read both; this plan does not repeat the spec's rationale, only the
concrete steps.

## Global Constraints

- **Daily granularity only** — every `period_start` is a shop-local calendar date
  (`shops.timezone`, IANA name), never UTC or device-local dates. Hourly granularity is
  out of scope.
- **Three metric authority classes, never mixed**: cumulative client-authoritative
  (metrics 1, 2, 5, 6 — server upsert uses `GREATEST(existing, incoming)`), server-
  authoritative (metrics 4, 7, 8 — plain overwrite / event-sourced apply, **never**
  `GREATEST()`), client-authoritative current-state gauge (metric 3 — overwrite with
  `observed_at`, never deleted).
- **Terminal outcomes only** — sync and deferred-job counters increment once per
  logical operation's final result, never once per retry attempt.
- **Zero vs. no-data are distinct everywhere** — a rate with `denominator = 0` is
  "No data," never "0%"; a count of `0` is a legitimate healthy zero. Lives in one
  shared formatting layer.
- **Health telemetry is never on the correctness path** — if the RPC or local storage
  fails, the POS must keep working; telemetry loss is acceptable, checkout failure is
  not.
- **The health RPC is an allowlisted write path** — `metric_key`/`gauge_key` values are
  a server-side enum; class-S metrics can never appear in that enum, so no client
  payload shape can write them. `device_id`/`shop_id` are derived from the authenticated
  session, never trusted from the payload. `period_start` must fall within the 7-day
  reporting window.
- **Printer/scanner failure metrics are explicitly deferred** — not part of this plan.
- **Alerting is explicitly deferred to WAFI-148A** — no WAFI-156 changes, no new
  notification events, no digest, in this plan.
- **`shops.timezone` is nullable** — health metrics simply don't compute for a shop
  until it's set; no unsafe global default.

---

## File Structure

**New server (Supabase):**
- `supabase/migrations/106_wafi148_shops_timezone.sql` — schema
- `supabase/migrations/107_wafi148_health_metrics_gauges.sql` — schema + RLS
- `supabase/migrations/108_wafi148_report_health_metrics_rpc.sql` — RPC
- `supabase/migrations/109_wafi148_drawer_mismatch_projection.sql` — event-sourced apply
- `supabase/migrations/110_wafi148_never_closed_shift_projection.sql` — event-sourced apply
- `supabase/migrations/111_wafi148_can_view_health_metrics.sql` — permission flag default
- `supabase/tests/wafi148_health_metrics_schema.test.sql`
- `supabase/tests/wafi148_report_health_metrics_rpc.test.sql`
- `supabase/tests/wafi148_drawer_mismatch_projection.test.sql`
- `supabase/tests/wafi148_never_closed_shift_projection.test.sql`
- `supabase/tests/wafi148_rls_cross_shop.test.sql`

**New client:**
- `src/data/powersync/schema.ts` — modify, add `local_health_metrics`/`local_health_gauges`
- `src/features/health/health.types.ts` — shared types/enums
- `src/features/health/composables/useDeviceActivity.ts` — `markDeviceActiveForDay()`
- `src/features/health/composables/useHealthReporting.ts` — accumulator read + RPC send
- `src/features/health/format/healthFormat.ts` — shared zero/no-data/rate formatting
- `src/features/health/composables/useOwnerHealth.ts` — owner dashboard data
- `src/features/health/composables/useTeamHealth.ts` — team dashboard data
- `src/features/health/OwnerHealthPage.vue`
- `src/features/health/TeamHealthPage.vue`
- `src/data/powersync/ops.ts` — modify, count terminal sync outcomes
- `src/data/powersync/dead-letter.ts` — modify, report gauge
- `src/services/events/drainDeferredJobs.ts` — modify, count terminal job outcomes
- `src/composables/useOnlineStatus.ts` / `src/features/sync/useSync.ts` — modify, offline-cycle tracking
- `src/main.ts` — modify, wire global unhandled-error counter
- `src/router/index.ts` — modify, register the two new routes

**New client tests:**
- `src/features/health/__tests__/useDeviceActivity.test.ts`
- `src/features/health/__tests__/healthFormat.test.ts`
- `src/features/health/__tests__/useHealthReporting.test.ts`
- `src/features/health/__tests__/useOwnerHealth.test.ts`
- `src/features/health/__tests__/useTeamHealth.test.ts`

---

### Task 1: `shops.timezone` — schema, nullable, no default

**Files:**
- Create: `supabase/migrations/106_wafi148_shops_timezone.sql`
- Test: `supabase/tests/wafi148_health_metrics_schema.test.sql` (this task's assertions;
  Task 2 adds more to the same file)

**Interfaces:**
- Produces: `shops.timezone text` (nullable, no default) — every later task's
  `period_start` computation reads this column.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi148_health_metrics_schema.test.sql
BEGIN;
SELECT plan(3);

SELECT has_column('public', 'shops', 'timezone', 'shops.timezone exists');
SELECT col_type_is('public', 'shops', 'timezone', 'text', 'shops.timezone is text');
SELECT col_is_null('public', 'shops', 'timezone', 'shops.timezone has no default (nullable)');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — `shops.timezone` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/106_wafi148_shops_timezone.sql
-- WAFI-148: shop-local IANA timezone, required for every health-metric period
-- boundary. Nullable, no default -- defaulting every existing shop to one
-- timezone would be wrong for any shop outside Syria (WAFI accepts
-- opportunistic signups from Lebanon/Iraq/Jordan). Health metrics simply do
-- not compute for a shop until this is set via onboarding/settings.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.shops.timezone IS
  'IANA timezone name (e.g. Asia/Damascus). NULL until the owner configures it. '
  'All WAFI-148 health-metric period_start values are shop-local calendar dates '
  'derived from this column -- never UTC or device-local dates.';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 3/3 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/106_wafi148_shops_timezone.sql supabase/tests/wafi148_health_metrics_schema.test.sql
git commit -m "feat(WAFI-148): add shops.timezone, nullable, no unsafe default"
```

---

### Task 2: `health_metrics` + `health_gauges` server tables, RLS

**Files:**
- Create: `supabase/migrations/107_wafi148_health_metrics_gauges.sql`
- Modify: `supabase/tests/wafi148_health_metrics_schema.test.sql`

**Interfaces:**
- Consumes: `shops.timezone` (Task 1).
- Produces: `public.health_metrics(shop_id, device_id, metric_key, period_start, value,
  updated_at)`, `public.health_gauges(shop_id, device_id, gauge_key, value,
  observed_at)` — Task 3's RPC and Tasks 4/5's apply functions write these; Tasks 13/14's
  dashboards read them.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- append to supabase/tests/wafi148_health_metrics_schema.test.sql, before "SELECT * FROM finish();"
SELECT plan(3 + 10);  -- bump the plan count from Task 1's 3

-- ... Task 1's 3 assertions stay above ...

SELECT has_table('public', 'health_metrics', 'health_metrics table exists');
SELECT has_table('public', 'health_gauges', 'health_gauges table exists');
SELECT col_is_unique(
  'public', 'health_metrics',
  ARRAY['shop_id', 'device_id', 'metric_key', 'period_start'],
  'health_metrics has a unique key on shop/device/metric/period'
);
SELECT col_is_unique(
  'public', 'health_gauges',
  ARRAY['shop_id', 'device_id', 'gauge_key'],
  'health_gauges has a unique key on shop/device/gauge'
);
SELECT col_not_null('public', 'health_metrics', 'value', 'health_metrics.value is NOT NULL');
SELECT col_not_null('public', 'health_gauges', 'observed_at', 'health_gauges.observed_at is NOT NULL');

-- RLS smoke test: two shops, cross-shop read must return 0 rows.
-- auth_shop_id() (migration 015) resolves via shops.owner_user_id = auth.uid(),
-- reading the JWT's `sub` claim -- NOT a shop_id claim (there is no such claim
-- anywhere in this codebase's auth model). Established pattern per
-- supabase/tests/wafi156_execute_rule_action.test.sql: give the shop a known
-- owner_user_id, then set_config('request.jwt.claims', '{"sub":"<same uuid>",...}').
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, owner_user_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Shop A', 'e0000000-0000-0000-0000-000000000001')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.shops (id, name, owner_user_id) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Shop B', 'e0000000-0000-0000-0000-000000000002')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
VALUES ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'app_error_count', '2026-08-21', 3);

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000002","active_role":"owner"}', true);
SET LOCAL role authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.health_metrics WHERE shop_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'shop B cannot read shop A health_metrics rows via RLS'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — tables don't exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/107_wafi148_health_metrics_gauges.sql
-- WAFI-148: server-side read models for the 8 locked health metrics.
--
-- Two authority classes land here:
--   health_metrics -- cumulative client-authoritative (1,2,5,6, GREATEST()-merged
--                     by the RPC in migration 108) AND server-authoritative
--                     event-sourced (4,8, overwritten by the apply functions in
--                     migrations 109/110). The (shop_id, device_id, metric_key,
--                     period_start) key is shared by both; device_id is a fixed
--                     sentinel uuid for shop-level (not per-device) metrics 4/8.
--   health_gauges  -- the one client-authoritative current-state exception (3,
--                     dead-letter count): overwritten, never GREATEST()'d, never
--                     deleted, always carries observed_at freshness.
--
-- Metric 7 (stale device count) is NOT stored here at all -- it's a live query
-- over devices.last_seen_at with no historical value (see Task 14).

CREATE TABLE IF NOT EXISTS public.health_metrics (
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  device_id    uuid NOT NULL,
  metric_key   text NOT NULL CHECK (metric_key IN (
                 'sync_failure_terminal', 'sync_terminal_total',
                 'offline_duration_seconds',
                 'deferred_job_failure_terminal', 'deferred_job_terminal_total',
                 'app_error_count', 'active_device_day', 'telemetry_periods_dropped',
                 'drawer_mismatch_count', 'never_closed_shift_count'
               )),
  period_start date NOT NULL,
  value        bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, device_id, metric_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_health_metrics_shop_period
  ON public.health_metrics (shop_id, period_start);

CREATE TABLE IF NOT EXISTS public.health_gauges (
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  device_id    uuid NOT NULL,
  gauge_key    text NOT NULL CHECK (gauge_key IN ('dead_letter_count')),
  value        bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  observed_at  timestamptz NOT NULL,
  PRIMARY KEY (shop_id, device_id, gauge_key)
);

ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_gauges  ENABLE ROW LEVEL SECURITY;

-- Shop-scoped read, mirroring every other synced/read-model table's RLS
-- (auth_shop_id(), migration 015 pattern). No client INSERT/UPDATE/DELETE
-- policy exists on either table -- all writes go through the SECURITY
-- DEFINER RPC (migration 108) and the SECURITY DEFINER apply functions
-- (migrations 109/110), never direct client writes.
CREATE POLICY health_metrics_select_own_shop ON public.health_metrics
  FOR SELECT USING (shop_id = public.auth_shop_id());

CREATE POLICY health_gauges_select_own_shop ON public.health_gauges
  FOR SELECT USING (shop_id = public.auth_shop_id());

GRANT SELECT ON public.health_metrics TO authenticated;
GRANT SELECT ON public.health_gauges TO authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 13/13 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/107_wafi148_health_metrics_gauges.sql supabase/tests/wafi148_health_metrics_schema.test.sql
git commit -m "feat(WAFI-148): add health_metrics/health_gauges read models with shop-scoped RLS"
```

---

### Task 3: `report_health_metrics` RPC — allowlist, identity, idempotent merge

**Files:**
- Create: `supabase/migrations/108_wafi148_report_health_metrics_rpc.sql`
- Test: `supabase/tests/wafi148_report_health_metrics_rpc.test.sql`

**Interfaces:**
- Consumes: `health_metrics`/`health_gauges` (Task 2), `public.devices` (existing,
  `is_active`, `last_seen_at`), `public.auth_shop_id()` (existing, migration 054/015).
- Produces: `public.report_health_metrics(p_device_id uuid, p_counters jsonb, p_gauges
  jsonb) RETURNS jsonb` — called from Task 10's `useHealthReporting.ts`. Returns
  `{"accepted_counters": [...], "accepted_gauges": [...]}`, each entry
  `{"metric_key"|"gauge_key": text, "period_start": date|null}`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi148_report_health_metrics_rpc.test.sql
BEGIN;
SELECT plan(9);

-- auth_shop_id() (migration 015) resolves via shops.owner_user_id = auth.uid(),
-- reading the JWT's `sub` claim -- not a shop_id claim (established pattern per
-- supabase/tests/wafi156_execute_rule_action.test.sql).
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Shop C', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000003');
INSERT INTO public.devices (id, shop_id, code, is_active) VALUES
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'DEV1', true);

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000003","active_role":"owner"}', true);
SET LOCAL role authenticated;

-- 1. Client-allowed counter is accepted and GREATEST()-merged.
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid,
  jsonb_build_array(jsonb_build_object(
    'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 5
  )),
  '[]'::jsonb
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND metric_key = 'app_error_count' AND period_start = '2026-08-21'),
  5::bigint, 'first report of 5 is stored'
);

-- 2. A lower retry does not regress the value (GREATEST()).
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid,
  jsonb_build_array(jsonb_build_object(
    'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 3
  )),
  '[]'::jsonb
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND metric_key = 'app_error_count' AND period_start = '2026-08-21'),
  5::bigint, 'GREATEST() keeps the higher prior value on a stale retry'
);

-- 3. A higher value is applied.
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid,
  jsonb_build_array(jsonb_build_object(
    'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 8
  )),
  '[]'::jsonb
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND metric_key = 'app_error_count' AND period_start = '2026-08-21'),
  8::bigint, 'a genuinely newer, higher value is applied'
);

-- 4. Server-authoritative metric_key is rejected -- allowlist proof.
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '44444444-4444-4444-4444-444444444444'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'drawer_mismatch_count', 'period_start', '2026-08-21', 'value', 99
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'unknown or unwritable metric_key: drawer_mismatch_count',
  'client cannot write a class-S metric_key under any payload shape'
);

-- 5. Unknown metric_key is rejected the same way.
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '44444444-4444-4444-4444-444444444444'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'made_up_metric', 'period_start', '2026-08-21', 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'unknown or unwritable metric_key: made_up_metric',
  'an arbitrary unknown metric_key is rejected'
);

-- 6. period_start outside the 7-day reporting window is rejected.
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '44444444-4444-4444-4444-444444444444'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'app_error_count', 'period_start', '2020-01-01', 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'period_start outside the allowed reporting window',
  'an old period_start far outside the 7-day window is rejected'
);

-- 7. A device belonging to a different shop cannot be reported against.
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('55555555-5555-5555-5555-555555555555', 'Shop D', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000004');
INSERT INTO public.devices (id, shop_id, code, is_active) VALUES
  ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'DEV2', true);
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000003","active_role":"owner"}', true);
SET LOCAL role authenticated;
SELECT throws_ok(
  $$ SELECT public.report_health_metrics(
       '66666666-6666-6666-6666-666666666666'::uuid,
       jsonb_build_array(jsonb_build_object(
         'metric_key', 'app_error_count', 'period_start', '2026-08-21', 'value', 1
       )),
       '[]'::jsonb
     ) $$,
  'P0001',
  'device does not belong to the authenticated shop',
  'a device belonging to a different shop cannot be reported against'
);

-- 8. Gauge overwrite semantics: a lower value DOES apply (not GREATEST()).
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid, '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'gauge_key', 'dead_letter_count', 'value', 7, 'observed_at', '2026-08-21T08:00:00Z'
  ))
);
SELECT public.report_health_metrics(
  '44444444-4444-4444-4444-444444444444'::uuid, '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'gauge_key', 'dead_letter_count', 'value', 2, 'observed_at', '2026-08-21T09:00:00Z'
  ))
);
SELECT is(
  (SELECT value FROM public.health_gauges
     WHERE shop_id = '33333333-3333-3333-3333-333333333333'
       AND device_id = '44444444-4444-4444-4444-444444444444'
       AND gauge_key = 'dead_letter_count'),
  2::bigint, 'a lower gauge value overwrites, unlike a counter'
);

-- 9. last_seen_at is bumped only on a successful, authorized call.
SELECT ok(
  (SELECT last_seen_at FROM public.devices WHERE id = '44444444-4444-4444-4444-444444444444') IS NOT NULL,
  'last_seen_at is updated as a side effect of a successful call'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/108_wafi148_report_health_metrics_rpc.sql
-- WAFI-148: the single write path for client-derived health telemetry.
--
-- Security boundary (per the design spec):
--  - device_id/shop_id are verified against the authenticated session's
--    auth_shop_id(), never trusted from the payload beyond p_device_id itself
--    (which must belong to the caller's own shop).
--  - metric_key/gauge_key are an explicit allowlist (CHECK constraints on
--    the tables themselves, migration 107) -- a client payload can NEVER
--    reach a class-S key because those keys are only ever written by the
--    SECURITY DEFINER apply functions in migrations 109/110, which don't
--    go through this RPC at all.
--  - period_start must fall within [today - 6 days, today] in the shop's
--    own timezone -- mirrors the client's 7-day local retention window.
--  - last_seen_at is updated only after every check above passes.

CREATE OR REPLACE FUNCTION public.report_health_metrics(
  p_device_id uuid,
  p_counters  jsonb,
  p_gauges    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_id      uuid;
  v_timezone     text;
  v_today        date;
  v_window_start date;
  v_counter      jsonb;
  v_gauge        jsonb;
  v_metric_key   text;
  v_period       date;
  v_value        bigint;
  v_accepted_counters jsonb := '[]'::jsonb;
  v_accepted_gauges   jsonb := '[]'::jsonb;
BEGIN
  v_shop_id := public.auth_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices WHERE id = p_device_id AND shop_id = v_shop_id
  ) THEN
    RAISE EXCEPTION 'device does not belong to the authenticated shop' USING ERRCODE = 'P0001';
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_shop_id;
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'shop timezone is not configured' USING ERRCODE = 'P0001';
  END IF;

  v_today := (now() AT TIME ZONE v_timezone)::date;
  v_window_start := v_today - INTERVAL '6 days';

  FOR v_counter IN SELECT * FROM jsonb_array_elements(p_counters)
  LOOP
    v_metric_key := v_counter ->> 'metric_key';
    v_period     := (v_counter ->> 'period_start')::date;
    v_value      := (v_counter ->> 'value')::bigint;

    IF v_metric_key NOT IN (
      'sync_failure_terminal', 'sync_terminal_total', 'offline_duration_seconds',
      'deferred_job_failure_terminal', 'deferred_job_terminal_total',
      'app_error_count', 'active_device_day', 'telemetry_periods_dropped'
    ) THEN
      RAISE EXCEPTION 'unknown or unwritable metric_key: %', v_metric_key USING ERRCODE = 'P0001';
    END IF;

    IF v_period < v_window_start OR v_period > v_today THEN
      RAISE EXCEPTION 'period_start outside the allowed reporting window' USING ERRCODE = 'P0001';
    END IF;

    IF v_value < 0 THEN
      RAISE EXCEPTION 'value must be non-negative' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
    VALUES (v_shop_id, p_device_id, v_metric_key, v_period, v_value, now())
    ON CONFLICT (shop_id, device_id, metric_key, period_start)
    DO UPDATE SET value = GREATEST(public.health_metrics.value, EXCLUDED.value),
                  updated_at = now();

    v_accepted_counters := v_accepted_counters ||
      jsonb_build_object('metric_key', v_metric_key, 'period_start', v_period);
  END LOOP;

  FOR v_gauge IN SELECT * FROM jsonb_array_elements(p_gauges)
  LOOP
    IF (v_gauge ->> 'gauge_key') != 'dead_letter_count' THEN
      RAISE EXCEPTION 'unknown or unwritable gauge_key: %', (v_gauge ->> 'gauge_key') USING ERRCODE = 'P0001';
    END IF;
    IF (v_gauge ->> 'value')::bigint < 0 THEN
      RAISE EXCEPTION 'value must be non-negative' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
    VALUES (v_shop_id, p_device_id, v_gauge ->> 'gauge_key',
            (v_gauge ->> 'value')::bigint, (v_gauge ->> 'observed_at')::timestamptz)
    ON CONFLICT (shop_id, device_id, gauge_key)
    DO UPDATE SET value = EXCLUDED.value, observed_at = EXCLUDED.observed_at;

    v_accepted_gauges := v_accepted_gauges ||
      jsonb_build_object('gauge_key', v_gauge ->> 'gauge_key', 'period_start', NULL);
  END LOOP;

  -- Side effect only after every check above has passed.
  UPDATE public.devices SET last_seen_at = now() WHERE id = p_device_id AND shop_id = v_shop_id;

  RETURN jsonb_build_object(
    'accepted_counters', v_accepted_counters,
    'accepted_gauges', v_accepted_gauges
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_health_metrics(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_health_metrics(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.report_health_metrics(uuid, jsonb, jsonb) TO authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 9/9 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/108_wafi148_report_health_metrics_rpc.sql supabase/tests/wafi148_report_health_metrics_rpc.test.sql
git commit -m "feat(WAFI-148): add report_health_metrics RPC with allowlist, identity, and window checks"
```

---

### Task 4: Server-authoritative drawer-mismatch projection (event-sourced, rebuildable)

**Files:**
- Create: `supabase/migrations/109_wafi148_drawer_mismatch_projection.sql`
- Test: `supabase/tests/wafi148_drawer_mismatch_projection.test.sql`

**Interfaces:**
- Consumes: `public.events` (existing, `shift.closed` events carry a `variance` field per
  WAFI-066), `public.health_metrics` (Task 2).
- Produces: `public._apply_health_drawer_mismatch(p_event_id uuid)` (called by the
  existing durable-subscriber dispatch mechanism — wire into
  `notificationSubscriber.ts`'s existing `shift.closed` subscription list is out of
  scope here; this task only adds the apply/rebuild functions, matching how
  `_apply_profit_cache` was added standalone in migration 086 before its subscriber
  wiring), `public._rebuild_health_drawer_mismatch()`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi148_drawer_mismatch_projection.test.sql
BEGIN;
SELECT plan(3);

SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Shop E', 'Asia/Damascus');

-- Simulate a shift.closed event with a mismatch over the existing $15 threshold.
-- public.events' event-kind column is `type` (migration 074), not `event_type`,
-- and `payload` is stored as TEXT (JSON.stringify'd by the client), not JSONB --
-- see 074_events_bus_core.sql and 086_profit_cache_apply.sql for the precedent
-- of casting with `payload::jsonb` before `->>`.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '77777777-7777-7777-7777-777777777777', 'shift.closed',
  '77777777-7777-7777-7777-777777777777', jsonb_build_object('variance', 20.00)::text,
  '00000000-0000-0000-0000-000000000000', now()
);

SELECT public._apply_health_drawer_mismatch(
  (SELECT id FROM public.events WHERE shop_id = '77777777-7777-7777-7777-777777777777'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);

SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '77777777-7777-7777-7777-777777777777'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a shift.closed event with variance > 15 increments drawer_mismatch_count'
);

-- A within-threshold variance must NOT increment the count.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '77777777-7777-7777-7777-777777777777', 'shift.closed',
  '77777777-7777-7777-7777-777777777777', jsonb_build_object('variance', 5.00)::text,
  '00000000-0000-0000-0000-000000000000', now()
);
SELECT public._apply_health_drawer_mismatch(
  (SELECT id FROM public.events WHERE shop_id = '77777777-7777-7777-7777-777777777777'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '77777777-7777-7777-7777-777777777777'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a variance within the existing $15 threshold does not increment the count'
);

-- Rebuild from scratch reproduces the same value (rebuildability).
DELETE FROM public.health_metrics
  WHERE shop_id = '77777777-7777-7777-7777-777777777777' AND metric_key = 'drawer_mismatch_count';
SELECT public._rebuild_health_drawer_mismatch();
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '77777777-7777-7777-7777-777777777777'
       AND metric_key = 'drawer_mismatch_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a full rebuild reproduces the same value from source events'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — functions don't exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/109_wafi148_drawer_mismatch_projection.sql
-- WAFI-148 metric 4: drawer mismatch count, server-authoritative, event-sourced.
-- Reuses the existing $15 threshold from WAFI-066/156's drawer_variance rule --
-- this projection does NOT redefine that threshold, it only counts occurrences.
-- device_id is a fixed sentinel (all-zeros) since this is a shop-level, not
-- per-device, metric.
--
-- events.type (not event_type) and events.payload is TEXT requiring an
-- explicit ::jsonb cast before ->> (migration 074_events_bus_core.sql; matches
-- the established precedent in 086_profit_cache_apply.sql).

CREATE OR REPLACE FUNCTION public._apply_health_drawer_mismatch(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event   public.events%ROWTYPE;
  v_variance numeric;
  v_period  date;
  v_timezone text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  v_variance := (v_event.payload::jsonb ->> 'variance')::numeric;
  IF v_variance IS NULL OR abs(v_variance) <= 15 THEN
    RETURN;
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_event.shop_id;
  IF v_timezone IS NULL THEN
    RETURN; -- no timezone configured yet; metric doesn't compute for this shop
  END IF;

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'drawer_mismatch_count', v_period, 1, now())
  ON CONFLICT (shop_id, device_id, metric_key, period_start)
  DO UPDATE SET value = public.health_metrics.value + 1, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public._rebuild_health_drawer_mismatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.health_metrics WHERE metric_key = 'drawer_mismatch_count';

  PERFORM public._apply_health_drawer_mismatch(id)
    FROM public.events
   WHERE type = 'shift.closed'
   ORDER BY occurred_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_health_drawer_mismatch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rebuild_health_drawer_mismatch() FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 3/3 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/109_wafi148_drawer_mismatch_projection.sql supabase/tests/wafi148_drawer_mismatch_projection.test.sql
git commit -m "feat(WAFI-148): add event-sourced drawer_mismatch_count projection"
```

---

### Task 5: Server-authoritative never-closed-shift projection (event-sourced, rebuildable)

**Files:**
- Create: `supabase/migrations/110_wafi148_never_closed_shift_projection.sql`
- Test: `supabase/tests/wafi148_never_closed_shift_projection.test.sql`

**Interfaces:**
- Consumes: `public.events` (existing — a zombie force-close per WAFI-065 emits a
  `shift.closed` event with a `force_closed_by` field per migration 025's comment).
- Produces: `public._apply_health_never_closed_shift(p_event_id uuid)`,
  `public._rebuild_health_never_closed_shift()`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi148_never_closed_shift_projection.test.sql
BEGIN;
SELECT plan(3);

-- events.type (not event_type) and events.payload is TEXT requiring an
-- explicit ::jsonb cast to read fields from it (migration 074_events_bus_core.sql;
-- same correction already applied in Task 4's migration 109/test, matched here
-- exactly: sentinel staff_id, entity_id = the shop id as text).
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone) VALUES
  ('88888888-8888-8888-8888-888888888888', 'Shop F', 'Asia/Damascus');

-- A force-closed (zombie) shift.closed event.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 'shift.closed',
  '88888888-8888-8888-8888-888888888888', jsonb_build_object('force_closed_by', gen_random_uuid())::text,
  '00000000-0000-0000-0000-000000000000', now()
);
SELECT public._apply_health_never_closed_shift(
  (SELECT id FROM public.events WHERE shop_id = '88888888-8888-8888-8888-888888888888'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '88888888-8888-8888-8888-888888888888'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a force-closed shift.closed event increments never_closed_shift_count'
);

-- A normal (non-force-closed) shift.closed event must NOT increment it --
-- a merely-late close is not the same signal as a zombie force-close.
INSERT INTO public.events (id, shop_id, type, entity_id, payload, staff_id, occurred_at)
VALUES (
  gen_random_uuid(), '88888888-8888-8888-8888-888888888888', 'shift.closed',
  '88888888-8888-8888-8888-888888888888', jsonb_build_object('force_closed_by', NULL)::text,
  '00000000-0000-0000-0000-000000000000', now()
);
SELECT public._apply_health_never_closed_shift(
  (SELECT id FROM public.events WHERE shop_id = '88888888-8888-8888-8888-888888888888'
     AND type = 'shift.closed' ORDER BY occurred_at DESC LIMIT 1)
);
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '88888888-8888-8888-8888-888888888888'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a normal (non-force-closed) shift close does not increment the count'
);

DELETE FROM public.health_metrics
  WHERE shop_id = '88888888-8888-8888-8888-888888888888' AND metric_key = 'never_closed_shift_count';
SELECT public._rebuild_health_never_closed_shift();
SELECT is(
  (SELECT value FROM public.health_metrics
     WHERE shop_id = '88888888-8888-8888-8888-888888888888'
       AND metric_key = 'never_closed_shift_count'
       AND period_start = (now() AT TIME ZONE 'Asia/Damascus')::date),
  1::bigint, 'a full rebuild reproduces the same value from source events'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — functions don't exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/110_wafi148_never_closed_shift_projection.sql
-- WAFI-148 metric 8: never-closed/zombie-shift count, server-authoritative,
-- event-sourced. Distinct from a merely-late close: only shift.closed events
-- carrying force_closed_by (WAFI-065's zombie force-close guard, migration
-- 025/026) count here.
--
-- events.type (not event_type) and events.payload is TEXT requiring an
-- explicit ::jsonb cast before ->> (migration 074_events_bus_core.sql; same
-- correction already applied in Task 4's migration 109).

CREATE OR REPLACE FUNCTION public._apply_health_never_closed_shift(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event    public.events%ROWTYPE;
  v_period   date;
  v_timezone text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.type != 'shift.closed' THEN
    RETURN;
  END IF;

  IF v_event.payload::jsonb ->> 'force_closed_by' IS NULL THEN
    RETURN; -- a normal close, not a zombie force-close
  END IF;

  SELECT timezone INTO v_timezone FROM public.shops WHERE id = v_event.shop_id;
  IF v_timezone IS NULL THEN
    RETURN;
  END IF;

  v_period := (v_event.occurred_at AT TIME ZONE v_timezone)::date;

  INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value, updated_at)
  VALUES (v_event.shop_id, '00000000-0000-0000-0000-000000000000', 'never_closed_shift_count', v_period, 1, now())
  ON CONFLICT (shop_id, device_id, metric_key, period_start)
  DO UPDATE SET value = public.health_metrics.value + 1, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public._rebuild_health_never_closed_shift()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.health_metrics WHERE metric_key = 'never_closed_shift_count';

  PERFORM public._apply_health_never_closed_shift(id)
    FROM public.events
   WHERE type = 'shift.closed'
   ORDER BY occurred_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_health_never_closed_shift(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rebuild_health_never_closed_shift() FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 3/3 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/110_wafi148_never_closed_shift_projection.sql supabase/tests/wafi148_never_closed_shift_projection.test.sql
git commit -m "feat(WAFI-148): add event-sourced never_closed_shift_count projection"
```

---

### Task 6: `can_view_health_metrics` permission flag, default off

**Files:**
- Create: `supabase/migrations/111_wafi148_can_view_health_metrics.sql`
- Modify: `src/features/staff/staff.types.ts` (add the flag to the permissions shape,
  following the exact `can_view_reports` pattern)
- Test: append to `supabase/tests/wafi148_health_metrics_schema.test.sql`

**Interfaces:**
- Consumes: `public.staff.permissions` (existing JSONB column), `public.can(flag)`
  (existing, migration 054).
- Produces: `can_view_health_metrics` as a recognized permission key, defaulting to
  `false` for non-owners — read by Task 13's owner dashboard via `public.can('can_view_health_metrics')`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- append to supabase/tests/wafi148_health_metrics_schema.test.sql
SELECT plan(13 + 2);  -- bump from Task 2's 13

-- ... Tasks 1/2's assertions stay above ...

SET LOCAL role postgres;
INSERT INTO public.staff (id, shop_id, role, permissions, is_active)
VALUES (
  gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'manager', '{}'::jsonb, true
);

SELECT is(
  (SELECT (permissions ->> 'can_view_health_metrics')::boolean
     FROM public.staff WHERE role = 'manager' AND shop_id = '33333333-3333-3333-3333-333333333333'
     ORDER BY id DESC LIMIT 1),
  NULL,
  'can_view_health_metrics is not force-set on an existing manager row (owner grants explicitly)'
);
SELECT ok(
  public.can('can_view_health_metrics') IS NOT NULL,
  'public.can(''can_view_health_metrics'') is a recognized, callable flag'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL (or the second assertion errors) — flag not yet recognized anywhere
(note: `public.can()` reads arbitrary text keys already, so this step mainly documents
intent; the real gate is Task 13's dashboard actually calling it).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/111_wafi148_can_view_health_metrics.sql
-- WAFI-148: can_view_health_metrics follows the exact WAFI-058 can_view_reports
-- pattern -- owner-granted per staff member, defaults OFF, read via the
-- existing public.can(flag) helper (migration 054). No schema change needed
-- beyond documentation: staff.permissions is already a free-form jsonb column,
-- and public.can() already reads any key from it. This migration exists to
-- make the new key's existence and default explicit and searchable.
COMMENT ON COLUMN public.staff.permissions IS
  'Owner-granted per-staff permission flags (JSONB), default-off unless explicitly '
  'granted. Existing keys: can_view_reports, can_view_expenses (WAFI-058). '
  'WAFI-148 adds: can_view_health_metrics -- gates the shop-facing health dashboard '
  '(OwnerHealthPage.vue), read via public.can(''can_view_health_metrics''), same as '
  'can_view_reports. Owners always pass (public.can() short-circuits true for '
  'auth_role() = ''owner'').';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 15/15 assertions.

- [ ] **Step 5: Modify `staff.types.ts` and commit**

Add `can_view_health_metrics?: boolean` to the permissions type alongside
`can_view_reports`/`can_view_expenses`, following the same optional-boolean shape
already used there.

```bash
git add supabase/migrations/111_wafi148_can_view_health_metrics.sql supabase/tests/wafi148_health_metrics_schema.test.sql src/features/staff/staff.types.ts
git commit -m "feat(WAFI-148): add can_view_health_metrics permission flag, default off"
```

---

### Task 7: Local PowerSync schema — `local_health_metrics`, `local_health_gauges`

**Files:**
- Modify: `src/data/powersync/schema.ts`
- Test: `src/data/powersync/__tests__/healthSchema.test.ts` (new)

**Interfaces:**
- Produces: two `localOnly: true` tables in the PowerSync schema —
  `local_health_metrics(metric_key, period_start, value, updated_at)`,
  `local_health_gauges(gauge_key, value, observed_at)` — written by Tasks 8-11, read by
  Task 12.

- [ ] **Step 1: Write the failing test**

```typescript
// src/data/powersync/__tests__/healthSchema.test.ts
import { describe, it, expect } from 'vitest'
import { AppSchema } from '../schema'

describe('WAFI-148 local health schema', () => {
  it('defines local_health_metrics as localOnly with the expected columns', () => {
    const table = AppSchema.tables.find((t) => t.name === 'local_health_metrics')
    expect(table).toBeDefined()
    expect(table?.localOnly).toBe(true)
    const columnNames = table?.columns.map((c) => c.name)
    expect(columnNames).toEqual(expect.arrayContaining(['metric_key', 'period_start', 'value', 'updated_at']))
  })

  it('defines local_health_gauges as localOnly with the expected columns', () => {
    const table = AppSchema.tables.find((t) => t.name === 'local_health_gauges')
    expect(table).toBeDefined()
    expect(table?.localOnly).toBe(true)
    const columnNames = table?.columns.map((c) => c.name)
    expect(columnNames).toEqual(expect.arrayContaining(['gauge_key', 'value', 'observed_at']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/powersync/__tests__/healthSchema.test.ts`
Expected: FAIL — tables not found.

- [ ] **Step 3: Add the tables to `schema.ts`**

Add alongside the existing `local_deferred_jobs`/`local_subscriber_processed_events`
`localOnly` table definitions (same file, same pattern):

```typescript
const local_health_metrics = new Table(
  {
    metric_key:   column.text,
    period_start: column.text,
    value:        column.integer,
    updated_at:   column.text,
  },
  { localOnly: true },
)

const local_health_gauges = new Table(
  {
    gauge_key:   column.text,
    value:       column.integer,
    observed_at: column.text,
  },
  { localOnly: true },
)
```

Add both to the schema's table list alongside the other `localOnly` tables.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/powersync/__tests__/healthSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/powersync/schema.ts src/data/powersync/__tests__/healthSchema.test.ts
git commit -m "feat(WAFI-148): add local_health_metrics/local_health_gauges localOnly tables"
```

---

### Task 8: Shared health types and the presentation/formatting layer

**Files:**
- Create: `src/features/health/health.types.ts`
- Create: `src/features/health/format/healthFormat.ts`
- Test: `src/features/health/__tests__/healthFormat.test.ts`

**Interfaces:**
- Produces: `HealthMetricKey`, `HealthGaugeKey` (string literal unions matching the
  server allowlist exactly), `formatRate(numerator: number, denominator: number, kind:
  'percentage' | 'per-device-day'): { display: string; isNoData: boolean }`,
  `formatCount(value: number): { display: string; isZeroHealthy: boolean }`,
  `formatGaugeFreshness(observedAt: string, freshnessWindowMs: number): { isStale:
  boolean; ageLabel: string }`. Consumed by Tasks 12/13/14.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/health/__tests__/healthFormat.test.ts
import { describe, it, expect } from 'vitest'
import { formatRate, formatCount, formatGaugeFreshness } from '../format/healthFormat'

describe('WAFI-148 shared health formatting', () => {
  it('renders a rate with numerator/denominator and the computed percentage', () => {
    const result = formatRate(2, 1010, 'percentage')
    expect(result.display).toBe('2/1010 · 0.2%')
    expect(result.isNoData).toBe(false)
  })

  it('treats a zero denominator as no-data, never 0%', () => {
    const result = formatRate(0, 0, 'percentage')
    expect(result.isNoData).toBe(true)
    expect(result.display).not.toContain('0%')
  })

  it('renders a per-device-day rate without forcing a percentage', () => {
    const result = formatRate(12, 3, 'per-device-day')
    expect(result.display).toBe('12 errors · 4.0 per active device-day')
    expect(result.isNoData).toBe(false)
  })

  it('renders a count of 0 as a legitimate healthy zero, not no-data', () => {
    const result = formatCount(0)
    expect(result.isZeroHealthy).toBe(true)
  })

  it('flags a gauge as stale once its observation exceeds the freshness window', () => {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
    const result = formatGaugeFreshness(eightHoursAgo, 4 * 60 * 60 * 1000)
    expect(result.isStale).toBe(true)
  })

  it('does not flag a gauge as stale within the freshness window', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const result = formatGaugeFreshness(tenMinutesAgo, 4 * 60 * 60 * 1000)
    expect(result.isStale).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/health/__tests__/healthFormat.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/features/health/health.types.ts
export type HealthMetricKey =
  | 'sync_failure_terminal'
  | 'sync_terminal_total'
  | 'offline_duration_seconds'
  | 'deferred_job_failure_terminal'
  | 'deferred_job_terminal_total'
  | 'app_error_count'
  | 'active_device_day'
  | 'telemetry_periods_dropped' // diagnostic-only: never contributes to health status,
                                 // never shown to the owner -- team dashboard only
  | 'drawer_mismatch_count'
  | 'never_closed_shift_count'

export type HealthGaugeKey = 'dead_letter_count'

export interface HealthCounterReport {
  metric_key: HealthMetricKey
  period_start: string
  value: number
}

export interface HealthGaugeReport {
  gauge_key: HealthGaugeKey
  value: number
  observed_at: string
}
```

```typescript
// src/features/health/format/healthFormat.ts
export function formatRate(
  numerator: number,
  denominator: number,
  kind: 'percentage' | 'per-device-day',
): { display: string; isNoData: boolean } {
  if (denominator === 0) {
    return { display: 'No data', isNoData: true }
  }

  if (kind === 'percentage') {
    const pct = (numerator / denominator) * 100
    return { display: `${numerator}/${denominator} · ${pct.toFixed(1)}%`, isNoData: false }
  }

  const perDay = numerator / denominator
  return {
    display: `${numerator} errors · ${perDay.toFixed(1)} per active device-day`,
    isNoData: false,
  }
}

export function formatCount(value: number): { display: string; isZeroHealthy: boolean } {
  return { display: String(value), isZeroHealthy: value === 0 }
}

export function formatGaugeFreshness(
  observedAt: string,
  freshnessWindowMs: number,
): { isStale: boolean; ageLabel: string } {
  const ageMs = Date.now() - new Date(observedAt).getTime()
  const ageHours = Math.round(ageMs / (60 * 60 * 1000))
  return {
    isStale: ageMs > freshnessWindowMs,
    ageLabel: ageHours < 1 ? 'less than an hour ago' : `${ageHours}h ago`,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/health/__tests__/healthFormat.test.ts`
Expected: PASS — 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/features/health/health.types.ts src/features/health/format/healthFormat.ts src/features/health/__tests__/healthFormat.test.ts
git commit -m "feat(WAFI-148): add shared health types and zero/no-data/rate formatting layer"
```

---

### Task 9: `markDeviceActiveForDay()` — the `active_device_day` qualifying signal

**Files:**
- Create: `src/features/health/composables/useDeviceActivity.ts`
- Test: `src/features/health/__tests__/useDeviceActivity.test.ts`
- Modify: `src/router/index.ts` (call `markDeviceActiveForDay()` from the router's
  `afterEach` hook — a real navigation is genuine foreground usage, never a background
  timer)

**Interfaces:**
- Consumes: `db` (existing PowerSync connection, via whatever the codebase's standard
  import is for `useProducts.ts`-style composables — same local SQLite `db.execute`
  used throughout).
- Produces: `markDeviceActiveForDay(shopTimezone: string, now?: Date): Promise<void>` —
  idempotently upserts today's `active_device_day` local row to `1`. Called from Task
  10's periodic reporting AND from the router hook (real usage signal). Read by Task 12.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/health/__tests__/useDeviceActivity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markDeviceActiveForDay } from '../composables/useDeviceActivity'

const executed: Array<{ sql: string; params: unknown[] }> = []
const mockDb = {
  execute: vi.fn(async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params })
  }),
  getAll: vi.fn(async () => []),
}

vi.mock('@/data/powersync/db', () => ({ db: mockDb }))

describe('WAFI-148 markDeviceActiveForDay', () => {
  beforeEach(() => {
    executed.length = 0
    mockDb.execute.mockClear()
  })

  it('upserts active_device_day = 1 for the shop-local calendar day', async () => {
    const fixedNow = new Date('2026-08-21T10:00:00Z') // 13:00 Asia/Damascus
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)

    expect(executed).toHaveLength(1)
    expect(executed[0].sql).toContain('local_health_metrics')
    expect(executed[0].params).toContain('active_device_day')
    expect(executed[0].params).toContain('2026-08-21')
  })

  it('is idempotent -- calling twice in the same day does not double-write', async () => {
    const fixedNow = new Date('2026-08-21T10:00:00Z')
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)
    await markDeviceActiveForDay('Asia/Damascus', fixedNow)

    // Both calls execute the same idempotent UPSERT (value stays 1, never incremented) --
    // asserting the SQL uses an idempotent-safe upsert, not an additive increment.
    expect(executed[0].sql).not.toMatch(/value\s*\+\s*1/)
    expect(executed[1].sql).not.toMatch(/value\s*\+\s*1/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/health/__tests__/useDeviceActivity.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/features/health/composables/useDeviceActivity.ts
import { db } from '@/data/powersync/db'

function shopLocalDateString(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now) // en-CA -> YYYY-MM-DD
}

// The qualifying-event contract (per the design spec): this must be called
// ONLY from a genuine foreground user-interaction boundary -- a real
// navigation, a real business operation -- never from a background timer,
// the health-reporting tick itself, a connectivity callback, or a server
// response. Idempotent: repeated calls on the same shop-local day are a
// no-op overwrite of the same value, never an increment.
export async function markDeviceActiveForDay(shopTimezone: string, now: Date = new Date()): Promise<void> {
  const periodStart = shopLocalDateString(shopTimezone, now)

  await db.execute(
    `INSERT INTO local_health_metrics (metric_key, period_start, value, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (metric_key, period_start) DO UPDATE SET updated_at = excluded.updated_at`,
    ['active_device_day', periodStart, now.toISOString()],
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/health/__tests__/useDeviceActivity.test.ts`
Expected: PASS — 2/2.

- [ ] **Step 5: Wire into the router and commit**

In `src/router/index.ts`, add to the existing `router.afterEach(...)` (or create one if
none exists), reading the current shop's `timezone` from the already-synced `shops`
local table (same pattern every other shop-scoped composable uses):

```typescript
router.afterEach(async () => {
  const shop = await getCurrentShop() // existing helper used elsewhere in this file/store
  if (shop?.timezone) {
    await markDeviceActiveForDay(shop.timezone)
  }
})
```

```bash
git add src/features/health/composables/useDeviceActivity.ts src/features/health/__tests__/useDeviceActivity.test.ts src/router/index.ts
git commit -m "feat(WAFI-148): add markDeviceActiveForDay, wired to real navigation as the active_device_day signal"
```

---

### Task 10: Terminal-outcome counters — sync uploads, deferred jobs, offline duration, app errors

**Files:**
- Modify: `src/data/powersync/ops.ts` (sync terminal success/failure)
- Modify: `src/data/powersync/dead-letter.ts` (sync terminal failure via `quarantineOp`,
  and the dead-letter gauge read used by Task 11)
- Modify: `src/services/events/drainDeferredJobs.ts` (deferred-job terminal
  success/failure)
- Modify: `src/features/sync/useSync.ts` (offline-duration cycle tracking)
- Modify: `src/main.ts` (global unhandled-error counter)
- Test: `src/data/powersync/__tests__/healthCounters.test.ts` (new, covers the shared
  increment helper used by all four sites)

**Interfaces:**
- Produces: `incrementLocalHealthCounter(metricKey: HealthMetricKey, periodStart:
  string): Promise<void>` (additive, unlike `markDeviceActiveForDay`'s idempotent-set) —
  used at all four call sites below. Consumed by Task 12.

- [ ] **Step 1: Write the failing test for the shared increment helper**

```typescript
// src/data/powersync/__tests__/healthCounters.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { incrementLocalHealthCounter } from '../healthCounters'

const executed: Array<{ sql: string; params: unknown[] }> = []
const mockDb = {
  execute: vi.fn(async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params })
  }),
}
vi.mock('@/data/powersync/db', () => ({ db: mockDb }))

describe('WAFI-148 incrementLocalHealthCounter', () => {
  beforeEach(() => {
    executed.length = 0
  })

  it('additively increments a counter for the given metric/period', async () => {
    await incrementLocalHealthCounter('sync_failure_terminal', '2026-08-21')
    expect(executed[0].sql).toMatch(/value\s*\+\s*1|value\s*=\s*.*\+\s*1/)
    expect(executed[0].params).toEqual(expect.arrayContaining(['sync_failure_terminal', '2026-08-21']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/powersync/__tests__/healthCounters.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the shared helper**

```typescript
// src/data/powersync/healthCounters.ts
import { db } from '@/data/powersync/db'
import type { HealthMetricKey } from '@/features/health/health.types'

// Additive terminal-outcome counter, distinct from markDeviceActiveForDay's
// idempotent set-to-1. Used only for the 6 additive counters:
// sync_failure_terminal, sync_terminal_total, offline_duration_seconds
// (added as a duration, not +1), deferred_job_failure_terminal,
// deferred_job_terminal_total, app_error_count.
export async function incrementLocalHealthCounter(
  metricKey: HealthMetricKey,
  periodStart: string,
  amount = 1,
): Promise<void> {
  await db.execute(
    `INSERT INTO local_health_metrics (metric_key, period_start, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (metric_key, period_start)
     DO UPDATE SET value = local_health_metrics.value + ?, updated_at = excluded.updated_at`,
    [metricKey, periodStart, amount, new Date().toISOString(), amount],
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/powersync/__tests__/healthCounters.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the four call sites**

In `src/data/powersync/ops.ts`, at the point where an upload op is confirmed successful
(the success path counterpart to `quarantineOp`), call
`incrementLocalHealthCounter('sync_terminal_total', shopLocalToday())`.

In `src/data/powersync/dead-letter.ts`'s `quarantineOp()`, call both
`incrementLocalHealthCounter('sync_failure_terminal', shopLocalToday())` and
`incrementLocalHealthCounter('sync_terminal_total', shopLocalToday())` — a terminal
failure is also a terminal outcome, so it counts toward both the failure numerator and
the shared total denominator.

In `src/services/events/drainDeferredJobs.ts`, wherever a job transitions to a
terminal `'completed'` state, call `incrementLocalHealthCounter('deferred_job_terminal_total',
shopLocalToday())`; wherever it transitions to terminal `'dead'` (the existing
`reportDeferredJobDead.ts` call site), call both
`incrementLocalHealthCounter('deferred_job_failure_terminal', shopLocalToday())` and
`incrementLocalHealthCounter('deferred_job_terminal_total', shopLocalToday())`.

In `src/features/sync/useSync.ts`, track an `offlineStartedAt` ref set when the
existing connectivity-loss transition fires (per the spec, the same transition
`bindPowerSync()`'s `statusChanged` listener already exposes — not raw
`navigator.onLine`); on the corresponding reconnect transition, compute
`durationSeconds = (Date.now() - offlineStartedAt) / 1000`, clear
`offlineStartedAt` (guards the double-fire idempotency case from the spec), and call
`incrementLocalHealthCounter('offline_duration_seconds', shopLocalToday(), durationSeconds)`.

In `src/main.ts`, add a global handler (Vue's `app.config.errorHandler`, alongside the
existing Sentry wiring) that calls
`incrementLocalHealthCounter('app_error_count', shopLocalToday())` — independent of
whether Sentry is configured, per the spec's requirement that this signal must not
disappear if `VITE_SENTRY_DSN` is unset.

```bash
git add src/data/powersync/healthCounters.ts src/data/powersync/__tests__/healthCounters.test.ts src/data/powersync/ops.ts src/data/powersync/dead-letter.ts src/services/events/drainDeferredJobs.ts src/features/sync/useSync.ts src/main.ts
git commit -m "feat(WAFI-148): wire terminal-outcome health counters into sync, deferred jobs, offline cycles, and app errors"
```

---

### Task 11: `useHealthReporting.ts` — accumulator read, RPC send, retention, gauge sampling

**Files:**
- Create: `src/features/health/composables/useHealthReporting.ts`
- Test: `src/features/health/__tests__/useHealthReporting.test.ts`
- Modify: `src/main.ts` (start the periodic tick + reconnect hook at app boot)

**Interfaces:**
- Consumes: `local_health_metrics`/`local_health_gauges` (Task 7),
  `countDeadLetter()` (existing, `dead-letter.ts`), `report_health_metrics` RPC (Task 3,
  via the existing raw Supabase client, same pattern as `register_device`).
- Produces: `startHealthReporting(): void` (idempotent — safe to call once at boot),
  `runHealthReportingTick(): Promise<void>` (exported separately for direct testing).

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/health/__tests__/useHealthReporting.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runHealthReportingTick } from '../composables/useHealthReporting'

const mockDb = {
  getAll: vi.fn(),
  execute: vi.fn(async () => {}),
}
vi.mock('@/data/powersync/db', () => ({ db: mockDb }))

const mockCountDeadLetter = vi.fn(async () => 3)
vi.mock('@/data/powersync/dead-letter', () => ({ countDeadLetter: mockCountDeadLetter }))

const mockRpc = vi.fn(async () => ({
  data: {
    accepted_counters: [{ metric_key: 'app_error_count', period_start: '2026-08-19' }],
    accepted_gauges: [{ gauge_key: 'dead_letter_count', period_start: null }],
  },
  error: null,
}))
vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: mockRpc } }))

describe('WAFI-148 runHealthReportingTick', () => {
  beforeEach(() => {
    mockDb.getAll.mockReset()
    mockDb.execute.mockClear()
    mockRpc.mockClear()
  })

  it('sends all open counters and the dead-letter gauge, then deletes only closed+accepted rows', async () => {
    mockDb.getAll
      .mockResolvedValueOnce([
        { metric_key: 'app_error_count', period_start: '2026-08-19', value: 5 }, // closed day
        { metric_key: 'app_error_count', period_start: '2026-08-21', value: 2 }, // today, open
      ])

    await runHealthReportingTick({ shopId: 'shop-1', deviceId: 'dev-1', today: '2026-08-21' })

    expect(mockRpc).toHaveBeenCalledWith('report_health_metrics', expect.objectContaining({
      p_device_id: 'dev-1',
    }))

    // Only the closed, accepted period (2026-08-19) is deleted locally --
    // the open period (2026-08-21) must survive.
    const deleteCalls = mockDb.execute.mock.calls.filter(([sql]) => sql.includes('DELETE'))
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0][1]).toContain('2026-08-19')
  })

  it('reports the dead-letter gauge with a fresh observed_at every tick', async () => {
    mockDb.getAll.mockResolvedValueOnce([])
    await runHealthReportingTick({ shopId: 'shop-1', deviceId: 'dev-1', today: '2026-08-21' })

    const [, args] = mockRpc.mock.calls[0]
    expect(args.p_gauges[0].gauge_key).toBe('dead_letter_count')
    expect(args.p_gauges[0].value).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/health/__tests__/useHealthReporting.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/features/health/composables/useHealthReporting.ts
import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import { countDeadLetter } from '@/data/powersync/dead-letter'
import type { HealthCounterReport, HealthGaugeReport } from '@/features/health/health.types'

const RETENTION_DAYS = 7
const TICK_INTERVAL_MS = 30 * 60 * 1000

interface TickContext {
  shopId: string
  deviceId: string
  today: string // shop-local ISO date, injected for testability
}

function isClosedPeriod(periodStart: string, today: string): boolean {
  return periodStart < today
}

export async function runHealthReportingTick(ctx: TickContext): Promise<void> {
  const localRows = await db.getAll<{ metric_key: string; period_start: string; value: number }>(
    `SELECT metric_key, period_start, value FROM local_health_metrics`,
  )

  const counters: HealthCounterReport[] = localRows.map((row) => ({
    metric_key: row.metric_key as HealthCounterReport['metric_key'],
    period_start: row.period_start,
    value: row.value,
  }))

  const deadLetterCount = await countDeadLetter()
  const gauges: HealthGaugeReport[] = [
    { gauge_key: 'dead_letter_count', value: deadLetterCount, observed_at: new Date().toISOString() },
  ]

  const { data, error } = await supabase.rpc('report_health_metrics', {
    p_device_id: ctx.deviceId,
    p_counters: counters,
    p_gauges: gauges,
  })

  // Fire-and-forget-safe: an RPC error just means we retry next tick; the
  // local accumulator is untouched and nothing here can block the POS.
  if (error || !data) return

  // Only delete a local row for a CLOSED period the server explicitly
  // accepted -- an open/current period's row is never deleted, and a
  // closed period the server didn't (yet) confirm stays for the next retry.
  const acceptedClosedKeys = new Set(
    (data.accepted_counters as Array<{ metric_key: string; period_start: string }>)
      .filter((c) => isClosedPeriod(c.period_start, ctx.today))
      .map((c) => `${c.metric_key}|${c.period_start}`),
  )

  for (const row of localRows) {
    if (acceptedClosedKeys.has(`${row.metric_key}|${row.period_start}`)) {
      await db.execute(
        `DELETE FROM local_health_metrics WHERE metric_key = ? AND period_start = ?`,
        [row.metric_key, row.period_start],
      )
    }
  }

  // Retention cap: drop any still-unacknowledged row outside the 7-day
  // window, counting the drop as diagnostic-only metadata (never shown to
  // the owner, never part of health status).
  const windowStart = new Date(ctx.today)
  windowStart.setDate(windowStart.getDate() - (RETENTION_DAYS - 1))
  const windowStartStr = windowStart.toISOString().slice(0, 10)

  const staleRows = localRows.filter((row) => row.period_start < windowStartStr)
  if (staleRows.length > 0) {
    await db.execute(`DELETE FROM local_health_metrics WHERE period_start < ?`, [windowStartStr])
    await db.execute(
      `INSERT INTO local_health_metrics (metric_key, period_start, value, updated_at)
       VALUES ('telemetry_periods_dropped', ?, ?, ?)
       ON CONFLICT (metric_key, period_start)
       DO UPDATE SET value = local_health_metrics.value + ?, updated_at = excluded.updated_at`,
      [ctx.today, staleRows.length, new Date().toISOString(), staleRows.length],
    )
  }
}

let tickHandle: ReturnType<typeof setInterval> | undefined

// Idempotent -- safe to call once at app boot. Uses a 30-minute periodic
// tick plus an immediate call on the app's existing connectivity-reconnect
// signal (wired by the caller in main.ts alongside the existing useSync.ts
// listener), never a new detector.
export function startHealthReporting(getContext: () => TickContext | null): void {
  if (tickHandle) return

  const tick = async () => {
    const ctx = getContext()
    if (ctx) await runHealthReportingTick(ctx)
  }

  tickHandle = setInterval(tick, TICK_INTERVAL_MS)
  void tick()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/health/__tests__/useHealthReporting.test.ts`
Expected: PASS — 2/2.

- [ ] **Step 5: Wire into `main.ts` and commit**

Call `startHealthReporting(...)` once at boot, and call `runHealthReportingTick`
immediately from the existing reconnect listener in `useSync.ts` (the same transition
Task 10 already hooks for offline-duration tracking).

```bash
git add src/features/health/composables/useHealthReporting.ts src/features/health/__tests__/useHealthReporting.test.ts src/main.ts
git commit -m "feat(WAFI-148): add health reporting tick -- accumulator read, RPC send, ack-based deletion, retention cap"
```

---

### Task 12: Owner Dashboard

**Files:**
- Create: `src/features/health/composables/useOwnerHealth.ts`
- Create: `src/features/health/OwnerHealthPage.vue`
- Test: `src/features/health/__tests__/useOwnerHealth.test.ts`
- Modify: `src/router/index.ts` (register `/health` behind `can_view_health_metrics`)

**Interfaces:**
- Consumes: `health_metrics`/`health_gauges` (synced via PowerSync — add both to
  `powersync.yaml`'s `shop_data` stream, shop-scoped, same as every other table there),
  `formatRate`/`formatCount`/`formatGaugeFreshness` (Task 8), `public.devices` (existing,
  already shop-scoped/synced — metric 7 is a **live client-side query**, not a stored
  `health_metrics` row, per the spec's "no stored value, no rebuild function" rule for
  this metric).
- Produces: `useOwnerHealth()` returning `{ status: 'issue' | 'attention' | 'healthy' |
  'no-data' | 'timezone-not-configured'; messages: string[] }`;
  `computeStaleDeviceCount(devices: Array<{ is_active: boolean; last_seen_at: string |
  null }>, thresholdMs: number, now?: Date): number` — the concrete metric-7
  implementation, consumed by both this task and Task 13's team view.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/health/__tests__/useOwnerHealth.test.ts
import { describe, it, expect } from 'vitest'
import { computeOwnerHealthStatus } from '../composables/useOwnerHealth'

describe('WAFI-148 computeOwnerHealthStatus', () => {
  it('returns timezone-not-configured when the shop has no timezone set', () => {
    const result = computeOwnerHealthStatus({ shopTimezone: null, metrics: [], gauges: [] })
    expect(result.status).toBe('timezone-not-configured')
  })

  it('returns issue when any critical-policy condition is present', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [{ metric_key: 'never_closed_shift_count', period_start: 'yesterday', value: 1 }],
      gauges: [],
    })
    expect(result.status).toBe('issue')
    expect(result.messages).toContain('One shift required automatic closing yesterday.')
  })

  it('returns healthy with an explicit confirmation when nothing is wrong', () => {
    const result = computeOwnerHealthStatus({
      shopTimezone: 'Asia/Damascus',
      metrics: [{ metric_key: 'never_closed_shift_count', period_start: 'yesterday', value: 0 }],
      gauges: [{ gauge_key: 'dead_letter_count', value: 0, observed_at: new Date().toISOString() }],
    })
    expect(result.status).toBe('healthy')
    expect(result.messages).toEqual(['Everything is working normally.'])
  })

  it('returns no-data when every applicable metric is missing, never a false healthy', () => {
    const result = computeOwnerHealthStatus({ shopTimezone: 'Asia/Damascus', metrics: [], gauges: [] })
    expect(result.status).toBe('no-data')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/health/__tests__/useOwnerHealth.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/features/health/composables/useOwnerHealth.ts
interface OwnerHealthInput {
  shopTimezone: string | null
  metrics: Array<{ metric_key: string; period_start: string; value: number }>
  gauges: Array<{ gauge_key: string; value: number; observed_at: string }>
}

interface OwnerHealthResult {
  status: 'issue' | 'attention' | 'healthy' | 'no-data' | 'timezone-not-configured'
  messages: string[]
}

export function computeOwnerHealthStatus(input: OwnerHealthInput): OwnerHealthResult {
  if (!input.shopTimezone) {
    return { status: 'timezone-not-configured', messages: [] }
  }

  const messages: string[] = []
  let hasCritical = false
  let hasWarning = false
  let hasAnyData = false

  const neverClosedShifts = input.metrics.find((m) => m.metric_key === 'never_closed_shift_count')
  if (neverClosedShifts) {
    hasAnyData = true
    if (neverClosedShifts.value > 0) {
      hasCritical = true
      messages.push('One shift required automatic closing yesterday.')
    }
  }

  const deadLetterGauge = input.gauges.find((g) => g.gauge_key === 'dead_letter_count')
  if (deadLetterGauge) {
    hasAnyData = true
    if (deadLetterGauge.value > 0) {
      hasWarning = true
      messages.push('Wafi has some unresolved sync issues.')
    }
  }

  if (!hasAnyData) {
    return { status: 'no-data', messages: [] }
  }

  if (hasCritical) return { status: 'issue', messages }
  if (hasWarning) return { status: 'attention', messages }
  return { status: 'healthy', messages: ['Everything is working normally.'] }
}
```

*Note for the implementer:* this function covers metrics 8 (critical-policy example)
and 3 (warning-policy example) as the representative pattern; extend the same
if/hasAnyData/push structure for metrics 1, 2, 4, 5, 6 following each one's
presentation-policy threshold from the spec's Metric Contracts section (e.g. sync
upload failure rate > 5%, offline duration > 2h) — each is a repeatable addition to this
same function, not a new mechanism. `telemetry_periods_dropped` must never be read by
this function — it's diagnostic-only, team-view-only, and must never affect owner
status or messages.

**Metric 7 (stale device count) — a live query, not a stored row:**

```typescript
// appended to src/features/health/composables/useOwnerHealth.ts
export const STALE_DEVICE_THRESHOLD_MS = 2 * 60 * 60 * 1000 // v1 policy value, not part of the metric formula

export function computeStaleDeviceCount(
  devices: Array<{ is_active: boolean; last_seen_at: string | null }>,
  thresholdMs: number = STALE_DEVICE_THRESHOLD_MS,
  now: Date = new Date(),
): number {
  return devices.filter((d) => {
    if (!d.is_active) return false // retired/revoked devices never count, per the spec
    if (!d.last_seen_at) return true // never seen at all counts as stale
    return now.getTime() - new Date(d.last_seen_at).getTime() > thresholdMs
  }).length
}
```

```typescript
// appended to src/features/health/__tests__/useOwnerHealth.test.ts
import { computeStaleDeviceCount, STALE_DEVICE_THRESHOLD_MS } from '../composables/useOwnerHealth'

describe('WAFI-148 computeStaleDeviceCount', () => {
  it('counts an active device whose last_seen_at exceeds the threshold', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const count = computeStaleDeviceCount(
      [{ is_active: true, last_seen_at: threeHoursAgo }], STALE_DEVICE_THRESHOLD_MS,
    )
    expect(count).toBe(1)
  })

  it('never counts a retired/revoked (is_active=false) device, even if never seen', () => {
    const count = computeStaleDeviceCount(
      [{ is_active: false, last_seen_at: null }], STALE_DEVICE_THRESHOLD_MS,
    )
    expect(count).toBe(0)
  })

  it('does not count an active device within the threshold', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const count = computeStaleDeviceCount(
      [{ is_active: true, last_seen_at: tenMinutesAgo }], STALE_DEVICE_THRESHOLD_MS,
    )
    expect(count).toBe(0)
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/health/__tests__/useOwnerHealth.test.ts`
Expected: PASS — 4/4 for `computeOwnerHealthStatus`, 3/3 for `computeStaleDeviceCount`.

- [ ] **Step 5: Build `OwnerHealthPage.vue`, register the route, commit**

`OwnerHealthPage.vue` reads the shop's synced `health_metrics`/`health_gauges` rows
(most recently completed shop-local day for historical metrics, latest gauge value for
current-state), calls `computeOwnerHealthStatus`, and renders the status + messages —
following this codebase's existing page/composable split convention (see
`ProductsPage.vue`/`useProducts.ts` for the pattern to mirror). Register `/health` in
`src/router/index.ts` guarded by `public.can('can_view_health_metrics')` (client-side
read of the synced `staff.permissions`, mirroring however `/reports` is already gated
by `can_view_reports` in this file).

```bash
git add src/features/health/composables/useOwnerHealth.ts src/features/health/OwnerHealthPage.vue src/features/health/__tests__/useOwnerHealth.test.ts src/router/index.ts powersync.yaml
git commit -m "feat(WAFI-148): add owner health dashboard, gated by can_view_health_metrics"
```

---

### Task 13: Team Dashboard (`platform_admins`-gated)

**Files:**
- Create: `supabase/migrations/112_wafi148_team_health_rpc.sql` (a
  `list_health_for_admin` RPC mirroring `list_shops_for_rollout_admin`'s
  `platform_admins` check exactly)
- Create: `src/features/health/composables/useTeamHealth.ts`
- Create: `src/features/health/TeamHealthPage.vue`
- Test: `supabase/tests/wafi148_team_health_rpc.test.sql`,
  `src/features/health/__tests__/useTeamHealth.test.ts`

**Interfaces:**
- Consumes: `platform_admins` (existing, migration 090), `health_metrics`/
  `health_gauges` (Task 2), `public.devices.last_seen_at`/`is_active` (existing).
- Produces: `public.list_health_for_admin(p_shop_query text DEFAULT NULL) RETURNS
  TABLE(...)` — a privileged, cross-shop read path structurally separate from
  `can_view_health_metrics` and from ordinary shop-scoped RLS (this RPC is
  `SECURITY DEFINER` and checks `platform_admins` directly, the same way
  `list_shops_for_rollout_admin` does — an ordinary shop staff/owner session fails the
  `platform_admins` check and gets `not authorized`, regardless of any per-shop
  permission flag).

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi148_team_health_rpc.test.sql
BEGIN;
SELECT plan(2);

-- list_health_for_admin checks platform_admins via auth.uid() directly (no
-- auth_shop_id()/shop_id claim involved) -- the "ordinary session" here just
-- needs a sub claim for a real, non-admin user.
SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('99999999-9999-9999-9999-999999999999', 'Shop G', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000005');
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
VALUES ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000',
        'drawer_mismatch_count', current_date, 2);

-- Ordinary authenticated shop owner (not a platform admin) must be rejected.
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000005","active_role":"owner"}', true);
SET LOCAL role authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.list_health_for_admin(NULL) $$,
  'P0001', 'not authorized',
  'an ordinary shop-scoped session cannot call the team health RPC, regardless of shop permissions'
);

-- A real platform admin can see cross-shop data.
SET LOCAL role postgres;
INSERT INTO public.platform_admins (user_id) VALUES (auth.uid()) ON CONFLICT DO NOTHING;
SELECT is(
  (SELECT count(*)::int FROM public.list_health_for_admin(NULL)
     WHERE shop_id = '99999999-9999-9999-9999-999999999999'),
  1, 'a platform admin sees the shop''s health row via the privileged read path'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — RPC doesn't exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/112_wafi148_team_health_rpc.sql
-- WAFI-148: cross-shop team health read, gated identically to
-- list_shops_for_rollout_admin (migration 090) -- platform_admins, NOT
-- can_view_health_metrics. These are deliberately different predicates:
-- can_view_health_metrics is an owner-granted per-shop staff flag for that
-- shop's OWN dashboard; this RPC is the founders' cross-shop operational
-- view and must reject an ordinary shop session outright, regardless of
-- any permission flag that shop's owner has granted.
CREATE OR REPLACE FUNCTION public.list_health_for_admin(p_shop_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id                   uuid,
  shop_name                 text,
  device_id                 uuid,
  metric_key                text,
  period_start              date,
  value                     bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT hm.shop_id, s.name, hm.device_id, hm.metric_key, hm.period_start, hm.value
    FROM public.health_metrics hm
    JOIN public.shops s ON s.id = hm.shop_id
   WHERE NULLIF(trim(p_shop_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_shop_query) || '%'
   ORDER BY s.name, hm.period_start DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_health_for_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_health_for_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_health_for_admin(text) TO authenticated;

-- list_health_for_admin only covers health_metrics (the cumulative/event-sourced
-- rows). Metric 3 (the gauge) and metric 7 (a live query, no stored row at all)
-- need their own companion function, gated identically.
CREATE OR REPLACE FUNCTION public.list_health_gauges_and_devices_for_admin(p_shop_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id      uuid,
  shop_name    text,
  device_id    uuid,
  gauge_key    text,
  gauge_value  bigint,
  observed_at  timestamptz,
  device_is_active   boolean,
  device_last_seen_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT s.id, s.name, d.id, hg.gauge_key, hg.value, hg.observed_at, d.is_active, d.last_seen_at
    FROM public.devices d
    JOIN public.shops s ON s.id = d.shop_id
    LEFT JOIN public.health_gauges hg ON hg.shop_id = d.shop_id AND hg.device_id = d.id
   WHERE NULLIF(trim(p_shop_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_shop_query) || '%'
   ORDER BY s.name, d.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_health_gauges_and_devices_for_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_health_gauges_and_devices_for_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_health_gauges_and_devices_for_admin(text) TO authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 2/2. Add one more assertion mirroring Step 1's pattern for
`list_health_gauges_and_devices_for_admin` (ordinary session rejected; platform admin
sees the row) before moving on — same shape, omitted here for brevity but required.

- [ ] **Step 5: Build `useTeamHealth.ts` + `TeamHealthPage.vue`, commit**

`useTeamHealth.ts` calls both `supabase.rpc('list_health_for_admin', ...)` and
`supabase.rpc('list_health_gauges_and_devices_for_admin', ...)` directly (same
direct-RPC pattern as `useRolloutAdmin.ts` — this data is cross-shop and explicitly not
PowerSync-synced), computing metric 7 via `computeStaleDeviceCount` (Task 12) applied to
the second RPC's device rows. Groups everything by shop/device, and renders exact values
with numerator/denominator per the spec (reusing `formatRate`/`formatCount`/
`formatGaugeFreshness` from Task 8) plus per-device drill-down and the
`telemetry_periods_dropped` diagnostic (read from `list_health_for_admin`'s rows —
it's just another `metric_key`, no special-cased query needed). `TeamHealthPage.vue`
mirrors whatever page structure `useRolloutAdmin.ts`'s existing admin screen uses,
registered in `src/router/index.ts` under the same admin-only route guard already
protecting the rollout-admin screen (not a new guard mechanism).

```bash
git add supabase/migrations/112_wafi148_team_health_rpc.sql supabase/tests/wafi148_team_health_rpc.test.sql src/features/health/composables/useTeamHealth.ts src/features/health/TeamHealthPage.vue src/features/health/__tests__/useTeamHealth.test.ts src/router/index.ts
git commit -m "feat(WAFI-148): add team health dashboard via platform_admins-gated RPC"
```

---

### Task 14: Cross-cutting security/parity tests

**Files:**
- Create: `supabase/tests/wafi148_rls_cross_shop.test.sql`
- Modify: `supabase/tests/wafi148_report_health_metrics_rpc.test.sql` (add the
  sum-then-divide regression guard)

**Interfaces:**
- Consumes: everything from Tasks 1-13. This task adds no new production code — it
  closes out the spec's explicit test-coverage requirements (RLS cross-shop isolation
  beyond Task 2's smoke test, and the sum-then-divide-never-average-child-rates
  invariant).

- [ ] **Step 1: Write the failing test — sum-then-divide regression guard**

```sql
-- append to supabase/tests/wafi148_report_health_metrics_rpc.test.sql
SELECT plan(9 + 1);  -- bump from Task 3's 9

-- ... Task 3's 9 assertions stay above ...

-- Two devices, deliberately different volumes, proving a shop-level rate
-- must be computed as SUM(numerators)/SUM(denominators), never
-- AVG(device_rate) -- device A: 1/10 = 10%, device B: 1/1000 = 0.1%,
-- shop-level correct answer is 2/1010 ~= 0.198%, NOT (10%+0.1%)/2 = 5.05%.
SET LOCAL role postgres;
INSERT INTO public.devices (id, shop_id, code, is_active) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'DEV3', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'DEV4', true);

INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value) VALUES
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sync_failure_terminal', '2026-08-20', 1),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sync_terminal_total',    '2026-08-20', 10),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sync_failure_terminal', '2026-08-20', 1),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sync_terminal_total',    '2026-08-20', 1000);

SELECT is(
  round(
    (SELECT sum(value) FROM public.health_metrics
       WHERE shop_id = '33333333-3333-3333-3333-333333333333'
         AND metric_key = 'sync_failure_terminal' AND period_start = '2026-08-20')::numeric
    /
    (SELECT sum(value) FROM public.health_metrics
       WHERE shop_id = '33333333-3333-3333-3333-333333333333'
         AND metric_key = 'sync_terminal_total' AND period_start = '2026-08-20')::numeric
    * 100, 3
  ),
  round(2.0 / 1010.0 * 100, 3),
  'shop-level rate is sum(numerators)/sum(denominators), not an average of device rates (would wrongly be ~5.05%)'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: this assertion should already PASS if Task 12/13's dashboard queries are
written correctly (per the spec's Metric Contracts rule) — if it fails, it means a
dashboard query somewhere is doing `AVG(device_rate)` instead of
`SUM(numerator)/SUM(denominator)`; fix that query before proceeding.

- [ ] **Step 3: Write the cross-shop RLS isolation test for both new tables' full CRUD surface**

```sql
-- supabase/tests/wafi148_rls_cross_shop.test.sql
BEGIN;
SELECT plan(4);

SET LOCAL role postgres;
INSERT INTO public.shops (id, name, timezone, owner_user_id) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Shop H', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000006'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Shop I', 'Asia/Damascus', 'e0000000-0000-0000-0000-000000000007');
INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', gen_random_uuid(), 'app_error_count', current_date, 1);
INSERT INTO public.health_gauges (shop_id, device_id, gauge_key, value, observed_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', gen_random_uuid(), 'dead_letter_count', 1, now());

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000007","active_role":"owner"}', true);
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.health_metrics WHERE shop_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'shop I cannot read shop H health_metrics'
);
SELECT is(
  (SELECT count(*)::int FROM public.health_gauges WHERE shop_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'shop I cannot read shop H health_gauges'
);
SELECT throws_ok(
  $$ INSERT INTO public.health_metrics (shop_id, device_id, metric_key, period_start, value)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', gen_random_uuid(), 'app_error_count', current_date, 99) $$,
  NULL, NULL,
  'no direct client INSERT policy exists on health_metrics -- all writes go through the RPC/apply functions'
);
SELECT throws_ok(
  $$ UPDATE public.health_metrics SET value = 0 WHERE shop_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  NULL, NULL,
  'no direct client UPDATE policy exists on health_metrics'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — 4/4, plus the sum-then-divide assertion from Step 1.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/wafi148_rls_cross_shop.test.sql supabase/tests/wafi148_report_health_metrics_rpc.test.sql
git commit -m "test(WAFI-148): add cross-shop RLS isolation and sum-then-divide regression guards"
```

---

## Explicitly out of scope for this plan (per the design spec's own deferrals)

- Printer failure count, scanner failure count — no real hardware driver exists yet.
- Any health-threshold-crossing/alerting engine, health-domain notification events,
  WAFI-156 subscriber/`execute_rule_action` extensions, or any digest — deferred to
  WAFI-148A.
- Wiring `_apply_health_drawer_mismatch`/`_apply_health_never_closed_shift` into the
  existing durable-subscriber dispatch for `shift.closed` (Tasks 4/5 add the
  apply/rebuild functions themselves, matching how `_apply_profit_cache` was added
  standalone before its own subscriber wiring in the WAFI-153 precedent) — the actual
  subscriber registration is a small follow-up once this plan's core is merged, listed
  here so it isn't silently forgotten.
