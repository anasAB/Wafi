import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAutomaticInsights } from '../useAutomaticInsights'
import { getShopCreatedAt } from '../insights/shopCreatedAt'
import { getRevenueUsdUpToTimestamp } from '../insights/revenueUpToTimestamp'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'

vi.mock('../insights/shopCreatedAt')
vi.mock('../insights/revenueUpToTimestamp')
vi.mock('@/features/dashboard/composables/useDashboardMetrics')

function mockMetrics(revenueUsd: number, profitUsd: number) {
  return {
    revenueUsd: { value: revenueUsd },
    profitUsd: { value: profitUsd },
    loadRange: vi.fn().mockResolvedValue(undefined),
  }
}

describe('useAutomaticInsights', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getShopCreatedAt).mockResolvedValue('2020-01-01T00:00:00.000Z')
  })

  it('week: loads current and comparison via useDashboardMetrics.loadRange and evaluates both metrics', async () => {
    const current = mockMetrics(115, 130)
    const comparison = mockMetrics(100, 100)
    vi.mocked(useDashboardMetrics)
      .mockReturnValueOnce(current as any)
      .mockReturnValueOnce(comparison as any)

    const { insights, load, error } = useAutomaticInsights()
    await load('week')

    expect(error.value).toBeNull()
    expect(insights.value).toEqual([
      { metric: 'revenue', direction: 'up', currentUsd: 115, previousUsd: 100, percentChange: 15 },
      { metric: 'profit', direction: 'up', currentUsd: 130, previousUsd: 100, percentChange: 30 },
    ])
  })

  it('day, in progress: uses getRevenueUsdUpToTimestamp for the comparison revenue and generates no profit insight', async () => {
    const current = mockMetrics(85, 999) // profit value must be ignored on this path
    vi.mocked(useDashboardMetrics).mockReturnValueOnce(current as any)
    vi.mocked(getRevenueUsdUpToTimestamp).mockResolvedValue(100)

    const midday = new Date(2026, 7, 12, 14, 0, 0)
    const { insights, load } = useAutomaticInsights()
    await load('day', midday)

    expect(getRevenueUsdUpToTimestamp).toHaveBeenCalledWith('2026-08-05', expect.stringContaining('2026-08-05'))
    expect(insights.value).toEqual([
      { metric: 'revenue', direction: 'down', currentUsd: 85, previousUsd: 100, percentChange: -15 },
    ])
  })

  it('skips both metrics when the comparison period predates shop creation', async () => {
    vi.mocked(getShopCreatedAt).mockResolvedValue('2026-08-20T00:00:00.000Z') // shop created AFTER the comparison window
    const current = mockMetrics(450, 200)
    const comparison = mockMetrics(0, 0)
    vi.mocked(useDashboardMetrics)
      .mockReturnValueOnce(current as any)
      .mockReturnValueOnce(comparison as any)

    const { insights, load } = useAutomaticInsights()
    await load('week')

    expect(insights.value).toEqual([])
  })

  it('sets error on failure and leaves insights empty', async () => {
    vi.mocked(useDashboardMetrics).mockImplementation(() => {
      throw new Error('db unavailable')
    })
    const { insights, error, load } = useAutomaticInsights()
    await load('week')
    expect(error.value).toBe('db unavailable')
    expect(insights.value).toEqual([])
  })
})
