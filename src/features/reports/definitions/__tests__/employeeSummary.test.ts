import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
const mockGetOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: (...a: unknown[]) => mockGetAll(...a), getOptional: (...a: unknown[]) => mockGetOptional(...a) },
}))
vi.mock('../../primitives/getStaffMetrics', () => ({
  getStaffMetrics: vi.fn().mockResolvedValue([
    { staffId: 's1', name: 'Ali', revenueUsd: 500, cogsUsd: 200, marginUsd: 300, marginPct: 100, salesCount: 8, avgTicketUsd: 62.5, discountUsd: 10, discountRate: 2, returnRevenueUsd: 0, returnCount: 0 },
  ]),
}))

import { REPORT_DEFINITIONS } from '../../reportRegistry'
import '../employeeSummary' // side-effect: registers REPORT_DEFINITIONS['employee-summary']

describe('employee-summary report definition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a real report when context.staffId is provided, through the uniform compute() signature', async () => {
    mockGetAll.mockResolvedValue([{ variance_usd: -2 }])
    mockGetOptional.mockResolvedValue({ hours: 8 })

    const report = await REPORT_DEFINITIONS['employee-summary'].compute('shop1', { from: '2026-08-18', to: '2026-08-18' }, { staffId: 's1' })

    expect(report.sections[0].type).toBe('summary')
    if (report.sections[0].type === 'summary') {
      expect(report.sections[0].title).toBe('Ali')
      expect(report.sections[0].metrics.find((m) => m.label === 'Revenue')?.value).toBe(500)
    }
  })

  it('returns an explicit not-selected state, never a thrown exception, when staffId is missing', async () => {
    const report = await REPORT_DEFINITIONS['employee-summary'].compute('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(report.sections[0].type).toBe('summary')
    if (report.sections[0].type === 'summary') {
      expect(report.sections[0].title).toBe('لم يتم اختيار موظف')
    }
  })
})
