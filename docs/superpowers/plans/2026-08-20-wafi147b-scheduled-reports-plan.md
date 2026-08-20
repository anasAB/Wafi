# WAFI-147B: Server-Side Scheduled Report Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build server-side, wall-clock-scheduled generation of the 12 v1 wall-clock report types, persisted as durable snapshots the existing Reports viewer (WAFI-147A) reads before falling back to live compute, with a genuine server-side authorization split for the 5 reports containing staff-performance content.

**Architecture:** `pg_cron` fires a thin cadence resolver (`generate_scheduled_reports`) which, per due shop/report/period, calls one generation primitive (`generate_report_snapshot`) that computes the report in SQL, inserts an immutable snapshot (and, for 5 composite report types, a separately-secured staff-section row), and atomically notifies eligible recipients via the existing `public.notifications` table. The viewer checks for a matching snapshot before falling back to its existing live-compute path.

**Tech Stack:** PostgreSQL/PL-pgSQL (Supabase-hosted), pg_cron, pgTAP for server tests, Vue 3 + TypeScript for the client read-path change, existing `src/features/reports/*` report-definition modules as the parity reference.

**Spec:** `docs/superpowers/specs/2026-08-20-wafi147b-scheduled-reports-design.md` — this plan implements that spec exactly as written (frozen after multiple review rounds plus a repository-grounded verification pass). Executors should read both; this plan does not repeat the spec's rationale, only the concrete steps.

## Global Constraints

