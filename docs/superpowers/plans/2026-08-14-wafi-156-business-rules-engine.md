# WAFI-156 — Business Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize WAFI-145's Large Return and Drawer Variance notification rules into a data-driven, owner-configurable rule engine (`business_rules` + `rule_action_log` + `execute_rule_action()` RPC + `update_business_rule()` RPC + a shared per-event-type durable subscriber), while leaving the other 7 WAFI-145 rules native and unchanged.

**Architecture:** A shared `runDurableSubscriber` per event type (`sale.returned`, `shift.closed`) loads every *enabled* `business_rules` row for that event type and calls the `authenticated`-callable `execute_rule_action(event_id, rule_id)` RPC for each, unconditionally — no client-side condition pre-filter (spec §2.2 correction: `business_rules` is synced config that can be stale on a given device, so a local match/no-match gate could silently suppress a real notification). The RPC is the sole evaluator and the actual trust boundary: it re-derives the event's shop/type, re-evaluates the rule's `field`/`transform`/`operator`/`threshold` against the authoritative event row itself, and only then does an atomic claim (`rule_action_log`, keyed `(event_id, rule_id, action)`, `ON CONFLICT ... WHERE executed_at IS NULL`) + `notifications` insert in one transaction.

**Tech Stack:** Vue 3 + TypeScript (Vitest), Postgres/Supabase (pgTAP), PowerSync (client-local SQLite sync).

**Spec:** `docs/superpowers/specs/2026-08-14-wafi-156-business-rules-engine-design.md` (6 review passes; read in full before starting — this plan implements it verbatim, including the corrected `execute_rule_action` security model in its §2.3).

## Implementation Status (2026-08-18)

All 12 tasks implemented on branch `worktree-wafi-156-business-rules-engine` (12 feature/test/docs commits + 1 whole-branch-review fix commit, `cd9fcd2..f94fb31`). Individual step checkboxes below are left unchecked (not maintained live during this pass) — this table is the authoritative status.

| Task | Status | Notes |
|---|---|---|
| 1. `business_rules` table | ✅ Done | Migration `092`. |
| 2. `rule_action_log` table | ✅ Done | Migration `093`. Zero client-reachable path confirmed by whole-branch review. |
| 3. `execute_rule_action()` RPC | ✅ Done, then hardened | Migration `094`, then `097` (whole-branch review fix: scoped event/rule lookups to `auth_shop_id()` to close a cross-shop id-enumeration oracle). pgTAP suite + concurrency script written, unexecuted (no Docker in this sandbox). |
| 4. `update_business_rule()` RPC | ✅ Done, then hardened | Migration `095`, then `098` (whole-branch review fix: reject negative/NaN threshold server-side, not just via the client's bypassable `min="0"`). |
| 5. Bootstrap provisioning | ✅ Done | Migration `096`, one line added to the verified-current `bootstrap_owner_identity()` body. |
| 6. Client types + PowerSync schema | ✅ Done | `businessRules.types.ts`, `schema.ts`, `powersync.yaml`. |
| 7. `loadEnabledRules` + subscriber | ✅ Done | No `ruleEvaluator.ts` written, per the plan's own §2.2 correction. |
| 8. Wire into `App.vue`, retire native rules | ✅ Done | `largeReturn.rule.ts`/`drawerVariance.rule.ts` and their tests deleted; no leftover references. |
| 9. Event contract test coverage | ✅ Done | `DATA_DRIVEN_RULE_EVENT_TYPES` added to the consumer-completeness check. |
| 10. `RulesScreen.vue` | ✅ Done | Route reuses the structurally-owner-only `can_view_staff_performance` flag (WAFI-018 precedent) rather than a new permission. Manual on-device pass (Step 8) NOT performed — no running dev instance in this session. |
| 11. Documentation | ✅ Done | Domain Interaction Matrix, `SIGNALS.md`, `EVENT_SUBSCRIBERS.md`, final-review checklist block. |
| 12. Full-suite verification + review | ✅ Done | `vue-tsc -b` clean; vitest full suite shows the same pre-existing failures as base `main` (confirmed via `git stash`), no regressions. `superpowers:requesting-code-review` run: no Critical findings, 2 Important findings both fixed (see Task 3/4 rows above). pgTAP suites and the concurrency script (`scripts/testing/wafi156-concurrent-rpc-test.mjs`) remain unexecuted — **no Docker daemon in this sandbox**, the same recurring limitation as WAFI-150/143/151. |

**Outstanding before this is production-verified:**
- Run all `supabase/tests/wafi156_*.test.sql` pgTAP suites + `wafi156-concurrent-rpc-test.mjs` against a real local Postgres.
- Manual on-device pass: owner can view/edit both proof rules and it persists; a non-owner staff account cannot reach `/settings/rules`.
- Apply migrations `092`-`098` to production and merge this branch.

## Global Constraints

- No `service_role`-only RPCs reachable only from a nonexistent backend — every RPC in this ticket is `authenticated`-callable and self-defending (spec §2.3, corrected 6th pass).
- `events.type` (not `event_type`) and `events.payload` is `text` holding JSON (cast to `jsonb` before use) — confirmed against `supabase/migrations/074_events_bus_core.sql`.
- `business_rules` vocabulary is closed: `transform IN ('none','abs')`, `operator IN ('gt','gte','lt','lte','eq')`, `action = 'notify_owner'` — enforced by `CHECK` constraints, not convention.
- Owner-editable columns are exactly `name`/`threshold`/`enabled`; every other column is system-controlled and never accepted as an RPC parameter.
- Migrations are additive/forward-only (repo convention) — every `CREATE TABLE`/`ALTER TABLE`/`CREATE OR REPLACE FUNCTION` uses `IF NOT EXISTS`/`CREATE OR REPLACE` for idempotent re-runs, matching `069_bootstrap_owner_identity.sql`'s established style.
- `rule_action_log` is never added to `powersync.yaml` and never added to `schema.ts` — it has no client sync surface at all (spec §2.3).
- Follow the migration numbering convention: check the latest applied migration number in `supabase/migrations/` immediately before Task 1 (this plan assumes migrations start at `086`; **the implementer must verify the actual next-free number first** and shift all migration filenames below accordingly if it differs).

---

### Task 1: `business_rules` table — schema, RLS, seed for existing shops

**Files:**
- Create: `supabase/migrations/086_wafi156_business_rules.sql`
- Test: `supabase/tests/wafi156_business_rules.test.sql`

**Interfaces:**
- Produces: table `public.business_rules(id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled, updated_at)`, unique on `(shop_id, rule_key)`, RLS `SELECT`-only for `authenticated` scoped by `auth_shop_id()`, no `INSERT`/`UPDATE`/`DELETE` grants to `authenticated`/`anon`. Seeded with `large_return`/`drawer_variance` rows for every existing shop.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/086_wafi156_business_rules.sql
-- WAFI-156: data-driven business rule definitions. Policy data, not runtime
-- infrastructure -- see docs/superpowers/specs/2026-08-14-wafi-156-business-rules-engine-design.md §2.1.
-- Deliberately NOT merged into notification_settings (delivery/preference vs.
-- policy definition -- see spec §2.1).

CREATE TABLE IF NOT EXISTS public.business_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  rule_key    text NOT NULL,
  name        text NOT NULL,
  event_type  text NOT NULL,
  field       text NOT NULL,
  transform   text NOT NULL CHECK (transform IN ('none', 'abs')),
  operator    text NOT NULL CHECK (operator IN ('gt', 'gte', 'lt', 'lte', 'eq')),
  threshold   numeric NOT NULL,
  action      text NOT NULL CHECK (action = 'notify_owner'),
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, rule_key)
);

CREATE INDEX IF NOT EXISTS business_rules_shop_event_type_idx
  ON public.business_rules (shop_id, event_type) WHERE enabled = true;

ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_rules_select_own_shop ON public.business_rules;
CREATE POLICY business_rules_select_own_shop ON public.business_rules
  FOR SELECT
  USING (shop_id = (SELECT public.auth_shop_id()));

-- Deliberately no INSERT/UPDATE/DELETE policy for authenticated -- per spec §2.1,
-- all writes go through update_business_rule() (Task 4) or this migration's own
-- seed statement below. No grant, no policy, means no path at all.
REVOKE ALL ON public.business_rules FROM authenticated, anon;
GRANT SELECT ON public.business_rules TO authenticated;

