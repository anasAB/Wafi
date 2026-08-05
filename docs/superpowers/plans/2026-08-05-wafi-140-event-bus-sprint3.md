# WAFI-140 Sprint 3 — Security Hardening, Rate Limiting, RLS, Contract Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out WAFI-140 (the final sprint) by adding per-event-type RLS, client+server rate
limiting, event contract tests, general security hardening, retention/cleanup, retry backoff
jitter, and a fix for the dormant `startDailyEventCountsProjection` subscriber — per the approved
design spec.

**Architecture:** A client-side in-memory token bucket sits in front of a Postgres `BEFORE INSERT`
trigger on `events` (defense in depth for rate limiting). A new `EVENT_SENSITIVITY` registry in
`domainEvent.types.ts`, cross-verified against the live RLS policy by a pgTAP test, drives a
per-type `CASE` policy reusing the existing `public.can()` permission framework (no new mechanism).
Contract tests snapshot the full `DomainEvent` envelope per event type. A local cleanup sweeper
(mirroring the existing retry-queue sweeper's reconnect-listener pattern) bounds local table growth.

**Tech Stack:** Vue 3, TypeScript, PowerSync (`@powersync/web`), Vitest, Postgres/Supabase, pgTAP.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-05-wafi-140-event-bus-sprint3-design.md` — read in
  full before implementing any task; this plan assumes familiarity with it.
- Next unused migration number is `076` (confirmed via `ls supabase/migrations` — `075` is the most
  recent as of this plan). Use `076_events_rate_limit.sql` and `077_events_per_type_rls.sql`.
- Every new event-type-keyed lookup (rate limit patterns, sensitivity registry) must be exhaustive
  over `DomainEventType` where the design spec calls for it — never a raw string literal added ad
  hoc.
- **Scope correction found during planning, not in the design spec:** the design spec's §6a
  describes a new manual verification script,
  `supabase/migrations/verification/verify_wafi140_events_isolation.sql`, mirroring
  `verify_wafi122_role_enforcement.sql`'s hand-run convention. Checking the actual repo state found
  this ground is already covered by an *automated* pgTAP file from Sprint 1,
  `supabase/tests/wafi140_events_rls.test.sql` (cross-tenant isolation for `events`/
  `daily_event_counts`, run via `npx supabase test db`), which already has the right fixtures (two
  shops, one owner each) for this sprint's new assertions to build on. Writing a second, manual,
  less-rigorous script covering overlapping ground would be redundant — this plan extends the
  existing automated file instead (Task 8) rather than creating the spec's proposed new file.
- pgTAP tests live in `supabase/tests/*.test.sql`, run via `npx supabase test db`.
- Vitest tests mock PowerSync via `vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))`
  — follow this exact pattern (see `publishEvent.test.ts`, `useEventSubscription.test.ts`) for any
  new test file touching `db`.
- `keyof StaffPermissions` is this codebase's existing type for a permission flag (see
  `executeBusinessOperation.ts`, `useCan.ts`) — do not invent a new `StaffPermissionFlag` alias.

---

### Task 1: `EVENT_SENSITIVITY` registry

**Files:**
- Modify: `src/services/events/domainEvent.types.ts` (append registry at end of file)
- Test: `src/services/events/__tests__/eventSensitivity.test.ts` (create)

**Interfaces:**
- Produces: `export type EventSensitivity = 'public' | keyof StaffPermissions` and
  `export const EVENT_SENSITIVITY: Record<DomainEventType, EventSensitivity>`. Task 6 (per-type RLS
  SQL) and Task 9 (registry/SQL cross-check pgTAP test) both depend on this exact set of keys/values
  existing.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/events/__tests__/eventSensitivity.test.ts
import { describe, it, expect } from 'vitest'
import { EVENT_SENSITIVITY } from '@/services/events/domainEvent.types'

describe('EVENT_SENSITIVITY', () => {
  it('classifies the 4 known-sensitive event types per the design spec (§3)', () => {
    expect(EVENT_SENSITIVITY['staff.ledger_entry_added']).toBe('can_view_staff_ledger')
    expect(EVENT_SENSITIVITY['settlement.paid']).toBe('can_view_staff_ledger')
    expect(EVENT_SENSITIVITY['expense.recorded']).toBe('can_view_expenses')
    expect(EVENT_SENSITIVITY['product.cost_updated']).toBe('can_view_reports')
  })

  it('classifies every other wired event type as public', () => {
    const sensitiveTypes = new Set([
      'staff.ledger_entry_added', 'settlement.paid', 'expense.recorded', 'product.cost_updated',
    ])
    for (const [type, sensitivity] of Object.entries(EVENT_SENSITIVITY)) {
      if (!sensitiveTypes.has(type)) expect(sensitivity).toBe('public')
    }
  })

  it('has exactly 17 entries (one per wired DomainEventType, no stragglers)', () => {
    expect(Object.keys(EVENT_SENSITIVITY)).toHaveLength(17)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/eventSensitivity.test.ts`
Expected: FAIL — `EVENT_SENSITIVITY` doesn't exist yet.

- [ ] **Step 3: Append the registry to `domainEvent.types.ts`**

Add at the end of `src/services/events/domainEvent.types.ts`:

```ts
// WAFI-140 Sprint 3 (design spec §3). Single source of truth for event-type sensitivity
// classification. Every DomainEventType MUST have an entry -- the Record type below is
// exhaustive by construction, so adding a new event type without adding a row here is a
// TypeScript compile error, not a silent gap.
//
// This registry does NOT generate the SQL policy in 077_events_per_type_rls.sql (no build
// step wires TS into migrations in this codebase) -- it is the documented, type-checked
// intent, cross-verified against the live policy by a pgTAP test (see
// supabase/tests/wafi140_events_rls.test.sql) that reads pg_get_expr() against a real
// database after migrations have run and asserts every non-'public' entry here has a
// matching WHEN branch, and vice versa. Two independent lists, one automated equality check
// between them -- neither can silently drift from the other without a failing test.
//
// Process rule: adding a new DomainEventType requires adding a row here (compiler-enforced)
// and, if that row is not 'public', adding the matching WHEN branch to
// 077_events_per_type_rls.sql's events_select_scoped policy (enforced by the pgTAP
// cross-check test above, not the compiler -- SQL text isn't something TypeScript can check).
export type EventSensitivity = 'public' | keyof import('@/features/staff/staff.types').StaffPermissions

export const EVENT_SENSITIVITY: Record<DomainEventType, EventSensitivity> = {
  'sale.completed':           'public',
  'sale.returned':            'public',
  'customer.debt_changed':    'public',
  'installment.due_paid':     'public',
  'cash.movement_recorded':   'public',
  'stock.taken':               'public',
  'stock.received':           'public',
  'shift.opened':              'public',
  'shift.closed':              'public',
  'inventory.adjusted':       'public',
  'device.registered':        'public',
  'product.price_changed':    'public',
  'product.created':          'public',
  'staff.ledger_entry_added': 'can_view_staff_ledger',
  'settlement.paid':          'can_view_staff_ledger',
  'expense.recorded':         'can_view_expenses',
  'product.cost_updated':     'can_view_reports',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/eventSensitivity.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/events/domainEvent.types.ts src/services/events/__tests__/eventSensitivity.test.ts
git commit -m "feat(WAFI-140): add EVENT_SENSITIVITY registry for per-event-type RLS"
```

---

### Task 2: Client-side rate-limit token bucket

**Files:**
- Create: `src/services/events/publishRateLimiter.ts`
- Test: `src/services/events/__tests__/publishRateLimiter.test.ts`

**Interfaces:**
- Produces: `tryConsumeToken(): boolean`. Task 4 (`publishEvent()` wiring) depends on this exact
  signature.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/events/__tests__/publishRateLimiter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tryConsumeToken } from '@/services/events/publishRateLimiter'

describe('tryConsumeToken', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-08-05T00:00:00.000Z')))
  afterEach(() => vi.useRealTimers())

  it('allows up to the burst capacity (50) before rejecting', () => {
    const results = Array.from({ length: 51 }, () => tryConsumeToken())
    expect(results.slice(0, 50).every(Boolean)).toBe(true)
    expect(results[50]).toBe(false)
  })

  it('refills over time (10/sec) so a token becomes available again after a pause', () => {
    Array.from({ length: 50 }, () => tryConsumeToken()) // exhaust the bucket
    expect(tryConsumeToken()).toBe(false)
    vi.setSystemTime(new Date('2026-08-05T00:00:01.000Z')) // +1s -> +10 tokens
    expect(tryConsumeToken()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/publishRateLimiter.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `publishRateLimiter.ts`**

```ts
// src/services/events/publishRateLimiter.ts
// In-memory, per-process, not persisted or synced -- resets on app restart (WAFI-140 Sprint
// 3 design spec §4a). This is a cheap first line of defense against a runaway LOCAL loop,
// not a security boundary (a compromised or modified client can trivially bypass in-memory
// state). The real boundary is the SQL trigger in 076_events_rate_limit.sql -- this bucket
// exists purely to stop wasted local SQLite/serialization work before that trigger is even
// reached, not to be trusted as the actual limit.
const CAPACITY = 50
const REFILL_PER_SECOND = 10
let tokens = CAPACITY
let lastRefillMs = Date.now()

export function tryConsumeToken(): boolean {
  const now = Date.now()
  const elapsedSeconds = (now - lastRefillMs) / 1000
  tokens = Math.min(CAPACITY, tokens + elapsedSeconds * REFILL_PER_SECOND)
  lastRefillMs = now
  if (tokens < 1) return false
  tokens -= 1
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/publishRateLimiter.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add src/services/events/publishRateLimiter.ts src/services/events/__tests__/publishRateLimiter.test.ts
git commit -m "feat(WAFI-140): add client-side token-bucket rate limiter"
```

---

### Task 3: `isTransientPublishFailure` — rate-limit classification

**Files:**
- Modify: `src/services/events/isTransientPublishFailure.ts`
- Test: `src/services/events/__tests__/isTransientPublishFailure.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isTransientPublishFailure` now also classifies `/rate_limit_exceeded/i`-matching
  messages as transient. Tasks 4 and 6 both rely on this pattern matching both
  `client_rate_limit_exceeded` (Task 4) and `events_rate_limit_exceeded` (Task 6's SQL trigger).

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('isTransientPublishFailure', ...)` block in
`src/services/events/__tests__/isTransientPublishFailure.test.ts`:

```ts
  it('classifies both client-side and server-side rate-limit rejections as transient', () => {
    expect(isTransientPublishFailure(new Error('client_rate_limit_exceeded'))).toBe(true)
    expect(isTransientPublishFailure(new Error('events_rate_limit_exceeded'))).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/isTransientPublishFailure.test.ts`
Expected: FAIL — neither pattern currently matches.

- [ ] **Step 3: Add the pattern**

```ts
// src/services/events/isTransientPublishFailure.ts
export function isTransientPublishFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const transientPatterns = [
    /busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i,
    // WAFI-140 Sprint 3: one shared pattern matches both rejection reasons -- the client-side
    // token bucket's 'client_rate_limit_exceeded' (never reaches Postgres) and the SQL
    // trigger's 'events_rate_limit_exceeded' (design spec §4) -- so both retry on the
    // existing generic backoff schedule with no dedicated retry policy of their own.
    /rate_limit_exceeded/i,
  ]
  return transientPatterns.some((p) => p.test(message))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/isTransientPublishFailure.test.ts`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add src/services/events/isTransientPublishFailure.ts src/services/events/__tests__/isTransientPublishFailure.test.ts
git commit -m "feat(WAFI-140): classify rate-limit rejections as transient publish failures"
```

---

### Task 4: Wire token bucket + payload validation into `publishEvent()`

**Files:**
- Modify: `src/services/events/publishEvent.ts`
- Test: `src/services/events/__tests__/publishEvent.test.ts`

**Interfaces:**
- Consumes: `tryConsumeToken` (Task 2), `enqueueForRetry` (existing).
- Produces: `publishEvent()` now rejects via the token bucket before serializing, throws
  synchronously on an oversized/non-finite-number payload (never reaching the retry queue), and
  otherwise behaves as before.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/events/__tests__/publishEvent.test.ts`:

```ts
  it('routes a token-bucket rejection to the retry queue as a transient failure, without touching db.execute', async () => {
    const { tryConsumeToken } = await import('@/services/events/publishRateLimiter')
    vi.mocked(tryConsumeToken).mockReturnValueOnce(false)
    await publishEvent(baseEvent)
    expect(db.execute).toHaveBeenCalledTimes(1) // only the retry-queue insert, not the events insert
    const [sql] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('local_event_publish_retries')
  })

  it('throws synchronously on an oversized payload, before any db.execute call', async () => {
    const bigPayload = { note: 'x'.repeat(20_000) }
    await expect(publishEvent({ ...baseEvent, payload: bigPayload })).rejects.toThrow(/exceeds/)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('throws synchronously on a NaN/Infinity field, before any db.execute call', async () => {
    const badPayload = { amountUsd: NaN }
    await expect(publishEvent({ ...baseEvent, payload: badPayload })).rejects.toThrow(/non-finite/)
    expect(db.execute).not.toHaveBeenCalled()
  })
```

Add the mock at the top of the file, alongside the existing `db` mock:

```ts
vi.mock('@/services/events/publishRateLimiter', () => ({ tryConsumeToken: vi.fn().mockReturnValue(true) }))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/publishEvent.test.ts`
Expected: FAIL — `publishEvent` doesn't check the token bucket or validate the payload yet.

- [ ] **Step 3: Implement**

```ts
// src/services/events/publishEvent.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { enqueueForRetry } from './eventPublishRetryQueue'
import { tryConsumeToken } from './publishRateLimiter'
import type { DomainEvent } from './domainEvent.types'

/** Dev-visibility only (WAFI-140 Sprint 1) -- not owner-facing alerting. */
export const eventPublishFailureCount = ref(0)

const MAX_PAYLOAD_BYTES = 16_384
// The largest of all 17 wired payload shapes today serializes to well under 1 KB. 16 KB
// gives over an order of magnitude of headroom for legitimate growth while still catching a
// genuinely runaway/malformed value (design spec §6b).

// Walks the payload for NaN/±Infinity specifically (the values JSON.stringify silently
// turns into `null` rather than erroring on). Cycle safety: event payloads are required to
// be JSON-serializable object graphs without cycles -- a cyclic payload would already throw
// inside JSON.stringify (called before this function runs, in publishEvent below) with
// "Converting circular structure to JSON," so this walk never actually encounters a cycle in
// practice, but carries no cycle-detection of its own regardless (design spec §6b).
function containsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(containsNonFiniteNumber)
  if (value && typeof value === 'object') return Object.values(value).some(containsNonFiniteNumber)
  return false
}

