# WAFI-145: Owner Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend WAFI-143's minimal notification plumbing into the full Owner Notification Center — 11 notification types (10 event-driven or state-derived subscribers plus the already-shipped Discount Alert, generalized), a real Notification Center UI with filters/acknowledgment/deep-links, and a Settings screen with per-type enable/threshold and business-hours configuration.

**Architecture:** Event-driven notification rules are durable subscribers (`runDurableSubscriber`) keyed on `source_event_id`, one subscriber per (source event, rule) pair so independent rules on the same event (e.g. Drawer Variance and Shift Late Close, both off `shift.closed`) retry independently. State-derived rules (Low Stock, Sync Failure) have no source event to replay from; Low Stock runs synchronously inside every stock-mutating write, Sync Failure runs on app-foreground. All notification rows land in the existing `notifications` table; severity governs UI presentation (CRITICAL requires acknowledgment), not subscriber durability.

**Tech Stack:** Vue 3 `<script setup>`, PowerSync/SQLite client-side (`db.execute`/`db.getOptional`/`db.watch`), Supabase Postgres migrations, Vitest.

## Global Constraints

- Reuse `products.low_stock_threshold` (migration 007, `INTEGER NOT NULL DEFAULT 5`) — do not add a new low-stock column.
- `notification_settings.shop_id` is `UUID NOT NULL REFERENCES shops(id)` (matches the dominant convention; `notifications.shop_id` staying `TEXT` is a known pre-existing inconsistency, not fixed here).
- All event-driven notification subscribers use `runDurableSubscriber`, regardless of severity — no exceptions for INFO/WARNING types.
- 11 notification types, final: `discount.large_applied`, `drawer.variance`, `customer.debt_threshold`, `inventory.low_stock`, `shift.late_close`, `expense.after_hours`, `sale.large_return`, `staff.pin_locked_out`, `device.sync_stale`, `device.registered`, `settlement.paid`. `inventory.low_stock` has no row in `notification_settings` (10 settings-bearing types, not 11).
- Business hours: `open_time > close_time` is a valid overnight window (not rejected); only `open_time === close_time` is invalid. `is_24_7 = true` implies `open_time`/`close_time` are `NULL`.
- No generic cross-type rate limiting. No push/WhatsApp delivery. No free-text search. No "suggest disabling" smart rule.
- Every code comment in this plan's snippets should be read as required content, not decoration — the reasoning it documents (idempotency, replay-safety, boundary semantics) is load-bearing for future maintainers per the design spec.

Spec: `docs/superpowers/specs/2026-08-07-wafi-145-owner-notification-center-design.md`

---

### Task 1: Migrations — business hours, settings table, nullable `source_event_id`

