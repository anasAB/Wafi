# In-Shift Cash Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator record cash entering/leaving the drawer mid-shift (pay-in / pay-out / cash drop) so legitimate cash movements no longer surface as a false shortage in the shift variance.

**Architecture:** A new append-only `cash_movements` ledger table feeds two new per-currency terms (`cashPayIns`, `cashPayOuts`) into the existing `computeCashReconciliation`, so the Z-report and variance already account for movements. A composable owns record/void/list/live-drawer logic; two presentational Vue components (record sheet + list) are wired into the cash-drawer drill-down, the POS shift area, and the shift-detail review screen. Corrections are void-with-reason (a reversing row), never edit/delete.

**Tech Stack:** Vue 3 + TypeScript, Pinia, PowerSync (local SQLite + sync), Supabase Postgres (RLS), vue-i18n (Arabic-primary), Vitest + @vue/test-utils.

## Global Constraints

- **Dual currency:** every cash figure exists in both USD and SYP; each reconciles against its own drawer. Never cross-convert a movement.
- **SYP is integer-only** (WAFI-035): reject non-integer SYP amounts at input and in the composable.
- **Offline-first:** all writes go to the local DB and sync later; never block a write on the network.
- **Append-only ledger:** `cash_movements` grants INSERT + SELECT only — no UPDATE, no DELETE. A correction is a new reversing row referencing the original via `voids_movement_id`.
- **Arabic-primary, RTL:** all user-facing strings in Arabic; plain shop-owner language.
- **Per-staff permission is client-gated** (consistent with WAFI-058); tenant isolation is server-enforced via the per-shop RLS in migration 015. Do NOT add server-side role checks here (that is WAFI-010).
- **Tenant scoping:** every row carries `shop_id`; every query filters by `shop_id` (and `shift_id` for movement scoping — movements carry it directly, so never scope movements by time window).
- **Test commands:** single file `npx vitest run <path>`; full suite `npm run test`; type gate `npm run build`.

---

### Task 1: Cash-movement types + category map

**Files:**
- Create: `src/features/shifts/cashMovement.types.ts`
- Test: `src/features/shifts/__tests__/cashMovement.types.test.ts`

**Interfaces:**
- Produces: `CashMovementDirection` (`'in' | 'out'`), `CashCurrency` (`'USD' | 'SYP'`), `CashMovementCategory`, `CashMovementCategoryDef`, `CASH_MOVEMENT_CATEGORIES`, `categoriesForDirection(d)`, and the `CashMovement` interface. All later tasks import from this file.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/shifts/__tests__/cashMovement.types.test.ts
import { describe, it, expect } from 'vitest'
import {
  CASH_MOVEMENT_CATEGORIES,
  categoriesForDirection,
} from '../cashMovement.types'

