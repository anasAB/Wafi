import { ref } from 'vue'
import { useDashboardMetrics } from './useDashboardMetrics'
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
      const currentMetrics = useDashboardMetrics()
      const previousMetrics = useDashboardMetrics()
      await Promise.all([
        currentMetrics.loadRange(current.start, current.end),
        previousMetrics.loadRange(comparison.start, comparison.end),
      ])

      const metric: ComparisonMetric = {
        currentUsd: currentMetrics.profitUsd.value,
        previousUsd: previousMetrics.profitUsd.value,
        changePct: pctChange(currentMetrics.profitUsd.value, previousMetrics.profitUsd.value),
        direction: direction(currentMetrics.profitUsd.value, previousMetrics.profitUsd.value),
      }

      const marginCurrentPct = currentMetrics.revenueUsd.value > 0
        ? (currentMetrics.profitUsd.value / currentMetrics.revenueUsd.value) * 100
        : null
      const marginPreviousPct = previousMetrics.revenueUsd.value > 0
        ? (previousMetrics.profitUsd.value / previousMetrics.revenueUsd.value) * 100
        : null

      const showDrivers = period !== 'day' || isCurrentDayComplete
      const drivers = showDrivers
        ? [
            buildDriver('revenue', currentMetrics.revenueUsd.value, previousMetrics.revenueUsd.value),
            buildDriver('cogs', currentMetrics.cogsUsd.value, previousMetrics.cogsUsd.value),
            buildDriver('discounts', currentMetrics.discountUsd.value, previousMetrics.discountUsd.value),
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