export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  if (!tryConsumeToken()) {
    eventPublishFailureCount.value += 1
    await enqueueForRetry(event, 'client_rate_limit_exceeded').catch(() => {})
    return
  }

  const serialized = JSON.stringify(event.payload)
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) {
    throw new Error(`event payload exceeds ${MAX_PAYLOAD_BYTES} bytes: ${event.type}`)
  }
  if (containsNonFiniteNumber(event.payload)) {
    throw new Error(`event payload contains a non-finite number (NaN/Infinity): ${event.type}`)
  }

  try {
    await db.execute(
      `insert into events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(), event.type, event.entityId, serialized,
        event.payloadVersion, event.staffId, event.shopId, event.occurredAt, new Date().toISOString(),
      ],
    )
  } catch (err) {
    eventPublishFailureCount.value += 1
    logger.error('[publishEvent] failed to persist event, queuing for retry', event.type, err)
    await enqueueForRetry(event, err instanceof Error ? err.message : String(err)).catch(() => {})
  }
}
```

(`serialized` is now computed once and reused for the `db.execute` insert, rather than
re-stringifying `event.payload` a second time inside the SQL params array — a small
deduplication that falls out naturally from adding the size check, not a separate change.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/publishEvent.test.ts`
Expected: PASS, full file (existing tests plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/services/events/publishEvent.ts src/services/events/__tests__/publishEvent.test.ts
git commit -m "feat(WAFI-140): wire rate-limit token bucket and payload validation into publishEvent"
```

---

### Task 5: Retry backoff jitter

**Files:**
- Modify: `src/services/events/eventPublishRetryQueue.ts`
- Test: `src/services/events/__tests__/eventPublishRetryQueue.test.ts`

**Interfaces:**
- Modifies: `nextRetryAt(attempts: number): string` — same signature, now returns a
  jittered timestamp. No consumer-visible interface change (the function was already internal to
  this module).

- [ ] **Step 1: Write the failing test**

Add to `src/services/events/__tests__/eventPublishRetryQueue.test.ts`:

```ts
  it('jitters next_retry_at by roughly ±20% of the base backoff, across many samples', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-05T00:00:00.000Z'))
    const baseMs = 60_000 // 1 min, attempts = 0
    const samples: number[] = []
    for (let i = 0; i < 50; i++) {
      await enqueueForRetry(event, 'database is locked')
      const [, params] = vi.mocked(db.execute).mock.calls.at(-1)!
      const nextRetryAt = new Date(params[5] as string).getTime()
      samples.push(nextRetryAt - Date.now())
    }
    // every sample must fall within the documented ±20% band around the base backoff
    for (const delta of samples) {
      expect(delta).toBeGreaterThanOrEqual(baseMs * 0.8)
      expect(delta).toBeLessThanOrEqual(baseMs * 1.2)
    }
    // and it must not be a constant (i.e. jitter is actually applied, not a no-op)
    expect(new Set(samples).size).toBeGreaterThan(1)
    vi.useRealTimers()
  })
```

(Adjust the `params[5]` index if the existing `enqueueForRetry` params array ordering differs —
confirm against the current implementation's `values (?, ?, ?, ?, ?, ?, ?)` param list, which is
`[id, serialized_event, failureKind, attempts, errorMessage, next_retry_at, created_at]`, i.e.
index 5.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/eventPublishRetryQueue.test.ts`
Expected: FAIL — current `nextRetryAt` is deterministic, all 50 samples identical.

- [ ] **Step 3: Add jitter**

```ts
// src/services/events/eventPublishRetryQueue.ts
function nextRetryAt(attempts: number): string {
  const baseMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  // ±20% jitter (design spec §8b) so a batch of events that failed together doesn't all
  // become due for retry at exactly the same synchronized moment.
  const jitter = 0.8 + Math.random() * 0.4
  return new Date(Date.now() + baseMinutes * 60_000 * jitter).toISOString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/eventPublishRetryQueue.test.ts`
Expected: PASS, full file (existing tests are unaffected by jitter since they only assert
`toHaveBeenCalledWith(expect.stringContaining(...))`/classification, not the exact timestamp).

- [ ] **Step 5: Commit**

```bash
git add src/services/events/eventPublishRetryQueue.ts src/services/events/__tests__/eventPublishRetryQueue.test.ts
git commit -m "feat(WAFI-140): add ±20% jitter to retry backoff schedule"
```

---

### Task 6: Server-side rate-limit trigger (migration 076)

**Files:**
- Create: `supabase/migrations/076_events_rate_limit.sql`

**Interfaces:**
- Produces: `public.enforce_events_rate_limit()` trigger function, `events_rate_limit_trigger`,
  `events_shop_created_at_idx` index. Task 8 (pgTAP suite) depends on the trigger raising the exact
  message `events_rate_limit_exceeded`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/076_events_rate_limit.sql
-- WAFI-140 Sprint 3 -- server-side rate limit on events inserts (design spec §4b). The
-- real boundary; the client-side token bucket (publishRateLimiter.ts) is a cheap first
-- line of defense in front of this, not a replacement for it.

CREATE OR REPLACE FUNCTION public.enforce_events_rate_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  -- created_at (wall-clock insert time), not occurred_at (business time) -- deliberately:
  -- occurred_at can be backdated by the retry queue replaying an event whose original
  -- occurredAt is hours old (Sprint 2 design spec §4), so filtering on it would
  -- under-count a burst of genuinely simultaneous inserts that happen to carry old
  -- business timestamps. created_at is always "when this row actually landed."
  SELECT count(*) INTO v_count FROM public.events
  WHERE shop_id = NEW.shop_id AND created_at > now() - interval '1 minute';
  -- Intentionally approximate under concurrent inserts, not exact: two concurrent
  -- transactions can each observe a count below 500 before either commits, so the real
  -- cap under concurrency is "500 plus however many inserts were in flight at the same
  -- instant." Acceptable for this project's workload -- the goal is abuse prevention
  -- (stopping a runaway loop), not an exact quota.
  IF v_count >= 500 THEN
    RAISE EXCEPTION 'events_rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_rate_limit_trigger ON public.events;
CREATE TRIGGER events_rate_limit_trigger
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_events_rate_limit();

-- events_shop_type_idx (shop_id, type, occurred_at DESC), from 074_events_bus_core.sql,
-- does NOT cover this trigger's created_at filter -- a query on (shop_id, created_at)
-- only gets partial benefit (the shop_id equality) from that index, not the range
-- condition. Without a dedicated index, this trigger degrades to a shop_id-filtered
-- sequential scan on every single insert.
--
-- Known scaling ceiling (design spec §4b), not a problem at this project's expected
-- scale (a single part-time shop): a count(*)-per-insert check itself becomes the
-- bottleneck once per-shop insert rates approach several hundred/second, since every
-- insert pays for scanning up to 500 prior rows. The fix at that point is a rolling
-- counter table (one row per (shop_id, minute_bucket), incremented via ON CONFLICT DO
-- UPDATE), not re-tuning this count(*) approach -- flagged here so a future ticket
-- scaling past single-shop volume doesn't rediscover this from a production slowdown.
CREATE INDEX IF NOT EXISTS events_shop_created_at_idx ON public.events (shop_id, created_at);
```

- [ ] **Step 2: Apply the migration to the local Supabase stack**

Run: `npx supabase migration up` (or the project's established local-apply command — check
`package.json` scripts / `README.md` for the exact command this repo uses before running).
Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/076_events_rate_limit.sql
git commit -m "feat(WAFI-140): add server-side rate-limit trigger on events inserts"
```

---

### Task 7: Per-event-type RLS (migration 077)

**Files:**
- Create: `supabase/migrations/077_events_per_type_rls.sql`

**Interfaces:**
- Consumes: `public.can(flag text)` (existing, migration 054), the sensitivity mapping from Task 1's
  `EVENT_SENSITIVITY` (mirrored here in SQL — see Task 1's process-rule note: this file IS the
  matching SQL branch, kept in sync manually and verified by Task 9's pgTAP test).
- Produces: replaces `events_select_all` (migration 074) with `events_select_scoped`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/077_events_per_type_rls.sql
-- WAFI-140 Sprint 3 -- per-event-type RLS (design spec §3). Reuses the existing
-- permission framework (public.can(), migration 054) -- the identical pattern already
-- governing staff_ledger/staff_settlements (migration 060's
-- staff_ledger_select_permission). No new mechanism.
--
-- This CASE's WHEN branches must exactly match the non-'public' keys of
-- EVENT_SENSITIVITY in src/services/events/domainEvent.types.ts (Task 1) -- verified by
-- the pgTAP cross-check test in wafi140_events_rls.test.sql (Task 9), not by anything in
-- this file. If you add a WHEN branch here, add the matching TS registry entry too, and
-- vice versa.

DROP POLICY IF EXISTS events_select_all ON public.events;
DROP POLICY IF EXISTS events_select_scoped ON public.events;
CREATE POLICY events_select_scoped ON public.events
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND CASE type
      WHEN 'staff.ledger_entry_added' THEN public.can('can_view_staff_ledger')
      WHEN 'settlement.paid'          THEN public.can('can_view_staff_ledger')
      WHEN 'expense.recorded'         THEN public.can('can_view_expenses')
      WHEN 'product.cost_updated'     THEN public.can('can_view_reports')
      ELSE true
    END
  );

-- INSERT stays ungated by permission (unchanged from 074_events_bus_core.sql's
-- events_insert_all) -- a writer is already gated by the source table's own RLS (you
-- cannot produce a staff.ledger_entry_added event without first being able to write the
-- underlying staff_ledger row); double-gating the event insert would be redundant, not
-- a real additional boundary.
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up` (same command as Task 6).
Expected: migration applies cleanly.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/077_events_per_type_rls.sql
git commit -m "feat(WAFI-140): add per-event-type RLS on events select policy"
```

---

### Task 8: Extend pgTAP suite — cross-tenant, rate limit, per-type RLS

**Files:**
- Modify: `supabase/tests/wafi140_events_rls.test.sql`

**Interfaces:**
- Consumes: `events_rate_limit_trigger` (Task 6), `events_select_scoped` (Task 7).
- Produces: no new exports — this is a test-only task. Increases the file's `plan()` count.

- [ ] **Step 1: Update the plan count and add new fixtures**

Current file has `SELECT plan(6);` and fixtures for two shops (`e0000000...0001`/`...0003`), one
owner each. Add a cashier and manager for Shop 1 (needed for per-type RLS assertions), and bump the
plan count. Edit the top of the file:

```sql
BEGIN;
SELECT plan(13); -- was 6; +7 for rate limit (1) and per-type RLS (6: 4 gated types x cashier-denied, 1 owner-allowed-all, 1 registry cross-check)
```

After the existing `Owner1` staff insert, add:

```sql
INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions, is_active) VALUES
  ('e0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000001', 'Cashier1', 'x', 'cashier', '{}', true);

-- One row per gated event type, plus the existing sale.completed (public) row, all Shop 1.
INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at) VALUES
  ('staff.ledger_entry_added', 'x1', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now()),
  ('settlement.paid',          'x2', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now()),
  ('expense.recorded',         'x3', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now()),
  ('product.cost_updated',     'x4', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now());
```

- [ ] **Step 2: Add the rate-limit test, right before `SELECT * FROM finish();`**

```sql
-- Rate limit: seed 500 events as Shop 1 (bypassing RLS, as postgres), then assert the
-- 501st insert -- still as postgres, still Shop 1 -- raises the trigger's exception.
-- Uses a distinct entity_id prefix ('rl-') so this block's rows don't interfere with the
-- earlier count-based assertions above (which ran before this block, so no ordering
-- hazard either way, but kept distinct for clarity).
DO $$
BEGIN
  FOR i IN 1..500 LOOP
    INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'rl-' || i, '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now());
  END LOOP;
END $$;
SELECT throws_ok(
  $$INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'rl-501', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now())$$,
  'P0001',
  'the 501st insert within a minute for the same shop is rate-limited'
);

-- Shop 2's own insert in the same window is unaffected by Shop 1's volume.
SELECT lives_ok(
  $$INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'shop2-unaffected', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000003', now())$$,
  'shop 2 insert succeeds unaffected by shop 1 hitting its rate limit'
);
```

- [ ] **Step 3: Add the per-type RLS tests**

```sql
-- Per-type RLS: cashier sees the public sale.completed rows but none of the 4 gated types.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","active_role":"cashier","staff_id":"e0000000-0000-0000-0000-000000000006"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.events WHERE type IN ('staff.ledger_entry_added','settlement.paid','expense.recorded','product.cost_updated'))::int,
  0,
  'cashier sees zero rows of any gated event type'
);
SELECT is(
  (SELECT count(*) FROM public.events WHERE type = 'sale.completed')::int > 0,
  true,
  'cashier still sees public event types'
);
RESET ROLE;

-- Owner sees all 4 gated types (can() short-circuits true for owner, migration 054).
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","active_role":"owner","staff_id":"e0000000-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.events WHERE type IN ('staff.ledger_entry_added','settlement.paid','expense.recorded','product.cost_updated'))::int,
  4,
  'owner sees all 4 gated event types'
);
RESET ROLE;
```

- [ ] **Step 4: Add the registry/SQL cross-check test**

This is the test that closes the design spec's `ELSE true` hazard (§3): it reads the *live* policy
definition (not migration file text — migrations are immutable/superseded over time, per the
design spec's explicit reasoning) and compares its gated-type set against a hardcoded list mirroring
`EVENT_SENSITIVITY`'s non-`'public'` keys.

```sql
-- Registry/SQL cross-check (design spec §3, closes the "ELSE true" hazard): extract the
-- set of `type` string literals appearing in a WHEN branch of events_select_scoped's live
-- USING expression, and assert it is EXACTLY the 4-element set that
-- EVENT_SENSITIVITY (src/services/events/domainEvent.types.ts) marks non-'public'. If a
-- future contributor adds an event to one list without the other, this assertion fails.
SELECT set_eq(
  $$
  SELECT unnest(regexp_matches(
    pg_get_expr(pg_policy.polqual, pg_policy.polrelid), 'WHEN ''([a-z._]+)''', 'g'
  ))
  FROM pg_policy
  JOIN pg_class ON pg_class.oid = pg_policy.polrelid
  WHERE pg_class.relname = 'events' AND pg_policy.polname = 'events_select_scoped'
  $$,
  $$
  VALUES ('staff.ledger_entry_added'), ('settlement.paid'), ('expense.recorded'), ('product.cost_updated')
  $$,
  'events_select_scoped''s gated type set matches EVENT_SENSITIVITY''s non-public keys exactly'
);
```

(`regexp_matches(..., 'g')` with a capture group and `unnest()` extracts one row per `WHEN
'<literal>'` match from the live policy's `USING` expression text — this only matches the *string
literal* immediately after `WHEN`, not the `THEN public.can(...)` clause, so it correctly ignores
which specific permission flag each branch checks and only compares the *set of gated types*, which
is exactly what needs to match between SQL and the TS registry.)

- [ ] **Step 5: Run the full suite**

Run: `npx supabase test db`
Expected: all assertions pass, including the new ones (final count should be 13/13 — adjust the
`plan()` number if the actual assertion count written differs from this estimate once step 1-4 are
all in place; count every `SELECT is(...)/throws_ok(...)/lives_ok(...)/set_eq(...)` call in the
final file and set `plan()` to match exactly, since pgTAP fails the run on a mismatch).

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/wafi140_events_rls.test.sql
git commit -m "test(WAFI-140): extend pgTAP suite for rate limit, per-type RLS, registry cross-check"
```

