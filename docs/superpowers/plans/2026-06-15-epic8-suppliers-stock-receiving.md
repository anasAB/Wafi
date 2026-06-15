# Epic 8 — Suppliers & Stock Receiving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner/manager record an itemized delivery from a supplier (with an invoice photo), automatically increasing product stock and optionally refreshing cost prices — closing the inventory loop opened in Epic 2.

**Architecture:** A new `src/features/suppliers/` feature, following the established feature-first pattern (PowerSync tables + composables + Vue SFCs + plain-language Arabic UI). Three new tables: `suppliers`, `stock_receivings`, `stock_receiving_line_items`. The receiving `confirm()` mirrors `useReturnSheet.confirm()`: a single `writeTransaction` inserts the receiving + lines, increments `products.current_stock`, and updates `products.cost_price_usd` where the per-line toggle is on; `receiving.created` is logged to the audit trail after commit. A receiving is immutable. Access is gated by the `can_manage_products` permission (there is no `manager` role in code; "Owner + Manager" = anyone who can manage products).

**Tech Stack:** Vue 3 (`<script setup>`), TypeScript, Pinia, PowerSync (SQLite), Vitest, uuid. RTL Arabic UI.

---

## File structure

```
src/features/suppliers/
  supplier.types.ts                         # Supplier, SupplierWithStats, NewSupplier
  receiving.types.ts                        # ReceivingLine, Receiving, ReceivingDetailData
  SuppliersPage.vue                         # supplier list (route /suppliers)
  SupplierDetailPage.vue                    # supplier info + receiving history (/suppliers/:id)
  ReceivingsPage.vue                        # global receiving history (/receivings)
  components/
    SupplierForm.vue                        # add/edit supplier
    SupplierPickerModal.vue                 # pick/add supplier inside ReceivingSheet
    ReceivingProductPicker.vue              # search/scan products, quick-add on the fly
    ReceivingLineItem.vue                    # one editable line (qty, unit cost, cost toggle)
    ReceivingSheet.vue                       # the create-a-receiving flow
    ReceivingDetail.vue                      # read-only saved receiving
  composables/
    useSuppliers.ts                          # CRUD + purchase stats
    useReceivings.ts                         # history list + load one
    useReceivingSheet.ts                     # draft + line mgmt + confirm()

Modified:
  src/data/powersync/schema.ts               # 3 new tables + AppSchema registration
  src/features/audit/audit.types.ts          # new events + 'supplier'/'receiving' entity types
  src/features/audit/composables/useAuditLog.ts  # logSupplierCreated/Updated, logReceivingCreated
  src/router/index.ts                         # 3 new routes
  src/components/layout/AppSidebar.vue        # suppliers nav entry

Tests (in src/__tests__/features/):
  useSuppliers.test.ts
  useReceivingSheet.test.ts
  useReceivings.test.ts
  SupplierForm.test.ts
  useAuditLog.test.ts (extend existing)
```

---

## Task 1: Add database tables

**Files:**
- Modify: `src/data/powersync/schema.ts`

- [ ] **Step 1: Add the three tables before the `AppSchema` export**

Insert after the `audit_log` table definition (around line 193), before `export const AppSchema`:

```ts
const suppliers = new Table({
  shop_id:        column.text,
  name:           column.text,
  phone:          column.text,
  contact_person: column.text,
  address:        column.text,
  notes:          column.text,
  deleted:        column.integer,
  created_at:     column.text,
  sync_status:    column.text,
})

const stock_receivings = new Table({
  shop_id:                    column.text,
  supplier_id:                column.text,
  received_at:                column.text,
  invoice_photo_url:          column.text,
  total_cost_usd:             column.real,
  exchange_rate_at_receiving: column.real,
  notes:                      column.text,
  staff_id:                   column.text,
  sync_status:                column.text,
})

const stock_receiving_line_items = new Table({
  receiving_id:  column.text,
  shop_id:       column.text,
  product_id:    column.text,
  qty_received:  column.integer,
  unit_cost_usd: column.real,
  cost_updated:  column.integer,
  sync_status:   column.text,
})
```

- [ ] **Step 2: Register them in `AppSchema`**

Add the three names to the `new Schema({ ... })` object (after `audit_log,`):

```ts
  audit_log,
  suppliers,
  stock_receivings,
  stock_receiving_line_items,
})
```

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no new errors from `schema.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(suppliers): add suppliers, stock_receivings, line items to schema"
```

---

## Task 2: Supplier and receiving types

**Files:**
- Create: `src/features/suppliers/supplier.types.ts`
- Create: `src/features/suppliers/receiving.types.ts`

- [ ] **Step 1: Write `supplier.types.ts`**

```ts
export interface Supplier {
  id:             string
  shopId:         string
  name:           string
  phone?:         string
  contactPerson?: string
  address?:       string
  notes?:         string
  deleted:        boolean
  createdAt:      string
  syncStatus:     string
}

export interface SupplierWithStats extends Supplier {
  totalPurchasedUsd: number
  lastReceivedAt:    string | null
}

export interface NewSupplier {
  name:           string
  phone?:         string
  contactPerson?: string
  address?:       string
  notes?:         string
}
```

- [ ] **Step 2: Write `receiving.types.ts`**

```ts
// One editable row while building a receiving.
export interface ReceivingLine {
  productId:      string
  productName:    string
  currentCostUsd: number   // product's standing cost_price_usd (for the toggle prompt)
  qtyReceived:    number
  unitCostUsd:    number    // cost entered for THIS delivery
  updateCost:     boolean   // update product.cost_price_usd on confirm
}

// A saved receiving header (history list).
export interface Receiving {
  id:                   string
  shopId:               string
  supplierId:           string
  supplierName:         string   // joined for display
  receivedAt:           string
  invoicePhotoUrl?:     string
  totalCostUsd:         number
  exchangeRateAtReceiving: number
  notes?:               string
  staffId?:             string
}

// A saved receiving with its lines, for the read-only detail view.
export interface ReceivingDetailData {
  header: Receiving
  lines: Array<{
    productId:    string
    productName:  string
    qtyReceived:  number
    unitCostUsd:  number
    costUpdated:  boolean
  }>
}
```

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/suppliers/supplier.types.ts src/features/suppliers/receiving.types.ts
git commit -m "feat(suppliers): add supplier and receiving types"
```

---

## Task 3: Audit log support

**Files:**
- Modify: `src/features/audit/audit.types.ts`
- Modify: `src/features/audit/composables/useAuditLog.ts`
- Test: `src/__tests__/features/useAuditLog.test.ts`

- [ ] **Step 1: Add events and entity types**

In `audit.types.ts`, add to the `AuditEvent` union (after `'staff.permissions_changed'`):

```ts
  | 'supplier.created'
  | 'supplier.updated'
  | 'receiving.created'
```

And to the `AuditEntityType` union (after `'staff'`):

```ts
  | 'supplier' | 'receiving'
