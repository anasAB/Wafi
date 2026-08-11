# WAFI-151 Plan 1: Fix `daily_event_counts` Upload & Idempotency Bugs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `daily_event_counts` genuinely idempotent-per-event and access-controlled by replacing PowerSync's generic upload path with a server-side apply function that (a) derives projection dimensions from the authoritative event row instead of trusting the client, and (b) enforces "applied at most once per event, across all devices" via a server-side ledger — closing two distinct bugs, not one.

**Architecture:** An internal Postgres function `_apply_daily_event_count(event_id)` looks up the event, derives `shop_id`/`event_type`/day from it, records `(projection_name, event_id)` in a new server-side ledger table (`projection_processed_events`), and increments `daily_event_counts` only if that ledger insert succeeded. A client-facing wrapper `apply_daily_event_count(event_id)` authorizes the caller against the event's actual shop, takes the shop+projection advisory lock, then calls the internal function. `src/data/powersync/ops.ts` special-cases `daily_event_counts` to call the wrapper instead of upserting. Direct client `INSERT`/`UPDATE` grants on the table are revoked.

**Tech Stack:** Postgres/Supabase migrations (SQL, PL/pgSQL), pgTAP (`supabase/tests/*.test.sql`), TypeScript (`src/data/powersync/ops.ts`, `src/data/powersync/schema.ts`, `src/services/events/dailyEventCountsProjection.ts`), Vitest.

## Global Constraints

- Migration files: `NNN_description.sql`, zero-padded 3 digits, sequential. Latest existing migration is `082_notification_settings_id_pk.sql` — this plan's migration is `083_daily_event_counts_atomic_increment.sql`. If another migration claims `083` first, renumber before applying.
- Tenant isolation: `public.auth_shop_id()` maps the authenticated user to their shop (see `074_events_bus_core.sql`). A `SECURITY DEFINER` function bypasses RLS entirely — it must perform its own equivalent check, and must derive the shop from the authoritative event row, never trust a client-supplied `shop_id`.
- The bug being fixed is **not** "duplicate rows appear." It is: (a) a second device's upload conflicts on a *different* unique constraint than the one targeted by its upsert, raising a `23505` that `ops.ts::isPermanentError` classifies as permanent, which `connector.ts` routes to `quarantineOp` — the write sits in `sync_dead_letter` and even a manual retry comes back `still-blocked` forever; and (b) independently, even a successful write has no protection against two different devices each correctly applying the same synced event twice, since the existing ledger (`local_event_processed_ledger`) is per-device SQLite. Both must be fixed; fixing only the upsert-target does not fix (b).
- Never commit with `--no-verify` or skip hooks.
- Follow existing code patterns exactly — the `audit_log`/`notifications` special cases in `ops.ts` are the template for the new one; don't introduce a different structural pattern.

---

### Task 1: Migration — server-side ledger, idempotent apply functions, revoke direct writes

**Files:**
- Create: `supabase/migrations/083_daily_event_counts_atomic_increment.sql`

**Interfaces:**
- Produces:
  - Table `public.projection_processed_events (projection_name text, event_id uuid, processed_at timestamptz, PRIMARY KEY (projection_name, event_id))`.
  - `public._apply_daily_event_count(p_event_id uuid) RETURNS void` — internal, not client-callable.
  - `public.apply_daily_event_count(p_event_id uuid) RETURNS void` — client-callable via `supabase.rpc('apply_daily_event_count', { p_event_id })`.
  - `public.daily_event_counts.source_event_id uuid` — new nullable column, provenance only, not used by any constraint.
  - Direct `INSERT`/`UPDATE` on `daily_event_counts` revoked from `anon`/`authenticated`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/083_daily_event_counts_atomic_increment.sql

-- WAFI-151 Plan 1. Two distinct bugs fixed here:
--
-- 1) daily_event_counts was uploaded via PowerSync's generic upsert-by-row-id
--    path. Two devices for the same shop computing the same (shop_id, event_type,
--    day) independently mint different random ids, so the upsert's implicit
--    ON CONFLICT (id) never fires -- but the INSERT still violates the pre-existing
--    UNIQUE(shop_id, event_type, day) constraint, which Postgres enforces regardless
--    of the upsert's conflict target. That raises 23505, which ops.ts::isPermanentError
--    classifies as permanent, so connector.ts quarantines it into sync_dead_letter --
--    and retrying doesn't help, since the retried op still conflicts the same way.
--    Net effect: the second device's write is silently, permanently lost.
--
-- 2) Independently: even once a write lands, nothing stops two DIFFERENT devices
--    from each correctly, locally processing the same synced event and each
--    issuing their own increment -- the existing ledger (local_event_processed_ledger)
--    is per-device SQLite and cannot see across devices. Fixing (1) alone would
--    just mean writes land reliably AND double-count reliably.
--
-- Fix: route all mutation through a function that derives projection dimensions
-- from the authoritative event row (never trusts the client) and is idempotent
-- per (projection_name, event_id) via a new server-side ledger.

