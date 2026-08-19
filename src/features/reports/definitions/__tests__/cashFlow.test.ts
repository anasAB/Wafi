import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../primitives/readShiftCashReconciliation', () => ({
  readShiftCashReconciliation: vi.fn().mockResolvedValue({
    expectedUsd: 145, actualUsd: 148, varianceUsd: 3, cashSalesUsd: 400, cashExpensesUsd: 50,
    cashRefundsUsd: 10, cashCreditPaymentsUsd: 30, cashPayInsUsd: 5, cashPayOutsUsd: 15,
  }),
}))

import { computeCashFlowReport } from '../cashFlow'

describe('computeCashFlowReport', () => {
  beforeEach(() => vi.clearAllMocks())
  it('derives cash in/out entirely from readShiftCashReconciliation, matching the app\'s own Z-report equation', async () => {
    const report = await computeCashFlowReport('shop1', { from: '2026-08-18', to: '2026-08-18' })
    expect(report.sections).toHaveLength(1)
    const [section] = report.sections
    expect(section.type).toBe('summary')
    if (section.type === 'summary') {
      // cash in = sales + credit-payment collection + pay-ins; cash out = expenses + refunds + pay-outs
      expect(section.metrics.find((m) => m.label === 'Cash in')?.value).toBe(400 + 30 + 5)
      expect(section.metrics.find((m) => m.label === 'Cash out')?.value).toBe(50 + 10 + 15)
      expect(section.metrics.find((m) => m.label === 'Drawer variance')?.value).toBe(3)
    }
  })
})