```

- [ ] **Step 2: Write failing test for the new helpers**

Add to `src/__tests__/features/useAuditLog.test.ts` a new `describe` block (mirror the existing tests in that file — they assert `db.execute` is called with the event string). Use the same imports/mocks already at the top of the file:

```ts
describe('useAuditLog — supplier & receiving helpers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('logSupplierCreated writes a supplier.created row', async () => {
    const { logSupplierCreated } = useAuditLog()
    await logSupplierCreated('sup-1', 'مؤسسة النور')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['supplier.created', 'supplier', 'sup-1']),
    )
  })

  it('logReceivingCreated writes a receiving.created row', async () => {
    const { logReceivingCreated } = useAuditLog()
    await logReceivingCreated('rcv-1', 'مؤسسة النور', 1200, 5)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['receiving.created', 'receiving', 'rcv-1']),
    )
  })
})
```

> Note: if the existing test file does not already import `setActivePinia`/`createPinia`, add `import { setActivePinia, createPinia } from 'pinia'` at the top.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts`
Expected: FAIL — `logSupplierCreated`/`logReceivingCreated` are not exported.

- [ ] **Step 4: Add the helpers to `useAuditLog.ts`**

After `logStaffPermissionsChanged` (around line 155), add:

```ts
  const logSupplierCreated = (supplierId: string, name: string) =>
    _log('supplier.created', 'supplier', supplierId, { name })

  const logSupplierUpdated = (supplierId: string, name: string) =>
    _log('supplier.updated', 'supplier', supplierId, { name })

  const logReceivingCreated = (
    receivingId: string, supplierName: string, totalUsd: number, lineCount: number,
  ) => _log('receiving.created', 'receiving', receivingId,
            { supplierName, totalUsd, lineCount })
```

Then add all three to the returned object (after `logStaffPermissionsChanged,`):

```ts
    logSupplierCreated,
    logSupplierUpdated,
    logReceivingCreated,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/audit/audit.types.ts src/features/audit/composables/useAuditLog.ts src/__tests__/features/useAuditLog.test.ts
git commit -m "feat(audit): add supplier and receiving audit events"
```

---

## Task 4: `useSuppliers` composable

**Files:**
- Create: `src/features/suppliers/composables/useSuppliers.ts`
- Test: `src/__tests__/features/useSuppliers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/features/useSuppliers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useSuppliers } from '@/features/suppliers/composables/useSuppliers'
import { db } from '@/data/powersync/db'

describe('useSuppliers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load() maps rows to SupplierWithStats', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 's1', shop_id: 'shop', name: 'النور', phone: '011', contact_person: null,
        address: null, notes: null, deleted: 0, created_at: 't', sync_status: 'synced',
        total_purchased_usd: 1200, last_received_at: '2026-06-10' },
    ] as any)
    const { load, suppliers } = useSuppliers()
    await load()
    expect(suppliers.value).toHaveLength(1)
    expect(suppliers.value[0]).toMatchObject({
      id: 's1', name: 'النور', phone: '011',
      totalPurchasedUsd: 1200, lastReceivedAt: '2026-06-10',
    })
  })

  it('save() inserts a supplier and returns its id', async () => {
    const { save } = useSuppliers()
    const id = await save({ name: 'مؤسسة النور', phone: '0999' })
    expect(typeof id).toBe('string')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO suppliers'),
      expect.arrayContaining([id, 'مؤسسة النور', '0999']),
    )
  })

  it('update() builds a dynamic SET clause', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'النور' } as any)
    const { update } = useSuppliers()
    await update('s1', { phone: '0555' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE suppliers SET .*phone = \?/),
      expect.arrayContaining(['0555', 's1']),
    )
  })

  it('softDelete() sets deleted = 1', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'النور' } as any)
    const { softDelete } = useSuppliers()
    await softDelete('s1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE suppliers SET deleted = 1'),
      expect.arrayContaining(['s1']),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useSuppliers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `useSuppliers.ts`**

```ts
import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Supplier, SupplierWithStats, NewSupplier } from '../supplier.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

type SupplierStatsRow = {
  id: string; shop_id: string; name: string; phone: string | null
  contact_person: string | null; address: string | null; notes: string | null
  deleted: number; created_at: string; sync_status: string
  total_purchased_usd: number | null; last_received_at: string | null
}

function rowToSupplier(r: SupplierStatsRow): SupplierWithStats {
  return {
    id: r.id, shopId: r.shop_id, name: r.name,
    phone:         r.phone          ?? undefined,
    contactPerson: r.contact_person ?? undefined,
    address:       r.address        ?? undefined,
    notes:         r.notes          ?? undefined,
    deleted:   r.deleted === 1,
    createdAt: r.created_at, syncStatus: r.sync_status,
    totalPurchasedUsd: r.total_purchased_usd ?? 0,
    lastReceivedAt:    r.last_received_at,
  }
}

export function useSuppliers() {
  const suppliers = ref<SupplierWithStats[]>([])
  const { logSupplierCreated, logSupplierUpdated } = useAuditLog()

  // last_received_at DESC puts NULLs last in SQLite, so never-received suppliers sink.
  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<SupplierStatsRow>(
      `SELECT s.*,
              COALESCE(SUM(sr.total_cost_usd), 0) AS total_purchased_usd,
              MAX(sr.received_at)                 AS last_received_at
       FROM suppliers s
       LEFT JOIN stock_receivings sr ON sr.supplier_id = s.id
       WHERE s.shop_id = ? AND (s.deleted = 0 OR s.deleted IS NULL)
       GROUP BY s.id
       ORDER BY last_received_at DESC, s.name ASC`,
      [device.shopId],
    )
    suppliers.value = rows.map(rowToSupplier)
  }

  async function getById(id: string): Promise<Supplier | null> {
    const r = await db.getOptional<SupplierStatsRow>(
      `SELECT *, 0 AS total_purchased_usd, NULL AS last_received_at
       FROM suppliers WHERE id = ?`, [id],
    )
    return r ? rowToSupplier(r) : null
  }

  async function search(q: string): Promise<SupplierWithStats[]> {
    const device = useDeviceStore()
    const rows = await db.getAll<SupplierStatsRow>(
      `SELECT *, 0 AS total_purchased_usd, NULL AS last_received_at
       FROM suppliers
       WHERE shop_id = ? AND (deleted = 0 OR deleted IS NULL) AND name LIKE ?
       ORDER BY name ASC`,
      [device.shopId, `%${q}%`],
    )
    return rows.map(rowToSupplier)
  }

  async function save(data: NewSupplier): Promise<string> {
    const device = useDeviceStore()
    const id = uuidv4()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO suppliers
         (id, shop_id, name, phone, contact_person, address, notes, deleted, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [id, device.shopId, data.name, data.phone ?? null, data.contactPerson ?? null,
       data.address ?? null, data.notes ?? null, now],
    )
    await logSupplierCreated(id, data.name)
    return id
  }

  async function update(id: string, data: Partial<NewSupplier>): Promise<void> {
    const device = useDeviceStore()
    const sets: string[] = []
    const vals: (string | null)[] = []
    if (data.name          !== undefined) { sets.push('name = ?');           vals.push(data.name) }
    if (data.phone         !== undefined) { sets.push('phone = ?');          vals.push(data.phone ?? null) }
    if (data.contactPerson !== undefined) { sets.push('contact_person = ?'); vals.push(data.contactPerson ?? null) }
    if (data.address       !== undefined) { sets.push('address = ?');        vals.push(data.address ?? null) }
    if (data.notes         !== undefined) { sets.push('notes = ?');          vals.push(data.notes ?? null) }
    if (!sets.length) return
    sets.push("sync_status = 'pending'")
    await db.execute(
      `UPDATE suppliers SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`,
      [...vals, id, device.shopId],
    )
    const nameRow = await db.getOptional<{ name: string }>(
      `SELECT name FROM suppliers WHERE id = ?`, [id],
    )
    await logSupplierUpdated(id, nameRow?.name ?? id)
  }

  async function softDelete(id: string): Promise<void> {
    const device = useDeviceStore()
    await db.execute(
      `UPDATE suppliers SET deleted = 1, sync_status = 'pending' WHERE id = ? AND shop_id = ?`,
      [id, device.shopId],
    )
  }

  return { suppliers, load, getById, search, save, update, softDelete }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useSuppliers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/suppliers/composables/useSuppliers.ts src/__tests__/features/useSuppliers.test.ts
