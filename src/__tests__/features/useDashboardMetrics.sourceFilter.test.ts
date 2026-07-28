import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { db } from '@/data/powersync/db'

// WAFI-008: the source filter is optional and, when omitted, must be a
// complete no-op — this proves the default behavior (no `sources` argument,
// what every existing caller does today) is unchanged, and that supplying
// `sources` does add the expected SQL clause + bind param.
describe('useDashboardMetrics — WAFI-008 source filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0, cogs: 0, count: 0 } as any)
  })

  it('adds no source clause and no extra bind params when sources is omitted', async () => {
    const m = useDashboardMetrics()
    await m.loadRange('2026-04-01', '2026-06-30')

    for (const [sql, params] of vi.mocked(db.getOptional).mock.calls) {
      expect(sql).not.toMatch(/\.source IN/)
      expect(params).not.toContain('pos')
    }
  })

  it('adds "AND <alias>.source IN (?)" and the bind param on every sales-derived query when sources is provided', async () => {
    const m = useDashboardMetrics()
    await m.loadRange('2026-04-01', '2026-06-30', { sources: ['pos'] })

    const revenueCall = vi.mocked(db.getOptional).mock.calls.find(c => /SUM\(total_usd\)/.test(c[0] as string))
    expect(revenueCall![0]).toMatch(/sales\.source IN \(\?\)/)
    expect(revenueCall![1]).toContain('pos')

    const cogsCall = vi.mocked(db.getOptional).mock.calls.find(
      c => /as cogs/.test(c[0] as string) && /sale_line_items/.test(c[0] as string) && !/return/.test(c[0] as string)
    )
    expect(cogsCall![0]).toMatch(/s\.source IN \(\?\)/)
    expect(cogsCall![1]).toContain('pos')

    const refundCall = vi.mocked(db.getOptional).mock.calls.find(
      c => /FROM returns r/.test(c[0] as string) && /refund_amount_usd/.test(c[0] as string)
    )
    expect(refundCall![0]).toMatch(/s\.source IN \(\?\)/)
    expect(refundCall![1]).toContain('pos')
  })
})
