import { ref } from 'vue'
import { useStaffPerformanceMetrics } from './useStaffPerformanceMetrics'
import { getInsightRanges, type InsightPeriod } from './insightRanges'

export interface StaffIntelligenceData {
  topPerformer: { staffId: string; name: string; revenueUsd: number } | null
  highestDiscountRate: { staffId: string; name: string; discountRatePct: number } | null
  shopAverageDiscountRatePct: number | null
}

export function useStaffIntelligence() {
  const data = ref<StaffIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load(period: InsightPeriod) {
    state.value = 'loading'
    try {
      const { current } = getInsightRanges(period)
      const perf = useStaffPerformanceMetrics()
      await perf.load(current.start, current.end)
      const rows = perf.rows.value

      if (rows.length === 0) {
        data.value = { topPerformer: null, highestDiscountRate: null, shopAverageDiscountRatePct: null }
        state.value = 'ready'
        return
      }

      const topPerformer = rows.reduce((best, r) => (r.revenueUsd > best.revenueUsd ? r : best))
      const withRate = rows.filter(r => r.discountRate !== null)
      const highestDiscountRow = withRate.length
        ? withRate.reduce((best, r) => (r.discountRate! > best.discountRate! ? r : best))
        : null

      // Dollar-weighted shop average: total discount / total revenue across
      // ALL staff, not average(perStaffRate) — those disagree, see design
      // spec's Staff card section and this test's worked example.
      const totalRevenue = rows.reduce((sum, r) => sum + r.revenueUsd, 0)
      const totalDiscount = rows.reduce((sum, r) => sum + r.discountUsd, 0)
      const shopAverageDiscountRatePct = totalRevenue > 0 ? (totalDiscount / totalRevenue) * 100 : null

      data.value = {
        topPerformer: { staffId: topPerformer.staffId, name: topPerformer.name, revenueUsd: topPerformer.revenueUsd },
        highestDiscountRate: highestDiscountRow
          ? { staffId: highestDiscountRow.staffId, name: highestDiscountRow.name, discountRatePct: highestDiscountRow.discountRate! }
          : null,
        shopAverageDiscountRatePct,
      }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