**Files:**
- Create: `supabase/migrations/080_notification_center.sql`
- Test: `supabase/tests/wafi145_notification_center.test.sql` (pgTAP, following the existing convention referenced in `domainEvent.types.ts`'s `EVENT_SENSITIVITY` comment)

**Interfaces:**
- Produces: `shops.open_time`, `shops.close_time`, `shops.is_24_7` columns; `notifications.acknowledged_at` column; `notifications.source_event_id` now nullable with a partial unique index; `notification_settings` table `(shop_id UUID, type TEXT, enabled BOOLEAN, threshold_json JSONB, updated_at TIMESTAMPTZ)`, `PRIMARY KEY (shop_id, type)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/080_notification_center.sql
-- WAFI-145 -- Owner Notification Center: business hours, per-type settings, and
-- making notifications.source_event_id nullable for state-derived rows (Low Stock,
-- Sync Failure) that have no originating domain event to key on. This is the same
-- nullable/partial-index pattern audit_log already uses (079_notifications.sql's
-- header comment calls this out as the alternative "if a future ticket introduces
-- manual/system notifications with no originating event" -- this is that ticket).

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS open_time TIME;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS close_time TIME;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS is_24_7 BOOLEAN NOT NULL DEFAULT false;

-- open_time = close_time is rejected as ambiguous (use is_24_7 for "always open"
-- instead). open_time > close_time is a VALID overnight window (e.g. 08:00-02:00)
-- -- not rejected. NULL/NULL (including the is_24_7=true case, which the app
-- enforces by setting both to NULL) means "no operating-hours checks for this shop".
ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_hours_not_equal;
ALTER TABLE public.shops ADD CONSTRAINT shops_hours_not_equal
  CHECK (open_time IS NULL OR close_time IS NULL OR open_time <> close_time);

-- Distinct from read_at: a CRITICAL notification requires explicit acknowledgment,
-- not just having been viewed.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- State-derived rules (Low Stock, Sync Failure) have no source event, so
-- source_event_id must become nullable. The old NOT NULL unique index is replaced
-- with a partial index that only enforces uniqueness (exact-replay dedup) for
-- event-driven rows; state-derived rows insert with source_event_id = NULL and rely
-- on their own crossing/dedup logic instead (see the notification rule code).
ALTER TABLE public.notifications ALTER COLUMN source_event_id DROP NOT NULL;
DROP INDEX IF EXISTS public.notifications_source_event_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_event_id_unique
  ON public.notifications (source_event_id) WHERE source_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_settings (
  shop_id        UUID NOT NULL REFERENCES public.shops(id),
  type           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  threshold_json JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, type)
);
-- Sparse by design: a missing row resolves to the type's hardcoded default
-- (enabled=true, default threshold). A row is written only when the owner
-- overrides something -- not pre-seeded for all 10 settings-bearing types x shop.
-- inventory.low_stock deliberately never gets a row here (its threshold is
-- products.low_stock_threshold, per product).

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_settings_select_scoped ON public.notification_settings;
CREATE POLICY notification_settings_select_scoped ON public.notification_settings
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id())::uuid);

DROP POLICY IF EXISTS notification_settings_upsert_scoped ON public.notification_settings;
CREATE POLICY notification_settings_upsert_scoped ON public.notification_settings
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id())::uuid);

DROP POLICY IF EXISTS notification_settings_update_scoped ON public.notification_settings;
CREATE POLICY notification_settings_update_scoped ON public.notification_settings
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id())::uuid)
  WITH CHECK (shop_id = (SELECT public.auth_shop_id())::uuid);

GRANT ALL ON TABLE public.notification_settings TO anon, authenticated, service_role;
```

- [ ] **Step 2: Write the pgTAP test**

```sql
-- supabase/tests/wafi145_notification_center.test.sql
BEGIN;
SELECT plan(6);

-- Overnight hours accepted
SELECT lives_ok(
  $$ UPDATE public.shops SET open_time = '08:00', close_time = '02:00' WHERE id = (SELECT id FROM public.shops LIMIT 1) $$,
  'open_time > close_time (overnight) is accepted'
);

-- Equal hours rejected
SELECT throws_ok(
  $$ UPDATE public.shops SET open_time = '09:00', close_time = '09:00' WHERE id = (SELECT id FROM public.shops LIMIT 1) $$,
  '23514',
  NULL,
  'open_time = close_time is rejected'
);

-- source_event_id nullable
SELECT lives_ok(
  $$ INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, severity, source_event_id)
     VALUES ((SELECT id::text FROM public.shops LIMIT 1), 'owner', 'inventory.low_stock', 't', 'm', 'WARNING', NULL) $$,
  'source_event_id NULL is accepted for state-derived rows'
);

-- Two NULL source_event_id rows don't collide (partial index, not a full unique index)
SELECT lives_ok(
  $$ INSERT INTO public.notifications (shop_id, recipient_role, type, title, message, severity, source_event_id)
     VALUES ((SELECT id::text FROM public.shops LIMIT 1), 'owner', 'inventory.low_stock', 't2', 'm2', 'WARNING', NULL) $$,
  'a second NULL source_event_id row is accepted (partial unique index)'
);

-- notification_settings RLS: shop-scoped
SELECT results_eq(
  $$ SELECT count(*)::int FROM public.notification_settings WHERE shop_id != (SELECT public.auth_shop_id())::uuid $$,
  $$ VALUES (0) $$,
  'notification_settings only exposes the caller''s own shop'
);

SELECT has_column('public', 'notifications', 'acknowledged_at', 'notifications has acknowledged_at');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Apply migrations locally and run the test**

Run: `supabase db reset` (or the project's equivalent local-apply command), then `supabase test db`
Expected: migration applies cleanly, all 6 pgTAP assertions pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/080_notification_center.sql supabase/tests/wafi145_notification_center.test.sql
git commit -m "feat(WAFI-145): add business hours, notification_settings, nullable source_event_id"
```

---

### Task 2: Client PowerSync schema mirror

**Files:**
- Modify: `src/data/powersync/schema.ts:429-442` (notifications table), `:516-525` (shops table)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `column.text` mirrors for `shops.open_time`/`close_time`, `column.integer` for `is_24_7`, `column.text` for `notifications.acknowledged_at`, and a new `notification_settings` table export added to `AppSchema`.

- [ ] **Step 1: Edit the `notifications` table**

```ts
// src/data/powersync/schema.ts
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
  acknowledged_at:     column.text,   // WAFI-145: CRITICAL rows require this, distinct from read_at
})
```

- [ ] **Step 2: Edit the `shops` table and add `notification_settings`**

```ts
// src/data/powersync/schema.ts
const shops = new Table({
  owner_user_id:               column.text,
  name:                        column.text,
  business_type:               column.text,
  country:                     column.text,
  created_at:                  column.text,
  features:                    column.text,
  cashier_discount_cap_pct:    column.real,
  manager_discount_cap_pct:    column.real,
  open_time:                   column.text,    // WAFI-145: 'HH:MM', NULL = no operating-hours checks
  close_time:                  column.text,    // WAFI-145
  is_24_7:                     column.integer, // WAFI-145: 0/1
})

const notification_settings = new Table({
  shop_id:        column.text,
  type:           column.text,
  enabled:        column.integer,  // 0/1
  threshold_json: column.text,     // JSON-encoded NotificationTypeSettings, see notificationSettings.ts
  updated_at:     column.text,
})
```

- [ ] **Step 3: Register the new table in `AppSchema`**

```ts
// src/data/powersync/schema.ts, in the AppSchema = new Schema({...}) block
export const AppSchema = new Schema({
  // ...existing entries unchanged...
  notifications,
  notification_settings,   // add alongside notifications
  // ...rest unchanged...
})
```

- [ ] **Step 4: Run the existing schema smoke test (if one exists) or typecheck**

Run: `npx vue-tsc -b --noEmit`
Expected: no new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(WAFI-145): mirror business-hours and notification_settings columns in client schema"
```

---

### Task 3: Domain event types — `staff.pin_locked_out`, widen `DebtChangedPayload.reason`

**Files:**
- Modify: `src/services/events/domainEvent.types.ts`
- Modify: `src/services/events/__tests__/__snapshots__/eventSensitivity.test.ts.snap` (snapshot will be regenerated, not hand-edited)
- Test: `src/services/events/__tests__/eventContracts.test.ts`

**Interfaces:**
- Produces: `StaffEventType.PinLockedOut = 'staff.pin_locked_out'`, `PinLockedOutPayload { staffId: string; lockoutMinutes: number }`, `DebtChangedPayload.reason: 'return' | 'credit_sale'`.

- [ ] **Step 1: Write the failing contract test**

```ts
// src/services/events/__tests__/eventContracts.test.ts — add to the existing CONTRACTS map
import type { PinLockedOutPayload } from '../domainEvent.types'
// ...
const CONTRACTS = {
  // ...existing entries...
  'staff.pin_locked_out': {
    type: 'staff.pin_locked_out', entityId: 'lockout-occurrence-1',
    payload: { staffId: 's1', lockoutMinutes: 5 } satisfies PinLockedOutPayload,
    payloadVersion: 1, staffId: 's1', shopId: 'shop1', occurredAt: '2026-01-01T00:00:00.000Z',
  },
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/events/__tests__/eventContracts.test.ts`
Expected: FAIL — `'staff.pin_locked_out'` is not assignable to `DomainEventType` / `PinLockedOutPayload` doesn't exist.

- [ ] **Step 3: Add the type, payload, and sensitivity entry**

```ts
// src/services/events/domainEvent.types.ts — extend StaffEventType
export const StaffEventType = {
  ShiftOpened: 'shift.opened',
  ShiftClosed: 'shift.closed',
  SettlementPaid: 'settlement.paid',
  LedgerEntryAdded: 'staff.ledger_entry_added',
  PinLockedOut: 'staff.pin_locked_out',
} as const
export type StaffEventType = typeof StaffEventType[keyof typeof StaffEventType]
```

```ts
// New payload interface, alongside the other WAFI-140 payloads
export interface PinLockedOutPayload {
  /** The staff member who tripped the lockout. NOT the entityId -- see the
   *  comment on entityId generation at the publish call site (usePinLockout.ts):
   *  the same staff member can independently lock out on two different devices
   *  (lockout state is per-device, WAFI-012), so two genuinely distinct lockout
   *  occurrences must not collide on entity identity. */
  staffId: string
  lockoutMinutes: number
}
```

```ts
// Widen DebtChangedPayload.reason (was: reason: 'return')
export interface DebtChangedPayload {
  customerId: string
  deltaUsd: number
  newBalanceUsd: number
  /** 'return': existing WAFI-140 producer (useReturnSheet.ts), always a decrease.
   *  'credit_sale' (WAFI-145): new producer (sales.service.ts), always an increase
   *  -- the Customer Debt notification rule checks this discriminant explicitly
   *  rather than inferring intent from deltaUsd's sign alone. */
  reason: 'return' | 'credit_sale'
}
```

```ts
// EVENT_SENSITIVITY — add the new type. Cashier lockout is a security event,
// same visibility tier as staff ledger (owner/manager only, not every cashier).
export const EVENT_SENSITIVITY: Record<DomainEventType, EventSensitivity> = {
  // ...existing entries...
  'staff.pin_locked_out':     'can_view_staff_ledger',
}
```

Also add `'staff.pin_locked_out'` to the `DomainEventType` union at the top of the file (in the `StaffEventType` member of the union — already covered automatically since `StaffEventType` itself is part of the union type).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/eventContracts.test.ts src/services/events/__tests__/eventSensitivity.test.ts`
Expected: contract test PASSES; sensitivity snapshot test FAILS (new key not in old snapshot) — this is expected, not a bug.

- [ ] **Step 5: Update the sensitivity snapshot deliberately**

Run: `npx vitest run src/services/events/__tests__/eventSensitivity.test.ts -u`
Expected: snapshot updates to include `'staff.pin_locked_out': 'can_view_staff_ledger'`. Review the diff before committing — this is the enforcement mechanism the file's own comment describes ("ANY edit below shows up as a snapshot diff a reviewer must accept").

- [ ] **Step 6: Commit**

```bash
git add src/services/events/domainEvent.types.ts src/services/events/__tests__/eventContracts.test.ts src/services/events/__tests__/__snapshots__/eventSensitivity.test.ts.snap
git commit -m "feat(WAFI-145): add staff.pin_locked_out event type, widen customer.debt_changed reason"
```

---

### Task 4: Business-hours comparison utility (overnight-aware)

**Files:**
- Create: `src/services/notifications/businessHours.ts`
- Test: `src/services/notifications/__tests__/businessHours.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isWithinBusinessHours(shop: { open_time: string | null; close_time: string | null; is_24_7: number | null }, isoTimestamp: string): boolean` — used by Shift Late Close, After-Hours Expense, and the Settings screen's after-hours-suppression check in later tasks.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/notifications/__tests__/businessHours.test.ts
import { describe, it, expect } from 'vitest'
import { isWithinBusinessHours } from '../businessHours'

describe('isWithinBusinessHours', () => {
  it('returns true always when is_24_7 is set', () => {
    const shop = { open_time: null, close_time: null, is_24_7: 1 }
    expect(isWithinBusinessHours(shop, '2026-01-01T02:00:00.000Z')).toBe(true)
  })

  it('returns true always when open/close are both NULL and not 24/7 (checks disabled)', () => {
    const shop = { open_time: null, close_time: null, is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T02:00:00.000Z')).toBe(true)
  })

  it('normal day: within hours', () => {
    const shop = { open_time: '09:00', close_time: '21:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T12:00:00.000Z')).toBe(true)
  })

  it('normal day: outside hours', () => {
    const shop = { open_time: '09:00', close_time: '21:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T23:00:00.000Z')).toBe(false)
  })

  it('overnight window: within hours after midnight', () => {
    // open 08:00, close 02:00 -- 01:00 is within the overnight window
    const shop = { open_time: '08:00', close_time: '02:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T01:00:00.000Z')).toBe(true)
  })

  it('overnight window: within hours before midnight', () => {
    const shop = { open_time: '08:00', close_time: '02:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T20:00:00.000Z')).toBe(true)
  })

  it('overnight window: outside hours (mid-morning gap)', () => {
    const shop = { open_time: '08:00', close_time: '02:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T05:00:00.000Z')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/notifications/__tests__/businessHours.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/services/notifications/businessHours.ts
//
// Overnight-aware business-hours check (WAFI-145 design spec, "Business hours &
// overnight semantics"). Timestamps are compared using UTC hours/minutes -- this
// codebase stores occurredAt as ISO UTC and shops.open_time/close_time as naive
// 'HH:MM' with no timezone; both are treated as the same wall-clock frame, matching
// how every other time-of-day comparison in this app already works.

export interface ShopHours {
  open_time: string | null   // 'HH:MM'
  close_time: string | null  // 'HH:MM'
  is_24_7: number | null     // 0/1
}

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function isWithinBusinessHours(shop: ShopHours, isoTimestamp: string): boolean {
  if (shop.is_24_7) return true
  if (!shop.open_time || !shop.close_time) return true // checks disabled for this shop

  const d = new Date(isoTimestamp)
  const t = d.getUTCHours() * 60 + d.getUTCMinutes()
  const open  = minutesSinceMidnight(shop.open_time)
  const close = minutesSinceMidnight(shop.close_time)

  if (open < close) {
    // Normal day: within hours iff open <= t < close.
    return t >= open && t < close
  }
  // Overnight window (open > close, e.g. 08:00-02:00): the window crosses
  // midnight, so "within hours" means t is in [open, 24:00) OR [00:00, close).
  return t >= open || t < close
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/notifications/__tests__/businessHours.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/services/notifications/businessHours.ts src/services/notifications/__tests__/businessHours.test.ts
git commit -m "feat(WAFI-145): add overnight-aware business-hours comparison utility"
```

---

### Task 5: Typed notification settings module

**Files:**
- Create: `src/services/notifications/notificationSettings.ts`
- Test: `src/services/notifications/__tests__/notificationSettings.test.ts`

**Interfaces:**
- Consumes: `db.getOptional` from `@/data/powersync/db`.
- Produces: `NotificationType` (11-member union), `NotificationTypeSettings` (10-member discriminated union, excludes `'inventory.low_stock'`), `DEFAULT_SETTINGS: Record<SettingsBearingType, NotificationTypeSettings>`, `getNotificationSettings(shopId: string, type: SettingsBearingType): Promise<NotificationTypeSettings & { enabled: boolean }>` — used by every rule task below to read enabled/threshold.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/notifications/__tests__/notificationSettings.test.ts
import { describe, it, expect, vi } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '../notificationSettings'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn() } }))

describe('getNotificationSettings', () => {
  it('returns the hardcoded default when no row exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    const s = await getNotificationSettings('shop1', 'drawer.variance')
    expect(s).toEqual({ type: 'drawer.variance', enabled: true, varianceUsdCap: 15 })
  })

  it('overrides the default when a row exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      enabled: 0, threshold_json: JSON.stringify({ type: 'drawer.variance', varianceUsdCap: 25 }),
    } as any)
    const s = await getNotificationSettings('shop1', 'drawer.variance')
    expect(s).toEqual({ type: 'drawer.variance', enabled: false, varianceUsdCap: 25 })
  })

  it('falls back to the default threshold if the stored row has enabled but no threshold_json', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ enabled: 1, threshold_json: null } as any)
    const s = await getNotificationSettings('shop1', 'sale.large_return')
    expect(s).toEqual({ type: 'sale.large_return', enabled: true, refundUsdCap: 100 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/notifications/__tests__/notificationSettings.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/services/notifications/notificationSettings.ts
import { db } from '@/data/powersync/db'

// All 11 notification types that can produce a `notifications` row.
export type NotificationType =
  | 'discount.large_applied'
  | 'drawer.variance'
  | 'customer.debt_threshold'
  | 'inventory.low_stock'
  | 'shift.late_close'
  | 'expense.after_hours'
  | 'sale.large_return'
  | 'staff.pin_locked_out'
  | 'device.sync_stale'
  | 'device.registered'
  | 'settlement.paid'

// Only the types with shop-level settings (i.e. NOT 'inventory.low_stock', whose
// threshold lives on products.low_stock_threshold instead) appear here -- one row
// per shop per type in notification_settings, keyed by `type`. 11 notification
// types, 10 shop-level settings (WAFI-145 design spec).
export type SettingsBearingType = Exclude<NotificationType, 'inventory.low_stock'>

export type NotificationTypeSettings =
  | { type: 'discount.large_applied'; discountPercentCap: number }
  | { type: 'drawer.variance'; varianceUsdCap: number }
  | { type: 'customer.debt_threshold'; dailyDebtUsdCap: number }
  | { type: 'shift.late_close'; graceMinutes: number }
  | { type: 'sale.large_return'; refundUsdCap: number }
  | { type: 'device.sync_stale'; staleHours: number }
  | { type: 'expense.after_hours' | 'staff.pin_locked_out' | 'device.registered' | 'settlement.paid' }

export const DEFAULT_SETTINGS: Record<SettingsBearingType, NotificationTypeSettings> = {
  'discount.large_applied':  { type: 'discount.large_applied', discountPercentCap: 30 },
  'drawer.variance':         { type: 'drawer.variance', varianceUsdCap: 15 },
  'customer.debt_threshold': { type: 'customer.debt_threshold', dailyDebtUsdCap: 500 },
  'shift.late_close':        { type: 'shift.late_close', graceMinutes: 15 },
  'expense.after_hours':     { type: 'expense.after_hours' },
  'sale.large_return':       { type: 'sale.large_return', refundUsdCap: 100 },
  'staff.pin_locked_out':    { type: 'staff.pin_locked_out' },
  'device.sync_stale':       { type: 'device.sync_stale', staleHours: 2 },
  'device.registered':       { type: 'device.registered' },
  'settlement.paid':         { type: 'settlement.paid' },
}

interface SettingsRow { enabled: number; threshold_json: string | null }

/** Sparse-settings resolution (WAFI-145 design spec): a missing row resolves to
 *  the type's hardcoded default. Never throws -- a malformed threshold_json falls
 *  back to the default rather than blocking every notification of that type. */
export async function getNotificationSettings(
  shopId: string,
  type: SettingsBearingType,
): Promise<NotificationTypeSettings & { enabled: boolean }> {
  const row = await db.getOptional<SettingsRow>(
    `select enabled, threshold_json from notification_settings where shop_id = ? and type = ?`,
    [shopId, type],
  )
  if (!row) return { ...DEFAULT_SETTINGS[type], enabled: true }

  let threshold: NotificationTypeSettings = DEFAULT_SETTINGS[type]
  if (row.threshold_json) {
    try {
      threshold = JSON.parse(row.threshold_json) as NotificationTypeSettings
    } catch {
      threshold = DEFAULT_SETTINGS[type]
    }
  }
  return { ...threshold, enabled: !!row.enabled }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/notifications/__tests__/notificationSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/notifications/notificationSettings.ts src/services/notifications/__tests__/notificationSettings.test.ts
git commit -m "feat(WAFI-145): add typed notification settings module with sparse defaults"
```

---

### Task 6: Generalize Discount Alert rule (severity-routed, threshold-aware)

**Files:**
- Modify: `src/services/events/notificationSubscriber.ts:17-39` (`mapEventToNotification`, `handleDiscountEvent`)
- Modify: `src/services/events/__tests__/notificationSubscriber.test.ts`

**Interfaces:**
- Consumes: `getNotificationSettings` (Task 5).
- Produces: same `mapEventToNotification`/`handleDiscountEvent` names/shapes as today — behavior changes internally only (WARNING now also fires above the configurable `discountPercentCap`, not just `belowCost || pinApproval`).

- [ ] **Step 1: Write the failing test**

```ts
// src/services/events/__tests__/notificationSubscriber.test.ts — add
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
vi.mock('@/services/notifications/notificationSettings')

it('fires WARNING when discount % exceeds the configured cap, even without belowCost/pinApproval', () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({
    type: 'discount.large_applied', discountPercentCap: 20, enabled: true,
  })
  const event = {
    type: 'sale.discounted', entityId: 'sale1', staffId: 's1', shopId: 'shop1',
    occurredAt: '2026-01-01T00:00:00.000Z', payloadVersion: 1,
    payload: { discountType: 'percent', discountValue: 25, discountPercentage: 25, finalPriceUsd: 10, belowCost: false, pinApproval: false },
  } as any
  return mapEventToNotification(event).then((entry) => {
    expect(entry?.severity).toBe('WARNING')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/events/__tests__/notificationSubscriber.test.ts`
Expected: FAIL — `mapEventToNotification` returns `null` (current logic only checks `belowCost || pinApproval`) and isn't `async` yet.

- [ ] **Step 3: Implement**

```ts
// src/services/events/notificationSubscriber.ts — replace mapEventToNotification
import { getNotificationSettings } from '@/services/notifications/notificationSettings'

export async function mapEventToNotification(event: DomainEvent): Promise<NotificationInsert | null> {
  if ((event.type as DomainEventType) !== 'sale.discounted') return null
  const { belowCost, pinApproval, discountType, discountValue, discountPercentage, finalPriceUsd } =
    event.payload as SaleDiscountedPayload

  const settings = await getNotificationSettings(event.shopId, 'discount.large_applied')
  if (!settings.enabled) return null

  const overCap = discountPercentage !== undefined && discountPercentage > settings.discountPercentCap
  if (!belowCost && !pinApproval && !overCap) return null

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
```

```ts
// notificationSubscriber.ts — handleDiscountEvent now awaits the now-async mapper
export async function handleDiscountEvent(event: DurableEvent<unknown>): Promise<void> {
  const entry = await mapEventToNotification(event)
  if (!entry) return
  // ...rest unchanged (existing check-then-insert against source_event_id)...
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/events/__tests__/notificationSubscriber.test.ts`
Expected: PASS, including all pre-existing cases (belowCost, pinApproval, null-mapping).

- [ ] **Step 5: Commit**

```bash
git add src/services/events/notificationSubscriber.ts src/services/events/__tests__/notificationSubscriber.test.ts
git commit -m "feat(WAFI-145): generalize Discount Alert to a configurable percent-cap threshold"
```

---

### Task 7: Drawer Variance and Shift Late Close rules (both off `shift.closed`)

**Files:**
- Create: `src/services/notifications/rules/drawerVariance.rule.ts`
- Create: `src/services/notifications/rules/shiftLateClose.rule.ts`
- Test: `src/services/notifications/rules/__tests__/drawerVariance.rule.test.ts`
- Test: `src/services/notifications/rules/__tests__/shiftLateClose.rule.test.ts`

**Interfaces:**
- Consumes: `DurableEvent<ShiftClosedPayload>` (existing type), `getNotificationSettings`, `isWithinBusinessHours` is NOT used here (Late Close compares against `close_time` directly, not "within hours") — needs the shop's `close_time` read via `db.getOptional`.
- Produces: `handleDrawerVarianceEvent(event: DurableEvent<ShiftClosedPayload>): Promise<void>`, `handleShiftLateCloseEvent(event: DurableEvent<ShiftClosedPayload>): Promise<void>` — both registered as independent `runDurableSubscriber` calls on `'shift.closed'` in Task 15.

- [ ] **Step 1: Write the failing Drawer Variance test**

```ts
// src/services/notifications/rules/__tests__/drawerVariance.rule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleDrawerVarianceEvent } from '../drawerVariance.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'shift.closed', eventId: 'evt1', entityId: 'shift1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T21:00:00.000Z', payloadVersion: 1,
} as any

beforeEach(() => {
  vi.mocked(db.getOptional).mockResolvedValue(undefined) // no existing dedup row
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'drawer.variance', varianceUsdCap: 15, enabled: true })
})

it('inserts a CRITICAL notification when |variance| exceeds the cap', async () => {
  const event = { ...baseEvent, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 100, countedCash: 80, variance: -20 } }
  await handleDrawerVarianceEvent(event)
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['CRITICAL']))
})

it('does not insert when |variance| is within the cap', async () => {
  const event = { ...baseEvent, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 100, countedCash: 95, variance: -5 } }
  await handleDrawerVarianceEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does nothing when the rule is disabled', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'drawer.variance', varianceUsdCap: 15, enabled: false })
  const event = { ...baseEvent, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 100, countedCash: 50, variance: -50 } }
  await handleDrawerVarianceEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/notifications/rules/__tests__/drawerVariance.rule.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement Drawer Variance**

```ts
// src/services/notifications/rules/drawerVariance.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ShiftClosedPayload } from '@/services/events/domainEvent.types'

export async function handleDrawerVarianceEvent(event: DurableEvent<ShiftClosedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'drawer.variance')
  if (!settings.enabled) return
  const { variance, shiftId } = event.payload
  if (Math.abs(variance) <= settings.varianceUsdCap) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'drawer.variance', ?, ?, 'shift', ?, 'CRITICAL', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'فرق في الصندوق',
      `تم رصد فرق ${Math.abs(variance).toFixed(2)}$ في الوردية`,
      shiftId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

- [ ] **Step 4: Run Drawer Variance tests, verify pass**

Run: `npx vitest run src/services/notifications/rules/__tests__/drawerVariance.rule.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing Shift Late Close test**

```ts
// src/services/notifications/rules/__tests__/shiftLateClose.rule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleShiftLateCloseEvent } from '../shiftLateClose.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'shift.closed', eventId: 'evt1', entityId: 'shift1', staffId: 's1', shopId: 'shop1',
  payloadVersion: 1, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 0, countedCash: 0, variance: 0 },
} as any

beforeEach(() => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'shift.late_close', graceMinutes: 15, enabled: true })
})