describe('cash movement categories', () => {
  it('every category has a direction and an Arabic label', () => {
    for (const c of CASH_MOVEMENT_CATEGORIES) {
      expect(c.direction === 'in' || c.direction === 'out').toBe(true)
      expect(c.labelAr.length).toBeGreaterThan(0)
    }
  })

  it('categoriesForDirection returns only matching-direction categories', () => {
    const outs = categoriesForDirection('out')
    expect(outs.length).toBeGreaterThan(0)
    expect(outs.every(c => c.direction === 'out')).toBe(true)
    expect(outs.map(c => c.key)).toContain('paid_supplier')
    expect(outs.map(c => c.key)).toContain('drop_to_safe')

    const ins = categoriesForDirection('in')
    expect(ins.every(c => c.direction === 'in')).toBe(true)
    expect(ins.map(c => c.key)).toContain('float_topup')
  })

  it('category keys are unique', () => {
    const keys = CASH_MOVEMENT_CATEGORIES.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/shifts/__tests__/cashMovement.types.test.ts`
Expected: FAIL — cannot find module `../cashMovement.types`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/shifts/cashMovement.types.ts
export type CashMovementDirection = 'in' | 'out'
export type CashCurrency = 'USD' | 'SYP'

export type CashMovementCategory =
  | 'paid_supplier'
  | 'drop_to_safe'
  | 'owner_withdrawal'
  | 'other_out'
  | 'float_topup'
  | 'other_in'

export interface CashMovementCategoryDef {
  key:       CashMovementCategory
  direction: CashMovementDirection
  labelAr:   string
}

// Each category is fixed to exactly one direction (the UI shows only the
// categories valid for the chosen direction). 'other_*' is split per direction
// so the key→direction map stays 1:1 and unambiguous.
export const CASH_MOVEMENT_CATEGORIES: CashMovementCategoryDef[] = [
  { key: 'paid_supplier',    direction: 'out', labelAr: 'دفع لمورد' },
  { key: 'drop_to_safe',     direction: 'out', labelAr: 'إيداع للخزنة' },
  { key: 'owner_withdrawal', direction: 'out', labelAr: 'سحب المالك' },
  { key: 'other_out',        direction: 'out', labelAr: 'أخرى (صرف)' },
  { key: 'float_topup',      direction: 'in',  labelAr: 'تغذية الصندوق' },
  { key: 'other_in',         direction: 'in',  labelAr: 'أخرى (إيداع)' },
]

export function categoriesForDirection(d: CashMovementDirection): CashMovementCategoryDef[] {
  return CASH_MOVEMENT_CATEGORIES.filter(c => c.direction === d)
}

export interface CashMovement {
  id:              string
  shopId:          string
  deviceId:        string
  shiftId:         string
  staffId:         string | null
  direction:       CashMovementDirection
  category:        CashMovementCategory
  currency:        CashCurrency
  amount:          number          // raw in `currency`; integer when SYP
  note:            string | null
  voidsMovementId: string | null   // set on a reversing (void) row → the movement it reverses
  createdAt:       string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/shifts/__tests__/cashMovement.types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/cashMovement.types.ts src/features/shifts/__tests__/cashMovement.types.test.ts
git commit -m "feat(cash-movements): add cash-movement types + category map"
```

---

### Task 2: Database migration + PowerSync client schema

**Files:**
- Create: `supabase/migrations/027_cash_movements.sql`
- Modify: `src/data/powersync/schema.ts` (add table def + register in `AppSchema`)

**Interfaces:**
- Produces: the `cash_movements` table (server + local), enabling all DB reads/writes in later tasks.

> No unit test: this is schema/config. Verified by the type gate (`npm run build`) plus the composable tests in Task 4 (which run against the mocked DB). Self-review the SQL against the checklist in the step.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/027_cash_movements.sql
-- Wafi POS — In-shift cash management (Use Case A). An append-only ledger of cash
-- entering/leaving the drawer mid-shift (pay-in / pay-out / drop to safe), so
-- legitimate movements stop surfacing as a false shift shortage.
--
-- Self-contained: creates the table, its per-shop RLS (matching migration 015's
-- auth_shop_id() scoping), and adds it to the PowerSync publication. Do NOT edit
-- migration 015 — on a fresh DB it runs before this table exists and skips it.
--
-- Ledger discipline: GRANT INSERT + SELECT only (no UPDATE/DELETE). A mistake is
-- corrected by a reversing row (voids_movement_id), never by editing/deleting —
-- mirroring the append-only audit log (018) and immutable Z-report (060).

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id                 uuid PRIMARY KEY,
  shop_id            uuid NOT NULL,
  device_id          text NOT NULL,
  shift_id           uuid NOT NULL,
  staff_id           uuid,
  direction          text NOT NULL CHECK (direction IN ('in', 'out')),
  category           text NOT NULL,
  currency           text NOT NULL CHECK (currency IN ('USD', 'SYP')),
  amount             numeric NOT NULL CHECK (amount > 0),
  note               text,
  voids_movement_id  uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON public.cash_movements (shift_id);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

-- Per-shop scoping via the same helper migration 015 uses. SELECT + INSERT only.
DROP POLICY IF EXISTS cash_movements_select_all ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_insert_all ON public.cash_movements;
CREATE POLICY cash_movements_select_all ON public.cash_movements
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY cash_movements_insert_all ON public.cash_movements
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
-- Intentionally NO update/delete policies → the ledger is append-only.

-- Add to the PowerSync publication. IMPORTANT: copy the publication NAME verbatim
-- from migration 010_powersync_publication_all_bucket_tables.sql (it is the same
-- publication every synced table is added to).
ALTER PUBLICATION powersync ADD TABLE public.cash_movements;
```

Self-review checklist before moving on: (a) publication name matches migration 010; (b) `shop_id`/`shift_id`/`staff_id` types match `cashier_shifts`/`staff` (uuid); (c) no UPDATE/DELETE policy exists; (d) `auth_shop_id()` is the helper defined in migration 015.

- [ ] **Step 2: Register the table in the PowerSync client schema**

In `src/data/powersync/schema.ts`, add this table definition next to the other `new Table({...})` declarations (after `cashier_shifts`):

```ts
const cash_movements = new Table({
  shop_id:            column.text,
  device_id:          column.text,
  shift_id:           column.text,
  staff_id:           column.text,
  direction:          column.text,   // 'in' | 'out'
  category:           column.text,
  currency:           column.text,   // 'USD' | 'SYP'
  amount:             column.real,   // raw in `currency`; integer when SYP
  note:               column.text,
  voids_movement_id:  column.text,   // set on a reversing (void) row
  created_at:         column.text,
})
```

Then add `cash_movements,` to the `new Schema({ ... })` object (alongside `cashier_shifts,`).

- [ ] **Step 3: Verify the type gate passes**

Run: `npm run build`
Expected: build succeeds (type-check clean). The new table compiles into `AppSchema`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/027_cash_movements.sql src/data/powersync/schema.ts
git commit -m "feat(cash-movements): add cash_movements table, RLS, and PowerSync schema"
```

> Deploy note (out of band, not a code step): apply migration 027 to the hosted Supabase shop and confirm the table syncs, same as migrations 025/026.

---

### Task 3: Extend cash reconciliation with pay-ins / pay-outs

**Files:**
- Modify: `src/features/shifts/composables/cashReconciliation.ts`
- Test: `src/features/shifts/composables/__tests__/cashReconciliation.test.ts` (append cases)

**Interfaces:**
- Consumes: existing `ReconciliationInput` / `computeCashReconciliation`.
- Produces: `ReconciliationInput` gains optional `cashPayInsUsd`, `cashPayInsSyp`, `cashPayOutsUsd`, `cashPayOutsSyp` (all default 0). Behaviour: pay-ins add to expected, pay-outs subtract, per currency.

- [ ] **Step 1: Write the failing tests** (append to the existing `describe` block)

```ts
  it('pay-ins raise and pay-outs lower the expected USD cash', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 0,
      closingCashUsd:  130,            // 50 + 100 + 20 payIn - 40 payOut = 130
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
      cashPayInsUsd:   20,
      cashPayOutsUsd:  40,
    })
    expect(r.expectedUsd).toBe(130)
    expect(r.varianceUsd).toBe(0)
  })

  it('a SYP drop (pay-out) lowers expected SYP only, not USD', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  100,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  100,
      cashSypSalesRaw: 1_000_000,
      closingCashSyp:  700_000,        // 1,000,000 - 300,000 dropped to safe
      cashPayOutsSyp:  300_000,
    })
    expect(r.expectedUsd).toBe(100)
    expect(r.varianceUsd).toBe(0)
    expect(r.expectedSyp).toBe(700_000)
    expect(r.varianceSyp).toBe(0)
  })

  it('a void nets to zero (pay-out + equal reversing pay-in) → no variance impact', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  50,
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
      cashPayOutsUsd:  30,             // original pay-out
      cashPayInsUsd:   30,             // its reversing void row (opposite direction)
    })
    expect(r.expectedUsd).toBe(50)
    expect(r.varianceUsd).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/shifts/composables/__tests__/cashReconciliation.test.ts`
Expected: FAIL — the new fields are unknown / `expectedUsd` ignores them.

- [ ] **Step 3: Implement**

In `cashReconciliation.ts`, extend the input interface and the math. Add to `ReconciliationInput`:

```ts
  cashPayInsUsd?:  number  // cash added to the USD drawer mid-shift (float top-up, etc.)
  cashPayInsSyp?:  number
  cashPayOutsUsd?: number  // cash taken from the USD drawer (paid supplier, drop to safe, withdrawal)
  cashPayOutsSyp?: number
```

In `computeCashReconciliation`, add the defaults and fold into each expected:

```ts
  const cashPayInsUsd  = input.cashPayInsUsd  ?? 0
  const cashPayInsSyp  = input.cashPayInsSyp  ?? 0
  const cashPayOutsUsd = input.cashPayOutsUsd ?? 0
  const cashPayOutsSyp = input.cashPayOutsSyp ?? 0

  const expectedUsd =
    input.openingCashUsd + input.cashUsdSales + cashCreditPaymentsUsd + cashPayInsUsd
    - input.cashExpensesUsd - cashRefundsUsd - cashPayOutsUsd
  const expectedSyp =
    openingCashSyp + input.cashSypSalesRaw + cashCreditPaymentsSyp + cashPayInsSyp
    - cashExpensesSyp - cashRefundsSyp - cashPayOutsSyp
```

- [ ] **Step 4: Run the full reconciliation test file to verify all pass**

Run: `npx vitest run src/features/shifts/composables/__tests__/cashReconciliation.test.ts`
Expected: PASS (existing cases + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/composables/cashReconciliation.ts src/features/shifts/composables/__tests__/cashReconciliation.test.ts
git commit -m "feat(cash-movements): fold pay-ins/pay-outs into cash reconciliation"
```

---

### Task 4: Audit events + `useCashMovements` composable

**Files:**
- Modify: `src/features/audit/audit.types.ts` (add event + entity-type union members)
- Modify: `src/features/audit/composables/useAuditLog.ts` (add two typed helpers + export)
- Create: `src/features/shifts/composables/useCashMovements.ts`
- Test: `src/features/shifts/composables/__tests__/useCashMovements.test.ts`

**Interfaces:**
- Consumes: `db` (mocked in tests), `useDeviceStore`, `useSessionStore`, `useAuditLog`, `useZReport` (from Task 5 — `liveDrawer` only; the other methods don't depend on it), `CashMovement` types (Task 1).
- Produces: `useCashMovements()` → `record(input): Promise<string>`, `voidMovement(movementId, reasonNote): Promise<string>`, `listForShift(shiftId): Promise<CashMovement[]>`, `liveDrawer(shift): Promise<{ expectedUsd, expectedSyp }>`. `RecordCashMovementInput` interface.

- [ ] **Step 1: Add the audit event + entity-type members**

In `src/features/audit/audit.types.ts`, add `'cash_movement.recorded'` and `'cash_movement.voided'` to the `AuditEvent` union, and `'cash_movement'` to the `AuditEntityType` union.

- [ ] **Step 2: Add the audit helpers**

In `src/features/audit/composables/useAuditLog.ts`, add these two helpers (near `logShiftForceClosed`) and include both in the returned object:

```ts
  // Routine: recording a movement must not block the action (offline-first), like sales.
  const logCashMovementRecorded = (
    movementId: string,
    direction: 'in' | 'out',
    category: string,
    currency: 'USD' | 'SYP',
    amount: number,
  ) => _log('cash_movement.recorded', 'cash_movement', movementId,
            { direction, category, currency, amount })

  // Sensitive: a void reverses a money record — surface a failed write.
  const logCashMovementVoided = (
    voidMovementId: string,
    originalMovementId: string,
    note: string,
  ) => _logSensitive('cash_movement.voided', 'cash_movement', voidMovementId,
                     { original_id: originalMovementId, note })
```

- [ ] **Step 3: Write the failing tests**

```ts
// src/features/shifts/composables/__tests__/useCashMovements.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCashMovements } from '../useCashMovements'
import { db } from '@/data/powersync/db'
import type { CashierShift } from '../../shift.types'

const openShift: CashierShift = {
  id: 'shift-1', shopId: 's', deviceId: 'd', staffId: 'st',
  openedAt: '2026-06-25T06:00:00Z', closedAt: null,
  openingCashUsd: 100, openingCashSyp: 50_000,
  closingCashUsd: null, closingCashSyp: null,
  varianceUsd: null, varianceSyp: null, closeNote: null,
  forceClosedBy: null, zReportData: null, status: 'open',
}

function sqlOf(c: any[]): string { return c[0] as string }
function paramsOf(c: any[]): unknown[] { return c[1] as unknown[] }

describe('useCashMovements', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('record inserts a movement row with the right direction/currency/amount', async () => {
    const { record } = useCashMovements()
    const id = await record({
      shift: openShift, direction: 'out', category: 'paid_supplier',
      currency: 'USD', amount: 80, note: 'مورد الكهربائيات',
    })
    expect(id).toBeTruthy()
    const ins = vi.mocked(db.execute).mock.calls.find(c => /INSERT INTO cash_movements/.test(sqlOf(c)))
    expect(ins).toBeDefined()
    const p = paramsOf(ins!)
    expect(p).toContain('out')
    expect(p).toContain('paid_supplier')
    expect(p).toContain('USD')
    expect(p).toContain(80)
    expect(p).toContain('مورد الكهربائيات')
  })

  it('record rejects a non-open shift', async () => {
    const { record } = useCashMovements()
    await expect(record({
      shift: { ...openShift, status: 'closed' }, direction: 'out',
      category: 'drop_to_safe', currency: 'USD', amount: 10,
    })).rejects.toThrow()
  })

  it('record rejects amount <= 0 and non-integer SYP', async () => {
    const { record } = useCashMovements()
    await expect(record({
      shift: openShift, direction: 'in', category: 'float_topup',
      currency: 'USD', amount: 0,
    })).rejects.toThrow()
    await expect(record({
      shift: openShift, direction: 'out', category: 'drop_to_safe',
      currency: 'SYP', amount: 12345.5,
    })).rejects.toThrow()
  })

  it('voidMovement inserts a reversing row (opposite direction, same amount, pointing at original)', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/voids_movement_id\s*=/.test(sql)) return undefined as any // no existing void
      return {                                                       // the original
        id: 'm-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
        direction: 'out', category: 'paid_supplier', currency: 'USD', amount: 80,
        note: null, voids_movement_id: null, created_at: '2026-06-25T07:00:00Z',
      } as any
    })
    const { voidMovement } = useCashMovements()
    await voidMovement('m-1', 'مبلغ خاطئ')
    const ins = vi.mocked(db.execute).mock.calls.find(c => /INSERT INTO cash_movements/.test(sqlOf(c)))
    const p = paramsOf(ins!)
    expect(p).toContain('in')      // reversed from 'out'
    expect(p).toContain(80)        // same amount
    expect(p).toContain('m-1')     // voids_movement_id → original
  })

  it('voidMovement refuses to void a void entry', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'v-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
      direction: 'in', category: 'paid_supplier', currency: 'USD', amount: 80,
      note: null, voids_movement_id: 'm-1', created_at: 'x',
    } as any)
    const { voidMovement } = useCashMovements()
    await expect(voidMovement('v-1', 'x')).rejects.toThrow()
  })

  it('listForShift maps rows scoped by shift_id', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      id: 'm-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
      direction: 'out', category: 'drop_to_safe', currency: 'SYP', amount: 300_000,
      note: null, voids_movement_id: null, created_at: 'x',
    }] as any)
    const { listForShift } = useCashMovements()
    const list = await listForShift('shift-1')
    expect(list).toHaveLength(1)
    expect(list[0].currency).toBe('SYP')
    expect(list[0].voidsMovementId).toBeNull()
    const call = vi.mocked(db.getAll).mock.calls[0]
    expect(/shift_id\s*=\s*\?/.test(sqlOf(call))).toBe(true)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/features/shifts/composables/__tests__/useCashMovements.test.ts`
Expected: FAIL — `../useCashMovements` not found.

- [ ] **Step 5: Implement the composable**

```ts
// src/features/shifts/composables/useCashMovements.ts
import { db }              from '@/data/powersync/db'
import { useDeviceStore }  from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog }     from '@/features/audit/composables/useAuditLog'
import { useZReport }      from './useZReport'
import type { CashierShift } from '../shift.types'
import type {
  CashMovement, CashMovementCategory, CashMovementDirection, CashCurrency,
} from '../cashMovement.types'

