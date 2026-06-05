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
