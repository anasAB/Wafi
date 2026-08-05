# WAFI-140 Sprint 3 — Security Hardening, Rate Limiting, RLS, Contract Tests (Design Spec)

**Status:** Draft — pending user review
**Date:** 2026-08-05
**Scope:** Sprint 3 of 3 for WAFI-140 (Business Event & Automation Platform) — the **final** sprint.
Sprint 1 (`2026-07-31-wafi-140-event-bus-sprint1-design.md`) shipped the core bus. Sprint 2
(`2026-08-03-wafi-140-event-bus-sprint2-design.md`) shipped idempotency, offline replay, and 8 more
events, explicitly naming Sprint 3's scope as "security hardening, rate limiting, event contract
tests, per-event-type RLS." This spec covers those four areas plus three smaller items Sprint 2
explicitly deferred (retention/cleanup, retry backoff jitter, a dormant-subscriber bug pattern) and
records a design-only appendix for cross-device dedup.

---

## 1. Problem

Sprint 2 shipped idempotency and offline replay but explicitly deferred everything
security/governance-shaped:

- **No per-event-type access control.** Any authenticated device in a shop can read every event
  type, including `expense.recorded`, `staff.ledger_entry_added`, and `settlement.paid` — data this
  codebase already treats as sensitive on its *source* tables (WAFI-058, WAFI-122) but does not yet
  restrict on the *events* projection of that same data.
- **No rate limiting.** A runaway publisher (a bug causing a watch-query loop, or a compromised
  client) can flood `events` and the retry queue with no backstop.
- **No contract enforcement.** 17 event types now exist across two sprints with typed payload
  interfaces, but nothing fails CI if a future edit silently changes a shape that a real or future
  consumer depends on — the `payloadVersion` policy (Sprint 1 §4) is documented, not enforced.
- **No cross-tenant regression coverage, no input validation, no reviewed data-at-rest posture** on
  the two new local-only tables Sprint 2 added.

Also carried over, found during Sprint 2's final-branch review but out of that sprint's scope:
`startDailyEventCountsProjection` (Sprint 1) has the same "never actually wired to a caller"
dormancy bug the final-review pass found and fixed for `startRetryQueueSweeper`.

## 2. Non-goals

- **Cross-device dedup — design only, not implemented.** Audited: `dailyEventCountsProjection` is
  the only subscriber that exists anywhere in this codebase today, and it is explicitly documented
  (Sprint 2 §3) as a best-effort dashboard number that does not need exact-once-across-devices
  correctness. Building a synced ledger + RLS + conflict-resolution mechanism now would be designing
  and testing machinery against a hypothetical future subscriber, not a real one — the same
  discipline Sprint 2 itself applied when auditing which events had a real write site (§5 of that
  spec) before wiring them. §7 below records the design so a future ticket adding a real
  exact-once-sensitive subscriber has a starting point, without this sprint building or testing it.
- **The 8 events Sprint 2 deferred** (`sale.voided`, `credit.limit_changed`, etc.) — still no real
  write site; unchanged from Sprint 2's posture.
- **Dashboard/notification/report consumers actually reading these events** — WAFI-143/144/145/146,
  unchanged.
- **Migrating `audit_log` to be event-driven** — WAFI-150, unchanged.
- **Strict event ordering** — unchanged from Sprint 1/2's explicit non-goal; subscribers still must
  sort by `occurred_at` themselves if order matters.

## 3. Per-event-type RLS

Reuses the existing permission framework (`public.auth_role()`, `public.can(flag)`, migration 054)
rather than inventing new mechanism — this is the identical pattern already governing
`staff_ledger`/`staff_settlements` (migration 060, `staff_ledger_select_permission`).

`events`' single `SELECT` policy currently checks only `shop_id` (migration 074). It becomes a
`CASE`-based check keyed on `type`:

```sql
-- supabase/migrations/0NN_events_per_type_rls.sql
DROP POLICY IF EXISTS events_select_all ON public.events;
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
```

**The `ELSE true` default is a real hazard, called out explicitly rather than left implicit.** A
future contributor adding event type #18 (e.g. `supplier.bank_account_changed`) can forget to touch
this migration entirely — nothing forces them to, and the silent result is that the new event falls
through to `ELSE true`: readable by every role in the shop, including a sensitive one, with zero
error or warning anywhere. "Remember to update the SQL" is not a control, it's a hope. This sprint
closes that gap with an explicit, exhaustive TS registry plus a test that fails the moment the
registry and the live SQL policy disagree — turning "someone forgot" into "the build fails until
someone decides":

