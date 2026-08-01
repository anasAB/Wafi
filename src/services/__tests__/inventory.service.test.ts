import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))

import { db } from '@/data/powersync/db'
import { receiveStock, adjustInventory } from '@/services/inventory.service'
import type { ReceiveStockInput } from '@/services/inventory.service'

describe('InventoryService.receiveStock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [{ rate: 1 }] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue(null)
  })

  const input: ReceiveStockInput = {
    supplierId: 'sup1',
    supplierName: 'مورد الكتروني',
    lines: [{
      productId: 'p1', productName: 'Samsung A55', currentCostUsd: 200,
      qtyReceived: 5, unitCostUsd: 210, updateCost: true,
    }],
    invoicePhotoUrl: null,
    notes: '',
  }
  const fakeAudit = { logReceivingCreated: vi.fn().mockResolvedValue(undefined) }

  it('runs one writeTransaction inserting the header and one line item', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await receiveStock('shop1', 'staff1', input, fakeAudit)

    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stock_receivings'),
      expect.any(Array),
    )
    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stock_receiving_line_items'),
      expect.any(Array),
    )
    expect(result.totalCostUsd).toBe(5 * 210)
  })

  it('increments product current_stock by qtyReceived within the same transaction', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await receiveStock('shop1', 'staff1', input, fakeAudit)

    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products SET current_stock'),
      expect.arrayContaining([15]),  // 10 + 5
    )
  })

  it('skips cost_price_usd update when updateCost is false (WAFI-021 guard)', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await receiveStock('shop1', 'staff1', {
      ...input,
      lines: [{ ...input.lines[0], updateCost: false }],
    }, fakeAudit)

    const costUpdateCall = txExecute.mock.calls.find((c: any[]) =>
      String(c[0]).includes('cost_price_usd'))
    expect(costUpdateCall).toBeUndefined()
  })

  it('skips cost_price_usd update when unitCostUsd is 0, even if updateCost is true (WAFI-021 guard)', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    await receiveStock('shop1', 'staff1', {
      ...input,
      lines: [{ ...input.lines[0], unitCostUsd: 0 }],
    }, fakeAudit)

    const costUpdateCall = txExecute.mock.calls.find((c: any[]) =>
      String(c[0]).includes('cost_price_usd'))
    expect(costUpdateCall).toBeUndefined()
  })

  it('calls the injected audit port with the created receiving id/supplier/total/lines', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await receiveStock('shop1', 'staff1', input, fakeAudit)

    expect(fakeAudit.logReceivingCreated).toHaveBeenCalledWith(
      result.id, 'مورد الكتروني', result.totalCostUsd, 1, expect.any(Array),
    )
  })

  it('falls back to the supplier table name when supplierName is blank', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))
    vi.mocked(db.getOptional).mockResolvedValueOnce({ name: 'Real Supplier Name' } as any)

    await receiveStock('shop1', 'staff1', { ...input, supplierName: '' }, fakeAudit)

    expect(fakeAudit.logReceivingCreated).toHaveBeenCalledWith(
      expect.any(String), 'Real Supplier Name', expect.any(Number), 1, expect.any(Array),
    )
  })

  it('throws without inserting when supplierId is missing', async () => {
    await expect(receiveStock('shop1', 'staff1', { ...input, supplierId: '' }, fakeAudit)).rejects.toThrow()
    expect(db.writeTransaction).not.toHaveBeenCalled()
  })

  it('publishes inventory.stock_received with exactly the StockReceivedPayload keys', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))
    const { publishEvent } = await import('@/services/events/publishEvent')

    await receiveStock('shop1', 'staff1', input, fakeAudit)

    const event = vi.mocked(publishEvent).mock.calls[0][0]
    expect(Object.keys(event.payload).sort()).toEqual(
      ['receivingId', 'supplierId', 'skuCount', 'totalCost'].sort(),
    )
  })
})

describe('InventoryService.adjustInventory', () => {
  const fakeAdjustAudit = { logStockAdjusted: vi.fn().mockResolvedValue(undefined) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mode: absolute — clamps to 0 and never goes negative', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 5 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await adjustInventory('shop1', 'device1', {
      mode: 'absolute', productId: 'p1', newValue: -3, reason: 'other',
    }, fakeAdjustAudit)

    expect(result?.newValue).toBe(0)
    expect(txExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products SET current_stock'),
      expect.arrayContaining([0]),
    )
  })

  it('mode: delta — adds delta to current stock, read-modify-write inside one transaction (WAFI-121)', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: -4, reason: 'stocktake',
    }, fakeAdjustAudit)

    expect(result?.oldValue).toBe(10)
    expect(result?.newValue).toBe(6)
  })

  it('mode: delta — clamps to 0 and never goes negative', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 3 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: -10, reason: 'damaged',
    }, fakeAdjustAudit)

    expect(result?.newValue).toBe(0)
  })

  it('mode: delta — no-op when delta is 0 (matches existing adjustStockBy early-return)', async () => {
    const result = await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: 0, reason: 'stocktake',
    }, fakeAdjustAudit)
    expect(db.writeTransaction).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('calls the injected audit port with product name/old/new value', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))
    vi.mocked(db.getOptional).mockResolvedValueOnce({ name_ar: 'Samsung A55' } as any)

    await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: -4, reason: 'stocktake',
    }, fakeAdjustAudit)

    expect(fakeAdjustAudit.logStockAdjusted).toHaveBeenCalledWith('p1', 'Samsung A55', 10, 6)
  })

  it('the returned adjustment id matches the id actually inserted (regression: id must not be regenerated on return)', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))

    const result = await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: -4, reason: 'stocktake',
    }, fakeAdjustAudit)

    const insertCall = txExecute.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO stock_adjustments'))
    expect(insertCall![1][0]).toBe(result!.id)
  })

  it('publishes inventory.adjusted with exactly the InventoryAdjustedPayload keys', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => fn({ execute: txExecute }))
    const { publishEvent } = await import('@/services/events/publishEvent')

    await adjustInventory('shop1', 'device1', {
      mode: 'delta', productId: 'p1', delta: -4, reason: 'stocktake',
    }, fakeAdjustAudit)

    const event = vi.mocked(publishEvent).mock.calls[0][0]
    expect(Object.keys(event.payload).sort()).toEqual(
      ['productId', 'deltaQty', 'reason'].sort(),
    )
  })
})
