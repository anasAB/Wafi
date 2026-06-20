import { describe, it, expect } from 'vitest'
import { autoDetectMapping } from '../useColumnMapping'

describe('autoDetectMapping', () => {
  it('maps canonical Arabic headers', () => {
    const m = autoDetectMapping(['الاسم', 'الباركود', 'سعر البيع', 'التكلفة', 'المخزون الحالي', 'حد التنبيه', 'الفئة'])
    expect(m.nameAr).toBe('الاسم')
    expect(m.barcode).toBe('الباركود')
    expect(m.salePrice).toBe('سعر البيع')
    expect(m.cost).toBe('التكلفة')
    expect(m.currentStock).toBe('المخزون الحالي')
    expect(m.lowStockThreshold).toBe('حد التنبيه')
    expect(m.category).toBe('الفئة')
  })
  it('maps English aliases case-insensitively', () => {
    const m = autoDetectMapping(['Name', 'SKU', 'Price', 'Cost', 'Qty'])
    expect(m.nameAr).toBe('Name')
    expect(m.barcode).toBe('SKU')
    expect(m.salePrice).toBe('Price')
    expect(m.cost).toBe('Cost')
    expect(m.currentStock).toBe('Qty')
  })
  it('leaves unknown fields null', () => {
    const m = autoDetectMapping(['Name', 'Price'])
    expect(m.cost).toBeNull()
    expect(m.barcode).toBeNull()
  })
  it('defaults both currencies to SYP', () => {
    const m = autoDetectMapping(['Name', 'Price'])
    expect(m.priceCurrency).toBe('SYP')
    expect(m.costCurrency).toBe('SYP')
  })
})
