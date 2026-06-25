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

  it('does NOT zero standing cost when updateCost is on but the unit cost is 0 (WAFI-021)', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await ready()
    sheet.lines.value[0].unitCostUsd = 0   // mis-keyed cost — must not wipe the product's standing cost
    await sheet.confirm()
    const costUpd = (txExecute.mock.calls as any[])
      .find(([s]: [string]) => s.includes('UPDATE products SET cost_price_usd'))
    expect(costUpd).toBeUndefined()
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

  it('writes receiving.created audit metadata with supplier/total/lineCount from confirmed state', async () => {
    setupWriteTransaction()
    const sheet = await ready()
    await sheet.confirm()

    const auditCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
    )
    expect(auditCall).toBeDefined()

    const metaArg = (auditCall![1] as unknown[]).find(
      (v: unknown) => typeof v === 'string' && v.includes('supplierName'),
    ) as string
    const meta = JSON.parse(metaArg)
    expect(meta).toMatchObject({ supplierName: 'النور', totalUsd: 1350, lineCount: 1 })
  })

  it('falls back to supplier name from DB for audit when supplierName ref is blank', async () => {
    setupWriteTransaction()
    const sheet = await ready()
    sheet.supplierName.value = ''
    vi.mocked(db.getOptional).mockResolvedValueOnce({ name: 'مؤسسة السلام' } as any)

    await sheet.confirm()

    const auditCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
    )
    expect(auditCall).toBeDefined()
    const metaArg = (auditCall![1] as unknown[]).find(
      (v: unknown) => typeof v === 'string' && v.includes('supplierName'),
    ) as string
    const meta = JSON.parse(metaArg)
    expect(meta.supplierName).toBe('مؤسسة السلام')
  })

  it('throws when confirm() called without valid state', async () => {
    const sheet = useReceivingSheet()  // no supplier, no lines
    await expect(sheet.confirm()).rejects.toThrow()
  })
})
