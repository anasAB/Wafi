import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffPerformanceMetrics } from '@/features/dashboard/composables/useStaffPerformanceMetrics'
import { db } from '@/data/powersync/db'

describe('useStaffPerformanceMetrics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('computes per-staff revenue, COGS, margin, and margin share, attributing a return to the shift owner rather than the original salesperson', async () => {
    // Ahmed sold $500 (2 sales), cogs $200. Sara sold $300 (1 sale), cogs $100.
    // A $50 return (restock, cogs reversal $20) happened during Sara's shift,
    // even though the original sale (part of Ahmed's $500) was Ahmed's.
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales s\b/.test(sql) && /grossUsd/.test(sql)) {
        return [
          { staffId: 'ahmed', name: 'Ahmed', salesCount: 2, grossUsd: 500 },
          { staffId: 'sara',  name: 'Sara',  salesCount: 1, grossUsd: 300 },
        ] as any
      }
      if (/FROM sale_line_items sli\b/.test(sql) && /JOIN sales s ON sli.sale_id = s.id/.test(sql)) {
        return [
          { staffId: 'ahmed', cogs: 200 },
          { staffId: 'sara',  cogs: 100 },
        ] as any
      }
      if (/FROM returns r\b/.test(sql) && /refund_amount_usd/.test(sql)) {
        return [{ staffId: 'sara', total: 50 }] as any
      }
      if (/FROM return_line_items rli\b/.test(sql)) {
        return [{ staffId: 'sara', cogs: 20 }] as any
      }
      return [] as any
    })

    const perf = useStaffPerformanceMetrics()
    await perf.load('2026-07-01', '2026-07-31')

    const byId = Object.fromEntries(perf.rows.value.map(r => [r.staffId, r]))

    // Ahmed: unaffected by the return (it's attributed to Sara's shift).
    expect(byId.ahmed.revenueUsd).toBe(500)
    expect(byId.ahmed.cogsUsd).toBe(200)
    expect(byId.ahmed.marginUsd).toBe(300)
    expect(byId.ahmed.salesCount).toBe(2)
    expect(byId.ahmed.avgTicketUsd).toBe(250)

    // Sara: revenue and cogs reduced by the return she processed, even though
    // it was Ahmed's original sale.
    expect(byId.sara.revenueUsd).toBe(250)   // 300 - 50
    expect(byId.sara.cogsUsd).toBe(80)       // 100 - 20
    expect(byId.sara.marginUsd).toBe(170)    // 250 - 80
    expect(byId.sara.avgTicketUsd).toBe(300) // gross ticket size, unaffected by the return

    // Margin share: total margin = 300 + 170 = 470.
    expect(byId.ahmed.marginPct).toBeCloseTo((300 / 470) * 100, 5)
    expect(byId.sara.marginPct).toBeCloseTo((170 / 470) * 100, 5)
  })

  it('reports avgTicketUsd as null (not 0 or NaN) for a staff member with zero sales', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales s\b/.test(sql) && /grossUsd/.test(sql)) {
        return [{ staffId: 'idle', name: 'Idle Employee', salesCount: 0, grossUsd: 0 }] as any
      }
      return [] as any
    })

    const perf = useStaffPerformanceMetrics()
    await perf.load('2026-07-01', '2026-07-31')

    expect(perf.rows.value[0].avgTicketUsd).toBeNull()
    expect(perf.rows.value[0].marginUsd).toBe(0)
  })

  it('returns marginPct null when the shop-period margin total is zero', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM sales s\b/.test(sql) && /grossUsd/.test(sql)) {
        return [{ staffId: 'a', name: 'A', salesCount: 1, grossUsd: 100 }] as any
      }
      if (/FROM sale_line_items sli\b/.test(sql)) {
        return [{ staffId: 'a', cogs: 100 }] as any
      }
      return [] as any
    })

    const perf = useStaffPerformanceMetrics()
    await perf.load('2026-07-01', '2026-07-31')

    expect(perf.rows.value[0].marginUsd).toBe(0)
    expect(perf.rows.value[0].marginPct).toBeNull()
  })
})
