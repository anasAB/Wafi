# WAFI-138 Staff Ledger & Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a shop owner record staff advances/bonuses/penalties in a running ledger and finalize an immutable month-end settlement per staff member.

**Architecture:** Two new append-only-by-convention tables (`staff_ledger`, `staff_settlements`) following the exact migration/RLS/PowerSync-publication pattern already used by `installment_plans`/`installment_dues` (migration 033). Plain composables (no Pinia store) matching the shape of `useExpenses.ts`/`useInstallmentPlan.ts` — `db.getAll`/`db.getOptional`/`db.execute` for reads and single-statement writes, `db.writeTransaction` for the multi-statement `finalize()` step. A shared `executeFinancialWrite()` wrapper guarantees every mutation writes exactly one audit log row. UI is three Vue views reusing the existing amount/currency-entry component from the expenses feature.

**Tech Stack:** Vue 3 + TypeScript, Pinia (`useSessionStore`, `useDeviceStore` only — no new store), PowerSync-backed local SQLite (`@/data/powersync/db`), Supabase Postgres migrations, Vitest.

## Global Constraints

- `amount_usd` on `staff_ledger` is always `> 0`; direction comes from `entry_type` alone, never from sign (per design spec Data Model).
- `staff_ledger` rows are never UPDATEd or DELETEd — append-only (Invariant 1).
- `finalize()` is the only function ever allowed to set `staff_ledger.settlement_id` (Invariant 2).
- A finalized settlement is immutable; `markPaid()` never recalculates financial values (Invariants 3–4).
- Historical settlements always display `staff_name_snapshot`/`staff_role_snapshot`, never a live join to `staff` (Invariant 5).
- `base_salary_usd` lives only on `staff_settlements`, never as a `staff_ledger` row (Invariant 6).
- Monetary values stored internally in USD; SYP is derived using the row's own `locked_rate`, never a live rate (Invariant 7).
- Only one `finalized`/`paid` settlement per `staff_id` per `period_month`, enforced by a partial unique index, not application logic (Invariant 8).
- Every financial write emits exactly one audit log entry via `executeFinancialWrite()`, never a bare `useAuditLog()` call sprinkled ad hoc (Invariant 9).
- `finalize()` runs inside a single `db.writeTransaction` — all steps commit together or none do (Invariant 10).
- Corrections are new `correction`-typed ledger rows, never edits (Invariant 11).
- Partial application never mutates the original ledger row; it links that row to the settlement as fully consumed and creates a separate `carry_forward` row for the remainder (Invariant 12).
- Reuses `can_view_expenses` (no new permission flag) via the existing `canUserDo`/`permissionsForRole` single source of truth (`src/router/permissions.ts`, `src/features/staff/staff.types.ts`) — every write function checks this internally in addition to router gating.
- Owner-facing UI copy never shows raw enum values — see the label map in the design spec's "UI / Workflow Notes" section.
- `staff_ledger`/`staff_settlements` never write to `cashier_shifts`, `sale_payments`, or any Z-report-feeding table (ripple-effect boundary).
- This feature's write endpoints must not merge to `main` until WAFI-122 (server-side role enforcement) is confirmed shipped — this plan builds the feature; merging is gated separately per the product ticket.

---

### Task 1: Migration — `staff_ledger` and `staff_settlements` tables

**Files:**
- Create: `supabase/migrations/043_staff_ledger.sql`

**Interfaces:**
- Produces: `public.staff_ledger` and `public.staff_settlements` tables, enums `staff_ledger_entry_type`, `staff_ledger_source_type`, `staff_settlement_status`, `staff_settlement_payment_method`, and the partial unique index `staff_settlements_one_finalized_per_period`.

- [ ] **Step 1: Write the migration file**

```sql
-- WAFI-138: Staff Ledger & Settlement (دفع الموظف).
--
-- staff_ledger is an append-only financial ledger: advances, bonuses,
-- penalties, write-offs, corrections, and system-generated carry-forwards.
-- amount_usd is always positive; entry_type alone determines direction
-- (advance/penalty/carry_forward reduce a settlement, bonus increases it,
-- write_off removes an outstanding debt). This avoids the "double negative"
-- bug class where both the sign AND the type encode direction.
--
-- staff_settlements is the immutable month-end snapshot: finalize() is the
-- only writer of staff_ledger.settlement_id, and a finalized settlement is
-- never mutated by later ledger entries (see design spec Invariants).
--
-- See docs/superpowers/specs/2026-07-19-wafi-138-staff-ledger-settlement-design.md

CREATE TYPE public.staff_ledger_entry_type AS ENUM
  ('advance', 'bonus', 'penalty', 'carry_forward', 'write_off', 'correction');

CREATE TYPE public.staff_ledger_source_type AS ENUM ('manual', 'shift', 'settlement');

CREATE TYPE public.staff_settlement_status AS ENUM ('draft', 'finalized', 'paid');

CREATE TYPE public.staff_settlement_payment_method AS ENUM ('cash', 'bank', 'other');

CREATE TABLE IF NOT EXISTS public.staff_settlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL,
  staff_id              uuid NOT NULL REFERENCES public.staff(id),
  settlement_number     text NOT NULL,
  period_month          date NOT NULL,
  status                public.staff_settlement_status NOT NULL DEFAULT 'draft',
  base_salary_usd       numeric(12,2),
  settlement_currency   text CHECK (settlement_currency IN ('usd', 'syp')),
  locked_rate           numeric(12,4),
  applied_amount_usd    numeric(12,2),
  final_amount_usd      numeric(12,2),
  notes                 text,
  staff_name_snapshot   text,
  staff_role_snapshot   text,
  finalized_at          timestamptz,
  paid_at               timestamptz,
  paid_by_staff_id      uuid REFERENCES public.staff(id),
  payment_method        public.staff_settlement_payment_method,
  client_operation_id   uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  sync_status           text,

  CONSTRAINT staff_settlements_client_operation_id_key UNIQUE (client_operation_id),
  CONSTRAINT staff_settlements_rate_currency_check
    CHECK ((locked_rate IS NULL) = (settlement_currency IS NULL OR settlement_currency = 'usd'))
);

-- No blanket UNIQUE on (shop_id, staff_id, period_month) here: a Draft may
-- exist freely per staff+month. Only Finalized/Paid rows are constrained.
CREATE UNIQUE INDEX IF NOT EXISTS staff_settlements_one_finalized_per_period
  ON public.staff_settlements (shop_id, staff_id, period_month)
  WHERE status IN ('finalized', 'paid');

CREATE INDEX IF NOT EXISTS idx_staff_settlements_shop_staff
  ON public.staff_settlements (shop_id, staff_id, period_month DESC);

CREATE TABLE IF NOT EXISTS public.staff_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL,
  staff_id              uuid NOT NULL REFERENCES public.staff(id),
  entry_type            public.staff_ledger_entry_type NOT NULL,
  amount_usd            numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  currency_entered      text NOT NULL CHECK (currency_entered IN ('usd', 'syp')),
  locked_rate           numeric(12,4),
  note                  text,
  source_type           public.staff_ledger_source_type NOT NULL DEFAULT 'manual',
  source_id             uuid,
  created_by_staff_id   uuid NOT NULL REFERENCES public.staff(id),
  client_operation_id   uuid NOT NULL,
  settlement_id         uuid REFERENCES public.staff_settlements(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  sync_status           text,

  CONSTRAINT staff_ledger_client_operation_id_key UNIQUE (client_operation_id),
  CONSTRAINT staff_ledger_rate_currency_check
    CHECK ((locked_rate IS NULL) = (currency_entered = 'usd'))
);

CREATE INDEX IF NOT EXISTS idx_staff_ledger_shop_staff_outstanding
  ON public.staff_ledger (shop_id, staff_id, settlement_id, created_at DESC);

-- RLS — mirrors migration 033's auth_shop_id() scoping. Both tables need
-- UPDATE: staff_ledger.settlement_id is set once by finalize(), and
-- staff_settlements transitions draft -> finalized -> paid.
--
-- NOTE (WAFI-122 dependency): this RLS only scopes by shop_id, matching every
-- other table in this schema today. It does NOT restrict by staff role/
-- permission — that enforcement is WAFI-122's job. Until WAFI-122 ships,
-- can_view_expenses is a CLIENT-SIDE gate only. Do not expose these tables'
-- read/write endpoints to any untrusted client before WAFI-122 is confirmed
-- shipped (see product ticket docs/WAFI-138-139-staff-settlement-revised.md).
ALTER TABLE public.staff_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_ledger      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_settlements_select_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_insert_all ON public.staff_settlements;
DROP POLICY IF EXISTS staff_settlements_update_all ON public.staff_settlements;
CREATE POLICY staff_settlements_select_all ON public.staff_settlements
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_settlements_insert_all ON public.staff_settlements
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_settlements_update_all ON public.staff_settlements
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

DROP POLICY IF EXISTS staff_ledger_select_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_insert_all ON public.staff_ledger;
DROP POLICY IF EXISTS staff_ledger_update_all ON public.staff_ledger;
CREATE POLICY staff_ledger_select_all ON public.staff_ledger
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_ledger_insert_all ON public.staff_ledger
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY staff_ledger_update_all ON public.staff_ledger
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));

-- PowerSync publication (mirrors migration 033's pattern).
DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['staff_settlements', 'staff_ledger']
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

- [ ] **Step 2: Verify the migration applies cleanly**

Run: `npx supabase db reset` (or the project's existing local-migration-check command if `supabase db reset` isn't configured for this repo — check `package.json` for a `db:migrate`/`supabase:reset` script first and prefer that).
Expected: no errors; `staff_ledger` and `staff_settlements` appear in the local schema.

- [ ] **Step 3: Add both tables to the local PowerSync sync rules / schema file**

Find the existing PowerSync schema definition (same place `installment_plans`/`installment_dues` were added when migration 033 shipped — check `src/data/powersync/` for a schema/sync-rules file referencing `installment_plans`) and add `staff_ledger` and `staff_settlements` with the same column list as above, following that file's existing format exactly.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/043_staff_ledger.sql src/data/powersync/
git commit -m "feat(wafi-138): add staff_ledger and staff_settlements migration"
```

