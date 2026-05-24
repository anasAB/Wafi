import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useExchangeRate } from '@/features/exchange-rate/useExchangeRate'
import { db } from '@/data/powersync/db'

describe('useExchangeRate', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('currentRate is null when no rates in db', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: { _array: [] } } as any)
    const { currentRate, loadRate } = useExchangeRate()
    await loadRate()
    expect(currentRate.value).toBeNull()
  })

  it('currentRate reflects latest rate from db', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ rate: 14500, set_at: new Date().toISOString() }] },
    } as any)
    const { currentRate, loadRate } = useExchangeRate()
    await loadRate()
    expect(currentRate.value).toBe(14500)
  })

  it('saveRate rejects value <= 0', async () => {
    const { saveRate } = useExchangeRate()
    await expect(saveRate(0)).rejects.toThrow('Rate must be greater than zero')
  })

  it('saveRate sets needsConfirmation when > 50% change', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ rate: 14500, set_at: new Date().toISOString() }] },
    } as any)
    const { loadRate, saveRate, needsConfirmation } = useExchangeRate()
    await loadRate()
    saveRate(22000)  // ~52% increase
    expect(needsConfirmation.value).toBe(true)
  })
})
