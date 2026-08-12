import { ref } from 'vue'
import { useProfitCache } from './useProfitCache'
import { getInsightRanges, type InsightPeriod } from './insightRanges'

export interface ComparisonMetric {
  currentUsd: number
  previousUsd: number
  changePct: number | null
  direction: 'up' | 'down' | 'flat'
}

export interface ComparisonDriver {
  key: 'transactionCount' | 'returnCount' | 'avgBasket' | 'revenue' | 'cogs' | 'discounts'
  current: number
  previous: number
  changePct: number | null
}

export interface RevenueIntelligenceData {
  metric: ComparisonMetric
  drivers: ComparisonDriver[] | null
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

function direction(current: number, previous: number): 'up' | 'down' | 'flat' {
  if (current === previous) return 'flat'
  return current > previous ? 'up' : 'down'
}

function buildDriver(key: ComparisonDriver['key'], current: number, previous: number): ComparisonDriver {
  return { key, current, previous, changePct: pctChange(current, previous) }
}

export function useRevenueIntelligence() {
  const data = ref<RevenueIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(period: InsightPeriod) {
    state.value = 'loading'
    try {
      const { current, comparison, isCurrentDayComplete } = getInsightRanges(period)

      const currentMetrics = useProfitCache()
      const previousMetrics = useProfitCache()
      await Promise.all([
        currentMetrics.loadRange(current.start, current.end),
        previousMetrics.loadRange(comparison.start, comparison.end),
      ])

      // Net-of-refunds intent (matches the old useDashboardMetrics.revenueUsd) ->
      // netRevenueUsd, not PeriodProfitMetrics.revenueUsd (which is gross).
      const currentRevenueUsd = currentMetrics.metrics.value.netRevenueUsd
      const previousRevenueUsd = previousMetrics.metrics.value.netRevenueUsd

      const metric: ComparisonMetric = {
        currentUsd: currentRevenueUsd,
        previousUsd: previousRevenueUsd,
        changePct: pctChange(currentRevenueUsd, previousRevenueUsd),
        direction: direction(currentRevenueUsd, previousRevenueUsd),
      }

      // Drivers are gated on isCurrentDayComplete for 'day' — week/month are
      // always "complete" per insightRanges.ts, so this only ever hides
      // drivers during an in-progress today. See design spec's "Day-period
      // truncation" section.
      const showDrivers = period !== 'day' || isCurrentDayComplete
      const drivers = showDrivers
        ? [
            buildDriver('transactionCount', currentMetrics.metrics.value.invoiceCount, previousMetrics.metrics.value.invoiceCount),
            buildDriver('returnCount', currentMetrics.metrics.value.returnCount, previousMetrics.metrics.value.returnCount),
            buildDriver(
              'avgBasket',
              currentMetrics.metrics.value.invoiceCount > 0 ? currentRevenueUsd / currentMetrics.metrics.value.invoiceCount : 0,
              previousMetrics.metrics.value.invoiceCount > 0 ? previousRevenueUsd / previousMetrics.metrics.value.invoiceCount : 0,
            ),
          ]
        : null

      data.value = { metric, drivers }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
