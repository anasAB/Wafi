# WAFI-151 Plan 1: Fix `daily_event_counts` Upload-Key Bug — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `daily_event_counts` genuinely server-authoritative by replacing PowerSync's generic upsert-by-row-id upload path with an atomic, tenant-checked Postgres increment keyed on the table's real logical identity `(shop_id, event_type, day)`.

**Architecture:** Add a `SECURITY DEFINER` Postgres function `increment_daily_event_count(shop_id, event_type, day, delta)` that does an `INSERT ... ON CONFLICT (shop_id, event_type, day) DO UPDATE SET count = count + delta`, atomically resolving concurrent increments from multiple devices. Special-case `daily_event_counts` in `src/data/powersync/ops.ts::runOp` (same pattern already used there for `audit_log` and `notifications`) so both PUT and PATCH translate to a call to this RPC with `delta = 1`, instead of upserting/updating the row's `count` column directly.

**Tech Stack:** Postgres/Supabase migrations (SQL), pgTAP (`supabase/tests/*.test.sql`), TypeScript (`src/data/powersync/ops.ts`), Vitest (`src/data/powersync/__tests__/ops.test.ts`).

## Global Constraints

- Migration files are numbered `NNN_description.sql`, zero-padded 3 digits, sequential. Latest existing migration is `082_notification_settings_id_pk.sql` — this plan's migration is `083_daily_event_counts_atomic_increment.sql`. If another migration lands first and claims `083`, renumber this one to the next free number before applying.
- Tenant isolation: every table's RLS uses `public.auth_shop_id()` to map the authenticated user to their shop (see `supabase/migrations/074_events_bus_core.sql` for the existing pattern on this exact table). A `SECURITY DEFINER` function bypasses RLS entirely, so it must perform its own equivalent check — never assume the caller's claimed `shop_id` is honest.
- Never commit with `--no-verify` or skip hooks.
- Follow existing code patterns exactly — `ops.ts`'s `audit_log`/`notifications` special cases are the template for this change; don't introduce a different structural pattern.

---

### Task 1: Migration — atomic `increment_daily_event_count` function

**Files:**
- Create: `supabase/migrations/083_daily_event_counts_atomic_increment.sql`
- Test: `supabase/tests/wafi151_daily_event_counts_increment.test.sql`

**Interfaces:**
- Produces: Postgres function `public.increment_daily_event_count(p_shop_id uuid, p_event_type text, p_day date, p_delta integer) RETURNS void`, callable via `supabase.rpc('increment_daily_event_count', {...})` from the client. Raises an exception if `p_shop_id` does not match the caller's `auth_shop_id()`.

- [ ] **Step 1: Write the failing pgTAP test**

Check the existing pgTAP test file convention first — read `supabase/tests/` for an existing `wafi*.test.sql` to match its harness/setup pattern (e.g. how a test shop and authenticated role are set up) before writing this file. Then write:

