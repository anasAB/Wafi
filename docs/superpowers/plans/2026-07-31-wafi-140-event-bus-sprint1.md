# WAFI-140 Sprint 1 — Business Event Bus Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `publishEvent()` persist real, tenant-isolated, offline-safe events, and prove a
subscriber can react to them via one reference read-model.

**Architecture:** `executeBusinessOperation`'s existing `toEvent` hooks (9 call sites, unchanged)
feed a real `publishEvent()` that inserts into a new PowerSync-synced `events` table (append-only,
RLS-scoped). A new `useEventSubscription` composable wraps a PowerSync watch query; a reference
read-model subscriber increments `daily_event_counts` on `sale.completed`.

**Tech Stack:** Vue 3, TypeScript, PowerSync (`@powersync/web`), Postgres/Supabase, Vitest, pgTAP.

## Global Constraints

- Sprint 1 only. No idempotency/dedup, no offline-replay queue, no rate limiting, no
  cross-tenant penetration hardening — all explicitly Sprint 2/3 (see design spec §2).
- `publishEvent()` stays fire-and-forget from `executeBusinessOperation`'s perspective — never
  block or fail a business write.
- Every new/changed RLS policy must use the `(select public.auth_shop_id())` wrapped-scalar-subquery
  shape (matches `015_rls_tenant_scoping.sql`, `057_inventory_domain_rls.sql`) — never an inline
  `owner_user_id = auth.uid()` subquery.
- `events` is append-only: no UPDATE/DELETE policy, ever (matches `audit_log`,
  `018_audit_log_append_only.sql`).
- Every event's `type` field must be a `DomainEventType` value — never a raw string literal at a
  new call site.
- Design spec: `docs/superpowers/specs/2026-07-31-wafi-140-event-bus-sprint1-design.md` — read
  §3 (delivery guarantees) and §4 (event contract rules) before writing any task's code; this plan
  assumes familiarity with both.

---

### Task 1: `events` + `daily_event_counts` migration

**Files:**
- Create: `supabase/migrations/074_events_bus_core.sql`
- Test: `supabase/tests/wafi140_events_rls.test.sql`

**Interfaces:**
- Produces: `public.events` table (`id, type, entity_id, payload, payload_version, staff_id,
  shop_id, occurred_at, created_at`), `public.daily_event_counts` table (`id, shop_id, event_type,
  day, count`), both RLS-enabled and added to the `powersync`/`powersync_publication` publications.
  Later tasks depend on both existing and being synced.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/074_events_bus_core.sql
-- WAFI-140 Sprint 1 — event bus core. See design spec
-- docs/superpowers/specs/2026-07-31-wafi-140-event-bus-sprint1-design.md §4.

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_version integer NOT NULL DEFAULT 1,
  staff_id uuid NOT NULL,
  shop_id uuid NOT NULL REFERENCES public.shops(id),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_shop_type_idx ON public.events (shop_id, type, occurred_at DESC);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Append-only (matches audit_log, 018_audit_log_append_only.sql): no UPDATE/DELETE
-- policy is created. SELECT/INSERT stay shop-wide this sprint (per-event-type
-- restriction, e.g. cashier can't see staff.ledger_entry_added, is Sprint 3).
DROP POLICY IF EXISTS events_select_all ON public.events;
CREATE POLICY events_select_all ON public.events
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS events_insert_all ON public.events;
CREATE POLICY events_insert_all ON public.events
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));

CREATE TABLE IF NOT EXISTS public.daily_event_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id),
  event_type text NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  UNIQUE (shop_id, event_type, day)
);

ALTER TABLE public.daily_event_counts ENABLE ROW LEVEL SECURITY;

-- Full CRUD (unlike events): a mutable projection, incremented in place by the
-- reference read-model subscriber (Task 5), not an append-only log.
DROP POLICY IF EXISTS daily_event_counts_select_all ON public.daily_event_counts;
CREATE POLICY daily_event_counts_select_all ON public.daily_event_counts
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS daily_event_counts_insert_all ON public.daily_event_counts;
CREATE POLICY daily_event_counts_insert_all ON public.daily_event_counts
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS daily_event_counts_update_all ON public.daily_event_counts;
CREATE POLICY daily_event_counts_update_all ON public.daily_event_counts
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));

DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['events', 'daily_event_counts']
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = pub_name AND schemaname = 'public' AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', pub_name, tbl);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Write the pgTAP RLS test**

