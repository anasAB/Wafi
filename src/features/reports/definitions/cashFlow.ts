// WAFI-147A: derives every figure from readShiftCashReconciliation (Task 4b) --
// the app's own verified Z-report cash equation -- never an independently
// constructed "cash in = sales + payments, cash out = expenses + movements"
// equation, which would omit refunds and pay-in/pay-out movements (Task 0
// finding 2).
import { readShiftCashReconciliation } from '../primitives/readShiftCashReconciliation'
import { summarySection } from '../report.types'
import type { Report, ReportDateRange } from '../report.types'
import { REPORT_DEFINITIONS } from '../reportRegistry'

export async function computeCashFlowReport(shopId: string, range: ReportDateRange): Promise<Report> {
  const cash = await readShiftCashReconciliation(shopId, range)
  const cashIn = cash.cashSalesUsd + cash.cashCreditPaymentsUsd + cash.cashPayInsUsd
  const cashOut = cash.cashExpensesUsd + cash.cashRefundsUsd + cash.cashPayOutsUsd

  return {
    id: 'cash-flow', name: 'Cash Flow Report', dateRange: range, generatedAt: new Date().toISOString(),
    sections: [summarySection({
      title: 'Cash Flow',
      metrics: [
        { label: 'Cash in', value: cashIn, unit: 'USD' },
        { label: 'Cash out', value: cashOut, unit: 'USD' },
        { label: 'Net cash flow', value: cashIn - cashOut, unit: 'USD' },
        { label: 'Drawer variance', value: cash.varianceUsd, unit: 'USD' },
      ],
    })],
  }
}

REPORT_DEFINITIONS['cash-flow'] = { id: 'cash-flow', name: 'Cash Flow Report', cadenceHint: 'daily', compute: computeCashFlowReport }