```sql
-- supabase/tests/wafi151_daily_event_counts_increment.test.sql
BEGIN;
SELECT plan(4);

-- Assumes the file's existing pgTAP harness pattern for creating a test shop
-- and switching to an authenticated role scoped to auth_shop_id() = that shop.
-- Mirror whatever setup an existing wafi*.test.sql file in this directory uses.

-- 1. First call creates a row with count = delta.
SELECT increment_daily_event_count(:'shop_id', 'sale.completed', '2026-08-11', 1);
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id' AND event_type = 'sale.completed' AND day = '2026-08-11'),
  1,
  'first increment call creates a row with count = delta'
);

-- 2. Second call for the same logical key increments in place, not a duplicate row.
SELECT increment_daily_event_count(:'shop_id', 'sale.completed', '2026-08-11', 1);
SELECT is(
  (SELECT count(*) FROM daily_event_counts WHERE shop_id = :'shop_id' AND event_type = 'sale.completed' AND day = '2026-08-11'),
  1::bigint,
  'second call for the same key updates in place -- exactly one row, not two'
);
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id' AND event_type = 'sale.completed' AND day = '2026-08-11'),
  2,
  'second call correctly incremented the existing row to 2 -- this is the bug fix under test'
);

-- 3. A call with a shop_id that does not match auth_shop_id() is rejected.
SELECT throws_ok(
  format('SELECT increment_daily_event_count(%L, %L, %L, %L)', gen_random_uuid(), 'sale.completed', '2026-08-11', 1),
  'P0001',
  NULL,
  'a shop_id mismatched against auth_shop_id() is rejected, not silently applied to another shop'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run whatever this repo's existing pgTAP runner command is (check `package.json` scripts or a `supabase/tests/README` for the exact invocation used by other `wafi*.test.sql` files — do not guess a new command).
Expected: FAIL — `increment_daily_event_count` does not exist yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/083_daily_event_counts_atomic_increment.sql

-- WAFI-151 Plan 1: daily_event_counts was previously maintained by each client
-- device reading its local SQLite copy, computing a new absolute count, and
-- uploading via PowerSync's generic upsert-by-row-id path. Two devices for the
-- same shop computing the same (shop_id, event_type, day) key independently
-- mint different random row ids, so both upload as separate INSERTs -- the
-- UNIQUE(shop_id, event_type, day) constraint never fires because the ids
-- differ, producing duplicate rows instead of one correct count.
--
-- Fix: the client-side upload path (src/data/powersync/ops.ts) is changed to
-- call this function instead of upserting the row directly. ON CONFLICT here
-- targets the real logical key and lets Postgres serialize concurrent
-- increments from multiple devices atomically.
CREATE OR REPLACE FUNCTION public.increment_daily_event_count(
  p_shop_id uuid,
  p_event_type text,
  p_day date,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SECURITY DEFINER bypasses RLS entirely, so this function must replicate
  -- the same tenant check daily_event_counts' own RLS policies perform
  -- (see 074_events_bus_core.sql) -- otherwise any authenticated caller could
  -- increment another shop's counts by passing an arbitrary p_shop_id.
  IF p_shop_id IS DISTINCT FROM (SELECT public.auth_shop_id()) THEN
    RAISE EXCEPTION 'increment_daily_event_count: p_shop_id does not match the caller''s shop' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.daily_event_counts (id, shop_id, event_type, day, count)
  VALUES (gen_random_uuid(), p_shop_id, p_event_type, p_day, p_delta)
  ON CONFLICT (shop_id, event_type, day)
  DO UPDATE SET count = public.daily_event_counts.count + p_delta;
END;
$$;

-- Only authenticated/anon clients call this (mirrors the table's own grants in
-- 074_events_bus_core.sql); service_role already has implicit superuser access.
GRANT EXECUTE ON FUNCTION public.increment_daily_event_count(uuid, text, date, integer) TO anon, authenticated;
```

- [ ] **Step 4: Apply the migration locally and run the test to verify it passes**

Run: whatever this repo's local Supabase migration-apply command is (check for a `supabase db reset` / `supabase migration up` pattern already used — do not guess), then re-run the pgTAP test file from Step 2.
Expected: PASS — all 4 assertions green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/083_daily_event_counts_atomic_increment.sql supabase/tests/wafi151_daily_event_counts_increment.test.sql
git commit -m "fix(WAFI-151): add atomic increment_daily_event_count RPC

daily_event_counts was upserted by row id from each client device, so
concurrent devices for the same shop produced duplicate rows instead of
one correct count per (shop_id, event_type, day). This function makes
the increment atomic and tenant-checked; client-side wiring follows."
```

---

### Task 2: Special-case `daily_event_counts` in `runOp`

**Files:**
- Modify: `src/data/powersync/ops.ts`
- Test: `src/data/powersync/__tests__/ops.test.ts`

**Interfaces:**
- Consumes: `increment_daily_event_count(shop_id, event_type, day, delta)` from Task 1.
- Produces: `runOp(type, 'daily_event_counts', id, opData)` now calls `supabase.rpc('increment_daily_event_count', {...})` for both `PUT` and `PATCH`, instead of the generic upsert/update path. Signature of `runOp` itself is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/powersync/__tests__/ops.test.ts`. First extend the mock at the top of the file to capture `.rpc()` calls the same way `upsert`/`update`/`delete` are already captured:

```typescript
// Add alongside the existing upsert/update/del/from mocks near the top of the file:
const rpc = vi.fn(() => ({ error: null }))
vi.mock('@/data/supabase/client', () => ({
  supabase: { from: (t: string) => from(t), rpc: (fn: string, args: unknown) => rpc(fn, args) },
}))
```

(This replaces the existing `vi.mock('@/data/supabase/client', ...)` call at the top of the file — the mock object needs both `from` and `rpc` on it.)

Then add a new describe block:

