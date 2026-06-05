import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReturnSheet } from '@/features/returns/composables/useReturnSheet'
import { db } from '@/data/powersync/db'

const SALE_ID = 'sale-abc'

// db.execute is used for sale lookup; db.getAll for line items and prior returns
function mockSale(customerId: string | null = null) {
  vi.mocked(db.execute).mockResolvedValueOnce({
    rows: {
      _array: [{ id: SALE_ID, display_sale_number: '#001', customer_id: customerId }],
    },
  } as any)
}

function mockLineItems() {
  vi.mocked(db.getAll).mockResolvedValueOnce([
    { product_id: 'p1', product_name: 'iPhone',  quantity: 2, unit_price_usd: 500 },
    { product_id: 'p2', product_name: 'Charger', quantity: 1, unit_price_usd: 25  },
  ] as any)
}

function mockPriorReturns(rows: { product_id: string; already_returned: number }[] = []) {
  vi.mocked(db.getAll).mockResolvedValueOnce(rows as any)
}

describe('useReturnSheet — load()', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('fetches sale, line items, and prior returns on load()', async () => {
    mockSale()
    mockLineItems()
    mockPriorReturns()
    const { load } = useReturnSheet(SALE_ID)
    await load()
    // 1st execute = sale lookup, 2 getAll = line items + prior returns
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('FROM sales'), [SALE_ID])
    expect(db.getAll).toHaveBeenCalledWith(expect.stringContaining('sale_line_items'), expect.any(Array))
    expect(db.getAll).toHaveBeenCalledWith(expect.stringContaining('return_line_items'), expect.any(Array))
  })

  it('maps line items to ReturnLine objects with defaults', async () => {
    mockSale()
    mockLineItems()
    mockPriorReturns()
    const { load, lines } = useReturnSheet(SALE_ID)
    await load()
    expect(lines.value).toHaveLength(2)
    expect(lines.value[0]).toMatchObject({
      productId: 'p1', productName: 'iPhone',
      originalQty: 2, alreadyReturnedQty: 0,
      unitPriceUsd: 500,
      selected: false, qtyToReturn: 1, restock: true,
    })
  })

  it('subtracts already-returned qty from available qty', async () => {
    mockSale()
    mockLineItems()
    mockPriorReturns([{ product_id: 'p1', already_returned: 1 }])
    const { load, lines } = useReturnSheet(SALE_ID)
    await load()
    expect(lines.value[0].alreadyReturnedQty).toBe(1)
  })

  it('sets hasCustomer true when sale has customer_id', async () => {
    mockSale('cust-1')
    mockLineItems()
    mockPriorReturns()
    const { load, hasCustomer } = useReturnSheet(SALE_ID)
    await load()
    expect(hasCustomer.value).toBe(true)
  })

  it('sets hasCustomer false when sale has no customer_id', async () => {
    mockSale(null)
    mockLineItems()
    mockPriorReturns()
    const { load, hasCustomer } = useReturnSheet(SALE_ID)
    await load()
    expect(hasCustomer.value).toBe(false)
  })
})

describe('useReturnSheet — computed state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  async function loadSheet() {
    mockSale('cust-1')
    mockLineItems()
    mockPriorReturns()
    const sheet = useReturnSheet(SALE_ID)
    await sheet.load()
    return sheet
  }

  it('refundTotalUsd is 0 when no items selected', async () => {
    const { refundTotalUsd } = await loadSheet()
    expect(refundTotalUsd.value).toBe(0)
  })

  it('refundTotalUsd sums selected lines (qty × unitPriceUsd)', async () => {
    const { lines, refundTotalUsd } = await loadSheet()
    lines.value[0].selected = true
    lines.value[0].qtyToReturn = 2
    expect(refundTotalUsd.value).toBe(1000)  // 2 × 500
  })

  it('canConfirm is false when no items selected', async () => {
    const { canConfirm, refundMethod } = await loadSheet()
    refundMethod.value = 'cash_usd'
    expect(canConfirm.value).toBe(false)
  })

  it('canConfirm is false when no refund method selected', async () => {
    const { lines, canConfirm } = await loadSheet()
    lines.value[0].selected = true
    expect(canConfirm.value).toBe(false)
  })

  it('canConfirm is true when at least one item selected and method set', async () => {
    const { lines, refundMethod, canConfirm } = await loadSheet()
    lines.value[0].selected = true
    refundMethod.value = 'cash_usd'
    expect(canConfirm.value).toBe(true)
  })
})

