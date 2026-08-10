import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useStaffIntelligence } from '@/features/dashboard/composables/useStaffIntelligence'

describe('useStaffIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shop average discount rate is dollar-weighted, not an average of per-staff rates', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/COUNT\(\*\) AS salesCount/.test(s)) {
        return [
          { staffId: 'ahmed', name: 'Ahmed', salesCount: 10, grossUsd: 1000 },
          { staffId: 'sara', name: 'Sara', salesCount: 2, grossUsd: 100 },
        ] as any
      }
      if (/SUM\(sli\.quantity/.test(s)) return [] as any
      if (/cs\.staff_id AS staffId, COALESCE\(SUM\(r\.refund_amount_usd\)/.test(s)) return [] as any
      if (/rli\.qty_returned/.test(s)) return [] as any
      if (/SUM\(s\.?sale_discount_amount_usd\)/.test(s)) {
        return [
          { staffId: 'ahmed', discountUsd: 100 },
          { staffId: 'sara', discountUsd: 0 },
        ] as any
      }
      return [] as any
    })
    const { data, load } = useStaffIntelligence()
    await load('week')
    // weighted: (100 + 0) / (1000 + 100) = 9.0909...%, NOT average(10%, 0%) = 5%
    expect(data.value?.shopAverageDiscountRatePct).toBeCloseTo(9.09, 1)
    expect(data.value?.topPerformer?.staffId).toBe('ahmed')
    expect(data.value?.highestDiscountRate?.staffId).toBe('ahmed')
  })
})
