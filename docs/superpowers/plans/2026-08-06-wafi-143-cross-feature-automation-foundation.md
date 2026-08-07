# WAFI-143 — Cross-Feature Automation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a new `sale.discounted` domain event and ship exactly two reference
subscribers on top of it — a lightweight "today's revenue" dashboard projection and a
durable "large discount" owner notification — proving the event-bus consumer pattern
end-to-end for both failure profiles, plus a convention doc so WAFI-144/145/146 copy the
pattern instead of re-deriving it.

**Architecture:** Mirrors WAFI-140/150's existing shapes exactly: `dashboardRevenueProjection.ts`
follows `dailyEventCountsProjection.ts` (lightweight, `useEventSubscription` +
`processProjectionAtMostOnce`); `notificationSubscriber.ts` follows `auditSubscriber.ts`
(durable, `runDurableSubscriber`, `source_event_id`-keyed idempotency). `sale.discounted`
is published via a direct `publishEvent()` call, not `executeBusinessOperation`'s
`toEvent` hook — that slot is already taken by `sale.completed` on the same write, and the
wrapper supports at most one event per write.

**Tech Stack:** Vue 3, TypeScript, PowerSync (`@powersync/web`), Vitest, Postgres/Supabase, pgTAP.

## Global Constraints

- **Branch dependency (read this first):** `runDurableSubscriber.ts`,
  `eventProcessingRetryQueue.ts`, `auditSubscriber.ts`, `isTransientEventFailure.ts`, and
  the `audit_log.source_event_id`/`ops.ts` dedup pattern do **not exist on `main`** —
  they exist only on the unmerged `worktree-wafi-150-durable-audit` branch (confirmed via
  `ls src/services/events/` against `main`, 2026-08-06). This plan's implementation
  branch must be created from `worktree-wafi-150-durable-audit`, not `main`. Merge order:
  WAFI-150 → `main` first, then this branch (rebased) → `main`.
- Design spec: `docs/superpowers/specs/2026-08-06-wafi-143-cross-feature-automation-foundation-design.md`
  — read in full before implementing; this plan assumes familiarity with it.
