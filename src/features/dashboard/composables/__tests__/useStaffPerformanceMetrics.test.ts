import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useStaffPerformanceMetrics } from '@/features/dashboard/composables/useStaffPerformanceMetrics'

describe('useStaffPerformanceMetrics — discountUsd/discountRate', () => {
  beforeEach(() => vi.resetAllMocks())

  it('computes discountRate = discountUsd / grossUsd per staff, null when grossUsd is 0', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/COUNT\(\*\) AS salesCount/.test(s)) {
        return [{ staffId: 's1', name: 'Ahmed', salesCount: 10, grossUsd: 1000 }] as any
      }
      if (/SUM\(sli\.quantity/.test(s)) return [] as any
      if (/cs\.staff_id AS staffId, COALESCE\(SUM\(r\.refund_amount_usd\)/.test(s)) return [] as any
      if (/rli\.qty_returned/.test(s)) return [] as any
      if (/SUM\(s\.?sale_discount_amount_usd\)/.test(s)) {
        return [{ staffId: 's1', discountUsd: 100 }] as any
      }
      return [] as any
    })
    const perf = useStaffPerformanceMetrics()
    await perf.load('2026-08-01', '2026-08-10')
    expect(perf.rows.value[0].discountUsd).toBe(100)
    expect(perf.rows.value[0].discountRate).toBe(10) // 100/1000 * 100
  })
})