it('fires when closed after close_time + grace', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ close_time: '21:00', is_24_7: 0 } as any) // shop hours lookup
    .mockResolvedValueOnce(undefined) // dedup lookup
  const event = { ...baseEvent, occurredAt: '2026-01-01T21:20:00.000Z' } // 20 min late, grace is 15
  await handleShiftLateCloseEvent(event)
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['WARNING']))
})

it('does not fire within the grace window', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ close_time: '21:00', is_24_7: 0 } as any)
  const event = { ...baseEvent, occurredAt: '2026-01-01T21:10:00.000Z' } // 10 min late, grace is 15
  await handleShiftLateCloseEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does not fire when the shop has no close_time configured', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ close_time: null, is_24_7: 0 } as any)
  const event = { ...baseEvent, occurredAt: '2026-01-01T23:59:00.000Z' }
  await handleShiftLateCloseEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})
```

- [ ] **Step 6: Run to verify failure, then implement**

```ts
// src/services/notifications/rules/shiftLateClose.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ShiftClosedPayload } from '@/services/events/domainEvent.types'

interface ShopHoursRow { close_time: string | null; is_24_7: number | null }

export async function handleShiftLateCloseEvent(event: DurableEvent<ShiftClosedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'shift.late_close')
  if (!settings.enabled) return

  const shop = await db.getOptional<ShopHoursRow>(`select close_time, is_24_7 from shops where id = ?`, [event.shopId])
  if (!shop || shop.is_24_7 || !shop.close_time) return // no operating hours configured -- nothing to be "late" against

  const closedAt = new Date(event.occurredAt)
  const [closeH, closeM] = shop.close_time.split(':').map(Number)
  const expectedClose = new Date(closedAt)
  expectedClose.setUTCHours(closeH, closeM, 0, 0)
  const minutesLate = (closedAt.getTime() - expectedClose.getTime()) / 60_000
  if (minutesLate <= settings.graceMinutes) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'shift.late_close', ?, ?, 'shift', ?, 'WARNING', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'إغلاق متأخر للوردية',
      `تم إغلاق الوردية متأخراً بـ ${Math.round(minutesLate)} دقيقة`,
      event.payload.shiftId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

- [ ] **Step 7: Run both test files, verify pass**

Run: `npx vitest run src/services/notifications/rules/__tests__/drawerVariance.rule.test.ts src/services/notifications/rules/__tests__/shiftLateClose.rule.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/notifications/rules/drawerVariance.rule.ts src/services/notifications/rules/shiftLateClose.rule.ts src/services/notifications/rules/__tests__/drawerVariance.rule.test.ts src/services/notifications/rules/__tests__/shiftLateClose.rule.test.ts
git commit -m "feat(WAFI-145): add Drawer Variance and Shift Late Close notification rules"
```

---

### Task 8: `customer.debt_changed` credit-sale producer

**Files:**
- Modify: `src/services/sales.service.ts` (inside the existing `audit` callback of `executeBusinessOperation`, alongside the discount `publishEvent` calls)
- Modify: `src/services/__tests__/sales.service.test.ts`

**Interfaces:**
- Consumes: `fetchOutstandingBalanceUsd` from `@/features/customers/composables/useCustomerBalance` (existing), `CustomerEventType.DebtChanged`, `DebtChangedPayload` (widened in Task 3).
- Produces: nothing new for later tasks — this is a leaf producer that Task 9's subscriber consumes by event type, not by import.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/__tests__/sales.service.test.ts — add
import { fetchOutstandingBalanceUsd } from '@/features/customers/composables/useCustomerBalance'
vi.mock('@/features/customers/composables/useCustomerBalance', () => ({ fetchOutstandingBalanceUsd: vi.fn() }))

it('publishes customer.debt_changed with reason=credit_sale for a credit sale with a customer', async () => {
  vi.mocked(fetchOutstandingBalanceUsd).mockResolvedValue(150)
  // ...set up input with method: 'credit', customerId: 'c1', pendingPayments: []...
  await completeSale(inputWithCredit, auditPort)
  const debtCall = vi.mocked(publishEvent).mock.calls.find(([e]) => e.type === 'customer.debt_changed')
  expect(debtCall?.[0].payload).toMatchObject({ customerId: 'c1', deltaUsd: inputWithCredit.totalUsd, newBalanceUsd: 150, reason: 'credit_sale' })
})

