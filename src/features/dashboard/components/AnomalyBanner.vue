<!-- src/features/dashboard/components/AnomalyBanner.vue -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnomalyDetection } from '@/composables/useAnomalyDetection'
import { isDismissed, dismiss } from '@/composables/useAnomalyDismissal'
import { useCan } from '@/composables/useCan'
import { useDeviceStore } from '@/store/device.store'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'

const { t } = useI18n()
const { can } = useCan()
const canViewReports = can('can_view_reports')
const device = useDeviceStore()

const { anomalies, error, load } = useAnomalyDetection()
// Re-wrap in genuine `computed()` refs so the template's auto-unwrap always
// reads `.value`. `can()` and `useAnomalyDetection().error` are real Vue refs
// in production, but this component must not depend on that — deriving these
// via `computed()` makes the template correct even against a plain
// `{ value }` object (as used by this component's own unit tests' mocks).
const canView = computed(() => canViewReports.value)
const hasError = computed(() => error.value)
// This component owns its own dashboard-metrics instance rather than
// receiving one via props — Home's own metrics instance is a separate,
// independently-loaded object. Loading here guarantees the anomaly engine
// reads the SAME revenue/COGS/expenses/refunds math as every other
// consumer of useDashboardMetrics (see plan §2a) — it does not reduce
// query count versus Home's own cards, but it eliminates the divergent-COGS
// bug the Task 2 review found.
const dashboardMetrics = useDashboardMetrics()
const expanded = ref(false)
const periodKey = 'today' // Home always evaluates anomalies against today's period.

onMounted(async () => {
  if (!canViewReports.value) return
  await dashboardMetrics.load('today')
  await load('today', {
    revenueUsd: dashboardMetrics.revenueUsd.value,
    cogsUsd: dashboardMetrics.cogsUsd.value,
    expensesUsd: dashboardMetrics.expensesUsd.value,
    refundsUsd: dashboardMetrics.refundsUsd.value,
  })
})

const visibleAnomalies = computed(() =>
  anomalies.value.filter(a => !isDismissed(device.shopId, periodKey, a.code)),
)

function dismissOne(code: string) {
  dismiss(device.shopId, periodKey, code)
  // Force reactivity: re-filter by touching anomalies.value (dismiss state
  // lives outside Vue's reactivity system in localStorage), so re-derive
  // visibleAnomalies by reassigning anomalies.value to itself.
  anomalies.value = [...anomalies.value]
}
</script>

<template>
  <div
    v-if="canView && (hasError || visibleAnomalies.length > 0)"
    data-test="anomaly-banner"
    class="anomaly-banner"
  >
    <div v-if="hasError" class="anomaly-banner__error">
      {{ t('home.anomalyBannerError') }}
    </div>
    <template v-else>
      <button type="button" class="anomaly-banner__summary" @click="expanded = !expanded">
        {{ t('home.anomalyBannerTitle', { count: visibleAnomalies.length }) }}
      </button>
      <ul v-if="expanded" class="anomaly-banner__list">
        <li
          v-for="a in visibleAnomalies"
          :key="a.code"
          class="anomaly-banner__item"
          :class="`anomaly-banner__item--${a.severity}`"
        >
          <div>
            <strong>{{ t(`anomalies.${a.code}.title`) }}</strong>
            <p>{{ t(`anomalies.${a.code}.message`) }}</p>
          </div>
          <button type="button" @click="dismissOne(a.code)">
            {{ t('home.anomalyBannerDismiss') }}
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.anomaly-banner {
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fff7e6;
}
.anomaly-banner__error {
  color: #6b7280;
  font-size: 0.875rem;
}
.anomaly-banner__summary {
  font-weight: 600;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.anomaly-banner__list {
  margin-top: 0.5rem;
  list-style: none;
  padding: 0;
}
.anomaly-banner__item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.5rem 0;
  border-top: 1px solid #eee;
}
.anomaly-banner__item--critical strong { color: #b91c1c; }
.anomaly-banner__item--warning strong { color: #92400e; }
</style>
