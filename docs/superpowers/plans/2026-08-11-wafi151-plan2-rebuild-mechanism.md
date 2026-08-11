# WAFI-151 Plan 2: Projection Rebuild & Event Recovery Mechanism — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the actual rebuild/recovery mechanism WAFI-151 was chartered for — deterministic replay ordering, a single-transaction server-side rebuild function + CLI for `daily_event_counts`, and a coverage-checked client-side rebuild for `local_today_revenue_projection` — proving that incremental processing and replay produce identical results for both.

**Architecture:** A new `events.sequence` (server-assigned total order) and `events.event_projection_day` (immutable, write-time day bucket) make replay deterministic and safe. A single Postgres function `rebuild_daily_event_counts_scope(shop_id, from, to)` does delete+ledger-reconciliation+replay+validate in one transaction, reusing Plan 1's `_apply_daily_event_count` per replayed event. A Node CLI wraps that function per scope. `events`/`daily_event_counts` get added to the PowerSync sync stream (shop-scoped) so a client can run a coverage-checked local rebuild of `local_today_revenue_projection` using the same event data.

**Tech Stack:** Postgres/Supabase migrations (SQL, PL/pgSQL), pgTAP, Node/TypeScript CLI (`scripts/projections/rebuild.ts`), PowerSync sync-rule YAML, Vitest.

## Global Constraints

- Migration numbering: latest existing migration is `083_daily_event_counts_atomic_increment.sql` (Plan 1). This plan's migration is `084_events_sequence_and_projection_day.sql`. If another migration claims `084` first, renumber before applying.
- Everything in this plan assumes Plan 1 is merged: `apply_daily_event_count`/`_apply_daily_event_count` (migration 083), `projection_processed_events` ledger, and the `daily_event_counts` grant revocation already exist.
- `sequence` orders replay; it is never used to decide whether to skip an event — skip decisions are keyed on `(projection_name, event_id)` in the ledger. Do not reintroduce a high-water-mark check anywhere in this plan.
- `event_projection_day` is the immutable, write-time day bucket (shop-local date at write time). It is computed once, at insert, and never re-derived at replay time. `daily_event_counts.day` and all replay/rebuild logic use this column exclusively — never `occurred_at`.
- Rebuild is one Postgres function invoked once per scope, never a client-side loop of per-event RPC calls (a loop cannot provide all-or-nothing rollback).
- Lock granularity is shop+projection (`pg_advisory_xact_lock(hashtext('daily_event_counts' || shop_id::text))`) — the same lock Plan 1's `apply_daily_event_count` already takes. Do not introduce a per-day lock.
- Monetary values in `local_today_revenue_projection` (`revenue_usd`, `revenue_syp`) are currently stored as `column.real` (floating point) in `src/data/powersync/schema.ts` — this predates this plan and contradicts the spec's stated "integer minor units, never floating point" principle. **Fixing this is out of scope for this plan** (it would mean a schema-wide currency-representation migration touching far more than this projection). Where this plan's contract tests compare Postgres and SQLite computed revenue, use fixture amounts that don't expose float-rounding edge cases (whole-cent USD/SYP values), and note this as a known limitation, not something to silently work around with non-representative test data.
- Never commit with `--no-verify` or skip hooks. Follow existing code patterns (see Plan 1's migration and `ops.ts` special-case for the established style).

---

### Task 1: Migration 084 — `events.sequence`, `events.event_projection_day`, update Plan 1's apply function

**Files:**
- Create: `supabase/migrations/084_events_sequence_and_projection_day.sql`

**Interfaces:**
- Produces: `events.sequence BIGINT NOT NULL UNIQUE`, `events.event_projection_day DATE NOT NULL`, index `events_shop_projection_day_sequence_idx ON events (shop_id, event_projection_day, sequence)`. Updates `public._apply_daily_event_count` (from migration 083) to use `v_event.event_projection_day` instead of computing day from `occurred_at`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/084_events_sequence_and_projection_day.sql

-- WAFI-151 Plan 2. Two new columns on events, both required for deterministic,
-- rebuild-safe replay (see design spec "Canonical Replay Ordering"):
--
-- sequence: events.id is a UUID with no monotonic order. occurred_at is a
-- business timestamp that can collide/skew for offline-authored events and
-- must never be used to order replay. sequence gives a stable total order --
-- NOT a claim of true commit/causal order (allocation can precede commit
-- under concurrent transactions), just unique + stable + total, which is all
-- replay determinism requires. Skip decisions remain keyed on event ID via
-- the existing projection_processed_events ledger (migration 083) -- never
-- on a sequence threshold.
--
-- event_projection_day: the immutable, write-time day bucket. Computed once
-- at insert from occurred_at + the shop's timezone at that moment, and never
-- re-derived at replay time -- so a later shop timezone change cannot
-- silently shift which day historical events replay into.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS sequence bigint;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_projection_day date;

-- Deterministic backfill for existing rows: created_at ASC, then id ASC as a
-- tiebreak for exact-duplicate timestamps. This is a canonical REPLAY order,
-- not a claim of true historical causal order -- acceptable because the two
-- projections currently in scope (daily_event_counts, local_today_revenue_projection)
-- are both commutative aggregates.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM public.events
  WHERE sequence IS NULL
)
UPDATE public.events e
SET sequence = ordered.rn + (SELECT coalesce(max(sequence), 0) FROM public.events)
FROM ordered
WHERE e.id = ordered.id;