export interface RecordCashMovementInput {
  shift:     CashierShift
  direction: CashMovementDirection
  category:  CashMovementCategory
  currency:  CashCurrency
  amount:    number
  note?:     string | null
}

function rowToMovement(r: any): CashMovement {
  return {
    id:              r.id,
    shopId:          r.shop_id,
    deviceId:        r.device_id,
    shiftId:         r.shift_id,
    staffId:         r.staff_id ?? null,
    direction:       r.direction,
    category:        r.category,
    currency:        r.currency,
    amount:          r.amount,
    note:            r.note ?? null,
    voidsMovementId: r.voids_movement_id ?? null,
    createdAt:       r.created_at,
  }
}

export function useCashMovements() {
  const device  = useDeviceStore()
  const session = useSessionStore()
  const { logCashMovementRecorded, logCashMovementVoided } = useAuditLog()

  async function insert(m: {
    shiftId: string; direction: CashMovementDirection; category: CashMovementCategory
    currency: CashCurrency; amount: number; note: string | null; voidsMovementId: string | null
  }): Promise<string> {
    const id  = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO cash_movements
         (id, shop_id, device_id, shift_id, staff_id, direction, category, currency,
          amount, note, voids_movement_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, device.shopId, device.deviceId, m.shiftId, session.activeStaff?.id ?? null,
       m.direction, m.category, m.currency, m.amount, m.note, m.voidsMovementId, now],
    )
    return id
  }

  async function record(input: RecordCashMovementInput): Promise<string> {
    if (input.shift.status !== 'open') {
      throw new Error('لا يمكن تسجيل حركة نقدية على وردية غير مفتوحة')
    }
    if (!(input.amount > 0)) {
      throw new Error('المبلغ يجب أن يكون أكبر من صفر')
    }
    if (input.currency === 'SYP' && !Number.isInteger(input.amount)) {
      throw new Error('مبلغ الليرة يجب أن يكون رقماً صحيحاً')
    }
    const id = await insert({
      shiftId: input.shift.id, direction: input.direction, category: input.category,
      currency: input.currency, amount: input.amount, note: input.note ?? null,
      voidsMovementId: null,
    })
    await logCashMovementRecorded(id, input.direction, input.category, input.currency, input.amount)
    return id
  }

  async function voidMovement(movementId: string, reasonNote: string): Promise<string> {
    const orig = await db.getOptional<any>(
      `SELECT * FROM cash_movements WHERE id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (!orig) throw new Error('الحركة غير موجودة')
    if (orig.voids_movement_id) throw new Error('لا يمكن عكس حركة عكسية')
    const existingVoid = await db.getOptional<any>(
      `SELECT id FROM cash_movements WHERE voids_movement_id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (existingVoid) throw new Error('تم عكس هذه الحركة مسبقاً')

    const reverseDir: CashMovementDirection = orig.direction === 'in' ? 'out' : 'in'
    const id = await insert({
      shiftId: orig.shift_id, direction: reverseDir, category: orig.category,
      currency: orig.currency, amount: orig.amount, note: reasonNote ?? null,
      voidsMovementId: movementId,
    })
    await logCashMovementVoided(id, movementId, reasonNote ?? '')
    return id
  }

  async function listForShift(shiftId: string): Promise<CashMovement[]> {
    const rows = await db.getAll<any>(
      `SELECT * FROM cash_movements WHERE shop_id = ? AND shift_id = ? ORDER BY created_at ASC`,
      [device.shopId, shiftId],
    )
    return rows.map(rowToMovement)
  }

  // The drawer's expected cash right now = the Z-report's `expected*` with a zero
  // count. Reuses the verified reconciliation engine (which already includes this
  // shift's movements via Task 5) — no duplicate SQL, no second source of truth.
  async function liveDrawer(shift: CashierShift): Promise<{ expectedUsd: number; expectedSyp: number }> {
    const { compute } = useZReport()
    const m = await compute(shift, 0, 0)
    return { expectedUsd: m.expectedUsd, expectedSyp: m.expectedSyp }
  }

  return { record, voidMovement, listForShift, liveDrawer }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/features/shifts/composables/__tests__/useCashMovements.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/features/audit/audit.types.ts src/features/audit/composables/useAuditLog.ts src/features/shifts/composables/useCashMovements.ts src/features/shifts/composables/__tests__/useCashMovements.test.ts
git commit -m "feat(cash-movements): record/void/list composable + audit events"
```

---

### Task 5: Fold movements into the Z-report

**Files:**
- Modify: `src/features/shifts/shift.types.ts` (`ZReportMetrics` gains four fields)
- Modify: `src/features/shifts/composables/useZReport.ts` (query movements; pass into reconciliation; print lines)
- Test: `src/features/shifts/composables/__tests__/useZReport.test.ts` (append a case)

**Interfaces:**
- Consumes: `computeCashReconciliation` (Task 3), `cash_movements` table (Task 2).
- Produces: `ZReportMetrics` gains `cashPayInsUsd`, `cashPayInsSyp`, `cashPayOutsUsd`, `cashPayOutsSyp`. The close snapshot (`z_report_data`) captures them automatically.

- [ ] **Step 1: Add the fields to `ZReportMetrics`**

In `shift.types.ts`, inside `ZReportMetrics`, after the `cashCreditPayments*` fields:

```ts
  cashPayInsUsd:   number   // cash added to the USD drawer mid-shift (movements)
  cashPayInsSyp:   number
  cashPayOutsUsd:  number   // cash removed from the USD drawer mid-shift (movements)
  cashPayOutsSyp:  number
```

> This makes every existing `ZReportMetrics` literal a type error until updated — that is intentional. Fix the fixtures in `useShiftClose.test.ts` and any other `ZReportMetrics` literal by adding the four fields set to `0`. Search: `npx vitest run` will surface them, or grep `expectedUsd:` in test files.

- [ ] **Step 2: Write the failing test** (append to `useZReport.test.ts`, following that file's existing mock setup)

```ts
  it('includes mid-shift pay-ins/pay-outs in the reconciliation', async () => {
    // Movements query returns one $80 pay-out (USD) and one 300,000 SYP drop.
    // (Mock the cash_movements GROUP BY query; see the file's existing db mock wiring.)
    mockMovements([
      { direction: 'out', currency: 'USD', total: 80 },
      { direction: 'out', currency: 'SYP', total: 300_000 },
    ])
    const m = await computeForFixtureShift()   // helper in this file's setup
    expect(m.cashPayOutsUsd).toBe(80)
    expect(m.cashPayOutsSyp).toBe(300_000)
    // expectedUsd dropped by 80 vs the no-movement baseline.
    expect(m.expectedUsd).toBe(BASELINE_EXPECTED_USD - 80)
  })
```

> The `useZReport` test sets up many `db.getOptional` mocks via `Promise.all`. Add a `mockMovements(rows)` helper that makes the new `db.getAll` movements query (the one matching `/FROM cash_movements/`) resolve to `rows`, and define `BASELINE_EXPECTED_USD` / `computeForFixtureShift()` from the file's existing fixture. Keep the existing tests green by defaulting `mockMovements([])` in `beforeEach`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/shifts/composables/__tests__/useZReport.test.ts`
Expected: FAIL — `cashPayOutsUsd` undefined / `expectedUsd` unchanged.

- [ ] **Step 4: Implement in `useZReport.ts`**

After the existing `Promise.all` block (and the `operatorRows` query), add the movements query and derive the four sums. Movements carry `shift_id`, so scope by it directly (cleaner than the time-window scoping the sales queries need):

```ts
      // Mid-shift cash movements (pay-in / pay-out / drop). Void rows are stored as
      // an opposite-direction entry, so SUM by direction nets them automatically.
      const movementRows = await db.getAll<{ direction: string; currency: string; total: number }>(
        `SELECT direction, currency, COALESCE(SUM(amount), 0) AS total
         FROM cash_movements
         WHERE shop_id = ? AND shift_id = ?
         GROUP BY direction, currency`,
        [device.shopId, shift.id],
      )
      const mv = (dir: string, cur: string) =>
        movementRows.find(r => r.direction === dir && r.currency === cur)?.total ?? 0
      const cashPayInsUsd  = mv('in',  'USD')
      const cashPayInsSyp  = mv('in',  'SYP')
      const cashPayOutsUsd = mv('out', 'USD')
      const cashPayOutsSyp = mv('out', 'SYP')
```

Pass them into `computeCashReconciliation({ ... })` (add the four args), and add the four fields to the returned `result` object:

```ts
        cashPayInsUsd,
        cashPayInsSyp,
        cashPayOutsUsd,
        cashPayOutsSyp,
```

- [ ] **Step 5: Add Z-report print lines**

In `printZReport`, inside the USD "حساب الصندوق" block (after the credit-payments line, before `= متوقع`), add:

```ts
      ...(m.cashPayInsUsd  > 0 ? [`+ إيداع نقدي:   ${fmtUsd(m.cashPayInsUsd)}`]  : []),
      ...(m.cashPayOutsUsd > 0 ? [`- صرف نقدي:     ${fmtUsd(m.cashPayOutsUsd)}`] : []),
```

And in the SYP block (before `ليرة متوقع`):

```ts
      ...(m.cashPayInsSyp  > 0 ? [`+ إيداع ليرة:   ${fmtSyp(m.cashPayInsSyp)}`]  : []),
      ...(m.cashPayOutsSyp > 0 ? [`- صرف ليرة:     ${fmtSyp(m.cashPayOutsSyp)}`] : []),
```

- [ ] **Step 6: Run the Z-report tests + full suite**

Run: `npx vitest run src/features/shifts/composables/__tests__/useZReport.test.ts`
Then: `npm run test`
Expected: all PASS (fixtures updated with the four new fields).

- [ ] **Step 7: Commit**

```bash
git add src/features/shifts/shift.types.ts src/features/shifts/composables/useZReport.ts src/features/shifts/composables/__tests__/
git commit -m "feat(cash-movements): include pay-ins/pay-outs in Z-report + reconciliation"
```

---

### Task 6: `RecordCashMovementSheet.vue` (record UI)

**Files:**
- Create: `src/features/shifts/components/RecordCashMovementSheet.vue`
- Test: `src/__tests__/features/RecordCashMovementSheet.test.ts`

**Interfaces:**
- Consumes: `categoriesForDirection`, `CASH_MOVEMENT_CATEGORIES` (Task 1).
- Produces: presentational component. Props: `liveDrawerUsd: number`, `liveDrawerSyp: number`. Emits `record` with `{ direction, category, currency, amount, note }` and `close`. Holds NO DB logic — the parent calls `useCashMovements().record()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/RecordCashMovementSheet.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'   // shared instance, as other component tests use
import RecordCashMovementSheet from '@/features/shifts/components/RecordCashMovementSheet.vue'

function mountSheet(props = {}) {
  return mount(RecordCashMovementSheet, {
    props: { liveDrawerUsd: 250, liveDrawerSyp: 1_000_000, ...props },
    global: { plugins: [i18n] },
  })
}

describe('RecordCashMovementSheet', () => {
  it('shows only out-direction categories when direction is out', async () => {
    const w = mountSheet()
    // default direction 'out'
    expect(w.text()).toContain('دفع لمورد')
    expect(w.text()).toContain('إيداع للخزنة')
    expect(w.text()).not.toContain('تغذية الصندوق') // an 'in' category
  })

  it('switches category set when direction toggles to in', async () => {
    const w = mountSheet()
    await w.get('[data-test="dir-in"]').trigger('click')
    expect(w.text()).toContain('تغذية الصندوق')
    expect(w.text()).not.toContain('دفع لمورد')
  })

  it('shows an overdraw warning when amount exceeds the drawer, but still allows confirm', async () => {
    const w = mountSheet({ liveDrawerUsd: 250 })
    await w.get('[data-test="cat-paid_supplier"]').trigger('click')
    await w.get('[data-test="amount"]').setValue('300') // > 250
    expect(w.get('[data-test="overdraw-warning"]').exists()).toBe(true)
    expect((w.get('[data-test="confirm"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits record with the chosen fields on confirm', async () => {
    const w = mountSheet()
    await w.get('[data-test="cat-drop_to_safe"]').trigger('click')
    await w.get('[data-test="amount"]').setValue('80')
    await w.get('[data-test="confirm"]').trigger('click')
    const ev = w.emitted('record')
    expect(ev).toBeTruthy()
    expect(ev![0][0]).toMatchObject({
      direction: 'out', category: 'drop_to_safe', currency: 'USD', amount: 80,
    })
  })

  it('rejects a non-integer SYP amount (confirm disabled / no emit)', async () => {
    const w = mountSheet()
    await w.get('[data-test="cur-SYP"]').trigger('click')
    await w.get('[data-test="cat-drop_to_safe"]').trigger('click')
    await w.get('[data-test="amount"]').setValue('100.5')
    await w.get('[data-test="confirm"]').trigger('click')
    expect(w.emitted('record')).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/features/RecordCashMovementSheet.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

```vue
<!-- src/features/shifts/components/RecordCashMovementSheet.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  categoriesForDirection,
} from '../cashMovement.types'
import type {
  CashMovementDirection, CashMovementCategory, CashCurrency,
} from '../cashMovement.types'

