import { describe, it, expect, vi } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '../notificationSettings'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn() } }))

describe('getNotificationSettings', () => {
  it('returns the hardcoded default when no row exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    const s = await getNotificationSettings('shop1', 'drawer.variance')
    expect(s).toEqual({ type: 'drawer.variance', enabled: true, varianceUsdCap: 15 })
  })

  it('overrides the default when a row exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      enabled: 0, threshold_json: JSON.stringify({ type: 'drawer.variance', varianceUsdCap: 25 }),
    } as any)
    const s = await getNotificationSettings('shop1', 'drawer.variance')
    expect(s).toEqual({ type: 'drawer.variance', enabled: false, varianceUsdCap: 25 })
  })

  it('falls back to the default threshold if the stored row has enabled but no threshold_json', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ enabled: 1, threshold_json: null } as any)
    const s = await getNotificationSettings('shop1', 'sale.large_return')
    expect(s).toEqual({ type: 'sale.large_return', enabled: true, refundUsdCap: 100 })
  })

  it('falls back to the default threshold without throwing when threshold_json is malformed JSON', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ enabled: 1, threshold_json: '{not valid json' } as any)
    const s = await getNotificationSettings('shop1', 'sale.large_return')
    expect(s).toEqual({ type: 'sale.large_return', enabled: true, refundUsdCap: 100 })
  })
})
