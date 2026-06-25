import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProfitTrend } from '@/features/dashboard/composables/useProfitTrend'
import { db } from '@/data/powersync/db'

describe('useProfitTrend', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('nets refunds, restocked COGS, and expenses per day bucket', async () => {
    // Day 06-01: sales 100, cogs 40, expenses 10 → profit 50
    // Day 06-02: sales 200, cogs 80, refund 20, reversal 8, expenses 0 → (200-20)-(80-8)-0 = 108
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales\b/.test(sql) && /total_usd/.test(sql))
        return [{ day: '2026-06-01', total: 100 }, { day: '2026-06-02', total: 200 }] as any
      if (/sale_line_items/.test(sql) && !/return/.test(sql))
        return [{ day: '2026-06-01', cogs: 40 }, { day: '2026-06-02', cogs: 80 }] as any
      if (/FROM returns/.test(sql) && /refund_amount_usd/.test(sql))
        return [{ day: '2026-06-02', total: 20 }] as any
      if (/return_line_items/.test(sql))
        return [{ day: '2026-06-02', cogs: 8 }] as any
      if (/FROM expenses/.test(sql))
        return [{ day: '2026-06-01', total: 10 }] as any
      return [] as any
    })

    const t = useProfitTrend()
    await t.load('2026-06-01', '2026-06-02', 'day')

    const byLabel = Object.fromEntries(t.points.value.map(p => [p.label, p.profitUsd]))
    expect(byLabel['1/6']).toBe(50)
    expect(byLabel['2/6']).toBe(108)
    // bars sum to the period profit (50 + 108 = 158)
    expect(t.points.value.reduce((s, p) => s + p.profitUsd, 0)).toBe(158)
  })

  it('groups by month when bucket is month', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales\b/.test(sql) && /total_usd/.test(sql))
        return [{ day: '2026-04', total: 300 }, { day: '2026-05', total: 100 }] as any
      if (/sale_line_items/.test(sql) && !/return/.test(sql))
        return [{ day: '2026-04', cogs: 100 }] as any
      return [] as any
    })
    const t = useProfitTrend()
    await t.load('2026-04-01', '2026-05-31', 'month')
    const byLabel = Object.fromEntries(t.points.value.map(p => [p.label, p.profitUsd]))
    expect(byLabel['2026-04']).toBe(200)   // 300 - 100
    expect(byLabel['2026-05']).toBe(100)
  })
})
