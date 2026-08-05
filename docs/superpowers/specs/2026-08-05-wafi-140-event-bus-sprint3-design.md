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

A `BEFORE INSERT` trigger on `events`, capping inserts per `shop_id` in a trailing 60-second window:

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
```

500 events/minute per shop — generous enough that no plausible legitimate burst (a busy sale rush, a
large stock-take confirming many products at once) comes close, while a runaway loop (e.g. a buggy
watch-query re-firing `publishEvent()` in a cycle) hits the cap within seconds rather than flooding
the table indefinitely.

**Cost:** the trailing-window `count(*)` scan is bounded by the cap itself (never more than ~500 rows
counted, since the trigger stops new inserts once the cap is hit) and is index-assisted by the
existing `events_shop_type_idx (shop_id, type, occurred_at DESC)` — no new index required.

**Client-side classification.** `isTransientPublishFailure` (Sprint 2) gains a new pattern:

```ts
const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i,
  /events_rate_limit_exceeded/i]
```

Classified `transient` because the window self-clears — Sprint 2's existing backoff schedule (1 min,
5 min, 30 min, 2 hr) already handles "retry later" correctly for this case with zero changes to the
retry queue's mechanics beyond this one new pattern entry.

## 5. Event contract tests

One new Vitest file, `src/services/events/__tests__/eventContracts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type {
  DomainEventType, SaleCompletedPayload, ReturnedPayload, DebtChangedPayload,
  CashMovementRecordedPayload, StockTakenPayload, ProductPriceChangedPayload,
  ProductCostUpdatedPayload, ProductCreatedPayload, DeviceRegisteredPayload,
  /* ...remaining Sprint 1 payload types... */
} from '@/services/events/domainEvent.types'

const FIXTURES: Record<DomainEventType, unknown> = {
  'sale.completed':          { /* ... */ } satisfies SaleCompletedPayload,
  'sale.returned':           { returnId: 'r1', saleId: 's1', refundAmountUsd: 5, restockedItemCount: 1 } satisfies ReturnedPayload,
  'customer.debt_changed':   { customerId: 'c1', deltaUsd: -5, newBalanceUsd: 10, reason: 'return' } satisfies DebtChangedPayload,
  'cash.movement_recorded':  { movementId: 'm1', shiftId: 'sh1', direction: 'in', category: 'float_topup', currency: 'USD', amountUsd: 20 } satisfies CashMovementRecordedPayload,
  'stock.taken':             { sessionId: 'st1', productCount: 10, unexplainedVarianceCount: 0 } satisfies StockTakenPayload,
  'product.price_changed':   { productId: 'p1', oldPriceUsd: 10, newPriceUsd: 12 } satisfies ProductPriceChangedPayload,
  'product.cost_updated':    { productId: 'p1', oldCostUsd: 5, newCostUsd: 6 } satisfies ProductCostUpdatedPayload,
  'product.created':         { productId: 'p1', name: 'Widget', categoryId: null } satisfies ProductCreatedPayload,
  'device.registered':       { deviceId: 'd1', deviceCode: 'ABC123', isTemporary: false } satisfies DeviceRegisteredPayload,
  // ... remaining Sprint 1 event types (expense.recorded, inventory.adjusted, installment.due_paid,
  // shift.opened, shift.closed, staff.ledger_entry_added, settlement.paid, stock.received) with one
  // fixture each, pulled from Sprint 1's own payload interfaces.
}

describe.each(Object.entries(FIXTURES))('event contract: %s', (_type, fixture) => {
  it('matches its committed shape snapshot', () => {
    expect(fixture).toMatchSnapshot()
  })
})
```

**Two layers of enforcement, deliberately overlapping:**
1. `satisfies PayloadInterface` on every fixture line — TypeScript itself fails the build the moment
   a fixture and its interface diverge (a field renamed on one side but not the other).
2. The snapshot — catches the complementary case where an interface *and* its fixture are edited
   together (so `satisfies` still passes) but the resulting shape silently differs from what's
   already committed, breaking any real or future consumer that reads the old shape.

`FIXTURES: Record<DomainEventType, unknown>` means a new event type added without a corresponding
fixture entry is a TypeScript error (missing required key) — the table cannot silently go stale as
new events are wired in future work.

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

### 6b. Payload input validation

`publishEvent()` gains a size guard, checked before the `db.execute` try/catch:

```ts
const MAX_PAYLOAD_BYTES = 16_384 // generous headroom over any current payload shape

export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  const serialized = JSON.stringify(event.payload)
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`event payload exceeds ${MAX_PAYLOAD_BYTES} bytes: ${event.type}`)
  }
  try {
    await db.execute(/* ...unchanged insert... */)
  } catch (err) {
    /* ...unchanged retry-enqueue path... */
  }
}
```

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
payment credentials. **Conclusion: no redaction or encryption-at-rest is needed this sprint.**
Recorded as a reviewed, deliberate conclusion (not a silent skip) so a future event type carrying
sensitive data is a flag for whoever adds it to re-open this question, not an assumption this spec
made invisibly.

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
  await db.execute(
    `delete from local_event_processed_ledger where event_id not in (select id from events)`,
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
`startRetryQueueSweeper()` and the new `cleanupLocalEventTables()` call, gated identically (after
device/shop context resolves, matching `loadActiveShift()`'s existing gating).

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
| Events | `events`, `daily_event_counts`, `local_event_processed_ledger` (local-only), `local_event_publish_retries` (local-only) | Sales, Returns, Customer Credit, Inventory, Staff, Expense, Cash/Shifts, Products, Suppliers, Devices (all event producers); Identity (`auth_role()`/`can()` for per-type RLS) | `useEventSubscription`, `processProjectionAtMostOnce`, `retryPendingEventPublishes`, `isTransientPublishFailure`, `getRetryQueueStats`, `cleanupLocalEventTables`, `enforce_events_rate_limit` (SQL trigger) | none yet (still no user-facing consumer — WAFI-143/144/145/146) |

## 11. Out-of-scope call-outs (explicitly deferred, not silently dropped)

- Cross-device dedup implementation (§2, §7) — design recorded, not built; blocked on a real
  subscriber that needs the guarantee existing.
- The 8 events Sprint 2 already deferred — unchanged, no new write sites appeared.
- Owner-facing alerting on rate-limit rejections or exhausted publish retries — still
  dev-console-only, matching Sprint 1/2's posture on the failure counter.
- Retroactive local purge of already-synced, now-permission-gated rows on existing devices (§3, §10)
  — ages out naturally via the 90-day retention window (§8a) rather than a forced migration.