```ts
// Appended to src/services/events/domainEvent.types.ts (not a separate eventSensitivity.ts) --
// this registry is part of the event model itself, keyed on DomainEventType and using
// StaffPermissionFlag, both already defined in this file. Living beside the type union it's
// exhaustive over keeps the "every DomainEventType needs an entry" invariant visibly close to
// the type it constrains, rather than in a separate module a reader has to go find.
// Single source of truth for event-type sensitivity classification. Every DomainEventType MUST
// have an entry -- the Record type below is exhaustive by construction, so adding a new event
// type without adding a row here is a TypeScript compile error, not a silent gap.
//
// This registry does NOT generate the SQL policy (no build step wires TS into migrations in
// this codebase) -- it is the documented, type-checked intent, cross-verified against the real
// policy text by a SQL verification test (see events isolation suite, §6a) that parses the
// live `events_select_scoped` policy definition and asserts every non-'public' entry here has
// a matching WHEN branch, and every WHEN branch in the SQL has a matching non-'public' entry
// here. Two independent lists, one automated equality check between them -- neither list can
// silently drift from the other without a failing test.
export type EventSensitivity = 'public' | StaffPermissionFlag

export const EVENT_SENSITIVITY: Record<DomainEventType, EventSensitivity> = {
  'sale.completed':            'public',
  'sale.returned':             'public',
  'customer.debt_changed':     'public',
  'cash.movement_recorded':    'public',
  'stock.taken':                'public',
  'stock.received':            'public',
  'shift.opened':               'public',
  'shift.closed':               'public',
  'inventory.adjusted':        'public',
  'installment.due_paid':      'public',
  'device.registered':         'public',
  'product.price_changed':     'public',
  'product.created':           'public',
  'staff.ledger_entry_added':  'can_view_staff_ledger',
  'settlement.paid':           'can_view_staff_ledger',
  'expense.recorded':          'can_view_expenses',
  'product.cost_updated':      'can_view_reports',
}
```

**Process rule, stated plainly in this spec because it's the actual mitigation, not the registry
alone:** adding a new `DomainEventType` requires adding a row to `EVENT_SENSITIVITY` (compiler-
enforced) and, if that row is not `'public'`, adding the matching `WHEN` branch to the
`events_select_scoped` policy (enforced by the cross-verification test in §6a, not the compiler —
SQL text isn't something TypeScript can check). The registry converts "forgot to update SQL" from a
silent security gap into a failing test; it does not make the SQL update automatic. A future
revision that generates the `CASE` branches directly from this registry (removing the manual
sync-and-test step entirely) is a reasonable follow-up, not required for this sprint since no
migration-generation tooling exists in this codebase today to hang it on.

**Mapping rationale, event by event:**
- `staff.ledger_entry_added`, `settlement.paid` → `can_view_staff_ledger` — same flag, same
  sensitivity class as the source `staff_ledger`/`staff_settlements` tables (migration 060). No new
  flag invented; this is the identical concept re-applied to the event projection of that data.
- `expense.recorded` → `can_view_expenses` — matches WAFI-058's owner-only-by-default financials
  model already governing the source `expenses` table.
- `product.cost_updated` → `can_view_reports` — cost reveals margin, which WAFI-018 already treats
  as sensitive enough to withhold from managers by default. `product.price_changed` and
  `product.created` stay ungated: price is customer-visible information, not a margin signal.
- Every other event type (`sale.completed`, `sale.returned`, `customer.debt_changed`,
  `cash.movement_recorded`, `stock.taken`, `stock.received`, `shift.opened`, `shift.closed`,
  `inventory.adjusted`, `installment.due_paid`, `device.registered`) stays shop-wide readable,
  matching today's behavior — these are operational facts a cashier legitimately needs to run the
  floor, not financial/margin signals.

`INSERT` stays ungated by permission — a writer is already gated by the *source table's own* RLS
(you cannot produce a `staff.ledger_entry_added` event without first being able to write the
underlying `staff_ledger` row); double-gating the event insert on top of that would be redundant,
not a real additional boundary.

**Client-side implication:** local PowerSync tables carry no RLS of their own — filtering happens
server-side, before sync. A device authenticated with `active_role = 'cashier'` (per migration 048's
JWT claim) simply never receives `expense.recorded`/`staff.ledger_entry_added`/`settlement.paid`/
`product.cost_updated` rows in its local sync stream at all; `useEventSubscription` needs no code
change to respect this — the rows are absent from what PowerSync ever delivers to that device.

**A device's active role can change mid-session** (operator switch, WAFI-203) without re-issuing a
JWT in the general case — worth stating explicitly: `auth_role()` reads `active_role` off the
*current* JWT claim, and PowerSync's sync stream re-evaluates RLS on each sync cycle against the
current session's claims, so a role downgrade (owner → cashier via operator switch) takes effect on
the next sync tick, not instantly on the switch — an already-locally-cached row from before the
switch is not retroactively purged from local storage this sprint (same non-goal posture as the
90-day retention window in §6 not retroactively purging already-synced rows).

## 4. Rate limiting

### 4a. Client-side token bucket — first line of defense

A runaway loop (`while (true) publishEvent(...)`) still fully serializes its payload, opens a local
SQLite write, and pays the SQL trigger's cost (§4b) on every iteration *before* the trigger has a
chance to reject it — the SQL trigger alone is real protection at the data layer, but it does nothing
to stop a client from hammering local SQLite thousands of times a second while waiting to get
rejected. `publishEvent()` gains a cheap in-memory token bucket, checked before any serialization or
`db.execute` call:

```ts
// src/services/events/publishRateLimiter.ts
// In-memory, per-process, not persisted or synced -- resets on app restart. This is a cheap
// first line of defense against a runaway LOCAL loop, not a security boundary (a compromised
// or modified client can trivially bypass in-memory state). The real boundary is the SQL
// trigger (§4b) -- this bucket exists purely to stop wasted local SQLite/serialization work,
// not to be trusted as the actual limit.
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

`publishEvent()` checks this first and, on exhaustion, routes directly to the same
`enqueueForRetry` path a SQL-trigger rejection would use (classified `transient` — the bucket refills
in seconds) rather than duplicating a second failure-handling branch:

```ts
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  if (!tryConsumeToken()) {
    eventPublishFailureCount.value += 1
    await enqueueForRetry(event, 'client_rate_limit_exceeded').catch(() => {})
    return
  }
  /* ...unchanged: payload size guard (§6b), db.execute, catch -> enqueueForRetry... */
}
```

This is deliberately generous (50 burst capacity, 10/sec sustained) relative to the server-side 500/
minute cap (§4b) — the token bucket's job is catching a *runaway* loop cheaply and early, not
replicating the server's exact policy. Defense in depth: memory limit first (cheap, imperfect,
per-device), DB limit second (authoritative, the real boundary — see §4b).

### 4b. Server-side trigger — the real boundary

A `BEFORE INSERT` trigger on `events`, capping inserts per `shop_id` in a trailing 60-second window,
keyed on `created_at` (wall-clock insert time) rather than `occurred_at` (business time) —
deliberately, not a typo: `occurred_at` can be backdated by the retry queue replaying an event whose
original `occurredAt` is hours old (Sprint 2 §4), so filtering on it would under-count a burst of
*genuinely simultaneous inserts* that happen to carry old business timestamps. `created_at` is always
"when this row actually landed," which is what a rate limit on insert volume needs:

```sql
CREATE OR REPLACE FUNCTION public.enforce_events_rate_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.events
  WHERE shop_id = NEW.shop_id AND created_at > now() - interval '1 minute';
  IF v_count >= 500 THEN
    RAISE EXCEPTION 'events_rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_rate_limit_trigger
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_events_rate_limit();