const props = defineProps<{ liveDrawerUsd: number; liveDrawerSyp: number }>()
const emit  = defineEmits<{
  (e: 'record', v: {
    direction: CashMovementDirection; category: CashMovementCategory
    currency: CashCurrency; amount: number; note: string | null
  }): void
  (e: 'close'): void
}>()

const direction = ref<CashMovementDirection>('out')
const currency  = ref<CashCurrency>('USD')
const category  = ref<CashMovementCategory | null>(null)
const amountStr = ref('')
const note      = ref('')

const categories = computed(() => categoriesForDirection(direction.value))

function selectDirection(d: CashMovementDirection) {
  direction.value = d
  category.value = null   // categories are direction-specific; reset on switch
}

const amount = computed(() => Number(amountStr.value))
const amountValid = computed(() => {
  if (!(amount.value > 0)) return false
  if (currency.value === 'SYP' && !Number.isInteger(amount.value)) return false
  return true
})
const drawerForCurrency = computed(() =>
  currency.value === 'USD' ? props.liveDrawerUsd : props.liveDrawerSyp)
const isOverdraw = computed(() =>
  (direction.value === 'out') && amountValid.value && amount.value > drawerForCurrency.value)

const canConfirm = computed(() => amountValid.value && category.value !== null)

function confirm() {
  if (!canConfirm.value || category.value === null) return
  emit('record', {
    direction: direction.value, category: category.value,
    currency: currency.value, amount: amount.value,
    note: note.value.trim() ? note.value.trim() : null,
  })
}
</script>