---

### Task 2: Domain types

**Files:**
- Create: `src/features/staff-ledger/staff-ledger.types.ts`

**Interfaces:**
- Consumes: `StaffRole` from `@/features/staff/staff.types`.
- Produces: `StaffLedgerEntryType`, `StaffLedgerSourceType`, `StaffSettlementStatus`, `StaffSettlementPaymentMethod`, `StaffLedgerEntry`, `NewStaffLedgerEntry`, `StaffSettlement` — consumed by every composable/component task below.

- [ ] **Step 1: Write the types file**

```typescript
export type StaffLedgerEntryType =
  | 'advance' | 'bonus' | 'penalty' | 'carry_forward' | 'write_off' | 'correction'

export type StaffLedgerSourceType = 'manual' | 'shift' | 'settlement'

export type StaffSettlementStatus = 'draft' | 'finalized' | 'paid'

export type StaffSettlementPaymentMethod = 'cash' | 'bank' | 'other'

/** Plain-language Arabic/English label — the only place raw enum values may
 * leak into copy. UI components must call this, never render entryType raw. */
export function ledgerEntryTypeLabel(type: StaffLedgerEntryType): string {
  switch (type) {
    case 'advance':       return 'سلفة'
    case 'bonus':         return 'مكافأة'
    case 'penalty':       return 'خصم'
    case 'write_off':     return 'إسقاط دين'
    case 'correction':    return 'تصحيح دفعة سابقة'
    case 'carry_forward': return 'الرصيد المتبقي'
  }
}

export interface StaffLedgerEntry {
  id:                string
  shopId:            string
  staffId:           string
  entryType:         StaffLedgerEntryType
  amountUsd:         number
  currencyEntered:   'usd' | 'syp'
  lockedRate:        number | null
  note:              string | null
  sourceType:        StaffLedgerSourceType
  sourceId:          string | null
  createdByStaffId:  string
  clientOperationId: string
  settlementId:      string | null
  createdAt:         string
}

export interface NewStaffLedgerEntry {
  staffId:    string
  entryType:  Exclude<StaffLedgerEntryType, 'carry_forward'> // system-generated only
  amount:     number
  currency:   'usd' | 'syp'
  lockedRate?: number // required when currency = 'syp'
  note?:      string
  sourceType?: StaffLedgerSourceType
  sourceId?:  string
}

export interface StaffSettlement {
  id:                 string
  shopId:             string
  staffId:            string
  settlementNumber:   string
  periodMonth:        string // YYYY-MM-01
  status:             StaffSettlementStatus
  baseSalaryUsd:      number | null
  settlementCurrency: 'usd' | 'syp' | null
  lockedRate:         number | null
  appliedAmountUsd:   number | null
  finalAmountUsd:     number | null
  notes:              string | null
  staffNameSnapshot:  string | null
  staffRoleSnapshot:  string | null
  finalizedAt:        string | null
  paidAt:             string | null
  paidByStaffId:      string | null
  paymentMethod:      StaffSettlementPaymentMethod | null
  clientOperationId:  string
  createdAt:          string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/staff-ledger/staff-ledger.types.ts
git commit -m "feat(wafi-138): add staff ledger/settlement domain types"
```

---

### Task 3: Audit event types + typed audit helpers

**Files:**
- Modify: `src/features/audit/audit.types.ts`
- Modify: `src/features/audit/composables/useAuditLog.ts`

**Interfaces:**
- Produces: `logStaffLedgerEntryCreated`, `logStaffSettlementFinalized`, `logStaffSettlementPaid` — consumed by Task 4's `executeFinancialWrite()`.

- [ ] **Step 1: Add new event/entity types**

In `src/features/audit/audit.types.ts`, add to `AuditEvent`:
```typescript
  | 'staff_ledger.entry_created'
  | 'staff_settlement.finalized'
  | 'staff_settlement.paid'
```
and add `'staff_ledger' | 'staff_settlement'` to `AuditEntityType`.

- [ ] **Step 2: Add typed helpers to `useAuditLog.ts`**

Add near the other typed helpers (after `logInstallmentPlanCancelled`, before the `return` statement):
```typescript
  const logStaffLedgerEntryCreated = (
    entryId: string, staffId: string, entryType: string, amountUsd: number,
  ) => _log('staff_ledger.entry_created', 'staff_ledger', entryId, { staffId, entryType, amountUsd })

  // Sensitive: finalize is irreversible, so a failed audit write must surface.
  const logStaffSettlementFinalized = (
    settlementId: string, staffId: string, periodMonth: string, finalAmountUsd: number,
    currency: string, hasNegativeBalance: boolean,
  ) => _logSensitive('staff_settlement.finalized', 'staff_settlement', settlementId,
        { staffId, periodMonth, finalAmountUsd, currency, hasNegativeBalance })

  const logStaffSettlementPaid = (
    settlementId: string, staffId: string, paymentMethod: string,
  ) => _log('staff_settlement.paid', 'staff_settlement', settlementId, { staffId, paymentMethod })
```
Add all three to the function's final `return { ... }` object.

- [ ] **Step 3: Run existing audit tests to confirm nothing broke**

Run: `npm run test -- useAuditLog`
Expected: PASS (no existing test references the new events, so this only confirms no syntax break).

- [ ] **Step 4: Commit**

```bash
git add src/features/audit/audit.types.ts src/features/audit/composables/useAuditLog.ts
git commit -m "feat(wafi-138): add staff ledger/settlement audit events"
```

---

### Task 4: `executeFinancialWrite()` shared wrapper

**Files:**
- Create: `src/features/staff-ledger/composables/executeFinancialWrite.ts`
- Test: `src/__tests__/features/executeFinancialWrite.test.ts`

**Interfaces:**
- Consumes: `canUserDo` from `@/router/permissions`, `useSessionStore` from `@/store/session.store`.
- Produces: `executeFinancialWrite<T>(write: () => Promise<T>, audit: (result: T) => Promise<void>): Promise<T>` — every mutating function in Tasks 5–8 calls this instead of calling `useAuditLog()` directly.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '@/store/session.store'
import { executeFinancialWrite } from '@/features/staff-ledger/composables/executeFinancialWrite'
import type { Staff } from '@/features/staff/staff.types'

const grantedStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'Ahmed', pinHash: 'x', pinSalt: null,
  role: 'manager',
  permissions: { can_view_reports: false, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: false },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

const cashierStaff: Staff = {
  ...grantedStaff, id: 'staff-2', role: 'cashier',
  permissions: { ...grantedStaff.permissions, can_view_expenses: false },
}