-- events_shop_type_idx (shop_id, type, occurred_at DESC) does NOT cover this trigger's
-- created_at filter -- a query on (shop_id, created_at) only gets partial benefit (the
-- shop_id equality) from that index, not the range condition. A dedicated index is required;
-- without it this trigger degrades to a shop_id-filtered sequential scan on every insert.
CREATE INDEX IF NOT EXISTS events_shop_created_at_idx ON public.events (shop_id, created_at);
```

**The trigger is intentionally approximate under concurrent inserts, not exact.** Two concurrent
transactions can each run their `SELECT count(*)` and both observe a count below 500 before either
one commits its `INSERT` — both then proceed, so the real cap under concurrency is "500 plus however
many inserts were in flight at the same instant," not a hard 500. This is acceptable for this
project's workload because the goal is abuse prevention (stopping a runaway loop from flooding the
table indefinitely), not enforcing an exact quota — a handful of rows over the nominal cap changes
nothing about whether the mechanism did its job. A future rolling-counter implementation (the same
one named below for the separate scaling concern) could close this race with an atomic
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING count` if a harder guarantee is ever required; not
needed for this sprint's threat model.

500 events/minute per shop — generous enough that no plausible legitimate burst (a busy sale rush, a
large stock-take confirming many products at once) comes close, while a runaway loop hits the cap
within seconds rather than flooding the table indefinitely.

**Cost, and a known scaling ceiling.** With `events_shop_created_at_idx` in place, the `count(*)` is
an index range scan bounded by the cap itself (never more than ~500 rows counted, since the trigger
stops new inserts once the cap is hit) — cheap at this project's expected scale (a single part-time
shop, not a high-throughput system). **This does not scale indefinitely**: at meaningfully higher
sustained throughput (roughly, once per-shop insert rates approach the several-hundred-per-second
range) a `count(*)`-per-insert check itself becomes the bottleneck, since every single insert pays
for a scan of up to 500 prior rows. Not a problem for this project today, but explicitly flagged so
a future ticket scaling past a single-shop's expected volume doesn't rediscover this from a
production slowdown: the fix at that point is a **rolling counter table** (e.g. one row per
`(shop_id, minute_bucket)` incremented via `ON CONFLICT DO UPDATE`, checked instead of scanning
`events` itself) rather than re-tuning this `count(*)` approach.

