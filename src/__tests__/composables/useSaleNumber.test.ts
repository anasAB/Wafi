import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleNumber } from '@/composables/useSaleNumber'
import { useSaleStore } from '@/store/sale.store'
import { useDeviceStore } from '@/store/device.store'

describe('useSaleNumber', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('formats as {code}-{6-digit} adding 1 to sequence', () => {
    const { formatNumber } = useSaleNumber()
    expect(formatNumber('A', 246)).toBe('A-000247')
  })

  it('pads sequence 0 to 000001', () => {
    const { formatNumber } = useSaleNumber()
    expect(formatNumber('A', 0)).toBe('A-000001')
  })

  it('handles multi-char device code', () => {
    const { formatNumber } = useSaleNumber()
    expect(formatNumber('T-a1f3', 999)).toBe('T-a1f3-001000')
  })

  it('nextNumber increments store.deviceSequence and returns formatted number', () => {
    const store = useSaleStore()
    const before = store.deviceSequence
    const { nextNumber } = useSaleNumber()
    const result = nextNumber()
    expect(store.deviceSequence).toBe(before + 1)
    expect(result).toContain('-')
    // The returned number should reflect the incremented sequence
    const expectedSeq = String(before + 1).padStart(6, '0')
    expect(result).toContain(expectedSeq)
  })
})