CREATE TABLE IF NOT EXISTS public.projection_processed_events (
  projection_name text NOT NULL,
  event_id        uuid NOT NULL REFERENCES public.events(id),
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (projection_name, event_id)
);

ALTER TABLE public.projection_processed_events ENABLE ROW LEVEL SECURITY;
-- No client-facing policies: this table is only ever touched by SECURITY DEFINER
-- functions running as their own role, never queried directly by anon/authenticated.

-- Provenance column: lets ops.ts forward which event triggered a given local
-- mutation without the server ever trusting client-supplied projection dimensions.
-- Not used by any constraint or function logic below -- informational only.
ALTER TABLE public.daily_event_counts ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES public.events(id);

-- Internal apply logic. NEVER granted to anon/authenticated -- reachable only via
-- the wrapper below, or directly by a future rebuild function (WAFI-151 Plan 2),
-- which will already hold the same advisory lock before calling this.
CREATE OR REPLACE FUNCTION public._apply_daily_event_count(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event public.events;
  v_day date;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found in authoritative log', p_event_id USING ERRCODE = 'P0002';
  END IF;

  IF v_event.type <> 'sale.completed' THEN
    RETURN; -- not eligible for this projection; not an error, just a no-op
  END IF;

  -- WAFI-151 Plan 2 introduces events.event_projection_day for deterministic,
  -- timezone-stable day bucketing. Until that column exists, this matches the
  -- existing client behavior exactly (row.occurred_at.slice(0, 10) in
  -- dailyEventCountsProjection.ts) so this fix doesn't change day attribution --
  -- only correctness of the increment itself. Swap to event_projection_day when
  -- Plan 2's migration lands.
  v_day := v_event.occurred_at::date;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('daily_event_counts', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN; -- already applied by this or another device -- exactly-once, silent no-op on repeat
  END;

  INSERT INTO public.daily_event_counts (id, shop_id, event_type, day, count, source_event_id)
  VALUES (gen_random_uuid(), v_event.shop_id, v_event.type, v_day, 1, p_event_id)
  ON CONFLICT (shop_id, event_type, day)
  DO UPDATE SET count = public.daily_event_counts.count + 1;
END;
$$;

-- Client-facing wrapper: the only entry point clients may call. Authorizes the
-- caller against the EVENT's actual shop (never a client-claimed shop_id), then
-- takes the same shop+projection advisory lock a future rebuild will hold, so an
-- incremental apply can never land mid-rebuild.
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
    RAISE EXCEPTION 'apply_daily_event_count: event % not found', p_event_id USING ERRCODE = 'P0002';
  END IF;
  IF v_shop_id IS DISTINCT FROM (SELECT public.auth_shop_id()) THEN
    RAISE EXCEPTION 'apply_daily_event_count: caller is not authorized for this event''s shop' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('daily_event_counts' || v_shop_id::text));
  PERFORM public._apply_daily_event_count(p_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_daily_event_count(uuid) TO anon, authenticated;
-- _apply_daily_event_count intentionally has NO grant to anon/authenticated.

-- Direct client writes are revoked, not just routed around in application code --
-- this is what makes apply_daily_event_count the ONLY mutation path, not merely
-- the recommended one. (SELECT stays granted; UPDATE/INSERT removed. DELETE was
-- never granted -- see 074_events_bus_core.sql.)
REVOKE INSERT, UPDATE ON TABLE public.daily_event_counts FROM anon, authenticated;
```

- [ ] **Step 2: Apply the migration locally**

Run whatever this repo's local Supabase migration-apply command is (check for an existing `supabase db reset` / `supabase migration up` pattern used elsewhere in this repo's docs/scripts — do not guess a new command).
Expected: migration applies cleanly with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/083_daily_event_counts_atomic_increment.sql
git commit -m "fix(WAFI-151): add idempotent-per-event apply function for daily_event_counts

Two bugs fixed: (1) the previous upsert-by-row-id path caused a second
device's write to permanently fail with a 23505 unique_violation and
sit unrecoverable in sync_dead_letter -- not silently create a
duplicate row as first assumed; (2) even a successful write had no
protection against two devices independently, correctly applying the
same event twice. Fixed via a server-side per-event ledger and a
function that derives projection dimensions from the authoritative
event row rather than trusting the client. Client-side wiring follows."
```

---

### Task 2: pgTAP tests proving both bugs are fixed

**Files:**
- Test: `supabase/tests/wafi151_daily_event_counts_apply.test.sql`

**Interfaces:**
- Consumes: `apply_daily_event_count`, `_apply_daily_event_count`, `projection_processed_events` from Task 1.

- [ ] **Step 1: Write the test**

Check an existing `wafi*.test.sql` file in `supabase/tests/` first for this repo's exact harness pattern (how a test shop is created, how a role is switched to be authenticated with `auth_shop_id()` resolving to that shop, and how a fake `events` row is inserted for the test) — mirror that pattern exactly rather than inventing a new one. The assertions below are what must hold regardless of that harness's exact shape:

```sql
-- supabase/tests/wafi151_daily_event_counts_apply.test.sql
BEGIN;
SELECT plan(6);

-- Mirror this repo's existing wafi*.test.sql harness for creating a test shop,
-- an authenticated role scoped to that shop's auth_shop_id(), and inserting a
-- fake authoritative `events` row (type = 'sale.completed', shop_id = the test
-- shop) to use as :'event_id' below. A second test shop / second event are
-- also needed for the assertions below -- use :'shop_id_a', :'event_id_a',
-- :'shop_id_b', :'event_id_b' as placeholders for whatever this harness's
-- actual variable-binding convention is.

-- 1. First call creates the row and a ledger entry.
SELECT apply_daily_event_count(:'event_id_a');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE source_event_id = :'event_id_a'),
  1,
  'first apply creates a row with count = 1'
);
SELECT is(
  (SELECT count(*)::integer FROM projection_processed_events WHERE projection_name = 'daily_event_counts' AND event_id = :'event_id_a'),
  1,
  'ledger records exactly one entry for this event'
);

-- 2. Repeated calls for the SAME event ID are a no-op (fixes bug 2: cross-device
-- double-counting of the same event, simulated here as a repeated call).
SELECT apply_daily_event_count(:'event_id_a');
SELECT apply_daily_event_count(:'event_id_a');
SELECT is(
  (SELECT count FROM daily_event_counts WHERE source_event_id = :'event_id_a'),
  1,
  'repeated calls for the same event ID do not increment further -- exactly-once per event'
);

-- 3. A DIFFERENT event for the same (shop, type, day) DOES increment -- the fix
-- must not accidentally make the projection stop counting distinct events.
SELECT apply_daily_event_count(:'event_id_a2'); -- a second, distinct event, same shop/type/day as event_id_a
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id_a' AND event_type = 'sale.completed'),
  2,
  'a distinct event ID for the same logical key still increments -- fix does not suppress legitimate increments'
);

-- 4. A caller cannot apply an event belonging to another shop.
SELECT throws_ok(
  format('SELECT apply_daily_event_count(%L)', :'event_id_b'), -- event_id_b belongs to shop_id_b, not the currently-authenticated shop
  'P0001',
  NULL,
  'applying an event from another shop is rejected, not silently applied'
);

-- 5. Direct client writes are rejected at the grant level, not just avoided by convention.
SELECT throws_ok(
  format('INSERT INTO daily_event_counts (shop_id, event_type, day, count) VALUES (%L, %L, %L, %L)', :'shop_id_a', 'sale.completed', '2026-08-11', 1),
  '42501',
  NULL,
  'direct INSERT into daily_event_counts is rejected -- apply_daily_event_count is the only mutation path'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test and verify it passes**

Run this repo's existing pgTAP invocation (same command used for other `wafi*.test.sql` files).
Expected: PASS, all 6 assertions. If assertion 3 or 5 fails, the migration in Task 1 has a defect — do not proceed to Task 3 until this file is fully green, since Task 3 wires production code onto this function.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi151_daily_event_counts_apply.test.sql
git commit -m "test(WAFI-151): verify daily_event_counts apply function is idempotent per event and access-controlled"
```

---

### Task 3: Route `ops.ts` uploads through `apply_daily_event_count`

**Files:**
- Modify: `src/data/powersync/ops.ts`
- Test: `src/data/powersync/__tests__/ops.test.ts`

**Interfaces:**
- Consumes: `apply_daily_event_count(p_event_id)` from Task 1.
- Produces: `runOp(type, 'daily_event_counts', id, opData)` calls `supabase.rpc('apply_daily_event_count', { p_event_id: opData?.source_event_id })` for both `PUT` and `PATCH`, instead of the generic upsert/update path. `runOp`'s own signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Extend the mock at the top of `src/data/powersync/__tests__/ops.test.ts` to also capture `.rpc()` calls:

```typescript
// Replace the existing mock block near the top of the file with:
const upsert = vi.fn(() => ({ error: null }))
const update = vi.fn(() => ({ eq: () => ({ error: null }) }))
const del    = vi.fn(() => ({ eq: () => ({ error: null }) }))
const from   = vi.fn(() => ({ upsert, update, delete: del }))
const rpc    = vi.fn(() => ({ error: null }))

vi.mock('@/data/supabase/client', () => ({
  supabase: { from: (t: string) => from(t), rpc: (fn: string, args: unknown) => rpc(fn, args) },
}))
```

Then add a new describe block:

```typescript
describe('runOp — daily_event_counts idempotent apply (WAFI-151)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls apply_daily_event_count with the source event id on PUT, never upserts the row directly', async () => {
    await runOp(UpdateType.PUT, 'daily_event_counts', 'row1', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 1, source_event_id: 'evt1',
    })
    expect(rpc).toHaveBeenCalledWith('apply_daily_event_count', { p_event_id: 'evt1' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('calls apply_daily_event_count on PATCH too, never a plain UPDATE', async () => {
    await runOp(UpdateType.PATCH, 'daily_event_counts', 'row1', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 2, source_event_id: 'evt2',
    })
    expect(rpc).toHaveBeenCalledWith('apply_daily_event_count', { p_event_id: 'evt2' })
    expect(update).not.toHaveBeenCalled()
  })

  it('ignores the local absolute count value in opData -- only source_event_id is forwarded', async () => {
    // A device with a stale local view (e.g. count: 47 after a long offline stretch)
    // must not upload that absolute value -- the server derives everything from the
    // event itself, keyed only by source_event_id.
    await runOp(UpdateType.PUT, 'daily_event_counts', 'row2', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 47, source_event_id: 'evt3',
    })
    expect(rpc).toHaveBeenCalledWith('apply_daily_event_count', { p_event_id: 'evt3' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: FAIL — `rpc` is never called; `upsert`/`update` are called instead (current generic behavior). Also confirm the pre-existing `audit_log`/`notifications`/generic-table tests still pass unmodified (they should — this change is additive).

- [ ] **Step 3: Implement the special case**

In `src/data/powersync/ops.ts`, add a new branch before the generic `switch` (mirroring the existing `audit_log`/`notifications` special cases):

```typescript
  // WAFI-151: daily_event_counts must be idempotent per authoritative event, not
  // merely per logical key -- the server derives shop/type/day from the event
  // itself and enforces exactly-once application via a server-side ledger,
  // rather than trusting whatever this device's local row currently says. Every
  // local mutation to this table carries the originating event's id as
  // source_event_id (see dailyEventCountsProjection.ts), which is all the server
  // call needs; the local absolute `count` value in opData is never uploaded.
  if (table === 'daily_event_counts' && (type === UpdateType.PUT || type === UpdateType.PATCH)) {
    return (
      await supabase.rpc('apply_daily_event_count', { p_event_id: opData?.source_event_id })
    ).error
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: PASS — all tests green, including every pre-existing test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/data/powersync/ops.ts src/data/powersync/__tests__/ops.test.ts
git commit -m "fix(WAFI-151): route daily_event_counts uploads through apply_daily_event_count

PUT and PATCH for daily_event_counts now call the idempotent,
event-derived server function instead of upserting/updating the row
directly with client-computed values."
```

---

### Task 4: Carry `source_event_id` from the local projection through to upload

**Files:**
- Modify: `src/data/powersync/schema.ts`
- Modify: `src/services/events/dailyEventCountsProjection.ts`
- Modify: `src/services/events/__tests__/dailyEventCountsProjection.test.ts`

**Interfaces:**
- Consumes: nothing new — this task makes the local write actually populate the `source_event_id` column that Task 3 forwards.
- Produces: local `daily_event_counts` rows now carry `source_event_id`, matching the server column added in Task 1.

- [ ] **Step 1: Add the local schema column**

In `src/data/powersync/schema.ts`, modify the `daily_event_counts` table definition (around line 392):

```typescript
const daily_event_counts = new Table({
  shop_id:          column.text,
  event_type:       column.text,
  day:              column.text,
  count:            column.integer,
  source_event_id:  column.text,
})
```

- [ ] **Step 2: Update the failing tests first**

Modify `src/services/events/__tests__/dailyEventCountsProjection.test.ts` — every assertion on the `INSERT`/`UPDATE` SQL and params needs the new column. Update the first test (`'inserts a new daily_event_counts row...'`):

```typescript
    // (unchanged setup above)
    const [sql, params] = vi.mocked(db.execute).mock.calls[1]
    expect(sql.toLowerCase()).toContain('insert into daily_event_counts')
    expect(sql.toLowerCase()).not.toContain('on conflict')
    expect(typeof (params as unknown[])[0]).toBe('string') // explicit generated id
    expect(params).toContain('shop-1')
    expect(params).toContain('sale.completed')
    expect(params).toContain('2026-07-31') // day, derived from occurred_at
    expect(params).toContain('e1') // source_event_id -- WAFI-151
```

Update the second test (`'increments the existing row count...'`):

```typescript
    const [sql, params] = vi.mocked(db.execute).mock.calls[1]
    expect(sql.toLowerCase()).toContain('update daily_event_counts')
    expect(params).toEqual([5, 'e1', 'row-1']) // count, source_event_id, id -- WAFI-151
```

(The other two tests in this file only assert `execute` call counts and `insert into daily_event_counts` substring matches, not exact params — they don't need changes.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/dailyEventCountsProjection.test.ts`
Expected: FAIL — current implementation doesn't write `source_event_id` yet.

- [ ] **Step 4: Update the implementation**

In `src/services/events/dailyEventCountsProjection.ts`, add `source_event_id` to both the existing-row lookup's `UPDATE` and the fresh-row `INSERT`:

```typescript
export function startDailyEventCountsProjection(shopId: string): { stop: () => void } {
  return useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, row.id, async () => {
        const day = row.occurred_at.slice(0, 10)
        const existing = await db.getOptional<{ id: string; count: number }>(
          `SELECT id, count FROM daily_event_counts WHERE shop_id = ? AND event_type = ? AND day = ?`,
          [shopId, SalesEventType.Completed, day],
        )
        if (existing) {
          await db.execute(
            `UPDATE daily_event_counts SET count = ?, source_event_id = ? WHERE id = ?`,
            [existing.count + 1, row.id, existing.id],
          )
        } else {
          await db.execute(
            `INSERT INTO daily_event_counts (id, shop_id, event_type, day, count, source_event_id) VALUES (?, ?, ?, ?, 1, ?)`,
            [crypto.randomUUID(), shopId, SalesEventType.Completed, day, row.id],
          )
        }
      })
    },
    { shopId },
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/dailyEventCountsProjection.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS. Pay particular attention to anything asserting on `daily_event_counts`' column set (e.g. any PowerSync schema snapshot test) — fix if the new column trips a snapshot assertion elsewhere.

- [ ] **Step 7: Commit**

```bash
git add src/data/powersync/schema.ts src/services/events/dailyEventCountsProjection.ts src/services/events/__tests__/dailyEventCountsProjection.test.ts
git commit -m "fix(WAFI-151): carry source_event_id from local projection through to upload

The local daily_event_counts row now records which event produced it,
so ops.ts (see previous commit) can forward that id to the server's
idempotent apply function instead of the server trusting client-
computed projection dimensions."
```

---

## Handoff to Plan 2

Once these four tasks are merged and verified end-to-end (including a manual or staging-environment check that a genuinely offline-then-reconnected device's queued `daily_event_counts` write now succeeds instead of landing in `sync_dead_letter`), `daily_event_counts` is idempotent-per-event and access-controlled. Plan 2 (the rebuild/recovery mechanism — `events.sequence`/`event_projection_day` migration, the single-transaction rebuild function per scope, the CLI, PowerSync sync-rule changes, and the client-side rebuild for `local_today_revenue_projection`) can now proceed, and **must include, as its first production use, a full reconciliation rebuild of existing `daily_event_counts` data** — data populated before this fix landed cannot be trusted and must not be treated as correct by default. Plan 2's migration should be numbered as the next free migration after `083` (i.e. `084`, unless another migration merges first), and its rebuild function must call `_apply_daily_event_count` (not the client-facing wrapper) from inside its own transaction, since it will already hold the shop+projection advisory lock itself.