```sql
-- supabase/tests/wafi140_events_rls.test.sql
-- WAFI-140: events/daily_event_counts RLS cross-shop isolation.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(6);

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'owner-e1@wafi140.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000002';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000001', 'WAFI-140 Shop 1', 'e0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000004', 'owner-e2@wafi140.test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');
DELETE FROM public.shops WHERE owner_user_id = 'e0000000-0000-0000-0000-000000000004';
INSERT INTO public.shops (id, name, owner_user_id)
VALUES ('e0000000-0000-0000-0000-000000000003', 'WAFI-140 Shop 2', 'e0000000-0000-0000-0000-000000000004');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, is_active)
VALUES ('e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', 'Owner1', 'x', 'owner', true);

-- Seed as postgres (bypasses RLS): one event + one daily_event_counts row for Shop 1.
INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
VALUES ('sale.completed', 'sale-1', '{"saleId":"sale-1"}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now());
INSERT INTO public.daily_event_counts (shop_id, event_type, day, count)
VALUES ('e0000000-0000-0000-0000-000000000001', 'sale.completed', current_date, 1);

-- As Shop 1's owner: sees own event/count row.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.events)::int, 1, 'Shop 1 owner sees own event');
SELECT is((SELECT count(*) FROM public.daily_event_counts)::int, 1, 'Shop 1 owner sees own count row');
RESET ROLE;

-- As Shop 2's owner: sees nothing (cross-tenant isolation).
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.events)::int, 0, 'Shop 2 owner sees no cross-tenant event');
SELECT is((SELECT count(*) FROM public.daily_event_counts)::int, 0, 'Shop 2 owner sees no cross-tenant count row');

-- Shop 2 owner cannot insert an event tagged as Shop 1.
SELECT throws_ok(
  $$INSERT INTO public.events (type, entity_id, payload, staff_id, shop_id, occurred_at)
    VALUES ('sale.completed', 'x', '{}'::jsonb, 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', now())$$,
  '42501',
  'Shop 2 owner cannot insert event as Shop 1'
);
RESET ROLE;

-- events is append-only: no UPDATE policy exists, so even the owning shop's
-- authenticated role cannot update a row it can see.
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.events SET entity_id = 'changed' WHERE type = 'sale.completed'$$,
  '42501',
  'events is append-only -- owning shop cannot UPDATE'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the pgTAP suite**

Run: `npx supabase test db`
Expected: PASS (6/6) for `wafi140_events_rls.test.sql`, and no regressions in existing suites
(`wafi122_role_enforcement.test.sql`, etc.) — the migration only adds new objects.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/074_events_bus_core.sql supabase/tests/wafi140_events_rls.test.sql
git commit -m "feat(WAFI-140): add events + daily_event_counts tables with RLS"
```

---

### Task 2: PowerSync client schema for `events` / `daily_event_counts`

**Files:**
- Modify: `src/data/powersync/schema.ts:332` (insert before `audit_log`), and `AppSchema` export
  (currently `src/data/powersync/schema.ts:427-460`)

**Interfaces:**
- Consumes: `column`, `Table`, `Schema` from `@powersync/web` (already imported at the top of
  `schema.ts` — no new import needed).
- Produces: `events` and `daily_event_counts` PowerSync `Table` instances, registered in
  `AppSchema`. Task 4 (`publishEvent`) and Task 5 (reference read-model) depend on these existing.

- [ ] **Step 1: Add the two `Table` definitions**

Insert directly above the existing `const audit_log = new Table({` block (`schema.ts:333`):

```ts
const events = new Table({
  type:            column.text,
  entity_id:       column.text,
  payload:         column.text,   // JSON.stringify'd — same convention as audit_log's `meta`
  payload_version: column.integer,
  staff_id:        column.text,
  shop_id:         column.text,
  occurred_at:     column.text,
  created_at:      column.text,
})

const daily_event_counts = new Table({
  shop_id:    column.text,
  event_type: column.text,
  day:        column.text,
  count:      column.integer,
})
```

- [ ] **Step 2: Register both tables in `AppSchema`**