describe('executeFinancialWrite', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('runs the write and audit callback when the active staff has can_view_expenses', async () => {
    useSessionStore().setActiveStaff(grantedStaff)
    const write = vi.fn().mockResolvedValue('result')
    const audit = vi.fn().mockResolvedValue(undefined)

    const result = await executeFinancialWrite(write, audit)

    expect(result).toBe('result')
    expect(write).toHaveBeenCalledOnce()
    expect(audit).toHaveBeenCalledWith('result')
  })

  it('throws and never calls write when the active staff lacks can_view_expenses', async () => {
    useSessionStore().setActiveStaff(cashierStaff)
    const write = vi.fn()
    const audit = vi.fn()

    await expect(executeFinancialWrite(write, audit)).rejects.toThrow(/permission/i)
    expect(write).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('throws when there is no active staff (fail closed)', async () => {
    const write = vi.fn()
    const audit = vi.fn()
    await expect(executeFinancialWrite(write, audit)).rejects.toThrow(/permission/i)
    expect(write).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- executeFinancialWrite`
Expected: FAIL — `Cannot find module '@/features/staff-ledger/composables/executeFinancialWrite'`

- [ ] **Step 3: Write the implementation**

```typescript
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'

/**
 * Every mutating function in the staff-ledger feature calls this instead of
 * writing + auditing separately, so a write can never ship without exactly
 * one audit entry (WAFI-138 Invariant 9), and permission is re-checked here
 * as defense in depth even though the route is already gated (WAFI-058
 * pattern: never trust the router alone).
 */
export async function executeFinancialWrite<T>(
  write: () => Promise<T>,
  audit: (result: T) => Promise<void>,
): Promise<T> {
  const session = useSessionStore()
  if (!canUserDo(session.activeStaff, 'can_view_expenses')) {
    throw new Error('permission denied: can_view_expenses required')
  }
  const result = await write()
  await audit(result)
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- executeFinancialWrite`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/staff-ledger/composables/executeFinancialWrite.ts src/__tests__/features/executeFinancialWrite.test.ts
git commit -m "feat(wafi-138): add executeFinancialWrite shared audit+permission wrapper"
```

---

### Task 5: `useStaffLedger` composable — add + read outstanding entries

**Files:**
- Create: `src/features/staff-ledger/composables/useStaffLedger.ts`
- Test: `src/__tests__/features/useStaffLedger.test.ts`

**Interfaces:**
- Consumes: `executeFinancialWrite` (Task 4), `StaffLedgerEntry`/`NewStaffLedgerEntry` (Task 2), `logStaffLedgerEntryCreated` (Task 3), `db` from `@/data/powersync/db`, `useDeviceStore`, `useSessionStore`.
- Produces: `useStaffLedger()` returning `{ entries: Ref<StaffLedgerEntry[]>, addLedgerEntry, getOutstandingEntries }` — consumed by Task 11's UI.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { db } from '@/data/powersync/db'
import { useSessionStore } from '@/store/session.store'
import { useDeviceStore } from '@/store/device.store'
import type { Staff } from '@/features/staff/staff.types'

const ownerStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'المالك', pinHash: 'x', pinSalt: null, role: 'owner',
  permissions: { can_view_reports: true, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: true },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useStaffLedger.addLedgerEntry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().setActiveStaff(ownerStaff)
    useDeviceStore().shopId = 'shop-1'
  })

  it('inserts a positive-amount USD advance row with no locked_rate', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { addLedgerEntry } = useStaffLedger()
    await addLedgerEntry({ staffId: 'emp-1', entryType: 'advance', amount: 100, currency: 'usd' })

    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('INSERT INTO staff_ledger')
    expect(params).toContain(100)         // amount_usd stored positive
    expect(params).toContain('advance')
    expect(params).toContain('usd')
  })

  it('rejects a negative or zero amount before hitting the DB', async () => {
    const { addLedgerEntry } = useStaffLedger()
    await expect(
      addLedgerEntry({ staffId: 'emp-1', entryType: 'advance', amount: -10, currency: 'usd' }),
    ).rejects.toThrow(/positive/i)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('requires lockedRate when currency is syp', async () => {
    const { addLedgerEntry } = useStaffLedger()
    await expect(
      addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 50000, currency: 'syp' }),
    ).rejects.toThrow(/rate/i)
  })

  it('converts SYP amount to amount_usd using the provided locked rate', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    const { addLedgerEntry } = useStaffLedger()
    await addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 145000, currency: 'syp', lockedRate: 14500 })

    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain(10) // 145000 / 14500
  })
})

describe('useStaffLedger.getOutstandingEntries', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('groups outstanding entries by currency_entered', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: '1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
      { id: '2', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'bonus', amount_usd: 10, currency_entered: 'syp', locked_rate: 14500, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'b', settlement_id: null, created_at: '2026-03-02T00:00:00Z' },
    ] as any)

    const { getOutstandingEntries } = useStaffLedger()
    const result = await getOutstandingEntries('emp-1')

    expect(result.usd).toHaveLength(1)
    expect(result.syp).toHaveLength(1)
    expect(result.usd[0].amountUsd).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- useStaffLedger`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { v4 as uuidv4 } from 'uuid'
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeFinancialWrite } from '@/features/staff-ledger/composables/executeFinancialWrite'
import type { StaffLedgerEntry, NewStaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

type StaffLedgerRow = {
  id: string; shop_id: string; staff_id: string; entry_type: string
  amount_usd: number; currency_entered: 'usd' | 'syp'; locked_rate: number | null
  note: string | null; source_type: string; source_id: string | null
  created_by_staff_id: string; client_operation_id: string
  settlement_id: string | null; created_at: string
}

function rowToEntry(r: StaffLedgerRow): StaffLedgerEntry {
  return {
    id: r.id, shopId: r.shop_id, staffId: r.staff_id,
    entryType: r.entry_type as StaffLedgerEntry['entryType'],
    amountUsd: r.amount_usd, currencyEntered: r.currency_entered,
    lockedRate: r.locked_rate, note: r.note,
    sourceType: r.source_type as StaffLedgerEntry['sourceType'],
    sourceId: r.source_id, createdByStaffId: r.created_by_staff_id,
    clientOperationId: r.client_operation_id, settlementId: r.settlement_id,
    createdAt: r.created_at,
  }
}

export function useStaffLedger() {
  const entries = ref<StaffLedgerEntry[]>([])
  const { logStaffLedgerEntryCreated } = useAuditLog()

  async function addLedgerEntry(input: NewStaffLedgerEntry): Promise<StaffLedgerEntry> {
    if (input.amount <= 0) throw new Error('amount must be positive')
    if (input.currency === 'syp' && !input.lockedRate) {
      throw new Error('lockedRate is required when currency is syp')
    }
    const amountUsd = input.currency === 'syp'
      ? Math.round((input.amount / input.lockedRate!) * 100) / 100
      : input.amount

    return executeFinancialWrite(
      async () => {
        const device = useDeviceStore()
        const session = useSessionStore()
        const id = uuidv4()
        const clientOperationId = uuidv4()
        const now = new Date().toISOString()
        await db.execute(
          `INSERT INTO staff_ledger
             (id, shop_id, staff_id, entry_type, amount_usd, currency_entered, locked_rate,
              note, source_type, source_id, created_by_staff_id, client_operation_id,
              settlement_id, created_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending')`,
          [
            id, device.shopId, input.staffId, input.entryType, amountUsd,
            input.currency, input.currency === 'syp' ? input.lockedRate : null,
            input.note ?? null, input.sourceType ?? 'manual', input.sourceId ?? null,
            session.activeStaff!.id, clientOperationId, now,
          ],
        )
        return rowToEntry({
          id, shop_id: device.shopId, staff_id: input.staffId, entry_type: input.entryType,
          amount_usd: amountUsd, currency_entered: input.currency,
          locked_rate: input.currency === 'syp' ? input.lockedRate! : null,
          note: input.note ?? null, source_type: input.sourceType ?? 'manual',
          source_id: input.sourceId ?? null, created_by_staff_id: session.activeStaff!.id,
          client_operation_id: clientOperationId, settlement_id: null, created_at: now,
        })
      },
      (entry) => logStaffLedgerEntryCreated(entry.id, entry.staffId, entry.entryType, entry.amountUsd),
    )
  }

  async function getOutstandingEntries(staffId: string): Promise<{ usd: StaffLedgerEntry[]; syp: StaffLedgerEntry[] }> {
    const device = useDeviceStore()
    const rows = await db.getAll<StaffLedgerRow>(
      `SELECT * FROM staff_ledger
       WHERE shop_id = ? AND staff_id = ? AND settlement_id IS NULL
       ORDER BY created_at ASC`,
      [device.shopId, staffId],
    )
    const parsed = rows.map(rowToEntry)
    entries.value = parsed
    return {
      usd: parsed.filter(e => e.currencyEntered === 'usd'),
      syp: parsed.filter(e => e.currencyEntered === 'syp'),
    }
  }

  return { entries, addLedgerEntry, getOutstandingEntries }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- useStaffLedger`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/staff-ledger/composables/useStaffLedger.ts src/__tests__/features/useStaffLedger.test.ts
git commit -m "feat(wafi-138): add useStaffLedger addLedgerEntry/getOutstandingEntries"
```

---

### Task 6: `useStaffActivity` composable — POS activity days

**Files:**
- Create: `src/features/staff-ledger/composables/useStaffActivity.ts`
- Test: `src/__tests__/features/useStaffActivity.test.ts`