-- event_projection_day backfill: best-available (current) shop timezone data,
-- since no historical timezone snapshot is stored. This is an accepted
-- data-quality limitation for pre-existing events -- the result is
-- deterministic and stable after backfill (which is what replay needs), not
-- a claim of historical accuracy. New rows (the trigger below) use the
-- shop's timezone in effect at event creation time.
UPDATE public.events e
SET event_projection_day = (e.occurred_at AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date
FROM public.shops s
WHERE e.shop_id = s.id AND e.event_projection_day IS NULL;

-- Any events whose shop row has no timezone match (shouldn't happen given
-- the FK, but be defensive rather than leave a NULL that the NOT NULL below
-- would reject with an opaque error): fall back to UTC.
UPDATE public.events
SET event_projection_day = (occurred_at AT TIME ZONE 'UTC')::date
WHERE event_projection_day IS NULL;

ALTER TABLE public.events ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE public.events ADD CONSTRAINT events_sequence_unique UNIQUE (sequence);
ALTER TABLE public.events ALTER COLUMN event_projection_day SET NOT NULL;

-- New events get sequence from a sequence object (simpler and equally valid
-- for "unique, stable, total" than an identity column here, since backfill
-- already assigned explicit values above) and event_projection_day computed
-- from the shop's current timezone at insert time.
CREATE SEQUENCE IF NOT EXISTS public.events_sequence_seq OWNED BY public.events.sequence;
SELECT setval('public.events_sequence_seq', (SELECT max(sequence) FROM public.events), true);
ALTER TABLE public.events ALTER COLUMN sequence SET DEFAULT nextval('public.events_sequence_seq');

CREATE OR REPLACE FUNCTION public._set_event_projection_day()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT timezone INTO v_tz FROM public.shops WHERE id = NEW.shop_id;
  NEW.event_projection_day := (NEW.occurred_at AT TIME ZONE COALESCE(v_tz, 'UTC'))::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_set_projection_day ON public.events;
CREATE TRIGGER events_set_projection_day
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public._set_event_projection_day();

CREATE INDEX IF NOT EXISTS events_shop_projection_day_sequence_idx
  ON public.events (shop_id, event_projection_day, sequence);

-- Update Plan 1's internal apply function (083) to use the now-real
-- event_projection_day instead of its occurred_at::date placeholder.
CREATE OR REPLACE FUNCTION public._apply_daily_event_count(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event public.events;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN; -- event may have been legitimately rejected upstream (e.g. rate-limited);
             -- must not raise, or this jams the sync queue (see Plan 1 final review)
  END IF;

  IF v_event.type <> 'sale.completed' THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('daily_event_counts', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  INSERT INTO public.daily_event_counts (id, shop_id, event_type, day, count, source_event_id)
  VALUES (gen_random_uuid(), v_event.shop_id, v_event.type, v_event.event_projection_day, 1, p_event_id)
  ON CONFLICT (shop_id, event_type, day)
  DO UPDATE SET count = public.daily_event_counts.count + 1;
END;
$$;

-- Design spec's Concurrency section requires a BOUNDED lock wait, not an
-- indefinite block: "on timeout, the rebuild fails fast with a clear
-- operator message rather than blocking normal writes indefinitely." Plan
-- 1's apply_daily_event_count took the lock with a bare pg_advisory_xact_lock
-- (blocks forever) -- fixing that here rather than shipping Plan 2's rebuild
-- function with a timeout while the incremental path still blocks forever,
-- which would be an inconsistent (and spec-violating) lock protocol between
-- the two callers of the same lock.
CREATE OR REPLACE FUNCTION public.apply_daily_event_count(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT shop_id INTO v_shop_id FROM public.events WHERE id = p_event_id;
  IF v_shop_id IS NULL THEN
    RETURN; -- matches _apply_daily_event_count's own not-found handling (Plan 1 final review fix)
  END IF;
  IF v_shop_id IS DISTINCT FROM (SELECT public.auth_shop_id()) THEN
    RAISE EXCEPTION 'apply_daily_event_count: caller is not authorized for this event''s shop' USING ERRCODE = 'P0001';
  END IF;

  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext('daily_event_counts' || v_shop_id::text));
  PERFORM public._apply_daily_event_count(p_event_id);
END;
$$;
```

Add a pgTAP assertion to `wafi151_events_sequence_and_projection_day.test.sql` (or a new small test file) confirming `apply_daily_event_count` still raises `P0001` for a cross-shop event and still succeeds for a legitimate same-shop call — this migration replaces the function body, so Plan 1's existing behavior must be re-verified, not just assumed to survive a `CREATE OR REPLACE`.

Check `supabase/migrations/074_events_bus_core.sql` for whether `public.shops` has a `timezone` column already — if it does not exist, add `ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';` near the top of this migration, before the backfill UPDATE statements that reference `s.timezone`, so the migration doesn't fail on a missing column.

- [ ] **Step 2: Write the pgTAP test**

Check an existing `wafi*.test.sql` file for this repo's harness pattern first, matching Plan 1's `wafi151_daily_event_counts_apply.test.sql` conventions.

```sql
-- supabase/tests/wafi151_events_sequence_and_projection_day.test.sql
BEGIN;
SELECT plan(5);

-- Mirror the harness pattern from wafi151_daily_event_counts_apply.test.sql
-- for creating a test shop and inserting events.

-- 1. New events get a sequence automatically.
INSERT INTO events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
VALUES (:'event_id_new', 'sale.completed', :'entity_id', '{}', 1, :'staff_id', :'shop_id', now(), now());
SELECT isnt(
  (SELECT sequence FROM events WHERE id = :'event_id_new'),
  NULL,
  'newly inserted event receives a non-null sequence automatically'
);

-- 2. sequence values are unique across the table (spot-check via constraint, not a full scan).
SELECT ok(
  (SELECT count(*) FROM events) = (SELECT count(DISTINCT sequence) FROM events),
  'no two events share a sequence value'
);

-- 3. event_projection_day is set automatically at insert.
SELECT isnt(
  (SELECT event_projection_day FROM events WHERE id = :'event_id_new'),
  NULL,
  'newly inserted event receives a non-null event_projection_day automatically'
);

-- 4. event_projection_day matches occurred_at's date under UTC shop timezone (default case).
INSERT INTO events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
VALUES (:'event_id_utc', 'sale.completed', :'entity_id', '{}', 1, :'staff_id', :'shop_id', '2026-08-11T23:30:00+00:00', now());
SELECT is(
  (SELECT event_projection_day FROM events WHERE id = :'event_id_utc')::text,
  '2026-08-11',
  'event_projection_day derives from occurred_at under the shop''s timezone (UTC default)'
);

-- 5. sequence is never NULL after the migration's backfill -- spot check on any pre-existing row.
SELECT ok(
  (SELECT count(*) FROM events WHERE sequence IS NULL) = 0,
  'no event in the table has a null sequence after backfill'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Apply and verify**

Apply migration `084` locally (same invocation as Plan 1's Task 1), run the pgTAP test above. If no local Postgres/Docker is available in this environment, hand-verify the SQL against `074_events_bus_core.sql`'s `shops` table definition and `083_daily_event_counts_atomic_increment.sql`'s current `_apply_daily_event_count` — this is an accepted, pre-existing limitation (see Plan 1).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/084_events_sequence_and_projection_day.sql supabase/tests/wafi151_events_sequence_and_projection_day.test.sql
git commit -m "feat(WAFI-151): add events.sequence and events.event_projection_day

Deterministic total order for replay (sequence) and an immutable,
write-time day bucket (event_projection_day) that day-buckets events
without depending on mutable shop timezone metadata at read time.
Updates Plan 1's _apply_daily_event_count to use the real column
instead of its occurred_at::date placeholder, and to no longer RAISE
on a missing event (matches the Plan 1 final-review fix)."
```

---

### Task 2: Server-side scoped rebuild function

**Files:**
- Create: `supabase/migrations/085_daily_event_counts_rebuild.sql`
- Create: `supabase/tests/wafi151_daily_event_counts_rebuild.test.sql`

**Interfaces:**
- Consumes: `_apply_daily_event_count(event_id)` from Task 1/Plan 1.
- Produces: `public.rebuild_daily_event_counts_scope(p_shop_id uuid, p_from date, p_to date) RETURNS jsonb` — client-callable (this is an engineer-invoked CLI operation, per the spec's Trigger Surface, so it is granted like other RPCs but only ever called from `scripts/projections/rebuild.ts`, never from the app). Returns a small result object (`{"rows_deleted": n, "events_replayed": n}`) for the CLI to report.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/085_daily_event_counts_rebuild.sql

-- WAFI-151 Plan 2: the actual rebuild primitive. One Postgres function per
-- scope, invoked once by the CLI -- never a client-side loop of per-event
-- RPC calls (each of those would commit independently and cannot provide
-- the all-or-nothing rollback this needs).
CREATE OR REPLACE FUNCTION public.rebuild_daily_event_counts_scope(
  p_shop_id uuid,
  p_from date,
  p_to date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_deleted integer;
  v_events_replayed integer := 0;
  v_event_id uuid;
BEGIN
  -- Same lock (and same bounded 5s timeout, matching Task 1's update to
  -- apply_daily_event_count) incremental apply already takes -- a rebuild
  -- and an incremental write for this shop's daily_event_counts can never
  -- interleave, and neither this function nor the incremental path blocks
  -- indefinitely if the other is holding it.
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext('daily_event_counts' || p_shop_id::text));

  DELETE FROM public.daily_event_counts
  WHERE shop_id = p_shop_id
    AND day BETWEEN p_from AND p_to;
  GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

  -- Reconcile the ledger for this scope too -- otherwise replayed events are
  -- rejected by _apply_daily_event_count as "already applied" and the
  -- rebuild silently no-ops.
  DELETE FROM public.projection_processed_events pe
  WHERE pe.projection_name = 'daily_event_counts'
    AND pe.event_id IN (
      SELECT id FROM public.events
      WHERE shop_id = p_shop_id AND event_projection_day BETWEEN p_from AND p_to
    );

  FOR v_event_id IN
    SELECT id FROM public.events
    WHERE shop_id = p_shop_id
      AND event_projection_day BETWEEN p_from AND p_to
    ORDER BY sequence ASC
  LOOP
    PERFORM public._apply_daily_event_count(v_event_id);
    v_events_replayed := v_events_replayed + 1;
  END LOOP;

  -- Validation: no negative counts, no row outside the requested scope, one
  -- row per (shop, day, event_type) -- the UNIQUE constraint already
  -- guarantees the last one, but check the others explicitly. Any failure
  -- here raises, which rolls back the whole function (implicit -- a
  -- function body is one transaction), leaving prior state fully intact.
  IF EXISTS (
    SELECT 1 FROM public.daily_event_counts
    WHERE shop_id = p_shop_id AND day BETWEEN p_from AND p_to AND count < 0
  ) THEN
    RAISE EXCEPTION 'rebuild_daily_event_counts_scope: negative count produced for shop %, range % to %', p_shop_id, p_from, p_to;
  END IF;

  RETURN jsonb_build_object('rows_deleted', v_rows_deleted, 'events_replayed', v_events_replayed);
END;
$$;

-- Engineer-invoked only (per design spec's Trigger Surface) -- granted so the
-- CLI can call it via supabase.rpc(), but there is no app-facing UI or code
-- path that calls this function; that boundary is enforced by not wiring it
-- into any client feature, not by withholding the grant (the caller still
-- needs to be an authenticated user with legitimate access to p_shop_id in
-- practice, but this function does not itself re-check that against
-- auth_shop_id() the way apply_daily_event_count does, since --all needs to
-- rebuild EVERY shop and an engineer's own account is not scoped to all of
-- them -- this is why it's a manually-invoked CLI operation, not something
-- ever called from the app).
GRANT EXECUTE ON FUNCTION public.rebuild_daily_event_counts_scope(uuid, date, date) TO service_role;
```

**Important design note for the implementer:** this function is granted to `service_role` only, not `anon`/`authenticated` — unlike `apply_daily_event_count`, it deliberately has no per-caller shop authorization check, because a legitimate caller (the CLI, running with a service-role key configured server-side/operator-side) needs to rebuild any shop, not just one it's a member of. The CLI (Task 3) must use a service-role Supabase client for this call, never the regular anon/authenticated client used elsewhere in the app. Do not grant this to `anon`/`authenticated` — that would let any logged-in user rebuild any other shop's data.

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/wafi151_daily_event_counts_rebuild.test.sql
BEGIN;
SELECT plan(7);

-- Mirror the harness pattern from wafi151_daily_event_counts_apply.test.sql,
-- running as service_role for calls to rebuild_daily_event_counts_scope
-- (this function has no per-caller shop check, per its design).

-- Setup: two sale.completed events for shop_id_a on 2026-08-11, one event on
-- 2026-08-12 (a different day, must NOT be touched by a rebuild scoped to
-- just 08-11), each already applied once via apply_daily_event_count so
-- there's existing state to rebuild.

-- 1. After rebuild, the day-11 row reflects exactly the 2 events for that day
--    -- and per the setup note above, that's also what incremental processing
--    (the earlier apply_daily_event_count calls) had already computed before
--    this rebuild ran. Rebuild reproducing the same value incremental
--    processing already produced, for the same event set, is the concrete
--    test for the design spec's AC #3 ("incremental and replay produce
--    identical results") -- both code paths ultimately call the same
--    _apply_daily_event_count, so this also proves there's no drift between
--    them, not just that the numbers happen to match.
SELECT rebuild_daily_event_counts_scope(:'shop_id_a', '2026-08-11', '2026-08-11');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id_a' AND day = '2026-08-11'),
  2,
  'rebuild reproduces exactly what incremental processing already computed for the same events (AC #3: incremental == replay)'
);

-- 2. The day-12 row (outside the rebuilt range) is untouched.
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id_a' AND day = '2026-08-12'),
  1,
  'rebuilding one day does not affect an unrelated day''s row'
);

-- 3. Ledger entries for day-12's event are untouched (not deleted/reconciled by the day-11 rebuild).
SELECT ok(
  (SELECT count(*) FROM projection_processed_events pe
     JOIN events e ON e.id = pe.event_id
     WHERE e.shop_id = :'shop_id_a' AND e.event_projection_day = '2026-08-12'
       AND pe.projection_name = 'daily_event_counts') = 1,
  'rebuilding one day does not affect ledger entries for an unrelated day'
);

-- 4. Re-running the same rebuild is idempotent -- same result, not doubled.
SELECT rebuild_daily_event_counts_scope(:'shop_id_a', '2026-08-11', '2026-08-11');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id_a' AND day = '2026-08-11'),
  2,
  're-running the same rebuild produces the same result, not a doubled count'
);

-- 5. A forced validation failure leaves prior state intact (rollback test).
--    Capture the exact pre-rebuild row, then call a throwaway copy of the
--    rebuild function whose validation check is forced to fail unconditionally
--    (rather than trying to engineer a real negative count through normal
--    inputs), and assert the real table is byte-for-byte unchanged afterward.
CREATE OR REPLACE FUNCTION pg_temp.rebuild_daily_event_counts_scope_force_fail(
  p_shop_id uuid, p_from date, p_to date
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.daily_event_counts WHERE shop_id = p_shop_id AND day BETWEEN p_from AND p_to;
  DELETE FROM public.projection_processed_events pe
  WHERE pe.projection_name = 'daily_event_counts'
    AND pe.event_id IN (SELECT id FROM public.events WHERE shop_id = p_shop_id AND event_projection_day BETWEEN p_from AND p_to);
  RAISE EXCEPTION 'forced failure for rollback test';
END;
$$;

SELECT row_to_json(dec.*) INTO TEMP TABLE pre_rebuild_snapshot
FROM public.daily_event_counts dec WHERE shop_id = :'shop_id_a' AND day = '2026-08-11';

SELECT throws_ok(
  format('SELECT pg_temp.rebuild_daily_event_counts_scope_force_fail(%L, %L, %L)', :'shop_id_a', '2026-08-11', '2026-08-11'),
  'P0001', 'forced failure for rollback test',
  'a forced failure after delete-but-before-commit raises as expected'
);
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id_a' AND day = '2026-08-11'),
  (SELECT (row_to_json(pre_rebuild_snapshot.*)->>'count')::integer FROM pre_rebuild_snapshot),
  'the real daily_event_counts row is completely unchanged after the forced-failure rollback -- the DELETE inside the failed call never persisted'
);

-- 6. Events whose event_projection_day is inside the range but whose
--    occurred_at falls outside it are still included -- proves relevance is
--    resolved by event_projection_day, not occurred_at (design spec AC #12).
--    event_projection_day is normally trigger-set from occurred_at at
--    insert; overwrite it explicitly afterward here to construct the case
--    where they disagree, since that's the scenario the rebuild engine must
--    handle correctly regardless of how such a row came to exist.
INSERT INTO events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
VALUES (:'event_id_crossday', 'sale.completed', :'entity_id', '{}', 1, :'staff_id', :'shop_id_a', '2026-08-05T10:00:00+00:00', now());
UPDATE events SET event_projection_day = '2026-08-11' WHERE id = :'event_id_crossday';

SELECT rebuild_daily_event_counts_scope(:'shop_id_a', '2026-08-11', '2026-08-11');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id_a' AND day = '2026-08-11'),
  3,
  'a rebuild for 2026-08-11 includes an event whose event_projection_day is 08-11 even though its occurred_at is 08-05 -- relevance is resolved by event_projection_day, never occurred_at'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Apply and verify**

Same process as Task 1, Step 3 — apply locally if possible, hand-verify otherwise.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/085_daily_event_counts_rebuild.sql supabase/tests/wafi151_daily_event_counts_rebuild.test.sql
git commit -m "feat(WAFI-151): add rebuild_daily_event_counts_scope, the server-side rebuild primitive

One function per scope, single transaction: acquires the shop+projection
lock, deletes projection rows and ledger entries for the scope, replays
relevant events by event_projection_day (not occurred_at) in sequence
order through the shared apply function, validates, and returns a
result summary. service_role only -- this operation rebuilds arbitrary
shops and is never called from the app."
```

---

### Task 3: CLI — `scripts/projections/rebuild.ts`

**Files:**
- Create: `scripts/projections/rebuild.ts`
- Create: `scripts/projections/__tests__/rebuild.test.ts`

**Interfaces:**
- Consumes: `rebuild_daily_event_counts_scope(p_shop_id, p_from, p_to)` from Task 2.
- Produces: a CLI invoked via `npm run projections:rebuild -- daily_event_counts --shop <shop_id> --from <date> --to <date>` or `npm run projections:rebuild -- daily_event_counts --all`. Exports `parseArgs(argv: string[])` and `runRebuild(args: ParsedArgs, deps: { rebuildScope: (shopId: string, from: string, to: string) => Promise<{rows_deleted: number, events_replayed: number}>, listShopIds: () => Promise<string[]> })` for testability — the real `rebuild.ts` entrypoint wires `deps` to a service-role Supabase client, but tests inject fakes.

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/projections/__tests__/rebuild.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseArgs, runRebuild } from '../rebuild'

describe('parseArgs', () => {
  it('parses a scoped rebuild (--shop --from --to)', () => {
    const args = parseArgs(['daily_event_counts', '--shop', 'shop-1', '--from', '2026-08-01', '--to', '2026-08-11'])
    expect(args).toEqual({
      projection: 'daily_event_counts', mode: 'scoped',
      shopId: 'shop-1', from: '2026-08-01', to: '2026-08-11',
    })
  })

  it('parses --all', () => {
    const args = parseArgs(['daily_event_counts', '--all'])
    expect(args).toEqual({ projection: 'daily_event_counts', mode: 'all' })
  })

  it('rejects --shop combined with --all -- ambiguous, must be explicit about scope', () => {
    expect(() => parseArgs(['daily_event_counts', '--shop', 'shop-1', '--all'])).toThrow(/cannot combine --shop and --all/)
  })

  it('rejects a scoped rebuild missing --from or --to', () => {
    expect(() => parseArgs(['daily_event_counts', '--shop', 'shop-1', '--from', '2026-08-01'])).toThrow(/--from and --to are both required/)
  })

  it('rejects an unknown projection name', () => {
    expect(() => parseArgs(['unknown_projection', '--all'])).toThrow(/unknown projection/)
  })
})

describe('runRebuild', () => {
  it('scoped mode calls rebuildScope once with the given shop/range and reports the result', async () => {
    const rebuildScope = vi.fn().mockResolvedValue({ rows_deleted: 3, events_replayed: 5 })
    const listShopIds = vi.fn()
    const results = await runRebuild(
      { projection: 'daily_event_counts', mode: 'scoped', shopId: 'shop-1', from: '2026-08-01', to: '2026-08-11' },
      { rebuildScope, listShopIds },
    )
    expect(rebuildScope).toHaveBeenCalledTimes(1)
    expect(rebuildScope).toHaveBeenCalledWith('shop-1', '2026-08-01', '2026-08-11')
    expect(listShopIds).not.toHaveBeenCalled()
    expect(results).toEqual([{ shopId: 'shop-1', status: 'success', rowsDeleted: 3, eventsReplayed: 5 }])
  })

  it('--all mode calls rebuildScope once per shop returned by listShopIds, using each shop\'s full history', async () => {
    const rebuildScope = vi.fn().mockResolvedValue({ rows_deleted: 1, events_replayed: 1 })
    const listShopIds = vi.fn().mockResolvedValue(['shop-1', 'shop-2'])
    const results = await runRebuild(
      { projection: 'daily_event_counts', mode: 'all' },
      { rebuildScope, listShopIds },
    )
    expect(rebuildScope).toHaveBeenCalledTimes(2)
    expect(rebuildScope).toHaveBeenNthCalledWith(1, 'shop-1', '0001-01-01', '9999-12-31')
    expect(rebuildScope).toHaveBeenNthCalledWith(2, 'shop-2', '0001-01-01', '9999-12-31')
    expect(results).toEqual([
      { shopId: 'shop-1', status: 'success', rowsDeleted: 1, eventsReplayed: 1 },
      { shopId: 'shop-2', status: 'success', rowsDeleted: 1, eventsReplayed: 1 },
    ])
  })

  it('--all mode: a failure on one shop does not abort or block already-completed shops', async () => {
    const rebuildScope = vi.fn()
      .mockResolvedValueOnce({ rows_deleted: 1, events_replayed: 1 })
      .mockRejectedValueOnce(new Error('validation failed'))
    const listShopIds = vi.fn().mockResolvedValue(['shop-1', 'shop-2'])
    const results = await runRebuild(
      { projection: 'daily_event_counts', mode: 'all' },
      { rebuildScope, listShopIds },
    )
    expect(results).toEqual([
      { shopId: 'shop-1', status: 'success', rowsDeleted: 1, eventsReplayed: 1 },
      { shopId: 'shop-2', status: 'failed', error: 'validation failed' },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/projections/__tests__/rebuild.test.ts`
Expected: FAIL — `rebuild.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// scripts/projections/rebuild.ts
export interface ScopedRebuildArgs {
  projection: 'daily_event_counts'
  mode: 'scoped'
  shopId: string
  from: string
  to: string
}
export interface AllRebuildArgs {
  projection: 'daily_event_counts'
  mode: 'all'
}
export type ParsedArgs = ScopedRebuildArgs | AllRebuildArgs

const KNOWN_PROJECTIONS = ['daily_event_counts'] as const

export function parseArgs(argv: string[]): ParsedArgs {
  const [projection, ...rest] = argv
  if (!KNOWN_PROJECTIONS.includes(projection as any)) {
    throw new Error(`unknown projection: ${projection}. Known projections: ${KNOWN_PROJECTIONS.join(', ')}`)
  }

  const flags = new Map<string, string | true>()
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (token === '--all') { flags.set('all', true); continue }
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const value = rest[i + 1]
      flags.set(key, value)
      i++
    }
  }

  const isAll = flags.get('all') === true
  const shopId = flags.get('shop') as string | undefined

  if (isAll && shopId) {
    throw new Error('cannot combine --shop and --all -- pick one scope mode explicitly')
  }
  if (isAll) {
    return { projection: 'daily_event_counts', mode: 'all' }
  }

  const from = flags.get('from') as string | undefined
  const to = flags.get('to') as string | undefined
  if (!shopId) {
    throw new Error('--shop is required for a scoped rebuild (or pass --all for a full rebuild)')
  }
  if (!from || !to) {
    throw new Error('--from and --to are both required for a scoped rebuild')
  }
  return { projection: 'daily_event_counts', mode: 'scoped', shopId, from, to }
}

export interface RebuildDeps {
  rebuildScope: (shopId: string, from: string, to: string) => Promise<{ rows_deleted: number; events_replayed: number }>
  listShopIds: () => Promise<string[]>
}

export interface ShopRebuildResult {
  shopId: string
  status: 'success' | 'failed'
  rowsDeleted?: number
  eventsReplayed?: number
  error?: string
}

// --all rebuilds each shop's full history ('0001-01-01' to '9999-12-31' --
// Postgres DATE's actual min/max range) as its own call, so a failure on one
// shop cannot roll back or block shops already completed. This is a batch of
// independently-transactional per-shop rebuilds, never one global transaction
// (see design spec) -- each rebuildScope() call is already one transaction
// server-side (Task 2); this loop just doesn't wrap them in anything shared.
export async function runRebuild(args: ParsedArgs, deps: RebuildDeps): Promise<ShopRebuildResult[]> {
  if (args.mode === 'scoped') {
    const result = await deps.rebuildScope(args.shopId, args.from, args.to)
    return [{ shopId: args.shopId, status: 'success', rowsDeleted: result.rows_deleted, eventsReplayed: result.events_replayed }]
  }

  const shopIds = await deps.listShopIds()
  const results: ShopRebuildResult[] = []
  for (const shopId of shopIds) {
    try {
      const result = await deps.rebuildScope(shopId, '0001-01-01', '9999-12-31')
      results.push({ shopId, status: 'success', rowsDeleted: result.rows_deleted, eventsReplayed: result.events_replayed })
    } catch (err) {
      results.push({ shopId, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}

// Real entrypoint -- not covered by the unit tests above (they inject fakes
// for RebuildDeps); this wires a real service-role Supabase client. Requires
// a SUPABASE_SERVICE_ROLE_KEY env var (never the anon key used elsewhere in
// this app -- rebuild_daily_event_counts_scope is service_role-only, see
// Task 2's design note on why this function has no per-caller shop check).
async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run this CLI.')
    process.exit(1)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const args = parseArgs(process.argv.slice(2))
  const deps: RebuildDeps = {
    rebuildScope: async (shopId, from, to) => {
      const { data, error } = await supabase.rpc('rebuild_daily_event_counts_scope', { p_shop_id: shopId, p_from: from, p_to: to })
      if (error) throw new Error(error.message)
      return data as { rows_deleted: number; events_replayed: number }
    },
    listShopIds: async () => {
      const { data, error } = await supabase.from('shops').select('id')
      if (error) throw new Error(error.message)
      return (data ?? []).map((row: { id: string }) => row.id)
    },
  }

  const results = await runRebuild(args, deps)
  for (const result of results) {
    if (result.status === 'success') {
      console.log(`${result.shopId}: OK -- ${result.rowsDeleted} rows deleted, ${result.eventsReplayed} events replayed`)
    } else {
      console.error(`${result.shopId}: FAILED -- ${result.error}`)
    }
  }
  const anyFailed = results.some((r) => r.status === 'failed')
  process.exit(anyFailed ? 1 : 0)
}

if (require.main === module) {
  main()
}
```

Add to `package.json`'s `scripts`: `"projections:rebuild": "tsx scripts/projections/rebuild.ts"` (check whether `tsx` or `ts-node` is already a devDependency in this repo — use whichever this repo already has for running standalone TS scripts; if neither, check for an existing precedent script in `package.json` and match its runner).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/projections/__tests__/rebuild.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/projections/rebuild.ts scripts/projections/__tests__/rebuild.test.ts package.json
git commit -m "feat(WAFI-151): add projections:rebuild CLI

Scoped rebuild (--shop --from --to) and --all (per-shop, full history,
each shop independently transactional -- a failure on one shop does not
block or roll back shops already completed). Wraps a single call to
rebuild_daily_event_counts_scope per shop; argument parsing and
dispatch logic are unit-tested against injected fakes."
```

---

### Task 4: Sync `events`/`daily_event_counts` to clients

**Files:**
- Modify: `powersync.yaml`
- Modify: `src/data/powersync/schema.ts`

**Interfaces:**
- Produces: `events` and `daily_event_counts` rows reach the client, shop-scoped, with `sequence` and `event_projection_day` available locally.

- [ ] **Step 1: Add sync-rule queries**

In `powersync.yaml`, add two lines to the `shop_data` stream's `queries:` list, matching the exact shop-scoping pattern every other line uses:

```yaml
      # WAFI-151: needed for client-side rebuild of local_today_revenue_projection.
      - SELECT * FROM public.events              WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
      - SELECT * FROM public.daily_event_counts   WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
```

Place these near the other WAFI-138/143-era additions at the bottom of the query list, following this file's existing convention of a comment above new additions explaining why.

- [ ] **Step 2: Add the new columns to the local schema**

In `src/data/powersync/schema.ts`, modify the `events` table definition (around line 381) to add `sequence` and `event_projection_day`:

```typescript
const events = new Table({
  type:                column.text,
  entity_id:           column.text,
  payload:             column.text,
  payload_version:     column.integer,
  staff_id:            column.text,
  shop_id:             column.text,
  occurred_at:         column.text,
  created_at:          column.text,
  sequence:            column.integer,   // BIGINT server-side; PowerSync's column DSL has no bigint, integer round-trips fine for realistic event volumes
  event_projection_day: column.text,     // YYYY-MM-DD
})
```

`daily_event_counts` already has all the columns this plan needs (it was already synced as a full table before this task — this task's job is making sure `events` reaches the client too, since that's what was actually missing per the design spec's original finding).

- [ ] **Step 3: Run the existing test suite to check for regressions**

Run: `npx vitest run`
Expected: same pre-existing "Worker is not defined" flakiness as before (unrelated to this change, see Plan 1's execution notes) — confirm no *new* failures, particularly none touching `schema.ts`, `events`, or PowerSync sync-rule-adjacent tests.

- [ ] **Step 4: Commit**

```bash
git add powersync.yaml src/data/powersync/schema.ts
git commit -m "feat(WAFI-151): sync events (with sequence, event_projection_day) to clients

daily_event_counts was already fully synced; events was not -- this
was the missing half of the sync-rule gap the design spec identified.
Shop-scoped identically to every other table in the shop_data stream."
```

---

### Task 5: Client-side rebuild for `local_today_revenue_projection`

**Files:**
- Create: `src/services/events/localTodayRevenueRebuild.ts`
- Create: `src/services/events/__tests__/localTodayRevenueRebuild.test.ts`

**Interfaces:**
- Consumes: local `events`/`daily_event_counts` tables (now synced, per Task 4), `db` from `@/data/powersync/db`.
- Produces: `rebuildLocalTodayRevenueProjection(shopId: string): Promise<{ status: 'success'; revenueUsd: number; revenueSyp: number } | { status: 'coverage_unavailable'; reason: string }>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/events/__tests__/localTodayRevenueRebuild.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { rebuildLocalTodayRevenueProjection } from '../localTodayRevenueRebuild'

describe('rebuildLocalTodayRevenueProjection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses to rebuild when the local event count does not match the authoritative daily_event_counts row', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ n: 3 } as any)   // local COUNT(*) of sale.completed events for today
      .mockResolvedValueOnce({ count: 5 } as any) // authoritative daily_event_counts row says 5
    const result = await rebuildLocalTodayRevenueProjection('shop-1')
    expect(result).toEqual({ status: 'coverage_unavailable', reason: expect.stringContaining('coverage') })
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('refuses to rebuild when the authoritative daily_event_counts row is missing (not treated as zero)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ n: 0 } as any)
      .mockResolvedValueOnce(null as any) // no synced row for today yet
    const result = await rebuildLocalTodayRevenueProjection('shop-1')
    expect(result).toEqual({ status: 'coverage_unavailable', reason: expect.stringContaining('coverage') })
  })

  it('refuses to rebuild when a local event in scope lacks a server-assigned sequence', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ n: 2 } as any)
      .mockResolvedValueOnce({ count: 2 } as any)
      .mockResolvedValueOnce({ n: 1 } as any) // one of the 2 events has sequence IS NULL
    const result = await rebuildLocalTodayRevenueProjection('shop-1')
    expect(result).toEqual({ status: 'coverage_unavailable', reason: expect.stringContaining('sequence') })
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('rebuilds successfully when coverage passes: replays events in sequence order, writes the projection and ledger inside one writeTransaction', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ n: 2 } as any)      // local count matches
      .mockResolvedValueOnce({ count: 2 } as any)  // authoritative count matches
      .mockResolvedValueOnce({ n: 0 } as any)      // no unsequenced events
      .mockResolvedValueOnce(null as any)          // existing local projection row lookup -- none yet
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'e1', payload: JSON.stringify({ totalUsd: 10, totalSyp: 1500 }), sequence: 100 },
      { id: 'e2', payload: JSON.stringify({ totalUsd: 5, totalSyp: 750 }), sequence: 101 },
    ] as any)
    const txExecute = vi.fn()
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await rebuildLocalTodayRevenueProjection('shop-1')

    expect(result).toEqual({ status: 'success', revenueUsd: 15, revenueSyp: 2250 })
    // The mutation (projection write + both ledger entries) happens inside the
    // single writeTransaction call, on the transaction handle -- not via
    // db.execute directly. This is what gives the client rebuild the
    // "runs inside an exclusive local transaction" property the design spec
    // requires (Client-Side Implementation, "Client-side concurrency").
    expect(db.writeTransaction).toHaveBeenCalledTimes(1)
    expect(db.execute).not.toHaveBeenCalled()
    const insertCalls = txExecute.mock.calls.filter(([sql]) => sql.toLowerCase().includes('insert into local_today_revenue_projection'))
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0][1]).toContain(15)
    expect(insertCalls[0][1]).toContain(2250)
    const ledgerCalls = txExecute.mock.calls.filter(([sql]) => sql.toLowerCase().includes('insert into local_event_processed_ledger'))
    expect(ledgerCalls).toHaveLength(2)
  })

  it('a failure partway through the transaction leaves the local projection and ledger untouched (rollback, via writeTransaction rejecting)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ n: 1 } as any)
      .mockResolvedValueOnce({ count: 1 } as any)
      .mockResolvedValueOnce({ n: 0 } as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'e1', payload: JSON.stringify({ totalUsd: 10, totalSyp: 1500 }), sequence: 100 },
    ] as any)
    // Simulate the transaction failing partway through (e.g. a disk error on
    // the ledger insert) -- writeTransaction's real implementation rolls back
    // everything in that transaction automatically; this test only needs to
    // confirm the function propagates that failure rather than swallowing it
    // and reporting false success.
    vi.mocked(db.writeTransaction).mockRejectedValueOnce(new Error('simulated write failure'))

    await expect(rebuildLocalTodayRevenueProjection('shop-1')).rejects.toThrow('simulated write failure')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/localTodayRevenueRebuild.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/events/localTodayRevenueRebuild.ts
import { db } from '@/data/powersync/db'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'

type RebuildResult =
  | { status: 'success'; revenueUsd: number; revenueSyp: number }
  | { status: 'coverage_unavailable'; reason: string }

/**
 * WAFI-151 Plan 2: coverage-checked rebuild of local_today_revenue_projection.
 * "Today" is the shop's current event_projection_day (shop-local), not the
 * device's calendar day -- both are read from the same synced `events` rows
 * this function already needs, so there is no separate device-clock lookup.
 *
 * Coverage check (design spec, Client-Side Implementation): compares the
 * local count of the exact event subset this projection depends on
 * (sale.completed) against the synced authoritative daily_event_counts row
 * for the same key. A missing authoritative row is coverage-unavailable, not
 * zero. Any local event missing a server-assigned sequence is also a
 * coverage failure -- an unsynced/local-only event cannot be safely mixed
 * into a deterministic replay. On failure, rebuild aborts with no changes.
 */
export async function rebuildLocalTodayRevenueProjection(shopId: string): Promise<RebuildResult> {
  const today = await getShopLocalToday(shopId)

  const localCount = await db.getOptional<{ n: number }>(
    `SELECT count(*) AS n FROM events WHERE shop_id = ? AND type = ? AND event_projection_day = ?`,
    [shopId, SalesEventType.Completed, today],
  )
  const authoritative = await db.getOptional<{ count: number }>(
    `SELECT count FROM daily_event_counts WHERE shop_id = ? AND event_type = ? AND day = ?`,
    [shopId, SalesEventType.Completed, today],
  )

  if (!authoritative) {
    return { status: 'coverage_unavailable', reason: `no authoritative daily_event_counts row synced yet for ${today} -- coverage cannot be established, not treated as zero` }
  }
  if ((localCount?.n ?? 0) !== authoritative.count) {
    return { status: 'coverage_unavailable', reason: `local event count (${localCount?.n ?? 0}) does not match the synced authoritative count (${authoritative.count}) for ${today} -- resync and retry` }
  }

  const unsequenced = await db.getOptional<{ n: number }>(
    `SELECT count(*) AS n FROM events WHERE shop_id = ? AND type = ? AND event_projection_day = ? AND sequence IS NULL`,
    [shopId, SalesEventType.Completed, today],
  )
  if ((unsequenced?.n ?? 0) > 0) {
    return { status: 'coverage_unavailable', reason: `${unsequenced!.n} local event(s) for ${today} lack a server-assigned sequence -- cannot safely replay a mix of sequenced and unsequenced events` }
  }

  const rows = await db.getAll<{ id: string; payload: string; sequence: number }>(
    `SELECT id, payload, sequence FROM events WHERE shop_id = ? AND type = ? AND event_projection_day = ? ORDER BY sequence ASC`,
    [shopId, SalesEventType.Completed, today],
  )

  let revenueUsd = 0
  let revenueSyp = 0
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as SaleCompletedPayload
    revenueUsd += payload.totalUsd
    revenueSyp += payload.totalSyp
  }

  const existing = await db.getOptional<{ id: string }>(
    `SELECT id FROM local_today_revenue_projection WHERE shop_id = ? AND date = ?`,
    [shopId, today],
  )

  // The projection write and every ledger entry commit as one local
  // transaction (design spec, "Client-side concurrency": rebuild must run
  // inside an exclusive local transaction). If anything in here throws,
  // writeTransaction rolls back the whole thing -- neither the projection
  // nor any ledger entry is left half-written.
  await db.writeTransaction(async (tx) => {
    if (existing) {
      await tx.execute(
        `UPDATE local_today_revenue_projection SET revenue_usd = ?, revenue_syp = ?, updated_at = ? WHERE id = ?`,
        [revenueUsd, revenueSyp, new Date().toISOString(), existing.id],
      )
    } else {
      await tx.execute(
        `INSERT INTO local_today_revenue_projection (id, shop_id, date, revenue_usd, revenue_syp, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), shopId, today, revenueUsd, revenueSyp, new Date().toISOString()],
      )
    }

    // Record every replayed event in the local ledger so incremental
    // processing after this rebuild treats them as already-applied by ID
    // (Core Architectural Invariant).
    for (const row of rows) {
      await tx.execute(
        `INSERT INTO local_event_processed_ledger (id, subscriber_id, event_id, processed_at) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), 'today_revenue_projection', row.id, new Date().toISOString()],
      )
    }
  })

  return { status: 'success', revenueUsd, revenueSyp }
}

async function getShopLocalToday(shopId: string): Promise<string> {
  // event_projection_day on the most recent synced event for this shop is
  // already computed shop-local server-side -- reusing it here means this
  // function never needs its own timezone logic or a second source of truth
  // for "what day is it for this shop right now."
  const latest = await db.getOptional<{ event_projection_day: string }>(
    `SELECT event_projection_day FROM events WHERE shop_id = ? ORDER BY sequence DESC LIMIT 1`,
    [shopId],
  )
  if (latest) return latest.event_projection_day
  // No events synced yet for this shop at all -- fall back to the device's
  // own UTC date; there is nothing else to derive "today" from.
  return new Date().toISOString().slice(0, 10)
}
```

`src/__tests__/__mocks__/db.ts` already exports `getAll`, `getOptional`, and `writeTransaction` (used by `inventory.service.test.ts` and others) — no mock changes needed for this task.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/localTodayRevenueRebuild.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/events/localTodayRevenueRebuild.ts src/services/events/__tests__/localTodayRevenueRebuild.test.ts
git commit -m "feat(WAFI-151): add coverage-checked client-side rebuild for local_today_revenue_projection

Compares local sale.completed count against the synced authoritative
daily_event_counts row before replaying; refuses (no changes) on any
mismatch, missing authoritative row, or unsequenced local event.
Successful rebuild runs inside one writeTransaction -- projection write
and every replayed event's ledger entry commit or roll back together
-- and records every event in the local processed-event ledger so
incremental processing treats them as already-applied afterward."
```

---

## Post-merge operational step (not a code task)

Once this plan merges, run `npm run projections:rebuild -- daily_event_counts --all` once against the real production database. This is the reconciliation step the design spec requires: existing `daily_event_counts` data was populated by the Plan-1-era buggy upload path and cannot be trusted until it's been rebuilt from the authoritative event log at least once. This is an operational action, not something a task in this plan can execute (no production Supabase access from this environment) — call it out explicitly to whoever merges this plan rather than letting it get lost.
