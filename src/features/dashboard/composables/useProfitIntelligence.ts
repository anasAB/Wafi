import { ref } from 'vue'
import { useProfitCache } from './useProfitCache'
import { getInsightRanges, type InsightPeriod } from './insightRanges'
import type { ComparisonMetric, ComparisonDriver } from './useRevenueIntelligence'

export interface ProfitIntelligenceData {
  metric: ComparisonMetric
  marginCurrentPct: number | null
  marginPreviousPct: number | null
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

export function useProfitIntelligence() {
  const data = ref<ProfitIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(period: InsightPeriod) {
    state.value = 'loading'
    try {
      const { current, comparison, isCurrentDayComplete } = getInsightRanges(period)

      // Same two-instance pattern as useRevenueIntelligence — cogsUsd and
      // discountUsd are read directly off these, never a second/independent
      // COGS or discount query (per design spec Task-3 note).
      const currentMetrics = useProfitCache()
      const previousMetrics = useProfitCache()
      await Promise.all([
        currentMetrics.loadRange(current.start, current.end),
        previousMetrics.loadRange(comparison.start, comparison.end),
      ])

      const metric: ComparisonMetric = {
        currentUsd: currentMetrics.metrics.value.profitUsd,
        previousUsd: previousMetrics.metrics.value.profitUsd,
        changePct: pctChange(currentMetrics.metrics.value.profitUsd, previousMetrics.metrics.value.profitUsd),
        direction: direction(currentMetrics.metrics.value.profitUsd, previousMetrics.metrics.value.profitUsd),
      }

      // Net-of-refunds/net-of-reversal intent (matches the old useDashboardMetrics
      // revenueUsd/cogsUsd) -> netRevenueUsd/netCogsUsd, not PeriodProfitMetrics'
      // gross revenueUsd/cogsUsd fields.
      const marginCurrentPct = currentMetrics.metrics.value.netRevenueUsd > 0
        ? (currentMetrics.metrics.value.profitUsd / currentMetrics.metrics.value.netRevenueUsd) * 100
        : null
      const marginPreviousPct = previousMetrics.metrics.value.netRevenueUsd > 0
        ? (previousMetrics.metrics.value.profitUsd / previousMetrics.metrics.value.netRevenueUsd) * 100
        : null

      const showDrivers = period !== 'day' || isCurrentDayComplete
      const drivers = showDrivers
        ? [
            buildDriver('revenue', currentMetrics.metrics.value.netRevenueUsd, previousMetrics.metrics.value.netRevenueUsd),
            buildDriver('cogs', currentMetrics.metrics.value.netCogsUsd, previousMetrics.metrics.value.netCogsUsd),
            buildDriver('discounts', currentMetrics.metrics.value.discountUsd, previousMetrics.metrics.value.discountUsd),
          ]
        : null

      data.value = { metric, marginCurrentPct, marginPreviousPct, drivers }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
