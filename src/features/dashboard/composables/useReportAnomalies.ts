export const REPORT_RULES = {
  expenseRatioWarning: 0.3,
  refundRatioWarning: 0.1,
  minRevenueUsd: 50,
} as const

export interface ReportAnomalies {
  highExpenses: boolean
  highReturns: boolean
}

export function evaluateReportAnomalies(
  grossIncomeUsd: number,
  expensesUsd: number,
  refundsUsd: number,
  minRevenueUsd = REPORT_RULES.minRevenueUsd,
): ReportAnomalies {
  if (grossIncomeUsd < minRevenueUsd || grossIncomeUsd <= 0) {
    return { highExpenses: false, highReturns: false }
  }

  return {
    highExpenses: expensesUsd / grossIncomeUsd > REPORT_RULES.expenseRatioWarning,
    highReturns: refundsUsd / grossIncomeUsd > REPORT_RULES.refundRatioWarning,
  }
}