In the `export const AppSchema = new Schema({ ... })` block, add both names (anywhere in the
object — order doesn't matter):

```ts
export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
  customers,
  customer_payments,
  receipt_settings,
  sale_payments,
  staff,
  cashier_shifts,
  cash_movements,
  devices,
  returns,
  return_line_items,
  return_reasons,
  sync_dead_letter,
  audit_log,
  suppliers,
  stock_receivings,
  stock_receiving_line_items,
  stock_take_sessions,
  stock_take_lines,
  installment_plans,
  installment_dues,
  staff_settlements,
  staff_ledger,
  categories,
  subcategories,
  shops,
  denomination_configs,
  events,
  daily_event_counts,
})
```

- [ ] **Step 3: Run the existing schema/type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors (this is a pure additive change to the schema).

- [ ] **Step 4: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(WAFI-140): add events/daily_event_counts to PowerSync client schema"
```

---

### Task 3: Typed payload interfaces + `payload_version` on `DomainEvent`

**Files:**
- Modify: `src/services/events/domainEvent.types.ts` (full rewrite of the file body)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SaleCompletedPayload`, `ExpenseRecordedPayload`, `StockReceivedPayload`,
  `InventoryAdjustedPayload`, `InstallmentDuePaidPayload`, `StaffLedgerEntryAddedPayload`,
  `SettlementPaidPayload`, `ShiftOpenedPayload`, `ShiftClosedPayload` — each service's `toEvent`
  hook (Task 4) is retyped against these. `DomainEvent<TPayload>.payloadVersion: number` is a new
  required field every `toEvent` hook (Task 4) must set to `1`.

- [ ] **Step 1: Write the failing type-check test**

No new runtime test file — this task is proven by `vue-tsc` failing against the *old*
`domainEvent.types.ts` once Task 4's service changes reference the new payload interfaces. Instead,
write this task's own file first, then verify the existing service files (not yet updated) still
compile against the old shape:

Run: `npx vue-tsc -b --noEmit`
Expected (before Step 2): current baseline passes (no interfaces exist yet to conflict).

- [ ] **Step 2: Replace `domainEvent.types.ts` body**

```ts
// Split by domain (rather than one flat DomainEventType) so the registry stays
// readable as it grows past this ticket's ~9 members — WAFI-140/143 are
// expected to add many more events, and a single enum with 70+ members mixing
// every domain is harder to navigate than five short, domain-scoped ones.
//
// const-object + literal-union instead of `enum`: this repo's build (`vue-tsc -b`)
// has `erasableSyntaxOnly` enabled, which rejects real TS `enum` declarations
// (they compile to runtime code, not just erasable type info). This pattern reads
// and is accessed identically at every call site (`ExpenseEventType.Recorded`),
// so nothing downstream needed to change.

export const ExpenseEventType = {
  Recorded: 'expense.recorded',
} as const
export type ExpenseEventType = typeof ExpenseEventType[keyof typeof ExpenseEventType]

export const InventoryEventType = {
  StockReceived: 'stock.received',
  Adjusted: 'inventory.adjusted',
} as const
export type InventoryEventType = typeof InventoryEventType[keyof typeof InventoryEventType]

export const CustomerEventType = {
  DebtChanged: 'customer.debt_changed',
  InstallmentDuePaid: 'installment.due_paid',
} as const
export type CustomerEventType = typeof CustomerEventType[keyof typeof CustomerEventType]

export const SalesEventType = {
  Completed: 'sale.completed',
} as const
export type SalesEventType = typeof SalesEventType[keyof typeof SalesEventType]

export const StaffEventType = {
  ShiftOpened: 'shift.opened',
  ShiftClosed: 'shift.closed',
  SettlementPaid: 'settlement.paid',
  LedgerEntryAdded: 'staff.ledger_entry_added',
} as const
export type StaffEventType = typeof StaffEventType[keyof typeof StaffEventType]

export type DomainEventType =
  | ExpenseEventType | InventoryEventType | CustomerEventType | SalesEventType | StaffEventType

export interface DomainEvent<TPayload = unknown> {
  type: DomainEventType
  /** ID of the primary entity this event is about (expenseId, receivingId, saleId, ...) — the
   *  one field every subscriber can rely on regardless of domain, so logging/indexing/routing
   *  doesn't require knowing each event's payload shape. */
  entityId: string
  payload: TPayload
  /** Starts at 1 for every event this sprint (WAFI-140 Sprint 1). Never change an existing
   *  version's payload shape — a breaking payload change ships as version 2, with both
   *  versions supported by subscribers until deprecated (design spec §4). */
  payloadVersion: number
  staffId: string
  shopId: string
  occurredAt: string
}

// Per-event payload interfaces (WAFI-140 Sprint 1, design spec §4: "typed payloads, not
// anonymous objects"). Each mirrors the object literal already produced by its service's
// `toEvent` hook prior to this ticket -- no payload SHAPE changes, only naming them.

export interface ExpenseRecordedPayload {
  expenseId: string
  category: string
  amountUsd: number
  staffId: string
  photoUrl: string | undefined
}

export interface StockReceivedPayload {
  receivingId: string
  supplierId: string
  skuCount: number
  totalCost: number
}

export interface InventoryAdjustedPayload {
  productId: string
  deltaQty: number
  reason: import('@/features/products/product.types').AdjustmentReason
}

export interface InstallmentDuePaidPayload {
  customerId: string
  amount: number
  remainingBalance: number
}

export interface SaleCompletedPayload {
  saleId: string
  shopId: string
  staffId: string
  totalUsd: number
  totalSyp: number
  paymentSummary: {
    cashUsd: number
    cashSyp: number
    cardTotal: number
    creditTotal: number
    methodCount: number
  }
  itemCount: number
  discountApplied: boolean
}

export interface StaffLedgerEntryAddedPayload {
  staffId: string
  entryType: import('@/features/staff-ledger/staff-ledger.types').StaffLedgerEntryType
  amount: number
}

export interface SettlementPaidPayload {
  staffId: string
  amount: number
  ledgerBalanceAfter: number
}

export interface ShiftOpenedPayload {
  shiftId: string
  staffId: string
  openingCash: number
}

export interface ShiftClosedPayload {
  shiftId: string
  staffId: string
  expectedCash: number
  countedCash: number
  variance: number
}
```

- [ ] **Step 3: Run type-check (expect new errors — this is expected)**

Run: `npx vue-tsc -b --noEmit`
Expected: FAIL — every `toEvent` hook in `expense.service.ts`, `inventory.service.ts`,
`sales.service.ts`, `staff.service.ts`, `customer.service.ts` now errors with "Property
'payloadVersion' is missing". This confirms the new required field is enforced; Task 4 fixes it.

- [ ] **Step 4: Commit**

```bash
git add src/services/events/domainEvent.types.ts
git commit -m "feat(WAFI-140): add typed per-event payloads and payloadVersion to DomainEvent"
```

---

### Task 4: Real `publishEvent()` + update all 9 `toEvent` hooks

**Files:**
- Modify: `src/services/events/publishEvent.ts`
- Modify: `src/services/expense.service.ts:102-109`
- Modify: `src/services/inventory.service.ts:133-140`, `src/services/inventory.service.ts:201-208`
- Modify: `src/services/sales.service.ts:282-301`
- Modify: `src/services/staff.service.ts:63-70`, `:98-105`, `:165-172`, `:227-239`
- Modify: `src/services/customer.service.ts:99-106`
- Test: `src/services/events/__tests__/publishEvent.test.ts` (new)
- Test: existing `src/services/__tests__/*.service.test.ts` files gain assertions (see Step 4)

**Interfaces:**
- Consumes: `DomainEvent<TPayload>` and all 9 payload interfaces from Task 3;
  `db` from `@/data/powersync/db` (already imported in every touched service file).
- Produces: `publishEvent<T>(event: DomainEvent<T>): Promise<void>` — real implementation;
  `eventPublishFailureCount` — an exported, mutable counter for dev-visibility (Task 5's tests may
  reference it, no other consumer this sprint).

- [ ] **Step 1: Write the failing test for `publishEvent()`**

```ts
// src/services/events/__tests__/publishEvent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { publishEvent, eventPublishFailureCount } from '@/services/events/publishEvent'
import { ExpenseEventType } from '@/services/events/domainEvent.types'
import type { DomainEvent, ExpenseRecordedPayload } from '@/services/events/domainEvent.types'

describe('publishEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseEvent: DomainEvent<ExpenseRecordedPayload> = {
    type: ExpenseEventType.Recorded,
    entityId: 'expense-1',
    payload: { expenseId: 'expense-1', category: 'صيانة', amountUsd: 50, staffId: 'staff-1', photoUrl: undefined },
    payloadVersion: 1,
    staffId: 'staff-1',
    shopId: 'shop-1',
    occurredAt: '2026-07-31T00:00:00.000Z',
  }

  it('inserts one row into events with the correct shape', async () => {
    await publishEvent(baseEvent)

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('insert into events')
    expect(params).toContain('expense.recorded')
    expect(params).toContain('expense-1')
    expect(params).toContain(JSON.stringify(baseEvent.payload))
    expect(params).toContain(1) // payload_version
    expect(params).toContain('staff-1')
    expect(params).toContain('shop-1')
    expect(params).toContain('2026-07-31T00:00:00.000Z')
  })

  it('includes a created_at distinct from occurred_at (local persist time)', async () => {
    await publishEvent(baseEvent)
    const [, params] = vi.mocked(db.execute).mock.calls[0]
    // created_at is the last param, occurred_at the one before it -- both present, both strings.
    expect(typeof params[params.length - 1]).toBe('string')
    expect(typeof params[params.length - 2]).toBe('string')
  })

  it('increments eventPublishFailureCount and does not throw when db.execute rejects', async () => {
    const before = eventPublishFailureCount.value
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('offline'))
    await expect(publishEvent(baseEvent)).resolves.toBeUndefined()
    expect(eventPublishFailureCount.value).toBe(before + 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/publishEvent.test.ts`
Expected: FAIL — `publishEvent` is still the no-op stub, `eventPublishFailureCount` doesn't exist.

- [ ] **Step 3: Implement `publishEvent()`**

```ts
// src/services/events/publishEvent.ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import type { DomainEvent } from './domainEvent.types'

/** Dev-visibility only (WAFI-140 Sprint 1) -- not owner-facing alerting, not
 *  retried. Full retry/replay is Sprint 2 (design spec §6). */
export const eventPublishFailureCount = ref(0)

// Called only from executeBusinessOperation, fire-and-forget -- never import
// this directly from a service (executeBusinessOperation already wraps every
// call in `.catch(() => {})`; this function must never throw past that).
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  try {
    await db.execute(
      `insert into events (type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.type,
        event.entityId,
        JSON.stringify(event.payload),
        event.payloadVersion,
        event.staffId,
        event.shopId,
        event.occurredAt,
        new Date().toISOString(),
      ],
    )
  } catch (err) {
    eventPublishFailureCount.value += 1
    console.error('[publishEvent] failed to persist event', event.type, err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/publishEvent.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Update `expense.service.ts`'s `toEvent` hook**

```ts
// src/services/expense.service.ts -- replace the existing toEvent block (around line 102-109)
    toEvent: (expense) => ({
      type: ExpenseEventType.Recorded,
      entityId: expense.id,
      payload: {
        expenseId: expense.id, category: expense.category, amountUsd: expense.amountUsd,
        staffId, photoUrl: expense.photoUrl,
      } satisfies ExpenseRecordedPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
```

Add `ExpenseRecordedPayload` to the existing type-only import at the top of the file:
`import type { ExpenseRecordedPayload } from '@/services/events/domainEvent.types'`.

- [ ] **Step 6: Update `inventory.service.ts`'s two `toEvent` hooks**

```ts
// receiveStock's toEvent (around line 133-140)
    toEvent: (receiving) => ({
      type: InventoryEventType.StockReceived,
      entityId: receiving.id,
      payload: {
        receivingId: receiving.id, supplierId: input.supplierId,
        skuCount: input.lines.length, totalCost: receiving.totalCostUsd,
      } satisfies StockReceivedPayload,
      payloadVersion: 1,
      staffId: staffId ?? '',
      shopId,
      occurredAt: now,
    }),
```

```ts
// adjustInventory's toEvent (around line 201-208)
    toEvent: (adjustment) => ({
      type: InventoryEventType.Adjusted,
      entityId: input.productId,
      payload: {
        productId: input.productId, deltaQty: adjustment.newValue - adjustment.oldValue,
        reason: input.reason,
      } satisfies InventoryAdjustedPayload,
      payloadVersion: 1,
      staffId: '',
      shopId,
      occurredAt: now,
    }),
```

Add to the file's type-only import:
`import type { StockReceivedPayload, InventoryAdjustedPayload } from '@/services/events/domainEvent.types'`.

- [ ] **Step 7: Update `sales.service.ts`'s `toEvent` hook**

```ts
// sales.service.ts:282-301 -- replace the existing toEvent block
    toEvent: (completed) => ({
      type: SalesEventType.Completed,
      entityId: completed.saleId,
      payload: {
        saleId: completed.saleId, shopId: input.shopId, staffId: input.staffId ?? '',
        totalUsd: completed.totalUsd, totalSyp: completed.totalSyp,
        paymentSummary: {
          cashUsd: entries.filter(e => e.method === 'cash_usd').reduce((s, e) => s + e.amountUsd, 0),
          cashSyp: entries.filter(e => e.method === 'cash_syp').reduce((s, e) => s + e.amountUsd, 0),
          cardTotal: entries.filter(e => e.method === 'card').reduce((s, e) => s + e.amountUsd, 0),
          creditTotal: isCredit ? completed.totalUsd : 0,
          methodCount: entries.length || 1,
        },
        itemCount: completed.lines.length,
        discountApplied: completed.lines.some(l => l.discountType) || !!completed.saleDiscount,
      } satisfies SaleCompletedPayload,
      payloadVersion: 1,
      staffId: input.staffId ?? '',
      shopId: input.shopId,
      occurredAt: now,
    }),
```

Add `import type { SaleCompletedPayload } from '@/services/events/domainEvent.types'` to the
file's existing type-only import block (`sales.service.ts:5-7`).

- [ ] **Step 8: Update `staff.service.ts`'s four `toEvent` hooks**

```ts
// addLedgerEntry's toEvent (around line 63-70)
    toEvent: (created) => ({
      type: StaffEventType.LedgerEntryAdded,
      entityId: created.id,
      payload: {
        staffId: created.staffId, entryType: created.entryType, amount: created.amountUsd,
      } satisfies StaffLedgerEntryAddedPayload,
      payloadVersion: 1,
      staffId: created.staffId,
      shopId,
      occurredAt: now,
    }),
```

Verified against the current file (`staff.service.ts:96-107`): `paySettlement` takes
`(settlementId, staffId, paidByStaffId, paymentMethod, audit)` — no `shopId` parameter — and its
existing `toEvent` already hard-codes `shopId: ''` (a pre-existing gap, not introduced by this
task). Carry that over unchanged; only add `payloadVersion: 1` and the payload type annotation:

```ts
// paySettlement's toEvent (staff.service.ts:98-105)
    toEvent: () => ({
      type: StaffEventType.SettlementPaid,
      entityId: settlementId,
      payload: {
        staffId, amount: 0, ledgerBalanceAfter: 0,
      } satisfies SettlementPaidPayload,
      payloadVersion: 1,
      staffId,
      shopId: '', // pre-existing gap: paySettlement has no shopId parameter today.
                  // Unchanged by this task — out of WAFI-140 Sprint 1's scope to fix.
      occurredAt: now,
    }),
```

```ts
// openShift's toEvent (around line 165-172)
    toEvent: (shift) => ({
      type: StaffEventType.ShiftOpened,
      entityId: shift.id,
      payload: {
        shiftId: shift.id, staffId, openingCash: input.openingCashUsd,
      } satisfies ShiftOpenedPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
```

```ts
// closeShift's toEvent (around line 227-239)
    toEvent: () => ({
      type: StaffEventType.ShiftClosed,
      entityId: shiftId,
      payload: {
        shiftId, staffId,
        expectedCash: input.closingCashUsd - (input.varianceUsd ?? 0),
        countedCash: input.closingCashUsd,
        variance: input.varianceUsd ?? 0,
      } satisfies ShiftClosedPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
```

Add to the file's type-only import:
`import type { StaffLedgerEntryAddedPayload, SettlementPaidPayload, ShiftOpenedPayload, ShiftClosedPayload } from '@/services/events/domainEvent.types'`.

- [ ] **Step 9: Update `customer.service.ts`'s `toEvent` hook**

```ts
// recordPayment's toEvent (around line 99-106)
    toEvent: () => ({
      type: CustomerEventType.InstallmentDuePaid,
      entityId: customerId,
      payload: {
        customerId, amount: batchTotalUsd, remainingBalance: 0,
      } satisfies InstallmentDuePaidPayload,
      payloadVersion: 1,
      staffId: '',
      shopId,
      occurredAt: now,
    }),
```

Add to the file's type-only import:
`import type { InstallmentDuePaidPayload } from '@/services/events/domainEvent.types'`.

- [ ] **Step 10: Run full type-check and existing service test suites**

Run: `npx vue-tsc -b --noEmit`
Expected: PASS, no errors.

Run: `npx vitest run src/services/__tests__/`
Expected: PASS — existing tests assert on `db.execute` call params for the *business* write, not
the event publish path, so they should be unaffected. If any test asserts on the exact shape of an
event object passed to a mocked `publishEvent`, update it to include `payloadVersion: 1`.

- [ ] **Step 11: Confirm no pre-existing event-shape assertions need updating**

Verified: `grep -rn "publishEvent" src/services/__tests__/` returns no hits — none of the five
existing service test files currently mock or assert on `publishEvent` or the constructed event
object (they assert on the business write's `db.execute` call only). So this step needs no edits
of its own; Step 12 below is where new payload-shape assertions get added to those same files
(a separate, additive change, not a fix to something pre-existing).

- [ ] **Step 12: Add a runtime payload-shape assertion per event (design spec §8)**

`satisfies` (Steps 5-9) proves shape at compile time; this step proves it at runtime too, by
spying on `publishEvent` from each service's existing test file and asserting the exact key set of
the constructed payload — catching a case where TypeScript's structural typing would silently
allow extra/missing keys that `satisfies` doesn't flag (e.g. an object with all required keys plus
an accidental extra one still satisfies the interface).

Add to `src/services/__tests__/expense.service.test.ts` (mock hoisted alongside the existing
`db` mock at the top of the file):

```ts
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))
```

then one new test in the existing `describe` block:

```ts
it('publishes expense.recorded with exactly the ExpenseRecordedPayload keys', async () => {
  const { publishEvent } = await import('@/services/events/publishEvent')
  await recordExpense('shop1', 'staff1', baseInput, context, fakeAudit)
  const event = vi.mocked(publishEvent).mock.calls[0][0]
  expect(event.type).toBe('expense.recorded')
  expect(Object.keys(event.payload).sort()).toEqual(
    ['expenseId', 'category', 'amountUsd', 'staffId', 'photoUrl'].sort(),
  )
  expect(event.payloadVersion).toBe(1)
})
```

Repeat the same pattern (mock `publishEvent`, one new test asserting `Object.keys(event.payload)`)
in `inventory.service.test.ts` (both `receiveStock` → `['receivingId','supplierId','skuCount','totalCost']`
and `adjustInventory` → `['productId','deltaQty','reason']`), `sales.service.test.ts` (→
`['saleId','shopId','staffId','totalUsd','totalSyp','paymentSummary','itemCount','discountApplied']`),
`staff.service.test.ts` (`addLedgerEntry` → `['staffId','entryType','amount']`, `paySettlement` →
`['staffId','amount','ledgerBalanceAfter']`, `openShift` → `['shiftId','staffId','openingCash']`,
`closeShift` → `['shiftId','staffId','expectedCash','countedCash','variance']`), and
`customer.service.test.ts` (`recordPayment` → `['customerId','amount','remainingBalance']`).

Run: `npx vitest run src/services/__tests__/`
Expected: PASS — all new payload-shape assertions pass alongside the existing tests in each file.

- [ ] **Step 13: Commit**

```bash
git add src/services/events/publishEvent.ts src/services/events/__tests__/publishEvent.test.ts \
        src/services/expense.service.ts src/services/inventory.service.ts \
        src/services/sales.service.ts src/services/staff.service.ts src/services/customer.service.ts \
        src/services/__tests__/expense.service.test.ts src/services/__tests__/inventory.service.test.ts \
        src/services/__tests__/sales.service.test.ts src/services/__tests__/staff.service.test.ts \
        src/services/__tests__/customer.service.test.ts
git commit -m "feat(WAFI-140): make publishEvent persist real events with typed payloads"
```

---

### Task 5: `useEventSubscription` composable

**Files:**
- Create: `src/services/events/useEventSubscription.ts`
- Test: `src/services/events/__tests__/useEventSubscription.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`, `DomainEventType` from `./domainEvent.types`.
- Produces: `useEventSubscription<T>(type: DomainEventType, handler: (row: EventRow<T>) => void |
  Promise<void>, options?: { sinceIso?: string }): { stop: () => void }` — Task 6 depends on this
  exact signature.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/events/__tests__/useEventSubscription.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useEventSubscription } from '@/services/events/useEventSubscription'
import { SalesEventType } from '@/services/events/domainEvent.types'

function fakeAsyncIterable(results: any[]) {
  let i = 0
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => i < results.length
        ? { value: results[i++], done: false }
        : { value: undefined, done: true },
      return: async () => ({ value: undefined, done: true }),
    }),
  }
}