- All period boundaries are half-open UTC intervals `[period_start, period_end)` — see spec "Period semantics." Never derive a period from `now()`; always from an explicit or resolved `scheduled_for` slot.
- `generated_at` MUST use `clock_timestamp()`, never `now()`/`CURRENT_TIMESTAMP` (spec "Persisted artifact").
- Neither `generate_scheduled_reports` nor `generate_report_snapshot` may ever be `GRANT EXECUTE`'d to `authenticated` or `anon`. Both `SECURITY DEFINER` with `SET search_path = public, pg_catalog`.
- `generated_reports` RLS: `shop_id = auth_shop_id() AND public.can('can_view_reports')`.
- `generated_report_staff_sections` RLS: `shop_id = auth_shop_id() AND auth_role() = 'owner'` — a raw role check, **never** `public.can('can_view_staff_performance')` (spec "Read authorization": that flag is not trustworthy from the stored permissions blob for non-owners).
- No `UPDATE`/`DELETE` grant to any client role on either table. Snapshots are immutable; correction is explicitly out of scope (deferred follow-up ticket).
- Money values follow the existing convention: `bigint` minor units (cents), never `float`/`numeric` for currency (see `profit_cache`'s columns).
- The 5 report types with a `visibility: 'staff'` section (verified directly against `src/features/reports/definitions/*.ts`): `daily-closing`, `weekly-summary`, `monthly-health` (report id in code, "Monthly Business Health" in the spec's prose), `discount-report`, `returns-report`. The other 7 (`cash-flow`, `credit-report`, `profit-trend`, `top-customers`, `top-products`, `inventory-health`, `dead-stock`) have no gated section.
- `report_type` values in `generated_reports`/`generated_report_staff_sections` use the exact `ReportId` strings already defined in `src/features/reports/report.types.ts` (e.g. `'daily-closing'`, not `'daily_closing'` or `'Daily Closing'`) — one shared vocabulary between client and server, not a second naming scheme.
- Employee Summary (`'employee-summary'`) must never be a valid `report_type` value in either table in this plan's migrations — it has no wall-clock cadence and is explicitly out of 147B's scope.

---

## File Structure

**New Supabase migrations** (next available number is `099`; increment sequentially per task):
- `supabase/migrations/099_wafi147b_generated_reports.sql` — main snapshot table + RLS
- `supabase/migrations/100_wafi147b_generated_report_staff_sections.sql` — staff-section table + RLS
- `supabase/migrations/101_wafi147b_notifications_report_ready_index.sql` — new partial unique index on existing `public.notifications`
- `supabase/migrations/102_wafi147b_generate_report_snapshot.sql` — the generation primitive (validation, atomicity, per-report dispatch)
- `supabase/migrations/103_wafi147b_generate_scheduled_reports.sql` — the cadence resolver (slot resolution/validation, failure isolation, applicable-shops)
- `supabase/migrations/104_wafi147b_remaining_report_types.sql` — the other 10 report types' generation SQL (Task 6)
- `supabase/migrations/105_wafi147b_cron_jobs.sql` — the three `pg_cron.schedule(...)` calls

**New pgTAP tests** (`supabase/tests/`):
- `wafi147b_generated_reports_schema.test.sql`
- `wafi147b_generated_report_staff_sections_schema.test.sql`
- `wafi147b_notifications_report_ready_index.test.sql`
- `wafi147b_generate_report_snapshot.test.sql`
- `wafi147b_generate_scheduled_reports.test.sql`
- `wafi147b_period_semantics.test.sql`

**Client changes:**
- `src/features/reports/snapshotLookup.ts` (new) — the shared canonical period-boundary computation (per report cadence) used by the read path, kept as one file so the cross-runtime parity tests have exactly one client-side function to test against.
- `src/features/reports/ReportDetailPage.vue` (modify) — snapshot-first read path, staff-section composition, generated-at display.
- `src/features/reports/report.types.ts` (modify) — add the snapshot-sourced metadata fields to `Report`.
- `src/features/reports/__tests__/snapshotLookup.test.ts` (new)
- `src/features/reports/__tests__/ReportDetailPage.snapshot.test.ts` (new)

**PowerSync:**
- `powersync.yaml` (modify) — new sync-rule buckets for `generated_reports` and `generated_report_staff_sections`.
- `src/data/powersync/schema.ts` (modify) — client-side table schema for both.

---

### Task 1: `generated_reports` migration — schema, constraints, RLS

**Files:**
- Create: `supabase/migrations/099_wafi147b_generated_reports.sql`
- Test: `supabase/tests/wafi147b_generated_reports_schema.test.sql`

**Interfaces:**
- Produces: table `public.generated_reports` with columns `id uuid`, `shop_id uuid`, `report_type text`, `period_start timestamptz`, `period_end timestamptz`, `scheduled_for timestamptz` (nullable), `generated_at timestamptz`, `report_schema_version integer`, `report_data jsonb`; unique constraint `(shop_id, report_type, period_start, period_end)`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi147b_generated_reports_schema.test.sql
BEGIN;
SELECT plan(9);

SELECT has_table('public', 'generated_reports', 'generated_reports table exists');
SELECT has_column('public', 'generated_reports', 'shop_id', 'has shop_id');
SELECT col_is_fk('public', 'generated_reports', 'shop_id', 'shop_id references shops');
SELECT col_not_null('public', 'generated_reports', 'report_type', 'report_type NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'period_start', 'period_start NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'period_end', 'period_end NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'report_schema_version', 'report_schema_version NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'report_data', 'report_data NOT NULL');

SELECT throws_ok(
  $$ INSERT INTO public.generated_reports
     (shop_id, report_type, period_start, period_end, report_schema_version, report_data)
     VALUES ('00000000-0000-0000-0000-000000000001', 'cash-flow',
             '2026-08-20 00:00:00+00', '2026-08-19 00:00:00+00', 1, '{}') $$,
  NULL, NULL,
  'period_start >= period_end is rejected by CHECK constraint'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generated_reports_schema.test.sql`
Expected: FAIL — `relation "generated_reports" does not exist`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/099_wafi147b_generated_reports.sql
-- WAFI-147B. Main scheduled-report snapshot table. See design spec
-- "Persisted artifact" and "Read authorization" for the full rationale.
-- report_type is constrained to ONLY the 12 wall-clock report types this
-- ticket implements -- Employee Summary ('employee-summary') is deliberately
-- excluded; its snapshot identity needs a staff_id/shift_id dimension this
-- table does not have (see the follow-up ticket noted in the design spec).

CREATE TABLE IF NOT EXISTS public.generated_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES public.shops(id),
  report_type           text NOT NULL CHECK (report_type IN (
                           'daily-closing', 'cash-flow',
                           'weekly-summary', 'inventory-health', 'discount-report',
                           'returns-report', 'credit-report', 'dead-stock',
                           'monthly-health', 'profit-trend', 'top-customers', 'top-products'
                         )),
  period_start          timestamptz NOT NULL,
  period_end            timestamptz NOT NULL,
  scheduled_for         timestamptz,
  generated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  report_schema_version integer NOT NULL,
  report_data           jsonb NOT NULL,
  CHECK (period_start < period_end),
  UNIQUE (shop_id, report_type, period_start, period_end)
);

ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_reports_select_scoped ON public.generated_reports;
CREATE POLICY generated_reports_select_scoped ON public.generated_reports
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_view_reports')
  );

-- No INSERT/UPDATE/DELETE policy for any client role -- immutable, server-only
-- writes via generate_report_snapshot() (Task 4). REVOKE explicitly rather
-- than relying on "no policy = no access" alone, matching this codebase's
-- existing precedent (086_profit_cache_apply.sql's REVOKE on its apply
-- function) of making the intent explicit, not implicit.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.generated_reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.generated_reports TO anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/099_wafi147b_generated_reports.sql && psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generated_reports_schema.test.sql`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/099_wafi147b_generated_reports.sql supabase/tests/wafi147b_generated_reports_schema.test.sql
git commit -m "feat(WAFI-147B): add generated_reports snapshot table with can_view_reports RLS"
```

---

### Task 2: `generated_report_staff_sections` migration — schema, constraints, RLS

**Files:**
- Create: `supabase/migrations/100_wafi147b_generated_report_staff_sections.sql`
- Test: `supabase/tests/wafi147b_generated_report_staff_sections_schema.test.sql`

**Interfaces:**
- Consumes: `public.generated_reports(id)` from Task 1.
- Produces: table `public.generated_report_staff_sections` with columns `id uuid`, `generated_report_id uuid` (FK), `shop_id uuid` (denormalized), `section_data jsonb`; unique constraint `(generated_report_id)`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi147b_generated_report_staff_sections_schema.test.sql
BEGIN;
SELECT plan(6);

SELECT has_table('public', 'generated_report_staff_sections', 'table exists');
SELECT col_is_fk('public', 'generated_report_staff_sections', 'generated_report_id',
  'generated_report_id references generated_reports');
SELECT col_is_fk('public', 'generated_report_staff_sections', 'shop_id',
  'shop_id references shops');
SELECT col_not_null('public', 'generated_report_staff_sections', 'section_data', 'section_data NOT NULL');

-- RLS: owner sees a row inserted for their shop; a non-owner in the same
-- shop sees none. Uses the existing wafi_owner_bootstrap-style test JWT
-- helper pattern already used elsewhere in this test suite for auth_role().
SELECT results_eq(
  $$ SELECT auth_role() = 'owner' $$,
  $$ SELECT true $$,
  'sanity: this test session is seeded as owner before checking the negative case'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections),
  0,
  'no rows exist yet in this fresh transaction -- placeholder until Task 4 seeds real rows for the manager-denied case'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generated_report_staff_sections_schema.test.sql`
Expected: FAIL — `relation "generated_report_staff_sections" does not exist`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/100_wafi147b_generated_report_staff_sections.sql
-- WAFI-147B. Holds ONLY the visibility:'staff' section content for the 5
-- composite report types (daily-closing, weekly-summary, monthly-health,
-- discount-report, returns-report -- verified directly against
-- src/features/reports/definitions/*.ts, not assumed). RLS uses a raw
-- auth_role() check, NOT public.can('can_view_staff_performance') -- see
-- design spec "Read authorization": permissionsForRole() in
-- src/features/staff/staff.types.ts does not trust the stored permissions
-- blob for this flag on non-owners, so neither does this policy.

CREATE TABLE IF NOT EXISTS public.generated_report_staff_sections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_report_id   uuid NOT NULL REFERENCES public.generated_reports(id),
  shop_id               uuid NOT NULL REFERENCES public.shops(id),
  section_data          jsonb NOT NULL,
  UNIQUE (generated_report_id)
);

ALTER TABLE public.generated_report_staff_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_report_staff_sections_select_owner_only
  ON public.generated_report_staff_sections;
CREATE POLICY generated_report_staff_sections_select_owner_only
  ON public.generated_report_staff_sections
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (SELECT public.auth_role()) = 'owner'
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.generated_report_staff_sections FROM anon, authenticated;
GRANT SELECT ON TABLE public.generated_report_staff_sections TO anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/100_wafi147b_generated_report_staff_sections.sql && psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generated_report_staff_sections_schema.test.sql`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/100_wafi147b_generated_report_staff_sections.sql supabase/tests/wafi147b_generated_report_staff_sections_schema.test.sql
git commit -m "feat(WAFI-147B): add generated_report_staff_sections table, owner-only RLS"
```

---

### Task 3: `public.notifications` — new partial unique index for report-ready idempotency

**Files:**
- Create: `supabase/migrations/101_wafi147b_notifications_report_ready_index.sql`
- Test: `supabase/tests/wafi147b_notifications_report_ready_index.test.sql`

**Interfaces:**
- Consumes: existing `public.notifications` table (`079_notifications.sql`) — columns `entity_type text`, `entity_id text`, `recipient_staff_id text`, `type text`.
- Produces: partial unique index `notifications_report_ready_unique` on `(entity_id, recipient_staff_id) WHERE type = 'report_ready'`, used by Task 4's `ON CONFLICT`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/wafi147b_notifications_report_ready_index.test.sql
BEGIN;
SELECT plan(2);

SELECT has_index('public', 'notifications', 'notifications_report_ready_unique',
  'partial unique index for report_ready notifications exists');

INSERT INTO public.notifications (shop_id, recipient_staff_id, type, title, message, entity_type, entity_id, source_event_id)
VALUES ('shop-1', 'staff-1', 'report_ready', 'x', 'x', 'generated_report', 'report-1', NULL);

SELECT throws_ok(
  $$ INSERT INTO public.notifications (shop_id, recipient_staff_id, type, title, message, entity_type, entity_id, source_event_id)
     VALUES ('shop-1', 'staff-1', 'report_ready', 'x', 'x', 'generated_report', 'report-1', NULL) $$,
  '23505',
  NULL,
  'duplicate (entity_id, recipient_staff_id) for type=report_ready is rejected'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_notifications_report_ready_index.test.sql`
Expected: FAIL — first assertion fails (`has_index` false), second insert does NOT throw (no constraint yet)

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/101_wafi147b_notifications_report_ready_index.sql
-- WAFI-147B. The existing notifications table's only unique index
-- (notifications_source_event_id_unique, 091) provides no duplicate
-- protection for source_event_id = NULL rows (every NULL is distinct under
-- a plain unique index) -- the correct value for our rows, since a
-- scheduled report snapshot has no originating events-bus event (same
-- established pattern as Low Stock notifications). This partial index,
-- scoped to type = 'report_ready' only, is what generate_report_snapshot()
-- (Task 4) conflicts against for its per-recipient no-op-on-conflict
-- insert -- mirrors this codebase's own existing partial-index precedent
-- (091's comment referencing the prior audit_log fix).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_report_ready_unique
  ON public.notifications (entity_id, recipient_staff_id)
  WHERE type = 'report_ready';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/101_wafi147b_notifications_report_ready_index.sql && psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_notifications_report_ready_index.test.sql`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/101_wafi147b_notifications_report_ready_index.sql supabase/tests/wafi147b_notifications_report_ready_index.test.sql
git commit -m "feat(WAFI-147B): add partial unique index for report_ready notifications"
```

---

### Task 4: `generate_report_snapshot(...)` — the generation primitive, with 2 worked report types

This task builds the shared primitive (validation, idempotency, atomicity) and wires in **two representative report types end-to-end**: `cash-flow` (no gated section — the simple case) and `weekly-summary` (has a gated section — the composite case). Task 6 covers porting the remaining 10 report types to this same primitive.

**Files:**
- Create: `supabase/migrations/102_wafi147b_generate_report_snapshot.sql`
- Test: `supabase/tests/wafi147b_generate_report_snapshot.test.sql`

**Interfaces:**
- Consumes: `public.generated_reports` (Task 1), `public.generated_report_staff_sections` (Task 2), `public.notifications` + its new index (Task 3), `public.profit_cache` (existing, `086_profit_cache_apply.sql`), `public.can('can_view_reports')`/`public.auth_role()` (existing, `054_auth_role_helpers.sql`).
- Produces: `generate_report_snapshot(p_shop_id uuid, p_report_type text, p_period_start timestamptz, p_period_end timestamptz, p_scheduled_for timestamptz DEFAULT NULL) RETURNS uuid` — returns the snapshot's `id` (existing or newly created); called directly by Task 5's resolver and by future operator recovery.

- [ ] **Step 1: Write the failing pgTAP tests**

```sql
-- supabase/tests/wafi147b_generate_report_snapshot.test.sql
BEGIN;
SELECT plan(8);

-- Fixture shop + owner + a manager with can_view_reports granted (for
-- notification fan-out) + a cashier without it.
INSERT INTO public.shops (id, owner_user_id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Test Shop');
INSERT INTO public.staff (id, shop_id, name, role, permissions) VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Owner', 'owner', '{}'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Manager', 'manager', '{"can_view_reports": true}'),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Cashier', 'cashier', '{}');

-- 1. Coherence validation: a mismatched period for a valid scheduled_for is rejected.
SELECT throws_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'weekly-summary',
       '2026-08-10 00:00:00+00', '2026-08-11 00:00:00+00', -- one day, not a week
       '2026-08-17 09:00:00+00') $$,
  NULL, NULL,
  'period not matching (report_type, scheduled_for) is rejected'
);

-- 2. Simple (non-composite) report type: creates exactly one snapshot row.
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'cash-flow',
       '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 00:00:00+00') $$,
  'cash-flow generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports
   WHERE shop_id = '11111111-1111-1111-1111-111111111111' AND report_type = 'cash-flow'),
  1, 'exactly one cash-flow snapshot row created'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'cash-flow'),
  0, 'cash-flow (no gated section) never gets a staff_sections row'
);

-- 3. Idempotency: calling again with the same natural key is a no-op.
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'cash-flow',
       '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 00:00:00+00') $$,
  'second call for same natural key is a safe no-op'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports
   WHERE shop_id = '11111111-1111-1111-1111-111111111111' AND report_type = 'cash-flow'),
  1, 'still exactly one row after the no-op retry'
);

-- 4. Composite report type: creates a main snapshot AND a staff-sections row,
--    AND exactly 2 notifications (owner + manager; cashier lacks can_view_reports).
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'weekly-summary',
       '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-17 09:00:00+00') $$,
  'weekly-summary generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE entity_type = 'generated_report' AND type = 'report_ready'
     AND recipient_staff_id IN ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444')),
  2, 'exactly 2 notifications: owner + the can_view_reports-granted manager'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generate_report_snapshot.test.sql`
Expected: FAIL — `function generate_report_snapshot(...) does not exist`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/102_wafi147b_generate_report_snapshot.sql
-- WAFI-147B. The generation primitive. Trusted-caller only (see search_path/
-- EXECUTE grants below) -- callers (the cadence resolver, future operator
-- recovery, future event triggers) each independently establish that the
-- request is in scope before calling; this function does not re-derive
-- shop/report/period authorization for the CALLER, only validates internal
-- coherence of the (report_type, period, scheduled_for) tuple itself.

-- Derives the expected period for a given (report_type, scheduled_for),
-- per the design spec's Period semantics -- the single source of truth
-- both the coherence check below and future callers must agree with.
CREATE OR REPLACE FUNCTION public._wafi147b_expected_period(
  p_report_type text, p_scheduled_for timestamptz
) RETURNS TABLE(period_start timestamptz, period_end timestamptz)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cadence text;
BEGIN
  v_cadence := CASE p_report_type
    WHEN 'daily-closing', 'cash-flow' THEN 'daily'
    WHEN 'weekly-summary', 'inventory-health', 'discount-report',
         'returns-report', 'credit-report', 'dead-stock' THEN 'weekly'
    WHEN 'monthly-health', 'profit-trend', 'top-customers', 'top-products' THEN 'monthly'
    ELSE NULL
  END;

  IF v_cadence IS NULL THEN
    RAISE EXCEPTION 'unknown wall-clock report_type: %', p_report_type;
  END IF;

  IF v_cadence = 'daily' THEN
    RETURN QUERY SELECT
      (p_scheduled_for - interval '1 day')::timestamptz,
      p_scheduled_for::timestamptz;
  ELSIF v_cadence = 'weekly' THEN
    -- scheduled_for is always a Sunday 09:00 UTC slot (validated by the
    -- caller/resolver); the reporting week is the preceding Mon 00:00 to
    -- the following Mon 00:00 (i.e. 7 days before the Sunday's own
    -- midnight, per the design spec's worked example).
    RETURN QUERY SELECT
      (date_trunc('day', p_scheduled_for) - interval '6 days')::timestamptz,
      (date_trunc('day', p_scheduled_for) + interval '1 day')::timestamptz;
  ELSE -- monthly
    RETURN QUERY SELECT
      (date_trunc('month', p_scheduled_for) - interval '1 month')::timestamptz,
      date_trunc('month', p_scheduled_for)::timestamptz;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_report_snapshot(
  p_shop_id uuid,
  p_report_type text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_scheduled_for timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
  v_expected record;
  v_report_data jsonb;
  v_staff_section jsonb;
  v_recipient record;
BEGIN
  -- Input-coherence validation (design spec, generation-primitive section):
  -- for wall-clock callers (scheduled_for IS NOT NULL), the supplied period
  -- must exactly match what (report_type, scheduled_for) derives -- never
  -- trust a caller-supplied period independently of the slot.
  IF p_scheduled_for IS NOT NULL THEN
    SELECT * INTO v_expected FROM public._wafi147b_expected_period(p_report_type, p_scheduled_for);
    IF v_expected.period_start IS DISTINCT FROM p_period_start
       OR v_expected.period_end IS DISTINCT FROM p_period_end THEN
      RAISE EXCEPTION
        'period (%,%) does not match what report_type % + scheduled_for % derives: (%,%)',
        p_period_start, p_period_end, p_report_type, p_scheduled_for,
        v_expected.period_start, v_expected.period_end;
    END IF;
  END IF;

  -- Insert-if-absent: existing snapshot for this natural key is a safe no-op.
  SELECT id INTO v_existing_id FROM public.generated_reports
  WHERE shop_id = p_shop_id AND report_type = p_report_type
    AND period_start = p_period_start AND period_end = p_period_end;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Compute the report. Task 4 wires cash-flow and weekly-summary; Task 6
  -- adds the remaining 10 report_type branches to this same CASE.
  IF p_report_type = 'cash-flow' THEN
    SELECT jsonb_build_object(
      'id', 'cash-flow', 'name', 'Cash Flow Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Cash Flow', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Revenue', 'value', COALESCE(SUM(revenue_usd), 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Expenses', 'value', COALESCE(SUM(expenses_usd), 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Refunds', 'value', COALESCE(SUM(refunds_usd), 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Net cash change', 'value',
              COALESCE(SUM(revenue_usd) - SUM(expenses_usd) - SUM(refunds_usd), 0), 'unit', 'USD')
          )
        )
      )
    ) INTO v_report_data
    FROM public.profit_cache
    WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date;

  ELSIF p_report_type = 'weekly-summary' THEN
    SELECT jsonb_build_object(
      'id', 'weekly-summary', 'name', 'Weekly Summary',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Week over Week', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Revenue', 'value', COALESCE(pc.revenue, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Profit', 'value', COALESCE(pc.revenue - pc.cogs, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Expenses', 'value', COALESCE(pc.expenses, 0), 'unit', 'USD')
          )
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(revenue_usd) AS revenue, SUM(cogs_usd) AS cogs, SUM(expenses_usd) AS expenses
      FROM public.profit_cache
      WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date
    ) pc;

    -- The gated staff-ranking section, computed and stored SEPARATELY --
    -- never merged into v_report_data. This is the enforcement point for
    -- the whole split-table security model: if this branch is ever
    -- accidentally merged into v_report_data above, the security invariant
    -- is silently broken. See wafi147b_generate_report_snapshot.test.sql's
    -- "staff-section separation" assertions.
    SELECT jsonb_build_object(
      'type', 'detail', 'title', 'Staff Ranking', 'visibility', 'staff',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'name', 'label', 'Staff'),
        jsonb_build_object('key', 'revenueUsd', 'label', 'Revenue')
      ),
      'rows', COALESCE(jsonb_agg(jsonb_build_object('name', st.name, 'revenueUsd', ranked.revenue_usd)
                                 ORDER BY ranked.revenue_usd DESC), '[]'::jsonb)
    ) INTO v_staff_section
    FROM (
      SELECT s.staff_id, SUM(s.total_usd) AS revenue_usd
      FROM public.sales s
      WHERE s.shop_id = p_shop_id AND s.staff_id IS NOT NULL
        AND s.created_at >= p_period_start AND s.created_at < p_period_end
      GROUP BY s.staff_id
    ) ranked
    JOIN public.staff st ON st.id = ranked.staff_id;

  ELSE
    RAISE EXCEPTION 'generate_report_snapshot: report_type % not yet implemented (see Task 6)', p_report_type;
  END IF;

  -- Atomic: main snapshot + (if applicable) staff-section row + all
  -- recipient notifications, all in this one function's transaction.
  INSERT INTO public.generated_reports
    (shop_id, report_type, period_start, period_end, scheduled_for, report_schema_version, report_data)
  VALUES (p_shop_id, p_report_type, p_period_start, p_period_end, p_scheduled_for, 1, v_report_data)
  RETURNING id INTO v_new_id;

  IF v_staff_section IS NOT NULL THEN
    INSERT INTO public.generated_report_staff_sections
      (generated_report_id, shop_id, section_data)
    VALUES (v_new_id, p_shop_id, v_staff_section);
  END IF;

  -- Notification fan-out: every staff member (or the owner) with
  -- can_view_reports for this shop, one row per recipient, idempotent on
  -- (entity_id, recipient_staff_id) via the Task 3 partial index.
  FOR v_recipient IN
    SELECT st.id AS staff_id FROM public.staff st
    WHERE st.shop_id = p_shop_id AND st.is_active = true
      AND (st.role = 'owner' OR (st.permissions::jsonb ->> 'can_view_reports')::boolean IS TRUE)
  LOOP
    INSERT INTO public.notifications
      (shop_id, recipient_staff_id, type, title, message, entity_type, entity_id, source_event_id)
    VALUES (
      p_shop_id::text, v_recipient.staff_id::text, 'report_ready',
      'تقرير جديد جاهز', 'تم إنشاء تقرير ' || p_report_type,
      'generated_report', v_new_id::text, NULL
    )
    ON CONFLICT ON CONSTRAINT notifications_report_ready_unique DO NOTHING;
  END LOOP;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_report_snapshot(uuid, text, timestamptz, timestamptz, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._wafi147b_expected_period(text, timestamptz) FROM public, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/102_wafi147b_generate_report_snapshot.sql && psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generate_report_snapshot.test.sql`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/102_wafi147b_generate_report_snapshot.sql supabase/tests/wafi147b_generate_report_snapshot.test.sql
git commit -m "feat(WAFI-147B): add generate_report_snapshot primitive (cash-flow, weekly-summary)"
```

---

### Task 5: `generate_scheduled_reports(...)` — cadence resolver with slot validation and failure isolation

**Files:**
- Create: `supabase/migrations/103_wafi147b_generate_scheduled_reports.sql`
- Test: `supabase/tests/wafi147b_generate_scheduled_reports.test.sql`

**Interfaces:**
- Consumes: `public.generate_report_snapshot(...)` (Task 4), `public.shops.is_active`.
- Produces: `generate_scheduled_reports(p_cadence text, p_scheduled_for timestamptz DEFAULT NULL) RETURNS void`.

- [ ] **Step 1: Write the failing pgTAP tests**

```sql
-- supabase/tests/wafi147b_generate_scheduled_reports.test.sql
BEGIN;
SELECT plan(6);

INSERT INTO public.shops (id, owner_user_id, name, is_active) VALUES
  ('66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777', 'Active Shop', true),
  ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', 'Inactive Shop', false);

-- 1. Slot validation: an off-schedule explicit scheduled_for is rejected.
SELECT throws_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-19 13:37:00+00') $$, -- a Wednesday
  NULL, NULL, 'non-canonical weekly slot is rejected'
);
SELECT throws_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-16 10:00:00+00') $$, -- Sunday, wrong hour
  NULL, NULL, 'canonical day but wrong hour is rejected'
);
SELECT lives_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-16 09:00:00+00') $$, -- a real Sunday 09:00
  'canonical Sunday 09:00 slot is accepted'
);

-- 2. Applicable shops: only the active shop gets a snapshot.
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports WHERE shop_id = '66666666-6666-6666-6666-666666666666'),
  6, 'active shop gets all 6 weekly report types'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_reports WHERE shop_id = '88888888-8888-8888-8888-888888888888'),
  0, 'inactive shop gets nothing'
);

-- 3. Idempotency at the resolver level: re-running the same slot changes nothing.
SELECT lives_ok(
  $$ SELECT public.generate_scheduled_reports('weekly', '2026-08-16 09:00:00+00') $$,
  're-running the same slot is a safe no-op'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generate_scheduled_reports.test.sql`
Expected: FAIL — `function generate_scheduled_reports(...) does not exist`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/103_wafi147b_generate_scheduled_reports.sql
-- WAFI-147B. The cadence resolver pg_cron calls. Thin: resolves the slot,
-- finds applicable shops, delegates all computation to
-- generate_report_snapshot(). Never computes a report itself.

CREATE OR REPLACE FUNCTION public._wafi147b_report_types_for_cadence(p_cadence text)
RETURNS text[] LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_cadence
    WHEN 'daily' THEN ARRAY['daily-closing', 'cash-flow']
    WHEN 'weekly' THEN ARRAY['weekly-summary', 'inventory-health', 'discount-report',
                             'returns-report', 'credit-report', 'dead-stock']
    WHEN 'monthly' THEN ARRAY['monthly-health', 'profit-trend', 'top-customers', 'top-products']
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.generate_scheduled_reports(
  p_cadence text,
  p_scheduled_for timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_slot timestamptz;
  v_report_types text[];
  v_shop record;
  v_report_type text;
BEGIN
  v_report_types := public._wafi147b_report_types_for_cadence(p_cadence);
  IF v_report_types IS NULL THEN
    RAISE EXCEPTION 'unknown cadence: %', p_cadence;
  END IF;

  IF p_scheduled_for IS NOT NULL THEN
    -- Validate the explicit slot is a real canonical slot for this cadence
    -- (design spec "Validation invariant") -- reject before any generation.
    IF p_cadence = 'daily' AND (p_scheduled_for::time != '00:00:00' OR p_scheduled_for != date_trunc('day', p_scheduled_for)) THEN
      RAISE EXCEPTION 'invalid daily slot: % is not 00:00 UTC', p_scheduled_for;
    ELSIF p_cadence = 'weekly' AND (extract(dow from p_scheduled_for) != 0 OR p_scheduled_for::time != '09:00:00') THEN
      RAISE EXCEPTION 'invalid weekly slot: % is not a Sunday 09:00 UTC', p_scheduled_for;
    ELSIF p_cadence = 'monthly' AND (extract(day from p_scheduled_for) != 1 OR p_scheduled_for::time != '09:00:00') THEN
      RAISE EXCEPTION 'invalid monthly slot: % is not the 1st 09:00 UTC', p_scheduled_for;
    END IF;
    v_slot := p_scheduled_for;
  ELSE
    -- Resolve the most recent canonical slot at-or-before actual execution
    -- time (design spec "Precise resolution rule") -- never a bare now().
    IF p_cadence = 'daily' THEN
      v_slot := date_trunc('day', clock_timestamp());
    ELSIF p_cadence = 'weekly' THEN
      v_slot := date_trunc('day', clock_timestamp())
        - (extract(dow from clock_timestamp())::int * interval '1 day')
        + interval '9 hours';
      IF v_slot > clock_timestamp() THEN v_slot := v_slot - interval '7 days'; END IF;
    ELSE -- monthly
      v_slot := date_trunc('month', clock_timestamp()) + interval '9 hours';
      IF v_slot > clock_timestamp() THEN v_slot := v_slot - interval '1 month'; END IF;
    END IF;
  END IF;

  FOR v_shop IN SELECT id FROM public.shops WHERE is_active = true LOOP
    FOREACH v_report_type IN ARRAY v_report_types LOOP
      -- Failure isolation (design spec, Option A): one item's exception is
      -- caught here and does not abort the remaining items in this loop.
      -- This does NOT mean each item commits independently of the others --
      -- see the spec's honest statement of what this subtransaction
      -- boundary does and does not guarantee under a catastrophic crash of
      -- this whole function's outer transaction.
      BEGIN
        DECLARE
          v_period record;
        BEGIN
          SELECT * INTO v_period FROM public._wafi147b_expected_period(v_report_type, v_slot);
          PERFORM public.generate_report_snapshot(
            v_shop.id, v_report_type, v_period.period_start, v_period.period_end, v_slot
          );
        END;
      EXCEPTION WHEN OTHERS THEN
        -- Rollback-surviving observability (design spec): RAISE WARNING
        -- goes to the server log / connected client, outside this
        -- function's own transaction, so it survives even if the outer
        -- transaction this whole call is part of later rolls back.
        RAISE WARNING 'generate_report_snapshot failed for shop=%, report_type=%, slot=%: %',
          v_shop.id, v_report_type, v_slot, SQLERRM;
      END;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_scheduled_reports(text, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._wafi147b_report_types_for_cadence(text) FROM public, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/103_wafi147b_generate_scheduled_reports.sql && psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generate_scheduled_reports.test.sql`
Expected: PASS (6/6) — note: the weekly test only exercises the 2 report types Task 4 implemented (`weekly-summary`) plus 5 not-yet-implemented ones, which will raise the Task 4 "not yet implemented" exception and get caught by failure isolation, logged as a warning, and skipped — so the count assertion in Step 1 must be adjusted to `1` (only `weekly-summary`) until Task 6 lands. **Fix the test's expected count to `1` before running, and add a comment noting the other 5 raise-and-get-skipped until Task 6.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/103_wafi147b_generate_scheduled_reports.sql supabase/tests/wafi147b_generate_scheduled_reports.test.sql
git commit -m "feat(WAFI-147B): add generate_scheduled_reports cadence resolver"
```

---

### Task 6: Port the remaining 10 report types into `generate_report_snapshot`

**Scope note:** this is a distinct, mechanically-repeatable unit of work — each report type is independently reviewable and testable against its own `src/features/reports/definitions/<name>.ts` as the parity reference. Per the design spec's "What parity means" section, verify each against the corresponding live-computed output.

**Files:**
- Modify: `supabase/migrations/102_wafi147b_generate_report_snapshot.sql` → create a new migration `supabase/migrations/104_wafi147b_remaining_report_types.sql` that `CREATE OR REPLACE FUNCTION`s the same `generate_report_snapshot` with the full `CASE`/`IF` covering all 12 report types (never edit an already-applied migration file in place).
- Modify: `supabase/tests/wafi147b_generate_report_snapshot.test.sql` → add one `lives_ok`/count-check pair per remaining report type.

**Interfaces:**
- Consumes: same signature as Task 4's `generate_report_snapshot`.
- Produces: full coverage of `'daily-closing'`, `'inventory-health'`, `'discount-report'`, `'returns-report'`, `'credit-report'`, `'dead-stock'`, `'monthly-health'`, `'profit-trend'`, `'top-customers'`, `'top-products'`.

- [ ] **Step 1: Write the failing test for `daily-closing`** (representative of this task's pattern — repeat for each remaining report type, one sub-step per type, each with its own `lives_ok`/count assertion and, for the 4 remaining composite types (`discount-report`, `returns-report`, `monthly-health` — `daily-closing` itself already covered here), a staff-section-row-exists assertion matching Task 4's weekly-summary pattern)

```sql
-- append to wafi147b_generate_report_snapshot.test.sql
SELECT lives_ok(
  $$ SELECT public.generate_report_snapshot(
       '11111111-1111-1111-1111-111111111111', 'daily-closing',
       '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', '2026-08-20 00:00:00+00') $$,
  'daily-closing generation succeeds'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections grs
   JOIN public.generated_reports gr ON gr.id = grs.generated_report_id
   WHERE gr.report_type = 'daily-closing' AND gr.shop_id = '11111111-1111-1111-1111-111111111111'),
  1, 'daily-closing (has a gated section per dailyClosing.ts) gets a staff_sections row'
);
```

- [ ] **Step 2: Run to verify it fails, per type, as each is added**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generate_report_snapshot.test.sql`
Expected: FAIL — `report_type daily-closing not yet implemented` (from Task 4's `ELSE RAISE EXCEPTION`)

- [ ] **Step 3: Add the `daily-closing` branch, reading its query shape from `src/features/reports/definitions/dailyClosing.ts`**

```sql
-- inside the same CASE/IF chain, added via 104_wafi147b_remaining_report_types.sql's
-- CREATE OR REPLACE FUNCTION public.generate_report_snapshot(...) (full function body,
-- Task 4's cash-flow/weekly-summary branches plus this one and the other 9):
  ELSIF p_report_type = 'daily-closing' THEN
    SELECT jsonb_build_object(
      'id', 'daily-closing', 'name', 'Daily Closing Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Sales Totals', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Total sales', 'value', COALESCE(pc.revenue, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Transactions', 'value', COALESCE(pc.invoice_count, 0))
          )
        ),
        jsonb_build_object(
          'type', 'summary', 'title', 'Expenses', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Expenses', 'value', COALESCE(pc.expenses, 0), 'unit', 'USD')
          )
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(revenue_usd) AS revenue, SUM(expenses_usd) AS expenses, SUM(invoice_count) AS invoice_count
      FROM public.profit_cache
      WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date
    ) pc;

    SELECT jsonb_build_object(
      'type', 'detail', 'title', 'Staff Performance', 'visibility', 'staff',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'name', 'label', 'Staff'),
        jsonb_build_object('key', 'revenueUsd', 'label', 'Revenue')
      ),
      'rows', COALESCE(jsonb_agg(jsonb_build_object('name', st.name, 'revenueUsd', ranked.revenue_usd)), '[]'::jsonb)
    ) INTO v_staff_section
    FROM (
      SELECT s.staff_id, SUM(s.total_usd) AS revenue_usd
      FROM public.sales s
      WHERE s.shop_id = p_shop_id AND s.staff_id IS NOT NULL
        AND s.created_at >= p_period_start AND s.created_at < p_period_end
      GROUP BY s.staff_id
    ) ranked
    JOIN public.staff st ON st.id = ranked.staff_id;
```

Do not implement `inventory-health`, `discount-report`, `returns-report`, `credit-report`, `dead-stock`, `monthly-health`, `profit-trend`, `top-customers`, `top-products` inline in this plan — each follows the exact same steps (write failing test against the type's own `src/features/reports/definitions/<name>.ts`, add a `CASE` branch reading the same source tables that file's client-side query reads, verify staff-section separation for the 2 remaining composite types `discount-report`/`returns-report`/`monthly-health`, run, commit). Track each as its own task-sized unit of work when executing this plan (e.g. via `superpowers:subagent-driven-development`, one subagent per report type) rather than expanding this single task further.

- [ ] **Step 4: Run full test file, verify all pass**

Run: `psql "$SUPABASE_DB_URL" -f supabase/migrations/104_wafi147b_remaining_report_types.sql && psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_generate_report_snapshot.test.sql`
Expected: PASS, all report types covered

- [ ] **Step 5: Commit** (one commit per report type, or one batched commit if done in a single session)

```bash
git add supabase/migrations/104_wafi147b_remaining_report_types.sql supabase/tests/wafi147b_generate_report_snapshot.test.sql
git commit -m "feat(WAFI-147B): implement daily-closing report generation"
```

---

### Task 7: Period-semantics pgTAP tests (boundary correctness, half-open intervals)

**Files:**
- Create: `supabase/tests/wafi147b_period_semantics.test.sql`

**Interfaces:**
- Consumes: `public._wafi147b_expected_period(text, timestamptz)` (Task 4).

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/wafi147b_period_semantics.test.sql
BEGIN;
SELECT plan(4);

-- Daily: 2026-08-20 00:00 UTC trigger -> [2026-08-19 00:00, 2026-08-20 00:00)
SELECT results_eq(
  $$ SELECT period_start, period_end FROM public._wafi147b_expected_period('cash-flow', '2026-08-20 00:00:00+00') $$,
  $$ VALUES ('2026-08-19 00:00:00+00'::timestamptz, '2026-08-20 00:00:00+00'::timestamptz) $$,
  'daily period is the previous UTC calendar day'
);

-- Weekly: Sunday 2026-08-23 09:00 UTC -> [2026-08-10 00:00, 2026-08-17 00:00)
-- (the design spec's own worked example -- the week that ended the day before)
SELECT results_eq(
  $$ SELECT period_start, period_end FROM public._wafi147b_expected_period('weekly-summary', '2026-08-23 09:00:00+00') $$,
  $$ VALUES ('2026-08-10 00:00:00+00'::timestamptz, '2026-08-17 00:00:00+00'::timestamptz) $$,
  'weekly period is the preceding completed Mon-Sun week, not the trigger day''s own week'
);

-- Monthly: 2026-09-01 09:00 UTC -> [2026-08-01 00:00, 2026-09-01 00:00)
SELECT results_eq(
  $$ SELECT period_start, period_end FROM public._wafi147b_expected_period('monthly-health', '2026-09-01 09:00:00+00') $$,
  $$ VALUES ('2026-08-01 00:00:00+00'::timestamptz, '2026-09-01 00:00:00+00'::timestamptz) $$,
  'monthly period is the previous full calendar month'
);

SELECT throws_ok(
  $$ SELECT * FROM public._wafi147b_expected_period('employee-summary', '2026-08-20 00:00:00+00') $$,
  NULL, NULL,
  'employee-summary has no wall-clock cadence and is rejected'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_period_semantics.test.sql`
Expected: Should already PASS given Task 4's `_wafi147b_expected_period` implementation — if any assertion fails, the boundary math in Task 4 has a bug; fix `_wafi147b_expected_period` (not this test) before proceeding.

- [ ] **Step 3: If a failure surfaced, fix `_wafi147b_expected_period` in a follow-up migration**

Only needed if Step 2 failed. Skip if all 4 assertions passed.

- [ ] **Step 4: Confirm all pass**

Run: `psql "$SUPABASE_DB_URL" -f supabase/tests/wafi147b_period_semantics.test.sql`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/wafi147b_period_semantics.test.sql
git commit -m "test(WAFI-147B): add period-semantics boundary tests"
```

---

### Task 8: pg_cron job scheduling

**Files:**
- Create: `supabase/migrations/105_wafi147b_cron_jobs.sql`

**Interfaces:**
- Consumes: `public.generate_scheduled_reports(text, timestamptz)` (Task 5).

- [ ] **Step 1: Manually verify the target Supabase project's pg_cron availability and role permissions** (per design spec's deployment prerequisite — this cannot be pgTAP-tested in this sandbox; no live Supabase instance is reachable here, same limitation as WAFI-150/151/143)

Run against the actual target Supabase project (not in this session):
```sql
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
-- If not present: CREATE EXTENSION IF NOT EXISTS pg_cron;
SHOW cron.timezone; -- must be UTC; if not and cron.timezone is settable, set it; if the
                     -- managed project forbids changing it, offset the schedules below to compensate
SELECT rolname FROM pg_roles WHERE rolcanlogin; -- confirm which role can own/schedule cron jobs
```
Record the confirmed role name; use it in place of `<scheduler_role>` in Step 3 below.

- [ ] **Step 2: Create the dedicated trusted role (if it doesn't already exist)**

```sql
-- Run manually against the target project, adjust name/password per your
-- project's actual role-management conventions -- this is environment setup,
-- not something a migration file should embed a password into.
-- CREATE ROLE wafi147b_scheduler NOLOGIN;
-- GRANT EXECUTE ON FUNCTION public.generate_scheduled_reports(text, timestamptz) TO wafi147b_scheduler;
```

- [ ] **Step 3: Write the migration scheduling the three jobs**

```sql
-- supabase/migrations/105_wafi147b_cron_jobs.sql
-- WAFI-147B. Three fixed UTC schedules per the design spec's Schedule scope
-- table. cron.schedule's fifth argument (grant_permission / job owner) --
-- consult the actual pg_cron version's schedule() signature on the target
-- project; older/newer pg_cron releases differ on whether a role is passed
-- positionally, via cron.schedule_in_database, or via a separate grant --
-- verify against Step 1's findings before applying.

SELECT cron.schedule(
  'wafi147b_daily_reports',
  '0 0 * * *', -- 00:00 UTC daily
  $$ SELECT public.generate_scheduled_reports('daily') $$
);

SELECT cron.schedule(
  'wafi147b_weekly_reports',
  '0 9 * * 0', -- Sunday 09:00 UTC
  $$ SELECT public.generate_scheduled_reports('weekly') $$
);

SELECT cron.schedule(
  'wafi147b_monthly_reports',
  '0 9 1 * *', -- 1st of month 09:00 UTC
  $$ SELECT public.generate_scheduled_reports('monthly') $$
);
```

- [ ] **Step 4: Verify against the live project (manual, not automatable in this sandbox)**

After applying to a real Supabase project:
```sql
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE 'wafi147b_%';
-- Wait for (or manually trigger) one run, then:
SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'wafi147b_%') ORDER BY start_time DESC LIMIT 5;
```
Expected: 3 jobs listed with the correct schedules; `job_run_details` shows `succeeded` after a run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/105_wafi147b_cron_jobs.sql
git commit -m "feat(WAFI-147B): schedule daily/weekly/monthly pg_cron report generation jobs"
```

---

### Task 9: Client-side canonical period computation (`snapshotLookup.ts`)

**Files:**
- Create: `src/features/reports/snapshotLookup.ts`
- Test: `src/features/reports/__tests__/snapshotLookup.test.ts`

**Interfaces:**
- Consumes: `ReportId`, `ReportDateRange` (`report.types.ts`).
- Produces: `expectedPeriodUtc(reportId: ReportId, scheduledFor: Date): { periodStart: Date; periodEnd: Date }` — the client-side implementation of the exact same rule as `_wafi147b_expected_period` (Task 4), used by Task 10's read path. This is the ONE function the cross-runtime parity tests (Task 11) check against the server function.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/reports/__tests__/snapshotLookup.test.ts
import { describe, it, expect } from 'vitest'
import { expectedPeriodUtc } from '../snapshotLookup'

describe('expectedPeriodUtc', () => {
  it('daily: previous UTC calendar day', () => {
    const { periodStart, periodEnd } = expectedPeriodUtc('cash-flow', new Date('2026-08-20T00:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-08-20T00:00:00.000Z')
  })

  it('weekly: preceding completed Mon-Sun week, not the trigger day\'s own week', () => {
    const { periodStart, periodEnd } = expectedPeriodUtc('weekly-summary', new Date('2026-08-23T09:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-10T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('monthly: previous full calendar month', () => {
    const { periodStart, periodEnd } = expectedPeriodUtc('monthly-health', new Date('2026-09-01T09:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('throws for employee-summary (no wall-clock cadence)', () => {
    expect(() => expectedPeriodUtc('employee-summary', new Date('2026-08-20T00:00:00Z'))).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/reports/__tests__/snapshotLookup.test.ts`
Expected: FAIL — `Cannot find module '../snapshotLookup'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/features/reports/snapshotLookup.ts
// WAFI-147B. The canonical period-boundary computation, client side. Must
// implement the EXACT same rule as the server's _wafi147b_expected_period
// (supabase/migrations/102_wafi147b_generate_report_snapshot.sql) -- neither
// side may invent its own notion of "week" or "month" independent of the
// design spec's Period semantics. Verified against the server via
// cross-runtime parity tests (Task 11), not via shared code -- PL/pgSQL and
// TypeScript are different runtimes and cannot literally share a function.
import type { ReportId } from './report.types'

const DAILY: ReportId[] = ['daily-closing', 'cash-flow']
const WEEKLY: ReportId[] = ['weekly-summary', 'inventory-health', 'discount-report', 'returns-report', 'credit-report', 'dead-stock']
const MONTHLY: ReportId[] = ['monthly-health', 'profit-trend', 'top-customers', 'top-products']

function cadenceFor(reportId: ReportId): 'daily' | 'weekly' | 'monthly' {
  if (DAILY.includes(reportId)) return 'daily'
  if (WEEKLY.includes(reportId)) return 'weekly'
  if (MONTHLY.includes(reportId)) return 'monthly'
  throw new Error(`${reportId} has no wall-clock cadence (not a 147B-scheduled report type)`)
}

export function expectedPeriodUtc(reportId: ReportId, scheduledFor: Date): { periodStart: Date; periodEnd: Date } {
  const cadence = cadenceFor(reportId)
  const s = scheduledFor

  if (cadence === 'daily') {
    const periodEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
    const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000)
    return { periodStart, periodEnd }
  }

  if (cadence === 'weekly') {
    const dayStart = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
    const periodStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
    const periodEnd = new Date(dayStart.getTime() + 1 * 24 * 60 * 60 * 1000)
    return { periodStart, periodEnd }
  }

  // monthly
  const periodEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1))
  const periodStart = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1))
  return { periodStart, periodEnd }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/snapshotLookup.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/snapshotLookup.ts src/features/reports/__tests__/snapshotLookup.test.ts
git commit -m "feat(WAFI-147B): add client-side canonical period computation"
```

---

### Task 10: PowerSync sync rules and client schema for the two new tables

**Files:**
- Modify: `powersync.yaml`
- Modify: `src/data/powersync/schema.ts`

**Interfaces:**
- Produces: two new synced tables reachable from `db.getAll`/`db.getOptional` (existing PowerSync client, per `dailyClosing.ts`'s usage pattern).

- [ ] **Step 1: Add the `generated_reports` bucket to `powersync.yaml`**

This is explicitly flagged in the design spec as a first-of-its-kind sync rule for this codebase — every existing bucket filters by shop scope only; this is the first one additionally filtering by a permission. Find the existing `profit_cache` bucket definition in `powersync.yaml` (around the line already checked: `# WAFI-153: profit_cache, same pattern as daily_event_counts above.`) and add immediately after it:

```yaml
      # WAFI-147B: generated_reports, additionally filtered by can_view_reports --
      # unlike every other bucket in this file, which is shop-scope only. This is
      # the first permission-filtered sync rule in this codebase; verify this
      # actually restricts sync correctly against a real device/session before
      # relying on it (design spec "Read authorization").
      - SELECT gr.* FROM public.generated_reports gr
          JOIN public.shops sh ON sh.id = gr.shop_id AND sh.owner_user_id = auth.user_id()
          JOIN public.staff st ON st.shop_id = gr.shop_id AND st.id = auth.parameters() ->> 'staff_id'
          WHERE st.role = 'owner' OR (st.permissions ->> 'can_view_reports')::boolean IS TRUE

      # WAFI-147B: generated_report_staff_sections -- owner-only, raw role check
      # (NOT the can_view_reports flag above). See design spec's explicit
      # correction: permissionsForRole() does not trust the stored permissions
      # blob for can_view_staff_performance on non-owners, so this sync rule
      # must not either -- hence a role check, not a permissions-blob read.
      - SELECT grs.* FROM public.generated_report_staff_sections grs
          JOIN public.shops sh ON sh.id = grs.shop_id AND sh.owner_user_id = auth.user_id()
          JOIN public.staff st ON st.shop_id = grs.shop_id AND st.id = auth.parameters() ->> 'staff_id'
          WHERE st.role = 'owner'
```

**Verify at implementation time** whether PowerSync sync-rule SQL in this project's actual PowerSync version supports `auth.parameters()` for a client-supplied staff id, or whether staff identity must be resolved a different way (e.g. a separate per-device session table) — this codebase's existing sync rules (checked directly) never needed to resolve anything beyond `auth.user_id()`, so this is genuinely new ground; consult PowerSync's current sync-rules documentation for the project's actual SDK version before finalizing this step, and do not assume the syntax above is correct without testing it against a real synced client.

- [ ] **Step 2: Add both tables to the client schema**

```typescript
// src/data/powersync/schema.ts -- add alongside the existing profit_cache Table definition
const generated_reports = new Table({
  id: column.text,
  shop_id: column.text,
  report_type: column.text,
  period_start: column.text,
  period_end: column.text,
  scheduled_for: column.text,
  generated_at: column.text,
  report_schema_version: column.integer,
  report_data: column.text, // jsonb arrives as a JSON string; JSON.parse at the read site
})

const generated_report_staff_sections = new Table({
  id: column.text,
  generated_report_id: column.text,
  shop_id: column.text,
  section_data: column.text,
})
```

Register both in the schema's exported table map alongside the existing entries (follow the exact pattern already used for `profit_cache` in this same file).

- [ ] **Step 3: Manually verify sync end-to-end against a real device** (not automatable in this sandbox — no live PowerSync/Supabase instance reachable, same recurring limitation noted throughout this codebase's WAFI-150/151/143 history)

After Task 8's cron jobs have generated at least one real snapshot on a test project: confirm an owner device receives both tables' rows, and a manager/cashier device receives `generated_reports` rows (if `can_view_reports` granted) but zero `generated_report_staff_sections` rows regardless of their `can_view_reports` grant.

- [ ] **Step 4: N/A — no automated test for this step; covered by Task 11's exposure test description and the manual verification above**

- [ ] **Step 5: Commit**

```bash
git add powersync.yaml src/data/powersync/schema.ts
git commit -m "feat(WAFI-147B): sync generated_reports and generated_report_staff_sections"
```

---

### Task 11: Viewer read path — snapshot-first, staff-section composition, generated-at display

**Files:**
- Modify: `src/features/reports/report.types.ts`
- Modify: `src/features/reports/ReportDetailPage.vue`
- Create: `src/features/reports/__tests__/ReportDetailPage.snapshot.test.ts`

**Interfaces:**
- Consumes: `expectedPeriodUtc` (Task 9), synced `generated_reports`/`generated_report_staff_sections` tables (Task 10).
- Produces: `Report` type gains optional `generatedAt?: string` and `isSnapshot?: boolean` fields; `ReportDetailPage.vue`'s `generate()` checks for a snapshot before calling `compute()`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/reports/__tests__/ReportDetailPage.snapshot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import ReportDetailPage from '../ReportDetailPage.vue'

vi.mock('@/data/powersync/db', () => ({
  db: {
    getOptional: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
  },
}))

describe('ReportDetailPage snapshot-first read path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders snapshot data with a generated-at timestamp when a matching snapshot exists, without calling compute()', async () => {
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'snap-1',
      report_data: JSON.stringify({
        id: 'cash-flow', name: 'Cash Flow Report', dateRange: { from: '2026-08-19', to: '2026-08-19' },
        sections: [{ type: 'summary', title: 'Cash Flow', visibility: 'shop', metrics: [] }],
      }),
      generated_at: '2026-08-20T00:01:00.000Z',
    })

    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/reports/:reportId', component: ReportDetailPage }] })
    await router.push('/reports/cash-flow')
    const wrapper = mount(ReportDetailPage, { global: { plugins: [router] } })
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('2026-08-20')
  })

  it('falls back to live compute() with no generated-at display when no snapshot exists', async () => {
    const { db } = await import('@/data/powersync/db')
    vi.mocked(db.getOptional).mockResolvedValueOnce(undefined)

    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/reports/:reportId', component: ReportDetailPage }] })
    await router.push('/reports/cash-flow')
    const wrapper = mount(ReportDetailPage, { global: { plugins: [router] } })
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/reports/__tests__/ReportDetailPage.snapshot.test.ts`
Expected: FAIL — no `data-testid="snapshot-generated-at"` element exists yet; `compute()` is called unconditionally today

- [ ] **Step 3: Add the snapshot-sourced metadata fields to `Report`**

```typescript
// src/features/reports/report.types.ts -- extend the existing Report type
export type Report = {
  id: ReportId
  name: string
  dateRange: ReportDateRange
  generatedAt: string
  sections: ReportSection[]
  /** WAFI-147B: set only when this Report came from a persisted snapshot
   *  rather than 147A's live compute() path -- drives the "Generated at"
   *  display. Undefined (not false) for a live-computed report, so a
   *  strict `report.isSnapshot === true` check is the only place that
   *  needs to know about this at all. */
  isSnapshot?: boolean
  /** The scheduled slot this snapshot was generated for, if it differs
   *  meaningfully from generatedAt (e.g. a late-recovered report) --
   *  undefined for live-computed reports and for snapshots with no
   *  recorded scheduled_for. */
  scheduledFor?: string
}
```

- [ ] **Step 4: Add the snapshot-first check and staff-section composition to `ReportDetailPage.vue`**

```typescript
// src/features/reports/ReportDetailPage.vue -- add near the top of <script setup>,
// alongside the existing imports
import { expectedPeriodUtc } from './snapshotLookup'

// ... inside generate(), BEFORE the existing `const result = await definition.value.compute(...)` line:
async function tryLoadSnapshot(): Promise<Report | null> {
  // Snapshot lookup only applies to the 12 wall-clock report types this
  // ticket schedules -- Employee Summary (contextRequirement === 'staff')
  // has no wall-clock cadence and always falls through to live compute.
  if (needsStaffContext.value) return null

  let periodStart: Date, periodEnd: Date
  try {
    // The viewer's own selected range's end-of-day (UTC) stands in for
    // "the scheduled slot" here -- a real scheduled snapshot's period is
    // looked up by its actual stored bounds, so this only needs to compute
    // the SAME bounds a real scheduled run would have used for a period
    // ending on the selected range's `to` date.
    const asOfUtc = new Date(`${range.value.to}T00:00:00Z`)
    ;({ periodStart, periodEnd } = expectedPeriodUtc(reportId.value, asOfUtc))
  } catch {
    return null // reportId has no wall-clock cadence (shouldn't happen given the guard above, defensive)
  }

  const { shopId } = useDeviceStore()
  const snapshot = await db.getOptional<{ id: string; report_data: string; generated_at: string; scheduled_for: string | null }>(
    `SELECT id, report_data, generated_at, scheduled_for FROM generated_reports
     WHERE shop_id = ? AND report_type = ? AND period_start = ? AND period_end = ?`,
    [shopId, reportId.value, periodStart.toISOString(), periodEnd.toISOString()],
  )
  if (!snapshot) return null

  const parsed = JSON.parse(snapshot.report_data) as Report
  const staffSection = await db.getOptional<{ section_data: string }>(
    `SELECT section_data FROM generated_report_staff_sections WHERE generated_report_id = ?`,
    [snapshot.id],
  )
  // A staff-section row is present here ONLY if this device's own sync/RLS
  // actually delivered one (owner device) -- absence is a data-presence
  // fact, not a permission decision this client re-derives (design spec
  // "Read authorization"). The existing `visibleSections` filter below
  // still applies afterward as an additional UI-layer safeguard, but the
  // real security boundary already happened at the sync/RLS layer.
  const sections = staffSection
    ? [...parsed.sections, JSON.parse(staffSection.section_data)]
    : parsed.sections

  return { ...parsed, sections, isSnapshot: true, generatedAt: snapshot.generated_at, scheduledFor: snapshot.scheduled_for ?? undefined }
}

// Replace the existing `const result = await definition.value.compute(shopId, range.value, context)`
// line inside generate() with:
    const snapshotResult = await tryLoadSnapshot()
    const result = snapshotResult ?? await definition.value.compute(shopId, range.value, context)
```

- [ ] **Step 5: Add the generated-at display to the template**

```html
<!-- src/features/reports/ReportDetailPage.vue template, immediately before the
     `<template v-else-if="report">` block that renders sections -->
<p v-if="report?.isSnapshot" data-testid="snapshot-generated-at" class="state-message">
  تم إنشاء هذا التقرير في {{ new Date(report.generatedAt).toLocaleString('ar') }}
</p>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/features/reports/__tests__/ReportDetailPage.snapshot.test.ts`
Expected: PASS (2/2)

- [ ] **Step 7: Run the full existing 147A test suite to confirm no regression**

Run: `npx vitest run src/features/reports`
Expected: PASS — all pre-existing 147A tests (including `report.types.test.ts`, `dailyClosing.test.ts`, `weeklySummary.test.ts`) still pass unchanged, since `isSnapshot`/`scheduledFor` are additive optional fields and the live-compute fallback path is unchanged when `tryLoadSnapshot()` returns `null`.

- [ ] **Step 8: Commit**

```bash
git add src/features/reports/report.types.ts src/features/reports/ReportDetailPage.vue src/features/reports/__tests__/ReportDetailPage.snapshot.test.ts
git commit -m "feat(WAFI-147B): snapshot-first read path with staff-section composition"
```

---

### Task 12: Cross-runtime period-parity tests (client vs. server agreement)

**Files:**
- Create: `src/features/reports/__tests__/periodParity.test.ts`

**Interfaces:**
- Consumes: `expectedPeriodUtc` (Task 9). This test's server-side counterpart is Task 7's pgTAP assertions against `_wafi147b_expected_period` — the same 3 worked examples (daily 2026-08-20, weekly 2026-08-23, monthly 2026-09-01) must appear in both files with identical expected values, so a future edit to either side that silently diverges is caught by comparing the two test files, not by one shared function (per the design spec: PL/pgSQL and TypeScript cannot literally share a function).

- [ ] **Step 1: Write the test, asserting the identical values already asserted in Task 7's pgTAP file**

```typescript
// src/features/reports/__tests__/periodParity.test.ts
// WAFI-147B. These 3 cases MUST match supabase/tests/wafi147b_period_semantics.test.sql's
// 3 assertions exactly (same input, same expected output) -- that is what
// "cross-runtime period parity" means in practice, since PL/pgSQL and
// TypeScript cannot literally share one function. If you change an expected
// value here, change it in the pgTAP file too, and vice versa.
import { describe, it, expect } from 'vitest'
import { expectedPeriodUtc } from '../snapshotLookup'

describe('cross-runtime period parity (must match wafi147b_period_semantics.test.sql)', () => {
  it('daily 2026-08-20 00:00 UTC -> [2026-08-19, 2026-08-20)', () => {
    const r = expectedPeriodUtc('cash-flow', new Date('2026-08-20T00:00:00Z'))
    expect(r.periodStart.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(r.periodEnd.toISOString()).toBe('2026-08-20T00:00:00.000Z')
  })

  it('weekly 2026-08-23 09:00 UTC -> [2026-08-10, 2026-08-17)', () => {
    const r = expectedPeriodUtc('weekly-summary', new Date('2026-08-23T09:00:00Z'))
    expect(r.periodStart.toISOString()).toBe('2026-08-10T00:00:00.000Z')
    expect(r.periodEnd.toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('monthly 2026-09-01 09:00 UTC -> [2026-08-01, 2026-09-01)', () => {
    const r = expectedPeriodUtc('monthly-health', new Date('2026-09-01T09:00:00Z'))
    expect(r.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(r.periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run test to verify it passes** (this should already pass given Task 9's implementation — it's a parity guard, not new behavior)

Run: `npx vitest run src/features/reports/__tests__/periodParity.test.ts`
Expected: PASS (3/3). If any assertion fails, `expectedPeriodUtc` has drifted from `_wafi147b_expected_period` — fix whichever side is wrong against the design spec's Period semantics section, the source of truth for both.

- [ ] **Step 3: Commit**

```bash
git add src/features/reports/__tests__/periodParity.test.ts
git commit -m "test(WAFI-147B): add cross-runtime period-parity guard"
```

---

## Explicitly out of scope for this plan (per the design spec's own Non-goals / follow-up tickets)

- Per-shop configurable schedules
- Shop-local timezone-correct scheduling (v1 is UTC-only)
- The shift-close event trigger for Daily Closing / Employee Summary
- Snapshot correction/regeneration for late-arriving data
- Automatic missed-slot detection/catch-up
- WAFI-147C (WhatsApp delivery)

Do not implement any of the above as part of this plan; each requires its own ticket per the design spec.
