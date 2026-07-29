import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReturnSheet } from '../useReturnSheet'
import { db } from '@/data/powersync/db'

describe('useReturnSheet — WAFI-100 discounted-line refund', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Sale header + customer lookup, and the exchange-rate lookup, both go through
    // db.execute (SELECT ... rows._array). getAll covers the line-items and
    // already-returned lookups.
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) {
        return { rows: { _array: [{ id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null }] } } as any
      }
      if (s.includes('FROM exchange_rates')) {
        return { rows: { _array: [{ rate: 1 }] } } as any
      }
      return { rows: { _array: [] } } as any
    })

    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sale_line_items')) {
        // A $10 list-price item sold at a 20% discount: unit_price_usd is
        // already the net, post-discount price (Task 8 writes it that way).
        return [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 8 }] as any
      }
      if (s.includes('FROM return_line_items')) {
        return [] as any
      }
      return [] as any
    })
  })

  it('refunds the net (post-discount) unit price, not the list price', async () => {
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true

    expect(sheet.refundTotalUsd.value).toBeCloseTo(8, 2) // NOT 10 (list price)
  })
})

describe('useReturnSheet — WAFI-011 sale-level discount proration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function mockSale(saleDiscountAmountUsd: number, lineRows: any[]) {
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) {
        return {
          rows: {
            _array: [{
              id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null,
              sale_discount_amount_usd: saleDiscountAmountUsd,
            }],
          },
        } as any
      }
      if (s.includes('FROM exchange_rates')) return { rows: { _array: [{ rate: 1 }] } } as any
      return { rows: { _array: [] } } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sale_line_items')) return lineRows as any
      if (s.includes('FROM return_line_items')) return [] as any
      return [] as any
    })
  }

  it('with no sale-level discount, refunds the plain net price (regression)', async () => {
    mockSale(0, [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    expect(sheet.refundTotalUsd.value).toBeCloseTo(10, 2)
  })

  it('prorates a whole-sale discount across the single returned line', async () => {
    // $10 item, $2 whole-sale discount taken at checkout -> customer actually paid $8.
    mockSale(2, [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    expect(sheet.refundTotalUsd.value).toBeCloseTo(8, 2) // NOT 10
  })

  it('prorates a whole-sale discount proportionally across multiple lines', async () => {
    // $30 + $70 = $100 cart, $10 whole-sale discount -> A owes 30% ($3), B owes 70% ($7).
    mockSale(10, [
      { product_id: 'a', product_name: 'A', quantity: 1, unit_price_usd: 30 },
      { product_id: 'b', product_name: 'B', quantity: 1, unit_price_usd: 70 },
    ])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true // return only A
    expect(sheet.refundTotalUsd.value).toBeCloseTo(27, 2) // 30 - 3, NOT 30
  })

  it('prorates a whole-sale discount by returned quantity on a partial-qty return', async () => {
    // 2 units at $10 = $20 cart, $10 whole-sale discount -> $5/unit share. Return 1 of 2.
    mockSale(10, [{ product_id: 'p1', product_name: 'قلم', quantity: 2, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.lines.value[0].qtyToReturn = 1
    expect(sheet.refundTotalUsd.value).toBeCloseTo(5, 2) // 10 - 5, NOT 10
  })

  it('persists the discount-adjusted refund total on confirm()', async () => {
    mockSale(2, [{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    await sheet.confirm()

    const insert = txExecute.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO returns'))
    expect(insert).toBeDefined()
    // refund_amount_usd is the 6th bound param (id, shop_id, original_sale_id, created_at, refund_method, refund_amount_usd, ...)
    expect(insert![1][5]).toBeCloseTo(8, 2)
  })
})

describe('useReturnSheet — WAFI-010 installment plan integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  /**
   * `db.execute` mock covers: sale header lookup, exchange rate lookup, and
   * (new) the in-transaction plan lookup — but the plan lookup in confirm()
   * runs via `tx.execute`, not `db.execute`, so it's configured through
   * `txExecuteImpl` instead. `db.getAll` covers sale_line_items /
   * return_line_items reads used by `load()`.
   */
  function mockLoad(lineRows: any[], alreadyReturnedRows: any[] = []) {
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) {
        return { rows: { _array: [{ id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null, sale_discount_amount_usd: 0 }] } } as any
      }
      if (s.includes('FROM exchange_rates')) return { rows: { _array: [{ rate: 1 }] } } as any
      return { rows: { _array: [] } } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sale_line_items')) return lineRows as any
      if (s.includes('FROM return_line_items')) return alreadyReturnedRows as any
      return [] as any
    })
  }

  /**
   * Builds the `tx.execute` mock used inside confirm()'s transaction. `plan`
   * is the row returned by the plan lookup (or undefined for "no plan").
   * `saleLineRows`/`returnedRows` back the in-transaction full-sale-return
   * recomputation (independent of mockLoad's sheet-open-time snapshot).
   */
  function mockTx(opts: {
    plan?: { id: string; status: string }
    saleLineRows: { product_id: string; quantity: number }[]
    returnedRows: { product_id: string; returned_qty: number }[]
    planCancelSucceeds?: boolean
  }) {
    return vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sale_line_items') && sql.includes('WHERE sale_id')) {
        return { rows: { _array: opts.saleLineRows } }
      }
      if (sql.includes('FROM return_line_items') && sql.includes('JOIN returns')) {
        return { rows: { _array: opts.returnedRows } }
      }
      if (sql.includes('FROM installment_plans') && sql.includes('WHERE sale_id')) {
        return { rows: { _array: opts.plan ? [opts.plan] : [] } }
      }
      if (sql.includes('UPDATE installment_plans') && sql.includes('RETURNING id')) {
        return { rows: { _array: (opts.planCancelSucceeds ?? true) ? [{ id: opts.plan?.id }] : [] } }
      }
      return { rows: { _array: [] } }
    })
  }

  it('cancels an active plan and logs both audit events when the return exhausts the whole sale', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' },
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }], // this return covers the only unit
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()

    expect(result.warning).toBeUndefined()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_dues') && sql.includes(`'voided'`))).toBe(true)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans') && sql.includes(`'cancelled'`))).toBe(true)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['return.processed', 'return']),
    )
    // returnId is a freshly-generated uuid inside confirm(), so match the meta
    // JSON loosely (nested asymmetric matcher inside arrayContaining) rather
    // than asserting its exact string form.
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining([
        'installment_plan.cancelled', 'installment_plan', 'plan-1',
        expect.stringContaining('"reason":"sale_returned"'),
      ]),
    )
  })

  it.each([
    ['no plan', undefined],
    ['a completed plan', { id: 'plan-1', status: 'completed' }],
    ['a cancelled plan', { id: 'plan-1', status: 'cancelled' }],
  ] as const)('leaves %s untouched, no warning', async (_label, plan) => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan,
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toBeUndefined()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('warns without mutating an active plan on a partial return', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 2, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' },
      saleLineRows: [{ product_id: 'p1', quantity: 2 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }], // 1 of 2 returned -> not full
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.lines.value[0].qtyToReturn = 1
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toEqual({ type: 'plan_requires_manual_review', planStatus: 'active' })
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('warns without mutating a defaulted plan even on a full-sale return', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'defaulted' },
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toEqual({ type: 'plan_requires_manual_review', planStatus: 'defaulted' })
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('warns (does not silently no-op) for an unrecognized future plan status', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'paused' },
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()
    expect(result.warning).toEqual({ type: 'plan_requires_manual_review', planStatus: 'paused' })
  })

  it('detects a cumulative full-sale return across two sequential return transactions', async () => {
    // Sale has two products, A and B. This confirm() call returns only B, but a
    // PRIOR return (already committed, reflected in returnedRows) already covered
    // A. lines.value only knows about A/B from sheet-load time -- the in-transaction
    // re-read is what must catch that the sale is now fully returned.
    mockLoad(
      [{ product_id: 'a', product_name: 'A', quantity: 1, unit_price_usd: 5 },
       { product_id: 'b', product_name: 'B', quantity: 1, unit_price_usd: 5 }],
      [{ product_id: 'a', already_returned: 1 }], // A already fully returned before this sheet's confirm()
    )
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' },
      saleLineRows: [
        { product_id: 'a', quantity: 1 },
        { product_id: 'b', quantity: 1 },
      ],
      // Reflects BOTH the prior return of A and this return's insert of B.
      returnedRows: [
        { product_id: 'a', returned_qty: 1 },
        { product_id: 'b', returned_qty: 1 },
      ],
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    // Only B is selectable/selected -- A was filtered out of lines.value by load()
    // because it's already fully returned (existing behavior, unchanged).
    expect(sheet.lines.value.find(l => l.productId === 'a')).toBeUndefined()
    sheet.lines.value.find(l => l.productId === 'b')!.selected = true
    sheet.refundMethod.value = 'cash_usd'

    const result = await sheet.confirm()

    expect(result.warning).toBeUndefined()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans') && sql.includes(`'cancelled'`))).toBe(true)
  })

  it('does not re-cancel or re-audit-log a plan that a concurrent transaction already cancelled', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = mockTx({
      plan: { id: 'plan-1', status: 'active' }, // lookup still sees 'active' snapshot pre-race
      saleLineRows: [{ product_id: 'p1', quantity: 1 }],
      returnedRows: [{ product_id: 'p1', returned_qty: 1 }],
      planCancelSucceeds: false, // but the guarded UPDATE matches zero rows (already cancelled)
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (s.includes('FROM sales s')) return { rows: { _array: [{ id: 'sale-1', display_sale_number: '1', customer_id: null, customer_name: null, sale_discount_amount_usd: 0 }] } } as any
      if (s.includes('FROM exchange_rates')) return { rows: { _array: [{ rate: 1 }] } } as any
      return { rows: { _array: [] } } as any
    })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'
    await sheet.confirm()

    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.cancelled']),
    )
  })

  it('propagates a mid-transaction failure without logging any audit event (atomicity)', async () => {
    mockLoad([{ product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 10 }])
    const txExecute = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO return_line_items')) throw new Error('simulated failure')
      return { rows: { _array: [] } }
    })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })

    const sheet = useReturnSheet('sale-1')
    await sheet.load()
    sheet.lines.value[0].selected = true
    sheet.refundMethod.value = 'cash_usd'

    await expect(sheet.confirm()).rejects.toThrow('simulated failure')
    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.anything(),
    )
  })
})