-- Idempotent seed shared by (a) this migration's one-time backfill for shops
-- that already exist, and (b) bootstrap_owner_identity()'s per-new-shop
-- provisioning (Task 5) -- both call the same INSERT shape so "what the
-- canonical rules are" has exactly one definition (spec §2.1).
CREATE OR REPLACE FUNCTION public.seed_business_rules_for_shop(p_shop_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled)
  VALUES
    (p_shop_id, 'large_return',    'إرجاع كبير',        'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', true),
    (p_shop_id, 'drawer_variance', 'فرق في الصندوق',    'shift.closed',  'variance',        'abs',  'gt', 15,  'notify_owner', true)
  ON CONFLICT (shop_id, rule_key) DO NOTHING;
$$;

-- Backfill: every shop that exists right now gets both proof rules.
DO $$
DECLARE v_shop record;
BEGIN
  FOR v_shop IN SELECT id FROM public.shops LOOP
    PERFORM public.seed_business_rules_for_shop(v_shop.id);
  END LOOP;
END;
$$;
```

- [ ] **Step 2: Write the pgTAP test file (RLS/authorization + seed shape)**

```sql
-- supabase/tests/wafi156_business_rules.test.sql
BEGIN;
SELECT plan(6);

-- Setup: one shop, one authenticated user mapped to it (follow the existing
-- pgTAP fixture convention used by wafi122_role_enforcement.test.sql / other
-- suites in this directory for creating a fake auth.users + shops row and
-- setting request.jwt.claims for the test session).

-- 1. Seed produced exactly 2 rows for a fresh shop.
SELECT is(
  (SELECT count(*)::int FROM public.business_rules WHERE shop_id = '<test-shop-id>'),
  2,
  'seed_business_rules_for_shop creates exactly the 2 proof rules'
);

-- 2. rule_key uniqueness enforced per shop.
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('<test-shop-id>', 'large_return', 'dup', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 1, 'notify_owner') $$,
  '23505',
  'duplicate rule_key per shop is rejected by UNIQUE (shop_id, rule_key)'
);

-- 3-5. Closed-vocabulary CHECK constraints reject out-of-enum values.
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('<test-shop-id>', 'bad_transform', 'x', 'sale.returned', 'refundAmountUsd', 'sqrt', 'gt', 1, 'notify_owner') $$,
  '23514', 'transform outside (none, abs) rejected by CHECK'
);
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('<test-shop-id>', 'bad_operator', 'x', 'sale.returned', 'refundAmountUsd', 'none', 'contains', 1, 'notify_owner') $$,
  '23514', 'operator outside the closed enum rejected by CHECK'
);
SELECT throws_ok(
  $$ INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action)
     VALUES ('<test-shop-id>', 'bad_action', 'x', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 1, 'create_task') $$,
  '23514', 'action other than notify_owner rejected by CHECK'
);

-- 6. authenticated role has no direct write grant at all.
SET ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.business_rules SET threshold = 999 WHERE rule_key = 'large_return' $$,
  '42501',
  'authenticated role cannot UPDATE business_rules directly (permission denied, not RLS-filtered)'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the migration and test against a disposable/local Postgres**

