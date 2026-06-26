export const ANOMALY_MIN_REVENUE_USD = 50

export interface ReportAnomalies {
  highExpenses: boolean
  highReturns: boolean
}

export function evaluateReportAnomalies(
  grossIncomeUsd: number,
  expensesUsd: number,
  refundsUsd: number,
  minRevenueUsd = ANOMALY_MIN_REVENUE_USD,
): ReportAnomalies {
  if (grossIncomeUsd < minRevenueUsd || grossIncomeUsd <= 0) {
    return { highExpenses: false, highReturns: false }
  }

  return {
    highExpenses: expensesUsd / grossIncomeUsd > 0.3,
    highReturns: refundsUsd / grossIncomeUsd > 0.1,
  }
}