**Client-side classification.** `isTransientPublishFailure` (Sprint 2) gains a new pattern:

```ts
const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i,
  /rate_limit_exceeded/i]
```

One shared pattern, `/rate_limit_exceeded/i`, deliberately matches both rejection reasons with a
single rule: `events_rate_limit_exceeded` (§4b, Postgres) and `client_rate_limit_exceeded` (§4a, the
in-memory token bucket, which never reaches Postgres to get a real error message) — so
`enqueueForRetry` treats a client-side throttle and a server-side rejection identically, both
transient, without a second special case.

Classified `transient` because the window self-clears — Sprint 2's existing backoff schedule (1 min,
5 min, 30 min, 2 hr, now with jitter per §8b) already handles "retry later" correctly for this case
with zero changes to the retry queue's mechanics beyond this one new pattern entry. Explicitly: both
`events_rate_limit_exceeded` and `client_rate_limit_exceeded` retry on that same generic backoff
schedule — neither gets a dedicated, tighter, or looser retry policy of its own. A rate-limit
rejection is not special-cased at the retry-queue layer at all; classification (§4 here) is the only
thing that changes, the backoff behavior after that point is identical to any other transient
failure.

## 5. Event contract tests

One new Vitest file, `src/services/events/__tests__/eventContracts.test.ts`. **Snapshots the full
`DomainEvent` envelope, not just `payload`** — a breaking change can happen to `entityId`,
`payloadVersion`, `staffId`/`shopId` typing, or `occurredAt`'s format just as easily as to the
payload body (e.g. a future refactor renaming `entityId` to `id` would pass every existing
payload-only snapshot untouched, since the payload itself never changed):

```ts
import { describe, it, expect } from 'vitest'
import type {
  DomainEvent, DomainEventType, SaleCompletedPayload, ReturnedPayload, DebtChangedPayload,
  CashMovementRecordedPayload, StockTakenPayload, ProductPriceChangedPayload,
  ProductCostUpdatedPayload, ProductCreatedPayload, DeviceRegisteredPayload,
  /* ...remaining Sprint 1 payload types... */
} from '@/services/events/domainEvent.types'

// Every field fixed to a literal value -- occurredAt/staffId/shopId are NOT generated at test
// time (e.g. via new Date() or a random uuid), specifically so the snapshot is stable across
// runs. A snapshot built from non-deterministic fixture values would fail every run for the
// wrong reason (a changed timestamp) instead of the right one (a changed shape).
//
// FIXTURE_PAYLOAD_VERSION/FIXTURE_STAFF_ID/etc. are frozen constants, not re-typed literals at
// every entry -- one place to see "this is the value every fixture intentionally shares",
// and one place to change if the fixture convention itself ever needs to shift.
const FIXTURE_PAYLOAD_VERSION = 1
const FIXTURE_STAFF_ID = 's1'
const FIXTURE_SHOP_ID = 'shop1'
const FIXTURE_OCCURRED_AT = '2026-08-05T00:00:00.000Z'

const FIXTURES: Record<DomainEventType, DomainEvent> = {
  'sale.returned': {
    type: 'sale.returned', entityId: 'r1',
    payload: { returnId: 'r1', saleId: 's1', refundAmountUsd: 5, restockedItemCount: 1 } satisfies ReturnedPayload,
    payloadVersion: FIXTURE_PAYLOAD_VERSION, staffId: FIXTURE_STAFF_ID, shopId: FIXTURE_SHOP_ID,
    occurredAt: FIXTURE_OCCURRED_AT,
  },
  'customer.debt_changed': {
    type: 'customer.debt_changed', entityId: 'c1',
    payload: { customerId: 'c1', deltaUsd: -5, newBalanceUsd: 10, reason: 'return' } satisfies DebtChangedPayload,
    payloadVersion: FIXTURE_PAYLOAD_VERSION, staffId: FIXTURE_STAFF_ID, shopId: FIXTURE_SHOP_ID,
    occurredAt: FIXTURE_OCCURRED_AT,
  },
  // ...one entry per remaining event type (cash.movement_recorded, stock.taken,
  // product.price_changed, product.cost_updated, product.created, device.registered, plus
  // all 9 Sprint 1 types: sale.completed, expense.recorded, inventory.adjusted,
  // installment.due_paid, shift.opened, shift.closed, staff.ledger_entry_added,
  // settlement.paid, stock.received) -- same shape: full DomainEvent envelope, fixed literal
  // values throughout, payload `satisfies` its real interface.
}

describe.each(Object.entries(FIXTURES))('event contract: %s', (_type, fixture) => {
  it('matches its committed shape snapshot', () => {
    expect(fixture).toMatchSnapshot()
  })
})
```