<template>
  <div class="cash-movement-sheet" dir="rtl">
    <header>حركة نقدية</header>

    <div class="dir-toggle">
      <button data-test="dir-out" :class="{ active: direction === 'out' }" @click="selectDirection('out')">صرف من الصندوق</button>
      <button data-test="dir-in"  :class="{ active: direction === 'in'  }" @click="selectDirection('in')">إيداع في الصندوق</button>
    </div>

    <div class="categories">
      <button
        v-for="c in categories" :key="c.key"
        :data-test="`cat-${c.key}`"
        :class="{ active: category === c.key }"
        @click="category = c.key"
      >{{ c.labelAr }}</button>
    </div>

    <div class="currency-toggle">
      <button data-test="cur-USD" :class="{ active: currency === 'USD' }" @click="currency = 'USD'">دولار</button>
      <button data-test="cur-SYP" :class="{ active: currency === 'SYP' }" @click="currency = 'SYP'">ليرة</button>
    </div>

    <input
      data-test="amount" v-model="amountStr" type="number" inputmode="decimal"
      :step="currency === 'SYP' ? '1' : 'any'" min="0" placeholder="المبلغ"
    />

    <p v-if="isOverdraw" data-test="overdraw-warning" class="warn">
      أكثر مما يظهر في الصندوق ({{ drawerForCurrency }}) — تأكد من العدّ
    </p>

    <textarea v-model="note" data-test="note" placeholder="ملاحظة (اختياري)"></textarea>

    <footer>
      <button data-test="cancel" @click="emit('close')">إلغاء</button>
      <button data-test="confirm" :disabled="!canConfirm" @click="confirm">تأكيد</button>
    </footer>
  </div>