- Next unused Postgres migration number is `078` (confirmed via `ls supabase/migrations`
  as of this plan's writing — but re-check against the WAFI-150 branch's own migrations
  before creating the file, since that branch may have already claimed `078` for
  `audit_log.source_event_id`; if so, this plan's `notifications` migration becomes `079`).
- `publishEvent<T>(event: DomainEvent<T>): Promise<void>` (`src/services/events/publishEvent.ts`)
  takes one object-shaped `DomainEvent`, not positional args. It is normally invoked
  inside `executeBusinessOperation` via its `toEvent` hook, but that hook supports **at
  most one event per write** (`BusinessOperationHooks.toEvent`'s own JSDoc, Sprint 2
  design spec §5a) — already taken by `sale.completed` in `sales.service.ts`. Call
  `publishEvent()` **directly** for `sale.discounted` instead, fire-and-forget
  (`void publishEvent(event).catch(() => {})`), the same pattern
  `executeBusinessOperation` itself uses internally and the same escape hatch
  `device.registered` already uses for a different reason (Sprint 2 spec, §5).
- `DiscountType` is `'percent' | 'fixed'`, defined in `src/features/pos/discounts.ts` (a
  single file, not a directory).
- `EVENT_SENSITIVITY` (`src/services/events/domainEvent.types.ts`) is a
  `Record<DomainEventType, EventSensitivity>` — exhaustive by construction. Adding
  `sale.discounted` to `DomainEventType` without adding a row here is a **TypeScript
  compile error**, not a silent gap. Its own committed snapshot test
  (`src/services/events/__tests__/eventSensitivity.test.ts` +
  `__snapshots__/eventSensitivity.test.ts.snap`) will also fail until the snapshot is
  updated (`npx vitest run ... -u`) — a deliberate, reviewed diff, not an incidental one.
- `src/services/events/__tests__/eventContracts.test.ts`'s `FIXTURES` is a
  `Record<DomainEventType, DomainEvent>` — also exhaustive by construction. Adding
  `sale.discounted` requires a new fixture entry there too, or the file fails to
  type-check. Its own snapshot (`__snapshots__/eventContracts.test.ts.snap`) needs the
  same `-u` update.
- `processProjectionAtMostOnce`'s `SubscriberId` (`src/services/events/processProjectionAtMostOnce.ts`)
  is a plain `as const` object with exactly one member today
  (`DailyEventCounts: 'daily_event_counts_projection'`). Extend the object literal; do
  not replace the pattern.
- Local-only PowerSync tables are declared in `src/data/powersync/schema.ts` via the
  `Table`/`column` DSL with `{ localOnly: true }` (see `local_event_processed_ledger` at
  line 335) — no SQL migration for these. Server-synced tables (e.g. `events`,
  `daily_event_counts`, the new `notifications`) use the same DSL **without** the
  `localOnly` option, and additionally need a real SQL migration. Every table — local or
  synced — gets an identifier added to the `AppSchema = new Schema({ ... })` export at the
  bottom of the file (around line 464) or it is invisible to the client.
- Vitest tests mock PowerSync via
  `vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))` — the
  mock provides `execute`, `watch`, `writeTransaction`, `getAll`, `getOptional`, `get`,
  `registerListener`, `status`. Follow this exact pattern for any new test file touching
  `db`.
- **Known footgun (hit and fixed once already, in WAFI-150's `auditSubscriber.test.ts`):**
  a test that needs `vi.doMock()` to swap out an already-statically-imported dependency
  (e.g. `useEventSubscription`) for a fresh dynamic re-import MUST call
  `vi.resetModules()` **before** the `doMock` + `await import(...)`, or the dynamic import
  returns a module whose own imports were already bound to the real (unmocked)
  dependency at the static import's original evaluation time — driving N *real*
  `useEventSubscription` subscriptions against the `db` mock's eternal `watch()` async
  iterator, an infinite loop that OOMs the test worker (not a hang — a crash after ~15s).
  `vi.resetModules()` also re-runs the top-of-file `db` mock factory, producing a **new**
  set of `vi.fn()`s — re-import `db` fresh too (`const { db: freshDb } = await
  import('@/data/powersync/db')`) and assert against that instance, not the stale
  top-level one. See `src/services/events/__tests__/auditSubscriber.test.ts`'s
  `startAuditSubscribers` test for the exact working pattern to copy.
- `events` table columns/order: `(id, type, entity_id, payload, payload_version,
  staff_id, shop_id, occurred_at, created_at)` — `payload` is `TEXT` holding
  `JSON.stringify`'d JSON (never JSONB).
- RLS helper functions available (`supabase/migrations/054_auth_role_helpers.sql`):
  `public.auth_shop_id()`, `public.auth_role()` (returns `'owner' | 'manager' | 'cashier'`,
  defaults to `'cashier'`), `public.auth_staff_id()` (returns `uuid`, `NULL` if unset),
  `public.can(flag text)` (owner always passes; otherwise checks a JSON permission flag).
  Follow `077_events_per_type_rls.sql`'s exact `DROP POLICY IF EXISTS ...; CREATE POLICY
  ...` structure for any new RLS policy.
- `src/App.vue`'s sweeper-registration pattern: import each `start*()` function at the
  top of the file, call it once inside the existing `onMounted` block (after
  `startEventTableCleanupSweeper()`), gated by the same shop/device-context check already
  guarding the existing three calls. Do not touch the stray leading `\` before the
  `startEventTableCleanupSweeper` comment at (current) line 128 — it is pre-existing repo
  content, out of scope for this ticket.
- Arabic-first UI copy (Sacred Rule #2): any new user-facing string (notification
  title/message) is written in Arabic first, matching existing strings' tone (see
  `HomePage.vue`'s `"المال الداخل"` label for register).

---

### Task 1: `sale.discounted` event type — payload, registry, contract fixtures

**Files:**
- Modify: `src/services/events/domainEvent.types.ts`
- Modify: `src/services/events/__tests__/eventSensitivity.test.ts` (no code change, just
  re-run to update its snapshot)
- Modify: `src/services/events/__tests__/__snapshots__/eventSensitivity.test.ts.snap`
- Modify: `src/services/events/__tests__/eventContracts.test.ts`
- Modify: `src/services/events/__tests__/__snapshots__/eventContracts.test.ts.snap`

**Interfaces:**
- Produces: `SaleDiscountedPayload` type, `'sale.discounted'` added to
  `ProductEventType`... no — added to a new or existing per-domain type group (see Step
  1) and to the `DomainEventType` union. Task 2 depends on this type existing.

- [ ] **Step 1: Add the payload interface and event-type member**

In `src/services/events/domainEvent.types.ts`, add to the `SalesEventType` const object
(currently `{ Completed: 'sale.completed' }` — find it near `ReturnsEventType`/other
per-domain groups):

```ts
export const SalesEventType = {
  Completed: 'sale.completed',
  Discounted: 'sale.discounted',
} as const
export type SalesEventType = typeof SalesEventType[keyof typeof SalesEventType]
```

Add the payload interface near `SaleCompletedPayload`:

```ts
export interface SaleDiscountedPayload {
  discountType: import('@/features/pos/discounts').DiscountType
  discountValue: number
  /** Included only when the discount service already computes it naturally
   *  (percentage-type discounts); never derived/backfilled for fixed-amount discounts
   *  where it isn't a natural value -- so every consumer reads the same number instead
   *  of each re-deriving discountValue / originalPrice inconsistently. */
  discountPercentage?: number
  finalPriceUsd: number
  belowCost: boolean
  pinApproval: boolean
}
```

- [ ] **Step 2: Add the `EVENT_SENSITIVITY` entry**

In the same file's `EVENT_SENSITIVITY` object, add:

```ts
  'sale.discounted':          'public',
```

(mirrors `'sale.completed': 'public'` — discount details are not more sensitive than the
sale itself; revisit only if a future review decides otherwise.)

- [ ] **Step 3: Run type-check to confirm the compiler catches the exhaustiveness gaps**

Run: `npx vue-tsc -b --noEmit`
Expected: FAILS at this point — `EVENT_SENSITIVITY`'s `Record<DomainEventType, ...>` and
`eventContracts.test.ts`'s `FIXTURES: Record<DomainEventType, DomainEvent>` both now
have a missing key. This confirms both registries are genuinely exhaustive-by-construction
before you fix them (if type-check passes here, Step 1/2 didn't actually add
`sale.discounted` to the `DomainEventType` union — stop and recheck).

- [ ] **Step 4: Add the `eventContracts.test.ts` fixture**

In `src/services/events/__tests__/eventContracts.test.ts`, add to the `FIXTURES` object
(alongside the existing `'sale.completed'` entry) and add `SaleDiscountedPayload` to the
top `import type { ... } from '@/services/events/domainEvent.types'` list:

```ts
  'sale.discounted': {
    type: 'sale.discounted', entityId: 'sale1',
    payload: {
      discountType: 'percent', discountValue: 10, discountPercentage: 10,
      finalPriceUsd: 9, belowCost: false, pinApproval: false,
    } satisfies SaleDiscountedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
```

- [ ] **Step 5: Run type-check again to confirm it passes**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Update both snapshots**

Run: `npx vitest run src/services/events/__tests__/eventSensitivity.test.ts src/services/events/__tests__/eventContracts.test.ts -u`
Expected: both files PASS after the snapshot update. Open the two `.snap` file diffs and
confirm they show exactly one new key each (`sale.discounted`) — this is the "deliberate,
reviewed edit" the snapshot tests exist to force; do not accept a diff touching any other
key.

- [ ] **Step 7: Commit**

```bash
git add src/services/events/domainEvent.types.ts src/services/events/__tests__/eventContracts.test.ts src/services/events/__tests__/__snapshots__/eventSensitivity.test.ts.snap src/services/events/__tests__/__snapshots__/eventContracts.test.ts.snap
git commit -m "feat(WAFI-143): add sale.discounted domain event type"
```

---

### Task 2: Publish `sale.discounted` from `sales.service.ts`

**Files:**
- Modify: `src/services/sales.service.ts`
- Modify: `src/services/__tests__/sales.service.test.ts` (already exists — extend it;
  it already mocks `@/services/events/publishEvent` at the top and has a `baseInput`/
  `fakeAudit`/`setupTx(...)` fixture set to reuse verbatim)

**Interfaces:**
- Consumes: `SalesEventType.Discounted`/`SaleDiscountedPayload` (Task 1), `publishEvent`
  (existing, `src/services/events/publishEvent.ts`).
- Produces: nothing new for later tasks — this is a leaf/producer-side change. Task 5/7's
  subscribers consume the event this task publishes, but only at runtime, not at the type
  level.

- [ ] **Step 1: Read the current call site to confirm line numbers before editing**

Run: `grep -n "logDiscountApplied\|executeBusinessOperation" src/services/sales.service.ts`
Confirm the `audit: async (completed) => { ... }` callback (around lines 247-282 as of
this plan's writing) still has the same two `audit.logDiscountApplied(...)` call sites
(one inside the per-line `for` loop, one in the `if (completed.saleDiscount)` block) —
if line numbers have drifted, adjust the edits below to the actual location, the shape
described here should still match.

- [ ] **Step 2: Write the failing tests**

Add to `src/services/__tests__/sales.service.test.ts`, right after the existing
`'calls logDiscountApplied for a sale-level discount even with no per-line discounts'`
test (around line 163) — reusing that file's own `baseInput`/`fakeAudit`/`setupTx`
fixtures exactly as its neighboring tests do:

```ts
  it('publishes a sale.discounted event for a discounted line, in addition to sale.completed', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { publishEvent } = await import('@/services/events/publishEvent')
    const discountedInput = {
      ...baseInput,
      lines: [{
        ...baseInput.lines[0],
        // belowCost reads line.unitCostUsd directly (sales.service.ts line ~266), NOT
        // the transaction-read cost_price_usd (that local var only feeds the
        // stock_adjustments insert) -- set it on the input line itself. unitPriceUsd
        // stays at baseInput's 10 (this service never recomputes it from discountValue;
        // the caller is expected to have already applied the discount upstream), so
        // unitCostUsd: 11 > unitPriceUsd: 10 gives belowCost=true.
        unitCostUsd: 11,
        discountType: 'percent' as const, discountValue: 10, discountPinApproved: false, listPriceUsd: 12,
      }],
    }

    const result = await completeSale(discountedInput, fakeAudit)

    const discountEvents = vi.mocked(publishEvent).mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === 'sale.discounted')
    expect(discountEvents).toHaveLength(1)
    expect(discountEvents[0].entityId).toBe(result.saleId)
    expect(discountEvents[0].payload).toMatchObject({
      discountType: 'percent', discountValue: 10, discountPercentage: 10, pinApproval: false, belowCost: true,
    })
  })

  it('publishes a sale.discounted event for a sale-level discount too', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { publishEvent } = await import('@/services/events/publishEvent')
    const saleDiscountInput = {
      ...baseInput,
      saleDiscount: { type: 'fixed' as const, value: 2, amountUsd: 2, pinApproved: true },
    }

    await completeSale(saleDiscountInput, fakeAudit)

    const discountEvents = vi.mocked(publishEvent).mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === 'sale.discounted')
    expect(discountEvents).toHaveLength(1)
    expect(discountEvents[0].payload).toMatchObject({
      discountType: 'fixed', discountValue: 2, pinApproval: true, belowCost: false,
    })
  })

  it('publishes no sale.discounted event when nothing was discounted', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { publishEvent } = await import('@/services/events/publishEvent')

    await completeSale(baseInput, fakeAudit)

    const discountEvents = vi.mocked(publishEvent).mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === 'sale.discounted')
    expect(discountEvents).toHaveLength(0)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/sales.service.test.ts`
Expected: the three new tests FAIL — `sales.service.ts` doesn't publish `sale.discounted`
yet. Pre-existing tests in this file (including the `logDiscountApplied` ones these new
tests sit next to) still PASS unchanged.

- [ ] **Step 4: Implement — add the direct `publishEvent()` calls**

In `src/services/sales.service.ts`, add the import:

```ts
import { publishEvent } from '@/services/events/publishEvent'
```

In the `audit: async (completed) => { ... }` callback, add a `publishEvent()` call right
after each existing `audit.logDiscountApplied(...)` call — same data already computed
for that call, reused verbatim:

```ts
    audit: async (completed) => {
      await audit.logSaleCompleted(completed.saleId, completed.totalUsd, completed.lines.length)

      for (const line of completed.lines) {
        if (!line.discountType) continue
        const base = line.listPriceUsd ?? line.unitPriceUsd
        const belowCost = line.unitPriceUsd < (line.unitCostUsd ?? 0)
        const pinApproval = Boolean(line.discountPinApproved)
        await audit.logDiscountApplied(completed.saleId, {
          operatorId:    input.staffId,
          tierApplied:   'retail',
          basePriceUsd:  base,
          discountType:  line.discountType,
          discountValue: line.discountValue ?? 0,
          finalPriceUsd: line.unitPriceUsd,
          pinApproval,
          belowCost,
        })
        // WAFI-143: executeBusinessOperation's toEvent slot is already taken by
        // sale.completed for this write, and a sale can have multiple discount
        // instances (this loop + the sale-level block below) -- publishEvent() is
        // called directly here, fire-and-forget, the same escape hatch
        // device.registered already uses (Sprint 2 design spec §5a).
        void publishEvent({
          type: SalesEventType.Discounted,
          entityId: completed.saleId,
          payload: {
            discountType: line.discountType,
            discountValue: line.discountValue ?? 0,
            discountPercentage: line.discountType === 'percent' ? (line.discountValue ?? 0) : undefined,
            finalPriceUsd: line.unitPriceUsd,
            belowCost,
            pinApproval,
          } satisfies SaleDiscountedPayload,
          payloadVersion: 1,
          staffId: input.staffId ?? '',
          shopId: input.shopId,
          occurredAt: now,
        }).catch(() => {})
      }
      if (completed.saleDiscount) {
        const sd = completed.saleDiscount
        const pinApproval = Boolean(sd.pinApproved)
        await audit.logDiscountApplied(completed.saleId, {
          operatorId:    input.staffId,
          tierApplied:   'retail',
          basePriceUsd:  completed.totalUsd + sd.amountUsd,
          discountType:  sd.type,
          discountValue: sd.value,
          finalPriceUsd: completed.totalUsd,
          pinApproval,
          belowCost:     false,
        })
        void publishEvent({
          type: SalesEventType.Discounted,
          entityId: completed.saleId,
          payload: {
            discountType: sd.type,
            discountValue: sd.value,
            discountPercentage: sd.type === 'percent' ? sd.value : undefined,
            finalPriceUsd: completed.totalUsd,
            belowCost: false,
            pinApproval,
          } satisfies SaleDiscountedPayload,
          payloadVersion: 1,
          staffId: input.staffId ?? '',
          shopId: input.shopId,
          occurredAt: now,
        }).catch(() => {})
      }
    },
