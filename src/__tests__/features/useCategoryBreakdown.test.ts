import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useCategoryBreakdown } from '@/features/dashboard/composables/useCategoryBreakdown'

describe('useCategoryBreakdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('groups revenue/COGS/profit by category, sorted by profit descending, including غير مصنف', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { category_id: 'c1', category_name: 'هواتف',   revenue_usd: 500, cogs_usd: 300, has_missing_cost: 0 },
      { category_id: 'c2', category_name: 'غير مصنف', revenue_usd: 100, cogs_usd: 90,  has_missing_cost: 1 },
    ] as any)

    const { load, rows } = useCategoryBreakdown()
    await load('2026-07-01', '2026-07-14')

    expect(rows.value).toHaveLength(2)
    expect(rows.value[0]).toMatchObject({ categoryName: 'هواتف', revenueUsd: 500, cogsUsd: 300, profitUsd: 200 })
    expect(rows.value[1]).toMatchObject({ categoryName: 'غير مصنف', profitUsd: 10, hasMissingCost: true })
  })
})