</template>
```

> Styling: match the design system (glass card bg `#0D1828`, brand blue `#1A56DB`, modal pattern). Tests assert behaviour via `data-test` hooks, not styles — keep those attributes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/features/RecordCashMovementSheet.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/components/RecordCashMovementSheet.vue src/__tests__/features/RecordCashMovementSheet.test.ts
git commit -m "feat(cash-movements): record cash-movement sheet component"
```

---

### Task 7: `CashMovementsList.vue` (review/void UI)

**Files:**
- Create: `src/features/shifts/components/CashMovementsList.vue`
- Test: `src/__tests__/features/CashMovementsList.test.ts`

**Interfaces:**
- Consumes: `CashMovement`, `CASH_MOVEMENT_CATEGORIES` (Task 1).
- Produces: presentational. Props: `movements: CashMovement[]`, `canVoid: boolean`. Emits `void` with the movement `id`. Marks reversed originals struck-through; void rows labelled; the void button is hidden for void rows, already-reversed originals, and when `canVoid` is false.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/CashMovementsList.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import CashMovementsList from '@/features/shifts/components/CashMovementsList.vue'
import type { CashMovement } from '@/features/shifts/cashMovement.types'

const base: Omit<CashMovement, 'id' | 'direction' | 'category' | 'voidsMovementId'> = {
  shopId: 's', deviceId: 'd', shiftId: 'shift-1', staffId: 'st',
  currency: 'USD', amount: 80, note: null, createdAt: 'x',
}
const original: CashMovement = { ...base, id: 'm-1', direction: 'out', category: 'paid_supplier', voidsMovementId: null }
const voidRow:  CashMovement = { ...base, id: 'v-1', direction: 'in',  category: 'paid_supplier', voidsMovementId: 'm-1' }

function mountList(props: { movements: CashMovement[]; canVoid?: boolean }) {
  return mount(CashMovementsList, {
    props: { canVoid: true, ...props },
    global: { plugins: [i18n] },
  })
}

describe('CashMovementsList', () => {
  it('renders a movement with its category label', () => {
    const w = mountList({ movements: [original] })
    expect(w.text()).toContain('دفع لمورد')
  })

  it('shows the void button for a live original and emits void with its id', async () => {
    const w = mountList({ movements: [original] })
    await w.get('[data-test="void-m-1"]').trigger('click')
    expect(w.emitted('void')![0][0]).toBe('m-1')
  })

  it('marks a reversed original as voided and hides its void button', () => {
    const w = mountList({ movements: [original, voidRow] })
    expect(w.get('[data-test="row-m-1"]').classes()).toContain('voided')
    expect(w.find('[data-test="void-m-1"]').exists()).toBe(false)
  })

  it('never shows a void button on a void row', () => {
    const w = mountList({ movements: [original, voidRow] })
    expect(w.find('[data-test="void-v-1"]').exists()).toBe(false)
  })

  it('hides all void buttons when canVoid is false', () => {
    const w = mountList({ movements: [original], canVoid: false })
    expect(w.find('[data-test="void-m-1"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/features/CashMovementsList.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

```vue
<!-- src/features/shifts/components/CashMovementsList.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { CASH_MOVEMENT_CATEGORIES } from '../cashMovement.types'
import type { CashMovement } from '../cashMovement.types'