**Two layers of enforcement, deliberately overlapping:**
1. `satisfies PayloadInterface` on each fixture's `payload` field, and `DomainEvent` on the fixture
   itself — TypeScript fails the build the moment a fixture and its interface diverge (a field
   renamed on one side but not the other, on either the envelope or the payload).
2. The snapshot — catches the complementary case where an interface *and* its fixture are edited
   together (so the type check still passes) but the resulting shape silently differs from what's
   already committed, breaking any real or future consumer that reads the old shape. Because the
   snapshot covers the full envelope, this now also catches an envelope-level rename (`entityId` →
   `id`) that a payload-only snapshot would miss entirely.

`FIXTURES: Record<DomainEventType, DomainEvent>` means a new event type added without a
corresponding fixture entry is a TypeScript error (missing required key) — the table cannot
silently go stale as new events are wired in future work.

## 6. General security hardening

### 6a. Cross-tenant isolation test suite

New `supabase/migrations/verification/verify_wafi140_events_isolation.sql`, mirroring the existing
`verify_wafi122_role_enforcement.sql` pattern: creates two fake shops/staff/JWT contexts and asserts:
- Shop A's session reading `events` never sees shop B's rows (and vice versa), regardless of
  per-type gating from §3.
- Shop A's session cannot insert a row with `shop_id = shop_B` — `WITH CHECK (shop_id =
  auth_shop_id())` (migration 074, unchanged) rejects it even if the payload is otherwise valid.
- The rate-limit trigger (§4) counts only the calling shop's own rows — shop A hitting its cap does
  not affect shop B's counter or ability to insert.
- The per-type `CASE` policy (§3) correctly denies a cashier-role session read access to all four
  gated types and correctly allows an owner-role session all of them, within the same shop.
- **Registry/SQL cross-check (closes §3's `ELSE true` hazard):** runs against a live database in
  this suite (not a text-parsing test against the migration file). Migrations are immutable and
  additive in this codebase — a later migration (e.g. Sprint 4 adding `076_events_policy_v2.sql`)
  can replace `events_select_scoped`'s definition entirely, at which point a test parsing the
  *074/0NN migration file's source text* would still be checking an obsolete, superseded
  definition, passing even if the live policy had since diverged from it. Instead, this test
  queries `pg_get_expr(pg_policy.polqual, pg_policy.polrelid)` (or equivalently selects from
  `pg_policies` for `events_select_scoped`) against the actual test database after migrations have
  run, extracts the set of `type` literals with a non-`true` branch from that *live* expression
  text, and asserts that set is exactly equal to the set of non-`'public'` keys in
  `EVENT_SENSITIVITY` (§3) — not a subset either direction. This validates the policy that is
  actually in effect, immune to which migration file most recently defined it.

### 6b. Payload input validation

`publishEvent()` gains a size guard, checked before the `db.execute` try/catch:

```ts
// The largest of all 17 wired payload shapes today (a handful of IDs, amounts, and short
// strings each) serializes to well under 1 KB. 16 KB gives over an order of magnitude of
// headroom above that -- room for legitimate growth (a longer note field, an extra ID or two
// in a future payload revision) while still catching a genuinely runaway/malformed value
// (e.g. a bug accidentally embedding an entire object graph or a base64 blob into a payload
// field) long before it becomes a real storage or sync-bandwidth problem.
const MAX_PAYLOAD_BYTES = 16_384

export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  const serialized = JSON.stringify(event.payload)
  // .length is UTF-16 code units, not bytes -- a payload full of multi-byte characters
  // (Arabic text in a product name, an emoji in a note field) would undercount against a
  // byte-oriented limit. TextEncoder gives the real UTF-8 byte length.
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) {
    throw new Error(`event payload exceeds ${MAX_PAYLOAD_BYTES} bytes: ${event.type}`)
  }
  // Reject non-JSON-safe values before they can silently round-trip as something else:
  // JSON.stringify turns NaN/Infinity/-Infinity into the literal `null` rather than
  // erroring -- silent data loss, not an exception, unless checked for explicitly here.
  if (containsNonFiniteNumber(event.payload)) {
    throw new Error(`event payload contains a non-finite number (NaN/Infinity): ${event.type}`)
  }
  try {
    await db.execute(/* ...unchanged insert... */)
  } catch (err) {
    /* ...unchanged retry-enqueue path... */
  }
}

