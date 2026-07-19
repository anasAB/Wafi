import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffActivity } from '@/features/staff-ledger/composables/useStaffActivity'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

describe('useStaffActivity.getPosActivityDays', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('queries distinct opened_at dates from cashier_shifts scoped to shop, staff, and month', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{ activity_date: '2026-03-01' }, { activity_date: '2026-03-15' }] as any)

    const { getPosActivityDays } = useStaffActivity()
    const days = await getPosActivityDays('emp-1', '2026-03-01')

    expect(days).toEqual(['2026-03-01', '2026-03-15'])
    const [sql, params] = vi.mocked(db.getAll).mock.calls[0]
    expect(sql).toContain('DISTINCT date(opened_at)')
    expect(sql).toContain('cashier_shifts')
    expect(params).toEqual(['shop-1', 'emp-1', '2026-03-01', '2026-03-31'])
  })
})