const props = defineProps<{ movements: CashMovement[]; canVoid: boolean }>()
const emit  = defineEmits<{ (e: 'void', movementId: string): void }>()

const labelOf = (key: string) =>
  CASH_MOVEMENT_CATEGORIES.find(c => c.key === key)?.labelAr ?? key

// Ids of originals that already have a reversing void row → render struck-through,
// no further void allowed.
const voidedIds = computed(() =>
  new Set(props.movements.filter(m => m.voidsMovementId).map(m => m.voidsMovementId!)))

function isVoidRow(m: CashMovement): boolean { return m.voidsMovementId !== null }
function isVoided(m: CashMovement): boolean { return voidedIds.value.has(m.id) }
function canVoidRow(m: CashMovement): boolean {
  return props.canVoid && !isVoidRow(m) && !isVoided(m)
}
function fmt(m: CashMovement): string {
  const sign = m.direction === 'in' ? '+' : '−'
  return m.currency === 'USD'
    ? `${sign}$${m.amount.toFixed(2)}`
    : `${sign}${m.amount.toLocaleString()} ل.س`
}
</script>

<template>
  <ul class="cash-movements" dir="rtl">
    <li v-if="movements.length === 0" class="empty">لا توجد حركات نقدية</li>
    <li
      v-for="m in movements" :key="m.id"
      :data-test="`row-${m.id}`"
      :class="{ voided: isVoided(m), 'void-row': isVoidRow(m) }"
    >
      <span class="cat">{{ labelOf(m.category) }}<span v-if="isVoidRow(m)"> (عكس)</span></span>
      <span class="amt">{{ fmt(m) }}</span>
      <span v-if="m.note" class="note">{{ m.note }}</span>
      <button
        v-if="canVoidRow(m)"
        :data-test="`void-${m.id}`"
        @click="emit('void', m.id)"
      >عكس</button>
    </li>
  </ul>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/features/CashMovementsList.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/components/CashMovementsList.vue src/__tests__/features/CashMovementsList.test.ts
git commit -m "feat(cash-movements): movements list + void component"
```

---

### Task 8: Wire entry points + shift-detail review

**Files:**
- Modify: `src/features/dashboard/components/CashDrawerSheet.vue` (cash-drawer drill-down — add "حركة نقدية" button + record sheet, shown only while a shift is open)
- Modify: `src/features/pos/` POS shift area screen (add the same quick action; locate the open-shift toolbar in `src/features/pos/` — the screen that mounts while a shift is open)
- Modify: `src/features/shifts/components/ShiftDetailScreen.vue` (render `CashMovementsList` for the shift; amount visibility follows the existing `canViewMoney`/`can_view_reports` gate; void enabled for owner/manager)
- Test: `src/__tests__/features/ShiftDetailCashMovements.test.ts`

**Interfaces:**
- Consumes: `useCashMovements` (record/void/list/liveDrawer), `RecordCashMovementSheet`, `CashMovementsList`, the active shift from `useShift().loadActiveShift()` / the screen's loaded shift.
- Produces: end-to-end wiring; no new exported API.

- [ ] **Step 1: Write the failing test (shift-detail integration)**

```ts
// src/__tests__/features/ShiftDetailCashMovements.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mount, flushPromises } from '@vue/test-utils'
import { i18n } from '@/i18n'
import { db } from '@/data/powersync/db'
import ShiftDetailScreen from '@/features/shifts/components/ShiftDetailScreen.vue'

