export interface PeriodProfitMetrics {
  revenueUsd: number
  refundsUsd: number
  cogsUsd: number
  cogsReversalUsd: number
  expensesUsd: number
  discountUsd: number
  invoiceCount: number
  returnCount: number
  costlessSaleCount: number
  netRevenueUsd: number
  netCogsUsd: number
  profitUsd: number
  profitIsEstimated: boolean
}

export const EMPTY_PROFIT_METRICS: PeriodProfitMetrics = {
  revenueUsd: 0, refundsUsd: 0, cogsUsd: 0, cogsReversalUsd: 0, expensesUsd: 0,
  discountUsd: 0, invoiceCount: 0, returnCount: 0, costlessSaleCount: 0,
  netRevenueUsd: 0, netCogsUsd: 0, profitUsd: 0, profitIsEstimated: false,
}
