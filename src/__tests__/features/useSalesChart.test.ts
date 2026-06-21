import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useSalesChart } from '@/features/dashboard/composables/useSalesChart'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import { db } from '@/data/powersync/db'

describe('useSalesChart — local-time bucketing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([] as any)
  })

  // created_at is stored as UTC (toISOString). The dashboard metrics bucket with
  // DATE(created_at, 'localtime'); the chart MUST match or the two disagree and
  // late-night sales land on the wrong bar. Guard the SQL string directly.
  it('buckets sales by local-time date', async () => {
    const { load } = useSalesChart()
    await load('week')
    const salesSql = vi.mocked(db.getAll).mock.calls[0][0]
    expect(salesSql).toContain("DATE(created_at, 'localtime')")
    expect(salesSql).not.toMatch(/DATE\(created_at\)/)
  })

  it('buckets COGS by local-time date', async () => {
    const { load } = useSalesChart()
    await load('week')
    const cogsSql = vi.mocked(db.getAll).mock.calls[1][0]
    expect(cogsSql).toContain("DATE(s.created_at, 'localtime')")
    expect(cogsSql).not.toMatch(/DATE\(s\.created_at\)(?!,)/)
  })

  it('nets refunds and reverses restocked COGS per day to match the cards (WAFI-006)', async () => {
    const { start } = getDateRange('today')
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([{ day: start, total: 450 }] as any)  // gross sales
      .mockResolvedValueOnce([{ day: start, cogs: 210 }] as any)   // gross COGS
      .mockResolvedValueOnce([{ day: start, total: 100 }] as any)  // refunds
      .mockResolvedValueOnce([{ day: start, cogs: 60 }] as any)    // restocked COGS reversal
    const { data, load } = useSalesChart()
    await load('today')
    expect(data.value.sales[0]).toBe(350)   // 450 gross − 100 refund
    expect(data.value.profit[0]).toBe(200)  // (450−100) − (210−60)
  })

  it('queries refunds and restocked-COGS reversal per day (WAFI-006)', async () => {
    const { load } = useSalesChart()
    await load('week')
    const sqls = vi.mocked(db.getAll).mock.calls.map(c => c[0] as string)

    const refundSql = sqls.find(s => s.includes('refund_amount_usd') && s.includes('FROM returns'))
    expect(refundSql).toBeDefined()
    expect(refundSql).toContain('GROUP BY')

    const reversalSql = sqls.find(s => s.includes('qty_returned') && s.includes('restock'))
    expect(reversalSql).toBeDefined()
    expect(reversalSql).toContain('GROUP BY')
    // Same per-(sale, product) dedup as the cards (WAFI-005) — no row-multiplying join.
    expect(reversalSql).not.toMatch(/JOIN\s+sale_line_items\s+sli\s+ON\s+sli\.sale_id\s*=\s*r\.original_sale_id/i)
  })
})
