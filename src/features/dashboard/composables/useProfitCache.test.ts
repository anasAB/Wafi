import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProfitCache } from './useProfitCache'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

describe('useProfitCache', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('sums whole-cent rows across a date range and derives net figures at read time', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { revenue_usd: 10000, revenue_syp: 0, cogs_usd: 6000, cogs_reversal_usd: 0, expenses_usd: 0,
        refunds_usd: 0, discount_usd: 0, invoice_count: 1, return_count: 0, costless_sale_count: 0 },
      { revenue_usd: 10000, revenue_syp: 0, cogs_usd: 6000, cogs_reversal_usd: 6000, expenses_usd: 0,
        refunds_usd: 10000, discount_usd: 0, invoice_count: 1, return_count: 1, costless_sale_count: 0 },
    ] as any)

    const { metrics, loadRange } = useProfitCache()
    await loadRange('2026-08-01', '2026-08-31')

    // Sale 1: $100 rev, $60 cogs, no return. Sale 2: $100 rev fully refunded, $60 cogs fully reversed.
    expect(metrics.value.revenueUsd).toBe(200)
    expect(metrics.value.refundsUsd).toBe(100)
    expect(metrics.value.netRevenueUsd).toBe(100)   // 200 - 100
    expect(metrics.value.cogsUsd).toBe(120)
    expect(metrics.value.cogsReversalUsd).toBe(60)
    expect(metrics.value.netCogsUsd).toBe(60)        // 120 - 60
    expect(metrics.value.profitUsd).toBe(40)         // 100 - 60 - 0 expenses
  })

  it('clamps a negative summed costlessSaleCount to 0 for display, without throwing', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { revenue_usd: 0, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0, expenses_usd: 0,
        refunds_usd: 0, discount_usd: 0, invoice_count: 0, return_count: 0, costless_sale_count: -1 },
    ] as any)

    const { metrics, loadRange } = useProfitCache()
    await loadRange('2026-08-01', '2026-08-31')

    expect(metrics.value.costlessSaleCount).toBe(0)
  })

  it('sets profitIsEstimated true when costlessSaleCount > 0', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { revenue_usd: 0, revenue_syp: 0, cogs_usd: 0, cogs_reversal_usd: 0, expenses_usd: 0,
        refunds_usd: 0, discount_usd: 0, invoice_count: 0, return_count: 0, costless_sale_count: 2 },
    ] as any)

    const { metrics, loadRange } = useProfitCache()
    await loadRange('2026-08-01', '2026-08-31')

    expect(metrics.value.profitIsEstimated).toBe(true)
  })

  it('queries profit_cache scoped by shop and day range', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])

    const { loadRange } = useProfitCache()
    await loadRange('2026-08-01', '2026-08-31')

    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM profit_cache'),
      ['shop-1', '2026-08-01', '2026-08-31'],
    )
  })
})