// Walks the payload for NaN/±Infinity specifically (the values JSON.stringify silently
// turns into `null` rather than erroring on) -- a plain typeof/isFinite check alone can't
// tell a legitimate `null` field apart from a lost NaN, so this walks the actual object
// before serialization, not the JSON string after.
function containsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(containsNonFiniteNumber)
  if (value && typeof value === 'object') return Object.values(value).some(containsNonFiniteNumber)
  return false
}
```

**Cycle safety, stated as a contract rather than left implicit.** This function recurses without a
visited-set guard, so a self-referential object graph (`const x = {}; x.self = x`) would recurse
forever. Not reachable today — event payload interfaces are flat, JSON-serializable data by
construction, and this call only happens *after* `serialized = JSON.stringify(event.payload)` has
already succeeded (§6b's byte-length check runs first), which itself throws synchronously
("Converting circular structure to JSON") on any cyclic input before `containsNonFiniteNumber` ever
runs — so a cycle can never actually reach this function in practice, not just in theory. Recorded
as an explicit constraint anyway, since relying on "JSON.stringify happens to run first" is a subtle
invariant a future refactor could break: **event payloads are required to be JSON-serializable
object graphs without cycles** — the same requirement `DomainEvent<T>`'s payload has always
implicitly carried, now written down.

Thrown synchronously, **outside** the try/catch that leads to `enqueueForRetry` — an oversized
payload is a caller bug (something produced malformed/runaway data), not a transient infrastructure
failure, so it must never enter the retry queue (retrying an oversized payload forever repeats the
same failure indefinitely with no path to success). `executeBusinessOperation`'s existing
fire-and-forget `void publishEvent(event).catch(() => {})` (Sprint 2 Task 2) already absorbs this
throw without surfacing it to the caller's write — same posture as any other publish failure, this
one simply never reaches the database at all.

### 6c. Retry-queue plaintext review

Audited all 17 wired payload shapes (Sprint 1 + Sprint 2 §6 tables) against
`local_event_publish_retries.serialized_event`'s plaintext local SQLite storage: every payload is an
operational fact (amounts, IDs, counts, category/direction enums) — none carry PII, PIN hashes, or
payment credentials. **Conclusion: current payloads contain no data sensitive enough to justify
redaction or encryption-at-rest this sprint** — deliberately phrased as a statement about today's
17 payloads, not a durable property of the mechanism: future payloads may. Recorded as a reviewed
conclusion (not a silent skip) so a future event type carrying PII, credentials, or other sensitive
fields is a flag for whoever adds it to re-open this question against the retry queue's plaintext
storage, not an assumption this spec made invisibly or permanently.

## 7. Appendix: Cross-device dedup (design only — see §2 non-goals)

Recorded for the day a real subscriber needs exact-once-across-devices correctness. Not built, not
tested, this sprint.

**Shape:** a *synced* (not `local_`-prefixed) table:

```sql
create table event_processed_ledger (
  subscriber_id text not null,
  event_id      uuid not null,
  shop_id       uuid not null references shops(id),
  processed_at  timestamptz not null default now(),
  primary key (subscriber_id, event_id)
)
```

RLS-scoped by `shop_id` like every other synced table (`shop_id = auth_shop_id()` on both
`SELECT`/`INSERT`).

**The fundamental shift from Sprint 2's local ledger:** Sprint 2's `local_event_processed_ledger`
*gates* the action — the ledger insert happens, then (and only then) does `action()` run, so the
ledger genuinely prevents double-execution on a single device. That gating property does not survive
going cross-device in an offline-first architecture: two devices can each pass their own local
"insert succeeded, not yet a conflict" check before either write has reached Postgres, so **both**
may run `action()` before Postgres's primary-key constraint rejects the second device's now-late
insert. The ledger's role shifts from *preventing* double-execution to *detecting* it after the
fact — real correctness has to come from `action()` itself being naturally idempotent (e.g. an
upsert keyed on a stable business ID, not a blind increment).

**This only works for actions that can be made idempotent.** A true "exactly once, ever, across
devices" guarantee for a non-idempotent action is not achievable in an offline-first architecture
without introducing a single point of coordination — which would defeat offline-first itself. This
constraint must be stated to whoever picks this up as a hard boundary, not discovered mid-build.

## 8. Small deferred items

### 8a. Retention & cleanup

PowerSync sync-rule change (configured outside this repo, in the PowerSync dashboard/config — same
posture as Sprint 1's own note about `events`' eventual retention): scope the `events` bucket
definition to `occurred_at > now() - interval '90 days'`. This is a **sync boundary, not a Postgres
delete** — full history stays in Postgres forever; devices simply stop receiving rows older than 90
days going forward. Implements Sprint 2 §4a's `cleanup()` steps 1 and 3.

Steps 2 and 4 (local-only table pruning) become `cleanupLocalEventTables()`:

```ts
export async function cleanupLocalEventTables(): Promise<void> {
  // Step 2 (must run before step 3's effects are visible locally): a ledger row referencing
  // an event_id no longer present in the local (now sync-rule-scoped) events table can never
  // be re-processed anyway.
  //
  // NOT EXISTS, not NOT IN -- NOT IN has a well-known NULL-handling trap (if the subquery
  // ever returns a NULL id, `x NOT IN (...)` becomes UNKNOWN for every row, silently matching
  // nothing at all). events.id is a NOT NULL uuid primary key, so that trap cannot actually
  // fire here today, but NOT EXISTS carries no such caveat to reason about in the first place
  // and is the generally-preferred form for exactly this shape of query.
  await db.execute(
    `delete from local_event_processed_ledger l
     where not exists (select 1 from events e where e.id = l.event_id)`,
  )
  // Step 4: independent of the events cutoff — only rows already flagged for manual
  // inspection (permanent or exhausted-transient) persist past their own resolution.
  await db.execute(
    `delete from local_event_publish_retries
     where failure_kind = 'permanent' and created_at < ?`,
    [new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString()],
  )
}
```

Called from the same app-start path as `startRetryQueueSweeper()`/`startDailyEventCountsProjection()`
(§8c) — not a new polling mechanism, one more call alongside the existing app-init sequence.

**App-start-only is not enough on its own.** Some shops run a device for weeks without a restart
(matches the "part-time, offline-first" usage pattern this whole platform is built for) — a cleanup
that only fires once per app launch could go a long time between runs on such a device, during which
the local tables it's meant to bound keep growing. `cleanupLocalEventTables()` is therefore also
wired into the same PowerSync reconnect-transition listener `startRetryQueueSweeper()` already uses
(§4 of Sprint 2's spec) — reconnects happen far more often than app restarts on a device that stays
open, giving the cleanup a realistic cadence without introducing a new polling timer:

```ts
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

