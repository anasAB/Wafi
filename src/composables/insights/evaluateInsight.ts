// Named per the WAFI-144 design spec's "Threshold and skip rules" — tunable
// later without redesigning the engine.
export const INSIGHT_PERCENT_THRESHOLD = 10
export const INSIGHT_MIN_ABSOLUTE_CHANGE_USD = 5

export type InsightDirection =
  | 'up' | 'down'
  | 'loss_to_profit' | 'profit_to_loss'
  | 'loss_widened' | 'loss_narrowed'

export interface Insight {
  metric: 'revenue' | 'profit'
  direction: InsightDirection
  currentUsd: number
  previousUsd: number
  percentChange: number | null
}

export function evaluateRevenue(
  currentUsd: number,
  previousUsd: number,
  isMissing: boolean,
): Insight | null {
  if (isMissing || previousUsd <= 0) return null
  const absDelta = Math.abs(currentUsd - previousUsd)
  const percent = (absDelta / previousUsd) * 100
  if (percent < INSIGHT_PERCENT_THRESHOLD || absDelta < INSIGHT_MIN_ABSOLUTE_CHANGE_USD) return null
  const direction: InsightDirection = currentUsd > previousUsd ? 'up' : 'down'
  return {
    metric: 'revenue',
    direction,
    currentUsd,
    previousUsd,
    percentChange: direction === 'up' ? percent : -percent,
  }
}

// $0 is treated as the profit/loss boundary, not as "a loss" or "a profit" —
// moving up from $0 reads as loss_to_profit, moving down from $0 reads as
// profit_to_loss, per the WAFI-144 design spec's worked-example table.
function classifyProfitDirection(previousUsd: number, currentUsd: number): InsightDirection {
  if (previousUsd >= 0) {
    // previousUsd === 0 or previousUsd > 0 (caller guarantees currentUsd <= 0
    // here whenever previousUsd > 0, since the both-profitable case is
    // handled by the percent path before this function is ever called).
    return currentUsd > 0 ? 'loss_to_profit' : 'profit_to_loss'
  }
  // previousUsd < 0 (a real loss)
  if (currentUsd > 0) return 'loss_to_profit'
  return currentUsd < previousUsd ? 'loss_widened' : 'loss_narrowed'
}

export function evaluateProfit(
  currentUsd: number,
  previousUsd: number,
  isMissing: boolean,
  skipIntraday: boolean,
): Insight | null {
  if (skipIntraday || isMissing) return null
  const absDelta = Math.abs(currentUsd - previousUsd)
  if (absDelta < INSIGHT_MIN_ABSOLUTE_CHANGE_USD) return null

  if (previousUsd > 0 && currentUsd > 0) {
    const percent = (absDelta / previousUsd) * 100
    if (percent < INSIGHT_PERCENT_THRESHOLD) return null
    const direction: InsightDirection = currentUsd > previousUsd ? 'up' : 'down'
    return {
      metric: 'profit',
      direction,
      currentUsd,
      previousUsd,
      percentChange: direction === 'up' ? percent : -percent,
    }
  }

  return {
    metric: 'profit',
    direction: classifyProfitDirection(previousUsd, currentUsd),
    currentUsd,
    previousUsd,
    percentChange: null,
  }
}
