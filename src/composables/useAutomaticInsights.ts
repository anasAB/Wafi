import { ref } from 'vue'
import {
  getInsightRanges,
  getComparisonCutoffIso,
  type InsightPeriod,
} from '@/features/dashboard/composables/insightRanges'
import { getShopCreatedAt } from './insights/shopCreatedAt'
import { getRevenueUsdUpToTimestamp } from './insights/revenueUpToTimestamp'
import { evaluateRevenue, evaluateProfit, type Insight } from './insights/evaluateInsight'
import { useProfitCache } from '@/features/dashboard/composables/useProfitCache'

export function useAutomaticInsights() {
  const insights = ref<Insight[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(period: InsightPeriod, now: Date = new Date()) {
    loading.value = true
    error.value = null
    try {
      const { current, comparison, isCurrentDayComplete } = getInsightRanges(period, now)
      const shopCreatedAt = await getShopCreatedAt()
      const isMissing = shopCreatedAt !== null && new Date(comparison.start) < new Date(shopCreatedAt)

      const currentMetrics = useProfitCache()
      await currentMetrics.loadRange(current.start, current.end)

      const skipProfitIntraday = period === 'day' && !isCurrentDayComplete

      let comparisonRevenueUsd: number
      let comparisonProfitUsd: number | null

      if (skipProfitIntraday) {
        const cutoffIso = getComparisonCutoffIso(comparison.start, now)
        comparisonRevenueUsd = await getRevenueUsdUpToTimestamp(comparison.start, cutoffIso)
        comparisonProfitUsd = null
      } else {
        const comparisonMetrics = useProfitCache()
        await comparisonMetrics.loadRange(comparison.start, comparison.end)
        comparisonRevenueUsd = comparisonMetrics.metrics.value.netRevenueUsd
        comparisonProfitUsd = comparisonMetrics.metrics.value.profitUsd
      }

      const results: Insight[] = []

      const revenueInsight = evaluateRevenue(currentMetrics.metrics.value.netRevenueUsd, comparisonRevenueUsd, isMissing)
      if (revenueInsight) results.push(revenueInsight)

      if (comparisonProfitUsd !== null) {
        const profitInsight = evaluateProfit(
          currentMetrics.metrics.value.profitUsd,
          comparisonProfitUsd,
          isMissing,
          skipProfitIntraday,
        )
        if (profitInsight) results.push(profitInsight)
      }

      insights.value = results
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      insights.value = []
    } finally {
      loading.value = false
    }
  }

  return { insights, loading, error, load }
}
