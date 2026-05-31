import { ref } from 'vue'
import type { Period } from './periodUtils'

// Module-level singleton — all consumers share the same ref instance
const period = ref<Period>('today')

export function usePeriodToggle() {
  function setPeriod(p: Period) {
    period.value = p
  }
  return { period, setPeriod }
}
