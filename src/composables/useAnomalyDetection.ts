export type AnomalySeverity = 'critical' | 'warning' | 'info'
export type AnomalyKind = 'instant' | 'aggregate'

export interface Anomaly {
  code: string
  severity: AnomalySeverity
  kind: AnomalyKind
  title: string
  message: string
  deepLink?: string
}

// Plain aggregates the caller must already have (or batch-fetch once) — no
// query happens inside computeAnomalies or any rule function. See
// docs/superpowers/specs/2026-07-30-wafi-015-anomaly-detection-design.md §5.
export interface AnomalyInput {
  revenueUsd: number
  cogsUsd: number
  expensesUsd: number
  refundsUsd: number
  saleDiscountsUsd: number
  belowCostSaleCount: number
  cashShiftVarianceCount: number
  inventoryShrinkageCount: number
}

export const ANOMALY_RULES = {
  minRevenueUsd: 50,
  expenseRatioWarning: 0.3,
  refundRatioWarning: 0.1,
  lowMarginWarning: 0.1,
  discountRatioWarning: 0.15,
  severities: {
    HIGH_EXPENSES_RATIO: 'warning',
    HIGH_RETURNS_RATIO: 'warning',
    LOW_MARGIN: 'warning',
    SALE_BELOW_COST: 'critical',
    HIGH_DISCOUNT_RATIO: 'warning',
    CASH_SHIFT_VARIANCE: 'critical',
    INVENTORY_SHRINKAGE: 'critical',
  } as const,
} as const

const SEVERITY_ORDER: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 }

function grossIncome(input: AnomalyInput): number {
  return input.revenueUsd + input.refundsUsd
}

function meetsRevenueFloor(input: AnomalyInput): boolean {
  const gross = grossIncome(input)
  return gross > 0 && gross >= ANOMALY_RULES.minRevenueUsd
}

function evaluateHighExpensesRatio(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const ratio = input.expensesUsd / grossIncome(input)
  if (ratio <= ANOMALY_RULES.expenseRatioWarning) return null
  return {
    code: 'HIGH_EXPENSES_RATIO',
    severity: ANOMALY_RULES.severities.HIGH_EXPENSES_RATIO,
    kind: 'aggregate',
    title: 'High expenses',
    message: 'Your expenses are unusually high this period.',
  }
}

function evaluateHighReturnsRatio(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const ratio = input.refundsUsd / grossIncome(input)
  if (ratio <= ANOMALY_RULES.refundRatioWarning) return null
  return {
    code: 'HIGH_RETURNS_RATIO',
    severity: ANOMALY_RULES.severities.HIGH_RETURNS_RATIO,
    kind: 'aggregate',
    title: 'High returns',
    message: 'Returns are higher than usual this period.',
  }
}

function evaluateLowMargin(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const profitUsd = input.revenueUsd - input.cogsUsd - input.expensesUsd
  const margin = profitUsd / grossIncome(input)
  if (margin >= ANOMALY_RULES.lowMarginWarning) return null
  return {
    code: 'LOW_MARGIN',
    severity: ANOMALY_RULES.severities.LOW_MARGIN,
    kind: 'aggregate',
    title: 'Low profit margin',
    message: 'Your overall profit margin is lower than usual this period.',
    deepLink: '/reports',
  }
}

// Independent of overall margin health by design — see spec §2: a healthy
// shop can still have one accidental below-cost sale, and that must still
// surface. Not gated by meetsRevenueFloor: a single below-cost sale matters
// even in a low-revenue period.
function evaluateSaleBelowCost(input: AnomalyInput): Anomaly | null {
  if (input.belowCostSaleCount <= 0) return null
  return {
    code: 'SALE_BELOW_COST',
    severity: ANOMALY_RULES.severities.SALE_BELOW_COST,
    kind: 'instant',
    title: 'Sale below cost',
    message: `${input.belowCostSaleCount} sale${input.belowCostSaleCount === 1 ? '' : 's'} sold below cost this period.`,
  }
}

function evaluateHighDiscountRatio(input: AnomalyInput): Anomaly | null {
  if (!meetsRevenueFloor(input)) return null
  const ratio = input.saleDiscountsUsd / grossIncome(input)
  if (ratio <= ANOMALY_RULES.discountRatioWarning) return null
  return {
    code: 'HIGH_DISCOUNT_RATIO',
    severity: ANOMALY_RULES.severities.HIGH_DISCOUNT_RATIO,
    kind: 'aggregate',
    title: 'High discount activity',
    message: 'Discounts given this period are higher than usual.',
  }
}

function evaluateCashShiftVariance(input: AnomalyInput): Anomaly | null {
  if (input.cashShiftVarianceCount <= 0) return null
  return {
    code: 'CASH_SHIFT_VARIANCE',
    severity: ANOMALY_RULES.severities.CASH_SHIFT_VARIANCE,
    kind: 'instant',
    title: 'Cash shift variance',
    message: `${input.cashShiftVarianceCount} shift${input.cashShiftVarianceCount === 1 ? '' : 's'} closed with an unusual cash variance this period.`,
    deepLink: '/shifts/history',
  }
}

function evaluateInventoryShrinkage(input: AnomalyInput): Anomaly | null {
  if (input.inventoryShrinkageCount <= 0) return null
  return {
    code: 'INVENTORY_SHRINKAGE',
    severity: ANOMALY_RULES.severities.INVENTORY_SHRINKAGE,
    kind: 'instant',
    title: 'Inventory shrinkage',
    message: `${input.inventoryShrinkageCount} product${input.inventoryShrinkageCount === 1 ? '' : 's'} had an unusual stock-take variance this period.`,
  }
}

// Pure — no I/O. Each rule emits at most one Anomaly regardless of how many
// underlying rows triggered it (spec §6).
export function computeAnomalies(input: AnomalyInput): Anomaly[] {
  const anomalies = [
    evaluateHighExpensesRatio(input),
    evaluateHighReturnsRatio(input),
    evaluateLowMargin(input),
    evaluateSaleBelowCost(input),
    evaluateHighDiscountRatio(input),
    evaluateCashShiftVariance(input),
    evaluateInventoryShrinkage(input),
  ].filter((a): a is Anomaly => a !== null)

  return anomalies.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