Run: `npx supabase db reset` (or the project's established disposable-project pattern from prior WAFI-15x work) then `npx supabase test db`
Expected: `086_wafi156_business_rules.sql` applies cleanly; `wafi156_business_rules.test.sql` — 6/6 pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/086_wafi156_business_rules.sql supabase/tests/wafi156_business_rules.test.sql
git commit -m "feat(WAFI-156): add business_rules table, RLS, closed-vocabulary constraints, existing-shop seed"
```

---

### Task 2: `rule_action_log` table — server-only execution ledger

**Files:**
- Create: `supabase/migrations/087_wafi156_rule_action_log.sql`
- Test: `supabase/tests/wafi156_rule_action_log.test.sql`

**Interfaces:**
- Consumes: `public.business_rules(id)`, `public.events(id)` (Task 1, existing).
- Produces: table `public.rule_action_log(event_id, rule_id, action, attempts, last_error, executed_at, updated_at)`, PK `(event_id, rule_id, action)`, both FKs `ON DELETE RESTRICT`, **no RLS policy, no grant to `authenticated`/`anon` at all** — every access goes through `execute_rule_action` (Task 3), which runs as the function owner under `SECURITY DEFINER`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/087_wafi156_rule_action_log.sql
-- WAFI-156: server-only execution ledger. NOT synced via PowerSync, NOT added
-- to schema.ts or powersync.yaml, NO client read/write access at all -- see
-- spec §2.3 "why this table is safe from the offline-dedup trap". The
-- Notification Center stays backed entirely by `notifications`.

CREATE TABLE IF NOT EXISTS public.rule_action_log (
  event_id    uuid NOT NULL REFERENCES public.events(id)         ON DELETE RESTRICT,
  rule_id     uuid NOT NULL REFERENCES public.business_rules(id) ON DELETE RESTRICT,
  action      text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  last_error  text,
  executed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, rule_id, action)
);

-- No RLS enable, no policy, no grant to authenticated/anon: this table has
-- zero client-reachable path. Only execute_rule_action() (SECURITY DEFINER,
-- Task 3) ever reads or writes it, running with the privileges of the
-- function's owner role, not the caller's.
REVOKE ALL ON public.rule_action_log FROM authenticated, anon, PUBLIC;
```

- [ ] **Step 2: Write the pgTAP test file (FK/RESTRICT behavior + no client access)**

```sql
-- supabase/tests/wafi156_rule_action_log.test.sql
BEGIN;
SELECT plan(3);

-- 1. authenticated role cannot SELECT rule_action_log at all.
SET ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM public.rule_action_log LIMIT 1 $$,
  '42501',
  'authenticated role has no SELECT grant on rule_action_log'
);
RESET ROLE;

-- 2. Deleting a business_rules row with a rule_action_log reference is blocked.
-- (Setup: insert a fake events row + business_rules row + rule_action_log row first.)
SELECT throws_ok(
  $$ DELETE FROM public.business_rules WHERE id = '<referenced-rule-id>' $$,
  '23503',
  'ON DELETE RESTRICT blocks deleting a business_rules row with rule_action_log history'
);

-- 3. Deleting the referenced events row is likewise blocked.
SELECT throws_ok(
  $$ DELETE FROM public.events WHERE id = '<referenced-event-id>' $$,
  '23503',
  'ON DELETE RESTRICT blocks deleting an events row with rule_action_log history'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run against disposable Postgres**

Run: `npx supabase db reset && npx supabase test db`
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/087_wafi156_rule_action_log.sql supabase/tests/wafi156_rule_action_log.test.sql
git commit -m "feat(WAFI-156): add rule_action_log server-only execution ledger, no client access"
```

---

### Task 3: `execute_rule_action()` RPC — authoritative evaluation + atomic claim

This is the security-critical task. Read spec §2.3 in full again immediately before writing this function — it has been through 3 corrective review passes and every check's ordering matters.

**Files:**
- Create: `supabase/migrations/088_wafi156_execute_rule_action.sql`
- Test: `supabase/tests/wafi156_execute_rule_action.test.sql`

**Interfaces:**
- Consumes: `public.business_rules`, `public.rule_action_log` (Tasks 1-2), `public.events`, `public.notifications` (existing), `public.auth_shop_id()` (existing, used throughout the codebase e.g. `074_events_bus_core.sql`).
- Produces: `public.execute_rule_action(p_event_id uuid, p_rule_id uuid) RETURNS text` — returns `'executed'`, `'not_matched'`, or `'already_executed'`; raises on any authorization/invariant failure. `authenticated`-callable, `anon` rejected.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/088_wafi156_execute_rule_action.sql
-- WAFI-156: the authoritative execution boundary for data-driven rules.
-- authenticated-callable (WAFI's durable subscribers run client-side, in the
-- browser -- there is no deployed backend to hold a service_role key; see
-- spec §2.3's "corrected architectural decision"), but the RPC re-evaluates
-- everything itself and never trusts the caller's own conclusion about
-- whether a rule matched.

CREATE OR REPLACE FUNCTION public.execute_rule_action(
  p_event_id uuid,
  p_rule_id  uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_event         public.events;
  v_rule          public.business_rules;
  v_payload       jsonb;
  v_field_value   numeric;
  v_transformed   numeric;
  v_matched       boolean;
  v_claim         public.rule_action_log;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found: %', p_event_id;
  END IF;

  SELECT * INTO v_rule FROM public.business_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rule not found: %', p_rule_id;
  END IF;

  -- Authorization/invariant checks, in order, BEFORE any claim/write below
  -- (spec §2.3 step 3). Each is a hard boundary, not a soft filter.
  IF public.auth_shop_id() IS NULL OR public.auth_shop_id() != v_event.shop_id THEN
    RAISE EXCEPTION 'caller does not belong to this event''s shop';
  END IF;
  IF v_event.shop_id != v_rule.shop_id THEN
    RAISE EXCEPTION 'event and rule belong to different shops';
  END IF;
  IF v_event.type != v_rule.event_type THEN
    RAISE EXCEPTION 'event type % does not match rule event_type %', v_event.type, v_rule.event_type;
  END IF;
  IF NOT v_rule.enabled THEN
    RAISE EXCEPTION 'rule % is disabled', v_rule.rule_key;
  END IF;

  -- Authoritative condition re-evaluation (spec §2.3 step 4) -- ignores
  -- whatever the client's evaluateLocally() concluded. events.payload is
  -- TEXT holding JSON (see 074_events_bus_core.sql), cast once here.
  v_payload := v_event.payload::jsonb;
  v_field_value := CASE v_rule.field
    WHEN 'refundAmountUsd' THEN (v_payload ->> 'refundAmountUsd')::numeric
    WHEN 'variance'        THEN (v_payload ->> 'variance')::numeric
    ELSE NULL
  END;
  IF v_field_value IS NULL THEN
    RAISE EXCEPTION 'unsupported or missing field % for event %', v_rule.field, p_event_id;
  END IF;

  v_transformed := CASE v_rule.transform
    WHEN 'none' THEN v_field_value
    WHEN 'abs'  THEN abs(v_field_value)
  END;

  v_matched := CASE v_rule.operator
    WHEN 'gt'  THEN v_transformed >  v_rule.threshold
    WHEN 'gte' THEN v_transformed >= v_rule.threshold
    WHEN 'lt'  THEN v_transformed <  v_rule.threshold
    WHEN 'lte' THEN v_transformed <= v_rule.threshold
    WHEN 'eq'  THEN v_transformed =  v_rule.threshold
  END;

  IF NOT v_matched THEN
    RETURN 'not_matched';
  END IF;

  -- Atomic conditional claim (spec §2.3 step 5). ON CONFLICT ... DO UPDATE
  -- takes a row lock on the conflicting row before evaluating WHERE, so a
  -- truly-concurrent second call blocks here rather than racing.
  INSERT INTO public.rule_action_log (event_id, rule_id, action, attempts, updated_at)
  VALUES (p_event_id, p_rule_id, v_rule.action, 1, now())
  ON CONFLICT (event_id, rule_id, action) DO UPDATE
    SET attempts = public.rule_action_log.attempts + 1, updated_at = now()
    WHERE public.rule_action_log.executed_at IS NULL
  RETURNING * INTO v_claim;

  IF v_claim IS NULL THEN
    RETURN 'already_executed';
  END IF;

  -- Same notifications shape as the native rules being replaced (largeReturn.rule.ts /
  -- drawerVariance.rule.ts) -- title/message text is rule-specific, kept in `name`/a
  -- small CASE here rather than a third vocabulary column, since only 2 rules exist.
  INSERT INTO public.notifications
    (id, shop_id, recipient_staff_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
  VALUES (
    gen_random_uuid(), v_event.shop_id, NULL, 'owner',
    v_rule.rule_key,
    v_rule.name,
    CASE v_rule.rule_key
      WHEN 'large_return'    THEN format('تم إرجاع مبلغ $%s', to_char(v_field_value, 'FM999999990.00'))
      WHEN 'drawer_variance' THEN format('تم رصد فرق %s$ في الوردية', to_char(v_transformed, 'FM999999990.00'))
      ELSE format('%s: %s', v_rule.name, v_transformed)
    END,
    CASE v_rule.event_type WHEN 'sale.returned' THEN 'return' WHEN 'shift.closed' THEN 'shift' END,
    v_event.entity_id,
    CASE v_rule.rule_key WHEN 'drawer_variance' THEN 'CRITICAL' ELSE 'WARNING' END,
    p_event_id, now()
  );

  UPDATE public.rule_action_log
    SET executed_at = now()
    WHERE (event_id, rule_id, action) = (p_event_id, p_rule_id, v_rule.action);

  RETURN 'executed';
END;
$$;

REVOKE ALL ON FUNCTION public.execute_rule_action(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_rule_action(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_rule_action(uuid, uuid) TO authenticated;
```

- [ ] **Step 2: Write the pgTAP test file**

Cover every case the spec's §5 calls out. Follow this suite's structure (each test independently sets up its own event/rule/shop fixtures via helper `INSERT`s at the top of its test block, matching the fixture style of `supabase/tests/wafi151_daily_event_counts_apply.test.sql` or similar prior WAFI-15x suites — read one of those first for the exact fixture-creation idiom used in this repo, e.g. how a fake `auth.users`/JWT claim is set for a test session).

```sql
-- supabase/tests/wafi156_execute_rule_action.test.sql
BEGIN;
SELECT plan(9);

-- 1. anon cannot call it at all.
SET ROLE anon;
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('<any-uuid>', '<any-uuid>') $$,
  NULL, NULL,
  'anon role cannot call execute_rule_action (no auth_shop_id to satisfy)'
);
RESET ROLE;

-- 2. Happy path: matching event/rule as the correct authenticated shop -> 'executed'.
-- (fixture: real sale.returned event with refundAmountUsd = 250, large_return rule threshold = 100)
SELECT is(
  public.execute_rule_action('<matching-event-id>', '<large-return-rule-id>'),
  'executed',
  'matching event/rule pair executes and returns executed'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE source_event_id = '<matching-event-id>'),
  1,
  'exactly one notification row created'
);

-- 3. Idempotency: calling again for the same pair returns already_executed, no 2nd notification.
SELECT is(
  public.execute_rule_action('<matching-event-id>', '<large-return-rule-id>'),
  'already_executed',
  'repeat call after success is idempotent'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE source_event_id = '<matching-event-id>'),
  1,
  'still exactly one notification row after the repeat call'
);

-- 4. Cross-shop event/rule pair rejected.
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('<shop-a-event-id>', '<shop-b-rule-id>') $$,
  NULL, NULL,
  'cross-shop event/rule pair is rejected'
);

-- 5. Caller from a different shop than the event rejected (auth_shop_id() mismatch).
-- (test session authenticated as shop B, calling against a shop A event/rule)
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('<shop-a-event-id>', '<shop-a-rule-id>') $$,
  NULL, NULL,
  'caller not belonging to the event''s shop is rejected'
);

-- 6. Same-shop but mismatched event_type (sale.returned event vs drawer_variance rule).
SELECT throws_ok(
  $$ SELECT public.execute_rule_action('<sale-returned-event-id>', '<drawer-variance-rule-id>') $$,
  NULL, NULL,
  'event_type mismatch between event and rule is rejected'
);

-- 7. Disabled rule never fires even via direct call.
-- (fixture: same shop, matching event_type, threshold would match, but enabled = false)
SELECT is(
  public.execute_rule_action('<matching-event-id-2>', '<disabled-rule-id>'),
  NULL, -- expect an exception, not a return value; adjust to throws_ok if the harness needs it
  'disabled rule is rejected even when directly targeted'
);

-- 8. Malicious-caller / authoritative-re-evaluation: below-threshold event, valid caller,
-- bypassing evaluateLocally() entirely -> not_matched, nothing written.
SELECT is(
  public.execute_rule_action('<below-threshold-return-event-id>', '<large-return-rule-id>'),
  'not_matched',
  'RPC independently re-evaluates and refuses a below-threshold event regardless of caller intent'
);
SELECT is(
  (SELECT count(*)::int FROM public.rule_action_log WHERE event_id = '<below-threshold-return-event-id>'),
  0,
  'no rule_action_log row written for a not_matched evaluation'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Write the concurrent-transaction-overlap test (separate file — pgTAP alone can't hold two open transactions in one session)**

```sql
-- supabase/tests/wafi156_execute_rule_action_concurrent.test.sql
-- pgTAP's single-session model can't express true transaction overlap; this
-- suite uses two real `psql`/pg client connections instead, run via a small
-- Node/`pg` script (same pattern this codebase already used to run pgTAP
-- suites without Docker -- see the WAFI-001 hardening verification note in
-- WAFI_Production_Readiness_Plan_v3.md's IMPLEMENTATION STATUS table).
--
-- Scenario: two connections both call
--   SELECT public.execute_rule_action('<event-id>', '<rule-id>')
-- for the SAME (event_id, rule_id) at the same instant (connection A opens
-- a transaction, pauses just after its INSERT ... ON CONFLICT claim via a
-- deliberate `pg_sleep` or advisory-lock hook inserted only for this test,
-- while connection B's call is issued concurrently).
--
-- Assert:
--   - exactly one of the two calls returns 'executed', the other returns
--     'already_executed' (never both 'executed', never both anything else)
--   - exactly one row in public.notifications for this event/rule
--   - exactly one row in public.rule_action_log for this (event_id, rule_id,
--     action) with executed_at IS NOT NULL
```

Write this as `scripts/testing/wafi156-concurrent-rpc-test.mjs` using the `pg` package (already a dependency, per the codebase's prior no-Docker pgTAP-runner precedent), opening two real client connections, issuing both `execute_rule_action` calls back-to-back without awaiting the first before issuing the second, then asserting the outcome via a follow-up query.

- [ ] **Step 4: Run all three test files against a disposable Postgres**

Run: `npx supabase db reset && npx supabase test db && node scripts/testing/wafi156-concurrent-rpc-test.mjs`
Expected: all pgTAP assertions pass; the concurrent script reports exactly one `executed` / one `already_executed`, and exactly one `notifications` row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/088_wafi156_execute_rule_action.sql supabase/tests/wafi156_execute_rule_action.test.sql supabase/tests/wafi156_execute_rule_action_concurrent.test.sql scripts/testing/wafi156-concurrent-rpc-test.mjs
git commit -m "feat(WAFI-156): add execute_rule_action RPC with authoritative re-evaluation, atomic claim, concurrency test"
```

---

### Task 4: `update_business_rule()` RPC + owner-only enforcement

**Files:**
- Create: `supabase/migrations/089_wafi156_update_business_rule.sql`
- Test: `supabase/tests/wafi156_update_business_rule.test.sql`

**Interfaces:**
- Consumes: `public.business_rules` (Task 1), `public.staff` (existing, for the owner-role check — follow the exact pattern of an existing owner-only RPC/permission check, e.g. how `can_view_staff_performance`/WAFI-018 structurally gates a capability, or how `switch_active_operator` checks `staff.role`).
- Produces: `public.update_business_rule(p_rule_id uuid, p_name text, p_threshold numeric, p_enabled boolean) RETURNS text` — `authenticated`-callable, returns `'updated'` or raises/returns `'forbidden'` for a non-owner caller.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/089_wafi156_update_business_rule.sql
-- WAFI-156: the only write path for business_rules. Structurally accepts just
-- name/threshold/enabled -- there is no code path by which this RPC can touch
-- event_type/field/transform/operator/action, because they are not parameters
-- (spec §2.1).

CREATE OR REPLACE FUNCTION public.update_business_rule(
  p_rule_id   uuid,
  p_name      text,
  p_threshold numeric,
  p_enabled   boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_rule  public.business_rules;
  v_shop  uuid;
BEGIN
  v_shop := public.auth_shop_id();
  IF v_shop IS NULL THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO v_rule FROM public.business_rules WHERE id = p_rule_id AND shop_id = v_shop;
  IF NOT FOUND THEN
    RETURN 'forbidden';
  END IF;

  -- Owner-only, same structural pattern as can_view_staff_performance (WAFI-018):
  -- checked here in the function body, not merely gated by a UI route, so a
  -- stale/tampered client-side permission can't widen who this affects.
  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE shop_id = v_shop AND id = public.auth_staff_id() AND role = 'owner' AND is_active = true
  ) THEN
    RETURN 'forbidden';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN 'invalid_name';
  END IF;

  UPDATE public.business_rules
    SET name = p_name, threshold = p_threshold, enabled = p_enabled, updated_at = now()
    WHERE id = p_rule_id;

  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.update_business_rule(uuid, text, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_business_rule(uuid, text, numeric, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_business_rule(uuid, text, numeric, boolean) TO authenticated;
```

Note: `public.auth_staff_id()` is assumed to already exist (used elsewhere for staff-scoped RPCs, e.g. operator-switch code). **Before writing this step, grep the codebase for the actual existing helper name** (`auth_staff_id()`, `auth_role()`, or however this codebase currently resolves "which staff row is the calling device operating as" — `useOperatorSwitch.ts`/`switch_active_operator` is the place to check) and use the real function name instead of assuming this one.

- [ ] **Step 2: Write the pgTAP test file**

```sql
-- supabase/tests/wafi156_update_business_rule.test.sql
BEGIN;
SELECT plan(5);

-- 1. Owner can update name/threshold/enabled.
SELECT is(
  public.update_business_rule('<large-return-rule-id>', 'إرجاع كبير جدًا', 200, false),
  'updated',
  'owner caller can update name/threshold/enabled'
);
SELECT is(
  (SELECT threshold FROM public.business_rules WHERE id = '<large-return-rule-id>'),
  200::numeric,
  'threshold actually changed'
);
SELECT is(
  (SELECT event_type FROM public.business_rules WHERE id = '<large-return-rule-id>'),
  'sale.returned',
  'event_type is untouched -- not a parameter this RPC accepts'
);

-- 2. Non-owner (cashier/manager) call is rejected.
-- (test session authenticated as a non-owner staff member of the same shop)
SELECT is(
  public.update_business_rule('<large-return-rule-id>', 'x', 1, true),
  'forbidden',
  'non-owner staff member cannot update a rule'
);

-- 3. Cross-shop rule_id rejected even for an owner of a different shop.
SELECT is(
  public.update_business_rule('<other-shops-rule-id>', 'x', 1, true),
  'forbidden',
  'owner of shop A cannot update a rule belonging to shop B'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run against disposable Postgres**

Run: `npx supabase db reset && npx supabase test db`
Expected: 5/5 pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/089_wafi156_update_business_rule.sql supabase/tests/wafi156_update_business_rule.test.sql
git commit -m "feat(WAFI-156): add update_business_rule RPC, owner-only, name/threshold/enabled only"
```

---

### Task 5: Provision `business_rules` for new shops (extend `bootstrap_owner_identity`)

**Files:**
- Create: `supabase/migrations/090_wafi156_bootstrap_business_rules.sql`
- Modify (via `CREATE OR REPLACE`, not editing history): none — this is a new migration that re-`CREATE OR REPLACE FUNCTION`s `bootstrap_owner_identity` with one added line.
- Test: `supabase/tests/wafi156_bootstrap_seeds_rules.test.sql`

**Interfaces:**
- Consumes: `public.seed_business_rules_for_shop(uuid)` (Task 1), `public.bootstrap_owner_identity` (existing, `069_bootstrap_owner_identity.sql`).

- [ ] **Step 1: Read `069_bootstrap_owner_identity.sql` in full again** (already read during spec research — re-read now, immediately before editing, per this repo's own convention of reading the file being touched before writing a change) and confirm the exact current function body to `CREATE OR REPLACE` against, since later migrations after 069 may have already modified it further (grep `supabase/migrations/*.sql` for any `CREATE OR REPLACE FUNCTION public.bootstrap_owner_identity` after 069 and use the latest version as the base).

- [ ] **Step 2: Write the migration** (this recreates the full function body from whatever the latest version is, adding one line — do not write this from the Task 1 snippet alone; copy the actual latest body found in Step 1 and insert the new line in the position shown)

```sql
-- supabase/migrations/090_wafi156_bootstrap_business_rules.sql
-- WAFI-156: extend bootstrap_owner_identity() so a freshly-bootstrapped shop
-- has its business_rules present from the same moment its owner/device rows
-- are created (spec §2.1's "Provisioning for existing and new shops") --
-- not a separate follow-up step that could be skipped or raced.
--
-- This CREATE OR REPLACE must start from the CURRENT function body (see Step 1
-- above), not from 069's original text, in case a later migration already
-- changed it.

CREATE OR REPLACE FUNCTION public.bootstrap_owner_identity(
  p_device_id  uuid,
  p_staff_id   uuid,
  p_staff_name text,
  p_pin        text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
-- ... [unchanged body from the current function, copied verbatim] ...
-- Add immediately after the existing `UPDATE public.shops SET bootstrap_completed_at = now() ...` line:
--   PERFORM public.seed_business_rules_for_shop(v_shop_id);
-- immediately before `RETURN 'success';`.
$$;

REVOKE ALL ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_identity(uuid, uuid, text, text) TO authenticated;
```

- [ ] **Step 3: Write the pgTAP test**

```sql
-- supabase/tests/wafi156_bootstrap_seeds_rules.test.sql
BEGIN;
SELECT plan(1);

-- Simulate a fresh shop signup + bootstrap call, then assert business_rules
-- has the 2 proof rows for that shop_id. Follow the exact fixture pattern
-- already used by wafi069 (or whichever existing suite covers
-- bootstrap_owner_identity today -- grep supabase/tests/ for it and reuse its
-- setup helper rather than re-deriving the auth.users/shops fixture).

SELECT is(
  (SELECT count(*)::int FROM public.business_rules WHERE shop_id = '<freshly-bootstrapped-shop-id>'),
  2,
  'bootstrap_owner_identity provisions both proof business_rules for a new shop'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run against disposable Postgres**

Run: `npx supabase db reset && npx supabase test db`
Expected: 1/1 pass, plus confirm no regression in whatever existing test suite already covers `bootstrap_owner_identity` (re-run the full `npx supabase test db` suite, not just this file).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/090_wafi156_bootstrap_business_rules.sql supabase/tests/wafi156_bootstrap_seeds_rules.test.sql
git commit -m "feat(WAFI-156): provision business_rules for new shops via bootstrap_owner_identity"
```

---

### Task 6: Client types + PowerSync schema for `business_rules`

**Files:**
- Modify: `src/services/events/domainEvent.types.ts` (add `DataDrivenRuleEventType`)
- Modify: `src/data/powersync/schema.ts` (add synced `business_rules` table — **not** `rule_action_log`)
- Modify: `powersync.yaml` (add the sync-rule query line — note per the existing WAFI-143/145 precedent, actual PowerSync-dashboard deployment of this line is a separate manual step outside this repo, same as those tickets' outstanding items)
- Create: `src/services/events/businessRules.types.ts`
- Test: `src/services/events/businessRules.types.test.ts`

**Interfaces:**
- Produces: `type DataDrivenRuleEventType = 'sale.returned' | 'shift.closed'` (exported from `domainEvent.types.ts`, extended only when a future rule adopts a new event type — spec §2.1). `interface BusinessRule { id: string; shopId: string; ruleKey: string; name: string; eventType: DataDrivenRuleEventType; field: 'refundAmountUsd' | 'variance'; transform: 'none' | 'abs'; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; threshold: number; action: 'notify_owner'; enabled: boolean }` in `businessRules.types.ts`.

- [ ] **Step 1: Add `DataDrivenRuleEventType` to `domainEvent.types.ts`**

Add near the existing `DomainEventType` union (find its exact location and follow its style):

```ts
/** WAFI-156: the finite set of event types the data-driven rule engine has a
 *  registered subscriber for. business_rules.event_type must always be a
 *  member of this set (enforced by the seed migration being the only writer
 *  of event_type, and by the event-contract test in businessRuleSubscriber.test.ts)
 *  -- adding a new value here is a deliberate vocabulary decision, not a
 *  runtime-data-only change (see the design spec §1). */
export type DataDrivenRuleEventType = 'sale.returned' | 'shift.closed'
```

- [ ] **Step 2: Write `businessRules.types.ts` and its test**

```ts
// src/services/events/businessRules.types.ts
import type { DataDrivenRuleEventType } from './domainEvent.types'

export type RuleField = 'refundAmountUsd' | 'variance'
export type RuleTransform = 'none' | 'abs'
export type RuleOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
export type RuleAction = 'notify_owner'

export interface BusinessRule {
  id: string
  shopId: string
  ruleKey: string
  name: string
  eventType: DataDrivenRuleEventType
  field: RuleField
  transform: RuleTransform
  operator: RuleOperator
  threshold: number
  action: RuleAction
  enabled: boolean
}

/** Maps a raw PowerSync/SQLite row (all-text/integer, per schema.ts convention)
 *  to a typed BusinessRule. */
export function parseBusinessRuleRow(row: {
  id: string; shop_id: string; rule_key: string; name: string; event_type: string
  field: string; transform: string; operator: string; threshold: number
  action: string; enabled: number
}): BusinessRule {
  return {
    id: row.id, shopId: row.shop_id, ruleKey: row.rule_key, name: row.name,
    eventType: row.event_type as DataDrivenRuleEventType,
    field: row.field as RuleField, transform: row.transform as RuleTransform,
    operator: row.operator as RuleOperator, threshold: row.threshold,
    action: row.action as RuleAction, enabled: row.enabled === 1,
  }
}
```

```ts
// src/services/events/businessRules.types.test.ts
import { describe, it, expect } from 'vitest'
import { parseBusinessRuleRow } from './businessRules.types'

describe('parseBusinessRuleRow', () => {
  it('maps a raw SQLite row to a typed BusinessRule', () => {
    const rule = parseBusinessRuleRow({
      id: 'r1', shop_id: 's1', rule_key: 'large_return', name: 'إرجاع كبير',
      event_type: 'sale.returned', field: 'refundAmountUsd', transform: 'none',
      operator: 'gt', threshold: 100, action: 'notify_owner', enabled: 1,
    })
    expect(rule).toEqual({
      id: 'r1', shopId: 's1', ruleKey: 'large_return', name: 'إرجاع كبير',
      eventType: 'sale.returned', field: 'refundAmountUsd', transform: 'none',
      operator: 'gt', threshold: 100, action: 'notify_owner', enabled: true,
    })
  })

  it('maps enabled: 0 to false', () => {
    const rule = parseBusinessRuleRow({
      id: 'r2', shop_id: 's1', rule_key: 'drawer_variance', name: 'فرق في الصندوق',
      event_type: 'shift.closed', field: 'variance', transform: 'abs',
      operator: 'gt', threshold: 15, action: 'notify_owner', enabled: 0,
    })
    expect(rule.enabled).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/services/events/businessRules.types.test.ts`
Expected: PASS (2/2).

- [ ] **Step 4: Add the PowerSync table to `schema.ts`**

Follow the exact style of `notification_settings` at `src/data/powersync/schema.ts:575-581`:

```ts
const business_rules = new Table({
  shop_id:    column.text,
  rule_key:   column.text,
  name:       column.text,
  event_type: column.text,
  field:      column.text,
  transform:  column.text,
  operator:   column.text,
  threshold:  column.real,
  action:     column.text,
  enabled:    column.integer,  // 0/1, same convention as notification_settings.enabled
  updated_at: column.text,
})
```

Add `business_rules,` to the schema's table list (near `notification_settings,`, per the existing list at `schema.ts:607-619`). **Do not add `rule_action_log`** — it has no client sync surface (spec §2.3).

- [ ] **Step 5: Add the sync-rule query to `powersync.yaml`**

Add, following the exact style of the existing per-shop-scoped lines:

```yaml
      # WAFI-156: business_rules config, synced so RulesScreen.vue can list/edit.
      # rule_action_log is deliberately NOT synced -- server-only execution ledger.
      - SELECT * FROM public.business_rules       WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
```

- [ ] **Step 6: Commit**

```bash
git add src/services/events/domainEvent.types.ts src/services/events/businessRules.types.ts src/services/events/businessRules.types.test.ts src/data/powersync/schema.ts powersync.yaml
git commit -m "feat(WAFI-156): add BusinessRule client types and synced business_rules PowerSync table"
```

---

### Task 7: `loadEnabledRules` + `businessRuleSubscriber.ts` (shared per-event-type subscriber, no client-side condition filter)

**Correction from an earlier version of this plan:** an earlier draft included a
`ruleEvaluator.ts`/`evaluateLocally()` client-side pre-filter step before this
task. It was removed entirely (not merged into this task, deleted) — see spec
§2.2's "Corrected: no client-side condition pre-filter in the correctness
path." WAFI is offline-first and `business_rules` is synced config that can be
stale on a given device; a local gate that concludes "doesn't match, don't
call the RPC" based on a stale threshold would silently suppress a real
notification (a missed business action), which is unacceptable — whereas an
unnecessary RPC call that the RPC correctly rejects is harmless. So: **every
enabled rule loaded for an event type gets an RPC call, unconditionally, with
no local condition check gating it.** Do not write a `ruleEvaluator.ts` file
as part of this task.

**Files:**
- Create: `src/services/events/loadEnabledRules.ts`
- Create: `src/services/events/businessRuleSubscriber.ts`
- Test: `src/services/events/businessRuleSubscriber.test.ts`

**Interfaces:**
- Consumes: `runDurableSubscriber` (existing), `BusinessRule`/`parseBusinessRuleRow` (Task 6), `db` from `@/data/powersync/db` (existing, used identically by `largeReturn.rule.ts`), `supabase` from `@/data/supabase/client` (existing, used identically by `src/data/powersync/ops.ts`/`src/features/staff/composables/useOwnerBootstrap.ts` for `.rpc()` calls).
- Produces: `function loadEnabledRules(shopId: string, eventType: DataDrivenRuleEventType): Promise<BusinessRule[]>`; `function startBusinessRuleSubscribers(shopId: string): { stop: () => void }`; `export const DATA_DRIVEN_RULE_EVENT_TYPES: DataDrivenRuleEventType[]` (mirrors `NOTIFIED_EVENT_TYPES`'s role in `notificationSubscriber.ts:88-91`, for the event-contract consumer-completeness check in Task 8).

- [ ] **Step 1: Write `loadEnabledRules.ts`**

```ts
// src/services/events/loadEnabledRules.ts
import { db } from '@/data/powersync/db'
import { parseBusinessRuleRow } from './businessRules.types'
import type { BusinessRule } from './businessRules.types'
import type { DataDrivenRuleEventType } from './domainEvent.types'

export async function loadEnabledRules(
  shopId: string,
  eventType: DataDrivenRuleEventType,
): Promise<BusinessRule[]> {
  const rows = await db.getAll<{
    id: string; shop_id: string; rule_key: string; name: string; event_type: string
    field: string; transform: string; operator: string; threshold: number
    action: string; enabled: number
  }>(
    `select id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled
     from business_rules where shop_id = ? and event_type = ? and enabled = 1`,
    [shopId, eventType],
  )
  return rows.map(parseBusinessRuleRow)
}
```

- [ ] **Step 2: Write the failing test for `businessRuleSubscriber.ts`**

```ts
// src/services/events/businessRuleSubscriber.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRunDurableSubscriber = vi.fn()
vi.mock('./runDurableSubscriber', () => ({ runDurableSubscriber: (opts: unknown) => mockRunDurableSubscriber(opts) }))

const mockLoadEnabledRules = vi.fn()
vi.mock('./loadEnabledRules', () => ({ loadEnabledRules: (...args: unknown[]) => mockLoadEnabledRules(...args) }))

const mockRpc = vi.fn()
vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }))

import { startBusinessRuleSubscribers, DATA_DRIVEN_RULE_EVENT_TYPES } from './businessRuleSubscriber'

describe('DATA_DRIVEN_RULE_EVENT_TYPES', () => {
  it('lists exactly the two supported event types', () => {
    expect(DATA_DRIVEN_RULE_EVENT_TYPES).toEqual(['sale.returned', 'shift.closed'])
  })
})

describe('startBusinessRuleSubscribers', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registers one fixed subscriber per supported event type, unconditionally', () => {
    startBusinessRuleSubscribers('shop1')
    expect(mockRunDurableSubscriber).toHaveBeenCalledTimes(2)
    expect(mockRunDurableSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscriberName: 'business-rules:sale.returned', eventType: 'sale.returned', shopId: 'shop1' }),
    )
    expect(mockRunDurableSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscriberName: 'business-rules:shift.closed', eventType: 'shift.closed', shopId: 'shop1' }),
    )
  })

  it('the sale.returned handler loads every enabled rule and calls execute_rule_action for each, unconditionally', async () => {
    mockLoadEnabledRules.mockResolvedValue([
      { id: 'rule-a', ruleKey: 'large_return' }, { id: 'rule-b', ruleKey: 'other' },
    ])
    mockRpc.mockResolvedValue({ data: 'executed', error: null })

    startBusinessRuleSubscribers('shop1')
    const saleReturnedCall = mockRunDurableSubscriber.mock.calls.find(
      ([opts]) => opts.eventType === 'sale.returned',
    )
    const handler = saleReturnedCall![0].handler
    const event = { eventId: 'e1', shopId: 'shop1', type: 'sale.returned', payload: {}, entityId: 'x', payloadVersion: 1, staffId: null, occurredAt: '' }

    await handler(event)

    expect(mockLoadEnabledRules).toHaveBeenCalledWith('shop1', 'sale.returned')
    // Called once per loaded rule, regardless of any condition -- there is no
    // local filter to suppress a call, per this task's correction above.
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledWith('execute_rule_action', { p_event_id: 'e1', p_rule_id: 'rule-a' })
    expect(mockRpc).toHaveBeenCalledWith('execute_rule_action', { p_event_id: 'e1', p_rule_id: 'rule-b' })
  })

  it('one rule RPC failure still lets sibling rule calls proceed independently', async () => {
    mockLoadEnabledRules.mockResolvedValue([
      { id: 'rule-a', ruleKey: 'large_return' }, { id: 'rule-b', ruleKey: 'other' },
    ])
    mockRpc
      .mockResolvedValueOnce({ data: null, error: new Error('boom') })
      .mockResolvedValueOnce({ data: 'executed', error: null })

    startBusinessRuleSubscribers('shop1')
    const saleReturnedCall = mockRunDurableSubscriber.mock.calls.find(
      ([opts]) => opts.eventType === 'sale.returned',
    )
    const handler = saleReturnedCall![0].handler
    const event = { eventId: 'e1', shopId: 'shop1', type: 'sale.returned', payload: {}, entityId: 'x', payloadVersion: 1, staffId: null, occurredAt: '' }

    // The whole handler call is allowed to reject (runDurableSubscriber's own
    // catch/retry-queue wraps it) -- but both rules must have been attempted.
    await handler(event).catch(() => {})

    expect(mockRpc).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/services/events/businessRuleSubscriber.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `businessRuleSubscriber.ts`**

```ts
// src/services/events/businessRuleSubscriber.ts
import { supabase } from '@/data/supabase/client'
import { runDurableSubscriber } from './runDurableSubscriber'
import { loadEnabledRules } from './loadEnabledRules'
import type { DataDrivenRuleEventType } from './domainEvent.types'
import type { DurableEvent } from './runDurableSubscriber'

/** Mirrors NOTIFIED_EVENT_TYPES's role in notificationSubscriber.ts (WAFI-157
 *  consumer-completeness convention): the finite set this subscriber group
 *  actually registers for, exported as inspectable data. */
export const DATA_DRIVEN_RULE_EVENT_TYPES: DataDrivenRuleEventType[] = ['sale.returned', 'shift.closed']

async function handleEventForType(eventType: DataDrivenRuleEventType, event: DurableEvent<unknown>): Promise<void> {
  const rules = await loadEnabledRules(event.shopId, eventType)
  // No local condition filter (spec §2.2 correction): execute_rule_action is
  // the sole evaluator, called for every enabled rule regardless of what a
  // possibly-stale local copy of the rule's threshold would suggest. Each
  // call is independent -- one rule's failure must not prevent the next
  // rule's call in this same loop from being attempted.
  const errors: unknown[] = []
  for (const rule of rules) {
    const { error } = await supabase.rpc('execute_rule_action', {
      p_event_id: event.eventId,
      p_rule_id: rule.id,
    })
    if (error) errors.push(error)
  }
  if (errors.length > 0) {
    // runDurableSubscriber's own catch/retry-queue wraps this handler --
    // rethrow (after every rule in this event has been attempted) so the
    // failure routes through the existing retry mechanism rather than being
    // silently swallowed here.
    throw errors[0]
  }
}

/**
 * One runDurableSubscriber instance per SUPPORTED event type, fixed at
 * registration time regardless of how many business_rules rows are
 * currently enabled for it (spec §2.2) -- adding a 10th rule to
 * sale.returned is a data change, not a new subscriber.
 */
export function startBusinessRuleSubscribers(shopId: string): { stop: () => void } {
  const subs = DATA_DRIVEN_RULE_EVENT_TYPES.map((eventType) =>
    runDurableSubscriber({
      subscriberName: `business-rules:${eventType}`,
      eventType,
      shopId,
      handler: (event) => handleEventForType(eventType, event),
    }),
  )
  return { stop: () => subs.forEach((s) => s.stop()) }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/services/events/businessRuleSubscriber.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/events/loadEnabledRules.ts src/services/events/businessRuleSubscriber.ts src/services/events/businessRuleSubscriber.test.ts
git commit -m "feat(WAFI-156): add loadEnabledRules and businessRuleSubscriber, unconditional per-rule RPC calls with no client-side filter"
```

---

### Task 8: Wire into `App.vue`, retire the two migrated native rules

**Files:**
- Modify: `src/App.vue` (add `startBusinessRuleSubscribers` call)
- Modify: `src/services/events/notificationSubscriber.ts` (remove Large Return / Drawer Variance registrations, update `NOTIFIED_EVENT_TYPES`)
- Delete: `src/services/notifications/rules/largeReturn.rule.ts`
- Delete: `src/services/notifications/rules/drawerVariance.rule.ts`
- Delete: `src/services/notifications/rules/largeReturn.rule.test.ts` (if it exists — confirm via glob before assuming; its assertions are superseded by Task 7's parity tests)
- Delete: `src/services/notifications/rules/drawerVariance.rule.test.ts` (same caveat)
- Test: update `src/services/events/notificationSubscriber.test.ts` if it references either removed handler (per the file's own comment at `notificationSubscriber.ts:97-102`, the discount handler must stay the LAST registration for that test's mock to keep exercising it — removing two earlier entries does not change that ordering constraint, but re-run the test to confirm).

- [ ] **Step 1: Locate and confirm existing test files for the two rules being removed**

Run: `find src/services/notifications/rules -iname "largeReturn*" -o -iname "drawerVariance*"` (or the Glob tool) to get the exact current file list before deleting anything.

- [ ] **Step 2: Remove the two registrations from `notificationSubscriber.ts`**

Delete the `handleLargeReturnEvent`/`handleDrawerVarianceEvent` imports (lines 6, 10) and their two `runDurableSubscriber({...})` entries from the `subs` array (lines 104, 108) in `startNotificationSubscribers`. Remove `'sale.returned'` from `NOTIFIED_EVENT_TYPES` **only if** no other registered subscriber in this file still needs it (check: is any remaining native rule still subscribed to `sale.returned`? From the earlier research, no — Large Return was the only `sale.returned` consumer in this file) — remove it. `'shift.closed'` **stays** in `NOTIFIED_EVENT_TYPES` (Shift Late Close still subscribes to it).

- [ ] **Step 3: Delete the two rule files and their dedicated tests**

```bash
rm src/services/notifications/rules/largeReturn.rule.ts src/services/notifications/rules/drawerVariance.rule.ts
# and whatever dedicated test files Step 1 found for them
```

- [ ] **Step 4: Add the subscriber call to `App.vue`**

Following the exact pattern at `App.vue:150` (`startNotificationSubscribers(useDeviceStore().shopId)`), add immediately after it:

```ts
import { startBusinessRuleSubscribers } from '@/services/events/businessRuleSubscriber'
// ...
startBusinessRuleSubscribers(useDeviceStore().shopId)
```

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npx vitest run && npx vue-tsc -b`
Expected: full suite passes (no leftover references to the deleted files); no new type errors. If `notificationSubscriber.test.ts` fails because it asserted the old subscriber count or referenced a removed handler, update those assertions — do not leave a stale count/reference.

- [ ] **Step 6: Manually confirm no other file imports the deleted rule files**

Run: `grep -rn "largeReturn.rule\|drawerVariance.rule" src/` (excluding this plan/spec doc) — expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add src/App.vue src/services/events/notificationSubscriber.ts
git rm src/services/notifications/rules/largeReturn.rule.ts src/services/notifications/rules/drawerVariance.rule.ts
git commit -m "feat(WAFI-156): retire native Large Return/Drawer Variance rules, wire in the data-driven subscriber"
```

---

### Task 9: Event contract test coverage (WAFI-157 convention, bidirectional)

**Files:**
- Modify: `src/services/events/__tests__/eventContractFixtures.ts` (or wherever `DORMANT_EVENTS`/consumer lists live — locate via the existing WAFI-157 file structure before editing)
- Create/modify: `src/services/events/__tests__/eventContracts.subscribers.test.ts` (add business-rules coverage alongside the existing audit/notification/projection coverage)

**Interfaces:**
- Consumes: `DATA_DRIVEN_RULE_EVENT_TYPES` (Task 7), `DataDrivenRuleEventType` (Task 6).

- [ ] **Step 1: Read the existing `eventContracts.subscribers.test.ts` in full** to find its exact consumer-completeness assertion shape (it already checks `AUDITED_EVENT_TYPES`/`NOTIFIED_EVENT_TYPES`/the three projections' event-type lists per prior research — mirror that exact pattern for `DATA_DRIVEN_RULE_EVENT_TYPES`).

- [ ] **Step 2: Write the failing test additions**

```ts
// addition to src/services/events/__tests__/eventContracts.subscribers.test.ts
import { DATA_DRIVEN_RULE_EVENT_TYPES } from '@/services/events/businessRuleSubscriber'

describe('business rule engine consumer completeness (WAFI-156)', () => {
  it('every DATA_DRIVEN_RULE_EVENT_TYPES entry is a real DomainEventType with a canonical fixture', () => {
    for (const eventType of DATA_DRIVEN_RULE_EVENT_TYPES) {
      expect(FIXTURES[eventType]).toBeDefined()
    }
  })

  // Mirror this file's existing consumer-completeness assertion here, adding
  // DATA_DRIVEN_RULE_EVENT_TYPES to whatever combined "has a consumer or is
  // dormant" check already exists, so sale.returned/shift.closed having a
  // business-rules consumer is reflected the same way audit/notification
  // consumers already are.
})
```

- [ ] **Step 3: Run to verify it fails, then wire the actual export/import and run to verify it passes**

Run: `npx vitest run src/services/events/__tests__/eventContracts.subscribers.test.ts`
Expected: fails first (missing export or assertion not yet true), then passes once `DATA_DRIVEN_RULE_EVENT_TYPES` is correctly imported and included.

- [ ] **Step 4: Commit**

```bash
git add src/services/events/__tests__/eventContracts.subscribers.test.ts
git commit -m "test(WAFI-156): add business rule engine to event contract consumer-completeness check"
```

---

### Task 10: `RulesScreen.vue` — owner-only view/edit UI

**Files:**
- Create: `src/features/settings/screens/RulesScreen.vue`
- Create: `src/features/settings/composables/useBusinessRules.ts`
- Test: `src/features/settings/composables/useBusinessRules.test.ts`
- Modify: router config (find the existing route-registration file, likely `src/router/index.ts`, and add the new route following the same owner-only gating pattern as WAFI-018's `/reports/staff`)
- Modify: Settings navigation (find wherever `NotificationSettingsScreen.vue` is linked from Settings and add a sibling link to the new screen, owner-only)

**Interfaces:**
- Consumes: `supabase` (`.rpc('update_business_rule', ...)`), `db` (PowerSync local read of the synced `business_rules` table), `BusinessRule`/`parseBusinessRuleRow` (Task 6).
- Produces: `useBusinessRules(shopId: string)` returning `{ rules: Ref<BusinessRule[]>, updateRule(ruleId: string, changes: { name: string; threshold: number; enabled: boolean }): Promise<'updated' | 'forbidden' | 'invalid_name'> }`.

- [ ] **Step 1: Write the failing test for `useBusinessRules.ts`**

```ts
// src/features/settings/composables/useBusinessRules.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...args: unknown[]) => mockGetAll(...args), watch: vi.fn() } }))

const mockRpc = vi.fn()
vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }))

import { useBusinessRules } from './useBusinessRules'

describe('useBusinessRules', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('loads and parses rules for the given shop', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'r1', shop_id: 's1', rule_key: 'large_return', name: 'إرجاع كبير', event_type: 'sale.returned', field: 'refundAmountUsd', transform: 'none', operator: 'gt', threshold: 100, action: 'notify_owner', enabled: 1 },
    ])
    const { rules, load } = useBusinessRules('s1')
    await load()
    expect(rules.value).toHaveLength(1)
    expect(rules.value[0].ruleKey).toBe('large_return')
  })

  it('updateRule calls update_business_rule with exactly name/threshold/enabled', async () => {
    mockRpc.mockResolvedValue({ data: 'updated', error: null })
    const { updateRule } = useBusinessRules('s1')
    const result = await updateRule('r1', { name: 'new name', threshold: 250, enabled: false })
    expect(mockRpc).toHaveBeenCalledWith('update_business_rule', {
      p_rule_id: 'r1', p_name: 'new name', p_threshold: 250, p_enabled: false,
    })
    expect(result).toBe('updated')
  })

  it('updateRule surfaces a forbidden result without throwing', async () => {
    mockRpc.mockResolvedValue({ data: 'forbidden', error: null })
    const { updateRule } = useBusinessRules('s1')
    expect(await updateRule('r1', { name: 'x', threshold: 1, enabled: true })).toBe('forbidden')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/settings/composables/useBusinessRules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `useBusinessRules.ts`**

```ts
// src/features/settings/composables/useBusinessRules.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import { parseBusinessRuleRow } from '@/services/events/businessRules.types'
import type { BusinessRule } from '@/services/events/businessRules.types'

export function useBusinessRules(shopId: string) {
  const rules = ref<BusinessRule[]>([])

  async function load(): Promise<void> {
    const rows = await db.getAll<Parameters<typeof parseBusinessRuleRow>[0]>(
      `select id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled
       from business_rules where shop_id = ? order by name`,
      [shopId],
    )
    rules.value = rows.map(parseBusinessRuleRow)
  }

  async function updateRule(
    ruleId: string,
    changes: { name: string; threshold: number; enabled: boolean },
  ): Promise<'updated' | 'forbidden' | 'invalid_name'> {
    const { data, error } = await supabase.rpc('update_business_rule', {
      p_rule_id: ruleId, p_name: changes.name, p_threshold: changes.threshold, p_enabled: changes.enabled,
    })
    if (error) throw error
    if (data === 'updated') await load()
    return data as 'updated' | 'forbidden' | 'invalid_name'
  }

  return { rules, load, updateRule }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/settings/composables/useBusinessRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `RulesScreen.vue`**

Follow the existing visual/structural conventions of `NotificationSettingsScreen.vue` (`src/features/settings/screens/NotificationSettingsScreen.vue`) — read it first for the page shell, RTL/i18n patterns, and PrimeVue component usage this codebase already established, then build a list of rules with editable `name`/`threshold` inputs and an `enabled` toggle per row, calling `updateRule` on save. Do not add an "add new rule" affordance (out of scope, spec §6).

- [ ] **Step 6: Add the route, owner-only gated**

In the router config, add a route (e.g. `/settings/rules`) mirroring WAFI-018's `/reports/staff` owner-only gating pattern (structurally owner-only, not merely permission-flag-gated — find and replicate that route guard's exact condition).

- [ ] **Step 7: Add the nav link from Settings, owner-only**

Find where `NotificationSettingsScreen.vue` is linked from the Settings page and add a sibling link to the new Rules screen, gated the same way as the route (so it never renders for a non-owner).

- [ ] **Step 8: Manually verify in a running dev instance**

Run: `npm run dev`, sign in as the seeded owner account, navigate to Settings → the new Rules link, confirm the two proof rules (`large_return`/`drawer_variance`) list with their seeded threshold/enabled state, edit one, save, and confirm it persists (re-navigate away and back). Then sign in as a non-owner staff account and confirm the link/route is not reachable.

- [ ] **Step 9: Commit**

```bash
git add src/features/settings/screens/RulesScreen.vue src/features/settings/composables/useBusinessRules.ts src/features/settings/composables/useBusinessRules.test.ts src/router/index.ts
git commit -m "feat(WAFI-156): add owner-only RulesScreen.vue for viewing/editing business rule thresholds"
```

---

### Task 11: Documentation — Domain Interaction Matrix, SIGNALS.md, EVENT_SUBSCRIBERS.md

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md` (Domain Interaction Matrix — add the Business Rules row per spec §4)
- Modify: `docs/architecture/SIGNALS.md` (add `sale.returned`/`shift.closed` business-rules consumer entries, matching its existing producer/consumer/notes column convention)
- Modify: `docs/architecture/EVENT_SUBSCRIBERS.md` (add `business-rules:sale.returned` / `business-rules:shift.closed` to its registered-subscribers table, noting the shared-per-event-type registration shape as a deliberate departure from the 1-subscriber-per-rule convention documented there today)

- [ ] **Step 1: Add the Domain Interaction Matrix row**

Insert into `AI_PRINCIPAL_ENGINEER_REVIEW.md`'s matrix table (exact row text already drafted and reviewed in spec §4):

```
| Business Rules (WAFI-156) | `business_rules` (synced config), `rule_action_log` (server-only, not synced) via `execute_rule_action()`/`update_business_rule()` RPCs | Events (subscribes to `sale.returned`, `shift.closed`, extensible to any `DomainEventType`), Notifications (writes `notifications` rows via the same path native rules use) | `businessRuleSubscriber.ts`, `ruleEvaluator.ts`, `loadEnabledRules.ts`, `RulesScreen.vue` composables | Notification Center (rows created by data-driven rules are indistinguishable from native-rule rows); Settings (new `RulesScreen.vue`, owner-only) |
```

- [ ] **Step 2: Copy the design-time Cross-Epic Edge-Case Checklist block into a final-review entry**

Add, next to the existing WAFI-145/WAFI-146 final-review examples in `AI_PRINCIPAL_ENGINEER_REVIEW.md`:

```
### WAFI-156 — Business Rules Engine (final review)

## Cross-Epic Edge-Case Checklist (final review)
Matrix rows re-checked after implementation: Business Rules, Notifications, Events, Sales, Cash/Shifts
Domains touched but not covered in the original spec checklist: none
```

(Fill in "none" only if true after the actual implementation — if final review surfaces a domain the design-time checklist missed, record that honestly instead, per this doc's own stated convention.)

- [ ] **Step 3: Update `SIGNALS.md` and `EVENT_SUBSCRIBERS.md`**

Add entries following each doc's existing column/table conventions — read both files' current relevant rows (for `sale.returned` and `shift.closed`) before editing, and append the business-rules consumer to each, rather than creating a duplicate section.

- [ ] **Step 4: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md docs/architecture/SIGNALS.md docs/architecture/EVENT_SUBSCRIBERS.md
git commit -m "docs(WAFI-156): update Domain Interaction Matrix, SIGNALS.md, EVENT_SUBSCRIBERS.md, final-review checklist"
```

---

### Task 12: Full-suite verification and whole-branch review prep

**Files:** none new — verification only.

- [ ] **Step 1: Run the full client test suite and type-check**

Run: `npx vitest run && npx vue-tsc -b`
Expected: full suite passes, no new type errors, no reference to the two deleted rule files anywhere.

- [ ] **Step 2: Run the full pgTAP suite against a disposable Postgres**

Run: `npx supabase db reset && npx supabase test db`
Expected: every suite passes, including all of Tasks 1-5's new tests and no regression in any pre-existing suite (especially `bootstrap_owner_identity`'s existing coverage, touched by Task 5).

- [ ] **Step 3: Run the concurrent-RPC script**

Run: `node scripts/testing/wafi156-concurrent-rpc-test.mjs`
Expected: exactly one `executed`, exactly one `already_executed`, exactly one `notifications` row (Task 3's core invariant).

- [ ] **Step 4: Manual on-device check**

Since no Docker/production Supabase access exists in an agent sandbox (the recurring limitation noted throughout WAFI-150/151/143's status entries), flag as an outstanding manual step: applying migrations 086-090 to production, and a real-browser pass confirming a genuine over-threshold return/shift-variance produces exactly one notification and that `RulesScreen.vue` correctly rejects a non-owner.

- [ ] **Step 5: Invoke `superpowers:requesting-code-review`**

Per this codebase's established workflow (every prior WAFI-1xx ticket in project memory went through a final whole-branch review before merge) — do not skip this step even though every task above already went through per-task review during `subagent-driven-development`.
