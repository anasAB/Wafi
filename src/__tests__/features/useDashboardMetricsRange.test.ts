import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { db } from '@/data/powersync/db'

describe('useDashboardMetrics.loadRange', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('runs the metric queries against the passed start/end and computes profit', async () => {
    // revenue 500, cogs 200, expenses 50 → profit 250; one costless sale → estimated.
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      // Order matters: the costless-sales query mentions return_line_items in its
      // returned-qty subquery, so match its unique EXISTS clause FIRST, before the
      // generic return_line_items branch (which is the COGS-reversal query).
      if (/EXISTS/.test(sql))                      return { count: 1 } as any  // costless sales → estimated
      if (/COUNT\(\*\) as count FROM sales/.test(sql)) return { count: 7 } as any  // invoice count
      if (/SUM\(total_usd\)/.test(sql))            return { total: 500 } as any
      if (/as cogs/.test(sql) && /sale_line_items/.test(sql) && !/return/.test(sql)) return { cogs: 200 } as any
      if (/FROM expenses/.test(sql))               return { total: 50 } as any
      if (/FROM returns/.test(sql))                return { total: 0 } as any
      if (/return_line_items/.test(sql))           return { cogs: 0 } as any
      if (/FROM products/.test(sql))               return { count: 0 } as any
      return { total: 0 } as any
    })

    const m = useDashboardMetrics()
    await m.loadRange('2026-04-01', '2026-06-30')

    expect(m.revenueUsd.value).toBe(500)
    expect(m.profitUsd.value).toBe(250)     // 500 - 200 - 50
    expect(m.profitIsEstimated.value).toBe(true)

    // every range-bounded query received the explicit start/end as params
    const revCall = vi.mocked(db.getOptional).mock.calls.find(c => /SUM\(total_usd\)/.test(c[0] as string))
    expect(revCall![1]).toEqual(expect.arrayContaining(['2026-04-01', '2026-06-30']))
  })
})