```

Also add `SaleDiscountedPayload` to this file's existing
`import type { SaleCompletedPayload } from '@/services/events/domainEvent.types'` line.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/sales.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full sales/events test suites to check for regressions**

Run: `npx vitest run src/services/ src/services/events/`
Expected: all PASS — no existing `sale.completed`/audit test should have changed
behavior; this task only adds calls, never removes or reorders existing ones.

- [ ] **Step 7: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/sales.service.ts src/services/__tests__/sales.service.test.ts
git commit -m "feat(WAFI-143): publish sale.discounted alongside existing discount audit calls"
```

---

### Task 3: `notifications` Postgres migration + RLS

**Files:**
- Create: `supabase/migrations/078_notifications.sql` (renumber to `079` if `078` is
  already claimed on the WAFI-150 branch by the time you implement this — see Global
  Constraints)

**Interfaces:**
- Produces: `public.notifications` table + RLS policies. Task 4 depends on the exact
  column list below; Task 8/9 depend on `source_event_id`'s uniqueness constraint shape.

- [ ] **Step 1: Confirm the actual next migration number**

Run: `ls supabase/migrations | sort | tail -5`
Use the number one higher than the highest listed. This step exists because this plan
was written against `main`, but implementation happens on a branch based on
`worktree-wafi-150-durable-audit`, which may have already added `078_audit_log_source_event_id.sql`.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/078_notifications.sql (or 079 -- see Step 1)
-- WAFI-143 -- durable business-fact table for the notification subscriber reference
-- consumer (design spec, "Notification consumer"). recipient_staff_id/recipient_role are
-- both nullable and not mutually exclusive by constraint: a notification targets one
-- staff member OR a whole role (today always 'owner'); the column exists now so
-- manager/supervisor/accountant targeting in a future ticket costs a row, not a migration.
-- source_event_id is NOT NULL (unlike audit_log's nullable/partial-index version) --
-- every row in this ticket's scope originates from exactly one event; revisit nullability
-- only if a future ticket introduces manual/system notifications with no originating event.

CREATE TABLE IF NOT EXISTS public.notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             TEXT NOT NULL,
  recipient_staff_id  TEXT,
  recipient_role      TEXT,
  type                TEXT NOT NULL,
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  entity_type         TEXT,
  entity_id           TEXT,
  severity            TEXT NOT NULL DEFAULT 'INFO'
                        CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  source_event_id     UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_event_id_unique
  ON public.notifications (source_event_id);

CREATE INDEX IF NOT EXISTS idx_notifications_shop_created
  ON public.notifications (shop_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: shop-scoped AND recipient-scoped -- the second axis no other table in this
-- codebase needs. A row targets a specific staff member OR a whole role; visible if
-- either matches the requester.
DROP POLICY IF EXISTS notifications_select_scoped ON public.notifications;
CREATE POLICY notifications_select_scoped ON public.notifications
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      recipient_staff_id = (SELECT public.auth_staff_id())::text
      OR recipient_role = (SELECT public.auth_role())
    )
  );

-- INSERT: shop-scoped only -- a writer (the notification subscriber, running as
-- whichever staff member's device triggered the originating event) is already gated by
-- the source event's own RLS; double-gating here on recipient would be redundant, not an
-- additional real boundary (the row's whole purpose is to be readable by someone OTHER
-- than the writer).
DROP POLICY IF EXISTS notifications_insert_all ON public.notifications;
CREATE POLICY notifications_insert_all ON public.notifications
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));

-- UPDATE: only for marking read_at -- shop-scoped AND recipient-scoped, same predicate
-- as SELECT (a staff member may only mark their own/their role's notifications read).
DROP POLICY IF EXISTS notifications_update_scoped ON public.notifications;
CREATE POLICY notifications_update_scoped ON public.notifications
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (
      recipient_staff_id = (SELECT public.auth_staff_id())::text
      OR recipient_role = (SELECT public.auth_role())
    )
  )
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));

GRANT ALL ON TABLE public.notifications TO anon, authenticated, service_role;
```

- [ ] **Step 3: Apply the migration to the local Supabase stack**

Run: `npx supabase migration up`
Expected: applies cleanly (Docker + `supabase start` must already be running — see
WAFI-150's Task 6 for the exact startup sequence if the stack isn't up).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/078_notifications.sql
git commit -m "feat(WAFI-143): add notifications table + RLS"
```

---

### Task 4: `notifications` + `local_today_revenue_projection` in `schema.ts`

**Files:**
- Modify: `src/data/powersync/schema.ts`

**Interfaces:**
- Produces: `notifications` (synced) and `local_today_revenue_projection` (local-only)
  `Table` declarations, registered in `AppSchema`. Task 5 depends on
  `local_today_revenue_projection`'s exact columns; Task 7/8 depend on `notifications`'s.

- [ ] **Step 1: Add both tables to `schema.ts`**

Near the existing `daily_event_counts`/`audit_log` declarations (around line 363-378),
add:

