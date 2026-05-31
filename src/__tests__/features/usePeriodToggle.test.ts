import { describe, it, expect, beforeEach } from 'vitest'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'

describe('usePeriodToggle', () => {
  beforeEach(() => {
    const { setPeriod } = usePeriodToggle()
    setPeriod('today')
  })

  it('defaults to today', () => {
    const { period } = usePeriodToggle()
    expect(period.value).toBe('today')
  })

  it('setPeriod changes the value', () => {
    const { period, setPeriod } = usePeriodToggle()
    setPeriod('week')
    expect(period.value).toBe('week')
  })

  it('is a singleton — two instances share state', () => {
    const a = usePeriodToggle()
    const b = usePeriodToggle()
    a.setPeriod('month')
    expect(b.period.value).toBe('month')
  })
})
