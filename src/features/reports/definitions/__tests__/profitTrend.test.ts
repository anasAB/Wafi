import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a) } }))

import { computeProfitTrendReport } from '../profitTrend'

describe('computeProfitTrendReport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns daily profit rows with single detail section, computing profit from profit_cache values', async () => {
    mockGetAll.mockResolvedValueOnce([
      { day: '2026-08-18', revenue_usd: 50000, cogs_usd: 20000, expenses_usd: 500, refunds_usd: 0, cogs_reversal_usd: 0 },
      { day: '2026-08-19', revenue_usd: 60000, cogs_usd: 24000, expenses_usd: 600, refunds_usd: 5000, cogs_reversal_usd: 1000 },
    ])

    const report = await computeProfitTrendReport('shop1', { from: '2026-08-18', to: '2026-08-19' })

    expect(report.id).toBe('profit-trend')
    expect(report.sections).toHaveLength(1)

    const [section] = report.sections
    expect(section.type).toBe('detail')
    if (section.type === 'detail') {
      expect(section.title).toBe('Daily Profit')
      expect(section.rows).toHaveLength(2)

      // First day: revenue 500, profit = 500 - 200 - 5 = 295
      expect(section.rows[0].day).toBe('2026-08-18')
      expect(section.rows[0].revenueUsd).toBeCloseTo(500)
      expect(section.rows[0].profitUsd).toBeCloseTo(295)

      // Second day: revenue 600, profit = (600 - 50) - (240 - 10) - 6 = 314
      expect(section.rows[1].day).toBe('2026-08-19')
      expect(section.rows[1].revenueUsd).toBeCloseTo(600)
      expect(section.rows[1].profitUsd).toBeCloseTo(314)
    }
  })
})
