import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useStockTakeHistory } from '@/features/stock-take/composables/useStockTakeHistory'

describe('useStockTakeHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads completed sessions newest-first and sums the last 3 for a trend total', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 's3', started_at: '2026-07-14T00:00:00Z', created_by: 'dev1', products_counted: 20, total_shrinkage_usd: -15 },
      { id: 's2', started_at: '2026-07-01T00:00:00Z', created_by: 'dev1', products_counted: 18, total_shrinkage_usd: -5 },
      { id: 's1', started_at: '2026-06-14T00:00:00Z', created_by: 'dev1', products_counted: 15, total_shrinkage_usd: 2 },
      { id: 's0', started_at: '2026-06-01T00:00:00Z', created_by: 'dev1', products_counted: 10, total_shrinkage_usd: -1 },
    ] as any)

    const { load, sessions, lastThreeTrendUsd } = useStockTakeHistory()
    await load()

    expect(sessions.value).toHaveLength(4)
    expect(sessions.value[0].id).toBe('s3')
    expect(lastThreeTrendUsd.value).toBe(-15 + -5 + 2)
  })
})