A device that truly never reconnects and never restarts for months is already a data-hygiene edge
case beyond this sprint's scope (it would also mean the retry queue and PowerSync's own sync are
equally stalled) — not solved here, and not worth a separate polling timer to cover.

### 8b. Retry backoff jitter

`nextRetryAt()` in `eventPublishRetryQueue.ts` gains ±20% randomization so a batch of events that
failed together doesn't all become due at exactly the same synchronized moment:

```ts
function nextRetryAt(attempts: number): string {
  const baseMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  const jitter = 0.8 + Math.random() * 0.4 // ±20%, per design spec Sprint 2 §4's own note
  return new Date(Date.now() + baseMinutes * 60_000 * jitter).toISOString()
}
```

### 8c. Dormant-projection fix

`startDailyEventCountsProjection` (Sprint 1) has never had a caller outside its own test file —
confirmed via codebase-wide grep for `useEventSubscription(` — the same dormancy bug the Sprint 2
final-review pass found and fixed for `startRetryQueueSweeper` (commit `a064079`), flagged there for
follow-up rather than fixed on the spot. Fix: call it from `App.vue`'s `onMounted`, alongside
`startRetryQueueSweeper()` and the new `startEventTableCleanupSweeper()` call (§8a — not
`cleanupLocalEventTables()` directly; the sweeper wraps it and also wires the reconnect listener),
gated identically (after device/shop context resolves, matching `loadActiveShift()`'s existing
gating).

## 9. Testing

- SQL verification: cross-tenant isolation suite (§6a, new file).
- SQL verification: rate-limit trigger — insert 500 events as shop A, assert the 501st raises
  `events_rate_limit_exceeded`; assert shop B's own insert in the same window succeeds unaffected.
- SQL verification: per-type RLS — a cashier-role session sees `sale.completed` rows but zero
  `expense.recorded`/`staff.ledger_entry_added`/`settlement.paid`/`product.cost_updated` rows for the
  same shop; an owner-role session sees all of them.
- Vitest: `eventContracts.test.ts` (§5) — full snapshot suite, all 17 wired event types.
- Vitest: `isTransientPublishFailure` — new case, `events_rate_limit_exceeded` classifies `transient`.
- Vitest: `publishEvent()` — a payload exceeding `MAX_PAYLOAD_BYTES` throws before any `db.execute`
  or `enqueueForRetry` call (proves it never reaches the retry queue).
- Vitest: `cleanupLocalEventTables()` — a ledger row referencing a no-longer-present `events` id is
  deleted; a retry row that is `transient` or not yet 90 days old is left untouched.
- Vitest: `nextRetryAt()` jitter — output across many calls falls within the documented ±20% band
  (statistical assertion, not exact-match, since the output is randomized by design).
- Vitest: `startDailyEventCountsProjection` is actually invoked from `App.vue`'s mount path
  (regression test for the dormancy bug — this is the test category that was missing when the
  original bug shipped silently in Sprint 1).