describe('useEventSubscription', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries events filtered by shop_id + type (indexed predicate) and invokes handler per row', async () => {
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{ id: 'e1', type: 'sale.completed', payload: '{"saleId":"s1"}', shop_id: 'shop-1' }] } },
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(SalesEventType.Completed, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0)) // let the async loop's first iteration run

    expect(db.watch).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.watch).mock.calls[0]
    expect(sql).toContain('shop_id')
    expect(sql).toContain('type')
    expect(params).toContain('shop-1')
    expect(params).toContain('sale.completed')
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))

    stop()
  })

  it('ignores rows of a different type (query-level filter, not a client-side guard)', async () => {
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [] } }, // the SQL WHERE already excludes non-matching types
    ]) as any)

    const handler = vi.fn()
    const { stop } = useEventSubscription(SalesEventType.Completed, handler, { shopId: 'shop-1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(handler).not.toHaveBeenCalled()
    stop()
  })

  it('stop() aborts the underlying watch (passes an AbortSignal that becomes aborted)', () => {
    let capturedSignal: AbortSignal | undefined
    vi.mocked(db.watch).mockImplementation((_sql, _params, opts) => {
      capturedSignal = (opts as any)?.signal
      return fakeAsyncIterable([]) as any
    })

    const { stop } = useEventSubscription(SalesEventType.Completed, vi.fn(), { shopId: 'shop-1' })
    expect(capturedSignal?.aborted).toBe(false)
    stop()
    expect(capturedSignal?.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/useEventSubscription.test.ts`
Expected: FAIL — `useEventSubscription` module doesn't exist yet.

- [ ] **Step 3: Implement `useEventSubscription`**

```ts
// src/services/events/useEventSubscription.ts
import { getCurrentInstance, onUnmounted } from 'vue'
import { db } from '@/data/powersync/db'
import type { DomainEventType } from './domainEvent.types'

export interface EventRow<T = unknown> {
  id: string
  type: DomainEventType
  entity_id: string
  payload: T
  staff_id: string
  shop_id: string
  occurred_at: string
  created_at: string
}

export interface UseEventSubscriptionOptions {
  shopId: string
  /** Optional occurred_at lower bound -- keeps the watch query cheap as `events`
   *  grows (design spec §7: "should add an occurred_at bound whenever the full
   *  history isn't needed"). Omit to watch the full shop-scoped history. */
  sinceIso?: string
}

/**
 * Watches `events` for rows of one `type`, scoped to `shopId` -- both columns
 * covered by `events_shop_type_idx`, per the indexed-predicate rule in the
 * design spec (§7). At-least-once, no ordering guarantee (design spec §3):
 * `handler` may be invoked more than once for the same row, and concurrently
 * emitted events are not guaranteed to arrive in occurred_at order.
 *
 * Disposal: call the returned `stop()` explicitly, or rely on the automatic
 * `onUnmounted` registration when called during a component's setup() (this
 * composable owns that registration; callers outside a component -- e.g. a
 * store-level subscriber started once at app init -- MUST call `stop()`
 * themselves when they no longer need it).
 */
export function useEventSubscription<T = unknown>(
  type: DomainEventType,
  handler: (row: EventRow<T>) => void | Promise<void>,
  options: UseEventSubscriptionOptions,
): { stop: () => void } {
  const controller = new AbortController()

  const conditions = ['shop_id = ?', 'type = ?']
  const params: unknown[] = [options.shopId, type]
  if (options.sinceIso) {
    conditions.push('occurred_at >= ?')
    params.push(options.sinceIso)
  }

  const sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC`

  ;(async () => {
    const iterable = db.watch(sql, params, { signal: controller.signal })
    for await (const result of iterable) {
      const rows = (result as any).rows?._array ?? []
      for (const row of rows) {
        const parsed: EventRow<T> = { ...row, payload: JSON.parse(row.payload) }
        await handler(parsed)
      }
    }
  })().catch((err) => {
    if (!controller.signal.aborted) console.error('[useEventSubscription] watch loop failed', type, err)
  })

  const stop = () => controller.abort()

  if (getCurrentInstance()) {
    onUnmounted(stop)
  }

  return { stop }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/useEventSubscription.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add src/services/events/useEventSubscription.ts src/services/events/__tests__/useEventSubscription.test.ts
git commit -m "feat(WAFI-140): add useEventSubscription composable"
```

---

### Task 6: Reference read-model (`daily_event_counts` projection)

**Files:**
- Create: `src/services/events/dailyEventCountsProjection.ts`
- Test: `src/services/events/__tests__/dailyEventCountsProjection.test.ts`

**Interfaces:**
- Consumes: `useEventSubscription` (Task 5), `db` from `@/data/powersync/db`,
  `SalesEventType`/`EventRow`/`SaleCompletedPayload` (Tasks 3/5).
- Produces: `startDailyEventCountsProjection(shopId: string): { stop: () => void }` — a store or
  app-init call site (not part of this sprint's scope to wire into the app shell; the function
  existing and being independently testable is the deliverable) invokes this once per shop session.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/events/__tests__/dailyEventCountsProjection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { startDailyEventCountsProjection } from '@/services/events/dailyEventCountsProjection'

function fakeAsyncIterable(results: any[]) {
  let i = 0
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => i < results.length
        ? { value: results[i++], done: false }
        : { value: undefined, done: true },
      return: async () => ({ value: undefined, done: true }),
    }),
  }
}

describe('startDailyEventCountsProjection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts an increment into daily_event_counts for each sale.completed row', async () => {
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [{
        id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
        payload: JSON.stringify({ saleId: 'sale-1' }),
        staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
      }] } },
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql.toLowerCase()).toContain('insert into daily_event_counts')
    expect(sql.toLowerCase()).toContain('on conflict')
    expect(params).toContain('shop-1')
    expect(params).toContain('sale.completed')
    expect(params).toContain('2026-07-31') // day, derived from occurred_at

    stop()
  })

  it('double-counts on duplicate handler execution -- documented at-least-once limitation, not a bug', async () => {
    const sameRow = {
      id: 'e1', type: 'sale.completed', entity_id: 'sale-1',
      payload: JSON.stringify({ saleId: 'sale-1' }),
      staff_id: 's1', shop_id: 'shop-1', occurred_at: '2026-07-31T10:00:00.000Z', created_at: '2026-07-31T10:00:00.000Z',
    }
    vi.mocked(db.watch).mockReturnValue(fakeAsyncIterable([
      { rows: { _array: [sameRow] } },
      { rows: { _array: [sameRow] } }, // same row delivered twice (crash-and-replay simulation)
    ]) as any)

    const { stop } = startDailyEventCountsProjection('shop-1')
    await new Promise((r) => setTimeout(r, 0))

    // No dedup: two deliveries of the same row produce two increment calls.
    // This is the known Sprint-1 limitation (design spec §3/§7), asserted here
    // so a future idempotency fix (Sprint 2) has a test that must be updated,
    // not silently broken.
    expect(db.execute).toHaveBeenCalledTimes(2)
    stop()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/dailyEventCountsProjection.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the projection**

```ts
// src/services/events/dailyEventCountsProjection.ts
import { db } from '@/data/powersync/db'
import { useEventSubscription, type EventRow } from '@/services/events/useEventSubscription'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'

/**
 * Reference read-model (design spec §7): events -> subscriber -> materialized
 * projection. Future dashboard/report consumers (WAFI-143/144/145/146) should
 * follow this same shape, not treat it as disposable.
 *
 * At-least-once delivery (design spec §3) means this can double-count on
 * duplicate handler execution -- accepted as a known Sprint 1 limitation.
 * Idempotent dedup (tracking which events.id rows are already folded in) is
 * Sprint 2 scope.
 */
export function startDailyEventCountsProjection(shopId: string): { stop: () => void } {
  return useEventSubscription<SaleCompletedPayload>(
    SalesEventType.Completed,
    async (row: EventRow<SaleCompletedPayload>) => {
      const day = row.occurred_at.slice(0, 10)
      await db.execute(
        `INSERT INTO daily_event_counts (shop_id, event_type, day, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (shop_id, event_type, day) DO UPDATE SET count = daily_event_counts.count + 1`,
        [shopId, SalesEventType.Completed, day],
      )
    },
    { shopId },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/dailyEventCountsProjection.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add src/services/events/dailyEventCountsProjection.ts src/services/events/__tests__/dailyEventCountsProjection.test.ts
git commit -m "feat(WAFI-140): add daily_event_counts reference read-model"
```

---

### Task 7: Update DOMAIN INTERACTION MATRIX + close out design spec checklist

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md` (DOMAIN INTERACTION MATRIX table, currently ending at
  the `Audit` row)
- Modify: `WAFI_Production_Readiness_Plan_v3.md` (status row for WAFI-140, currently line 42 area)

**Interfaces:** none — documentation-only task.

- [ ] **Step 1: Add the Events row to the DOMAIN INTERACTION MATRIX**

In `AI_PRINCIPAL_ENGINEER_REVIEW.md`, after the `Audit` row, add:

```
| Events | `events`, `daily_event_counts` | Sales, Inventory, Customer Credit, Staff, Expense (all event producers) | `useEventSubscription` | none yet (Sprint 1 has no user-facing consumer) |
```

- [ ] **Step 2: Update WAFI-140's status entry**

In `WAFI_Production_Readiness_Plan_v3.md`, replace the row (currently around line 42):

```
| Macro-Phase 2 (WAFI-152, WAFI-140, WAFI-150/143/144/145/146/142) | 🟡 In progress — WAFI-152 shipped 2026-07-31 | WAFI-152 (Business Services Layer) done — see its row below. WAFI-140/150/143/144/145/146/142 not started. |
```

with:

```
| Macro-Phase 2 (WAFI-152, WAFI-140, WAFI-150/143/144/145/146/142) | 🟡 In progress — WAFI-152 shipped 2026-07-31, WAFI-140 Sprint 1 shipped [DATE] | WAFI-152 (Business Services Layer) done. WAFI-140 Sprint 1 (event bus core: events/daily_event_counts tables, real publishEvent, useEventSubscription, reference read-model) done — Sprints 2 (idempotency, offline replay) and 3 (security hardening, rate limiting) not started. WAFI-150/143/144/145/146/142 not started. |
```

Fill `[DATE]` with the actual merge date at implementation time (do not leave the literal
placeholder in the committed file).

- [ ] **Step 3: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md WAFI_Production_Readiness_Plan_v3.md
git commit -m "docs(WAFI-140): update domain matrix and readiness plan status for Sprint 1"
```

---

## Final Verification

- [ ] Run `npx vue-tsc -b --noEmit` — no errors.
- [ ] Run `npx vitest run` — full suite passes, no regressions.
- [ ] Run `npx supabase test db` — all pgTAP suites pass, including the new
      `wafi140_events_rls.test.sql`.
- [ ] Manually confirm (grep) no remaining call site constructs a `DomainEvent` object without
      `payloadVersion`.