```ts
// WAFI-143 -- disposable, rebuildable read model (design spec, "Dashboard consumer").
// Never a source of truth for anything financial; may drift under event loss and
// self-corrects on the next full resync. (shop_id, date) is a LOGICAL key only --
// PowerSync's Table DSL has no composite-primary-key support, and this table's implicit
// `id` is the real primary key, same as daily_event_counts. The projection subscriber
// enforces uniqueness itself via read-then-insert-or-update, not a DB constraint.
const local_today_revenue_projection = new Table({
  shop_id:      column.text,
  date:         column.text,   // YYYY-MM-DD
  revenue_usd:  column.real,
  revenue_syp:  column.real,
  updated_at:   column.text,   // ISO string
}, { localOnly: true })

// WAFI-143 -- durable business facts produced by notificationSubscriber.ts (design spec,
// "Notification consumer"). Synced (unlike the projection above): the owner must see
// this on every device, not just the one that generated it.
const notifications = new Table({
  shop_id:             column.text,
  recipient_staff_id:  column.text,
  recipient_role:      column.text,
  type:                column.text,
  title:               column.text,
  message:             column.text,
  entity_type:         column.text,
  entity_id:           column.text,
  severity:            column.text,
  source_event_id:     column.text,
  created_at:          column.text,
  read_at:             column.text,
})
```

- [ ] **Step 2: Register both tables in the schema export**

In the `AppSchema = new Schema({ ... })` object (around line 464), add both identifiers
alongside the existing `daily_event_counts`/`audit_log` entries:

```ts
  local_today_revenue_projection,
  notifications,
```

- [ ] **Step 3: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(WAFI-143): add notifications and local_today_revenue_projection to schema.ts"
```

---

### Task 5: `dashboardRevenueProjection.ts` — lightweight subscriber

**Files:**
- Create: `src/services/events/dashboardRevenueProjection.ts`
- Test: `src/services/events/__tests__/dashboardRevenueProjection.test.ts`

**Interfaces:**
- Consumes: `useEventSubscription` (existing), `processProjectionAtMostOnce` +
  `SubscriberId` (existing, extended below), `SalesEventType`/`SaleCompletedPayload`
  (existing), `local_today_revenue_projection` (Task 4).
- Produces: `startDashboardRevenueProjection(shopId: string): { stop: () => void }`. Task
  12 (app wiring) depends on this exact name.

- [ ] **Step 1: Extend `SubscriberId`**

In `src/services/events/processProjectionAtMostOnce.ts`, extend the const object:

```ts
export const SubscriberId = {
  DailyEventCounts: 'daily_event_counts_projection',
  TodayRevenueProjection: 'today_revenue_projection',
} as const
```

- [ ] **Step 2: Write the failing test**

```ts
// src/services/events/__tests__/dashboardRevenueProjection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { startDashboardRevenueProjection } from '@/services/events/dashboardRevenueProjection'

describe('startDashboardRevenueProjection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a new row for a sale.completed on a day with no existing projection row', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null)  // processProjectionAtMostOnce's own ledger check
      .mockResolvedValueOnce(null)  // this projection's own "existing row for today" check
    let capturedHandler: ((row: any) => Promise<void>) | undefined
    // dashboardRevenueProjection.ts calls useEventSubscription directly (like
    // dailyEventCountsProjection.ts does) -- capture its handler the same way
    // useEventSubscription.test.ts does, via a mocked db.watch, OR (simpler here) call
    // startDashboardRevenueProjection and rely on useEventSubscription's real
    // implementation with a controlled db.watch fakeAsyncIterable. Use the latter --
    // see useEventSubscription.test.ts for the fakeAsyncIterable helper's shape and copy
    // it into this file (it is not currently exported for reuse).
    vi.mocked(db.watch).mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let done = false
        return {
          next: async () => {
            if (done) return { value: undefined, done: true }
            done = true
            return {
              value: {
                rows: {
                  _array: [{
                    id: 'evt1', type: 'sale.completed', entity_id: 'sale1',
                    payload: JSON.stringify({ saleId: 'sale1', shopId: 'shop1', staffId: 's1', totalUsd: 42, totalSyp: 630000, paymentSummary: { cashUsd: 42, cashSyp: 0, cardTotal: 0, creditTotal: 0, methodCount: 1 }, itemCount: 1, discountApplied: false }),
                    payload_version: 1, staff_id: 's1', shop_id: 'shop1',
                    occurred_at: '2026-08-06T10:00:00.000Z', created_at: '2026-08-06T10:00:00.000Z',
                  }],
                },
              },
              done: false,
            }
          },
          return: async () => ({ value: undefined, done: true }),
        }
      },
    })

    startDashboardRevenueProjection('shop1')
    await new Promise((r) => setTimeout(r, 0)) // let the async watch-loop IIFE run one tick

    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('insert into local_today_revenue_projection'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toContain('2026-08-06') // date derived from occurred_at
    expect(insertCall![1]).toContain(42)            // revenue_usd
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/dashboardRevenueProjection.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Implement**

```ts
// src/services/events/dashboardRevenueProjection.ts
import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

/**
 * Lightweight/best-effort (design spec, "Dashboard consumer"): folds sale.completed's
 * totalUsd/totalSyp into a disposable per-day revenue projection. Losing one event
 * under-counts today's revenue by one sale until the next full resync -- acceptable,
 * because this table is never treated as a source of truth for anything financial.
 * If it's ever visibly wrong, the fix is "rebuild from source" (re-run this subscriber
 * against sales directly), not "audit for a missing event."
 */
export function startDashboardRevenueProjection(shopId: string): { stop: () => void } {
  return useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      await processProjectionAtMostOnce(SubscriberId.TodayRevenueProjection, row.id, async () => {
        const date = row.occurred_at.slice(0, 10)
        // Read-then-insert-or-update, NOT an upsert -- same reason as
        // dailyEventCountsProjection.ts: PowerSync client tables are SQLite views over
        // CRUD-queue triggers, and SQLite rejects ON CONFLICT against a view.
        const existing = await db.getOptional<{ id: string; revenue_usd: number; revenue_syp: number }>(
          `SELECT id, revenue_usd, revenue_syp FROM local_today_revenue_projection WHERE shop_id = ? AND date = ?`,
          [shopId, date],
        )
        if (existing) {
          await db.execute(
            `UPDATE local_today_revenue_projection SET revenue_usd = ?, revenue_syp = ?, updated_at = ? WHERE id = ?`,
            [existing.revenue_usd + row.payload.totalUsd, existing.revenue_syp + row.payload.totalSyp, new Date().toISOString(), existing.id],
          )
        } else {
          await db.execute(
            `INSERT INTO local_today_revenue_projection (id, shop_id, date, revenue_usd, revenue_syp, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), shopId, date, row.payload.totalUsd, row.payload.totalSyp, new Date().toISOString()],
          )
        }
      })
    },
    { shopId },
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/dashboardRevenueProjection.test.ts`
Expected: PASS.

- [ ] **Step 6: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/events/dashboardRevenueProjection.ts src/services/events/__tests__/dashboardRevenueProjection.test.ts src/services/events/processProjectionAtMostOnce.ts
git commit -m "feat(WAFI-143): add dashboardRevenueProjection lightweight subscriber"
```

---

### Task 6: HomePage revenue tile goes live

**Files:**
- Modify: `src/pages/HomePage.vue`

**Interfaces:**
- Consumes: `local_today_revenue_projection` (Task 4), `db.watch` (existing).
- Produces: nothing new for later tasks — leaf UI change.

- [ ] **Step 1: Read the current tile and surrounding script setup**

Run: `grep -n "revenueUsd\|revenueSyp\|const metrics" src/pages/HomePage.vue`
Confirm the tile at (currently) lines 397-400 and the `revenueSyp` computed at (currently)
line 206 still match the shape described in this plan's research. `metrics` is the
`useDashboardMetrics()` instance — every other tile on this page keeps reading from it
unchanged; only the revenue tile's data source changes.

- [ ] **Step 2: Add a live revenue ref, sourced from `local_today_revenue_projection`**

In `HomePage.vue`'s `<script setup>`, add (near the existing `metrics`/`revenueSyp`
declarations):

