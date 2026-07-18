import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useUncostedSalesNotice } from '../useUncostedSalesNotice'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

describe('useUncostedSalesNotice', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('counts distinct sales with an unknown-cost line, not the raw line count', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ c: 3 } as any)
    const { count, load } = useUncostedSalesNotice()
    await load('2026-07-01', '2026-07-31')
    expect(count.value).toBe(3)
    const sql = vi.mocked(db.getOptional).mock.calls[0][0] as string
    expect(sql).toMatch(/COUNT\(DISTINCT sli\.sale_id\)/)
    expect(sql).toMatch(/unit_cost_usd <= 0/)
  })

  it('defaults to 0 when no uncosted sales exist', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(null)
    const { count, load } = useUncostedSalesNotice()
    await load('2026-07-01', '2026-07-31')
    expect(count.value).toBe(0)
  })
})