describe('ShiftDetailScreen — cash movements section', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('lists the shift’s cash movements', async () => {
    // The shift load + the cash_movements query both go through the db mock.
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'shift-1', shop_id: 's', device_id: 'd', staff_id: 'st',
      opened_at: 'x', closed_at: null, opening_cash_usd: 100, opening_cash_syp: 0,
      closing_cash_usd: null, closing_cash_syp: null, variance_usd: null,
      variance_syp: null, close_note: null, force_closed_by: null,
      z_report_data: null, status: 'open',
    } as any)
    vi.mocked(db.getAll).mockResolvedValue([{
      id: 'm-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
      direction: 'out', category: 'paid_supplier', currency: 'USD', amount: 80,
      note: null, voids_movement_id: null, created_at: 'x',
    }] as any)

    const w = mount(ShiftDetailScreen, {
      props: { id: 'shift-1' },              // match the screen's actual prop/route param
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(w.text()).toContain('دفع لمورد')
  })
})
```

> If `ShiftDetailScreen` reads the id from the route rather than a prop, mount with a router stub as the existing shift tests do. Adjust the mount accordingly — the assertion (the movement label renders) is the deliverable.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/features/ShiftDetailCashMovements.test.ts`
Expected: FAIL — list not rendered.

- [ ] **Step 3: Wire `ShiftDetailScreen.vue`**

Load movements after the shift loads and render the list (gate amounts by the screen's existing `canViewMoney`; allow void for owner/manager):

```ts
import { ref } from 'vue'
import { useCashMovements } from '../composables/useCashMovements'
import CashMovementsList from './CashMovementsList.vue'
import type { CashMovement } from '../cashMovement.types'

const { listForShift, voidMovement } = useCashMovements()
const movements = ref<CashMovement[]>([])

async function loadMovements(shiftId: string) {
  movements.value = await listForShift(shiftId)
}
// call loadMovements(shift.id) wherever the screen loads its shift.

async function onVoid(id: string) {
  await voidMovement(id, 'تصحيح من شاشة الوردية')
  await loadMovements(/* current shift id */)
}
// canVoid = isOwner || isManager (reuse the screen's role check)
```

Template (inside the screen, under the Z-report section):

```vue
<section v-if="canViewMoney">
  <h3>الحركات النقدية</h3>
  <CashMovementsList :movements="movements" :can-void="canVoid" @void="onVoid" />
</section>
```

- [ ] **Step 4: Wire the cash-drawer drill-down (`CashDrawerSheet.vue`)**

Add a "حركة نقدية" button shown only when a shift is open; open `RecordCashMovementSheet` seeded with `liveDrawer`; on `record`, call the composable and refresh:

```ts
import { ref } from 'vue'
import { useShift } from '@/features/shifts/composables/useShift'
import { useCashMovements } from '@/features/shifts/composables/useCashMovements'
import RecordCashMovementSheet from '@/features/shifts/components/RecordCashMovementSheet.vue'
import type { CashierShift } from '@/features/shifts/shift.types'

const { loadActiveShift } = useShift()
const { record, liveDrawer } = useCashMovements()
const activeShift = ref<CashierShift | null>(null)
const showSheet   = ref(false)
const drawerUsd   = ref(0)
const drawerSyp   = ref(0)

async function openSheet() {
  activeShift.value = await loadActiveShift()
  if (!activeShift.value) return            // no open shift → no entry point
  const d = await liveDrawer(activeShift.value)
  drawerUsd.value = d.expectedUsd
  drawerSyp.value = d.expectedSyp
  showSheet.value = true
}

async function onRecord(v: Parameters<NonNullable<typeof RecordCashMovementSheet>['emit']> ) { /* see below */ }
```

Use a concrete handler (typed to the sheet's emit payload):

```ts
async function onRecord(v: {
  direction: 'in' | 'out'; category: any; currency: 'USD' | 'SYP'; amount: number; note: string | null
}) {
  if (!activeShift.value) return
  await record({ shift: activeShift.value, ...v })
  showSheet.value = false
  // refresh the drawer figures the sheet/drill-down shows
}
```

Template: a button `v-if="hasOpenShift"` opening the sheet, and `<RecordCashMovementSheet v-if="showSheet" :live-drawer-usd="drawerUsd" :live-drawer-syp="drawerSyp" @record="onRecord" @close="showSheet = false" />`.

- [ ] **Step 5: Wire the POS shift quick action**

In the POS screen that mounts while a shift is open (under `src/features/pos/`), add the same "حركة نقدية" action that opens `RecordCashMovementSheet` via the identical `openSheet`/`onRecord` wiring from Step 4. Shown only when a shift is open. (DRY: if the open/record logic is duplicated verbatim between the two entry points, extract it into a small `useCashMovementEntry()` composable in `src/features/shifts/composables/` and use it in both — do this only if both call sites are identical.)

- [ ] **Step 6: Run the integration test + full suite + type gate**

Run: `npx vitest run src/__tests__/features/ShiftDetailCashMovements.test.ts`
Then: `npm run test`
Then: `npm run build`
Expected: all PASS; build clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/dashboard/components/CashDrawerSheet.vue src/features/pos/ src/features/shifts/ src/__tests__/features/ShiftDetailCashMovements.test.ts
git commit -m "feat(cash-movements): wire entry points (drill-down + POS) and shift-detail review"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- `cash_movements` table + RLS + publication → Task 2 ✓
- Categories (directional) + dual currency + SYP integer → Tasks 1, 4, 6 ✓
- Cashier-can-record (no permission gate on record) → Task 4 (no role check) ✓
- Void-with-reason, no edit/delete; can't void a void / already-voided → Task 4 + Task 7 ✓
- Overdraw warn-but-allow → Task 6 ✓
- Reconciliation + Z-report fields + snapshot + print → Tasks 3, 5 ✓
- Blocked against non-open shift → Task 4 (`record` guard) + entry points shown only when open → Task 8 ✓
- Both entry points (drill-down + POS) + shift-detail review, amount-gated → Task 8 ✓
- Audit log on record + void → Task 4 ✓
- Offline-first / existing callers unaffected (defaults 0) → Tasks 3, 5 ✓

**Placeholder scan:** Task 5 Step 2 and Task 8 Step 1 reference the host test files' existing fixture/mock wiring (`mockMovements`, route vs prop) rather than reproducing unrelated boilerplate — the assertions and deliverables are concrete. All code steps contain real code.

**Type consistency:** `CashMovement`/category types defined in Task 1 are imported unchanged in Tasks 4/6/7. `ZReportMetrics` field names (`cashPayInsUsd/Syp`, `cashPayOutsUsd/Syp`) match between Tasks 3, 5. `record`/`voidMovement`/`listForShift`/`liveDrawer` signatures match between Task 4 (definition) and Task 8 (consumption). The sheet emits `{ direction, category, currency, amount, note }`; `record` consumes `{ shift, ...sameFields }`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-in-shift-cash-management.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