it('does not publish customer.debt_changed for a cash sale', async () => {
  await completeSale(inputWithCash, auditPort)
  const debtCall = vi.mocked(publishEvent).mock.calls.find(([e]) => e.type === 'customer.debt_changed')
  expect(debtCall).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/__tests__/sales.service.test.ts`
Expected: FAIL — no `customer.debt_changed` publish exists yet.

- [ ] **Step 3: Implement**

```ts
// src/services/sales.service.ts — add imports
import { fetchOutstandingBalanceUsd } from '@/features/customers/composables/useCustomerBalance'
import { CustomerEventType } from '@/services/events/domainEvent.types'
import type { DebtChangedPayload } from '@/services/events/domainEvent.types'
```

```ts
// sales.service.ts — inside the existing `audit:` callback, after the sale-discount
// publishEvent block and before it returns (still within the same fire-and-forget
// escape hatch documented for the discount publishes above it)
if (isCredit && input.customerId) {
  void (async () => {
    try {
      const newBalanceUsd = await fetchOutstandingBalanceUsd(input.customerId!, input.shopId)
      await publishEvent<DebtChangedPayload>({
        type: CustomerEventType.DebtChanged,
        entityId: input.customerId!,
        payload: {
          customerId: input.customerId!,
          deltaUsd: completed.totalUsd,
          newBalanceUsd,
          reason: 'credit_sale',
        },
        payloadVersion: 1,
        staffId: input.staffId ?? '',
        shopId: input.shopId,
        occurredAt: now,
      })
    } catch {
      // Same accepted risk as the discount publishes above: the sale itself has
      // already committed by this point; a failure here must never surface as a
      // completeSale() rejection (that would risk a duplicate sale on retry).
    }
  })()
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/__tests__/sales.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/sales.service.ts src/services/__tests__/sales.service.test.ts
git commit -m "feat(WAFI-145): publish customer.debt_changed (reason=credit_sale) from credit sales"
```

---

### Task 9: Customer Debt Threshold rule (replay-safe crossing)

**Files:**
- Create: `src/services/notifications/rules/customerDebtThreshold.rule.ts`
- Test: `src/services/notifications/rules/__tests__/customerDebtThreshold.rule.test.ts`

**Interfaces:**
- Consumes: `DurableEvent<DebtChangedPayload>`, `getNotificationSettings`.
- Produces: `handleCustomerDebtThresholdEvent(event: DurableEvent<DebtChangedPayload>): Promise<void>`.

This rule must NOT use an in-memory accumulator (`runDurableSubscriber` gives at-least-once delivery — see the design spec's "Customer Debt: persistence and replay-safety strategy"). `after` is computed via an aggregate query over today's already-persisted credit-sale `debt_changed`-sourced sales; `before = after - event.payload.deltaUsd`. The dedup check queries `notifications` for an existing row today, not a separate counter.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/notifications/rules/__tests__/customerDebtThreshold.rule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleCustomerDebtThresholdEvent } from '../customerDebtThreshold.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'customer.debt_changed', eventId: 'evt1', entityId: 'c1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T12:00:00.000Z', payloadVersion: 1,
  payload: { customerId: 'c1', deltaUsd: 100, newBalanceUsd: 700, reason: 'credit_sale' },
} as any

beforeEach(() => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'customer.debt_threshold', dailyDebtUsdCap: 500, enabled: true })
})

it('fires when today\'s cumulative crosses from <= cap to > cap', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ total: 550 } as any)  // aggregate query: today's total AFTER this event
    .mockResolvedValueOnce(undefined)              // no existing notification today
  await handleCustomerDebtThresholdEvent(baseEvent)
  // before = 550 - 100 = 450 (<= 500), after = 550 (> 500) -> fires
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('does not fire when already above the cap before this event (no re-crossing)', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ total: 700 } as any) // before = 700-100=600, already > cap
  await handleCustomerDebtThresholdEvent(baseEvent)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does not fire twice for the same day even if it crosses again (notification already exists today)', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ total: 550 } as any)
    .mockResolvedValueOnce({ id: 'existing' } as any) // already notified today
  await handleCustomerDebtThresholdEvent(baseEvent)
  expect(db.execute).not.toHaveBeenCalled()
})

it('ignores events that are not a credit-sale increase', async () => {
  const returnEvent = { ...baseEvent, payload: { ...baseEvent.payload, reason: 'return', deltaUsd: -50 } }
  await handleCustomerDebtThresholdEvent(returnEvent)
  expect(db.getOptional).not.toHaveBeenCalled()
  expect(db.execute).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/notifications/rules/__tests__/customerDebtThreshold.rule.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/services/notifications/rules/customerDebtThreshold.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { DebtChangedPayload } from '@/services/events/domainEvent.types'

export async function handleCustomerDebtThresholdEvent(event: DurableEvent<DebtChangedPayload>): Promise<void> {
  const { reason, deltaUsd } = event.payload
  if (reason !== 'credit_sale' || deltaUsd <= 0) return

  const settings = await getNotificationSettings(event.shopId, 'customer.debt_threshold')
  if (!settings.enabled) return

  const today = event.occurredAt.slice(0, 10) // 'YYYY-MM-DD', local calendar-day boundary per the day's occurredAt

  // Authoritative aggregate over already-persisted sales -- NOT an in-memory
  // accumulator. Recomputing this on every invocation (including redelivery of
  // the same event) yields the same before/after every time, since the
  // underlying sales data is immutable once committed (design spec: "Customer
  // Debt: persistence and replay-safety strategy").
  const totalRow = await db.getOptional<{ total: number }>(
    `select coalesce(sum(total_usd), 0) as total from sales
     where shop_id = ? and is_credit = 1 and customer_id = ? and substr(created_at, 1, 10) = ?`,
    [event.shopId, event.payload.customerId, today],
  )
  const after = totalRow?.total ?? 0
  const before = after - deltaUsd

  if (before > settings.dailyDebtUsdCap || after <= settings.dailyDebtUsdCap) return

  // Dedup by "already notified today" rather than source_event_id (this rule's
  // trigger condition is accumulated state, not a single event's own payload) --
  // this is what actually prevents a duplicate insert on redelivery or on a later
  // same-day credit sale that doesn't re-cross.
  const existing = await db.getOptional<{ id: string }>(
    `select id from notifications where shop_id = ? and type = 'customer.debt_threshold'
     and substr(created_at, 1, 10) = ?`,
    [event.shopId, today],
  )
  if (existing) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'customer.debt_threshold', ?, ?, 'customer', ?, 'CRITICAL', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'دين جديد كبير اليوم',
      `تجاوز الدين الجديد اليوم $${after.toFixed(2)}`,
      event.payload.customerId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/notifications/rules/__tests__/customerDebtThreshold.rule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/notifications/rules/customerDebtThreshold.rule.ts src/services/notifications/rules/__tests__/customerDebtThreshold.rule.test.ts
git commit -m "feat(WAFI-145): add Customer Debt Threshold rule (replay-safe daily crossing)"
```

---

### Task 10: After-Hours Expense and Large Return rules

**Files:**
- Create: `src/services/notifications/rules/afterHoursExpense.rule.ts`
- Create: `src/services/notifications/rules/largeReturn.rule.ts`
- Test: `src/services/notifications/rules/__tests__/afterHoursExpense.rule.test.ts`
- Test: `src/services/notifications/rules/__tests__/largeReturn.rule.test.ts`

**Interfaces:**
- Consumes: `isWithinBusinessHours` (Task 4), `getNotificationSettings` (Task 5), `DurableEvent<ExpenseRecordedPayload>`, `DurableEvent<ReturnedPayload>`.
- Produces: `handleAfterHoursExpenseEvent`, `handleLargeReturnEvent`.

- [ ] **Step 1: Write the failing After-Hours Expense tests**

```ts
// src/services/notifications/rules/__tests__/afterHoursExpense.rule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleAfterHoursExpenseEvent } from '../afterHoursExpense.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'expense.recorded', eventId: 'evt1', entityId: 'exp1', staffId: 's1', shopId: 'shop1',
  payloadVersion: 1, payload: { expenseId: 'exp1', category: 'rent', amountUsd: 50, staffId: 's1', photoUrl: undefined },
} as any

beforeEach(() => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'expense.after_hours', enabled: true })
})

it('fires when the expense occurs outside business hours', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ open_time: '09:00', close_time: '21:00', is_24_7: 0 } as any)
    .mockResolvedValueOnce(undefined)
  const event = { ...baseEvent, occurredAt: '2026-01-01T23:30:00.000Z' }
  await handleAfterHoursExpenseEvent(event)
  expect(db.execute).toHaveBeenCalled()
})

it('does not fire during business hours', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ open_time: '09:00', close_time: '21:00', is_24_7: 0 } as any)
  const event = { ...baseEvent, occurredAt: '2026-01-01T12:00:00.000Z' }
  await handleAfterHoursExpenseEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does not fire when the shop is 24/7', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ open_time: null, close_time: null, is_24_7: 1 } as any)
  const event = { ...baseEvent, occurredAt: '2026-01-01T23:30:00.000Z' }
  await handleAfterHoursExpenseEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```ts
// src/services/notifications/rules/afterHoursExpense.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { isWithinBusinessHours, type ShopHours } from '@/services/notifications/businessHours'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ExpenseRecordedPayload } from '@/services/events/domainEvent.types'

export async function handleAfterHoursExpenseEvent(event: DurableEvent<ExpenseRecordedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'expense.after_hours')
  if (!settings.enabled) return

  const shop = await db.getOptional<ShopHours>(`select open_time, close_time, is_24_7 from shops where id = ?`, [event.shopId])
  if (!shop || isWithinBusinessHours(shop, event.occurredAt)) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'expense.after_hours', ?, ?, 'expense', ?, 'WARNING', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'مصروف خارج ساعات العمل',
      `تم تسجيل مصروف $${event.payload.amountUsd.toFixed(2)} خارج ساعات العمل`,
      event.payload.expenseId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run src/services/notifications/rules/__tests__/afterHoursExpense.rule.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing Large Return tests**

```ts
// src/services/notifications/rules/__tests__/largeReturn.rule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleLargeReturnEvent } from '../largeReturn.rule'

vi.mock('@/data/powersync/db', () => ({ db: { execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'sale.returned', eventId: 'evt1', entityId: 'return1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T12:00:00.000Z', payloadVersion: 1,
} as any

beforeEach(() => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'sale.large_return', refundUsdCap: 100, enabled: true })
})

it('fires when the refund exceeds the cap', async () => {
  const event = { ...baseEvent, payload: { returnId: 'return1', saleId: 'sale1', refundAmountUsd: 150, restockedItemCount: 2 } }
  await handleLargeReturnEvent(event)
  expect(db.execute).toHaveBeenCalled()
})

it('does not fire when the refund is within the cap', async () => {
  const event = { ...baseEvent, payload: { returnId: 'return1', saleId: 'sale1', refundAmountUsd: 40, restockedItemCount: 1 } }
  await handleLargeReturnEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: Run to verify failure, then implement**

```ts
// src/services/notifications/rules/largeReturn.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { ReturnedPayload } from '@/services/events/domainEvent.types'

export async function handleLargeReturnEvent(event: DurableEvent<ReturnedPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'sale.large_return')
  if (!settings.enabled) return
  if (event.payload.refundAmountUsd <= settings.refundUsdCap) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'sale.large_return', ?, ?, 'return', ?, 'WARNING', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'إرجاع كبير',
      `تم إرجاع مبلغ $${event.payload.refundAmountUsd.toFixed(2)}`,
      event.payload.returnId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

- [ ] **Step 6: Run both, verify pass**

Run: `npx vitest run src/services/notifications/rules/__tests__/afterHoursExpense.rule.test.ts src/services/notifications/rules/__tests__/largeReturn.rule.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/notifications/rules/afterHoursExpense.rule.ts src/services/notifications/rules/largeReturn.rule.ts src/services/notifications/rules/__tests__/afterHoursExpense.rule.test.ts src/services/notifications/rules/__tests__/largeReturn.rule.test.ts
git commit -m "feat(WAFI-145): add After-Hours Expense and Large Return notification rules"
```

---

### Task 11: `staff.pin_locked_out` producer (centralized in `usePinLockout.ts`)

**Files:**
- Modify: `src/features/staff/composables/usePinLockout.ts`
- Modify: `src/features/shifts/components/LockScreen.vue:122` (call-site update)
- Modify: `src/features/shifts/components/IdleLockOverlay.vue:38` (call-site update)
- Modify: `src/features/staff/composables/__tests__/usePinLockout.test.ts`

**Interfaces:**
- Consumes: `publishEvent`, `StaffEventType.PinLockedOut`, `PinLockedOutPayload` (Task 3).
- Produces: `recordFailure(staffId: string, shopId: string, now?: number): { locked: boolean; minutes: number }` — signature gains a required `shopId` param; both existing call sites (LockScreen.vue, IdleLockOverlay.vue) are updated in this same task so the build doesn't break.

Centralizing the publish in `usePinLockout.ts` (rather than duplicating it in both Vue components) is the DRY choice — it also guarantees `entityId` generation happens in exactly one place.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/staff/composables/__tests__/usePinLockout.test.ts — add
import { publishEvent } from '@/services/events/publishEvent'
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn() }))