git commit -m "feat(suppliers): add useSuppliers composable with CRUD and stats"
```

---

## Task 5: `useReceivingSheet` composable (core logic)

**Files:**
- Create: `src/features/suppliers/composables/useReceivingSheet.ts`
- Test: `src/__tests__/features/useReceivingSheet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/features/useReceivingSheet.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReceivingSheet } from '@/features/suppliers/composables/useReceivingSheet'
import { db } from '@/data/powersync/db'

function addStandardLine(sheet: ReturnType<typeof useReceivingSheet>) {
  sheet.addLine({ id: 'p1', nameAr: 'iPhone', costPriceUsd: 400 } as any)
  sheet.lines.value[0].qtyReceived = 3
  sheet.lines.value[0].unitCostUsd = 450
}

function setupWriteTransaction(txMockFn?: ReturnType<typeof vi.fn>) {
  const txExecute = txMockFn ?? vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
  vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
    await fn({ execute: txExecute })
  })
  return txExecute
}

describe('useReceivingSheet — state', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('canConfirm is false without a supplier', () => {
    const sheet = useReceivingSheet()
    addStandardLine(sheet)
    expect(sheet.canConfirm.value).toBe(false)
  })

  it('canConfirm is false with a supplier but no lines', () => {
    const sheet = useReceivingSheet()
    sheet.supplierId.value = 's1'
    expect(sheet.canConfirm.value).toBe(false)
  })

  it('canConfirm is true with supplier + a positive-qty line', () => {
    const sheet = useReceivingSheet()
    sheet.supplierId.value = 's1'
    addStandardLine(sheet)
    expect(sheet.canConfirm.value).toBe(true)
  })

  it('totalCostUsd sums qty × unitCost across lines', () => {
    const sheet = useReceivingSheet()
    addStandardLine(sheet)                       // 3 × 450 = 1350
    sheet.addLine({ id: 'p2', nameAr: 'Cable', costPriceUsd: 2 } as any)
    sheet.lines.value[1].qtyReceived = 10
    sheet.lines.value[1].unitCostUsd = 3         // 10 × 3 = 30
    expect(sheet.totalCostUsd.value).toBe(1380)
  })

  it('addLine defaults updateCost on and copies current cost', () => {
    const sheet = useReceivingSheet()
    sheet.addLine({ id: 'p1', nameAr: 'iPhone', costPriceUsd: 400 } as any)
    expect(sheet.lines.value[0]).toMatchObject({
      productId: 'p1', productName: 'iPhone',
      currentCostUsd: 400, qtyReceived: 1, unitCostUsd: 400, updateCost: true,
    })
  })
})

describe('useReceivingSheet — confirm()', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  async function ready(sheet = useReceivingSheet()) {
    sheet.supplierId.value   = 's1'
    sheet.supplierName.value = 'النور'
    addStandardLine(sheet)
    // exchange-rate lookup (db.execute, outside transaction)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [{ rate: 12500 }] } } as any)
    return sheet
  }

  it('inserts a stock_receivings row with supplier and total', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await ready()
    await sheet.confirm()
    const call = (txExecute.mock.calls as any[]).find(([s]) => s.includes('INSERT INTO stock_receivings'))
    expect(call).toBeDefined()
    expect(call[1][2]).toBe('s1')    // supplier_id
    expect(call[1][5]).toBe(1350)    // total_cost_usd (3 × 450)
  })

  it('inserts a line item for each line', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await ready()
    await sheet.confirm()
    const call = (txExecute.mock.calls as any[]).find(([s]) => s.includes('INSERT INTO stock_receiving_line_items'))
    expect(call).toBeDefined()
    expect(call[1][3]).toBe('p1')   // product_id
    expect(call[1][4]).toBe(3)      // qty_received
    expect(call[1][5]).toBe(450)    // unit_cost_usd
  })

  it('increments product stock by qty received', async () => {
    // SELECT current_stock returns 10 → new stock should be 13
    const txExecute = vi.fn()
      .mockResolvedValueOnce({})                                       // INSERT receivings
      .mockResolvedValueOnce({})                                       // INSERT line item
      .mockResolvedValueOnce({ rows: { _array: [{ current_stock: 10 }] } }) // SELECT stock
      .mockResolvedValue({})                                           // UPDATE stock / cost
    setupWriteTransaction(txExecute)
    const sheet = await ready()
    await sheet.confirm()
    const stockUpd = (txExecute.mock.calls as any[])
      .find(([s]: [string]) => s.includes('UPDATE products SET current_stock'))
    expect(stockUpd).toBeDefined()
    expect(stockUpd[1][0]).toBe(13)   // newStock
    expect(stockUpd[1][2]).toBe('p1') // product_id
  })

  it('updates cost_price_usd when updateCost is on', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await ready()
    await sheet.confirm()
    const costUpd = (txExecute.mock.calls as any[])
      .find(([s]: [string]) => s.includes('UPDATE products SET cost_price_usd'))
    expect(costUpd).toBeDefined()
    expect(costUpd[1][0]).toBe(450)   // new cost
  })

  it('does NOT update cost when updateCost is off', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await ready()
    sheet.lines.value[0].updateCost = false
    await sheet.confirm()
    const costUpd = (txExecute.mock.calls as any[])
      .find(([s]: [string]) => s.includes('UPDATE products SET cost_price_usd'))
    expect(costUpd).toBeUndefined()
  })

  it('throws when confirm() called without valid state', async () => {
    const sheet = useReceivingSheet()  // no supplier, no lines
    await expect(sheet.confirm()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useReceivingSheet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `useReceivingSheet.ts`**

```ts
import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import type { ReceivingLine } from '../receiving.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

// Minimal product shape needed to seed a line (matches useProducts' Product).
interface PickedProduct { id: string; nameAr: string; costPriceUsd: number }

export function useReceivingSheet() {
  const { logReceivingCreated } = useAuditLog()

  const supplierId   = ref<string | null>(null)
  const supplierName = ref<string>('')
  const lines        = ref<ReceivingLine[]>([])
  const invoicePhotoUrl = ref<string | null>(null)
  const notes        = ref('')

  const totalCostUsd = computed(() =>
    lines.value.reduce((sum, l) => sum + l.qtyReceived * l.unitCostUsd, 0),
  )

  const canConfirm = computed(() =>
    supplierId.value !== null &&
    lines.value.length > 0 &&
    lines.value.every(l => l.qtyReceived > 0),
  )

  function addLine(product: PickedProduct): void {
    // Avoid duplicate lines for the same product.
    if (lines.value.some(l => l.productId === product.id)) return
    lines.value.push({
      productId:      product.id,
      productName:    product.nameAr,
      currentCostUsd: product.costPriceUsd,
      qtyReceived:    1,
      unitCostUsd:    product.costPriceUsd,
      updateCost:     true,
    })
  }

  function removeLine(index: number): void {
    lines.value.splice(index, 1)
  }

  async function confirm(): Promise<void> {
    if (!supplierId.value || lines.value.length === 0 || lines.value.some(l => l.qtyReceived <= 0)) {
      throw new Error('confirm() called without valid state')
    }

    const { shopId } = useDeviceStore()
    const session = useSessionStore()
    const staffId = session.activeStaff?.id ?? null

    // Current exchange rate (read-only lookup, outside transaction).
    const rateResult = await db.execute(
      `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
      [shopId],
    )
    const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

    const receivingId = uuidv4()
    const now = new Date().toISOString()
    const total = totalCostUsd.value
    const snapshotLines = [...lines.value]

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO stock_receivings
           (id, shop_id, supplier_id, received_at, invoice_photo_url, total_cost_usd,
            exchange_rate_at_receiving, notes, staff_id, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [receivingId, shopId, supplierId.value, now, invoicePhotoUrl.value,
         total, exchangeRate, notes.value || null, staffId],
      )

      for (const line of snapshotLines) {
        await tx.execute(
          `INSERT INTO stock_receiving_line_items
             (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), receivingId, shopId, line.productId, line.qtyReceived,
           line.unitCostUsd, line.updateCost ? 1 : 0],
        )

        // Increment stock.
        const stockResult = await tx.execute(
          `SELECT current_stock FROM products WHERE id = ?`, [line.productId],
        )
        const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
        const newStock = oldStock + line.qtyReceived
        await tx.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId],
        )

        // Update standing cost only if toggled. Past sale_line_items.unit_cost_usd untouched.
        if (line.updateCost) {
          await tx.execute(
            `UPDATE products SET cost_price_usd = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
            [line.unitCostUsd, now, line.productId],
          )
        }
      }
    })

    await logReceivingCreated(receivingId, supplierName.value, total, snapshotLines.length)
  }

  return {
    supplierId, supplierName, lines, invoicePhotoUrl, notes,
    totalCostUsd, canConfirm, addLine, removeLine, confirm,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useReceivingSheet.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/suppliers/composables/useReceivingSheet.ts src/__tests__/features/useReceivingSheet.test.ts
git commit -m "feat(suppliers): add useReceivingSheet composable with transactional confirm"
```

---

## Task 6: `useReceivings` composable (history + detail)

**Files:**
- Create: `src/features/suppliers/composables/useReceivings.ts`
- Test: `src/__tests__/features/useReceivings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/features/useReceivings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReceivings } from '@/features/suppliers/composables/useReceivings'
import { db } from '@/data/powersync/db'