describe('useReturnSheet — confirm()', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // Helper: creates a per-test txExecute spy and wires writeTransaction to use it.
  // Returns txExecute so tests can inspect calls on tx.execute.
  function setupWriteTransaction(txMockFn?: ReturnType<typeof vi.fn>) {
    const txExecute = txMockFn ?? vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
      await fn({ execute: txExecute })
    })
    return txExecute
  }

  async function loadSheet(customerId: string | null = 'cust-1') {
    // call order: execute(sale), getAll(lineItems), getAll(priorReturns)
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: SALE_ID, display_sale_number: '#001', customer_id: customerId }] },
    } as any)
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{ product_id: 'p1', product_name: 'iPhone', quantity: 2, unit_price_usd: 500 }] as any)
      .mockResolvedValueOnce([] as any)  // no prior returns
    const sheet = useReturnSheet(SALE_ID)
    await sheet.load()
    sheet.lines.value[0].selected    = true
    sheet.lines.value[0].qtyToReturn = 1
    sheet.lines.value[0].restock     = true
    sheet.refundMethod.value         = 'cash_usd'
    // After load(), configure exchange-rate lookup (db.execute, outside transaction)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [{ rate: 12500 }] } } as any)
    return sheet
  }

  it('inserts a returns row with correct fields', async () => {
    const txExecute = setupWriteTransaction()
    const { confirm } = await loadSheet()
    await confirm()
    expect(db.writeTransaction).toHaveBeenCalled()
    const insertCall = (txExecute.mock.calls as any[])
      .find(([sql]) => sql.includes('INSERT INTO returns'))
    expect(insertCall).toBeDefined()
    expect(insertCall[1][2]).toBe(SALE_ID)          // original_sale_id
    expect(insertCall[1][4]).toBe('cash_usd')        // refund_method
    expect(insertCall[1][5]).toBe(500)               // refund_amount_usd (1 × 500)
  })

  it('inserts return_line_items for each selected line', async () => {
    const txExecute = setupWriteTransaction()
    const { confirm } = await loadSheet()
    await confirm()
    const insertCall = (txExecute.mock.calls as any[])
      .find(([sql]) => sql.includes('INSERT INTO return_line_items'))
    expect(insertCall).toBeDefined()
    expect(insertCall[1][3]).toBe('p1')   // product_id
    expect(insertCall[1][4]).toBe(1)      // qty_returned
    expect(insertCall[1][7]).toBe(1)      // restock = 1
  })

  it('updates product stock and inserts stock_adjustment when restock=true', async () => {
    // txExecute: SELECT current_stock returns 0, rest succeed
    const txExecute = vi.fn()
      .mockResolvedValueOnce({ rows: { _array: [] } })  // INSERT returns
      .mockResolvedValueOnce({ rows: { _array: [] } })  // INSERT return_line_items
      .mockResolvedValueOnce({ rows: { _array: [{ current_stock: 0 }] } })  // SELECT current_stock
      .mockResolvedValue({})  // UPDATE products + INSERT stock_adjustments
    setupWriteTransaction(txExecute)
    const sheet = await loadSheet(null)
    await sheet.confirm()
    const updateCall = (txExecute.mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('UPDATE products'))
    expect(updateCall).toBeDefined()
    expect(updateCall[1][2]).toBe('p1')  // product_id (index 2: [newStock, now, product_id])
    const adjCall = (txExecute.mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('INSERT INTO stock_adjustments'))
    expect(adjCall).toBeDefined()
  })

  it('does NOT update stock when restock=false', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await loadSheet(null)
    sheet.lines.value[0].restock = false  // override the default restock=true
    await sheet.confirm()
    const updateCall = (txExecute.mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('UPDATE products'))
    expect(updateCall).toBeUndefined()
  })

  it('inserts negative customer_payments row for store_credit', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await loadSheet('cust-1')
    sheet.refundMethod.value = 'store_credit'  // override cash_usd default
    await sheet.confirm()
    const cpCall = (txExecute.mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('INSERT INTO customer_payments'))
    expect(cpCall).toBeDefined()
    expect(cpCall[1][4]).toBe(-500)     // amount_usd is negative
    expect(cpCall[1][3]).toBe(SALE_ID)  // sale_id
  })

  it('does NOT insert customer_payments for cash_usd method', async () => {
    const txExecute = setupWriteTransaction()
    const sheet = await loadSheet('cust-1')  // has customer but method is cash_usd
    await sheet.confirm()
    const cpCall = (txExecute.mock.calls as any[])
      .find(([sql]: [string]) => sql.includes('INSERT INTO customer_payments'))
    expect(cpCall).toBeUndefined()
  })
})