---

### Task 9: Event contract snapshot tests

**Files:**
- Create: `src/services/events/__tests__/eventContracts.test.ts`
- Create: `src/services/events/__tests__/__snapshots__/eventContracts.test.ts.snap` (generated by
  Vitest, not hand-written — see Step 3)

**Interfaces:**
- Consumes: every payload interface + `DomainEvent`/`DomainEventType` from `domainEvent.types.ts`.
- Produces: no runtime exports — a pure test file with a committed snapshot as its regression gate.

- [ ] **Step 1: Write the test file**

```ts
// src/services/events/__tests__/eventContracts.test.ts
import { describe, it, expect } from 'vitest'
import type {
  DomainEvent, DomainEventType,
  SaleCompletedPayload, ReturnedPayload, DebtChangedPayload, InstallmentDuePaidPayload,
  CashMovementRecordedPayload, StockTakenPayload, StockReceivedPayload,
  ShiftOpenedPayload, ShiftClosedPayload, InventoryAdjustedPayload,
  ProductPriceChangedPayload, ProductCostUpdatedPayload, ProductCreatedPayload,
  StaffLedgerEntryAddedPayload, SettlementPaidPayload, ExpenseRecordedPayload,
  DeviceRegisteredPayload,
} from '@/services/events/domainEvent.types'

// Every field fixed to a literal value -- occurredAt/staffId/shopId are NOT generated at
// test time, specifically so the snapshot is stable across runs (design spec §5).
const V = 1
const STAFF = 's1'
const SHOP = 'shop1'
const WHEN = '2026-08-05T00:00:00.000Z'

const FIXTURES: Record<DomainEventType, DomainEvent> = {
  'sale.completed': {
    type: 'sale.completed', entityId: 'sale1',
    payload: {
      saleId: 'sale1', shopId: SHOP, staffId: STAFF, totalUsd: 10, totalSyp: 150000,
      paymentSummary: { cashUsd: 10, cashSyp: 0, cardTotal: 0, creditTotal: 0, methodCount: 1 },
      itemCount: 2, discountApplied: false,
    } satisfies SaleCompletedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'sale.returned': {
    type: 'sale.returned', entityId: 'r1',
    payload: { returnId: 'r1', saleId: 'sale1', refundAmountUsd: 5, restockedItemCount: 1 } satisfies ReturnedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'customer.debt_changed': {
    type: 'customer.debt_changed', entityId: 'c1',
    payload: { customerId: 'c1', deltaUsd: -5, newBalanceUsd: 10, reason: 'return' } satisfies DebtChangedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'installment.due_paid': {
    type: 'installment.due_paid', entityId: 'c1',
    payload: { customerId: 'c1', amount: 20, remainingBalance: 80 } satisfies InstallmentDuePaidPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'cash.movement_recorded': {
    type: 'cash.movement_recorded', entityId: 'm1',
    payload: { movementId: 'm1', shiftId: 'sh1', direction: 'in', category: 'float_topup', currency: 'USD', amountUsd: 20 } satisfies CashMovementRecordedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'stock.taken': {
    type: 'stock.taken', entityId: 'st1',
    payload: { sessionId: 'st1', productCount: 10, unexplainedVarianceCount: 0 } satisfies StockTakenPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'stock.received': {
    type: 'stock.received', entityId: 'rc1',
    payload: { receivingId: 'rc1', supplierId: 'sup1', skuCount: 5, totalCost: 100 } satisfies StockReceivedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'shift.opened': {
    type: 'shift.opened', entityId: 'sh1',
    payload: { shiftId: 'sh1', staffId: STAFF, openingCash: 50 } satisfies ShiftOpenedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'shift.closed': {
    type: 'shift.closed', entityId: 'sh1',
    payload: { shiftId: 'sh1', staffId: STAFF, expectedCash: 100, countedCash: 98, variance: -2 } satisfies ShiftClosedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'inventory.adjusted': {
    type: 'inventory.adjusted', entityId: 'p1',
    payload: { productId: 'p1', deltaQty: -3, reason: 'damaged' } satisfies InventoryAdjustedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'product.price_changed': {
    type: 'product.price_changed', entityId: 'p1',
    payload: { productId: 'p1', oldPriceUsd: 10, newPriceUsd: 12 } satisfies ProductPriceChangedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'product.cost_updated': {
    type: 'product.cost_updated', entityId: 'p1',
    payload: { productId: 'p1', oldCostUsd: 5, newCostUsd: 6 } satisfies ProductCostUpdatedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'product.created': {
    type: 'product.created', entityId: 'p1',
    payload: { productId: 'p1', name: 'Widget', categoryId: null } satisfies ProductCreatedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'staff.ledger_entry_added': {
    type: 'staff.ledger_entry_added', entityId: STAFF,
    payload: { staffId: STAFF, entryType: 'advance', amount: 15 } satisfies StaffLedgerEntryAddedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'settlement.paid': {
    type: 'settlement.paid', entityId: STAFF,
    payload: { staffId: STAFF, amount: 15, ledgerBalanceAfter: 0 } satisfies SettlementPaidPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'expense.recorded': {
    type: 'expense.recorded', entityId: 'e1',
    payload: { expenseId: 'e1', category: 'صيانة', amountUsd: 50, staffId: STAFF, photoUrl: undefined } satisfies ExpenseRecordedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'device.registered': {
    type: 'device.registered', entityId: 'd1',
    payload: { deviceId: 'd1', deviceCode: 'ABC123', isTemporary: false } satisfies DeviceRegisteredPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
}

describe.each(Object.entries(FIXTURES))('event contract: %s', (_type, fixture) => {
  it('matches its committed shape snapshot', () => {
    expect(fixture).toMatchSnapshot()
  })
})
```

