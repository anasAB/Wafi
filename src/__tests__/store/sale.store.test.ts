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
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    expect(store.lines).toHaveLength(1)
    expect(store.totalUsd).toBe(10)
  })

  it('addLine increments quantity for existing product', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].quantity).toBe(2)
    expect(store.lines[0].lineTotalUsd).toBe(20)
  })

  it('setLockedRate sets rate only on first call', () => {
    const store = useSaleStore()
    store.setLockedRate(14500)
    store.setLockedRate(15000)
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('clear resets lines and locked rate', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.setLockedRate(14500)
    store.clear()
    expect(store.lines).toHaveLength(0)
    expect(store.lockedExchangeRate).toBeNull()
  })

  it('removeLine removes the correct product', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'أ', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.addLine({ productId: 'p2', nameAr: 'ب', quantity: 1, unitPriceUsd: 5, lineTotalUsd: 5 })
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
})