```ts
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

const liveRevenueUsd = ref(0)
const liveRevenueSyp = ref(0)

onMounted(() => {
  const shopId = useDeviceStore().shopId
  const today = new Date().toISOString().slice(0, 10)
  const controller = new AbortController()
  ;(async () => {
    const iterable = db.watch(
      `SELECT revenue_usd, revenue_syp FROM local_today_revenue_projection WHERE shop_id = ? AND date = ?`,
      [shopId, today],
      { signal: controller.signal },
    )
    for await (const result of iterable) {
      const row = (result as any).rows?._array?.[0]
      liveRevenueUsd.value = row?.revenue_usd ?? 0
      liveRevenueSyp.value = row?.revenue_syp ?? 0
    }
  })().catch(() => {})
  onBeforeUnmount(() => controller.abort())
})
```

(Import `onMounted`/`onBeforeUnmount` from `'vue'` alongside whatever's already imported
there — check the existing top-of-file `import { ... } from 'vue'` line first and add to
it rather than introducing a second import statement.)

- [ ] **Step 3: Wire the tile to the new refs**

Replace the tile's two value expressions (currently lines 398 and 400):

```vue
          <div class="kc-value" dir="ltr">${{ liveRevenueUsd.toLocaleString() }}</div>
          <div class="kc-accent-bar"></div>
          <div class="kc-sub" v-if="liveRevenueSyp" dir="ltr">{{ liveRevenueSyp.toLocaleString() }} ل.س</div>
```

Do not remove `metrics.revenueUsd`/`revenueSyp` from the script — they're still used
elsewhere on this page (other tiles, period-range views) and by `ReportsPage.vue`; this
task only changes what the one "today" revenue tile reads from.

- [ ] **Step 4: Manual smoke test**

Run the dev server (`npm run dev`), open the home dashboard, complete a sale in another
tab/device (or via the POS flow), and confirm the revenue tile updates without a page
refresh. This is a `db.watch`-driven UI change with no automated test in this plan —
PowerSync's reactive query plumbing is already covered by existing tests elsewhere
(`useEventSubscription.test.ts`), and this task is a thin, low-risk template-binding
change on top of it.

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat(WAFI-143): make HomePage revenue tile live via local_today_revenue_projection"
```

---

### Task 7: `notificationSubscriber.ts` — durable subscriber

**Files:**
- Create: `src/services/events/notificationSubscriber.ts`
- Test: `src/services/events/__tests__/notificationSubscriber.test.ts`

**Interfaces:**
- Consumes: `runDurableSubscriber` + `DurableEvent` (from the WAFI-150 branch — confirm
  these exist in your working tree per the Global Constraints branch note before starting
  this task), `SalesEventType.Discounted`/`SaleDiscountedPayload` (Task 1), `notifications`
  (Task 4).
- Produces: `mapEventToNotification(event: DomainEvent): NotificationInsert | null`,
  `startNotificationSubscribers(shopId: string): { stop: () => void }`. Task 12 (app
  wiring) depends on the latter's exact name.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/notificationSubscriber.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { mapEventToNotification, startNotificationSubscribers } from '@/services/events/notificationSubscriber'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const baseEvent = {
  entityId: 'sale1', payloadVersion: 1, staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-08-06T00:00:00.000Z',
}

describe('mapEventToNotification', () => {
  it('maps a below-cost sale.discounted event to a CRITICAL notification', () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'percent', discountValue: 40, discountPercentage: 40, finalPriceUsd: 6, belowCost: true, pinApproval: false },
    }
    const entry = mapEventToNotification(event)
    expect(entry).not.toBeNull()
    expect(entry!.severity).toBe('CRITICAL')
    expect(entry!.entity_type).toBe('sale')
    expect(entry!.entity_id).toBe('sale1')
    expect(entry!.recipient_role).toBe('owner')
  })

  it('maps a PIN-approved (but not below-cost) sale.discounted event to a WARNING notification', () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'fixed', discountValue: 5, finalPriceUsd: 20, belowCost: false, pinApproval: true },
    }
    const entry = mapEventToNotification(event)
    expect(entry).not.toBeNull()
    expect(entry!.severity).toBe('WARNING')
  })

  it('returns null for a sale.discounted event that is neither below-cost nor PIN-approved', () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.discounted',
      payload: { discountType: 'percent', discountValue: 5, discountPercentage: 5, finalPriceUsd: 19, belowCost: false, pinApproval: false },
    }
    expect(mapEventToNotification(event)).toBeNull()
  })

  it('returns null for an unrelated event type (protects the mapping boundary)', () => {
    const event: DomainEvent = {
      ...baseEvent, type: 'sale.completed',
      payload: { saleId: 'sale1', shopId: 'shop1', staffId: 's1', totalUsd: 10, totalSyp: 150000, paymentSummary: { cashUsd: 10, cashSyp: 0, cardTotal: 0, creditTotal: 0, methodCount: 1 }, itemCount: 1, discountApplied: false },
    }
    expect(mapEventToNotification(event)).toBeNull()
  })
})

describe('startNotificationSubscribers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writing a below-cost discount once produces exactly one notifications insert with source_event_id set', async () => {
    // See Global Constraints' "known footgun" note -- resetModules BEFORE doMock +
    // dynamic re-import, and re-import db fresh too, exactly like
    // auditSubscriber.test.ts's equivalent test.
    vi.resetModules()
    let capturedHandler: ((row: any) => Promise<void>) | undefined
    vi.doMock('@/services/events/useEventSubscription', () => ({
      useEventSubscription: vi.fn((_type: string, handler: any) => {
        capturedHandler = handler
        return { stop: vi.fn() }
      }),
    }))
    const { db: freshDb } = await import('@/data/powersync/db')
    const { startNotificationSubscribers: freshStart } = await import('@/services/events/notificationSubscriber')
    vi.mocked(freshDb.getOptional).mockResolvedValue(null)
    freshStart('shop1')
    await capturedHandler!({
      id: 'evt1', type: 'sale.discounted', entity_id: 'sale1',
      payload: { discountType: 'percent', discountValue: 40, discountPercentage: 40, finalPriceUsd: 6, belowCost: true, pinApproval: false },
      payload_version: 1, staff_id: 's1', shop_id: 'shop1', occurred_at: '2026-08-06T00:00:00.000Z', created_at: '2026-08-06T00:00:00.000Z',
    })
    const insertCall = vi.mocked(freshDb.execute).mock.calls.find(([sql]) => sql.includes('insert into notifications'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toContain('evt1') // source_event_id present
  })

  it('redelivering the same event does not duplicate the notification (idempotency)', async () => {
    vi.resetModules()
    let capturedHandler: ((row: any) => Promise<void>) | undefined
    vi.doMock('@/services/events/useEventSubscription', () => ({
      useEventSubscription: vi.fn((_type: string, handler: any) => {
        capturedHandler = handler
        return { stop: vi.fn() }
      }),
    }))
    const { db: freshDb } = await import('@/data/powersync/db')
    const { startNotificationSubscribers: freshStart } = await import('@/services/events/notificationSubscriber')
    // First delivery: not yet processed, not yet in notifications.
    vi.mocked(freshDb.getOptional).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    // Second (redelivered) call: runDurableSubscriber's own processed-ledger check will
    // short-circuit before this handler's own dedup lookup even runs -- but assert on
    // the OUTCOME (one insert total), not on which specific guard caught it, since
    // that's an implementation detail of runDurableSubscriber, not this subscriber.
    freshStart('shop1')
    const row = {
      id: 'evt1', type: 'sale.discounted', entity_id: 'sale1',
      payload: { discountType: 'percent', discountValue: 40, discountPercentage: 40, finalPriceUsd: 6, belowCost: true, pinApproval: false },
      payload_version: 1, staff_id: 's1', shop_id: 'shop1', occurred_at: '2026-08-06T00:00:00.000Z', created_at: '2026-08-06T00:00:00.000Z',
    }
    await capturedHandler!(row)
    vi.mocked(freshDb.getOptional).mockResolvedValue({ event_id: 'evt1' }) // now "already processed"
    await capturedHandler!(row)
    const inserts = vi.mocked(freshDb.execute).mock.calls.filter(([sql]) => sql.includes('insert into notifications'))
    expect(inserts).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/notificationSubscriber.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/services/events/notificationSubscriber.ts
import { db } from '@/data/powersync/db'
import { runDurableSubscriber } from './runDurableSubscriber'
import type { DurableEvent } from './runDurableSubscriber'
import type { DomainEvent, DomainEventType, SaleDiscountedPayload } from './domainEvent.types'

export interface NotificationInsert {
  type: string
  title: string
  message: string
  entity_type: string
  entity_id: string | null
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  recipient_staff_id: string | null
  recipient_role: string | null
}

/**
 * Maps a domain event to its notifications row, or null if this event doesn't cross the
 * notify threshold (design spec: reuse useAuditLog's existing belowCost || pinApproval
 * significance criterion -- no new numeric threshold). Only sale.discounted produces a
 * notification today; every other event type returns null (protects the mapping boundary
 * -- see the "unrelated event type" test).
 */
export function mapEventToNotification(event: DomainEvent): NotificationInsert | null {
  if ((event.type as DomainEventType) !== 'sale.discounted') return null
  const { belowCost, pinApproval, discountType, discountValue, finalPriceUsd } = event.payload as SaleDiscountedPayload
  if (!belowCost && !pinApproval) return null

  return {
    type: 'discount.large_applied',
    title: 'خصم كبير مُطبَّق',
    message: `تم تطبيق خصم ${discountType === 'percent' ? `${discountValue}%` : `$${discountValue}`} على عملية بيع، السعر النهائي $${finalPriceUsd}`,
    entity_type: 'sale',
    entity_id: event.entityId,
    severity: belowCost ? 'CRITICAL' : 'WARNING',
    recipient_role: 'owner',
    recipient_staff_id: null,
  }
}

async function handleDiscountEvent(event: DurableEvent<unknown>): Promise<void> {
  const entry = mapEventToNotification(event)
  if (!entry) return // null mapping is success -- runDurableSubscriber still writes the ledger

  // Check-then-insert, same reasoning as auditSubscriber.ts: safe on this single-
  // threaded client (no concurrent execution of this handler to race against); the real
  // database-enforced dedup backstop lives at sync-upload time in ops.ts (Task 8),
  // keyed on this same source_event_id.
  const existing = await db.getOptional<{ id: string }>(
    `select id from notifications where source_event_id = ?`,
    [event.eventId],
  )
  if (existing) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_staff_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(), event.shopId, entry.recipient_staff_id, entry.recipient_role,
      entry.type, entry.title, entry.message, entry.entity_type, entry.entity_id,
      entry.severity, event.eventId, new Date().toISOString(),
    ],
  )
}

export function startNotificationSubscribers(shopId: string): { stop: () => void } {
  const subscription = runDurableSubscriber({
    subscriberName: 'notifications',
    eventType: 'sale.discounted',
    shopId,
    handler: handleDiscountEvent,
  })
  return { stop: () => subscription.stop() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/notificationSubscriber.test.ts`