**Interfaces:**
- Consumes: `db` from `@/data/powersync/db`, `useDeviceStore`.
- Produces: `useStaffActivity()` returning `{ getPosActivityDays(staffId: string, periodMonth: string): Promise<string[]> }` — consumed by Task 12's settlement draft view. Kept separate from `useStaffLedger` per design spec: read-only operational reporting, not ledger logic, so future consumers (e.g. an employee dashboard) don't import ledger code just to count days.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffActivity } from '@/features/staff-ledger/composables/useStaffActivity'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

describe('useStaffActivity.getPosActivityDays', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('queries distinct opened_at dates from cashier_shifts scoped to shop, staff, and month', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{ activity_date: '2026-03-01' }, { activity_date: '2026-03-15' }] as any)

    const { getPosActivityDays } = useStaffActivity()
    const days = await getPosActivityDays('emp-1', '2026-03-01')

    expect(days).toEqual(['2026-03-01', '2026-03-15'])
    const [sql, params] = vi.mocked(db.getAll).mock.calls[0]
    expect(sql).toContain('DISTINCT date(opened_at)')
    expect(sql).toContain('cashier_shifts')
    expect(params).toEqual(['shop-1', 'emp-1', '2026-03-01', '2026-03-31'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- useStaffActivity`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

function lastDayOfMonth(periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  return `${periodMonth.slice(0, 8)}${String(last).padStart(2, '0')}`
}

export function useStaffActivity() {
  async function getPosActivityDays(staffId: string, periodMonth: string): Promise<string[]> {
    const device = useDeviceStore()
    const rows = await db.getAll<{ activity_date: string }>(
      `SELECT DISTINCT date(opened_at) AS activity_date
       FROM cashier_shifts
       WHERE shop_id = ? AND staff_id = ? AND date(opened_at) BETWEEN ? AND ?
       ORDER BY activity_date ASC`,
      [device.shopId, staffId, periodMonth, lastDayOfMonth(periodMonth)],
    )
    return rows.map(r => r.activity_date)
  }

  return { getPosActivityDays }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- useStaffActivity`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/staff-ledger/composables/useStaffActivity.ts src/__tests__/features/useStaffActivity.test.ts
git commit -m "feat(wafi-138): add useStaffActivity POS activity days query"
```

---

### Task 7: `useStaffSettlement` — `createDraft` + `applyLedgerEntry`

**Files:**
- Create: `src/features/staff-ledger/composables/useStaffSettlement.ts`
- Test: `src/__tests__/features/useStaffSettlement.test.ts`

**Interfaces:**
- Consumes: `StaffSettlement` (Task 2), `db`, `useDeviceStore`.
- Produces: `useStaffSettlement()` returning (this task) `{ createDraft, applyLedgerEntry }`; Tasks 8–9 add `finalize`/`markPaid` to the same file and export.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

describe('useStaffSettlement.createDraft', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('creates a new draft and returns resumed: false when none exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { createDraft } = useStaffSettlement()
    const { settlement, resumed } = await createDraft('emp-1', '2026-03-01')

    expect(resumed).toBe(false)
    expect(settlement.status).toBe('draft')
    expect(settlement.periodMonth).toBe('2026-03-01')
  })

  it('returns the existing draft and resumed: true when one already exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null,
      settlement_currency: null, locked_rate: null, applied_amount_usd: null,
      final_amount_usd: null, notes: null, staff_name_snapshot: null, staff_role_snapshot: null,
      finalized_at: null, paid_at: null, paid_by_staff_id: null, payment_method: null,
      client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { createDraft } = useStaffSettlement()
    const { settlement, resumed } = await createDraft('emp-1', '2026-03-01')

    expect(resumed).toBe(true)
    expect(settlement.id).toBe('settle-1')
    expect(db.execute).not.toHaveBeenCalled()
  })
})

describe('useStaffSettlement.applyLedgerEntry', () => {
  it('rejects an apply amount greater than the entry remaining amount', async () => {
    const { applyLedgerEntry } = useStaffSettlement()
    const entry = { id: 'l-1', amountUsd: 100 } as any
    expect(() => applyLedgerEntry(entry, 150)).toThrow(/exceeds/i)
  })

  it('returns the applied portion and the carry-forward remainder for a partial apply', () => {
    const { applyLedgerEntry } = useStaffSettlement()
    const entry = { id: 'l-1', amountUsd: 100 } as any
    const result = applyLedgerEntry(entry, 70)
    expect(result.appliedAmountUsd).toBe(70)
    expect(result.carryForwardAmountUsd).toBe(30)
  })

  it('produces zero carry-forward for a full apply', () => {
    const { applyLedgerEntry } = useStaffSettlement()
    const entry = { id: 'l-1', amountUsd: 100 } as any
    const result = applyLedgerEntry(entry, 100)
    expect(result.carryForwardAmountUsd).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- useStaffSettlement`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { StaffSettlement, StaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

type StaffSettlementRow = {
  id: string; shop_id: string; staff_id: string; settlement_number: string
  period_month: string; status: string; base_salary_usd: number | null
  settlement_currency: 'usd' | 'syp' | null; locked_rate: number | null
  applied_amount_usd: number | null; final_amount_usd: number | null
  notes: string | null; staff_name_snapshot: string | null; staff_role_snapshot: string | null
  finalized_at: string | null; paid_at: string | null; paid_by_staff_id: string | null
  payment_method: string | null; client_operation_id: string; created_at: string
}

function rowToSettlement(r: StaffSettlementRow): StaffSettlement {
  return {
    id: r.id, shopId: r.shop_id, staffId: r.staff_id, settlementNumber: r.settlement_number,
    periodMonth: r.period_month, status: r.status as StaffSettlement['status'],
    baseSalaryUsd: r.base_salary_usd, settlementCurrency: r.settlement_currency,
    lockedRate: r.locked_rate, appliedAmountUsd: r.applied_amount_usd,
    finalAmountUsd: r.final_amount_usd, notes: r.notes,
    staffNameSnapshot: r.staff_name_snapshot, staffRoleSnapshot: r.staff_role_snapshot,
    finalizedAt: r.finalized_at, paidAt: r.paid_at, paidByStaffId: r.paid_by_staff_id,
    paymentMethod: r.payment_method as StaffSettlement['paymentMethod'],
    clientOperationId: r.client_operation_id, createdAt: r.created_at,
  }
}

export function useStaffSettlement() {
  async function createDraft(
    staffId: string, periodMonth: string,
  ): Promise<{ settlement: StaffSettlement; resumed: boolean }> {
    const device = useDeviceStore()
    const existing = await db.getOptional<StaffSettlementRow>(
      `SELECT * FROM staff_settlements WHERE shop_id = ? AND staff_id = ? AND period_month = ? AND status = 'draft'`,
      [device.shopId, staffId, periodMonth],
    )
    if (existing) return { settlement: rowToSettlement(existing), resumed: true }

    const id = uuidv4()
    const clientOperationId = uuidv4()
    const now = new Date().toISOString()
    // Settlement number: {YYYYMM}-{last 6 chars of id, uppercased} — a display
    // convenience, not a uniqueness key (period_month + staff_id is), so a rare
    // collision is cosmetic only.
    const settlementNumber = `${periodMonth.slice(0, 7).replace('-', '')}-${id.slice(-6).toUpperCase()}`

    await db.execute(
      `INSERT INTO staff_settlements
         (id, shop_id, staff_id, settlement_number, period_month, status, client_operation_id, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 'pending')`,
      [id, device.shopId, staffId, settlementNumber, periodMonth, clientOperationId, now],
    )

    return {
      settlement: rowToSettlement({
        id, shop_id: device.shopId, staff_id: staffId, settlement_number: settlementNumber,
        period_month: periodMonth, status: 'draft', base_salary_usd: null,
        settlement_currency: null, locked_rate: null, applied_amount_usd: null,
        final_amount_usd: null, notes: null, staff_name_snapshot: null, staff_role_snapshot: null,
        finalized_at: null, paid_at: null, paid_by_staff_id: null, payment_method: null,
        client_operation_id: clientOperationId, created_at: now,
      }),
      resumed: false,
    }
  }

  /**
   * Pure calculation, no DB access — the UI calls this on every toggle/amount
   * edit to show the running total before Finalize. finalize() (Task 8)
   * re-validates and re-applies this same math against fresh data server-side,
   * since UI-computed state must never be trusted at commit time.
   */
  function applyLedgerEntry(
    entry: StaffLedgerEntry,
    applyAmountUsd: number,
  ): { appliedAmountUsd: number; carryForwardAmountUsd: number } {
    if (applyAmountUsd > entry.amountUsd) {
      throw new Error(`apply amount ${applyAmountUsd} exceeds entry remaining amount ${entry.amountUsd}`)
    }
    return {
      appliedAmountUsd: applyAmountUsd,
      carryForwardAmountUsd: Math.round((entry.amountUsd - applyAmountUsd) * 100) / 100,
    }
  }

  return { createDraft, applyLedgerEntry }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- useStaffSettlement`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/staff-ledger/composables/useStaffSettlement.ts src/__tests__/features/useStaffSettlement.test.ts
git commit -m "feat(wafi-138): add useStaffSettlement createDraft/applyLedgerEntry"
```

---

### Task 8: `useStaffSettlement` — `finalize()`

**Files:**
- Modify: `src/features/staff-ledger/composables/useStaffSettlement.ts`
- Modify: `src/__tests__/features/useStaffSettlement.test.ts`

**Interfaces:**
- Consumes: `db.writeTransaction`, `executeFinancialWrite` (Task 4), `logStaffSettlementFinalized` (Task 3), `useSessionStore`, `applyLedgerEntry` (Task 7, reused internally for re-validation).
- Produces: `finalize(settlementId, staffId, options): Promise<StaffSettlement>` — added to the same composable's return object, consumed by Task 12's UI and Task 9's `markPaid`.

- [ ] **Step 1: Write the failing tests** (append to the existing test file)

```typescript
describe('useStaffSettlement.finalize', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    const session = useSessionStore()
    session.setActiveStaff({
      id: 'staff-1', shopId: 'shop-1', name: 'المالك', pinHash: 'x', pinSalt: null, role: 'owner',
      permissions: { can_view_reports: true, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: true },
      isActive: true, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('runs all writes inside a single db.writeTransaction', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null, settlement_currency: null,
      locked_rate: null, applied_amount_usd: null, final_amount_usd: null, notes: null,
      staff_name_snapshot: null, staff_role_snapshot: null, finalized_at: null, paid_at: null,
      paid_by_staff_id: null, payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { finalize } = useStaffSettlement()
    await finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: 'Paid early for Eid',
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 70 }],
    })

    expect(db.writeTransaction).toHaveBeenCalledOnce()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes("INSERT INTO staff_ledger") && sql.includes('carry_forward'))).toBe(true)
    expect(calls.some(sql => sql.includes('UPDATE staff_ledger') && sql.includes('settlement_id'))).toBe(true)
    expect(calls.some(sql => sql.includes("UPDATE staff_settlements") && sql.includes("'finalized'"))).toBe(true)
  })

  it('allows a negative final_amount_usd when advances exceed base salary', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 450, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null, settlement_currency: null,
      locked_rate: null, applied_amount_usd: null, final_amount_usd: null, notes: null,
      staff_name_snapshot: null, staff_role_snapshot: null, finalized_at: null, paid_at: null,
      paid_by_staff_id: null, payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { finalize } = useStaffSettlement()
    const settlement = await finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: null,
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 450 }],
    })

    expect(settlement.finalAmountUsd).toBe(-150) // 300 - 450
  })

  it('throws and rolls back if a re-read applied amount now exceeds the ledger row\'s remaining amount', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 50, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null, settlement_currency: null,
      locked_rate: null, applied_amount_usd: null, final_amount_usd: null, notes: null,
      staff_name_snapshot: null, staff_role_snapshot: null, finalized_at: null, paid_at: null,
      paid_by_staff_id: null, payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { finalize } = useStaffSettlement()
    await expect(finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: null,
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 100 }], // > 50 remaining
    })).rejects.toThrow(/exceeds/i)
    expect(db.writeTransaction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- useStaffSettlement`
Expected: FAIL — `finalize is not a function`

- [ ] **Step 3: Write the implementation** (add to the same file, alongside `createDraft`/`applyLedgerEntry`, and add to the final `return`)

```typescript
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeFinancialWrite } from '@/features/staff-ledger/composables/executeFinancialWrite'

// (inside useStaffSettlement(), alongside createDraft/applyLedgerEntry)

const { logStaffSettlementFinalized } = useAuditLog()

interface FinalizeOptions {
  settlementCurrency: 'usd' | 'syp'
  baseSalaryUsd: number
  notes: string | null
  applications: Array<{ ledgerEntryId: string; applyAmountUsd: number }>
  settlementRate?: number // required if settlementCurrency = 'syp'
}

async function finalize(
  settlementId: string,
  staffId: string,
  options: FinalizeOptions,
): Promise<StaffSettlement> {
  const device = useDeviceStore()
  const session = useSessionStore()

  // Step 1: lock exchange rate (already provided by caller for syp; usd needs none).
  const lockedRate = options.settlementCurrency === 'syp' ? options.settlementRate! : null

  // Step 2: re-read outstanding ledger fresh — never trust UI-held state at commit time.
  const outstandingRows = await db.getAll<StaffLedgerRowLocal>(
    `SELECT * FROM staff_ledger WHERE shop_id = ? AND staff_id = ? AND settlement_id IS NULL`,
    [device.shopId, staffId],
  )
  const byId = new Map(outstandingRows.map(r => [r.id, r]))

  // Step 3: re-validate every applied amount <= remaining (defense in depth;
  // the UI already checked this via applyLedgerEntry()).
  const plannedCarryForwards: Array<{ sourceId: string; amountUsd: number }> = []
  let appliedTotalUsd = 0
  for (const app of options.applications) {
    const row = byId.get(app.ledgerEntryId)
    if (!row) throw new Error(`ledger entry ${app.ledgerEntryId} not found or already consumed`)
    if (app.applyAmountUsd > row.amount_usd) {
      throw new Error(`apply amount ${app.applyAmountUsd} exceeds entry remaining amount ${row.amount_usd}`)
    }
    const direction = row.entry_type === 'bonus' ? 1 : -1
    appliedTotalUsd += direction * app.applyAmountUsd
    const remainder = Math.round((row.amount_usd - app.applyAmountUsd) * 100) / 100
    if (remainder > 0) plannedCarryForwards.push({ sourceId: row.id, amountUsd: remainder })
  }
  const finalAmountUsd = Math.round((options.baseSalaryUsd + appliedTotalUsd) * 100) / 100

  const staffRow = await db.getOptional<{ name: string; role: string }>(
    `SELECT name, role FROM staff WHERE id = ?`, [staffId],
  )

  const settlement = await executeFinancialWrite(
    async () => {
      const now = new Date().toISOString()
      // Steps 4-6: create carry-forward rows, attach settlement_id, write snapshot —
      // all inside one transaction (Invariant 10).
      await db.writeTransaction(async (tx) => {
        for (const app of options.applications) {
          await tx.execute(
            `UPDATE staff_ledger SET settlement_id = ? WHERE id = ?`,
            [settlementId, app.ledgerEntryId],
          )
        }
        for (const cf of plannedCarryForwards) {
          await tx.execute(
            `INSERT INTO staff_ledger
               (id, shop_id, staff_id, entry_type, amount_usd, currency_entered, locked_rate,
                note, source_type, source_id, created_by_staff_id, client_operation_id,
                settlement_id, created_at, sync_status)
             VALUES (?, ?, ?, 'carry_forward', ?, 'usd', NULL, ?, 'settlement', ?, ?, ?, NULL, ?, 'pending')`,
            [
              uuidv4(), device.shopId, staffId, cf.amountUsd,
              `Carry-forward from ${cf.sourceId}`, cf.sourceId,
              session.activeStaff!.id, uuidv4(), now,
            ],
          )
        }
        await tx.execute(
          `UPDATE staff_settlements
           SET status = 'finalized', base_salary_usd = ?, settlement_currency = ?, locked_rate = ?,
               applied_amount_usd = ?, final_amount_usd = ?, notes = ?,
               staff_name_snapshot = ?, staff_role_snapshot = ?, finalized_at = ?
           WHERE id = ?`,
          [
            options.baseSalaryUsd, options.settlementCurrency, lockedRate,
            appliedTotalUsd, finalAmountUsd, options.notes,
            staffRow?.name ?? null, staffRow?.role ?? null, now, settlementId,
          ],
        )
      })
      return { finalAmountUsd, now }
    },
    ({ finalAmountUsd }) => logStaffSettlementFinalized(
      settlementId, staffId, '', finalAmountUsd, options.settlementCurrency, finalAmountUsd < 0,
    ),
  )

  const row = await db.getOptional<StaffSettlementRow>(
    `SELECT * FROM staff_settlements WHERE id = ?`, [settlementId],
  )
  return rowToSettlement(row!)
}
```
Add `type StaffLedgerRowLocal = { id: string; entry_type: string; amount_usd: number }` near the top of the file (a minimal local row shape for this query — reuse the full `StaffLedgerRow` type from Task 5 if importing it is cleaner: `import type { StaffLedgerEntry } from ...` is not needed here since we only read raw columns). Add `finalize` to the composable's `return { createDraft, applyLedgerEntry, finalize }`.

**On the unique-constraint-violation conflict case** (per the Offline Conflict Strategy in the design spec): if `db.writeTransaction` rejects because another device already finalized this staff+period (the partial unique index fires), the caller (Task 12's UI) catches the rejection, reloads the settlement via `db.getOptional`, and shows "This settlement was already finalized" — no retry-merge logic in this composable itself.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- useStaffSettlement`
Expected: PASS (8 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/features/staff-ledger/composables/useStaffSettlement.ts src/__tests__/features/useStaffSettlement.test.ts
git commit -m "feat(wafi-138): add useStaffSettlement finalize with transactional carry-forward"
```

---

### Task 9: `useStaffSettlement` — `markPaid()`

**Files:**
- Modify: `src/features/staff-ledger/composables/useStaffSettlement.ts`
- Modify: `src/__tests__/features/useStaffSettlement.test.ts`

**Interfaces:**
- Consumes: `executeFinancialWrite`, `logStaffSettlementPaid` (Task 3).
- Produces: `markPaid(settlementId, options): Promise<StaffSettlement>` — added to the same composable's return.

- [ ] **Step 1: Write the failing test**

```typescript
describe('useStaffSettlement.markPaid', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    useSessionStore().setActiveStaff({
      id: 'staff-1', shopId: 'shop-1', name: 'المالك', pinHash: 'x', pinSalt: null, role: 'owner',
      permissions: { can_view_reports: true, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: true },
      isActive: true, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('sets paid_at/paid_by/payment_method and status without touching amount columns', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'paid', base_salary_usd: 300, settlement_currency: 'usd',
      locked_rate: null, applied_amount_usd: -70, final_amount_usd: 230, notes: null,
      staff_name_snapshot: 'Ahmed', staff_role_snapshot: 'cashier', finalized_at: '2026-03-31T00:00:00Z',
      paid_at: '2026-04-01T00:00:00Z', paid_by_staff_id: 'staff-1', payment_method: 'cash',
      client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { markPaid } = useStaffSettlement()
    const result = await markPaid('settle-1', 'emp-1', { paymentMethod: 'cash' })

    expect(result.status).toBe('paid')
    expect(result.finalAmountUsd).toBe(230) // unchanged from finalize
    const [sql] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).not.toMatch(/final_amount_usd\s*=/) // never recalculates
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- useStaffSettlement`
Expected: FAIL — `markPaid is not a function`

- [ ] **Step 3: Write the implementation** (add to the same file/return)

```typescript
// Task 8 already added `const { logStaffSettlementFinalized } = useAuditLog()` near
// the top of useStaffSettlement(). Extend that same destructuring line to:
// const { logStaffSettlementFinalized, logStaffSettlementPaid } = useAuditLog()

async function markPaid(
  settlementId: string,
  staffId: string,
  options: { paymentMethod: 'cash' | 'bank' | 'other' },
): Promise<StaffSettlement> {
  const session = useSessionStore()
  await executeFinancialWrite(
    async () => {
      const now = new Date().toISOString()
      await db.execute(
        `UPDATE staff_settlements SET status = 'paid', paid_at = ?, paid_by_staff_id = ?, payment_method = ? WHERE id = ?`,
        [now, session.activeStaff!.id, options.paymentMethod, settlementId],
      )
    },
    () => logStaffSettlementPaid(settlementId, staffId, options.paymentMethod),
  )
  const row = await db.getOptional<StaffSettlementRow>(
    `SELECT * FROM staff_settlements WHERE id = ?`, [settlementId],
  )
  return rowToSettlement(row!)
}
```
Add `markPaid` to the composable's final `return { createDraft, applyLedgerEntry, finalize, markPaid }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- useStaffSettlement`
Expected: PASS (9 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/features/staff-ledger/composables/useStaffSettlement.ts src/__tests__/features/useStaffSettlement.test.ts
git commit -m "feat(wafi-138): add useStaffSettlement markPaid"
```

---

### Task 10: Crash-recovery and permission tests

**Files:**
- Modify: `src/__tests__/features/useStaffSettlement.test.ts`
- Create: `src/__tests__/features/useStaffSettlement.permissions.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4, 7, 8.

- [ ] **Step 1: Write the crash-recovery test** (append to `useStaffSettlement.test.ts`)

```typescript
describe('useStaffSettlement.finalize crash recovery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    useSessionStore().setActiveStaff({
      id: 'staff-1', shopId: 'shop-1', name: 'المالك', pinHash: 'x', pinSalt: null, role: 'owner',
      permissions: { can_view_reports: true, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: true },
      isActive: true, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('leaves no settlement_id assigned and no settlement snapshot written if the transaction rejects mid-way', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(null) // simulated: staff lookup happens before writeTransaction
      .mockResolvedValueOnce(null) // post-crash reload: settlement never got its snapshot written
    // Simulate the transaction throwing partway through (e.g. app killed after
    // the first tx.execute) — writeTransaction's real implementation guarantees
    // this means NONE of the statements inside it took effect.
    vi.mocked(db.writeTransaction).mockRejectedValueOnce(new Error('simulated crash mid-transaction'))

    const { finalize } = useStaffSettlement()
    await expect(finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: null,
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 70 }],
    })).rejects.toThrow(/crash/i)

    // Re-querying the settlement after the "crash" must show it still draft/nonexistent,
    // never a half-written finalized row — this is PowerSync's writeTransaction contract,
    // asserted here so a future refactor that splits finalize() across two transactions
    // would break this test rather than silently violating Invariant 10.
    const row = await db.getOptional('SELECT * FROM staff_settlements WHERE id = ?', ['settle-1'])
    expect(row).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test -- useStaffSettlement`
Expected: PASS — confirms `finalize()` performs zero writes outside `db.writeTransaction`'s callback (if it did, this test's mocked rejection wouldn't roll them back and a stray `db.execute` mock call would show up).

- [ ] **Step 3: Write the permission tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { useSessionStore } from '@/store/session.store'
import { useDeviceStore } from '@/store/device.store'
import { db } from '@/data/powersync/db'
import type { Staff } from '@/features/staff/staff.types'

function staffWith(role: Staff['role'], canViewExpenses: boolean): Staff {
  return {
    id: `staff-${role}`, shopId: 'shop-1', name: role, pinHash: 'x', pinSalt: null, role,
    permissions: { can_view_reports: false, can_manage_products: true, can_manage_customers: true, can_view_expenses: canViewExpenses, can_manage_settings: false },
    isActive: true, createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('staff ledger write permission gating (defense in depth)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('owner can add a ledger entry', async () => {
    useSessionStore().setActiveStaff(staffWith('owner', false)) // owner ignores the flag, always true
    const { addLedgerEntry } = useStaffLedger()
    await expect(addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 10, currency: 'usd' })).resolves.toBeDefined()
  })

  it('manager with can_view_expenses granted can add a ledger entry', async () => {
    useSessionStore().setActiveStaff(staffWith('manager', true))
    const { addLedgerEntry } = useStaffLedger()
    await expect(addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 10, currency: 'usd' })).resolves.toBeDefined()
  })

  it('cashier cannot add a ledger entry, even with a direct composable call bypassing the router', async () => {
    useSessionStore().setActiveStaff(staffWith('cashier', false))
    const { addLedgerEntry } = useStaffLedger()
    await expect(addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 10, currency: 'usd' })).rejects.toThrow(/permission/i)
    expect(db.execute).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- useStaffSettlement.permissions`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/features/useStaffSettlement.test.ts src/__tests__/features/useStaffSettlement.permissions.test.ts
git commit -m "test(wafi-138): add crash-recovery and permission-gating tests"
```

---

### Task 11: Snapshot-integrity test

**Files:**
- Create: `src/__tests__/features/staffSettlementSnapshot.test.ts`

**Interfaces:**
- Consumes: nothing new — a pure read-path test against `rowToSettlement`-shaped data, verifying the UI-facing type never re-derives name/role from a live `staff` row.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest'
import type { StaffSettlement } from '@/features/staff-ledger/staff-ledger.types'

describe('staff settlement name/role snapshot integrity', () => {
  it('a finalized settlement retains its original staff_name_snapshot regardless of the staff table changing later', () => {
    // Simulates: settlement finalized in March as "Ahmed", staff renamed to
    // "Ahmed Hassan" in June. The settlement object itself must never carry
    // a live-joined name — only what was captured at finalize() time.
    const marchSettlement: StaffSettlement = {
      id: 'settle-1', shopId: 'shop-1', staffId: 'emp-1', settlementNumber: '202603-ABCDEF',
      periodMonth: '2026-03-01', status: 'finalized', baseSalaryUsd: 300,
      settlementCurrency: 'usd', lockedRate: null, appliedAmountUsd: -70, finalAmountUsd: 230,
      notes: null, staffNameSnapshot: 'Ahmed', staffRoleSnapshot: 'cashier',
      finalizedAt: '2026-03-31T00:00:00Z', paidAt: null, paidByStaffId: null, paymentMethod: null,
      clientOperationId: 'op-1', createdAt: '2026-03-01T00:00:00Z',
    }

    // The staff record changing later (simulated as a separate, unrelated object)
    // must have zero effect on the already-finalized settlement's snapshot fields.
    const staffRecordInJune = { id: 'emp-1', name: 'Ahmed Hassan', role: 'manager' }

    expect(marchSettlement.staffNameSnapshot).toBe('Ahmed')
    expect(marchSettlement.staffNameSnapshot).not.toBe(staffRecordInJune.name)
    expect(marchSettlement.staffRoleSnapshot).toBe('cashier')
    expect(marchSettlement.staffRoleSnapshot).not.toBe(staffRecordInJune.role)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test -- staffSettlementSnapshot`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/features/staffSettlementSnapshot.test.ts
git commit -m "test(wafi-138): add settlement name/role snapshot integrity test"
```

---

### Task 12: ADR for the carry-forward ledger-row decision

**Files:**
- Create: `docs/adr/ADR-008-carry-forward-ledger-row.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Check the existing ADR template/format**

Read `docs/adr/ADR-007-auth-mechanism-and-atomic-provisioning.md` for the exact section headings this repo's ADRs use, and match that structure exactly (likely Status/Context/Decision/Consequences — confirm from the file rather than assuming).

- [ ] **Step 2: Write the ADR**, following the confirmed template, covering:
- **Context:** partial ledger application needs to leave an auditable remainder without mutating the original entry.
- **Decision:** the original row is linked to the settlement as fully consumed (`settlement_id` set); a new `carry_forward`-typed row is created for the unapplied remainder. Chosen over a normalized "applied amount" event model for v1 query simplicity.
- **Consequences:** a ledger row's `amount_usd` alone doesn't tell you how much of it was actually collected without cross-referencing any resulting carry-forward row via `source_id`. Future engineers must not "fix" this into a derived-balance model without a major version bump (per the design spec and product ticket).
- Link to `docs/superpowers/specs/2026-07-19-wafi-138-staff-ledger-settlement-design.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/ADR-008-carry-forward-ledger-row.md
git commit -m "docs(wafi-138): add ADR for carry-forward ledger row decision"
```

---

### Task 13: `StaffLedgerView.vue` — ledger list + add sheet

**Files:**
- Create: `src/features/staff-ledger/views/StaffLedgerView.vue`
- Test: `src/features/staff-ledger/views/__tests__/StaffLedgerView.test.ts`

**Interfaces:**
- Consumes: `useStaffLedger` (Task 5), `ledgerEntryTypeLabel` (Task 2). Reuses the existing amount/currency-entry component pattern — locate it first via the expenses feature (check `src/features/expenses/components/` for the exact component name used for amount+currency entry, e.g. an `AmountCurrencyInput.vue` or inline pattern) and reuse it rather than building a new one.

- [ ] **Step 1: Locate the existing amount/currency-entry component**

Run: `grep -rl "amount.*currency\|AmountInput\|CurrencyToggle" src/features/expenses/components/` and read whichever file matches to confirm its exact prop names before writing this view.

- [ ] **Step 2: Write the failing component test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import StaffLedgerView from '@/features/staff-ledger/views/StaffLedgerView.vue'
import { db } from '@/data/powersync/db'

describe('StaffLedgerView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows the empty state when there are no outstanding entries', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const wrapper = mount(StaffLedgerView, { props: { staffId: 'emp-1' } })
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('لا توجد حركات مالية') // "No outstanding entries."
  })

  it('renders plain-language labels, never raw entry_type strings', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: '1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    const wrapper = mount(StaffLedgerView, { props: { staffId: 'emp-1' } })
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('سلفة') // "Advance" label
    expect(wrapper.text()).not.toContain('advance') // never the raw enum
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- StaffLedgerView`
Expected: FAIL — component not found.

- [ ] **Step 4: Write the component**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { ledgerEntryTypeLabel, type StaffLedgerEntryType } from '@/features/staff-ledger/staff-ledger.types'

const props = defineProps<{ staffId: string }>()

const { getOutstandingEntries } = useStaffLedger()
const usdEntries = ref<Awaited<ReturnType<typeof getOutstandingEntries>>['usd']>([])
const sypEntries = ref<Awaited<ReturnType<typeof getOutstandingEntries>>['syp']>([])
const showAddSheet = ref(false)
const addEntryType = ref<Exclude<StaffLedgerEntryType, 'carry_forward'>>('advance')

async function reload() {
  const { usd, syp } = await getOutstandingEntries(props.staffId)
  usdEntries.value = usd
  sypEntries.value = syp
}

onMounted(reload)

defineExpose({ reload })
</script>

<template>
  <div dir="rtl">
    <div v-if="!usdEntries.length && !sypEntries.length" class="empty-state">
      لا توجد حركات مالية
    </div>
    <template v-else>
      <section v-if="usdEntries.length">
        <h3>بالدولار</h3>
        <ul>
          <li v-for="entry in usdEntries" :key="entry.id">
            {{ ledgerEntryTypeLabel(entry.entryType) }} — ${{ entry.amountUsd.toFixed(2) }}
          </li>
        </ul>
      </section>
      <section v-if="sypEntries.length">
        <h3>بالليرة السورية</h3>
        <ul>
          <li v-for="entry in sypEntries" :key="entry.id">
            {{ ledgerEntryTypeLabel(entry.entryType) }} — {{ (entry.amountUsd * (entry.lockedRate ?? 1)).toLocaleString() }} ل.س
          </li>
        </ul>
      </section>
    </template>
    <button @click="showAddSheet = true">+ إضافة</button>
    <!-- Add sheet: reuses the expenses feature's amount/currency-entry component
         (exact import confirmed in Step 1) with a type selector limited to
         advance/bonus/penalty/write_off/correction (never carry_forward). -->
  </div>
</template>
```
Fill in the add-sheet markup using the exact component located in Step 1 — do not invent a new amount/currency input.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- StaffLedgerView`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/staff-ledger/views/StaffLedgerView.vue src/features/staff-ledger/views/__tests__/StaffLedgerView.test.ts
git commit -m "feat(wafi-138): add StaffLedgerView with plain-language labels"
```

---

### Task 14: `SettlementDraftView.vue` and `SettlementDetailView.vue`

**Files:**
- Create: `src/features/staff-ledger/views/SettlementDraftView.vue`
- Create: `src/features/staff-ledger/views/SettlementDetailView.vue`
- Test: `src/features/staff-ledger/views/__tests__/SettlementDraftView.test.ts`

**Interfaces:**
- Consumes: `useStaffSettlement` (Tasks 7–9), `useStaffLedger.getOutstandingEntries` (Task 5), `useStaffActivity.getPosActivityDays` (Task 6).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import SettlementDraftView from '@/features/staff-ledger/views/SettlementDraftView.vue'
import { db } from '@/data/powersync/db'

describe('SettlementDraftView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('shows the empty state when there are no ledger movements for the month', async () => {
    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('لا توجد حركات مالية لهذا الشهر')
  })

  it('disables the Finalize button until a settlement currency is chosen', async () => {
    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    const finalizeBtn = wrapper.find('[data-testid="finalize-button"]')
    expect(finalizeBtn.attributes('disabled')).toBeDefined()
  })

  it('shows a confirmation dialog before calling finalize', async () => {
    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.find('[data-testid="currency-usd"]').trigger('click')
    await wrapper.find('[data-testid="finalize-button"]').trigger('click')
    expect(wrapper.text()).toContain('لا يمكن التعديل عليها لاحقاً') // "cannot be edited later"
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- SettlementDraftView`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `SettlementDraftView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'
import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { useStaffActivity } from '@/features/staff-ledger/composables/useStaffActivity'
import { ledgerEntryTypeLabel } from '@/features/staff-ledger/staff-ledger.types'
import type { StaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

const props = defineProps<{ staffId: string; periodMonth: string }>()

const { createDraft, applyLedgerEntry, finalize } = useStaffSettlement()
const { getOutstandingEntries } = useStaffLedger()
const { getPosActivityDays } = useStaffActivity()

const settlementId = ref<string | null>(null)
const resumedNotice = ref(false)
const usdEntries = ref<StaffLedgerEntry[]>([])
const sypEntries = ref<StaffLedgerEntry[]>([])
const activityDays = ref<string[]>([])
const applied = ref<Record<string, number>>({}) // ledgerEntryId -> applyAmountUsd
const settlementCurrency = ref<'usd' | 'syp' | null>(null)
const baseSalaryUsd = ref<number | null>(null)
const notes = ref('')
const showFinalizeConfirm = ref(false)
const alreadyFinalizedNotice = ref(false)

onMounted(async () => {
  const { settlement, resumed } = await createDraft(props.staffId, props.periodMonth)
  settlementId.value = settlement.id
  resumedNotice.value = resumed
  const { usd, syp } = await getOutstandingEntries(props.staffId)
  usdEntries.value = usd
  sypEntries.value = syp
  activityDays.value = await getPosActivityDays(props.staffId, props.periodMonth)
})

const canFinalize = computed(() => settlementCurrency.value !== null)

function toggleApply(entry: StaffLedgerEntry, amount: number) {
  applyLedgerEntry(entry, amount) // throws if amount exceeds remaining — surfaced to the user by the caller
  applied.value[entry.id] = amount
}

async function onConfirmFinalize() {
  try {
    await finalize(settlementId.value!, props.staffId, {
      settlementCurrency: settlementCurrency.value!,
      baseSalaryUsd: baseSalaryUsd.value ?? 0,
      notes: notes.value || null,
      applications: Object.entries(applied.value).map(([ledgerEntryId, applyAmountUsd]) => ({ ledgerEntryId, applyAmountUsd })),
    })
    showFinalizeConfirm.value = false
  } catch (err) {
    // Offline Conflict Strategy: a unique-constraint violation means another
    // device already finalized this staff+month first. Surface, don't retry-merge.
    alreadyFinalizedNotice.value = true
    showFinalizeConfirm.value = false
  }
}
</script>

<template>
  <div dir="rtl">
    <p v-if="resumedNotice">استئناف المسودة الحالية لهذا الشهر</p>
    <p v-if="alreadyFinalizedNotice">تم إغلاق هذه التسوية بالفعل على جهاز آخر</p>

    <div v-if="!usdEntries.length && !sypEntries.length && !activityDays.length" class="empty-state">
      لا توجد حركات مالية لهذا الشهر
    </div>

    <template v-else>
      <ul>
        <li v-for="entry in [...usdEntries, ...sypEntries]" :key="entry.id">
          {{ ledgerEntryTypeLabel(entry.entryType) }} — ${{ entry.amountUsd.toFixed(2) }}
          <input
            type="number" :max="entry.amountUsd"
            @change="e => toggleApply(entry, Number((e.target as HTMLInputElement).value))"
          />
        </li>
      </ul>
    </template>

    <label>الراتب الأساسي <input type="number" v-model.number="baseSalaryUsd" /></label>
    <div>
      <button data-testid="currency-usd" @click="settlementCurrency = 'usd'">دولار</button>
      <button data-testid="currency-syp" @click="settlementCurrency = 'syp'">ليرة سورية</button>
    </div>
    <textarea v-model="notes" placeholder="ملاحظات التسوية" />

    <button data-testid="finalize-button" :disabled="!canFinalize" @click="showFinalizeConfirm = true">
      إنهاء التسوية
    </button>

    <div v-if="showFinalizeConfirm" role="dialog">
      <p>لا يمكن التعديل عليها لاحقاً. هل تريد المتابعة؟</p>
      <button @click="showFinalizeConfirm = false">إلغاء</button>
      <button @click="onConfirmFinalize">تأكيد</button>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Write `SettlementDetailView.vue`** (read-only, no test required beyond a smoke check since it has no financial logic — pure display of a finalized/paid `StaffSettlement`)

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { db } from '@/data/powersync/db'
import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'
import type { StaffSettlement } from '@/features/staff-ledger/staff-ledger.types'

const props = defineProps<{ settlementId: string; staffId: string }>()
const { markPaid } = useStaffSettlement()
const settlement = ref<StaffSettlement | null>(null)
const showPaidConfirm = ref(false)
const paymentMethod = ref<'cash' | 'bank' | 'other'>('cash')

async function reload() {
  const row = await db.getOptional(`SELECT * FROM staff_settlements WHERE id = ?`, [props.settlementId])
  settlement.value = row as StaffSettlement | null
}
onMounted(reload)

async function onConfirmPaid() {
  await markPaid(props.settlementId, props.staffId, { paymentMethod: paymentMethod.value })
  showPaidConfirm.value = false
  await reload()
}
</script>

<template>
  <div dir="rtl" v-if="settlement">
    <h2>{{ settlement.settlementNumber }} — {{ settlement.staffNameSnapshot }}</h2>
    <p>الحالة: {{ settlement.status }}</p>
    <p>المبلغ النهائي: ${{ settlement.finalAmountUsd?.toFixed(2) }}</p>

    <button v-if="settlement.status === 'finalized'" @click="showPaidConfirm = true">
      تسجيل كمدفوع
    </button>

    <div v-if="showPaidConfirm" role="dialog">
      <select v-model="paymentMethod">
        <option value="cash">نقدي</option>
        <option value="bank">تحويل بنكي</option>
        <option value="other">أخرى</option>
      </select>
      <button @click="showPaidConfirm = false">إلغاء</button>
      <button @click="onConfirmPaid">تأكيد الدفع</button>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- SettlementDraftView`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/features/staff-ledger/views/SettlementDraftView.vue src/features/staff-ledger/views/SettlementDetailView.vue src/features/staff-ledger/views/__tests__/SettlementDraftView.test.ts
git commit -m "feat(wafi-138): add settlement draft and detail views with confirmation dialogs"
```

---

### Task 15: Router wiring and permission gating

**Files:**
- Modify: `src/router/index.ts` (or wherever routes are declared — confirm exact file via `grep -rn "can_view_expenses" src/router/`)
- Test: `src/__tests__/router/permissions.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `isRouteAllowed` (existing, `src/router/permissions.ts`), the three views from Tasks 13–14.

- [ ] **Step 1: Locate the exact route-declaration pattern**

Run: `grep -n "can_view_expenses" src/router/*.ts` to find an existing route using this permission (e.g. the expenses route) and copy its `meta: { requiredPermission: ... }` shape exactly.

- [ ] **Step 2: Add three routes** following that exact pattern:
```typescript
{ path: '/staff/:staffId/ledger', component: () => import('@/features/staff-ledger/views/StaffLedgerView.vue'), meta: { requiredPermission: 'can_view_expenses' }, props: true },
{ path: '/staff/:staffId/settlement/draft/:periodMonth', component: () => import('@/features/staff-ledger/views/SettlementDraftView.vue'), meta: { requiredPermission: 'can_view_expenses' }, props: true },
{ path: '/staff/:staffId/settlement/:settlementId', component: () => import('@/features/staff-ledger/views/SettlementDetailView.vue'), meta: { requiredPermission: 'can_view_expenses' }, props: true },
```
(Adjust the exact route array syntax to match whatever the file at the located path actually uses.)

- [ ] **Step 3: Add a router permission test** (append to `src/__tests__/router/permissions.test.ts`, following its existing test style found in Step 1's grep)

```typescript
it('denies a cashier without can_view_expenses from the staff ledger route', () => {
  const cashier = { /* ...matching the file's existing staff fixture shape, role: 'cashier', permissions: { ...DEFAULT_CASHIER_PERMISSIONS } */ }
  expect(isRouteAllowed('can_view_expenses', cashier as any)).toBe(false)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- permissions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/router/ src/__tests__/router/permissions.test.ts
git commit -m "feat(wafi-138): wire staff ledger/settlement routes behind can_view_expenses"
```

---

### Task 16: Full-suite verification and typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run the typecheck/build**

Run: `npx vue-tsc -b`
Expected: 0 type errors.

- [ ] **Step 3: Ripple-effect check (mechanical, per Definition of Done)**

Run: `grep -rn "db.execute\|tx.execute" src/features/staff-ledger/ | grep -v "staff_ledger\|staff_settlements"`
Expected: no output — every write in this feature targets only the two new tables, confirming no accidental write to `cashier_shifts`, `sale_payments`, or any Z-report-feeding table.

- [ ] **Step 4: Commit** (only if any fixups were needed in prior steps; otherwise this task produces no diff)

```bash
git status
# If clean, no commit needed — this task is a verification gate only.
```

---

## Not Included In This Plan (do not implement)

- WAFI-139 (Employee Profile & Performance) — separate ticket, separate plan, no financial coupling.
- Merging any of this to `main` before WAFI-122 (server-side role enforcement) is confirmed shipped — that is a release-gating decision tracked in `docs/WAFI-138-139-staff-settlement-revised.md`, not a task in this plan.
- Owner Dashboard reporting on outstanding advances/settlements — explicitly deferred in the design spec.
- Staff-list search — explicitly deferred, nice-to-have.
- Adoption nudge / WhatsApp digest integration — explicitly deferred.