it('publishes staff.pin_locked_out with a fresh entityId when the lockout trips', () => {
  const { recordFailure } = usePinLockout()
  let res
  for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) res = recordFailure('staff-1', 'shop-1', NOW)
  expect(res!.locked).toBe(true)
  expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'staff.pin_locked_out',
    payload: { staffId: 'staff-1', lockoutMinutes: LOCKOUT_MINUTES },
    shopId: 'shop-1', staffId: 'staff-1',
  }))
  const call = vi.mocked(publishEvent).mock.calls[0][0]
  expect(call.entityId).not.toBe('staff-1') // fresh occurrence id, not the staff id
})

it('does not publish on a non-tripping failure', () => {
  const { recordFailure } = usePinLockout()
  recordFailure('staff-2', 'shop-1', NOW)
  expect(publishEvent).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/staff/composables/__tests__/usePinLockout.test.ts`
Expected: FAIL — `recordFailure` doesn't take a `shopId` param and doesn't publish.

- [ ] **Step 3: Implement**

```ts
// src/features/staff/composables/usePinLockout.ts — add imports and update recordFailure
import { publishEvent } from '@/services/events/publishEvent'
import { StaffEventType } from '@/services/events/domainEvent.types'
import type { PinLockedOutPayload } from '@/services/events/domainEvent.types'

// ... (MAX_PIN_ATTEMPTS, LOCKOUT_MINUTES, STORAGE_KEY, read/write unchanged) ...

export function usePinLockout() {
  // ... isLockedOut, remainingMs unchanged ...

  /** Record one wrong PIN. Returns whether this attempt tripped the lockout.
   *  shopId is required so a tripped lockout can publish staff.pin_locked_out --
   *  entityId is a freshly-generated id for THIS lockout occurrence, not staffId:
   *  lockout state is per-device (WAFI-012), so the same staff member can
   *  independently trip a lockout on two different devices, and those must not
   *  collide on entity identity (WAFI-145 design spec). */
  function recordFailure(
    staffId: string,
    shopId: string,
    now: number = Date.now(),
  ): { locked: boolean; minutes: number } {
    const state = read()
    const e = state[staffId] ?? { attempts: 0, lockedUntil: 0 }
    e.attempts += 1
    let locked = false
    if (e.attempts >= MAX_PIN_ATTEMPTS) {
      e.lockedUntil = now + LOCKOUT_MINUTES * 60_000
      e.attempts = 0
      locked = true
    }
    state[staffId] = e
    write(state)

    if (locked) {
      void publishEvent<PinLockedOutPayload>({
        type: StaffEventType.PinLockedOut,
        entityId: crypto.randomUUID(),
        payload: { staffId, lockoutMinutes: LOCKOUT_MINUTES },
        payloadVersion: 1,
        staffId,
        shopId,
        occurredAt: new Date(now).toISOString(),
      }).catch(() => {})
    }

    return { locked, minutes: LOCKOUT_MINUTES }
  }

  return { isLockedOut, remainingMs, recordFailure, reset }
}
```

- [ ] **Step 4: Update both call sites**

```ts
// src/features/shifts/components/LockScreen.vue:122 — add the shopId argument
const { locked, minutes } = lockout.recordFailure(s.id, useDeviceStore().shopId)
```
Add `import { useDeviceStore } from '@/store/device.store'` to LockScreen.vue's script block if not already imported.

```ts
// src/features/shifts/components/IdleLockOverlay.vue:38 — add the shopId argument
const { locked, minutes } = lockout.recordFailure(s.id, useDeviceStore().shopId)
```
Add `import { useDeviceStore } from '@/store/device.store'` to IdleLockOverlay.vue's script block.

- [ ] **Step 5: Run the full staff test suite and typecheck**

Run: `npx vitest run src/features/staff/composables/__tests__/usePinLockout.test.ts src/features/staff/composables/__tests__/useStaffPinReset.test.ts && npx vue-tsc -b --noEmit`
Expected: PASS, no type errors (the other two `recordFailure` test files call it with only `staffId` — update those call sites too, passing a literal `'shop-1'` test shop id).

- [ ] **Step 6: Commit**

```bash
git add src/features/staff/composables/usePinLockout.ts src/features/shifts/components/LockScreen.vue src/features/shifts/components/IdleLockOverlay.vue src/features/staff/composables/__tests__/usePinLockout.test.ts src/features/staff/composables/__tests__/useStaffPinReset.test.ts
git commit -m "feat(WAFI-145): publish staff.pin_locked_out from the centralized lockout composable"
```

---

### Task 12: Cashier Lockout, New Device, and Settlement Paid rules

**Files:**
- Create: `src/services/notifications/rules/cashierLockout.rule.ts`
- Create: `src/services/notifications/rules/newDevice.rule.ts`
- Create: `src/services/notifications/rules/settlementPaid.rule.ts`
- Test: one test file per rule under `src/services/notifications/rules/__tests__/`

**Interfaces:**
- Consumes: `getNotificationSettings`, `DurableEvent<PinLockedOutPayload>`, `DurableEvent<DeviceRegisteredPayload>`, `DurableEvent<SettlementPaidPayload>`.
- Produces: `handleCashierLockoutEvent`, `handleNewDeviceEvent`, `handleSettlementPaidEvent`. All three are "always fire if enabled" rules (no threshold), the simplest shape in this ticket.

- [ ] **Step 1: Write the three failing tests (one shared shape)**

```ts
// src/services/notifications/rules/__tests__/cashierLockout.rule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleCashierLockoutEvent } from '../cashierLockout.rule'

vi.mock('@/data/powersync/db', () => ({ db: { execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

it('fires when enabled', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'staff.pin_locked_out', enabled: true })
  await handleCashierLockoutEvent({
    type: 'staff.pin_locked_out', eventId: 'evt1', entityId: 'lockout1', staffId: 's1', shopId: 'shop1',
    occurredAt: '2026-01-01T00:00:00.000Z', payloadVersion: 1, payload: { staffId: 's1', lockoutMinutes: 5 },
  } as any)
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['CRITICAL']))
})

it('does nothing when disabled', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'staff.pin_locked_out', enabled: false })
  await handleCashierLockoutEvent({ shopId: 'shop1', payload: { staffId: 's1', lockoutMinutes: 5 } } as any)
  expect(db.execute).not.toHaveBeenCalled()
})
```

(Mirror this exact structure for `newDevice.rule.test.ts` against `device.registered`/INFO and `settlementPaid.rule.test.ts` against `settlement.paid`/INFO.)

- [ ] **Step 2: Run to verify all three fail**

Run: `npx vitest run src/services/notifications/rules/__tests__/cashierLockout.rule.test.ts src/services/notifications/rules/__tests__/newDevice.rule.test.ts src/services/notifications/rules/__tests__/settlementPaid.rule.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement all three**

```ts
// src/services/notifications/rules/cashierLockout.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { PinLockedOutPayload } from '@/services/events/domainEvent.types'

export async function handleCashierLockoutEvent(event: DurableEvent<PinLockedOutPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'staff.pin_locked_out')
  if (!settings.enabled) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'staff.pin_locked_out', ?, ?, 'staff', ?, 'CRITICAL', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'تم قفل حساب موظف',
      `تم قفل حساب الموظف بعد محاولات خاطئة متكررة لمدة ${event.payload.lockoutMinutes} دقائق`,
      event.payload.staffId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

```ts
// src/services/notifications/rules/newDevice.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { DeviceRegisteredPayload } from '@/services/events/domainEvent.types'

export async function handleNewDeviceEvent(event: DurableEvent<DeviceRegisteredPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'device.registered')
  if (!settings.enabled) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'device.registered', ?, ?, 'device', ?, 'INFO', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'جهاز جديد',
      `تم تسجيل جهاز جديد: ${event.payload.deviceCode}`,
      event.payload.deviceId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

```ts
// src/services/notifications/rules/settlementPaid.rule.ts
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import type { DurableEvent } from '@/services/events/runDurableSubscriber'
import type { SettlementPaidPayload } from '@/services/events/domainEvent.types'

export async function handleSettlementPaidEvent(event: DurableEvent<SettlementPaidPayload>): Promise<void> {
  const settings = await getNotificationSettings(event.shopId, 'settlement.paid')
  if (!settings.enabled) return

  await db.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'settlement.paid', ?, ?, 'staff', ?, 'INFO', ?, ?)`,
    [
      crypto.randomUUID(), event.shopId,
      'تسوية موظف',
      `تم دفع تسوية للموظف`,
      event.payload.staffId, event.eventId, new Date().toISOString(),
    ],
  )
}
```

- [ ] **Step 4: Run all three, verify pass**

Run: `npx vitest run src/services/notifications/rules/__tests__/cashierLockout.rule.test.ts src/services/notifications/rules/__tests__/newDevice.rule.test.ts src/services/notifications/rules/__tests__/settlementPaid.rule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/notifications/rules/cashierLockout.rule.ts src/services/notifications/rules/newDevice.rule.ts src/services/notifications/rules/settlementPaid.rule.ts src/services/notifications/rules/__tests__/cashierLockout.rule.test.ts src/services/notifications/rules/__tests__/newDevice.rule.test.ts src/services/notifications/rules/__tests__/settlementPaid.rule.test.ts
git commit -m "feat(WAFI-145): add Cashier Lockout, New Device, and Settlement Paid notification rules"
```

---

### Task 13: Low Stock synchronous crossing check

**Files:**
- Create: `src/services/notifications/lowStockCheck.ts`
- Modify: `src/services/sales.service.ts` (per-line loop, inside the existing `tx` transaction)
- Modify: `src/services/inventory.service.ts` (both `receiveStock`'s line loop and `adjustInventory`)
- Test: `src/services/notifications/__tests__/lowStockCheck.test.ts`
- Test: additions to `src/services/__tests__/sales.service.test.ts`, `src/services/__tests__/inventory.service.test.ts`

**Interfaces:**
- Consumes: nothing (pure `tx.execute`/`tx.getOptional`-based helper — no `db` import, since it must run INSIDE the caller's write transaction, matching this codebase's existing "reads/writes inside `write()` use `tx`, not `db`" convention seen in `sales.service.ts`/`inventory.service.ts`).
- Produces: `checkLowStockCrossing(tx: Transaction, shopId: string, productId: string, oldStock: number, newStock: number, now: string): Promise<void>` — called from all three stock-mutating write paths.

- [ ] **Step 1: Write the failing unit tests for the crossing helper**

```ts
// src/services/notifications/__tests__/lowStockCheck.test.ts
import { describe, it, expect, vi } from 'vitest'
import { checkLowStockCrossing } from '../lowStockCheck'