Expected: PASS, full file.

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/events/notificationSubscriber.ts src/services/events/__tests__/notificationSubscriber.test.ts
git commit -m "feat(WAFI-143): add mapEventToNotification and startNotificationSubscribers"
```

---

### Task 8: `ops.ts` upload-path dedup for `notifications`

**Files:**
- Modify: `src/data/powersync/ops.ts`
- Test: `src/data/powersync/__tests__/ops.test.ts`

**Interfaces:**
- Consumes: `notifications.source_event_id` (Task 3).
- Produces: `runOp`'s `notifications` special case — `PUT` upserts on
  `onConflict: 'source_event_id'` (unqualified, since the column is `NOT NULL`); `PATCH`
  (marking `read_at`) falls through to the generic per-id update, unlike `audit_log`
  which blocks `PATCH` entirely (`notifications` is not append-only — marking a
  notification read is a legitimate update).

- [ ] **Step 1: Read the current `runOp` structure to confirm the exact insertion point**

Run: `sed -n '1,40p' src/data/powersync/ops.ts`
Confirm the `if (table === 'audit_log') { ... }` early-return block (added by WAFI-150's
Task 6) is present before this task's edit — this task adds a **sibling** `if` block for
`notifications`, structured differently (it must NOT early-return for every `type`, since
`PATCH` needs to fall through to the generic switch below).

- [ ] **Step 2: Write the failing tests**

Add to `src/data/powersync/__tests__/ops.test.ts` (matching its existing `upsert`/`update`/`from`
mock style — see the file's top for the exact mock shape):

```ts
  it('upserts notifications on source_event_id (ignoreDuplicates) on PUT', async () => {
    await runOp(UpdateType.PUT, 'notifications', 'row1', { type: 'discount.large_applied', source_event_id: 'evt1' })
    expect(upsert).toHaveBeenCalledWith(
      { id: 'row1', type: 'discount.large_applied', source_event_id: 'evt1' },
      { onConflict: 'source_event_id', ignoreDuplicates: true },
    )
  })

  it('falls through to a normal per-id UPDATE for notifications on PATCH (marking read_at)', async () => {
    await runOp(UpdateType.PATCH, 'notifications', 'row1', { read_at: '2026-08-06T00:00:00.000Z' })
    expect(update).toHaveBeenCalledWith({ read_at: '2026-08-06T00:00:00.000Z' })
  })
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: the two new tests FAIL (current code has no special case for `notifications` at
all, so `PUT` falls into the generic `upsert(...)` without `onConflict`, and `PATCH`
already happens to hit `update` today — confirm which of the two actually fails before
assuming both do; only the `PUT` case is expected to fail if `PATCH`'s generic path
already matches).

- [ ] **Step 4: Implement**

In `src/data/powersync/ops.ts`, add a sibling block to the existing `audit_log` special
case (do not modify the `audit_log` block itself):

```ts
  // WAFI-143: notifications is NOT append-only like audit_log -- marking read_at is a
  // legitimate update, so only PUT gets special dedup treatment here; PATCH/DELETE fall
  // through to the generic switch below.
  if (table === 'notifications' && type === UpdateType.PUT) {
    return (await supabase.from(table).upsert({ id, ...opData }, { onConflict: 'source_event_id', ignoreDuplicates: true })).error
  }
```

Place this directly after the existing `if (table === 'audit_log') { ... }` block and
before the generic `switch (type) { ... }` statement.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data/powersync/__tests__/ops.test.ts`
Expected: PASS, full file.

- [ ] **Step 6: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/powersync/ops.ts src/data/powersync/__tests__/ops.test.ts
git commit -m "feat(WAFI-143): add notifications.source_event_id upload-path dedup"
```

---

### Task 9: pgTAP — `notifications` uniqueness + RLS cross-check

**Files:**
- Create: `supabase/tests/wafi143_notifications.test.sql`

**Interfaces:**
- Consumes: `notifications_source_event_id_unique` (Task 3), `notifications_select_scoped`
  (Task 3).
- Produces: no exports — test-only task.

- [ ] **Step 1: Write the test file**

```sql
-- supabase/tests/wafi143_notifications.test.sql
-- WAFI-143: notifications.source_event_id uniqueness + per-recipient RLS.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(4);

-- The unique index exists (Task 3's migration).
SELECT has_index('public', 'notifications', 'notifications_source_event_id_unique',
  'notifications_source_event_id_unique index exists');

-- A second insert sharing source_event_id is silently absorbed via
-- ON CONFLICT (source_event_id) DO NOTHING, the SQL-level equivalent of
-- supabase-js's ignoreDuplicates:true (mirrors WAFI-150's wafi150_audit_dedup pattern).
INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, entity_type, entity_id, source_event_id)
VALUES ('e0000000-0000-0000-0000-000000000001', 'owner', 'discount.large_applied', 't', 'm', 'sale', 's1', 'ee000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $$INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, entity_type, entity_id, source_event_id)
    VALUES ('e0000000-0000-0000-0000-000000000001', 'owner', 'discount.large_applied', 't', 'm', 'sale', 's1', 'ee000000-0000-0000-0000-000000000001')
    ON CONFLICT (source_event_id) DO NOTHING$$,
  'a second insert sharing source_event_id is silently absorbed, not a unique-violation error'
);

-- RLS cross-check: set up an owner (shop 1) and a cashier (shop 1) auth context and
-- confirm a role-targeted notification is visible to the owner but not fabricated as
-- visible to a different shop's owner.
INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'owner-wafi143@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000001', 'WAFI-143 Shop 1', 'e0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000004', 'owner2-wafi143@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000003', 'WAFI-143 Shop 2', 'e0000000-0000-0000-0000-000000000004');

INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, entity_type, entity_id, source_event_id)
VALUES ('e0000000-0000-0000-0000-000000000003', 'owner', 'discount.large_applied', 't', 'm', 'sale', 's2', 'ee000000-0000-0000-0000-000000000002');

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', json_build_object('sub', 'e0000000-0000-0000-0000-000000000002', 'active_role', 'owner', 'staff_id', null)::text, true);

SELECT results_eq(
  $$SELECT count(*)::int FROM public.notifications WHERE entity_id = 's2'$$,
  $$SELECT 0$$,
  'a shop-1 owner cannot see a notification belonging to shop 2'
);

SELECT results_eq(
  $$SELECT count(*)::int FROM public.notifications WHERE entity_id = 's1'$$,
  $$SELECT 1$$,
  'a shop-1 owner CAN see a role=owner notification targeted at their own shop'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the suite**

Run: `npx supabase test db`
Expected: all 4 assertions pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/wafi143_notifications.test.sql
git commit -m "test(WAFI-143): add pgTAP coverage for notifications uniqueness and per-recipient RLS"
```

