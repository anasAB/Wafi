import { ref } from 'vue'
import type { Period } from './periodUtils'

// Cold-start default only: before noon "today" is the useful view (little has
// happened yet); after noon "today" alone looks thin, so default to "week".
// A manual toggle (setPeriod) always overrides this for the rest of the session.
function defaultPeriod(): Period {
  return new Date().getHours() < 12 ? 'today' : 'week'
}

// Module-level singleton — all consumers share the same ref instance
const period = ref<Period>(defaultPeriod())

export function usePeriodToggle() {
  function setPeriod(p: Period) {
    period.value = p
  }
  return { period, setPeriod }
}