function fakeTx(threshold: number) {
  return {
    execute: vi.fn(async (sql: string) => {
      if (sql.includes('select low_stock_threshold')) {
        return { rows: { _array: [{ low_stock_threshold: threshold, name_ar: 'منتج' }] } } as any
      }
      return {} as any
    }),
  } as any
}

it('inserts a notification when stock crosses from above to at-or-below the threshold', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 6, 4, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('inserts when crossing exactly onto the threshold (boundary inclusive)', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 6, 5, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('does not insert when already below the threshold (no new crossing)', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 4, 3, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledTimes(1) // only the threshold lookup, no insert
})

it('does not insert when crossing back above the threshold', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 3, 6, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledTimes(1)
})

it('fires again on a second crossing after having reset above the threshold', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 3, 6, '2026-01-01T00:00:00.000Z') // reset, no fire
  await checkLowStockCrossing(tx, 'shop1', 'p1', 6, 5, '2026-01-01T00:00:00.000Z') // crosses down again
  expect(tx.execute).toHaveBeenCalledTimes(3) // 2 lookups + 1 insert
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/notifications/__tests__/lowStockCheck.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/services/notifications/lowStockCheck.ts
//
// State-derived Low Stock check (WAFI-145 design spec). Must run synchronously
// inside the SAME write transaction as the stock mutation, not as a separately
// scheduled or event-subscriber-driven check -- see the design spec's "Low Stock
// must be checked synchronously inside the inventory mutation flow" requirement.
// Takes `tx` (not `db`), matching the existing convention in sales.service.ts and
// inventory.service.ts where all writes inside a transaction go through `tx`.
//
// No source_event_id (this isn't event-sourced) -- migration 080 made that column
// nullable specifically for this case.

interface TxLike {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>
}

interface ThresholdRow { low_stock_threshold: number; name_ar: string }

export async function checkLowStockCrossing(
  tx: TxLike,
  shopId: string,
  productId: string,
  oldStock: number,
  newStock: number,
  now: string,
): Promise<void> {
  const res = await tx.execute(
    `select low_stock_threshold, name_ar from products where id = ?`, [productId],
  )
  const row = (res as any).rows?._array?.[0] as ThresholdRow | undefined
  if (!row) return
  const threshold = row.low_stock_threshold

  // Boundary inclusive: the threshold itself counts as low. Fires only on the
  // crossing (was above, now at-or-below) -- not on every event while already
  // below, and resets when stock climbs back above the threshold.
  const crossedDown = oldStock > threshold && newStock <= threshold
  if (!crossedDown) return

  await tx.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'inventory.low_stock', ?, ?, 'product', ?, 'WARNING', NULL, ?)`,
    [
      crypto.randomUUID(), shopId,
      'مخزون منخفض',
      `وصل المنتج "${row.name_ar}" إلى الحد الأدنى للمخزون (${newStock} متبقٍ)`,
      productId, now,
    ],
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/notifications/__tests__/lowStockCheck.test.ts`
Expected: PASS (all 5 cases, matching the design spec's required crossing sequence).

- [ ] **Step 5: Wire into `sales.service.ts`'s per-line loop**

```ts
// src/services/sales.service.ts — inside the `for (const line of input.lines)` loop
// in `write()`, right after the existing stock_adjustments insert (the sale path is
// the most common cause of a low-stock crossing in a retail shop — design spec
// point 1). Import at top of file: `import { checkLowStockCrossing } from '@/services/notifications/lowStockCheck'`
await tx.execute(
  `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
   VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?)`,
  [uuidv4(), input.shopId, line.productId, currentStock, newStock, adjustNote, now, input.deviceId],
)
await checkLowStockCrossing(tx, input.shopId, line.productId, currentStock, newStock, now)
```

- [ ] **Step 6: Wire into `inventory.service.ts`'s `receiveStock` and `adjustInventory`**

```ts
// src/services/inventory.service.ts — top of file
import { checkLowStockCrossing } from '@/services/notifications/lowStockCheck'
```

