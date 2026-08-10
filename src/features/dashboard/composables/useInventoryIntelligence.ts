import { ref } from 'vue'
import { useDeadStockReport } from './useDeadStockReport'

export interface InventoryIntelligenceData {
  totalFrozenCapitalUsd: number
  productCount: number
  topOffenders: ReturnType<typeof useDeadStockReport>['rows']['value']
}

export function useInventoryIntelligence() {
  const data = ref<InventoryIntelligenceData | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')

  async function load() {
    state.value = 'loading'
    try {
      const deadStock = useDeadStockReport()
      deadStock.thresholdDays.value = 60
      deadStock.sort.value = 'value'
      await deadStock.load()

      data.value = {
        totalFrozenCapitalUsd: deadStock.totalFrozenCapitalUsd.value,
        productCount: deadStock.costedRows.value.length,
        topOffenders: deadStock.rows.value.slice(0, 5),
      }
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  }

  return { data, state, load }
}
