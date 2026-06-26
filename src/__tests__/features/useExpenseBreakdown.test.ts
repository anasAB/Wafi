import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useExpenseBreakdown } from '@/features/dashboard/composables/useExpenseBreakdown'

describe('useExpenseBreakdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('merges trimmed categories and computes total', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { category: 'كهرباء', total: 40 },
      { category: 'كهرباء ', total: 10 },
      { category: 'إيجار', total: 100 },
    ] as any)

    const b = useExpenseBreakdown()
    await b.load('2026-06-01', '2026-06-30')

    expect(b.slices.value).toEqual([
      { category: 'إيجار', totalUsd: 100 },
      { category: 'كهرباء', totalUsd: 50 },
    ])
    expect(b.totalUsd.value).toBe(150)
  })

  it('loads entries and strips recurring metadata marker in description', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      {
        id: 'e1',
        category: 'إيجار',
        amount_usd: 100,
        expense_date: '2026-06-01',
        notes: 'دفعة شهرية\n__wafi_recurring__:2026-01-01|2026-12-01',
        photo_url: null,
      },
    ] as any)

    const b = useExpenseBreakdown()
    await b.loadEntries('2026-06-01', '2026-06-30')

    expect(b.entries.value[0]).toMatchObject({
      description: 'دفعة شهرية',
      category: 'إيجار',
      amountUsd: 100,
    })
  })
})