```ts
// receiveStock's line loop, right after the current_stock UPDATE
await tx.execute(
  `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
  [newStock, now, line.productId],
)
await checkLowStockCrossing(tx, shopId, line.productId, oldStock, newStock, now)
```

```ts
// adjustInventory's write(), right after the current_stock UPDATE
await tx.execute(
  `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
  [clampedValue, now, input.productId],
)
await checkLowStockCrossing(tx, shopId, input.productId, oldValue, clampedValue, now)
```

- [ ] **Step 7: Write the three required path tests (design spec: "Low Stock is not satisfied by a single generic test")**

```ts
// src/services/__tests__/sales.service.test.ts — add
it('fires Low Stock when a sale crosses the threshold (6 -> 4)', async () => {
  // arrange a product row with current_stock=6, low_stock_threshold=5, and a
  // sale line with quantity=2 against it, then assert an
  // 'insert into notifications' call with type inventory.low_stock occurs.
})
```

```ts
// src/services/__tests__/inventory.service.test.ts — add
it('fires Low Stock on a manual adjustment crossing the threshold (6 -> 5)', async () => {
  // adjustInventory with mode: 'delta', delta: -1 against current_stock=6, threshold=5
})

it('does not fire Low Stock on a receiving that crosses back above the threshold (4 -> 6)', async () => {
  // receiveStock with a line qtyReceived=2 against current_stock=4, threshold=5
})
```

- [ ] **Step 8: Run the full set, verify pass**

Run: `npx vitest run src/services/notifications/__tests__/lowStockCheck.test.ts src/services/__tests__/sales.service.test.ts src/services/__tests__/inventory.service.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/notifications/lowStockCheck.ts src/services/notifications/__tests__/lowStockCheck.test.ts src/services/sales.service.ts src/services/inventory.service.ts src/services/__tests__/sales.service.test.ts src/services/__tests__/inventory.service.test.ts
git commit -m "feat(WAFI-145): add synchronous Low Stock crossing check across sale/adjust/receive paths"
```

---

### Task 14: Sync Failure state-derived check (app-foreground)

**Files:**
- Create: `src/services/notifications/syncStalenessCheck.ts`
- Modify: `src/App.vue` (foreground wiring)
- Test: `src/services/notifications/__tests__/syncStalenessCheck.test.ts`

**Interfaces:**
- Consumes: `db.getAll`/`db.execute` from `@/data/powersync/db`, `getNotificationSettings`, `useDeviceStore().deviceId`.
- Produces: `checkDeviceSyncStaleness(shopId: string, currentDeviceId: string): Promise<void>` — called once on `App.vue` mount and on every `visibilitychange` to `'visible'`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/notifications/__tests__/syncStalenessCheck.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { checkDeviceSyncStaleness } from '../syncStalenessCheck'

vi.mock('@/data/powersync/db', () => ({ db: { getAll: vi.fn(), getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

beforeEach(() => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'device.sync_stale', staleHours: 2, enabled: true })
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
})

it('excludes the current device from staleness checks', async () => {
  vi.mocked(db.getAll).mockResolvedValue([
    { id: 'this-device', last_seen_at: '2026-01-01T00:00:00.000Z' }, // 12h stale, but IS the current device
  ] as any)
  await checkDeviceSyncStaleness('shop1', 'this-device')
  expect(db.execute).not.toHaveBeenCalled()
})

it('fires for a genuinely stale OTHER device', async () => {
  vi.mocked(db.getAll).mockResolvedValue([
    { id: 'other-device', last_seen_at: '2026-01-01T00:00:00.000Z' }, // 12h stale
  ] as any)
  vi.mocked(db.getOptional).mockResolvedValue(undefined) // not already notified for this episode
  await checkDeviceSyncStaleness('shop1', 'this-device')
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('does not fire for a device seen recently', async () => {
  vi.mocked(db.getAll).mockResolvedValue([
    { id: 'other-device', last_seen_at: '2026-01-01T11:30:00.000Z' }, // 30 min ago
  ] as any)
  await checkDeviceSyncStaleness('shop1', 'this-device')
  expect(db.execute).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/notifications/__tests__/syncStalenessCheck.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/services/notifications/syncStalenessCheck.ts
//
// State-derived Sync Failure check (WAFI-145 design spec). No background timer
// exists in this offline-first PWA -- run on app foreground only (App.vue wiring),
// not a periodic in-app timer. A device is never stale relative to itself.

import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'

interface DeviceRow { id: string; last_seen_at: string | null }

export async function checkDeviceSyncStaleness(shopId: string, currentDeviceId: string): Promise<void> {
  const settings = await getNotificationSettings(shopId, 'device.sync_stale')
  if (!settings.enabled) return

  const devices = await db.getAll<DeviceRow>(
    `select id, last_seen_at from devices where shop_id = ? and (is_active is null or is_active = 1)`,
    [shopId],
  )
  const staleMs = settings.staleHours * 60 * 60 * 1000
  const now = Date.now()

  for (const device of devices) {
    if (device.id === currentDeviceId) continue // a device is never stale relative to itself
    if (!device.last_seen_at) continue
    const staleFor = now - new Date(device.last_seen_at).getTime()
    if (staleFor <= staleMs) continue

    // "Not already notified for this staleness episode": one notification per
    // device per day is enough signal without a generic rate limiter.
    const today = new Date(now).toISOString().slice(0, 10)
    const existing = await db.getOptional<{ id: string }>(
      `select id from notifications where shop_id = ? and type = 'device.sync_stale'
       and entity_id = ? and substr(created_at, 1, 10) = ?`,
      [shopId, device.id, today],
    )
    if (existing) continue

    await db.execute(
      `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
       values (?, ?, 'owner', 'device.sync_stale', ?, ?, 'device', ?, 'INFO', NULL, ?)`,
      [
        crypto.randomUUID(), shopId,
        'جهاز لم يُزامن',
        `لم يقم أحد الأجهزة بالمزامنة منذ أكثر من ${settings.staleHours} ساعة`,
        device.id, new Date(now).toISOString(),
      ],
    )
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/notifications/__tests__/syncStalenessCheck.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `App.vue`**

```ts
// src/App.vue — add import near the other event/notification imports
import { checkDeviceSyncStaleness } from '@/services/notifications/syncStalenessCheck'
```

```ts
// src/App.vue — inside onMounted, after the existing startNotificationSubscribers call
void checkDeviceSyncStaleness(useDeviceStore().shopId, useDeviceStore().deviceId)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void checkDeviceSyncStaleness(useDeviceStore().shopId, useDeviceStore().deviceId)
  }
})
```

- [ ] **Step 6: Manual smoke check**

Run the app locally (`npm run dev`), switch tabs away and back, confirm no console errors from the new listener.

- [ ] **Step 7: Commit**

```bash
git add src/services/notifications/syncStalenessCheck.ts src/services/notifications/__tests__/syncStalenessCheck.test.ts src/App.vue
git commit -m "feat(WAFI-145): add Sync Failure state-derived check on app foreground"
```

---

### Task 15: Wire all event-driven subscribers

**Files:**
- Modify: `src/services/events/notificationSubscriber.ts` (`startNotificationSubscribers`)

**Interfaces:**
- Consumes: every `handle*Event` function from Tasks 6, 7, 9, 10, 12.
- Produces: `startNotificationSubscribers(shopId: string): { stop: () => void }` — same exported name/shape App.vue already calls; internals now register 9 independent durable subscriptions instead of 1.

- [ ] **Step 1: Implement**

```ts
// src/services/events/notificationSubscriber.ts — replace startNotificationSubscribers
import { handleDrawerVarianceEvent } from '@/services/notifications/rules/drawerVariance.rule'
import { handleShiftLateCloseEvent } from '@/services/notifications/rules/shiftLateClose.rule'
import { handleCustomerDebtThresholdEvent } from '@/services/notifications/rules/customerDebtThreshold.rule'
import { handleAfterHoursExpenseEvent } from '@/services/notifications/rules/afterHoursExpense.rule'
import { handleLargeReturnEvent } from '@/services/notifications/rules/largeReturn.rule'
import { handleCashierLockoutEvent } from '@/services/notifications/rules/cashierLockout.rule'
import { handleNewDeviceEvent } from '@/services/notifications/rules/newDevice.rule'
import { handleSettlementPaidEvent } from '@/services/notifications/rules/settlementPaid.rule'

export function startNotificationSubscribers(shopId: string): { stop: () => void } {
  // One runDurableSubscriber per (source event, rule) pair -- independently
  // retryable even when two rules share a source event (drawer variance + late
  // close both react to shift.closed), per the design spec's architecture note.
  const subs = [
    runDurableSubscriber({ subscriberName: 'notifications-discount',      eventType: 'sale.discounted',      shopId, handler: handleDiscountEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-drawer-variance', eventType: 'shift.closed',        shopId, handler: handleDrawerVarianceEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-shift-late-close', eventType: 'shift.closed',       shopId, handler: handleShiftLateCloseEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-customer-debt',  eventType: 'customer.debt_changed', shopId, handler: handleCustomerDebtThresholdEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-after-hours-expense', eventType: 'expense.recorded', shopId, handler: handleAfterHoursExpenseEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-large-return',   eventType: 'sale.returned',        shopId, handler: handleLargeReturnEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-cashier-lockout', eventType: 'staff.pin_locked_out', shopId, handler: handleCashierLockoutEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-new-device',     eventType: 'device.registered',    shopId, handler: handleNewDeviceEvent }),
    runDurableSubscriber({ subscriberName: 'notifications-settlement-paid', eventType: 'settlement.paid',     shopId, handler: handleSettlementPaidEvent }),
  ]
  return { stop: () => subs.forEach(s => s.stop()) }
}
```

- [ ] **Step 2: Run the full notification-related test suite**

Run: `npx vitest run src/services/events/__tests__/notificationSubscriber.test.ts src/services/notifications`
Expected: PASS (no regressions in the existing subscriber test, which still exercises `handleDiscountEvent` directly).

- [ ] **Step 3: Commit**

```bash
git add src/services/events/notificationSubscriber.ts
git commit -m "feat(WAFI-145): wire all 9 event-driven notification rules into startNotificationSubscribers"
```

---

### Task 16: `NotificationBell.vue` — acknowledgment and severity

**Files:**
- Modify: `src/features/notifications/components/NotificationBell.vue`
- Test: existing/adjacent component test file (create `src/features/notifications/components/__tests__/NotificationBell.test.ts` if none exists)

**Interfaces:**
- Consumes: `notifications` table columns (`severity`, `acknowledged_at`, `entity_type`, `entity_id`).
- Produces: emits nothing new; adds a link to `/notifications` (the Center, built in Task 17) and severity-colored badges in its dropdown.

- [ ] **Step 1: Read the current component before editing**

Run: read `src/features/notifications/components/NotificationBell.vue` in full (it is deliberately small, per its own header comment) before making changes, to preserve its existing `db.watch` unread-count query and list rendering.

- [ ] **Step 2: Write the failing test**

```ts
// src/features/notifications/components/__tests__/NotificationBell.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NotificationBell from '../NotificationBell.vue'
// ... mock db.watch to yield a fixture with one CRITICAL, unacknowledged row ...

it('renders a distinct visual marker for an unacknowledged CRITICAL notification', async () => {
  const wrapper = mount(NotificationBell)
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[data-testid="notification-critical-marker"]').exists()).toBe(true)
})

it('links to the full notification center', () => {
  const wrapper = mount(NotificationBell)
  expect(wrapper.find('a[href="/notifications"]').exists() || wrapper.findComponent({ name: 'RouterLink' }).exists()).toBe(true)
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/features/notifications/components/__tests__/NotificationBell.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement** — extend the dropdown list item template with a severity-based class and a CRITICAL marker, and add a footer link/button that routes to `/notifications` (added in Task 17). Keep the existing `db.watch` query and unread-count logic untouched; only the template and the query's selected columns change (add `severity`, `acknowledged_at` to the `SELECT` if not already selected).

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/features/notifications/components/__tests__/NotificationBell.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/components/NotificationBell.vue src/features/notifications/components/__tests__/NotificationBell.test.ts
git commit -m "feat(WAFI-145): extend NotificationBell with severity markers and a link to the full center"
```

---

### Task 17: `NotificationCenterScreen.vue` — filters, acknowledge, deep-link routing

**Files:**
- Create: `src/features/notifications/screens/NotificationCenterScreen.vue`
- Create: `src/features/notifications/notificationRouting.ts` (the `entity_type + entity_id → route` lookup table)
- Modify: `src/router/index.ts` (add `/notifications` route)
- Test: `src/features/notifications/__tests__/notificationRouting.test.ts`

**Interfaces:**
- Consumes: `notifications` table (`db.watch`/`db.execute`), Vue Router.
- Produces: `resolveNotificationRoute(entityType: string, entityId: string): RouteLocationRaw | null` — the frontend-owned routing table the design spec requires (subscribers never know Vue routes).

This router (`src/router/index.ts`) uses **path-based routes with no `name` fields** at
all — confirmed by inspection, not assumed. Per-record detail routes exist for only 4 of
the 8 entity types this ticket needs: `/shifts/:id` (shift), `/customers/:id` (customer),
`/products/:id/edit` (product), `/staff/:staffId/ledger` (staff). **Sale, expense, return,
and device have no per-record detail route in this codebase today** — building four new
detail-page screens is well beyond this ticket's already-large scope, so those four
notification types deep-link to their closest existing **list** page instead of a
nonexistent single-record page: `/history` (sale), `/expenses` (expense), `/history`
(return — returns are shown from the sale history list in this app), `/settings/devices`
(device). This is a deliberate, documented scope limit, not an oversight — revisit if a
later ticket adds those detail pages.

- [ ] **Step 1: Write the failing routing test**

```ts
// src/features/notifications/__tests__/notificationRouting.test.ts
import { describe, it, expect } from 'vitest'
import { resolveNotificationRoute } from '../notificationRouting'

it('resolves entity types with a real per-record detail route to that record', () => {
  expect(resolveNotificationRoute('shift', 'sh1')).toEqual({ path: '/shifts/sh1' })
  expect(resolveNotificationRoute('customer', 'c1')).toEqual({ path: '/customers/c1' })
  expect(resolveNotificationRoute('product', 'p1')).toEqual({ path: '/products/p1/edit' })
  expect(resolveNotificationRoute('staff', 'st1')).toEqual({ path: '/staff/st1/ledger' })
})

it('resolves entity types with no per-record detail page to their closest list page', () => {
  expect(resolveNotificationRoute('sale', 's1')).toEqual({ path: '/history' })
  expect(resolveNotificationRoute('expense', 'e1')).toEqual({ path: '/expenses' })
  expect(resolveNotificationRoute('return', 'r1')).toEqual({ path: '/history' })
  expect(resolveNotificationRoute('device', 'd1')).toEqual({ path: '/settings/devices' })
})

it('returns null for an unmapped entity_type rather than throwing', () => {
  expect(resolveNotificationRoute('unknown', 'x')).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/notifications/__tests__/notificationRouting.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the routing table**

```ts
// src/features/notifications/notificationRouting.ts
//
// Deep-link destination mapping (WAFI-145 design spec). The subscriber's only job
// is populating entity_type/entity_id correctly; this table is the ONLY place that
// knows about Vue routes, kept out of the domain/event layer entirely.
//
// This router uses path-based routes with no `name` fields (confirmed against
// src/router/index.ts), so destinations are plain paths, not named-route objects.
// Only shift/customer/product/staff have a real per-record detail route today;
// sale/expense/return/device fall back to their closest list page since no
// per-record detail screen exists for them yet (see this file's header note in
// the implementation plan for why that's a deliberate scope limit, not a bug).
import type { RouteLocationRaw } from 'vue-router'

const ROUTES: Record<string, (id: string) => RouteLocationRaw> = {
  shift:    (id) => ({ path: `/shifts/${id}` }),
  customer: (id) => ({ path: `/customers/${id}` }),
  product:  (id) => ({ path: `/products/${id}/edit` }),
  staff:    (id) => ({ path: `/staff/${id}/ledger` }),
  sale:     () => ({ path: '/history' }),
  expense:  () => ({ path: '/expenses' }),
  return:   () => ({ path: '/history' }),
  device:   () => ({ path: '/settings/devices' }),
}

export function resolveNotificationRoute(entityType: string, entityId: string): RouteLocationRaw | null {
  return ROUTES[entityType]?.(entityId) ?? null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/notifications/__tests__/notificationRouting.test.ts`
Expected: PASS.

- [ ] **Step 5: Build `NotificationCenterScreen.vue`**

```vue
<!-- src/features/notifications/screens/NotificationCenterScreen.vue -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { resolveNotificationRoute } from '@/features/notifications/notificationRouting'

interface NotificationRow {
  id: string; type: string; title: string; message: string
  entity_type: string | null; entity_id: string | null
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  created_at: string; read_at: string | null; acknowledged_at: string | null
}

const router = useRouter()
const filter = ref<'all' | 'unread' | 'critical' | 'today'>('all')
const items = ref<NotificationRow[]>([])

const filtered = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return items.value.filter((n) => {
    if (filter.value === 'unread') return !n.read_at
    if (filter.value === 'critical') return n.severity === 'CRITICAL'
    if (filter.value === 'today') return n.created_at.slice(0, 10) === today
    return true
  })
})

async function load() {
  const shopId = useDeviceStore().shopId
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  items.value = await db.getAll<NotificationRow>(
    `select id, type, title, message, entity_type, entity_id, severity, created_at, read_at, acknowledged_at
     from notifications where shop_id = ? and created_at >= ? order by created_at desc`,
    [shopId, since],
  )
}

async function markAllRead() {
  await db.execute(`update notifications set read_at = ? where shop_id = ? and read_at is null`,
    [new Date().toISOString(), useDeviceStore().shopId])
  await load()
}

async function acknowledge(n: NotificationRow) {
  await db.execute(`update notifications set acknowledged_at = ?, read_at = coalesce(read_at, ?) where id = ?`,
    [new Date().toISOString(), new Date().toISOString(), n.id])
  await load()
}

function open(n: NotificationRow) {
  if (!n.entity_type || !n.entity_id) return
  const route = resolveNotificationRoute(n.entity_type, n.entity_id)
  if (route) router.push(route)
}

onMounted(load)
</script>

<template>
  <div class="notification-center">
    <div class="filters">
      <button :class="{ active: filter === 'all' }" @click="filter = 'all'">الكل</button>
      <button :class="{ active: filter === 'unread' }" @click="filter = 'unread'">غير مقروء</button>
      <button :class="{ active: filter === 'critical' }" @click="filter = 'critical'">حرج</button>
      <button :class="{ active: filter === 'today' }" @click="filter = 'today'">اليوم</button>
      <button @click="markAllRead">تعليم الكل كمقروء</button>
    </div>
    <ul class="notification-list">
      <li v-for="n in filtered" :key="n.id" :class="n.severity.toLowerCase()" @click="open(n)">
        <strong>{{ n.title }}</strong>
        <p>{{ n.message }}</p>
        <span class="timestamp">{{ n.created_at }}</span>
        <button
          v-if="n.severity === 'CRITICAL' && !n.acknowledged_at"
          data-testid="acknowledge-button"
          @click.stop="acknowledge(n)"
        >
          تأكيد
        </button>
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 6: Register the route**

```ts
// src/router/index.ts — add near the other top-level authenticated routes
{ path: '/notifications', name: 'notification-center', component: () => import('@/features/notifications/screens/NotificationCenterScreen.vue') },
```

- [ ] **Step 7: Manual smoke check**

Run the app, seed a few notification rows of different severities via the SQLite console or a temporary script, navigate to `/notifications`, verify each filter tab and the Acknowledge button work.

- [ ] **Step 8: Commit**

```bash
git add src/features/notifications/screens/NotificationCenterScreen.vue src/features/notifications/notificationRouting.ts src/features/notifications/__tests__/notificationRouting.test.ts src/router/index.ts
git commit -m "feat(WAFI-145): add NotificationCenterScreen with filters, acknowledgment, and deep-link routing"
```

---

### Task 18: `NotificationSettingsScreen.vue` and business-hours settings

**Files:**
- Create: `src/features/settings/screens/NotificationSettingsScreen.vue`
- Modify: `src/router/index.ts` (add `/settings/notifications` under the existing settings parent route)
- Test: `src/features/settings/screens/__tests__/NotificationSettingsScreen.test.ts`

**Interfaces:**
- Consumes: `SettingsBearingType`, `DEFAULT_SETTINGS`, `getNotificationSettings` (Task 5), `notification_settings` table, `shops.open_time`/`close_time`/`is_24_7`.
- Produces: a settings UI; no new exported functions for later tasks (this is a leaf UI task).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/settings/screens/__tests__/NotificationSettingsScreen.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NotificationSettingsScreen from '../NotificationSettingsScreen.vue'
// ... mock db.getAll to return no override rows (all defaults) ...

it('renders exactly 10 settings-bearing type rows, not 11', async () => {
  const wrapper = mount(NotificationSettingsScreen)
  await wrapper.vm.$nextTick()
  expect(wrapper.findAll('[data-testid^="notification-type-row-"]')).toHaveLength(10)
  expect(wrapper.find('[data-testid="notification-type-row-inventory.low_stock"]').exists()).toBe(false)
})

it('rejects open_time equal to close_time with a validation error', async () => {
  const wrapper = mount(NotificationSettingsScreen)
  await wrapper.find('[data-testid="open-time-input"]').setValue('09:00')
  await wrapper.find('[data-testid="close-time-input"]').setValue('09:00')
  await wrapper.find('[data-testid="save-hours-button"]').trigger('click')
  expect(wrapper.find('[data-testid="hours-validation-error"]').exists()).toBe(true)
})

it('accepts an overnight schedule (open > close)', async () => {
  const wrapper = mount(NotificationSettingsScreen)
  await wrapper.find('[data-testid="open-time-input"]').setValue('08:00')
  await wrapper.find('[data-testid="close-time-input"]').setValue('02:00')
  await wrapper.find('[data-testid="save-hours-button"]').trigger('click')
  expect(wrapper.find('[data-testid="hours-validation-error"]').exists()).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/settings/screens/__tests__/NotificationSettingsScreen.test.ts`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement**

```vue
<!-- src/features/settings/screens/NotificationSettingsScreen.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import {
  DEFAULT_SETTINGS, getNotificationSettings,
  type SettingsBearingType, type NotificationTypeSettings,
} from '@/services/notifications/notificationSettings'

// 10 settings-bearing types, NOT 11 -- inventory.low_stock is deliberately absent
// (its threshold is products.low_stock_threshold, per product, per the design spec).
const TYPES = Object.keys(DEFAULT_SETTINGS) as SettingsBearingType[]

const rows = ref<Array<{ type: SettingsBearingType; enabled: boolean; settings: NotificationTypeSettings }>>([])
const openTime = ref<string>('')
const closeTime = ref<string>('')
const is24x7 = ref(false)
const hoursError = ref('')

async function loadRows() {
  const shopId = useDeviceStore().shopId
  rows.value = await Promise.all(TYPES.map(async (type) => {
    const s = await getNotificationSettings(shopId, type)
    const { enabled, ...settings } = s
    return { type, enabled, settings }
  }))
}

async function loadShopHours() {
  const shop = await db.getOptional<{ open_time: string | null; close_time: string | null; is_24_7: number }>(
    `select open_time, close_time, is_24_7 from shops where id = ?`, [useDeviceStore().shopId],
  )
  openTime.value = shop?.open_time ?? ''
  closeTime.value = shop?.close_time ?? ''
  is24x7.value = !!shop?.is_24_7
}

async function toggleEnabled(row: { type: SettingsBearingType; enabled: boolean; settings: NotificationTypeSettings }) {
  row.enabled = !row.enabled
  await upsertSettings(row.type, row.enabled, row.settings)
}

async function upsertSettings(type: SettingsBearingType, enabled: boolean, settings: NotificationTypeSettings) {
  const shopId = useDeviceStore().shopId
  await db.execute(
    `insert into notification_settings (shop_id, type, enabled, threshold_json, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict (shop_id, type) do update set enabled = excluded.enabled, threshold_json = excluded.threshold_json, updated_at = excluded.updated_at`,
    [shopId, type, enabled ? 1 : 0, JSON.stringify(settings), new Date().toISOString()],
  )
}

async function saveHours() {
  hoursError.value = ''
  // Only open_time === close_time is invalid -- open > close (overnight) is
  // accepted, matching the DB constraint exactly (design spec: the UI must not
  // impose a stricter rule than the database allows).
  if (!is24x7.value && openTime.value && closeTime.value && openTime.value === closeTime.value) {
    hoursError.value = 'وقت الفتح والإغلاق لا يمكن أن يكونا متطابقين'
    return
  }
  const shopId = useDeviceStore().shopId
  const [open, close] = is24x7.value ? [null, null] : [openTime.value || null, closeTime.value || null]
  await db.execute(
    `update shops set open_time = ?, close_time = ?, is_24_7 = ? where id = ?`,
    [open, close, is24x7.value ? 1 : 0, shopId],
  )
}

onMounted(async () => {
  await loadRows()
  await loadShopHours()
})
</script>

<template>
  <div class="notification-settings">
    <section class="business-hours">
      <h2>ساعات العمل</h2>
      <label><input type="checkbox" v-model="is24x7" data-testid="is-24-7-checkbox" /> مفتوح ٢٤/٧</label>
      <template v-if="!is24x7">
        <input type="time" v-model="openTime" data-testid="open-time-input" />
        <input type="time" v-model="closeTime" data-testid="close-time-input" />
      </template>
      <button data-testid="save-hours-button" @click="saveHours">حفظ</button>
      <p v-if="hoursError" data-testid="hours-validation-error">{{ hoursError }}</p>
    </section>

    <section class="notification-types">
      <h2>إعدادات الإشعارات</h2>
      <div v-for="row in rows" :key="row.type" :data-testid="`notification-type-row-${row.type}`">
        <label>
          <input type="checkbox" :checked="row.enabled" @change="toggleEnabled(row)" />
          {{ row.type }}
        </label>
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/settings/screens/__tests__/NotificationSettingsScreen.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the route**

```ts
// src/router/index.ts — add alongside the other settings children (path: '/settings')
{ path: 'notifications', component: () => import('@/features/settings/screens/NotificationSettingsScreen.vue') },
```

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/screens/NotificationSettingsScreen.vue src/features/settings/screens/__tests__/NotificationSettingsScreen.test.ts src/router/index.ts
git commit -m "feat(WAFI-145): add NotificationSettingsScreen with 10 type toggles and business-hours config"
```

---

### Task 19: Documentation — EVENT_SUBSCRIBERS.md and DOMAIN INTERACTION MATRIX

**Files:**
- Modify: `docs/architecture/EVENT_SUBSCRIBERS.md`
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md` (DOMAIN INTERACTION MATRIX + Cross-Epic Edge-Case Checklist, final review)

**Interfaces:**
- Consumes: nothing — this is documentation only.
- Produces: nothing consumed by code; required by CLAUDE.md's mandatory review-lens rule ("every final whole-branch review must include the filled Cross-Epic Edge-Case Checklist (final review) block").

- [ ] **Step 1: Update `EVENT_SUBSCRIBERS.md`**

Add a new "State-derived checks (not event subscribers)" section listing Low Stock (`checkLowStockCrossing`, called from `sales.service.ts`, `inventory.service.ts`) and Sync Failure (`checkDeviceSyncStaleness`, called from `App.vue` on foreground) — explicitly noting they have no entry in the event registry because they aren't events, per the design spec's architecture split. Add the 9 event-driven subscriber rows (subscriber name, event type, handler file) to the existing subscriber table, following that file's current format.

- [ ] **Step 2: Update the DOMAIN INTERACTION MATRIX in `AI_PRINCIPAL_ENGINEER_REVIEW.md`**

Update the existing Notifications row (currently: `HomePage badge (this ticket); full center is WAFI-145`) to reflect the shipped state: `Full center (NotificationCenterScreen, NotificationSettingsScreen); 11 types across 9 event-driven subscribers + 2 state-derived checks`. Add the Customer Credit row's producer list to include both `useReturnSheet.ts` (reason='return') and `sales.service.ts` (reason='credit_sale'). Add a new row for Shops' business-hours config (`shops.open_time/close_time/is_24_7`) if the matrix doesn't already have a Shops row, noting it has no other consumer yet besides this ticket's rules.

- [ ] **Step 3: Fill the Cross-Epic Edge-Case Checklist (final review) block**

```
## Cross-Epic Edge-Case Checklist (final review)
Matrix rows re-checked after implementation: Notifications, Customer Credit, Staff
Domains touched but not covered in the original spec checklist: none
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/EVENT_SUBSCRIBERS.md AI_PRINCIPAL_ENGINEER_REVIEW.md
git commit -m "docs(WAFI-145): update EVENT_SUBSCRIBERS.md and DOMAIN INTERACTION MATRIX for the notification center"
```

---

### Task 20: Full-suite verification and branch wrap-up

**Files:** none (verification task).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every test file touched or created in Tasks 1–19.

- [ ] **Step 2: Typecheck and build**

Run: `npx vue-tsc -b --noEmit && npm run build`
Expected: no type errors; build succeeds (per this repo's known gotcha — `npm run build` type-checks tests too, so this catches anything `vitest run` alone wouldn't).

- [ ] **Step 3: Manual smoke test in the running app**

Run: `npm run dev`. Ring a discounted sale, close a shift with an induced variance, record a credit sale past the debt cap, trigger a low-stock crossing via a sale, and confirm each produces the expected notification in `NotificationBell.vue` and `NotificationCenterScreen.vue`, with the correct severity and a working deep link.

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "fix(WAFI-145): fixups from full-suite verification"
```

## Deploy notes

Before this feature works end-to-end on synced (non-single-device) deployments:

- Migrations 080, 081, and 082 must be applied (082 adds the UUID `id` primary
  key `notification_settings` needs to sync at all -- see final-review fix C1/C2).
- A PowerSync sync-bucket/rule must be configured for the new
  `notification_settings` table in the PowerSync dashboard (sync rules live
  outside this repo, in the hosted dashboard -- there is no code-side fix).
  WAFI-143's implementation plan called this out explicitly for the
  `notifications` table; this is the equivalent note for `notification_settings`.
  Without it, settings written on one device will not sync to other devices or
  survive a reinstall.