describe('useReceivings', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('load() maps receiving header rows', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'r1', shop_id: 'shop', supplier_id: 's1', supplier_name: 'النور',
        received_at: 't', invoice_photo_url: null, total_cost_usd: 1350,
        exchange_rate_at_receiving: 12500, notes: null, staff_id: 'st1' },
    ] as any)
    const { load, receivings } = useReceivings()
    await load()
    expect(receivings.value[0]).toMatchObject({
      id: 'r1', supplierId: 's1', supplierName: 'النور', totalCostUsd: 1350,
    })
  })

  it('loadForSupplier() filters by supplier_id', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([] as any)
    const { loadForSupplier } = useReceivings()
    await loadForSupplier('s1')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('sr.supplier_id = ?'),
      expect.arrayContaining(['s1']),
    )
  })

  it('loadDetail() returns header plus mapped lines', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'r1', shop_id: 'shop', supplier_id: 's1', supplier_name: 'النور',
      received_at: 't', invoice_photo_url: null, total_cost_usd: 1350,
      exchange_rate_at_receiving: 12500, notes: null, staff_id: 'st1',
    } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { product_id: 'p1', product_name: 'iPhone', qty_received: 3, unit_cost_usd: 450, cost_updated: 1 },
    ] as any)
    const { loadDetail } = useReceivings()
    const detail = await loadDetail('r1')
    expect(detail?.header.id).toBe('r1')
    expect(detail?.lines[0]).toMatchObject({
      productId: 'p1', productName: 'iPhone', qtyReceived: 3, unitCostUsd: 450, costUpdated: true,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useReceivings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `useReceivings.ts`**

```ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Receiving, ReceivingDetailData } from '../receiving.types'

type HeaderRow = {
  id: string; shop_id: string; supplier_id: string; supplier_name: string
  received_at: string; invoice_photo_url: string | null; total_cost_usd: number
  exchange_rate_at_receiving: number; notes: string | null; staff_id: string | null
}

type LineRow = {
  product_id: string; product_name: string; qty_received: number
  unit_cost_usd: number; cost_updated: number
}

function rowToReceiving(r: HeaderRow): Receiving {
  return {
    id: r.id, shopId: r.shop_id, supplierId: r.supplier_id, supplierName: r.supplier_name,
    receivedAt: r.received_at,
    invoicePhotoUrl: r.invoice_photo_url ?? undefined,
    totalCostUsd: r.total_cost_usd,
    exchangeRateAtReceiving: r.exchange_rate_at_receiving,
    notes: r.notes ?? undefined,
    staffId: r.staff_id ?? undefined,
  }
}

const HEADER_SELECT = `
  SELECT sr.*, COALESCE(s.name, '—') AS supplier_name
  FROM stock_receivings sr
  LEFT JOIN suppliers s ON s.id = sr.supplier_id`

export function useReceivings() {
  const receivings = ref<Receiving[]>([])

  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<HeaderRow>(
      `${HEADER_SELECT} WHERE sr.shop_id = ? ORDER BY sr.received_at DESC LIMIT 200`,
      [device.shopId],
    )
    receivings.value = rows.map(rowToReceiving)
  }

  async function loadForSupplier(supplierId: string) {
    const device = useDeviceStore()
    const rows = await db.getAll<HeaderRow>(
      `${HEADER_SELECT} WHERE sr.shop_id = ? AND sr.supplier_id = ? ORDER BY sr.received_at DESC`,
      [device.shopId, supplierId],
    )
    receivings.value = rows.map(rowToReceiving)
  }

  async function loadDetail(id: string): Promise<ReceivingDetailData | null> {
    const header = await db.getOptional<HeaderRow>(
      `${HEADER_SELECT} WHERE sr.id = ?`, [id],
    )
    if (!header) return null
    const lineRows = await db.getAll<LineRow>(
      `SELECT li.product_id, COALESCE(p.name_ar, '—') AS product_name,
              li.qty_received, li.unit_cost_usd, li.cost_updated
       FROM stock_receiving_line_items li
       LEFT JOIN products p ON p.id = li.product_id
       WHERE li.receiving_id = ?`,
      [id],
    )
    return {
      header: rowToReceiving(header),
      lines: lineRows.map(l => ({
        productId: l.product_id, productName: l.product_name,
        qtyReceived: l.qty_received, unitCostUsd: l.unit_cost_usd,
        costUpdated: l.cost_updated === 1,
      })),
    }
  }

  return { receivings, load, loadForSupplier, loadDetail }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/useReceivings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/suppliers/composables/useReceivings.ts src/__tests__/features/useReceivings.test.ts
git commit -m "feat(suppliers): add useReceivings composable for history and detail"
```

---

## Task 7: `SupplierForm` component

**Files:**
- Create: `src/features/suppliers/components/SupplierForm.vue`
- Test: `src/__tests__/features/SupplierForm.test.ts`

> Mirror the existing `CustomerForm.vue` / `CustomerForm.test.ts`. The form emits `submit` with a `NewSupplier` payload and `cancel`. Name is required (submit disabled when empty).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/features/SupplierForm.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SupplierForm from '@/features/suppliers/components/SupplierForm.vue'

describe('SupplierForm', () => {
  it('disables submit when name is empty', () => {
    const wrapper = mount(SupplierForm)
    const btn = wrapper.find('[data-test="submit"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('emits submit with the entered fields', async () => {
    const wrapper = mount(SupplierForm)
    await wrapper.find('[data-test="name"]').setValue('مؤسسة النور')
    await wrapper.find('[data-test="phone"]').setValue('0999')
    await wrapper.find('[data-test="submit"]').trigger('click')
    expect(wrapper.emitted('submit')?.[0][0]).toMatchObject({
      name: 'مؤسسة النور', phone: '0999',
    })
  })

  it('prefills fields from the initial prop', () => {
    const wrapper = mount(SupplierForm, {
      props: { initial: { name: 'النور', address: 'دمشق' } },
    })
    expect((wrapper.find('[data-test="name"]').element as HTMLInputElement).value).toBe('النور')
    expect((wrapper.find('[data-test="address"]').element as HTMLInputElement).value).toBe('دمشق')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/SupplierForm.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `SupplierForm.vue`**

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { NewSupplier } from '../supplier.types'

const props = defineProps<{ initial?: Partial<NewSupplier> }>()
const emit = defineEmits<{ submit: [NewSupplier]; cancel: [] }>()

const name          = ref(props.initial?.name ?? '')
const phone         = ref(props.initial?.phone ?? '')
const contactPerson = ref(props.initial?.contactPerson ?? '')
const address       = ref(props.initial?.address ?? '')
const notes         = ref(props.initial?.notes ?? '')

const canSubmit = computed(() => name.value.trim().length > 0)

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    name: name.value.trim(),
    phone: phone.value.trim() || undefined,
    contactPerson: contactPerson.value.trim() || undefined,
    address: address.value.trim() || undefined,
    notes: notes.value.trim() || undefined,
  })
}
</script>

<template>
  <form class="supplier-form" dir="rtl" @submit.prevent="onSubmit">
    <label>الاسم
      <input data-test="name" v-model="name" type="text" required />
    </label>
    <label>الهاتف
      <input data-test="phone" v-model="phone" type="tel" inputmode="tel" />
    </label>
    <label>الشخص المسؤول
      <input data-test="contact" v-model="contactPerson" type="text" />
    </label>
    <label>العنوان
      <input data-test="address" v-model="address" type="text" />
    </label>
    <label>ملاحظات
      <textarea data-test="notes" v-model="notes" rows="2"></textarea>
    </label>
    <div class="actions">
      <button type="button" class="btn-ghost" @click="emit('cancel')">إلغاء</button>
      <button data-test="submit" type="submit" class="btn-primary" :disabled="!canSubmit">حفظ</button>
    </div>
  </form>
</template>

<style scoped>
.supplier-form { display: flex; flex-direction: column; gap: 0.75rem; }
.supplier-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
.supplier-form input, .supplier-form textarea {
  padding: 0.6rem; border-radius: 0.5rem; border: 1px solid #2A3A52;
  background: #0D1828; color: #fff; font-size: 1rem;
}
.actions { display: flex; gap: 0.5rem; justify-content: flex-start; margin-top: 0.5rem; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; }
.btn-primary:disabled { opacity: 0.5; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; padding: 0.6rem 1.2rem; }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/SupplierForm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/suppliers/components/SupplierForm.vue src/__tests__/features/SupplierForm.test.ts
git commit -m "feat(suppliers): add SupplierForm component"
```

---

## Task 8: `SupplierPickerModal` component

**Files:**
- Create: `src/features/suppliers/components/SupplierPickerModal.vue`

> Mirrors `CustomerPickerModal.vue`. Searches suppliers, lets the user pick one, or add a new one inline (reuses `SupplierForm`). Emits `select` with `{ id, name }` and `close`.

- [ ] **Step 1: Write `SupplierPickerModal.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSuppliers } from '../composables/useSuppliers'
import SupplierForm from './SupplierForm.vue'
import type { NewSupplier } from '../supplier.types'

const emit = defineEmits<{ select: [{ id: string; name: string }]; close: [] }>()

const { suppliers, load, save } = useSuppliers()
const query   = ref('')
const adding  = ref(false)

onMounted(load)

function pick(id: string, name: string) {
  emit('select', { id, name })
}

async function onAdd(data: NewSupplier) {
  const id = await save(data)
  pick(id, data.name)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card" dir="rtl">
      <header class="modal-head">
        <h3>اختر المورّد</h3>
        <button class="btn-ghost" @click="emit('close')">✕</button>
      </header>

      <template v-if="!adding">
        <input v-model="query" class="search" type="text" placeholder="ابحث عن مورّد…" />
        <ul class="list">
          <li
            v-for="s in suppliers.filter(s => s.name.includes(query))"
            :key="s.id"
            @click="pick(s.id, s.name)"
          >
            <span class="name">{{ s.name }}</span>
            <span v-if="s.phone" class="phone">{{ s.phone }}</span>
          </li>
        </ul>
        <button class="btn-primary" @click="adding = true">+ مورّد جديد</button>
      </template>

      <SupplierForm
        v-else
        :initial="{ name: query }"
        @submit="onAdd"
        @cancel="adding = false"
      />
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-card { background: #0D1828; border-radius: 1rem; padding: 1rem; width: min(480px, 92vw); max-height: 80vh; overflow-y: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.search { width: 100%; padding: 0.6rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.list { list-style: none; padding: 0; margin: 0.75rem 0; display: flex; flex-direction: column; gap: 0.25rem; }
.list li { display: flex; justify-content: space-between; padding: 0.75rem; border-radius: 0.5rem; cursor: pointer; }
.list li:hover { background: #16263C; }
.phone { color: #9CB3D0; font-size: 0.85rem; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; width: 100%; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/suppliers/components/SupplierPickerModal.vue
git commit -m "feat(suppliers): add SupplierPickerModal component"
```

---

## Task 9: `ReceivingProductPicker` component

**Files:**
- Create: `src/features/suppliers/components/ReceivingProductPicker.vue`

> Searches the catalog; on no match, offers a quick-add form (nameAr, barcode, sale price, cost) using `useProducts.save`, then re-loads and selects the new product. Emits `select` with the picked product `{ id, nameAr, costPriceUsd }` and `close`.

- [ ] **Step 1: Write `ReceivingProductPicker.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useProducts } from '@/features/products/composables/useProducts'
import { useDeviceStore } from '@/store/device.store'

const emit = defineEmits<{
  select: [{ id: string; nameAr: string; costPriceUsd: number }]
  close: []
}>()

const { products, load, save } = useProducts()
const device = useDeviceStore()

const query  = ref('')
const adding = ref(false)

// quick-add fields
const newName  = ref('')
const newBarcode = ref('')
const newSale  = ref<number>(0)
const newCost  = ref<number>(0)

onMounted(load)

const matches = computed(() =>
  products.value.filter(p =>
    p.nameAr.includes(query.value) || (p.barcode ?? '').includes(query.value),
  ),
)

function pick(p: { id: string; nameAr: string; costPriceUsd: number }) {
  emit('select', { id: p.id, nameAr: p.nameAr, costPriceUsd: p.costPriceUsd })
}

function startAdd() {
  newName.value = query.value
  newBarcode.value = ''
  newSale.value = 0
  newCost.value = 0
  adding.value = true
}

async function confirmAdd() {
  if (!newName.value.trim()) return
  await save({
    shopId: device.shopId,
    nameAr: newName.value.trim(),
    barcode: newBarcode.value.trim() || undefined,
    salePriceUsd: Number(newSale.value) || 0,
    costPriceUsd: Number(newCost.value) || 0,
    currentStock: 0,
    lowStockThreshold: 0,
    isActive: true,
  })
  await load()
  const created = products.value.find(p => p.nameAr === newName.value.trim())
  if (created) pick(created)
  adding.value = false
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card" dir="rtl">
      <header class="modal-head">
        <h3>أضف منتجاً للاستلام</h3>
        <button class="btn-ghost" @click="emit('close')">✕</button>
      </header>

      <template v-if="!adding">
        <input v-model="query" class="search" type="text" placeholder="ابحث أو امسح الباركود…" autofocus />
        <ul class="list">
          <li v-for="p in matches" :key="p.id" @click="pick(p)">
            <span class="name">{{ p.nameAr }}</span>
            <span class="cost">التكلفة: {{ p.costPriceUsd }}$</span>
          </li>
        </ul>
        <button class="btn-primary" @click="startAdd">+ منتج جديد «{{ query }}»</button>
      </template>

      <div v-else class="quick-add">
        <label>الاسم<input v-model="newName" type="text" /></label>
        <label>الباركود<input v-model="newBarcode" type="text" /></label>
        <label>سعر البيع ($)<input v-model.number="newSale" type="number" min="0" step="0.01" /></label>
        <label>سعر التكلفة ($)<input v-model.number="newCost" type="number" min="0" step="0.01" /></label>
        <div class="actions">
          <button class="btn-ghost" @click="adding = false">رجوع</button>
          <button class="btn-primary" :disabled="!newName.trim()" @click="confirmAdd">إضافة</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-card { background: #0D1828; border-radius: 1rem; padding: 1rem; width: min(480px, 92vw); max-height: 80vh; overflow-y: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.search { width: 100%; padding: 0.6rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.list { list-style: none; padding: 0; margin: 0.75rem 0; display: flex; flex-direction: column; gap: 0.25rem; }
.list li { display: flex; justify-content: space-between; padding: 0.75rem; border-radius: 0.5rem; cursor: pointer; }
.list li:hover { background: #16263C; }
.cost { color: #9CB3D0; font-size: 0.85rem; }
.quick-add { display: flex; flex-direction: column; gap: 0.5rem; }
.quick-add label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
.quick-add input { padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.actions { display: flex; gap: 0.5rem; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; }
.btn-primary:disabled { opacity: 0.5; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; padding: 0.6rem 1.2rem; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors. (If `useProducts.save` type complains about optional `barcode`, confirm the union signature in `useProducts.ts` accepts `Partial<Product>` — it does.)

- [ ] **Step 3: Commit**

```bash
git add src/features/suppliers/components/ReceivingProductPicker.vue
git commit -m "feat(suppliers): add ReceivingProductPicker with quick-add"
```

---

## Task 10: `ReceivingLineItem` component

**Files:**
- Create: `src/features/suppliers/components/ReceivingLineItem.vue`

> One editable line. Uses `v-model` on the line object's fields via props + emits, and shows the cost-update toggle only when the entered cost differs from the product's standing cost.

- [ ] **Step 1: Write `ReceivingLineItem.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { ReceivingLine } from '../receiving.types'

const props = defineProps<{ line: ReceivingLine }>()
const emit = defineEmits<{ remove: [] }>()

const costDiffers = computed(() => props.line.unitCostUsd !== props.line.currentCostUsd)
</script>

<template>
  <div class="line" dir="rtl">
    <div class="row">
      <span class="name">{{ line.productName }}</span>
      <button class="btn-ghost" @click="emit('remove')">حذف</button>
    </div>
    <div class="inputs">
      <label>الكمية
        <input v-model.number="line.qtyReceived" type="number" min="1" step="1" />
      </label>
      <label>سعر التكلفة ($)
        <input v-model.number="line.unitCostUsd" type="number" min="0" step="0.01" />
      </label>
    </div>
    <label v-if="costDiffers" class="cost-toggle">
      <input v-model="line.updateCost" type="checkbox" />
      تحديث سعر التكلفة؟ {{ line.currentCostUsd }}$ ← {{ line.unitCostUsd }}$
    </label>
  </div>
</template>

<style scoped>
.line { background: #0D1828; border-radius: 0.75rem; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.row { display: flex; justify-content: space-between; align-items: center; }
.name { font-weight: 600; }
.inputs { display: flex; gap: 0.5rem; }
.inputs label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; flex: 1; }
.inputs input { padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.cost-toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #9CB3D0; }
.btn-ghost { background: transparent; color: #E06A6A; border: none; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/suppliers/components/ReceivingLineItem.vue
git commit -m "feat(suppliers): add ReceivingLineItem component"
```

---

## Task 11: `ReceivingSheet` component (create flow)

**Files:**
- Create: `src/features/suppliers/components/ReceivingSheet.vue`

> Wires together `useReceivingSheet`, `SupplierPickerModal`, `ReceivingProductPicker`, and `ReceivingLineItem`. Optional `presetSupplier` prop pre-selects a supplier (used from `SupplierDetailPage`). Emits `saved` and `close`.

- [ ] **Step 1: Write `ReceivingSheet.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReceivingSheet } from '../composables/useReceivingSheet'
import SupplierPickerModal from './SupplierPickerModal.vue'
import ReceivingProductPicker from './ReceivingProductPicker.vue'
import ReceivingLineItem from './ReceivingLineItem.vue'

const props = defineProps<{ presetSupplier?: { id: string; name: string } }>()
const emit = defineEmits<{ saved: []; close: [] }>()

const sheet = useReceivingSheet()
const showSupplierPicker = ref(false)
const showProductPicker  = ref(false)
const saving = ref(false)

onMounted(() => {
  if (props.presetSupplier) {
    sheet.supplierId.value   = props.presetSupplier.id
    sheet.supplierName.value = props.presetSupplier.name
  }
})

function onSupplierSelect(s: { id: string; name: string }) {
  sheet.supplierId.value   = s.id
  sheet.supplierName.value = s.name
  showSupplierPicker.value = false
}

function onProductSelect(p: { id: string; nameAr: string; costPriceUsd: number }) {
  sheet.addLine(p)
  showProductPicker.value = false
}

async function onConfirm() {
  if (!sheet.canConfirm.value || saving.value) return
  saving.value = true
  try {
    await sheet.confirm()
    emit('saved')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="sheet" dir="rtl">
    <header class="sheet-head">
      <h2>تسجيل استلام بضاعة</h2>
      <button class="btn-ghost" @click="emit('close')">✕</button>
    </header>

    <!-- Supplier -->
    <button class="supplier-row" @click="showSupplierPicker = true">
      <span v-if="sheet.supplierName.value">المورّد: {{ sheet.supplierName.value }}</span>
      <span v-else class="muted">اختر المورّد</span>
    </button>

    <!-- Lines -->
    <div class="lines">
      <ReceivingLineItem
        v-for="(line, i) in sheet.lines.value"
        :key="line.productId"
        :line="line"
        @remove="sheet.removeLine(i)"
      />
      <p v-if="!sheet.lines.value.length" class="muted">لم تتم إضافة أصناف بعد.</p>
    </div>
    <button class="btn-secondary" @click="showProductPicker = true">+ أضف صنفاً</button>

    <!-- Notes -->
    <label class="notes">ملاحظات
      <textarea v-model="sheet.notes.value" rows="2"></textarea>
    </label>

    <!-- Total + confirm -->
    <div class="total-row">
      <span>الإجمالي</span>
      <strong>{{ sheet.totalCostUsd.value.toFixed(2) }}$</strong>
    </div>
    <button class="btn-primary" :disabled="!sheet.canConfirm.value || saving" @click="onConfirm">
      تأكيد الاستلام
    </button>

    <SupplierPickerModal v-if="showSupplierPicker" @select="onSupplierSelect" @close="showSupplierPicker = false" />
    <ReceivingProductPicker v-if="showProductPicker" @select="onProductSelect" @close="showProductPicker = false" />
  </div>
</template>

<style scoped>
.sheet { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.supplier-row { text-align: start; padding: 0.75rem; border-radius: 0.75rem; border: 1px solid #2A3A52; background: #0D1828; color: #fff; }
.muted { color: #9CB3D0; }
.lines { display: flex; flex-direction: column; gap: 0.5rem; }
.notes { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
.notes textarea { padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0D1828; color: #fff; }
.total-row { display: flex; justify-content: space-between; font-size: 1.1rem; padding: 0.5rem 0; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.8rem; border-radius: 0.5rem; font-size: 1rem; }
.btn-primary:disabled { opacity: 0.5; }
.btn-secondary { background: #16263C; color: #fff; border: none; padding: 0.6rem; border-radius: 0.5rem; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; }
</style>
```

> Invoice photo upload is deferred to the optional polish step at the end of this task list (it reuses the existing photo-upload component). The `invoicePhotoUrl` field is already wired in the composable.

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/suppliers/components/ReceivingSheet.vue
git commit -m "feat(suppliers): add ReceivingSheet create flow"
```

---

## Task 12: `ReceivingDetail` component (read-only)

**Files:**
- Create: `src/features/suppliers/components/ReceivingDetail.vue`

- [ ] **Step 1: Write `ReceivingDetail.vue`**

```vue
<script setup lang="ts">
import type { ReceivingDetailData } from '../receiving.types'

defineProps<{ data: ReceivingDetailData }>()
</script>

<template>
  <div class="detail" dir="rtl">
    <header>
      <h3>{{ data.header.supplierName }}</h3>
      <time>{{ new Date(data.header.receivedAt).toLocaleString('ar') }}</time>
    </header>

    <img v-if="data.header.invoicePhotoUrl" :src="data.header.invoicePhotoUrl" class="invoice" alt="صورة الفاتورة" />

    <table class="lines">
      <thead>
        <tr><th>الصنف</th><th>الكمية</th><th>التكلفة</th></tr>
      </thead>
      <tbody>
        <tr v-for="(l, i) in data.lines" :key="i">
          <td>{{ l.productName }}</td>
          <td>{{ l.qtyReceived }}</td>
          <td>{{ l.unitCostUsd.toFixed(2) }}$<span v-if="l.costUpdated" class="badge">حُدّث</span></td>
        </tr>
      </tbody>
    </table>

    <div class="total"><span>الإجمالي</span><strong>{{ data.header.totalCostUsd.toFixed(2) }}$</strong></div>
    <p v-if="data.header.notes" class="notes">{{ data.header.notes }}</p>
  </div>
</template>

<style scoped>
.detail { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
header { display: flex; justify-content: space-between; align-items: baseline; }
time { color: #9CB3D0; font-size: 0.85rem; }
.invoice { max-width: 100%; border-radius: 0.5rem; }
.lines { width: 100%; border-collapse: collapse; }
.lines th, .lines td { text-align: start; padding: 0.5rem; border-bottom: 1px solid #1C2A40; }
.badge { background: #1A56DB; color: #fff; font-size: 0.7rem; border-radius: 0.4rem; padding: 0.1rem 0.4rem; margin-inline-start: 0.4rem; }
.total { display: flex; justify-content: space-between; font-size: 1.1rem; }
.notes { color: #9CB3D0; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/suppliers/components/ReceivingDetail.vue
git commit -m "feat(suppliers): add read-only ReceivingDetail component"
```

---

## Task 13: Pages (Suppliers list, Supplier detail, Receivings history)

**Files:**
- Create: `src/features/suppliers/SuppliersPage.vue`
- Create: `src/features/suppliers/SupplierDetailPage.vue`
- Create: `src/features/suppliers/ReceivingsPage.vue`

- [ ] **Step 1: Write `SuppliersPage.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSuppliers } from './composables/useSuppliers'
import SupplierForm from './components/SupplierForm.vue'
import type { NewSupplier } from './supplier.types'

const router = useRouter()
const { suppliers, load, save } = useSuppliers()
const adding = ref(false)

onMounted(load)

async function onAdd(data: NewSupplier) {
  await save(data)
  adding.value = false
  await load()
}
</script>

<template>
  <section class="page" dir="rtl">
    <header class="page-head">
      <h1>الموردون</h1>
      <button class="btn-primary" @click="adding = true">+ مورّد جديد</button>
    </header>

    <SupplierForm v-if="adding" @submit="onAdd" @cancel="adding = false" />

    <ul class="list">
      <li v-for="s in suppliers" :key="s.id" @click="router.push(`/suppliers/${s.id}`)">
        <div class="top">
          <span class="name">{{ s.name }}</span>
          <span class="total">{{ s.totalPurchasedUsd.toFixed(0) }}$</span>
        </div>
        <div class="sub">
          <span v-if="s.phone">{{ s.phone }}</span>
          <span v-if="s.lastReceivedAt">آخر استلام: {{ new Date(s.lastReceivedAt).toLocaleDateString('ar') }}</span>
        </div>
      </li>
      <li v-if="!suppliers.length" class="empty">لا يوجد موردون بعد.</li>
    </ul>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.list li { background: #0D1828; border-radius: 0.75rem; padding: 0.85rem; cursor: pointer; }
.top { display: flex; justify-content: space-between; }
.name { font-weight: 600; }
.total { color: #4ADE80; }
.sub { display: flex; justify-content: space-between; color: #9CB3D0; font-size: 0.8rem; margin-top: 0.25rem; }
.empty { text-align: center; color: #9CB3D0; cursor: default; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; }
</style>
```

- [ ] **Step 2: Write `SupplierDetailPage.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSuppliers } from './composables/useSuppliers'
import { useReceivings } from './composables/useReceivings'
import ReceivingSheet from './components/ReceivingSheet.vue'
import type { Supplier } from './supplier.types'

const route = useRoute()
const supplierId = route.params.id as string

const { getById } = useSuppliers()
const { receivings, loadForSupplier } = useReceivings()

const supplier = ref<Supplier | null>(null)
const showSheet = ref(false)

async function refresh() {
  supplier.value = await getById(supplierId)
  await loadForSupplier(supplierId)
}

onMounted(refresh)

async function onSaved() {
  showSheet.value = false
  await refresh()
}
</script>

<template>
  <section class="page" dir="rtl">
    <header v-if="supplier" class="info">
      <h1>{{ supplier.name }}</h1>
      <p v-if="supplier.phone">{{ supplier.phone }}</p>
      <p v-if="supplier.contactPerson">{{ supplier.contactPerson }}</p>
      <p v-if="supplier.address">{{ supplier.address }}</p>
      <p v-if="supplier.notes" class="muted">{{ supplier.notes }}</p>
    </header>

    <button class="btn-primary" @click="showSheet = true">تسجيل استلام بضاعة</button>

    <h2>سجلّ الاستلام</h2>
    <ul class="list">
      <li v-for="r in receivings" :key="r.id">
        <span>{{ new Date(r.receivedAt).toLocaleDateString('ar') }}</span>
        <strong>{{ r.totalCostUsd.toFixed(2) }}$</strong>
      </li>
      <li v-if="!receivings.length" class="empty">لا يوجد استلام مسجّل.</li>
    </ul>

    <div v-if="showSheet" class="overlay">
      <div class="overlay-card">
        <ReceivingSheet
          :preset-supplier="supplier ? { id: supplier.id, name: supplier.name } : undefined"
          @saved="onSaved"
          @close="showSheet = false"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.info p { margin: 0.15rem 0; }
.muted { color: #9CB3D0; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.list li { background: #0D1828; border-radius: 0.75rem; padding: 0.85rem; display: flex; justify-content: space-between; }
.empty { color: #9CB3D0; justify-content: center; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.75rem; border-radius: 0.5rem; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; }
</style>
```

- [ ] **Step 3: Write `ReceivingsPage.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReceivings } from './composables/useReceivings'
import ReceivingDetail from './components/ReceivingDetail.vue'
import type { ReceivingDetailData } from './receiving.types'

const { receivings, load, loadDetail } = useReceivings()
const detail = ref<ReceivingDetailData | null>(null)

onMounted(load)

async function open(id: string) {
  detail.value = await loadDetail(id)
}
</script>

<template>
  <section class="page" dir="rtl">
    <h1>استلام البضائع</h1>
    <ul class="list">
      <li v-for="r in receivings" :key="r.id" @click="open(r.id)">
        <div class="top">
          <span class="name">{{ r.supplierName }}</span>
          <strong>{{ r.totalCostUsd.toFixed(2) }}$</strong>
        </div>
        <span class="date">{{ new Date(r.receivedAt).toLocaleString('ar') }}</span>
      </li>
      <li v-if="!receivings.length" class="empty">لا يوجد استلام مسجّل بعد.</li>
    </ul>

    <div v-if="detail" class="overlay" @click.self="detail = null">
      <div class="overlay-card">
        <button class="btn-ghost" @click="detail = null">✕</button>
        <ReceivingDetail :data="detail" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.list li { background: #0D1828; border-radius: 0.75rem; padding: 0.85rem; cursor: pointer; }
.top { display: flex; justify-content: space-between; }
.name { font-weight: 600; }
.date { color: #9CB3D0; font-size: 0.8rem; }
.empty { text-align: center; color: #9CB3D0; cursor: default; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; padding: 0.5rem; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; float: inline-end; }
</style>
```

- [ ] **Step 4: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/suppliers/SuppliersPage.vue src/features/suppliers/SupplierDetailPage.vue src/features/suppliers/ReceivingsPage.vue
git commit -m "feat(suppliers): add suppliers, supplier detail, and receivings pages"
```

---

## Task 14: Routing and navigation

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/components/layout/AppSidebar.vue`

- [ ] **Step 1: Add routes**

In `src/router/index.ts`, add after the customers routes (after line 16):

```ts
    { path: '/suppliers',         component: () => import('@/features/suppliers/SuppliersPage.vue') },
    { path: '/suppliers/:id',     component: () => import('@/features/suppliers/SupplierDetailPage.vue') },
    { path: '/receivings',        component: () => import('@/features/suppliers/ReceivingsPage.vue') },
```

- [ ] **Step 2: Add nav entries**

In `src/components/layout/AppSidebar.vue`, add to `allNavItems` after the customers entry (line 25). Both gated on `can_manage_products` ("Owner + Manager" = anyone who can manage inventory):

```ts
  { key: 'suppliers',   label: 'الموردون',    href: '/suppliers',      permission: 'can_manage_products' },
  { key: 'receivings',  label: 'الاستلام',    href: '/receivings',     permission: 'can_manage_products' },
```

- [ ] **Step 3: Verify build and run the full test suite**

Run: `npx vue-tsc --noEmit && npx vitest run`
Expected: type-check clean; all tests pass (including the new suppliers/receiving suites).

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`
Open the app, sign in as owner, confirm "الموردون" and "الاستلام" appear in the sidebar. Add a supplier, record a 2-line delivery (one existing product, one quick-added), confirm. Verify on the product list that stock increased and (for a line with the toggle on) cost updated. Open `/receivings` and the receiving detail. Confirm a cashier (no `can_manage_products`) does not see the nav entries.

- [ ] **Step 5: Commit**

```bash
git add src/router/index.ts src/components/layout/AppSidebar.vue
git commit -m "feat(suppliers): add routes and sidebar nav for suppliers and receiving"
```

---

## Task 15 (optional polish): Invoice photo upload

**Files:**
- Modify: `src/features/suppliers/components/ReceivingSheet.vue`

> Reuse the same photo capture/compression approach as `ProductPhotoUpload.vue` (WebP, ~200KB cap). Bind the resulting URL to `sheet.invoicePhotoUrl.value`. Read `src/features/products/components/ProductPhotoUpload.vue` first and follow its exact props/emits so behavior and storage match the rest of the app.

- [ ] **Step 1:** Read `ProductPhotoUpload.vue` to learn its emit contract.
- [ ] **Step 2:** Add it to `ReceivingSheet.vue`, binding its output to `sheet.invoicePhotoUrl.value` with a label "صورة الفاتورة (اختياري)".
- [ ] **Step 3:** Type-check (`npx vue-tsc --noEmit`) and smoke test that a photo attaches and appears in `ReceivingDetail`.
- [ ] **Step 4:** Commit: `git commit -m "feat(suppliers): attach invoice photo to receiving"`

---

## Definition of Done (from spec)

- [ ] Owner records a multi-line delivery with invoice photo in under 2 minutes.
- [ ] Stock increments exactly across receivings, incl. offline.
- [ ] Cost updates only where toggled; past sales' COGS unchanged (verified: only `products.cost_price_usd` is written, never `sale_line_items`).
- [ ] New product created mid-receiving lands in catalog + on the receiving.
- [ ] Receiving is immutable; no edit/delete path exists in the UI.
- [ ] Works fully offline (`sync_status = 'pending'` on every write); `receiving.created` appears in the audit log.
- [ ] Cashier cannot access suppliers or receiving (nav gated by `can_manage_products`).
```
