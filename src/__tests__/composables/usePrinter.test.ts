import { describe, it, expect, vi } from 'vitest'
import { usePrinter, SimulatedDriver } from '@/composables/usePrinter'
import type { ReceiptData } from '@/composables/usePrinter'

const sampleReceipt: ReceiptData = {
  saleId:            'sale-001',
  displaySaleNumber: 'A-000001',
  shopName:          'محل تجريبي',
  createdAt:         new Date().toISOString(),
  lines: [{ nameAr: 'منتج', quantity: 2, unitPriceUsd: 10, lineTotalUsd: 20 }],
  totalUsd:          20,
  totalSyp:          290000,
  exchangeRate:      14500,
  paymentMethod:     'cash_usd',
}

describe('SimulatedDriver', () => {
  it('resolves without throwing', async () => {
    const driver = new SimulatedDriver()
    await expect(driver.print(sampleReceipt)).resolves.toBeUndefined()
  })

  it('logs receipt to console', async () => {
    const consoleSpy = vi.spyOn(console, 'log')
    const driver = new SimulatedDriver()
    await driver.print(sampleReceipt)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SimulatedPrinter]'),
      expect.anything()
    )
  })
})

describe('usePrinter', () => {
  it('print() resolves when driver succeeds', async () => {
    const { print } = usePrinter(new SimulatedDriver())
    await expect(print(sampleReceipt)).resolves.toBeUndefined()
  })

  it('print() rejects and surfaces error when driver throws', async () => {
    const failDriver = { print: vi.fn().mockRejectedValue(new Error('Printer disconnected')) }
    const { print, error } = usePrinter(failDriver as any)
    await expect(print(sampleReceipt)).rejects.toThrow('Printer disconnected')
    expect(error.value).toBe('Printer disconnected')
  })
})