```typescript
describe('runOp — daily_event_counts atomic increment (WAFI-151)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls increment_daily_event_count with delta=1 on PUT, never upserts the row directly', async () => {
    await runOp(UpdateType.PUT, 'daily_event_counts', 'row1', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 1,
    })
    expect(rpc).toHaveBeenCalledWith('increment_daily_event_count', {
      p_shop_id: 'shop1', p_event_type: 'sale.completed', p_day: '2026-08-11', p_delta: 1,
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('calls increment_daily_event_count with delta=1 on PATCH too, never a plain UPDATE', async () => {
    await runOp(UpdateType.PATCH, 'daily_event_counts', 'row1', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 2,
    })
    expect(rpc).toHaveBeenCalledWith('increment_daily_event_count', {
      p_shop_id: 'shop1', p_event_type: 'sale.completed', p_day: '2026-08-11', p_delta: 1,
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('ignores the local absolute count value in opData -- delta is always 1, never derived from it', async () => {
    // A device with a stale local view (e.g. count: 47 after a long offline stretch)
    // must not upload that absolute value -- only ever an increment of 1 per queued op.
    await runOp(UpdateType.PUT, 'daily_event_counts', 'row2', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 47,
    })
    expect(rpc).toHaveBeenCalledWith('increment_daily_event_count', {
      p_shop_id: 'shop1', p_event_type: 'sale.completed', p_day: '2026-08-11', p_delta: 1,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: FAIL — `rpc` is never called, `upsert`/`update` are called instead (current generic behavior).

- [ ] **Step 3: Implement the special case**

In `src/data/powersync/ops.ts`, add a new branch before the generic `switch` (mirroring the existing `audit_log`/`notifications` special cases):

```typescript
  // WAFI-151: daily_event_counts' real identity is (shop_id, event_type, day), not the
  // local row id -- each device mints its own random id for what should be the same
  // logical row, so the generic upsert-by-id path below silently produces duplicate
  // rows under multiple devices instead of one correct count. Every local mutation to
  // this table (create or update) represents exactly one event having been processed
  // locally (guarded upstream by the per-event ledger in processProjectionAtMostOnce),
  // so it always translates to exactly one atomic server-side increment of 1 -- the
  // local absolute `count` value in opData is never uploaded directly.
  if (table === 'daily_event_counts' && (type === UpdateType.PUT || type === UpdateType.PATCH)) {
    return (
      await supabase.rpc('increment_daily_event_count', {
        p_shop_id: opData?.shop_id,
        p_event_type: opData?.event_type,
        p_day: opData?.day,
        p_delta: 1,
      })
    ).error
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: PASS — all tests green, including the pre-existing `audit_log`/`notifications`/generic-table tests (confirm nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add src/data/powersync/ops.ts src/data/powersync/__tests__/ops.test.ts
git commit -m "fix(WAFI-151): route daily_event_counts uploads through atomic RPC

PUT and PATCH for daily_event_counts now call increment_daily_event_count
(delta=1) instead of upserting/updating the row directly, so concurrent
devices for the same shop can no longer produce duplicate rows for the
same (shop_id, event_type, day) key."
```

---

### Task 3: Verify end-to-end fix with a concurrent-devices integration test

**Files:**
- Test: `supabase/tests/wafi151_concurrent_devices.test.sql`

**Interfaces:**
- Consumes: `increment_daily_event_count` from Task 1 (this test calls it directly, simulating what two devices' uploads would each independently trigger — it does not need to go through `ops.ts`/PowerSync, since Task 2 already unit-tests that translation layer).

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/wafi151_concurrent_devices.test.sql
-- Simulates two devices for the same shop each processing one sale.completed
-- event for the same day and uploading independently (WAFI-151 acceptance
-- criterion #0: this must produce one correctly-incremented row, not two).
BEGIN;
SELECT plan(2);

-- Mirror whatever existing wafi*.test.sql harness pattern sets up a test shop
-- and an authenticated role scoped to that shop's auth_shop_id().

-- Device A processes an event and uploads.
SELECT increment_daily_event_count(:'shop_id', 'sale.completed', '2026-08-11', 1);
-- Device B processes a different event, same logical key, and uploads.
SELECT increment_daily_event_count(:'shop_id', 'sale.completed', '2026-08-11', 1);

SELECT is(
  (SELECT count(*) FROM daily_event_counts WHERE shop_id = :'shop_id' AND event_type = 'sale.completed' AND day = '2026-08-11'),
  1::bigint,
  'two independent device uploads for the same logical key produce exactly one row'
);
SELECT is(
  (SELECT count FROM daily_event_counts WHERE shop_id = :'shop_id' AND event_type = 'sale.completed' AND day = '2026-08-11'),
  2,
  'the row reflects both devices'' increments correctly summed, not overwritten'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it passes**

Run the same pgTAP invocation used in Task 1, Step 4.
Expected: PASS. If it fails, the bug is not actually fixed — do not proceed to Plan 2 until this is green, since Plan 2's rebuild mechanism assumes `daily_event_counts` is genuinely authoritative.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi151_concurrent_devices.test.sql
git commit -m "test(WAFI-151): verify concurrent-device uploads no longer duplicate daily_event_counts rows"
```

---

## Handoff to Plan 2

Once this plan's three tasks are merged and verified, `daily_event_counts` is genuinely server-authoritative and Plan 2 (the rebuild/recovery mechanism itself — migration for `events.sequence`/`event_projection_day`, the CLI, PowerSync sync-rule changes, and the client-side rebuild for `local_today_revenue_projection`) can proceed. Plan 2's migration should be numbered as the next free migration after this plan's `083` lands (i.e. `084`, unless another migration merges first).