- **Integration test: role downgrade stops new gated events from syncing.** §3 states in prose that
  an operator switch from owner to cashier takes effect on the next sync tick, not instantly — that
  claim needs its own dedicated test, not just prose. Simulate: a device holds an active
  `useEventSubscription(ExpenseEventType.Recorded, ...)` subscription while `active_role = 'owner'`;
  assert it receives a fixture `expense.recorded` row delivered via the mocked `db.watch` stream.
  Then simulate the operator-switch transition (mock `auth_role()`'s underlying claim flipping to
  `'cashier'`, i.e. the next sync cycle re-evaluating RLS under the new claim) and assert a
  *second* fixture `expense.recorded` row is never delivered to that same still-active subscription
  once the mocked sync stream reflects the post-downgrade (empty) result set. This is the test that
  actually exercises the per-type RLS + live-role-change interaction end to end, rather than relying
  on the SQL-level policy test (§6a) and the prose claim in §3 to each separately imply the combined
  behavior is correct.

## 10. Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Events (RLS, rate limit, retention), Staff Finance (can_view_staff_ledger reuse),
                 Expenses (can_view_expenses reuse), Products (can_view_reports reuse for cost),
                 Identity/Auth (auth_role()/can() reuse, no new mechanism)
Matrix rows consulted: Events, Staff Finance, Expenses, Products, Identity
Open cross-feature questions:
  - Per-type RLS changes what a cashier's device SYNCS DOWN, not just what it can query live — a
    cashier device that already locally cached gated rows before this ships keeps them until the
    existing 90-day local retention ages them out; no forced local purge is attempted on rollout.
  - Rate-limit trigger fires on every local INSERT into events, including retry-queue replays
    (attemptRetry's re-insert, Sprint 2 §4) -- confirmed NOT a double-count risk against OTHER
    devices' synced-in rows: PowerSync's replication of another device's row into this device's
    local events table does not re-run this device's own INSERT trigger path (sync writes land via
    PowerSync's own replication mechanism, not through publishEvent()/attemptRetry() on the
    receiving device) -- flagged explicitly so a future contributor does not assume the trigger
    double-counts synced-in rows from other devices.
  - can_view_reports gating product.cost_updated: a manager's can_view_reports is owner-grantable
    (WAFI-058) and independent of can_manage_products (already true for all managers) -- a manager
    who manages products but lacks the owner-granted can_view_reports flag will see
    product.price_changed/product.created events but not product.cost_updated. This is the intended
    asymmetry (mirrors WAFI-018's margin-sensitivity stance), not an oversight.
  - Cross-device dedup's design-only appendix (§7) must not be mistaken for "already available" by
    a future ticket -- explicitly no synced ledger table exists after this sprint ships; the
    appendix is a starting point for a NEW ticket, not a shipped mechanism.
```

Updated DOMAIN INTERACTION MATRIX row (`AI_PRINCIPAL_ENGINEER_REVIEW.md`):

| Domain | Writes to (tables) | Reads from (other domains) | Key composables | Reports/Dashboards affected |
|---|---|---|---|---|
| Events | `events`, `daily_event_counts`, `local_event_processed_ledger` (local-only), `local_event_publish_retries` (local-only) | Sales, Returns, Customer Credit, Inventory, Staff, Expense, Cash/Shifts, Products, Suppliers, Devices (all event producers); Identity (`auth_role()`/`can()` for per-type RLS) | `useEventSubscription`, `processProjectionAtMostOnce`, `retryPendingEventPublishes`, `isTransientPublishFailure`, `getRetryQueueStats`, `cleanupLocalEventTables`, `startEventTableCleanupSweeper`, `tryConsumeToken`, `enforce_events_rate_limit` (SQL trigger) | none yet (still no user-facing consumer — WAFI-143/144/145/146) |

`EVENT_SENSITIVITY` is deliberately not listed in "Key composables" above — it's a static
classification registry (shared type-level infrastructure, per §3), not a composable/function
consumers call at runtime. Recorded here rather than folded into that column so the matrix doesn't
conflate "things you call" with "things you look up."

## 11. Out-of-scope call-outs (explicitly deferred, not silently dropped)

- Cross-device dedup implementation (§2, §7) — design recorded, not built; blocked on a real
  subscriber that needs the guarantee existing.
- The 8 events Sprint 2 already deferred — unchanged, no new write sites appeared.
- Owner-facing alerting on rate-limit rejections or exhausted publish retries — still
  dev-console-only, matching Sprint 1/2's posture on the failure counter.
- Retroactive local purge of already-synced, now-permission-gated rows on existing devices (§3, §10)
  — ages out naturally via the 90-day retention window (§8a) rather than a forced migration.