(`entryType: 'advance'` and `reason: 'damaged'` — confirm these are valid members of
`StaffLedgerEntryType`/`AdjustmentReason` respectively before running; if either type's real union
doesn't include that literal, substitute any other valid member of that same union — the exact
value doesn't matter for this test, only that it type-checks.)

- [ ] **Step 2: Run type-check first**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS. If it fails on `entryType`/`reason`, check the actual union members in
`src/features/staff-ledger/staff-ledger.types.ts` / `src/features/products/product.types.ts` and
substitute a valid literal.

- [ ] **Step 3: Run the test to generate the initial snapshot**

Run: `npx vitest run src/services/events/__tests__/eventContracts.test.ts`
Expected: PASS, 17/17 — Vitest creates `__snapshots__/eventContracts.test.ts.snap` on first run
since no snapshot exists yet to compare against.

- [ ] **Step 4: Verify the generated snapshot file**

Read `src/services/events/__tests__/__snapshots__/eventContracts.test.ts.snap` and confirm it
contains 17 entries, one per event type, each showing the full `DomainEvent` envelope (not just the
payload) — this is what makes an `entityId` rename (not just a payload field rename) show up as a
snapshot diff in the future.

- [ ] **Step 5: Commit**

```bash
git add src/services/events/__tests__/eventContracts.test.ts src/services/events/__tests__/__snapshots__/eventContracts.test.ts.snap
git commit -m "test(WAFI-140): add event contract snapshot tests for all 17 wired event types"
```

---

### Task 10: `cleanupLocalEventTables()` + sweeper

**Files:**
- Create: `src/services/events/cleanupLocalEventTables.ts`
- Test: `src/services/events/__tests__/cleanupLocalEventTables.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`, `logger`.
- Produces: `cleanupLocalEventTables(): Promise<void>`,
  `startEventTableCleanupSweeper(): { stop: () => void }`. Task 12 (`App.vue` wiring) depends on the
  latter's exact name.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/cleanupLocalEventTables.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { cleanupLocalEventTables, startEventTableCleanupSweeper } from '@/services/events/cleanupLocalEventTables'

describe('cleanupLocalEventTables', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes ledger rows whose event_id no longer exists in events', async () => {
    await cleanupLocalEventTables()
    const call = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processed_ledger'))
    expect(call).toBeDefined()
    expect(call![0]).toContain('not exists')
    expect(call![0]).not.toContain('not in')
  })

  it('deletes only permanent retry rows older than 90 days, leaves transient rows untouched', async () => {
    await cleanupLocalEventTables()
    const call = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_publish_retries'))
    expect(call).toBeDefined()
    expect(call![0]).toContain(`failure_kind = 'permanent'`)
  })
})

