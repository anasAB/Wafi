<!-- Profit report (Reporting Pack). Reuses the verified profit engine
     (useDashboardMetrics.loadRange) for the headline + breakdown and useProfitTrend
     for the chart, so the bars sum to the headline. Owns its own period state (does
     NOT touch the shared usePeriodToggle singleton). Offline: all-local queries. -->
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getReportRange, bucketForRange } from '../composables/periodUtils'
import type { ReportPeriod } from '../composables/periodUtils'
import { useDashboardMetrics } from '../composables/useDashboardMetrics'
import { useProfitTrend } from '../composables/useProfitTrend'
import ProfitTrendChart from './ProfitTrendChart.vue'

const { t } = useI18n()
const metrics = useDashboardMetrics()
const trend   = useProfitTrend()

const period      = ref<ReportPeriod>('month')
const customStart = ref('')
const customEnd   = ref('')

const rangeError = computed(() =>
  period.value === 'custom'
  && !!customStart.value && !!customEnd.value
  && customStart.value > customEnd.value)

const isCustomIncomplete = computed(() =>
  period.value === 'custom' && (!customStart.value || !customEnd.value))

const hasSales = computed(() => metrics.invoiceCount.value > 0)
const isProfit = computed(() => metrics.profitUsd.value >= 0)

async function reload() {
  if (rangeError.value || isCustomIncomplete.value) return
  const { start, end } = getReportRange(period.value, customStart.value, customEnd.value)
  if (!start || !end) return
  await Promise.all([
    metrics.loadRange(start, end),
    trend.load(start, end, bucketForRange(start, end)),
  ])
}

function selectPeriod(p: ReportPeriod) { period.value = p }

watch([period, customStart, customEnd], reload)
onMounted(reload)
</script>

<template>
  <section class="reports-page" dir="rtl">
    <h1 class="page-title">{{ t('reports.title') }}</h1>

    <div class="period-toggle">
      <button data-test="period-week"    :class="{ active: period === 'week' }"    @click="selectPeriod('week')">{{ t('reports.week') }}</button>
      <button data-test="period-month"   :class="{ active: period === 'month' }"   @click="selectPeriod('month')">{{ t('reports.month') }}</button>
      <button data-test="period-quarter" :class="{ active: period === 'quarter' }" @click="selectPeriod('quarter')">{{ t('reports.quarter') }}</button>
      <button data-test="period-custom"  :class="{ active: period === 'custom' }"  @click="selectPeriod('custom')">{{ t('reports.custom') }}</button>
    </div>

    <div v-if="period === 'custom'" class="custom-range">
      <label>{{ t('reports.from') }} <input data-test="custom-start" type="date" v-model="customStart" /></label>
      <label>{{ t('reports.to') }} <input data-test="custom-end" type="date" v-model="customEnd" /></label>
      <p v-if="rangeError" data-test="range-error" class="warn">{{ t('reports.invalidRange') }}</p>
    </div>

    <template v-if="!rangeError && !isCustomIncomplete">
      <div v-if="hasSales" class="report-body">
        <div class="headline card" :class="isProfit ? 'pos' : 'neg'">
          <span class="verb">{{ isProfit ? t('reports.profitVerb') : t('reports.lossVerb') }}</span>
          <span class="amount" data-test="profit-headline" dir="ltr">${{ Math.abs(metrics.profitUsd.value).toFixed(2) }}</span>
        </div>

        <p v-if="metrics.profitIsEstimated.value" class="caveat">{{ t('reports.estimated') }}</p>

        <div class="card chart-card">
          <ProfitTrendChart :points="trend.points.value" />
        </div>

        <ul class="breakdown card">
          <li><span>{{ t('reports.moneyIn') }}</span><span dir="ltr">${{ metrics.revenueUsd.value.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.cogs') }}</span><span dir="ltr">${{ metrics.cogsUsd.value.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.expenses') }}</span><span dir="ltr">${{ metrics.expensesUsd.value.toFixed(2) }}</span></li>
          <li class="total"><span>= {{ t('reports.profit') }}</span><span dir="ltr">${{ metrics.profitUsd.value.toFixed(2) }}</span></li>
        </ul>
      </div>

      <p v-else data-test="empty" class="empty">{{ t('reports.empty') }}</p>
    </template>
  </section>
</template>

<style scoped>
.reports-page {
  min-height: 100%;
  padding: 16px;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
}
.page-title { font-size: 1.15rem; font-weight: 800; margin: 0; }

.period-toggle { display: flex; gap: 8px; flex-wrap: wrap; }
.period-toggle button {
  flex: 1; min-width: 64px; padding: 9px 10px; border-radius: 10px; cursor: pointer;
  font-family: inherit; font-size: 0.8125rem; font-weight: 700; color: #C8D5E8;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(26, 86, 219, 0.28);
  transition: background 0.15s, border-color 0.15s;
}
.period-toggle button.active { background: #1A56DB; border-color: #1A56DB; color: #fff; }

.custom-range { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.custom-range label { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: #93A3B8; }
.custom-range input {
  padding: 8px; border-radius: 8px; color: inherit; font-family: inherit;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(26, 86, 219, 0.28);
}
.warn { color: #FBBF24; font-size: 0.85rem; margin: 0; width: 100%; }

.card {
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}
.report-body { display: flex; flex-direction: column; gap: 14px; }

.headline {
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 22px 16px;
}
.headline .verb { font-size: 0.9rem; color: #93A3B8; }
.headline .amount { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.headline.pos .amount { color: #22C55E; }
.headline.neg .amount { color: #EF4444; }

.caveat {
  margin: 0; padding: 10px 12px; border-radius: 10px; font-size: 0.85rem; color: #FCD34D;
  background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25);
}

.chart-card { padding: 8px 8px 0; }

.breakdown { list-style: none; margin: 0; padding: 8px 16px; }
.breakdown li {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.9rem; color: #C8D5E8; font-variant-numeric: tabular-nums;
}
.breakdown li:last-child { border-bottom: none; }
.breakdown .total { font-weight: 800; color: #E8EDF5; padding-top: 12px; }

.empty { text-align: center; padding: 40px 0; color: #637285; }
</style>
