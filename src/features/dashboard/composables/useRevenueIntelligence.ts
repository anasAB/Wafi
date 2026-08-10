import { ref } from 'vue'
import { useDashboardMetrics } from './useDashboardMetrics'
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

      const currentMetrics = useDashboardMetrics()
      const previousMetrics = useDashboardMetrics()
      await Promise.all([
        currentMetrics.loadRange(current.start, current.end),
        previousMetrics.loadRange(comparison.start, comparison.end),
      ])

      const metric: ComparisonMetric = {
        currentUsd: currentMetrics.revenueUsd.value,
        previousUsd: previousMetrics.revenueUsd.value,
        changePct: pctChange(currentMetrics.revenueUsd.value, previousMetrics.revenueUsd.value),
        direction: direction(currentMetrics.revenueUsd.value, previousMetrics.revenueUsd.value),
      }

      // Drivers are gated on isCurrentDayComplete for 'day' — week/month are
      // always "complete" per insightRanges.ts, so this only ever hides
      // drivers during an in-progress today. See design spec's "Day-period
      // truncation" section.
      const showDrivers = period !== 'day' || isCurrentDayComplete
      const drivers = showDrivers
        ? [
            buildDriver('transactionCount', currentMetrics.invoiceCount.value, previousMetrics.invoiceCount.value),
            buildDriver('returnCount', currentMetrics.returnCount.value, previousMetrics.returnCount.value),
            buildDriver(
              'avgBasket',
              currentMetrics.invoiceCount.value > 0 ? currentMetrics.revenueUsd.value / currentMetrics.invoiceCount.value : 0,
              previousMetrics.invoiceCount.value > 0 ? previousMetrics.revenueUsd.value / previousMetrics.invoiceCount.value : 0,
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
