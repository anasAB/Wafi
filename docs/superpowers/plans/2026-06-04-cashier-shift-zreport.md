# Cashier Shift + Z-Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PIN-based staff management, cashier shift open/close gate, and Z-report (shift-close summary with print) to the Wafi POS.

**Architecture:** Two new feature directories (`staff/`, `shifts/`). `useShiftStore` (Pinia, persisted via `pinia-plugin-persistedstate`) owns active shift state. `App.vue` mounts a `LockScreen` gate — no open shift = blocked. Every sale written by `usePayment.confirm()` includes the active `shift_id`. Z-report computed from `sale_payments` JOIN `sales` filtered by `shift_id`, plus `expenses` by time range.

**Tech Stack:** Vue 3, TypeScript, Pinia + `pinia-plugin-persistedstate` (already installed), PowerSync (wa-sqlite), Web Crypto API (`crypto.subtle` — no extra library), Vitest for tests.

---

## File Map

**Create:**
- `src/features/staff/staff.types.ts`
- `src/features/staff/composables/usePinAuth.ts`
- `src/features/staff/composables/__tests__/usePinAuth.test.ts`
- `src/features/staff/composables/useStaff.ts`
- `src/features/staff/components/PinPad.vue`
- `src/features/staff/components/StaffList.vue`
- `src/features/staff/components/StaffForm.vue`
- `src/features/staff/index.ts`
- `src/features/shifts/shift.types.ts`
- `src/features/shifts/shift.store.ts`
- `src/features/shifts/composables/cashReconciliation.ts`
- `src/features/shifts/composables/__tests__/cashReconciliation.test.ts`
- `src/features/shifts/composables/__tests__/useShiftStore.test.ts`
- `src/features/shifts/composables/useShift.ts`
- `src/features/shifts/composables/useZReport.ts`
- `src/features/shifts/components/LockScreen.vue`
- `src/features/shifts/components/OwnerSetupScreen.vue`
- `src/features/shifts/components/CashCountSheet.vue`
- `src/features/shifts/components/ZReportScreen.vue`
- `src/features/shifts/components/ShiftHistoryScreen.vue`
- `src/features/shifts/index.ts`

**Modify:**
- `src/data/powersync/schema.ts` — add `staff`, `cashier_shifts` tables; add `shift_id` to `sales`
- `src/features/payment/usePayment.ts` — add `shift_id` to sale INSERT (line 147)
- `src/router/index.ts` — add `/settings/staff`, `/shifts/history`, `/setup-owner` routes
- `src/App.vue` — add LockScreen gate + owner bootstrap logic
- `src/components/layout/AppSidebar.vue` — enable shifts nav, add permission filter, cashier name, close-shift button
- `src/pages/SettingsPage.vue` — add "الموظفون" entry to settings list

---

### Task 1: TypeScript types — staff + shifts

**Files:**
- Create: `src/features/staff/staff.types.ts`
- Create: `src/features/shifts/shift.types.ts`

- [ ] **Step 1: Create staff types**

`src/features/staff/staff.types.ts`:
```ts
export type StaffRole = 'owner' | 'cashier'

export interface StaffPermissions {
  can_view_reports:     boolean
  can_manage_products:  boolean
  can_manage_customers: boolean
  can_view_expenses:    boolean
  can_manage_settings:  boolean
}

export const DEFAULT_CASHIER_PERMISSIONS: StaffPermissions = {
  can_view_reports:     false,
  can_manage_products:  false,
  can_manage_customers: false,
  can_view_expenses:    false,
  can_manage_settings:  false,
}

export const OWNER_PERMISSIONS: StaffPermissions = {
  can_view_reports:     true,
  can_manage_products:  true,
  can_manage_customers: true,
  can_view_expenses:    true,
  can_manage_settings:  true,
}

export interface Staff {
  id:          string
  shopId:      string
  name:        string
  pinHash:     string
  role:        StaffRole
  permissions: StaffPermissions
  isActive:    boolean
  createdAt:   string
}

export interface NewStaff {
  name:        string
  pin:         string          // raw 4-digit string, hashed before DB write
  role:        StaffRole
  permissions: StaffPermissions
}
```

- [ ] **Step 2: Create shift types**

`src/features/shifts/shift.types.ts`:
```ts
export interface CashierShift {
  id:             string
  shopId:         string
  deviceId:       string
  staffId:        string
  openedAt:       string        // ISO timestamp
  closedAt:       string | null // null = still open
  openingCashUsd: number
  closingCashUsd: number | null
  closingCashSyp: number | null
  status:         'open' | 'closed'
}

export interface ZReportMetrics {
  invoiceCount:    number
  totalRevenueUsd: number
  cashUsdSales:    number
  cashSypSalesRaw: number   // raw SYP amount as entered by cashier
  cardSales:       number
  creditSales:     number
  cashExpensesUsd: number
  // USD reconciliation
  expectedUsd:     number
  actualUsd:       number
  varianceUsd:     number
  // SYP reconciliation
  expectedSyp:     number
  actualSyp:       number
  varianceSyp:     number
  // duration
  durationMinutes: number
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/staff/staff.types.ts src/features/shifts/shift.types.ts
git commit -m "feat(shifts): add TypeScript types for staff and cashier shifts"
```

---

### Task 2: PowerSync schema update

**Files:**
- Modify: `src/data/powersync/schema.ts`

> **Note:** PowerSync recreates the local SQLite DB when the schema changes. Existing local data will be wiped on next app load. Expected during development — reset localStorage if the app hangs on load.

- [ ] **Step 1: Add `shift_id` to the `sales` table definition**

In `src/data/powersync/schema.ts`, find the `sales` table and add one line:
```ts
const sales = new Table({
  // ... all existing columns unchanged ...
  shift_id: column.text,   // FK → cashier_shifts.id, nullable
})
```

- [ ] **Step 2: Add `staff` table**

After the existing table definitions, add:
```ts
const staff = new Table({
  shop_id:     column.text,
  name:        column.text,
  pin_hash:    column.text,
  role:        column.text,     // 'owner' | 'cashier'
  permissions: column.text,     // JSON blob
  is_active:   column.integer,
  created_at:  column.text,
})
```

- [ ] **Step 3: Add `cashier_shifts` table**

```ts
const cashier_shifts = new Table({
  shop_id:          column.text,
  device_id:        column.text,
  staff_id:         column.text,
  opened_at:        column.text,
  closed_at:        column.text,    // nullable
  opening_cash_usd: column.real,
  closing_cash_usd: column.real,    // nullable
  closing_cash_syp: column.real,    // nullable
  status:           column.text,    // 'open' | 'closed'
})
```

- [ ] **Step 4: Register both tables in `AppSchema`**

```ts
export const AppSchema = new Schema({
  // ... existing entries unchanged ...
  staff,
  cashier_shifts,
})
```

- [ ] **Step 5: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(schema): add staff and cashier_shifts tables, shift_id to sales"
```

---

### Task 3: PIN auth composable (TDD)

**Files:**
- Create: `src/features/staff/composables/__tests__/usePinAuth.test.ts`
- Create: `src/features/staff/composables/usePinAuth.ts`

Uses `crypto.subtle.digest` (Web Crypto API) — available in Node 18+ and all modern browsers, no extra library needed.

- [ ] **Step 1: Write failing tests**

`src/features/staff/composables/__tests__/usePinAuth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin }   from '../usePinAuth'

