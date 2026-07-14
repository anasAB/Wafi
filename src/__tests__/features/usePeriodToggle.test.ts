import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

describe('usePeriodToggle — time-of-day cold-start default (Task 10 / epic 3.2)', () => {
  // The module-level singleton is created once, at first import — so verifying
  // the *initial* value for a given hour requires a fresh module instance per
  // case (vi.resetModules + a dynamic re-import), not the already-imported
  // `usePeriodToggle` above.
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to "today" when the app is opened before noon', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00'))

    const fresh = await import('@/features/dashboard/composables/usePeriodToggle')
    const { period } = fresh.usePeriodToggle()
    expect(period.value).toBe('today')
  })

  it('defaults to "week" when the app is opened at/after noon', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T14:00:00'))

    const fresh = await import('@/features/dashboard/composables/usePeriodToggle')
    const { period } = fresh.usePeriodToggle()
    expect(period.value).toBe('week')
  })

  it('defaults to "week" exactly at noon (boundary)', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00'))

    const fresh = await import('@/features/dashboard/composables/usePeriodToggle')
    const { period } = fresh.usePeriodToggle()
    expect(period.value).toBe('week')
  })
})
