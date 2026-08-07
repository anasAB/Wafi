import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))

import { db } from '@/data/powersync/db'
import { completeSale } from '@/services/sales.service'
import type { CompleteSaleInput } from '@/services/sales.service'

function columnIndex(sql: string, column: string): number {
  const match = sql.match(/\(([^)]+)\)\s*VALUES/i)
  if (!match) throw new Error(`no column list found in: ${sql}`)
  const columns = match[1].split(',').map(c => c.trim())
  const index = columns.indexOf(column)
  if (index === -1) throw new Error(`column ${column} not found in: ${match[1]}`)
  return index
}

function setupTx(stockRow: { cost_price_usd: number; current_stock: number } = { cost_price_usd: 0, current_stock: 0 }) {
  const exec = vi.fn().mockImplementation(async (sql: unknown) => {
    if (typeof sql === 'string' && sql.trim().startsWith('SELECT')) {
      return { rows: { _array: [stockRow] } }
    }
    return { rows: { _array: [] } }
  })
  vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: exec }) })
  return exec
}

describe('SalesService.completeSale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const fakeAudit = {
    logDiscountApplied: vi.fn().mockResolvedValue(undefined),
  }

  const baseInput: CompleteSaleInput = {
    shopId: 'shop1', deviceId: 'device1', deviceCode: 'D1', staffId: 'staff1', shiftId: 'shift1',
    deviceSequence: 5,
    method: 'card', amountReceived: null, pendingPayments: [],
    totalUsd: 10, totalSyp: 145000, exchangeRateAtSale: 14500,
    lines: [{ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 }],
    saleDiscount: null,
  }

  it('inserts the sale row with the tagged source and a display number derived from deviceSequence', async () => {
    const exec = setupTx({ cost_price_usd: 0, current_stock: 10 })

    const result = await completeSale(baseInput, fakeAudit)

    const insertCall = exec.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO sales'))
    expect(insertCall).toBeDefined()
    const [sql, params] = insertCall!
    expect(params[columnIndex(sql, 'source')]).toBe('pos')
    expect(params[columnIndex(sql, 'device_sequence')]).toBe(6)  // deviceSequence + 1
    expect(result.displaySaleNumber).toBe('D1-000006')
  })

  it('never mutates any store — the sequence increment is left to the caller (WAFI-004)', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    // If completeSale touched a Pinia store this would throw (no active Pinia instance
    // in this test file) — its absence is itself the assertion.
    await expect(completeSale(baseInput, fakeAudit)).resolves.toBeTruthy()
  })

  it('deducts stock and clamps at 0 on an oversold line, noting the oversold quantity', async () => {
    const exec = setupTx({ cost_price_usd: 3, current_stock: 2 })
    const oversoldInput = { ...baseInput, lines: [{ ...baseInput.lines[0], quantity: 5 }] }

    await completeSale(oversoldInput, fakeAudit)

    const stockAdjustCall = exec.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO stock_adjustments'))
    // (id, shop_id, product_id, old_value, new_value, 'sale' <- literal, not a placeholder>, notes, created_at, device_id)
    const [, params] = stockAdjustCall!
    expect(params[4]).toBe(0)          // new_value
    expect(params[5]).toBe('oversold:3')  // notes
  })

  it('open-item lines never touch current_stock or insert a stock_adjustments row', async () => {
    const exec = setupTx()
    const openItemInput = {
      ...baseInput,
      lines: [{ productId: 'open', nameAr: 'بند حر', quantity: 1, unitPriceUsd: 5, lineTotalUsd: 5, availableStock: 0, isOpenItem: true }],
    }

    await completeSale(openItemInput, fakeAudit)

    expect(exec.mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE products'))).toBe(false)
    expect(exec.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO stock_adjustments'))).toBe(false)
  })

  it('a credit sale writes is_credit=1 and inserts zero sale_payments rows', async () => {
    const exec = setupTx({ cost_price_usd: 0, current_stock: 10 })
    const creditInput = { ...baseInput, method: 'credit' as const }

    const result = await completeSale(creditInput, fakeAudit)

    const insertCall = exec.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO sales'))
    const [sql, params] = insertCall!
    expect(params[columnIndex(sql, 'is_credit')]).toBe(1)
    expect(exec.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO sale_payments'))).toBe(false)
    expect(result.paymentMethod).toBe('credit')
  })

  it('a split payment across cash + card writes is_split=1 and one sale_payments row per entry', async () => {
    const exec = setupTx({ cost_price_usd: 0, current_stock: 10 })
    const splitInput = {
      ...baseInput,
      method: null,
      pendingPayments: [
        { method: 'cash_usd' as const, amountRaw: 6, currency: 'USD' as const, amountUsd: 6, exchangeRate: 14500, changeDue: 0 },
        { method: 'card' as const, amountRaw: 4, currency: 'USD' as const, amountUsd: 4, exchangeRate: 14500, changeDue: 0 },
      ],
    }

    const result = await completeSale(splitInput, fakeAudit)

    const insertCall = exec.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO sales'))
    const [sql, params] = insertCall!
    expect(params[columnIndex(sql, 'is_split')]).toBe(1)
    expect(exec.mock.calls.filter((c: any[]) => String(c[0]).includes('INSERT INTO sale_payments'))).toHaveLength(2)
    expect(result.paymentMethod).toBe('split')
    expect(result.splitPayments).toHaveLength(2)
  })

  it('does not require/call a logSaleCompleted audit hook (WAFI-150: sale completion is now audited automatically by the audit subscriber off sale.completed)', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const result = await completeSale(baseInput, fakeAudit)
    expect(result.saleId).toBeTruthy()
    expect((fakeAudit as any).logSaleCompleted).toBeUndefined()
  })

  it('calls logDiscountApplied once for a discounted line (WAFI-100)', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const discountedInput = {
      ...baseInput,
      lines: [{
        ...baseInput.lines[0],
        discountType: 'percent' as const, discountValue: 10, discountPinApproved: false, listPriceUsd: 12,
      }],
    }

    const result = await completeSale(discountedInput, fakeAudit)

    expect(fakeAudit.logDiscountApplied).toHaveBeenCalledWith(result.saleId, expect.objectContaining({
      discountType: 'percent', discountValue: 10, basePriceUsd: 12, operatorId: 'staff1',
    }))
  })

  it('calls logDiscountApplied for a sale-level discount even with no per-line discounts', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const saleDiscountInput = {
      ...baseInput,
      saleDiscount: { type: 'fixed' as const, value: 2, amountUsd: 2, pinApproved: true },
    }

    const result = await completeSale(saleDiscountInput, fakeAudit)

    expect(fakeAudit.logDiscountApplied).toHaveBeenCalledWith(result.saleId, expect.objectContaining({
      discountType: 'fixed', discountValue: 2, pinApproval: true,
    }))
  })

  it('publishes a sale.discounted event for a discounted line, in addition to sale.completed', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { publishEvent } = await import('@/services/events/publishEvent')
    const discountedInput = {
      ...baseInput,
      lines: [{
        ...baseInput.lines[0],
        // belowCost reads line.unitCostUsd directly (sales.service.ts line ~266), NOT
        // the transaction-read cost_price_usd (that local var only feeds the
        // stock_adjustments insert) -- set it on the input line itself. unitPriceUsd
        // stays at baseInput's 10 (this service never recomputes it from discountValue;
        // the caller is expected to have already applied the discount upstream), so
        // unitCostUsd: 11 > unitPriceUsd: 10 gives belowCost=true.
        unitCostUsd: 11,
        discountType: 'percent' as const, discountValue: 10, discountPinApproved: false, listPriceUsd: 12,
      }],
    }

    const result = await completeSale(discountedInput, fakeAudit)

    const discountEvents = vi.mocked(publishEvent).mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === 'sale.discounted')
    expect(discountEvents).toHaveLength(1)
    expect(discountEvents[0].entityId).toBe(result.saleId)
    expect(discountEvents[0].payload).toMatchObject({
      discountType: 'percent', discountValue: 10, discountPercentage: 10, pinApproval: false, belowCost: true,
    })
  })

  it('publishes a sale.discounted event for a sale-level discount too', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { publishEvent } = await import('@/services/events/publishEvent')
    const saleDiscountInput = {
      ...baseInput,
      saleDiscount: { type: 'fixed' as const, value: 2, amountUsd: 2, pinApproved: true },
    }

    await completeSale(saleDiscountInput, fakeAudit)

    const discountEvents = vi.mocked(publishEvent).mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === 'sale.discounted')
    expect(discountEvents).toHaveLength(1)
    expect(discountEvents[0].payload).toMatchObject({
      discountType: 'fixed', discountValue: 2, pinApproval: true, belowCost: false,
    })
  })

  it('publishes no sale.discounted event when nothing was discounted', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { publishEvent } = await import('@/services/events/publishEvent')

    await completeSale(baseInput, fakeAudit)

    const discountEvents = vi.mocked(publishEvent).mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === 'sale.discounted')
    expect(discountEvents).toHaveLength(0)
  })

  it('does not call logDiscountApplied when nothing was discounted', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    await completeSale(baseInput, fakeAudit)
    expect(fakeAudit.logDiscountApplied).not.toHaveBeenCalled()
  })

  it('rolls up per-method payment totals in the (currently unpublished) event payload shape without throwing', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    await expect(completeSale(baseInput, fakeAudit)).resolves.toBeTruthy()
  })

  it('publishes sale.completed with exactly the SaleCompletedPayload keys', async () => {
    setupTx({ cost_price_usd: 0, current_stock: 10 })
    const { publishEvent } = await import('@/services/events/publishEvent')

    await completeSale(baseInput, fakeAudit)

    const event = vi.mocked(publishEvent).mock.calls[0][0]
    expect(event.type).toBe('sale.completed')
    expect(Object.keys(event.payload).sort()).toEqual(
      ['saleId', 'shopId', 'staffId', 'totalUsd', 'totalSyp', 'paymentSummary', 'itemCount', 'discountApplied'].sort(),
    )
    expect(event.payloadVersion).toBe(1)
  })
})