describe('usePinAuth', () => {
  it('hashPin produces a 64-character hex string', async () => {
    const hash = await hashPin('1234')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('hashPin is deterministic — same PIN yields same hash', async () => {
    expect(await hashPin('5678')).toBe(await hashPin('5678'))
  })

  it('hashPin produces different hashes for different PINs', async () => {
    expect(await hashPin('1111')).not.toBe(await hashPin('2222'))
  })

  it('verifyPin returns true for correct PIN', async () => {
    const hash = await hashPin('9999')
    expect(await verifyPin('9999', hash)).toBe(true)
  })

  it('verifyPin returns false for wrong PIN', async () => {
    const hash = await hashPin('9999')
    expect(await verifyPin('0000', hash)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run src/features/staff/composables/__tests__/usePinAuth.test.ts
```
Expected: FAIL — `Cannot find module '../usePinAuth'`

- [ ] **Step 3: Implement**

`src/features/staff/composables/usePinAuth.ts`:
```ts
export async function hashPin(pin: string): Promise<string> {
  const data   = new TextEncoder().encode(pin)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  return (await hashPin(pin)) === storedHash
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npx vitest run src/features/staff/composables/__tests__/usePinAuth.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/staff/composables/usePinAuth.ts src/features/staff/composables/__tests__/usePinAuth.test.ts
git commit -m "feat(staff): add PIN hash/verify composable with tests"
```

---

### Task 4: Cash reconciliation logic (TDD)

**Files:**
- Create: `src/features/shifts/composables/__tests__/cashReconciliation.test.ts`
- Create: `src/features/shifts/composables/cashReconciliation.ts`

Pure function — no DB, no Vue. Extracts the Z-report math so it can be unit tested cleanly.

- [ ] **Step 1: Write failing tests**

`src/features/shifts/composables/__tests__/cashReconciliation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeCashReconciliation } from '../cashReconciliation'

describe('computeCashReconciliation', () => {
  it('exact match — zero variance', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 20,
      closingCashUsd:  130,    // 50 + 100 - 20 = 130
      cashSypSalesRaw: 500_000,
      closingCashSyp:  500_000,
    })
    expect(r.expectedUsd).toBe(130)
    expect(r.varianceUsd).toBe(0)
    expect(r.expectedSyp).toBe(500_000)
    expect(r.varianceSyp).toBe(0)
  })

  it('shortage — cashier short by $5', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 20,
      closingCashUsd:  125,    // expected 130, short $5
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
    })
    expect(r.varianceUsd).toBe(-5)
  })

  it('overage — cashier over by $10', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  50,
      cashUsdSales:    100,
      cashExpensesUsd: 20,
      closingCashUsd:  140,
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
    })
    expect(r.varianceUsd).toBe(10)
  })

  it('no opening cash — pure sales', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  0,
      cashUsdSales:    75,
      cashExpensesUsd: 0,
      closingCashUsd:  75,
      cashSypSalesRaw: 0,
      closingCashSyp:  0,
    })
    expect(r.expectedUsd).toBe(75)
    expect(r.varianceUsd).toBe(0)
  })

  it('SYP variance calculated correctly', () => {
    const r = computeCashReconciliation({
      openingCashUsd:  0,
      cashUsdSales:    0,
      cashExpensesUsd: 0,
      closingCashUsd:  0,
      cashSypSalesRaw: 1_000_000,
      closingCashSyp:  950_000,
    })
    expect(r.expectedSyp).toBe(1_000_000)
    expect(r.varianceSyp).toBe(-50_000)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run src/features/shifts/composables/__tests__/cashReconciliation.test.ts
```
Expected: FAIL — `Cannot find module '../cashReconciliation'`

- [ ] **Step 3: Implement**

`src/features/shifts/composables/cashReconciliation.ts`:
```ts
interface ReconciliationInput {
  openingCashUsd:  number
  cashUsdSales:    number
  cashExpensesUsd: number
  closingCashUsd:  number
  cashSypSalesRaw: number
  closingCashSyp:  number
}

export interface ReconciliationResult {
  expectedUsd: number
  varianceUsd: number
  expectedSyp: number
  varianceSyp: number
}

export function computeCashReconciliation(input: ReconciliationInput): ReconciliationResult {
  const expectedUsd = input.openingCashUsd + input.cashUsdSales - input.cashExpensesUsd
  const expectedSyp = input.cashSypSalesRaw
  return {
    expectedUsd,
    varianceUsd: input.closingCashUsd - expectedUsd,
    expectedSyp,
    varianceSyp: input.closingCashSyp - expectedSyp,
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npx vitest run src/features/shifts/composables/__tests__/cashReconciliation.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/composables/cashReconciliation.ts src/features/shifts/composables/__tests__/cashReconciliation.test.ts
git commit -m "feat(shifts): add cash reconciliation pure function with tests"
```

---

### Task 5: useShiftStore (Pinia, persisted)

**Files:**
- Create: `src/features/shifts/composables/__tests__/useShiftStore.test.ts`
- Create: `src/features/shifts/shift.store.ts`

`pinia-plugin-persistedstate` is already installed (ADR-005). `persist: true` stores `activeShiftId` + `activeStaff` in localStorage so the shift survives page refresh.

- [ ] **Step 1: Write failing tests**

`src/features/shifts/composables/__tests__/useShiftStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia }       from 'pinia'
import { useShiftStore }                     from '../../shift.store'
import type { Staff }                        from '@/features/staff/staff.types'

const mockStaff: Staff = {
  id:          'staff-1',
  shopId:      'shop-1',
  name:        'محمد',
  pinHash:     'abc123',
  role:        'cashier',
  permissions: {
    can_view_reports:     false,
    can_manage_products:  true,
    can_manage_customers: false,
    can_view_expenses:    false,
    can_manage_settings:  false,
  },
  isActive:  true,
  createdAt: '2026-01-01T00:00:00Z',
}

describe('useShiftStore', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('starts with no active shift', () => {
    const store = useShiftStore()
    expect(store.isShiftOpen).toBe(false)
    expect(store.activeShiftId).toBeNull()
    expect(store.activeStaff).toBeNull()
  })

  it('openShift sets active shift and staff', () => {
    const store = useShiftStore()
    store.openShift('shift-123', mockStaff)
    expect(store.isShiftOpen).toBe(true)
    expect(store.activeShiftId).toBe('shift-123')
    expect(store.activeStaff).toEqual(mockStaff)
  })

  it('closeShift clears all state', () => {
    const store = useShiftStore()
    store.openShift('shift-123', mockStaff)
    store.closeShift()
    expect(store.isShiftOpen).toBe(false)
    expect(store.activeShiftId).toBeNull()
    expect(store.activeStaff).toBeNull()
  })

  it('permissions returns active staff permissions', () => {
    const store = useShiftStore()
    store.openShift('shift-123', mockStaff)
    expect(store.permissions?.can_manage_products).toBe(true)
    expect(store.permissions?.can_view_reports).toBe(false)
  })

  it('permissions returns null when no shift open', () => {
    const store = useShiftStore()
    expect(store.permissions).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run src/features/shifts/composables/__tests__/useShiftStore.test.ts
```
Expected: FAIL — `Cannot find module '../../shift.store'`

- [ ] **Step 3: Implement**

`src/features/shifts/shift.store.ts`:
```ts
import { ref, computed } from 'vue'
import { defineStore }   from 'pinia'
import type { Staff, StaffPermissions } from '@/features/staff/staff.types'

export const useShiftStore = defineStore('shift', () => {
  const activeShiftId = ref<string | null>(null)
  const activeStaff   = ref<Staff | null>(null)

  const isShiftOpen = computed(() => activeShiftId.value !== null)
  const permissions = computed<StaffPermissions | null>(() => activeStaff.value?.permissions ?? null)

  function openShift(shiftId: string, staff: Staff) {
    activeShiftId.value = shiftId
    activeStaff.value   = staff
  }

  function closeShift() {
    activeShiftId.value = null
    activeStaff.value   = null
  }

  return { activeShiftId, activeStaff, isShiftOpen, permissions, openShift, closeShift }
}, {
  persist: true,
})
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npx vitest run src/features/shifts/composables/__tests__/useShiftStore.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/shift.store.ts src/features/shifts/composables/__tests__/useShiftStore.test.ts
git commit -m "feat(shifts): add useShiftStore with persistence and tests"
```

---

### Task 6: useStaff composable

**Files:**
- Create: `src/features/staff/composables/useStaff.ts`

- [ ] **Step 1: Create useStaff**

`src/features/staff/composables/useStaff.ts`:
```ts
import { ref }             from 'vue'
import { db }              from '@/data/powersync/db'
import { useDeviceStore }  from '@/store/device.store'
import { hashPin }         from './usePinAuth'
import type { Staff, NewStaff, StaffPermissions } from '../staff.types'
import { OWNER_PERMISSIONS } from '../staff.types'

function rowToStaff(r: any): Staff {
  return {
    id:          r.id,
    shopId:      r.shop_id,
    name:        r.name,
    pinHash:     r.pin_hash,
    role:        r.role,
    permissions: r.role === 'owner'
      ? OWNER_PERMISSIONS
      : JSON.parse(r.permissions ?? '{}'),
    isActive:  r.is_active === 1,
    createdAt: r.created_at,
  }
}

export function useStaff() {
  const staff   = ref<Staff[]>([])
  const loading = ref(false)

  async function loadStaff(): Promise<void> {
    const device = useDeviceStore()
    loading.value = true
    try {
      const result = await db.execute(
        `SELECT * FROM staff WHERE shop_id = ? AND is_active = 1 ORDER BY role DESC, created_at ASC`,
        [device.shopId]
      )
      staff.value = (result as any).rows._array.map(rowToStaff)
    } finally {
      loading.value = false
    }
  }

  async function hasAnyStaff(): Promise<boolean> {
    const device = useDeviceStore()
    const row = await db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count FROM staff WHERE shop_id = ?`,
      [device.shopId]
    )
    return (row?.count ?? 0) > 0
  }

  async function createStaff(data: NewStaff): Promise<Staff> {
    const device    = useDeviceStore()
    const id        = crypto.randomUUID()
    const pinHash   = await hashPin(data.pin)
    const now       = new Date().toISOString()
    const permsJson = data.role === 'owner'
      ? JSON.stringify(OWNER_PERMISSIONS)
      : JSON.stringify(data.permissions)

    await db.execute(
      `INSERT INTO staff (id, shop_id, name, pin_hash, role, permissions, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, device.shopId, data.name, pinHash, data.role, permsJson, now]
    )
    await loadStaff()
    return staff.value.find(s => s.id === id)!
  }

  async function updateStaffPin(staffId: string, newPin: string): Promise<void> {
    await db.execute(
      `UPDATE staff SET pin_hash = ? WHERE id = ?`,
      [await hashPin(newPin), staffId]
    )
  }

  async function updateStaffPermissions(staffId: string, permissions: StaffPermissions): Promise<void> {
    await db.execute(
      `UPDATE staff SET permissions = ? WHERE id = ?`,
      [JSON.stringify(permissions), staffId]
    )
    await loadStaff()
  }

  async function deactivateStaff(staffId: string): Promise<void> {
    await db.execute(`UPDATE staff SET is_active = 0 WHERE id = ?`, [staffId])
    await loadStaff()
  }

  return {
    staff, loading,
    loadStaff, hasAnyStaff, createStaff,
    updateStaffPin, updateStaffPermissions, deactivateStaff,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/staff/composables/useStaff.ts
git commit -m "feat(staff): add useStaff composable — CRUD for staff management"
```

---

### Task 7: useShift composable

**Files:**
- Create: `src/features/shifts/composables/useShift.ts`

- [ ] **Step 1: Create useShift**

`src/features/shifts/composables/useShift.ts`:
```ts
import { db }             from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore }  from '@/features/shifts/shift.store'
import type { Staff }     from '@/features/staff/staff.types'
import type { CashierShift } from '../shift.types'

function rowToShift(r: any): CashierShift {
  return {
    id:             r.id,
    shopId:         r.shop_id,
    deviceId:       r.device_id,
    staffId:        r.staff_id,
    openedAt:       r.opened_at,
    closedAt:       r.closed_at ?? null,
    openingCashUsd: r.opening_cash_usd,
    closingCashUsd: r.closing_cash_usd ?? null,
    closingCashSyp: r.closing_cash_syp ?? null,
    status:         r.status,
  }
}

export function useShift() {
  const device     = useDeviceStore()
  const shiftStore = useShiftStore()

  async function openShift(staff: Staff, openingCashUsd: number): Promise<string> {
    const shiftId = crypto.randomUUID()
    const now     = new Date().toISOString()
    await db.execute(
      `INSERT INTO cashier_shifts
         (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [shiftId, device.shopId, device.deviceId, staff.id, now, openingCashUsd]
    )
    shiftStore.openShift(shiftId, staff)
    return shiftId
  }

  async function closeShift(closingCashUsd: number, closingCashSyp: number): Promise<void> {
    const shiftId = shiftStore.activeShiftId
    if (!shiftId) throw new Error('No open shift to close')
    const now = new Date().toISOString()
    await db.execute(
      `UPDATE cashier_shifts
       SET status = 'closed', closed_at = ?, closing_cash_usd = ?, closing_cash_syp = ?
       WHERE id = ?`,
      [now, closingCashUsd, closingCashSyp, shiftId]
    )
    shiftStore.closeShift()
  }

  async function loadActiveShift(): Promise<CashierShift | null> {
    const shiftId = shiftStore.activeShiftId
    if (!shiftId) return null
    const row = await db.getOptional<any>(
      `SELECT * FROM cashier_shifts WHERE id = ?`,
      [shiftId]
    )
    if (!row || row.status !== 'open') {
      shiftStore.closeShift()
      return null
    }
    return rowToShift(row)
  }

  async function loadShiftHistory(): Promise<CashierShift[]> {
    const result = await db.execute(
      `SELECT * FROM cashier_shifts WHERE shop_id = ? ORDER BY opened_at DESC LIMIT 50`,
      [device.shopId]
    )
    return (result as any).rows._array.map(rowToShift)
  }

  return { openShift, closeShift, loadActiveShift, loadShiftHistory }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/shifts/composables/useShift.ts
git commit -m "feat(shifts): add useShift composable — open/close shift DB operations"
```

---

### Task 8: useZReport composable

**Files:**
- Create: `src/features/shifts/composables/useZReport.ts`

Uses `computeCashReconciliation` from Task 4 for the math.

- [ ] **Step 1: Create useZReport**

`src/features/shifts/composables/useZReport.ts`:
```ts
import { ref }               from 'vue'
import { db }                from '@/data/powersync/db'
import { useDeviceStore }    from '@/store/device.store'
import { computeCashReconciliation } from './cashReconciliation'
import type { CashierShift, ZReportMetrics } from '../shift.types'

export function useZReport() {
  const metrics = ref<ZReportMetrics | null>(null)
  const loading = ref(false)
  const error   = ref<string | null>(null)

  async function compute(
    shift: CashierShift,
    closingCashUsd: number,
    closingCashSyp: number
  ): Promise<ZReportMetrics> {
    const device   = useDeviceStore()
    const closedAt = new Date().toISOString()
    loading.value  = true
    error.value    = null
    try {
      const [countRow, revenueRow, cashUsdRow, cashSypRow, cardRow, creditRow, expRow] =
        await Promise.all([
          db.getOptional<{ count: number }>(
            `SELECT COUNT(*) as count FROM sales WHERE shift_id = ?`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales WHERE shift_id = ?`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_usd), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shift_id = ? AND sp.method = 'cash_usd'`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_raw), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shift_id = ? AND sp.method = 'cash_syp'`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_usd), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shift_id = ? AND sp.method = 'card'`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales
             WHERE shift_id = ? AND is_credit = 1`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(amount_usd), 0) as total FROM expenses
             WHERE shop_id = ? AND paid_in_cash = 1 AND created_at BETWEEN ? AND ?`,
            [device.shopId, shift.openedAt, closedAt]
          ),
        ])

      const cashUsdSales    = cashUsdRow?.total    ?? 0
      const cashSypSalesRaw = cashSypRow?.total    ?? 0
      const cashExpensesUsd = expRow?.total        ?? 0

      const recon = computeCashReconciliation({
        openingCashUsd: shift.openingCashUsd,
        cashUsdSales,
        cashExpensesUsd,
        closingCashUsd,
        cashSypSalesRaw,
        closingCashSyp,
      })

      const durationMs = new Date(closedAt).getTime() - new Date(shift.openedAt).getTime()

      const result: ZReportMetrics = {
        invoiceCount:    countRow?.count   ?? 0,
        totalRevenueUsd: revenueRow?.total ?? 0,
        cashUsdSales,
        cashSypSalesRaw,
        cardSales:       cardRow?.total    ?? 0,
        creditSales:     creditRow?.total  ?? 0,
        cashExpensesUsd,
        expectedUsd:     recon.expectedUsd,
        actualUsd:       closingCashUsd,
        varianceUsd:     recon.varianceUsd,
        expectedSyp:     recon.expectedSyp,
        actualSyp:       closingCashSyp,
        varianceSyp:     recon.varianceSyp,
        durationMinutes: Math.floor(durationMs / 60_000),
      }

      metrics.value = result
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  function printZReport(
    shift: CashierShift,
    staffName: string,
    deviceCode: string,
    m: ZReportMetrics
  ): void {
    const hours    = Math.floor(m.durationMinutes / 60)
    const mins     = m.durationMinutes % 60
    const duration = hours > 0 ? `${hours}س ${mins}د` : `${mins}د`
    const fmtUsd   = (n: number) => `$${n.toFixed(2)}`
    const fmtSyp   = (n: number) => `${n.toLocaleString()} ل.س`
    const varUsd   = m.varianceUsd
    const varSyp   = m.varianceSyp

    const lines = [
      '================================',
      '         تقرير الوردية',
      '================================',
      `الكاشير:   ${staffName}`,
      `الجهاز:    ${deviceCode}`,
      `فتح:       ${new Date(shift.openedAt).toLocaleTimeString('ar-SY')}`,
      `إغلاق:     ${new Date().toLocaleTimeString('ar-SY')}`,
      `المدة:     ${duration}`,
      '--------------------------------',
      '          المبيعات',
      '--------------------------------',
      `عدد الفواتير:   ${m.invoiceCount}`,
      `إجمالي:         ${fmtUsd(m.totalRevenueUsd)}`,
      '--------------------------------',
      '     تفصيل طريقة الدفع',
      '--------------------------------',
      `نقد دولار:      ${fmtUsd(m.cashUsdSales)}`,
      `نقد ليرة:       ${fmtSyp(m.cashSypSalesRaw)}`,
      `بطاقة:          ${fmtUsd(m.cardSales)}`,
      `آجل (دين):      ${fmtUsd(m.creditSales)}`,
      '--------------------------------',
      '         المصاريف',
      '--------------------------------',
      `مصاريف الوردية: ${fmtUsd(m.cashExpensesUsd)}`,
      '--------------------------------',
      '       حساب الصندوق',
      '--------------------------------',
      `رصيد الفتح:     ${fmtUsd(shift.openingCashUsd)}`,
      `+ نقد مبيعات:   ${fmtUsd(m.cashUsdSales)}`,
      `- مصاريف نقدية: ${fmtUsd(m.cashExpensesUsd)}`,
      `= متوقع:        ${fmtUsd(m.expectedUsd)}`,
      `عند العد:       ${fmtUsd(m.actualUsd)}`,
      `الفرق:          ${varUsd >= 0 ? '+' : ''}${fmtUsd(varUsd)}${varUsd < 0 ? ' !!!' : ''}`,
      '',
      `ليرة متوقع:     ${fmtSyp(m.expectedSyp)}`,
      `ليرة عند العد:  ${fmtSyp(m.actualSyp)}`,
      `فرق الليرة:     ${varSyp >= 0 ? '+' : ''}${fmtSyp(varSyp)}`,
      '================================',
    ]

    const html = `<html dir="rtl"><head><style>
      body { font-family: monospace; font-size: 12px; white-space: pre; margin: 8px; }
      @media print { @page { margin: 5mm; } }
    </style></head><body>${lines.join('\n')}</body></html>`

    const w = window.open('', '_blank', 'width=400,height=650')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return { metrics, loading, error, compute, printZReport }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/shifts/composables/useZReport.ts
git commit -m "feat(shifts): add useZReport — Z-report DB queries, reconciliation, browser print"
```

---

### Task 9: PinPad component

**Files:**
- Create: `src/features/staff/components/PinPad.vue`

Reusable 4-digit PIN pad. Used by LockScreen (Task 10) and StaffForm (Task 12).

- [ ] **Step 1: Create PinPad**

`src/features/staff/components/PinPad.vue`:
```vue
<script setup lang="ts">
import { ref, computed } from 'vue'

const emit   = defineEmits<{ complete: [pin: string] }>()
const digits = ref<string[]>([])
const error  = ref(false)

const display = computed(() =>
  Array.from({ length: 4 }, (_, i) => digits.value[i] ? '●' : '○').join(' ')
)

function pressDigit(d: string) {
  if (digits.value.length >= 4) return
  digits.value.push(d)
  if (digits.value.length === 4) {
    emit('complete', digits.value.join(''))
    digits.value = []
  }
}

function pressBackspace() {
  digits.value.pop()
  error.value = false
}

function shake() {
  error.value  = true
  digits.value = []
  setTimeout(() => { error.value = false }, 500)
}

defineExpose({ shake })
</script>

<template>
  <div class="flex flex-col items-center gap-6">
    <div
      :class="['text-3xl tracking-widest font-mono text-white transition-all', error && 'text-red-400 animate-shake']"
      dir="ltr"
    >
      {{ display }}
    </div>

    <div class="grid grid-cols-3 gap-3 w-64">
      <button
        v-for="d in ['1','2','3','4','5','6','7','8','9']"
        :key="d"
        @click="pressDigit(d)"
        class="h-16 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-2xl font-semibold transition-all"
      >{{ d }}</button>
      <div />
      <button
        @click="pressDigit('0')"
        class="h-16 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-2xl font-semibold transition-all"
      >0</button>
      <button
        @click="pressBackspace"
        class="h-16 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xl transition-all"
      >⌫</button>
    </div>
  </div>
</template>

<style scoped>
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
.animate-shake { animation: shake 0.4s ease; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/features/staff/components/PinPad.vue
git commit -m "feat(staff): add PinPad component — 4-digit PIN entry with shake"
```

---

### Task 10: LockScreen component

**Files:**
- Create: `src/features/shifts/components/LockScreen.vue`

Full-screen gate shown when no shift is open. 3 steps: pick staff → PIN → opening cash.

- [ ] **Step 1: Create LockScreen**

`src/features/shifts/components/LockScreen.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted }  from 'vue'
import { useStaff }        from '@/features/staff/composables/useStaff'
import { verifyPin }       from '@/features/staff/composables/usePinAuth'
import { useShift }        from '@/features/shifts/composables/useShift'
import PinPad              from '@/features/staff/components/PinPad.vue'
import type { Staff }      from '@/features/staff/staff.types'

const { staff, loadStaff } = useStaff()
const { openShift }        = useShift()

type Step = 'pick-staff' | 'enter-pin' | 'opening-cash'

const step           = ref<Step>('pick-staff')
const selectedStaff  = ref<Staff | null>(null)
const openingCashUsd = ref('')
const pinPadRef      = ref<InstanceType<typeof PinPad> | null>(null)
const loading        = ref(false)

onMounted(() => loadStaff())

function selectStaff(s: Staff) {
  selectedStaff.value = s
  step.value = 'enter-pin'
}

async function onPinComplete(pin: string) {
  if (!selectedStaff.value) return
  const ok = await verifyPin(pin, selectedStaff.value.pinHash)
  if (!ok) { pinPadRef.value?.shake(); return }
  step.value = 'opening-cash'
}

async function confirmOpen() {
  if (!selectedStaff.value) return
  loading.value = true
  try {
    await openShift(selectedStaff.value, parseFloat(openingCashUsd.value) || 0)
  } finally {
    loading.value = false
  }
}

function back() {
  if (step.value === 'enter-pin')    { step.value = 'pick-staff'; selectedStaff.value = null }
  if (step.value === 'opening-cash') { step.value = 'enter-pin' }
}
</script>

<template>
  <div class="fixed inset-0 bg-[#06090F] flex flex-col items-center justify-center p-6 z-50" dir="rtl">
    <div class="text-white text-3xl font-bold mb-10">وافي</div>

    <!-- Step 1: pick staff -->
    <template v-if="step === 'pick-staff'">
      <p class="text-[#C8D5E8] mb-6 text-lg">من أنت؟</p>
      <div class="flex flex-col gap-3 w-full max-w-xs">
        <button
          v-for="s in staff" :key="s.id"
          @click="selectStaff(s)"
          class="w-full py-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-lg font-medium transition-all active:scale-95"
        >{{ s.name }}</button>
      </div>
    </template>

    <!-- Step 2: enter PIN -->
    <template v-else-if="step === 'enter-pin'">
      <p class="text-[#C8D5E8] mb-2 text-lg">مرحباً {{ selectedStaff?.name }}</p>
      <p class="text-[#637285] mb-8 text-sm">أدخل الرقم السري</p>
      <PinPad ref="pinPadRef" @complete="onPinComplete" />
      <button @click="back" class="mt-8 text-[#637285] text-sm">← رجوع</button>
    </template>

    <!-- Step 3: opening cash -->
    <template v-else-if="step === 'opening-cash'">
      <p class="text-[#C8D5E8] mb-2 text-lg">كم في الصندوق؟</p>
      <p class="text-[#637285] mb-8 text-sm">أدخل رصيد الفتح بالدولار</p>
      <div class="flex items-center gap-2 bg-white/10 rounded-2xl px-4 py-3 w-full max-w-xs">
        <span class="text-[#637285]">$</span>
        <input
          v-model="openingCashUsd"
          type="number" min="0" step="0.01"
          class="bg-transparent text-white text-2xl w-full outline-none"
          placeholder="0.00" dir="ltr" autofocus
        />
      </div>
      <button
        @click="confirmOpen" :disabled="loading"
        class="mt-6 w-full max-w-xs py-4 rounded-2xl bg-[#1A56DB] hover:bg-blue-600 text-white text-lg font-semibold transition-all disabled:opacity-50"
      >{{ loading ? 'جاري الفتح...' : 'فتح الوردية' }}</button>
      <button @click="back" class="mt-4 text-[#637285] text-sm">← رجوع</button>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/features/shifts/components/LockScreen.vue
git commit -m "feat(shifts): add LockScreen — 3-step shift open gate"
```

---

### Task 11: CashCountSheet + ZReportScreen

**Files:**
- Create: `src/features/shifts/components/CashCountSheet.vue`
- Create: `src/features/shifts/components/ZReportScreen.vue`

- [ ] **Step 1: Create CashCountSheet**

`src/features/shifts/components/CashCountSheet.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue'

const emit      = defineEmits<{ confirm: [usd: number, syp: number] }>()
const usdAmount = ref('')
const sypAmount = ref('')

function confirm() {
  emit('confirm', parseFloat(usdAmount.value) || 0, parseFloat(sypAmount.value) || 0)
}
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-end justify-center z-40" dir="rtl">
    <div class="bg-[#0D1828] rounded-t-3xl p-6 w-full max-w-lg">
      <h2 class="text-white text-xl font-bold mb-2 text-center">عدّ الصندوق</h2>
      <p class="text-[#637285] text-sm text-center mb-6">كم موجود في الصندوق الآن؟</p>

      <div class="flex flex-col gap-4 mb-6">
        <div class="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-3">
          <span class="text-[#637285] text-sm">دولار $</span>
          <input v-model="usdAmount" type="number" min="0" step="0.01"
            class="bg-transparent text-white text-xl w-full outline-none text-left"
            placeholder="0.00" dir="ltr" />
        </div>
        <div class="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-3">
          <span class="text-[#637285] text-sm">ليرة ل.س</span>
          <input v-model="sypAmount" type="number" min="0" step="1"
            class="bg-transparent text-white text-xl w-full outline-none text-left"
            placeholder="0" dir="ltr" />
        </div>
      </div>

      <button @click="confirm"
        class="w-full py-4 rounded-2xl bg-[#1A56DB] hover:bg-blue-600 text-white font-semibold text-lg transition-all">
        التالي — عرض التقرير
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create ZReportScreen**

`src/features/shifts/components/ZReportScreen.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted }  from 'vue'
import { useShift }        from '@/features/shifts/composables/useShift'
import { useZReport }      from '@/features/shifts/composables/useZReport'
import { useShiftStore }   from '@/features/shifts/shift.store'
import { useDeviceStore }  from '@/store/device.store'
import CashCountSheet      from './CashCountSheet.vue'
import type { ZReportMetrics } from '@/features/shifts/shift.types'
import type { CashierShift }   from '@/features/shifts/shift.types'

const { loadActiveShift, closeShift } = useShift()
const { compute, printZReport }       = useZReport()
const shiftStore = useShiftStore()
const device     = useDeviceStore()

const step       = ref<'cash-count' | 'report'>('cash-count')
const shift      = ref<CashierShift | null>(null)
const metrics    = ref<ZReportMetrics | null>(null)
const closingUsd = ref(0)
const closingSyp = ref(0)
const closing    = ref(false)

onMounted(async () => { shift.value = await loadActiveShift() })

async function onCashCounted(usd: number, syp: number) {
  if (!shift.value) return
  closingUsd.value = usd
  closingSyp.value = syp
  metrics.value = await compute(shift.value, usd, syp)
  step.value = 'report'
}

async function handleClose(withPrint: boolean) {
  if (!shift.value || !metrics.value) return
  closing.value = true
  try {
    if (withPrint) {
      printZReport(
        shift.value,
        shiftStore.activeStaff?.name ?? '',
        device.deviceCode,
        metrics.value
      )
    }
    await closeShift(closingUsd.value, closingSyp.value)
  } finally {
    closing.value = false
  }
}

const fmt    = (n: number) => `$${n.toFixed(2)}`
const fmtSyp = (n: number) => `${n.toLocaleString()} ل.س`
</script>

<template>
  <CashCountSheet v-if="step === 'cash-count'" @confirm="onCashCounted" />

  <div v-else-if="step === 'report' && metrics"
    class="fixed inset-0 bg-[#06090F] overflow-y-auto z-50 p-4" dir="rtl">

    <h1 class="text-white text-2xl font-bold text-center mb-4">تقرير الوردية</h1>

    <!-- Shift info -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8] space-y-1">
      <div class="flex justify-between"><span class="text-[#637285]">الكاشير</span><span>{{ shiftStore.activeStaff?.name }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">الجهاز</span><span>{{ device.deviceCode }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">فتح</span><span>{{ new Date(shift!.openedAt).toLocaleTimeString('ar-SY') }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">المدة</span><span>{{ Math.floor(metrics.durationMinutes / 60) }}س {{ metrics.durationMinutes % 60 }}د</span></div>
    </div>

    <!-- Sales summary -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8]">
      <p class="text-white font-semibold mb-2">المبيعات</p>
      <div class="flex justify-between mb-1"><span class="text-[#637285]">عدد الفواتير</span><span>{{ metrics.invoiceCount }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">إجمالي المبيعات</span><span class="text-white font-semibold">{{ fmt(metrics.totalRevenueUsd) }}</span></div>
    </div>

    <!-- Payment breakdown -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8] space-y-1">
      <p class="text-white font-semibold mb-2">تفصيل طريقة الدفع</p>
      <div class="flex justify-between"><span class="text-[#637285]">نقد دولار</span><span>{{ fmt(metrics.cashUsdSales) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">نقد ليرة</span><span>{{ fmtSyp(metrics.cashSypSalesRaw) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">بطاقة</span><span>{{ fmt(metrics.cardSales) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">آجل (دين)</span><span>{{ fmt(metrics.creditSales) }}</span></div>
    </div>

    <!-- Expenses -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8]">
      <p class="text-white font-semibold mb-2">المصاريف</p>
      <div class="flex justify-between"><span class="text-[#637285]">مصاريف الوردية</span><span>{{ fmt(metrics.cashExpensesUsd) }}</span></div>
    </div>

    <!-- Cash reconciliation -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-6 text-sm text-[#C8D5E8] space-y-1">
      <p class="text-white font-semibold mb-2">حساب الصندوق</p>
      <div class="flex justify-between"><span class="text-[#637285]">رصيد الفتح</span><span>{{ fmt(shift!.openingCashUsd) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">+ نقد مبيعات</span><span>{{ fmt(metrics.cashUsdSales) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">- مصاريف نقدية</span><span>{{ fmt(metrics.cashExpensesUsd) }}</span></div>
      <div class="flex justify-between border-t border-white/10 pt-1">
        <span class="text-[#637285]">متوقع في الصندوق</span><span>{{ fmt(metrics.expectedUsd) }}</span>
      </div>
      <div class="flex justify-between"><span class="text-[#637285]">عند العد الفعلي</span><span>{{ fmt(metrics.actualUsd) }}</span></div>
      <div class="flex justify-between font-semibold"
        :class="metrics.varianceUsd < 0 ? 'text-red-400' : 'text-green-400'">
        <span>الفرق</span>
        <span>{{ metrics.varianceUsd >= 0 ? '+' : '' }}{{ fmt(metrics.varianceUsd) }} {{ metrics.varianceUsd < 0 ? '⚠️' : '✓' }}</span>
      </div>
      <div class="border-t border-white/10 pt-2 mt-1 space-y-1">
        <div class="flex justify-between"><span class="text-[#637285]">ليرة متوقع</span><span>{{ fmtSyp(metrics.expectedSyp) }}</span></div>
        <div class="flex justify-between"><span class="text-[#637285]">ليرة عند العد</span><span>{{ fmtSyp(metrics.actualSyp) }}</span></div>
        <div class="flex justify-between font-semibold"
          :class="metrics.varianceSyp < 0 ? 'text-red-400' : 'text-green-400'">
          <span>فرق الليرة</span>
          <span>{{ metrics.varianceSyp >= 0 ? '+' : '' }}{{ fmtSyp(metrics.varianceSyp) }}</span>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex flex-col gap-3 pb-8">
      <button @click="handleClose(true)" :disabled="closing"
        class="w-full py-4 rounded-2xl bg-[#1A56DB] text-white font-semibold text-lg disabled:opacity-50">
        طباعة وإغلاق
      </button>
      <button @click="handleClose(false)" :disabled="closing"
        class="w-full py-4 rounded-2xl bg-white/10 text-white font-semibold disabled:opacity-50">
        إغلاق بدون طباعة
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add src/features/shifts/components/CashCountSheet.vue src/features/shifts/components/ZReportScreen.vue
git commit -m "feat(shifts): add CashCountSheet and ZReportScreen components"
```

---

### Task 12: Staff management UI

**Files:**
- Create: `src/features/staff/components/StaffForm.vue`
- Create: `src/features/staff/components/StaffList.vue`
- Modify: `src/pages/SettingsPage.vue`
- Modify: `src/router/index.ts`

- [ ] **Step 1: Create StaffForm**

`src/features/staff/components/StaffForm.vue`:
```vue
<script setup lang="ts">
import { ref, reactive }  from 'vue'
import { useStaff }       from '../composables/useStaff'
import PinPad             from './PinPad.vue'
import type { StaffRole, StaffPermissions } from '../staff.types'
import { DEFAULT_CASHIER_PERMISSIONS }      from '../staff.types'

const props = defineProps<{ editStaffId?: string }>()
const emit  = defineEmits<{ done: [] }>()

const { createStaff, updateStaffPin } = useStaff()

const name      = ref('')
const role      = ref<StaffRole>('cashier')
const pinStep   = ref<'first' | 'confirm'>('first')
const firstPin  = ref('')
const pinError  = ref('')
const pinPadRef = ref<InstanceType<typeof PinPad> | null>(null)
const saving    = ref(false)
const perms     = reactive<StaffPermissions>({ ...DEFAULT_CASHIER_PERMISSIONS })

const PERM_LABELS: Array<[keyof StaffPermissions, string]> = [
  ['can_view_reports',     'عرض التقارير'],
  ['can_manage_products',  'إدارة المنتجات'],
  ['can_manage_customers', 'إدارة الزبائن'],
  ['can_view_expenses',    'عرض المصاريف'],
  ['can_manage_settings',  'الإعدادات'],
]

async function onFirstPin(pin: string) {
  firstPin.value = pin
  pinStep.value  = 'confirm'
}

async function onConfirmPin(pin: string) {
  if (pin !== firstPin.value) {
    pinError.value = 'الرقمان لا يتطابقان'
    pinPadRef.value?.shake()
    pinStep.value  = 'first'
    firstPin.value = ''
    return
  }
  saving.value = true
  try {
    if (props.editStaffId) {
      await updateStaffPin(props.editStaffId, pin)
    } else {
      await createStaff({ name: name.value, pin, role: role.value, permissions: { ...perms } })
    }
    emit('done')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-4" dir="rtl">
    <!-- Name + role fields (new staff only) -->
    <template v-if="!editStaffId && !firstPin">
      <div class="w-full flex flex-col gap-3">
        <div>
          <label class="text-[#637285] text-sm block mb-1">الاسم</label>
          <input v-model="name"
            class="w-full bg-white/10 rounded-xl px-4 py-3 text-white outline-none"
            placeholder="اسم الموظف" />
        </div>
        <div>
          <label class="text-[#637285] text-sm block mb-1">الدور</label>
          <div class="flex gap-2">
            <button @click="role = 'cashier'"
              :class="['flex-1 py-2 rounded-xl text-sm font-medium', role === 'cashier' ? 'bg-[#1A56DB] text-white' : 'bg-white/10 text-[#C8D5E8]']">
              كاشير</button>
            <button @click="role = 'owner'"
              :class="['flex-1 py-2 rounded-xl text-sm font-medium', role === 'owner' ? 'bg-[#1A56DB] text-white' : 'bg-white/10 text-[#C8D5E8]']">
              مالك</button>
          </div>
        </div>
        <div v-if="role === 'cashier'" class="bg-white/5 rounded-xl p-4 space-y-3">
          <p class="text-[#637285] text-sm">الصلاحيات</p>
          <label v-for="[key, label] in PERM_LABELS" :key="key"
            class="flex items-center justify-between">
            <span class="text-[#C8D5E8] text-sm">{{ label }}</span>
            <input type="checkbox" v-model="(perms as any)[key]" class="w-5 h-5 accent-[#1A56DB]" />
          </label>
        </div>
      </div>
    </template>

    <p class="text-white text-base">
      {{ pinStep === 'first'
        ? (editStaffId ? 'أدخل الرقم السري الجديد' : 'أنشئ رقماً سرياً (4 أرقام)')
        : 'أكّد الرقم السري' }}
    </p>
    <p v-if="pinError" class="text-red-400 text-sm">{{ pinError }}</p>

    <PinPad
      ref="pinPadRef"
      @complete="pinStep === 'first' ? onFirstPin($event) : onConfirmPin($event)"
    />
  </div>
</template>
```

- [ ] **Step 2: Create StaffList**

`src/features/staff/components/StaffList.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted }  from 'vue'
import { useStaff }        from '../composables/useStaff'
import StaffForm           from './StaffForm.vue'
import type { Staff }      from '../staff.types'

const { staff, loadStaff, deactivateStaff } = useStaff()
const showForm    = ref(false)
const editStaffId = ref<string | undefined>()

onMounted(() => loadStaff())

function startEdit(s: Staff) { editStaffId.value = s.id; showForm.value = true }
function startAdd()          { editStaffId.value = undefined; showForm.value = true }

async function deactivate(s: Staff) {
  if (!confirm(`هل تريد إلغاء تفعيل ${s.name}؟`)) return
  await deactivateStaff(s.id)
}

function onFormDone() { showForm.value = false; loadStaff() }
</script>

<template>
  <div class="p-4 max-w-lg mx-auto" dir="rtl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-white text-xl font-bold">الموظفون</h1>
      <button @click="startAdd"
        class="bg-[#1A56DB] text-white px-4 py-2 rounded-xl text-sm font-medium">
        + إضافة موظف
      </button>
    </div>

    <div class="flex flex-col gap-3">
      <div v-for="s in staff" :key="s.id"
        class="bg-[#0D1828] rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p class="text-white font-medium">{{ s.name }}</p>
          <span :class="['text-xs px-2 py-0.5 rounded-full mt-1 inline-block',
            s.role === 'owner' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400']">
            {{ s.role === 'owner' ? 'مالك' : 'كاشير' }}
          </span>
        </div>
        <div class="flex gap-2" v-if="s.role !== 'owner'">
          <button @click="startEdit(s)"
            class="text-[#637285] text-sm px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10">
            تغيير PIN
          </button>
          <button @click="deactivate(s)"
            class="text-red-400 text-sm px-3 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20">
            إلغاء
          </button>
        </div>
      </div>
    </div>

    <!-- Form modal -->
    <div v-if="showForm" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div class="bg-[#0D1828] rounded-3xl p-6 w-full max-w-sm mx-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-white font-semibold">{{ editStaffId ? 'تغيير الرقم السري' : 'موظف جديد' }}</h2>
          <button @click="showForm = false" class="text-[#637285]">✕</button>
        </div>
        <StaffForm :edit-staff-id="editStaffId" @done="onFormDone" />
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Add staff route to router**

In `src/router/index.ts`, add inside the `routes` array:
```ts
{ path: '/settings/staff',  component: () => import('@/features/staff/components/StaffList.vue') },
{ path: '/shifts/history',  component: () => import('@/features/shifts/components/ShiftHistoryScreen.vue') },
{ path: '/setup-owner',     component: () => import('@/features/shifts/components/OwnerSetupScreen.vue') },
```

Also add `{ path: 'staff', component: () => import('@/features/staff/components/StaffList.vue') }` as a child of the `/settings` route.

- [ ] **Step 4: Add staff entry to SettingsPage**

In `src/pages/SettingsPage.vue`, find the block with the receipt settings button and add a staff button after it (same pattern — both in the mobile and desktop nav sections):

Mobile section — after the receipt button:
```html
<button
  type="button"
  class="w-full flex items-center justify-between px-4 py-3.5 border-b border-border-glass text-sm text-text-primary active:bg-surface-glass"
  @click="router.push('/settings/staff')"
>
  <span>الموظفون</span>
  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
  </svg>
</button>
```

Desktop sidebar nav — after the receipt RouterLink:
```html
<RouterLink
  to="/settings/staff"
  class="flex items-center justify-between px-4 py-3.5 text-sm border-b border-border-glass transition-colors"
  :class="route.path === '/settings/staff'
    ? 'text-gold-primary bg-surface-raised font-semibold'
    : 'text-text-muted hover:bg-surface-glass hover:text-text-primary'"
>
  <span>الموظفون</span>
  <span v-if="route.path === '/settings/staff'" class="w-1.5 h-1.5 rounded-full bg-gold-primary" />
</RouterLink>
```

- [ ] **Step 5: Commit**

```bash
git add src/features/staff/components/StaffList.vue src/features/staff/components/StaffForm.vue src/router/index.ts src/pages/SettingsPage.vue
git commit -m "feat(staff): staff management UI — list, add, PIN change, deactivate + settings route"
```

---

### Task 13: OwnerSetupScreen

**Files:**
- Create: `src/features/shifts/components/OwnerSetupScreen.vue`

One-time screen shown on first launch when no staff exist.

- [ ] **Step 1: Create OwnerSetupScreen**

`src/features/shifts/components/OwnerSetupScreen.vue`:
```vue
<script setup lang="ts">
import { useRouter }  from 'vue-router'
import StaffForm      from '@/features/staff/components/StaffForm.vue'

const router = useRouter()

function onDone() {
  router.push('/')
}
</script>

<template>
  <div class="fixed inset-0 bg-[#06090F] flex flex-col items-center justify-center p-6" dir="rtl">
    <div class="text-white text-3xl font-bold mb-2">وافي</div>
    <p class="text-[#637285] mb-8 text-sm text-center">إعداد أول مرة — أنشئ حساب المالك</p>
    <div class="w-full max-w-sm bg-[#0D1828] rounded-3xl p-6">
      <StaffForm @done="onDone" />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/features/shifts/components/OwnerSetupScreen.vue
git commit -m "feat(shifts): add OwnerSetupScreen — first-launch owner setup"
```

---

### Task 14: App-level shift gate

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Add imports and gate logic to App.vue**

At the top of `<script setup>` in `src/App.vue`, add after the existing imports:
```ts
import { onMounted, ref }  from 'vue'
import { useRouter }       from 'vue-router'
import { useShiftStore }   from '@/features/shifts/shift.store'
import { useShift }        from '@/features/shifts/composables/useShift'
import { useStaff }        from '@/features/staff/composables/useStaff'
import LockScreen          from '@/features/shifts/components/LockScreen.vue'

const shiftStore = useShiftStore()
const { loadActiveShift } = useShift()
const { hasAnyStaff }     = useStaff()
const router    = useRouter()
const appReady  = ref(false)

onMounted(async () => {
  const staffExist = await hasAnyStaff()
  if (!staffExist) {
    router.push('/setup-owner')
    appReady.value = true
    return
  }
  if (shiftStore.activeShiftId) {
    await loadActiveShift()  // validates and clears store if shift was closed
  }
  appReady.value = true
})
```

- [ ] **Step 2: Wrap the template**

Replace the entire `<template>` block in `src/App.vue` with:
```html
<template>
  <!-- Loading splash -->
  <div v-if="!appReady" class="fixed inset-0 bg-[#06090F] flex items-center justify-center">
    <span class="text-[#637285] text-sm">جاري التحميل...</span>
  </div>

  <template v-else>
    <!-- Shift gate — blocks the whole app when no shift is open -->
    <LockScreen v-if="!shiftStore.isShiftOpen" />

    <!-- Normal app shell -->
    <div
      v-else
      id="app"
      :dir="settings.language === 'ar' ? 'rtl' : 'ltr'"
      :lang="settings.language"
      class="h-dvh bg-bg-void text-text-primary flex overflow-hidden"
    >
      <AppSidebar v-if="showSidebar" class="hidden lg:flex" />
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto">
          <RouterView />
        </div>
        <AppBottomNav v-if="showBottomNav" class="lg:hidden" />
      </div>
    </div>
  </template>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat(shifts): add app-level shift gate — LockScreen blocks app until shift is open"
```

---

### Task 15: Add shift_id to sale writes

**Files:**
- Modify: `src/features/payment/usePayment.ts`

The sale INSERT is at line 147–159 of `src/features/payment/usePayment.ts`.

- [ ] **Step 1: Add shiftStore import**

At the top of `src/features/payment/usePayment.ts`, add:
```ts
import { useShiftStore } from '@/features/shifts/shift.store'
```

- [ ] **Step 2: Instantiate shiftStore inside usePayment()**

Inside `export function usePayment()`, after the existing store instantiations:
```ts
const shiftStore = useShiftStore()
```

- [ ] **Step 3: Add shift_id to the INSERT statement**

Find the `INSERT INTO sales` query (around line 147). Change the column list and values list:

Before:
```ts
`INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
  created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
  amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
[
  saleId, deviceStore.shopId, deviceStore.deviceId,
  saleStore.deviceSequence, displayNum, now,
  totalUsd.value, totalSyp.value, saleStore.lockedExchangeRate,
  primaryMethod, totalReceived, 'USD', lastChange ?? null,
  customerId ?? null, customerId ? 1 : 0, isSplit ? 1 : 0,
]
```

After:
```ts
`INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
  created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
  amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split,
  shift_id)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
[
  saleId, deviceStore.shopId, deviceStore.deviceId,
  saleStore.deviceSequence, displayNum, now,
  totalUsd.value, totalSyp.value, saleStore.lockedExchangeRate,
  primaryMethod, totalReceived, 'USD', lastChange ?? null,
  customerId ?? null, customerId ? 1 : 0, isSplit ? 1 : 0,
  shiftStore.activeShiftId,   // nullable — null for sales before shift system
]
```

- [ ] **Step 4: Commit**

```bash
git add src/features/payment/usePayment.ts
git commit -m "feat(payment): include active shift_id in sale INSERT"
```

---

### Task 16: Sidebar updates — permission guard + close shift

**Files:**
- Modify: `src/components/layout/AppSidebar.vue`

The current sidebar has `shifts` at index 5 with `enabled: false`. Enable it and add the permission filter + close-shift button.

- [ ] **Step 1: Add imports to AppSidebar.vue**

In `src/components/layout/AppSidebar.vue`, replace the `<script setup>` block:
```ts
import { ref, computed }   from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useShiftStore }   from '@/features/shifts/shift.store'
import ZReportScreen       from '@/features/shifts/components/ZReportScreen.vue'

const route      = useRoute()
const shiftStore = useShiftStore()
const showZReport = ref(false)

interface NavItem {
  key:        string
  label:      string
  href:       string | null
  permission: string | null    // key of StaffPermissions, or null = always visible
}

const allNavItems: NavItem[] = [
  { key: 'home',      label: 'الرئيسية',  href: '/',              permission: null },
  { key: 'history',   label: 'المبيعات',  href: '/history',       permission: null },
  { key: 'products',  label: 'المنتجات',  href: '/products',      permission: 'can_manage_products' },
  { key: 'reports',   label: 'التقارير',  href: null,             permission: 'can_view_reports' },
  { key: 'expenses',  label: 'المصاريف',  href: '/expenses',      permission: 'can_view_expenses' },
  { key: 'shifts',    label: 'الورديات',  href: '/shifts/history', permission: null },
  { key: 'customers', label: 'العملاء',   href: '/customers',     permission: 'can_manage_customers' },
]

const navItems = computed(() => {
  const perms = shiftStore.permissions
  const isOwner = shiftStore.activeStaff?.role === 'owner'
  if (!perms || isOwner) return allNavItems.filter(i => i.href !== null)
  return allNavItems.filter(i =>
    i.href !== null && (!i.permission || (perms as any)[i.permission])
  )
})

function isActive(href: string | null): boolean {
  if (!href) return false
  if (href === '/') return route.path === '/'
  return route.path === href || route.path.startsWith(href + '/')
}
```

- [ ] **Step 2: Update sidebar template**

Replace the brand `<span>` that shows "وافي" to also show the cashier name:
```html
<RouterLink to="/" class="flex items-center gap-2 px-5 h-14 border-b border-border-glass hover:bg-surface-glass transition-colors flex-shrink-0">
  <span class="font-display text-xl text-gold-primary font-semibold tracking-wide">وافي</span>
  <span class="text-xs text-text-muted truncate max-w-20">{{ shiftStore.activeStaff?.name ?? 'الإدارة' }}</span>
</RouterLink>
```

Replace the `v-for` loop to use the computed `navItems`:
```html
<component
  v-for="item in navItems"
  :key="item.key"
  :is="item.href ? RouterLink : 'div'"
  v-bind="item.href ? { to: item.href } : {}"
  class="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all"
  :class="[
    isActive(item.href)
      ? 'bg-surface-raised text-gold-primary font-semibold'
      : 'text-text-muted hover:bg-surface-glass hover:text-text-primary cursor-pointer',
  ]"
>
  <!-- keep all existing SVG icon v-if blocks unchanged -->
  <span class="flex-1">{{ item.label }}</span>
  <span v-if="isActive(item.href)" class="w-1.5 h-1.5 rounded-full bg-gold-primary flex-shrink-0" />
</component>
```

Add close-shift button before the closing `</aside>` tag, after the settings `<div>`:
```html
<!-- Close shift -->
<div class="p-2 border-t border-border-glass flex-shrink-0">
  <button
    @click="showZReport = true"
    class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
    <span>إغلاق الوردية</span>
  </button>
</div>

<ZReportScreen v-if="showZReport" />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppSidebar.vue
git commit -m "feat(shifts): sidebar — permission-filtered nav, cashier name, close-shift button"
```

---

### Task 17: Shift history screen + index files

**Files:**
- Create: `src/features/shifts/components/ShiftHistoryScreen.vue`
- Create: `src/features/shifts/index.ts`
- Create: `src/features/staff/index.ts`

- [ ] **Step 1: Create ShiftHistoryScreen**

`src/features/shifts/components/ShiftHistoryScreen.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useShift }       from '@/features/shifts/composables/useShift'
import type { CashierShift } from '@/features/shifts/shift.types'

const { loadShiftHistory } = useShift()
const shifts  = ref<CashierShift[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try { shifts.value = await loadShiftHistory() }
  finally { loading.value = false }
})

function fmtDate(iso: string)     { return new Date(iso).toLocaleDateString('ar-SY') }
function fmtTime(iso: string)     { return new Date(iso).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }) }
function fmtDuration(s: CashierShift): string {
  if (!s.closedAt) return 'مفتوحة'
  const ms    = new Date(s.closedAt).getTime() - new Date(s.openedAt).getTime()
  const mins  = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  return hours > 0 ? `${hours}س ${mins % 60}د` : `${mins}د`
}
</script>

<template>
  <div class="p-4 max-w-lg mx-auto" dir="rtl">
    <h1 class="text-white text-xl font-bold mb-4">سجل الورديات</h1>

    <div v-if="loading" class="text-[#637285] text-center py-8">جاري التحميل...</div>

    <div v-else-if="shifts.length === 0" class="text-[#637285] text-center py-8">
      لا توجد ورديات مسجّلة بعد
    </div>

    <div v-else class="flex flex-col gap-3">
      <div v-for="s in shifts" :key="s.id" class="bg-[#0D1828] rounded-2xl p-4">
        <div class="flex items-center justify-between mb-1">
          <span class="text-white font-medium">{{ fmtDate(s.openedAt) }}</span>
          <span :class="['text-xs px-2 py-0.5 rounded-full',
            s.status === 'open' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-[#637285]']">
            {{ s.status === 'open' ? 'مفتوحة' : 'مغلقة' }}
          </span>
        </div>
        <div class="text-[#637285] text-sm space-y-0.5">
          <div>{{ fmtTime(s.openedAt) }} — {{ s.closedAt ? fmtTime(s.closedAt) : '...' }}</div>
          <div>المدة: {{ fmtDuration(s) }}</div>
          <div v-if="s.closingCashUsd !== null">عند الإغلاق: ${{ s.closingCashUsd?.toFixed(2) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create index files**

`src/features/shifts/index.ts`:
```ts
export { useShiftStore }  from './shift.store'
export { useShift }       from './composables/useShift'
export { useZReport }     from './composables/useZReport'
export type { CashierShift, ZReportMetrics } from './shift.types'
```

`src/features/staff/index.ts`:
```ts
export { useStaff }               from './composables/useStaff'
export { hashPin, verifyPin }     from './composables/usePinAuth'
export type { Staff, NewStaff, StaffPermissions, StaffRole } from './staff.types'
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run src/features/staff/composables/__tests__/usePinAuth.test.ts src/features/shifts/composables/__tests__/cashReconciliation.test.ts src/features/shifts/composables/__tests__/useShiftStore.test.ts
```
Expected: all 15 tests PASS

- [ ] **Step 4: Full smoke test**

Start the dev server: `npm run dev`

1. Clear localStorage (DevTools → Application → Clear site data) to start fresh
2. App loads → redirects to `/setup-owner` (OwnerSetupScreen)
3. Enter name and set a 4-digit PIN twice → owner created
4. App redirects to `/` → LockScreen appears with the owner's name
5. Tap owner name → PIN pad → enter correct PIN → opening cash screen → enter $50 → home loads
6. Sidebar shows owner name next to "وافي", "إغلاق الوردية" button at bottom
7. Ring a sale through the POS → confirm payment
8. In browser console verify: `await db.execute("SELECT shift_id FROM sales ORDER BY created_at DESC LIMIT 1")` shows non-null `shift_id`
9. Navigate to Settings → see "الموظفون" entry → add a cashier with limited permissions
10. Close the shift via "إغلاق الوردية" → cash count screen → enter cash → Z-report preview → "إغلاق بدون طباعة" → back to LockScreen
11. Log in as the cashier → verify hidden nav items based on permissions
12. Navigate to `/shifts/history` → see the closed shift listed

- [ ] **Step 5: Final commit**

```bash
git add src/features/shifts/components/ShiftHistoryScreen.vue src/features/shifts/index.ts src/features/staff/index.ts
git commit -m "feat(shifts): shift history screen and feature index files — epic complete"
```