---

### Task 10: PowerSync sync-rule scoping for `notifications` (manual/external configuration)

**Files:** none in this repository — PowerSync sync rules are configured outside this
repo, in the PowerSync dashboard/config (same as WAFI-140 Sprint 3's 90-day retention
sync-rule change).

**Interfaces:** none — this task has no code artifact, only a required manual step and
its verification record.

- [ ] **Step 1: Understand why this task exists**

Server-side RLS (Task 3) is necessary but **not sufficient**: a device's local PowerSync
database downloads whatever its sync rule permits, independent of what RLS would allow a
direct query to return. Without a matching sync-rule change, a notification addressed to
staff member A can still be downloaded onto staff member B's device — B's app UI would
never render it (client code filters/queries by recipient), but the row is present at
rest in B's local SQLite database, which is a confidentiality gap regardless of whether
the UI ever surfaces it.

- [ ] **Step 2: Add or update the `notifications` sync bucket definition**

In the PowerSync dashboard (or sync-rules config file, wherever this project's existing
buckets for e.g. `audit_log`/`events` are defined — outside this repo), add a
`notifications` bucket parameterized on **both** `shop_id` and the requesting device's
resolved staff identity/role, not `shop_id` alone. The exact bucket syntax depends on
this project's PowerSync sync-rules YAML shape (not visible from this repo) — mirror
whatever parameterization pattern the existing per-shop buckets already use, extended
with a second parameter for recipient scoping (e.g. a bucket per `(shop_id,
recipient_staff_id)` plus a separate bucket per `(shop_id, recipient_role)` that only a
device whose active staff member holds that role subscribes to).

- [ ] **Step 3: Verify — acceptance criterion, not optional**

Using two test devices (or two browser profiles) logged in as different staff members in
the same shop, trigger a `sale.discounted` event that produces a notification (a
below-cost or PIN-approved discount). Confirm:
- The owner's device receives the notification (via `db.watch` on `notifications`
  updating, and/or by directly querying the device's local SQLite database).
- A cashier's device on the same shop does **not** have the row present in its local
  database at all — not merely hidden by the UI. Check this by running a raw query
  against that device's local PowerSync SQLite file/inspector, not just the app UI.

This step cannot be automated in this repo's Vitest/pgTAP suites (it requires the real
PowerSync sync-rule engine and at least two live device sessions) — record the result
(pass/fail, date, who verified) in this ticket's status entry when done. The ticket is
not complete until this passes.

- [ ] **Step 4: No commit** — this task produces no repo changes. If a follow-up decision
was made to check sync-rule config into this repo (some PowerSync setups support this),
add that file and commit it now; otherwise skip straight to Task 11.

---

### Task 11: Notification badge + list UI on HomePage

**Files:**
- Modify: `src/pages/HomePage.vue` (or a new small component
  `src/features/notifications/components/NotificationBell.vue` if `HomePage.vue` is
  already large enough that adding this inline would make it unwieldy — check the file's
  current line count first; if it's already several hundred lines, prefer the new
  component)

**Interfaces:**
- Consumes: `notifications` (Task 4).
- Produces: nothing new for later tasks — leaf UI change. WAFI-145 (Owner Notification
  Center) will likely replace or significantly extend this component later; keep it
  small and easy to replace.

- [ ] **Step 1: Decide inline vs. new component**

Run: `wc -l src/pages/HomePage.vue`
If over ~400 lines, create `src/features/notifications/components/NotificationBell.vue`
as a standalone component and mount it from `HomePage.vue`'s template (one line:
`<NotificationBell />`). If under that, add directly to `HomePage.vue` following the same
structural pattern as Task 6's live-revenue wiring (a `ref` + `onMounted`/`db.watch`
block).

- [ ] **Step 2: Implement the unread-count badge + list**

Following `SyncIndicator.vue`'s toggle-panel pattern (a `ref panelOpen`, a tappable
trigger, an `Escape`-key dismiss handler):

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

interface NotificationRow {
  id: string
  title: string
  message: string
  entity_type: string | null
  entity_id: string | null
  severity: string
  created_at: string
  read_at: string | null
}

const notifications = ref<NotificationRow[]>([])
const panelOpen = ref(false)
const unreadCount = ref(0)

function togglePanel() {
  panelOpen.value = !panelOpen.value
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') panelOpen.value = false
}

async function markRead(id: string) {
  await db.execute(`UPDATE notifications SET read_at = ? WHERE id = ?`, [new Date().toISOString(), id])
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  const shopId = useDeviceStore().shopId
  const controller = new AbortController()
  ;(async () => {
    const iterable = db.watch(
      `SELECT * FROM notifications WHERE shop_id = ? ORDER BY created_at DESC LIMIT 50`,
      [shopId],
      { signal: controller.signal },
    )
    for await (const result of iterable) {
      const rows: NotificationRow[] = (result as any).rows?._array ?? []
      notifications.value = rows
      unreadCount.value = rows.filter((r) => !r.read_at).length
    }
  })().catch(() => {})
  onBeforeUnmount(() => {
    controller.abort()
    window.removeEventListener('keydown', onKeydown)
  })
})
</script>

<template>
  <div class="notification-bell">
    <button
      type="button"
      :aria-label="`الإشعارات${unreadCount ? ` (${unreadCount} غير مقروء)` : ''}`"
      @click="togglePanel"
    >
      🔔
      <span v-if="unreadCount" class="notification-badge">{{ unreadCount }}</span>
    </button>
    <div v-if="panelOpen" class="notification-panel">
      <div
        v-for="n in notifications"
        :key="n.id"
        class="notification-item"
        :class="{ unread: !n.read_at }"
        @click="markRead(n.id)"
      >
        <div class="notification-title">{{ n.title }}</div>
        <div class="notification-message">{{ n.message }}</div>
        <div class="notification-time" dir="ltr">{{ n.created_at }}</div>
      </div>
      <div v-if="!notifications.length" class="notification-empty">لا توجد إشعارات</div>
    </div>
  </div>
</template>
```

Explicitly do not add filtering, categorization, per-type settings, or delivery-channel
configuration to this component — that is WAFI-145's scope, not this ticket's.

- [ ] **Step 3: Mount it (if built as a standalone component)**

In `HomePage.vue`'s template, add `<NotificationBell />` near the existing header/KPI
strip, and import it at the top of the `<script setup>` block:

```ts
import NotificationBell from '@/features/notifications/components/NotificationBell.vue'
```

- [ ] **Step 4: Manual smoke test**

Run the dev server, trigger a below-cost or PIN-approved discount sale, and confirm the
badge count increments and the notification appears in the list without a page refresh.
Click it and confirm `read_at` gets set (badge count decrements).

- [ ] **Step 5: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/components/NotificationBell.vue src/pages/HomePage.vue
git commit -m "feat(WAFI-143): add notification badge + list UI"
```

---

### Task 12: Wire both subscribers at app init

