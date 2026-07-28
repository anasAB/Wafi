import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProfitTrend } from '@/features/dashboard/composables/useProfitTrend'
import { db } from '@/data/powersync/db'

// WAFI-008: same no-op-by-default guarantee as useDashboardMetrics.
describe('useProfitTrend — WAFI-008 source filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([] as any)
  })

  it('adds no source clause and no extra bind params when sources is omitted', async () => {
    const t = useProfitTrend()
    await t.load('2026-06-01', '2026-06-02', 'day')

    for (const [sql, params] of vi.mocked(db.getAll).mock.calls) {
      expect(sql).not.toMatch(/\.source IN/)
      expect(params).not.toContain('pos')
    }
  })

  it('adds "AND <alias>.source IN (?)" and the bind param when sources is provided', async () => {
    const t = useProfitTrend()
    await t.load('2026-06-01', '2026-06-02', 'day', { sources: ['pos'] })

    const salesCall = vi.mocked(db.getAll).mock.calls.find(c => /FROM sales\b/.test(c[0] as string) && /total_usd/.test(c[0] as string))
    expect(salesCall![0]).toMatch(/sales\.source IN \(\?\)/)
    expect(salesCall![1]).toContain('pos')

    const cogsCall = vi.mocked(db.getAll).mock.calls.find(c => /sale_line_items sli\b/.test(c[0] as string) && !/return/.test(c[0] as string))
    expect(cogsCall![0]).toMatch(/s\.source IN \(\?\)/)
    expect(cogsCall![1]).toContain('pos')
  })
})