describe('startEventTableCleanupSweeper', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs cleanup once on start and again on every reconnect transition', () => {
    let capturedListener: any
    vi.mocked(db.registerListener).mockImplementation((listener: any) => {
      capturedListener = listener
      return () => {}
    })
    startEventTableCleanupSweeper()
    expect(db.execute).toHaveBeenCalled() // the initial run
    vi.clearAllMocks()
    capturedListener.statusChanged({ connected: true })
    expect(db.execute).toHaveBeenCalled() // the reconnect-triggered run
  })

  it('stop() unsubscribes the reconnect listener', () => {
    const unsubscribe = vi.fn()
    vi.mocked(db.registerListener).mockReturnValue(unsubscribe)
    const { stop } = startEventTableCleanupSweeper()
    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/cleanupLocalEventTables.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/services/events/cleanupLocalEventTables.ts
import { db } from '@/data/powersync/db'

/** Bounds local-only table growth (WAFI-140 Sprint 3 design spec §8a). Steps 1/3 of
 *  Sprint 2's cleanup() shape (§4a of that spec) are a PowerSync sync-rule change,
 *  configured outside this repo -- not implemented here. This covers steps 2/4:
 *  pruning the two local-only tables this sprint's earlier work introduced. */
export async function cleanupLocalEventTables(): Promise<void> {
  // Step 2: a ledger row referencing an event_id no longer present in the local
  // (sync-rule-scoped) events table can never be re-processed anyway. NOT EXISTS, not
  // NOT IN -- NOT IN has a NULL-handling trap (a NULL in the subquery makes every `NOT
  // IN` comparison UNKNOWN, matching nothing); events.id is a NOT NULL uuid primary key
  // so that trap can't fire here today, but NOT EXISTS carries no such caveat at all.
  await db.execute(
    `delete from local_event_processed_ledger l
     where not exists (select 1 from events e where e.id = l.event_id)`,
  )
  // Step 4: independent of the events cutoff -- only rows already flagged for manual
  // inspection (permanent, per eventPublishRetryQueue.ts's exhausted-retry flip to
  // 'permanent') persist past their own resolution window.
  await db.execute(
    `delete from local_event_publish_retries
     where failure_kind = 'permanent' and created_at < ?`,
    [new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString()],
  )
}

/** Runs cleanup once on start and on every PowerSync reconnect transition -- same
 *  reconnect-listener mechanism startRetryQueueSweeper() already uses (Sprint 2),
 *  reused rather than a new polling timer. App-start-only would leave a device that
 *  stays open for weeks without restarting between cleanups for a long time; reconnects
 *  happen far more often than restarts on such a device. */
export function startEventTableCleanupSweeper(): { stop: () => void } {
  void cleanupLocalEventTables()
  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void cleanupLocalEventTables()
    },
  })
  return { stop: () => unsubscribe?.() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/cleanupLocalEventTables.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/services/events/cleanupLocalEventTables.ts src/services/events/__tests__/cleanupLocalEventTables.test.ts
git commit -m "feat(WAFI-140): add local event-table cleanup with reconnect sweeper"
```

---

### Task 11: Fix dormant `startDailyEventCountsProjection` + wire cleanup sweeper into `App.vue`

**Files:**
- Modify: `src/App.vue`
- Test: `src/App.test.ts` if it exists (check with `find src -maxdepth 1 -iname "App.test.ts"` — if
  no existing App-level test file exists, add the regression assertion to whichever test file
  already exercises `App.vue`'s `onMounted` gating logic; grep `startRetryQueueSweeper` inside
  `src/**/__tests__` first to find that file's exact location, since Sprint 2's final-review fix
  that wired `startRetryQueueSweeper()` must already have a regression test to extend)

**Interfaces:**
- Consumes: `startDailyEventCountsProjection` (existing, `dailyEventCountsProjection.ts`),
  `startEventTableCleanupSweeper` (Task 10).
- Produces: both are now called from `App.vue`'s `onMounted`, alongside the existing
  `startRetryQueueSweeper()` call.

- [ ] **Step 1: Locate the existing regression test for the Sprint 2 dormancy fix**

Run: `grep -rl "startRetryQueueSweeper" src --include=*.test.ts`
Expected: one file — read it to find the exact mocking pattern used to assert `App.vue`'s
`onMounted` calls a given starter function (it will mock `@/services/events/eventPublishRetryQueue`
and assert `startRetryQueueSweeper` was called after mount).

- [ ] **Step 2: Write the failing tests**

Add two tests to that same file, mirroring its existing `startRetryQueueSweeper` assertion's setup
exactly (same mount helper, same gating fixture — i.e. whatever makes `hasAnyStaff()` resolve
`true` in that file's existing test):

```ts
  it('starts the daily-event-counts projection on mount (Sprint 1 dormancy fix)', async () => {
    const { startDailyEventCountsProjection } = await import('@/services/events/dailyEventCountsProjection')
    // ...mount App.vue using this file's existing helper/fixture for the "staff exists" path...
    expect(startDailyEventCountsProjection).toHaveBeenCalled()
  })

  it('starts the event-table cleanup sweeper on mount', async () => {
    const { startEventTableCleanupSweeper } = await import('@/services/events/cleanupLocalEventTables')
    // ...same mount helper as above...
    expect(startEventTableCleanupSweeper).toHaveBeenCalled()
  })
```

Add the corresponding `vi.mock(...)` calls for both modules at the top of the file, alongside the
existing `vi.mock('@/services/events/eventPublishRetryQueue', ...)` mock.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run <the file found in Step 1>`
Expected: FAIL — `App.vue` doesn't call either function yet.

- [ ] **Step 4: Wire both into `App.vue`**

In `src/App.vue`, add the imports near the existing `startRetryQueueSweeper` import (line ~21):

```ts
import { startRetryQueueSweeper } from '@/services/events/eventPublishRetryQueue'
import { startDailyEventCountsProjection } from '@/services/events/dailyEventCountsProjection'
import { startEventTableCleanupSweeper } from '@/services/events/cleanupLocalEventTables'
```

Replace the `onMounted` block's existing sweeper-start comment/call (around line 111-117):

```ts
  // WAFI-140 Sprint 2 final review fix: start the event-publish retry queue
  // sweeper once, at app startup, only after device/shop context is known
  // (staffExist true means refreshShopId() above has already resolved a real
  // shop_id) -- the same gating loadActiveShift() above relies on.
  startRetryQueueSweeper()

  // WAFI-140 Sprint 3: startDailyEventCountsProjection (Sprint 1) had the identical
  // dormancy bug -- confirmed via codebase-wide grep for useEventSubscription( turning
  // up zero callers outside its own test file -- flagged in the Sprint 2 final-review
  // commit (a064079) for follow-up rather than fixed on the spot. Fixed here, gated
  // identically to the retry sweeper above.
  startDailyEventCountsProjection(useDeviceStore().shopId)

  // WAFI-140 Sprint 3: bounds local_event_processed_ledger/local_event_publish_retries
  // growth (design spec §8a) -- same gating and reconnect-listener mechanism as the
  // retry sweeper above.
  startEventTableCleanupSweeper()
```

(Confirm `useDeviceStore().shopId` is the correct accessor at this point in `onMounted` — it's
already called earlier in the same function via `useDeviceStore().refreshShopId()`; use the same
store instance's `.shopId` ref value, not a fresh unrelated call, matching how `shopId` is threaded
through this function already for `hasAnyStaff()`/`loadActiveShift()` above it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run <the file found in Step 1>`
Expected: PASS, full file.

- [ ] **Step 6: Run the full test suite (regression check)**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/App.vue <the test file from Step 1>
git commit -m "fix(WAFI-140): wire dormant daily-event-counts projection and cleanup sweeper into App.vue"
```

---

### Task 12: Role-downgrade integration test

**Files:**
- Modify: `src/services/events/__tests__/useEventSubscription.test.ts`

**Interfaces:**
- No production code changes — this task adds a regression test proving the prose claim in design
  spec §3 (a role downgrade takes effect on the next sync tick) actually holds for
  `useEventSubscription`'s existing behavior once the sync stream itself reflects the new RLS
  result.

- [ ] **Step 1: Write the test**

Add to the existing `describe('useEventSubscription', ...)` block, reusing the file's existing
`fakeAsyncIterable` helper:

```ts
  it('stops receiving a gated event type once the sync stream reflects a role downgrade', async () => {
    // Simulates: device syncs as owner (sees expense.recorded), operator switches to
    // cashier, next sync cycle re-evaluates RLS server-side and the watch stream's next
    // emission simply no longer includes gated rows. This test proves
    // useEventSubscription's handler reacts correctly to that changed result set -- the
    // RLS enforcement itself is proven separately by the pgTAP suite (Task 8); this test
    // is what exercises the client-side consequence end to end.
    const gatedRow = {
      id: 'e1', type: 'expense.recorded', payload: '{"expenseId":"exp1"}',
      payload_version: 1, shop_id: 'shop-1', occurred_at: '2026-08-05T10:00:00.000Z',
    }
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [gatedRow] } },       // owner: sees the gated row
      { rows: { _array: [] } },                // post-downgrade: RLS filters it out entirely
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription('expense.recorded' as any, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(handler).toHaveBeenCalledTimes(1) // only the pre-downgrade emission
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))
    stop()
  })
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/services/events/__tests__/useEventSubscription.test.ts`
Expected: PASS immediately (this test exercises existing, already-correct behavior — the
watermark/no-double-forward logic already handles "fewer rows in the next emission" correctly
since it only ever *adds* newly-seen rows, never removes previously-forwarded ones; this task adds
coverage, not new behavior). If it fails, that indicates an actual regression in
`useEventSubscription.ts` worth investigating before proceeding, not a plan error to paper over.

- [ ] **Step 3: Commit**

```bash
git add src/services/events/__tests__/useEventSubscription.test.ts
git commit -m "test(WAFI-140): add role-downgrade regression test for useEventSubscription"
```

---

### Task 13: Documentation — domain matrix + readiness plan status

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md`
- Modify: `WAFI_Production_Readiness_Plan_v3.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the DOMAIN INTERACTION MATRIX row**

In `AI_PRINCIPAL_ENGINEER_REVIEW.md`, find the `| Events |` row (search for `| Events |`) and
replace it:

```markdown
| Events | `events`, `daily_event_counts`, `local_event_processed_ledger` (local-only), `local_event_publish_retries` (local-only) | Sales, Returns, Customer Credit, Inventory, Staff, Expense, Cash/Shifts, Products, Suppliers, Devices (all event producers); Identity (`auth_role()`/`can()` for per-type RLS) | `useEventSubscription`, `processProjectionAtMostOnce`, `retryPendingEventPublishes`, `isTransientPublishFailure`, `getRetryQueueStats`, `cleanupLocalEventTables`, `startEventTableCleanupSweeper`, `tryConsumeToken`, `enforce_events_rate_limit` (SQL trigger) | none yet (still no user-facing consumer — WAFI-143/144/145/146) |
```

(`EVENT_SENSITIVITY` is deliberately omitted from "Key composables" — it's a static classification
registry, not a composable consumers call at runtime.)

- [ ] **Step 2: Update the readiness plan status line**

In `WAFI_Production_Readiness_Plan_v3.md`, find the `Macro-Phase 2` row and update it, following
the exact pattern of the prior Sprint 2 status update (commit `651bd1c`):

```markdown
| Macro-Phase 2 (WAFI-152, WAFI-140, WAFI-150/143/144/145/146/142) | 🟡 In progress — WAFI-152 shipped 2026-07-31, WAFI-140 Sprint 1 shipped 2026-08-01, WAFI-140 Sprint 2 shipped 2026-08-04, WAFI-140 Sprint 3 shipped 2026-08-05 | WAFI-152 (Business Services Layer) done. WAFI-140 Sprint 1 (event bus core) done. WAFI-140 Sprint 2 (idempotency ledger, publish-failure retry queue, 8 more events) done. WAFI-140 Sprint 3 (final sprint: per-event-type RLS via EVENT_SENSITIVITY registry + can(), client+server rate limiting with token bucket and Postgres trigger, event contract snapshot tests for all 17 wired types, cross-tenant/rate-limit/per-type-RLS/registry-cross-check pgTAP coverage, 90-day retention via PowerSync sync-rule scoping (config outside this repo) + local table cleanup sweeper, retry backoff jitter, and a fix for the dormant Sprint 1 daily-event-counts projection) done -- **WAFI-140 is now fully closed, all 3 sprints shipped**. WAFI-150/143/144/145/146/142 not started.  |
```

(Adjust the date if implementation actually completes on a different day than this plan's authoring
date.)

- [ ] **Step 3: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md WAFI_Production_Readiness_Plan_v3.md
git commit -m "docs(WAFI-140): update domain matrix and readiness plan status for Sprint 3, close out WAFI-140"
```

---

## Final verification

- [ ] Run: `npx vitest run` — full suite passes, no regressions.
- [ ] Run: `npx vue-tsc -b --noEmit` — clean.
- [ ] Run: `npx supabase test db` — full pgTAP suite passes, including the extended
  `wafi140_events_rls.test.sql`.
- [ ] Manually confirm the PowerSync sync-rule 90-day scoping change (design spec §8a) is applied in
  the PowerSync dashboard/config — this is configured outside this repository and is **not**
  verifiable by any test in this codebase; track it as a separate deployment checklist item, not a
  task here.