**Files:**
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `startDashboardRevenueProjection` (Task 5), `startNotificationSubscribers`
  (Task 7).
- Produces: nothing new for later tasks — this is the final integration point.

- [ ] **Step 1: Add the imports**

In `src/App.vue`, alongside the existing three sweeper imports (currently lines 21-23),
add:

```ts
import { startDashboardRevenueProjection } from '@/services/events/dashboardRevenueProjection'
import { startNotificationSubscribers } from '@/services/events/notificationSubscriber'
```

- [ ] **Step 2: Add the calls**

In the same `onMounted` block, directly after the existing
`startEventTableCleanupSweeper()` call (currently line 131), add:

```ts
  startDashboardRevenueProjection(useDeviceStore().shopId)
  startNotificationSubscribers(useDeviceStore().shopId)
```

- [ ] **Step 3: Manual smoke test**

Run the dev server, log in, complete a sale, and confirm (via browser devtools/console,
or by re-running Task 6/11's manual smoke tests) both subscribers are actually running —
this is the same "dormant consumer" bug class the WAFI-140 Sprint 3 final review already
caught once for `startDailyEventCountsProjection` (it existed but was never called); do
not skip this check.

- [ ] **Step 4: Run type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.vue
git commit -m "feat(WAFI-143): start dashboardRevenueProjection and notificationSubscriber at app init"
```

---

### Task 13: `EVENT_SUBSCRIBERS.md` convention doc

**Files:**
- Create: `docs/architecture/EVENT_SUBSCRIBERS.md`

**Interfaces:** none — documentation-only task.

- [ ] **Step 1: Write the doc**

```markdown
# Event Subscribers — Convention Guide

This doc exists so the next event-bus consumer (WAFI-144/145/146 and beyond) copies an
established pattern instead of re-deriving one. Written as part of WAFI-143, the first
ticket to ship two subscribers side by side with genuinely different failure profiles.

## Two subscriber categories

### Lightweight (`useEventSubscription` + `processProjectionAtMostOnce`)

**Use when:** the consumer is a read model — dashboard metrics, analytics, temporary
projections. Losing an event is acceptable because the projection can be silently
rebuilt from source data with nobody worse off.

**Characteristics:** no guaranteed delivery; no persistent retry queue; the only
protection against double-counting on redelivery is the at-most-once processed ledger
(`processProjectionAtMostOnce`), which is single-device and does not survive a fresh
resync from scratch.

**Examples:** `dailyEventCountsProjection.ts` (WAFI-140), `dashboardRevenueProjection.ts`
(WAFI-143).

### Durable (`runDurableSubscriber`)

**Use when:** a user action requires follow-up, the record is compliance/audit-relevant,
or an operational workflow genuinely depends on delivery. Losing this delivery would
matter to the business.

**Characteristics:** persistent retry queue (`local_event_processing_retries`) with
backoff+jitter; a handler is retried until it succeeds or is marked permanently failed
(surfaced for operator review, never silently dropped); idempotency is a hard
requirement (see below), not optional.

**Examples:** `auditSubscriber.ts` (WAFI-150), `notificationSubscriber.ts` (WAFI-143).

## The decision rule

Ask: **"can this be silently rebuilt from source data with nobody worse off?"** If yes,
lightweight. If losing this delivery would actually matter to the business, durable.

## Idempotency requirement (durable subscribers only)

A durable handler MUST be safe to invoke more than once for the same event —
`runDurableSubscriber`'s at-least-once delivery plus its own retry mechanism both mean a
handler can run twice for the same underlying event. The standard mechanism: the target
table gets a `source_event_id` column plus a unique index, checked with a
check-then-insert in the handler and enforced again at sync-upload time in
`src/data/powersync/ops.ts`'s `runOp` (see `audit_log`'s and `notifications`' special
cases there for the exact pattern). Make the index **partial**
(`WHERE source_event_id IS NOT NULL`) if the table also has legacy/manual rows with no
originating event (`audit_log`'s case); make it unqualified if every row always
originates from an event (`notifications`' case). This is not a per-subscriber
reinvention — copy the existing pattern, don't design a new one.

## Wiring convention

Every subscriber is a `start*(shopId: string): { stop: () => void }` function, called
exactly once inside `src/App.vue`'s `onMounted` block, alongside the existing sweepers
(`startRetryQueueSweeper`, `startDailyEventCountsProjection`,
`startEventTableCleanupSweeper`, `startAuditSubscribers`, `startDashboardRevenueProjection`,
`startNotificationSubscribers`). A subscriber that exists but is never called here is a
dormant consumer — this exact bug already happened twice (WAFI-140 Sprint 1's
`dailyEventCountsProjection` and, per its own design spec, nearly happened again) — check
this explicitly, don't assume wiring "obviously" happened because the file exists.

## File location convention

Flat under `src/services/events/`, one file per subscriber, named for what it does (e.g.
`notificationSubscriber.ts`), not which ticket added it (never
`wafi143Subscriber.ts`). No `publishers/`/`subscribers/`/`projections/` subdirectory
split — this repo's event-bus code has always been flat, and restructuring existing
files is out of scope for any single subscriber-adding ticket.

## Minimum test bar

Every subscriber needs:
1. A pure mapping-function test (`mapEventToX(event): X | null`) covering at least one
   "produces an entry" case, one "returns null, event doesn't qualify" case, and one
   "returns null, unrelated event type" case (protects the mapping boundary against a
   future refactor accidentally widening what the subscriber reacts to).
2. A delivery test — feed a synthetic event row through the subscriber's `start*()`
   handler and assert the expected DB write happened.

Durable subscribers additionally require:
3. A redelivery/dedup test — deliver the same event twice, assert exactly one write
   happened, not two.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/EVENT_SUBSCRIBERS.md
git commit -m "docs(WAFI-143): add EVENT_SUBSCRIBERS.md convention guide"
```

---

### Task 14: `DOMAIN INTERACTION MATRIX` updates

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md`

**Interfaces:** none — documentation-only task, and the final task in this plan.

- [ ] **Step 1: Add the `Notifications` row**

In `AI_PRINCIPAL_ENGINEER_REVIEW.md`'s `DOMAIN INTERACTION MATRIX` table (after the
`Events` row), add:

```
| Notifications | `notifications` | Sales (via `sale.discounted`), Staff (recipient targeting) | `notificationSubscriber`, (future) notification-center composable | HomePage badge (this ticket); full center is WAFI-145 |
```

- [ ] **Step 2: Update the `Events` row's last column**

Change the `Events` row's "Reports/Dashboards affected" cell from:

```
none yet (still no user-facing consumer — WAFI-143/144/145/146)
```

to:

```
Dashboard (today's revenue tile), Notifications (WAFI-143's two reference consumers)
```

- [x] **Step 3: Fill in the Cross-Epic Edge-Case Checklist (final review) block**

Per this file's own instructions, append to this ticket's final-review write-up (wherever
that's tracked — the WAFI status doc or a dedicated review note):

```
## Cross-Epic Edge-Case Checklist (final review)
Matrix rows re-checked after implementation: Sales, Events, Staff, Notifications.
Domains touched but not covered in the original spec checklist: Dashboard/Reports. This
was NOT in the original design-time checklist because Task 6's live-wiring of the
revenue tile (via db.watch on local_today_revenue_projection) silently changed the
tile's period semantics -- it always showed live today's-revenue regardless of the
selected period toggle, disagreeing with every sibling KPI tile that reads
metrics.load(period), and made profitMarginPct's ratio inconsistent with the number
actually displayed. The final whole-branch review caught this gap and it was corrected
in the WAFI-143 final-review fix wave (period-gated the tile: live value only for
period="today", metrics.revenueUsd/its SYP equivalent otherwise, with a documented
stopgap fallback to metrics.revenueUsd for a fresh device whose local projection has no
row yet).
```

If implementation actually touched a domain the design-time checklist didn't list (e.g.
if the UI work in Task 11 ended up needing a Staff-role lookup not anticipated at design
time), list it here honestly rather than silently patching it — that's the whole point of
this checklist existing twice.

- [ ] **Step 4: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md
git commit -m "docs(WAFI-143): update DOMAIN INTERACTION MATRIX for notifications"
```
