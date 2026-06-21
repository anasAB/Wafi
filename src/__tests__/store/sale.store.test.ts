import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleStore } from '@/store/sale.store'

describe('useSaleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('starts with empty lines and no locked rate', () => {
    const store = useSaleStore()
    expect(store.lines).toHaveLength(0)
    expect(store.lockedExchangeRate).toBeNull()
  })

  it('addLine adds a new line', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    expect(store.lines).toHaveLength(1)
    expect(store.totalUsd).toBe(10)
  })

  it('addLine increments quantity for existing product', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].quantity).toBe(2)
    expect(store.lines[0].lineTotalUsd).toBe(20)
  })

  it('addLine never increments quantity beyond availableStock', () => {
    const store = useSaleStore()
    const line = { productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 2 }
    // Five taps, but only 2 in stock.
    store.addLine(line)
    store.addLine(line)
    store.addLine(line)
    store.addLine(line)
    store.addLine(line)
    expect(store.lines[0].quantity).toBe(2)
    expect(store.lines[0].lineTotalUsd).toBe(20)
  })

  it('addLine refuses to add a product with zero stock', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 0 })
    expect(store.lines).toHaveLength(0)
  })

  it('setLockedRate sets rate only on first call', () => {
    const store = useSaleStore()
    store.setLockedRate(14500)
    store.setLockedRate(15000)
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('exposes no re-pricing setter — the locked rate is immutable once set (WAFI-002)', () => {
    const store = useSaleStore()
    store.setLockedRate(14500)
    // The dangerous updateLockedRate setter (which re-priced an open cart on a
    // mid-sale rate edit) must not exist: a sale keeps the rate it locked at.
    expect((store as unknown as Record<string, unknown>).updateLockedRate).toBeUndefined()
  })

  it('clear resets lines and locked rate', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.setLockedRate(14500)
    store.clear()
    expect(store.lines).toHaveLength(0)
    expect(store.lockedExchangeRate).toBeNull()
  })

  it('removeLine removes the correct product', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'أ', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.addLine({ productId: 'p2', nameAr: 'ب', quantity: 1, unitPriceUsd: 5, lineTotalUsd: 5, availableStock: 99 })
    store.removeLine('p1')
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].productId).toBe('p2')
  })

  it('incrementSequence persists to localStorage', () => {
    const store = useSaleStore()
    const before = store.deviceSequence
    store.incrementSequence()
    expect(store.deviceSequence).toBe(before + 1)
    expect(localStorage.getItem('wafi_device_seq')).toBe(String(before + 1))
  })

  it('updateQuantity updates lineTotalUsd; ignores quantity < 1', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.updateQuantity('p1', 3)
    expect(store.lines[0].quantity).toBe(3)
    expect(store.lines[0].lineTotalUsd).toBe(30)
    store.updateQuantity('p1', 0)
    expect(store.lines[0].quantity).toBe(3) // no-op: quantity < 1 rejected
  })

  it('updateQuantity clamps to availableStock', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 2 })
    store.updateQuantity('p1', 5)
    expect(store.lines[0].quantity).toBe(2) // clamped to stock ceiling
    expect(store.lines[0].lineTotalUsd).toBe(20)
  })

  it('updateUnitPrice overrides the charged price and recomputes the line total', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99, listPriceUsd: 10 })
    store.updateQuantity('p1', 2)
    store.updateUnitPrice('p1', 15) // sold above the listed $10
    expect(store.lines[0].unitPriceUsd).toBe(15)
    expect(store.lines[0].lineTotalUsd).toBe(30)
    expect(store.lines[0].listPriceUsd).toBe(10) // list snapshot unchanged
  })

  it('scalePricesToTotal raises line prices so the cart total matches the amount paid', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99, listPriceUsd: 10 })
    // Customer paid $20 for the $10 cart → record it as a $20 sale, not $10 + change.
    store.scalePricesToTotal(20)
    expect(store.totalUsd).toBe(20)
    expect(store.lines[0].unitPriceUsd).toBe(20)
    expect(store.lines[0].listPriceUsd).toBe(10) // list snapshot unchanged → delta shows +$10
  })

  it('scalePricesToTotal distributes proportionally across multiple lines', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'أ', quantity: 1, unitPriceUsd: 6, lineTotalUsd: 6, availableStock: 99 })
    store.addLine({ productId: 'p2', nameAr: 'ب', quantity: 1, unitPriceUsd: 4, lineTotalUsd: 4, availableStock: 99 })
    store.scalePricesToTotal(20) // factor 2
    expect(store.lines[0].unitPriceUsd).toBe(12)
    expect(store.lines[1].unitPriceUsd).toBe(8)
    expect(store.totalUsd).toBe(20)
  })

  it('updateUnitPrice ignores negative or NaN prices', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.updateUnitPrice('p1', -5)
    expect(store.lines[0].unitPriceUsd).toBe(10)
    store.updateUnitPrice('p1', NaN)
    expect(store.lines[0].unitPriceUsd).toBe(10)
  })
})
