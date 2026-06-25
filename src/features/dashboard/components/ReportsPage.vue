<!-- Profit report (Reporting Pack). Reuses the verified profit engine
     (useDashboardMetrics.loadRange) for the headline + breakdown and useProfitTrend
     for the chart, so the bars sum to the headline. Owns its own period state (does
     NOT touch the shared usePeriodToggle singleton). Offline: all-local queries. -->
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDatePicker from '@/components/ui/AppDatePicker.vue'
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

function isoToDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(value + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

function dateToIso(value: Date | null): string {
  if (!value) return ''
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const customStartModel = computed<Date | null>({
  get: () => isoToDate(customStart.value),
  set: (v) => { customStart.value = dateToIso(v) },
})

const customEndModel = computed<Date | null>({
  get: () => isoToDate(customEnd.value),
  set: (v) => { customEnd.value = dateToIso(v) },
})

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
      <label class="date-label">
        <span>{{ t('reports.from') }}</span>
        <AppDatePicker
          v-model="customStartModel"
          input-id="reports-custom-start"
          data-test="custom-start"
          date-format="yy-mm-dd"
          placeholder="اختر التاريخ"
          show-icon
          icon-display="input"
          append-to="self"
          class="reports-date-picker"
          :input-class="'form-input date-input prime-date-input'"
        />
      </label>
      <label class="date-label">
        <span>{{ t('reports.to') }}</span>
        <AppDatePicker
          v-model="customEndModel"
          input-id="reports-custom-end"
          data-test="custom-end"
          date-format="yy-mm-dd"
          placeholder="اختر التاريخ"
          show-icon
          icon-display="input"
          append-to="self"
          class="reports-date-picker"
          :input-class="'form-input date-input prime-date-input'"
        />
      </label>
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
.date-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8125rem;
  color: #93A3B8;
  min-width: 180px;
  flex: 1;
}

.form-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.form-input::placeholder { color: #3D4F6B; }

.form-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

.date-input {
  height: 40px;
  min-height: 40px;
  padding-inline-end: 2.75rem;
  padding-inline-start: 0.875rem;
  color-scheme: dark;
  line-height: 1.2;
}

.prime-date-input {
  font-variant-numeric: tabular-nums;
}

.reports-date-picker {
  width: 100%;
}

.reports-date-picker :deep(.p-inputtext),
.reports-date-picker :deep(input.p-datepicker-input) {
  background: rgba(255, 255, 255, 0.07) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  color: #E8EDF5 !important;
}

.reports-date-picker :deep(.p-inputtext:enabled:hover),
.reports-date-picker :deep(input.p-datepicker-input:enabled:hover) {
  border-color: rgba(26, 86, 219, 0.45) !important;
}

.reports-date-picker :deep(.p-inputtext:enabled:focus),
.reports-date-picker :deep(input.p-datepicker-input:enabled:focus) {
  border-color: rgba(26, 86, 219, 0.8) !important;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15) !important;
}

.reports-date-picker :deep(.p-datepicker-input) {
  height: 40px !important;
  min-height: 40px !important;
  line-height: 1.2;
  box-sizing: border-box;
  padding-inline-start: 0.875rem !important;
  padding-inline-end: 2.75rem !important;
  padding-right: 0.875rem !important;
  padding-left: 2.75rem !important;
  text-align: right;
}

.reports-date-picker :deep(.p-inputtext::placeholder) {
  color: #3D4F6B;
  opacity: 1;
}

.reports-date-picker :deep(.p-datepicker-input-icon-container) {
  position: absolute;
  inset-inline-end: 0.75rem;
  inset-block: 0;
  margin: auto;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  padding: 0;
  background: transparent;
  border: none;
  pointer-events: none;
}

.reports-date-picker :deep(.p-datepicker-input-icon) {
  font-size: 0.95rem;
  line-height: 1;
}

.reports-date-picker :deep(.p-datepicker-dropdown) {
  display: none;
}

.reports-date-picker :deep(.p-datepicker-panel) {
  margin-top: 6px;
  border-radius: 12px;
  border: 1px solid rgba(26,86,219,0.30);
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  color: #E8EDF5;
}

.reports-date-picker :deep(.p-datepicker-calendar-container),
.reports-date-picker :deep(.p-datepicker-calendar),
.reports-date-picker :deep(.p-datepicker-month-view),
.reports-date-picker :deep(.p-datepicker-year-view) {
  background: transparent !important;
}

.reports-date-picker :deep(.p-datepicker-header) {
  background: transparent;
  border-bottom: 1px solid rgba(26,86,219,0.20);
  color: #E8EDF5;
}

.reports-date-picker :deep(.p-datepicker-title button),
.reports-date-picker :deep(.p-datepicker-prev),
.reports-date-picker :deep(.p-datepicker-next) {
  color: #C8D5E8;
}

.reports-date-picker :deep(.p-datepicker-title button:hover),
.reports-date-picker :deep(.p-datepicker-prev:hover),
.reports-date-picker :deep(.p-datepicker-next:hover) {
  background: rgba(26, 86, 219, 0.16) !important;
}

.reports-date-picker :deep(.p-datepicker-day),
.reports-date-picker :deep(.p-datepicker-month),
.reports-date-picker :deep(.p-datepicker-year) {
  color: #C8D5E8;
}

.reports-date-picker :deep(.p-datepicker-day:hover) {
  background: rgba(26,86,219,0.16);
}

.reports-date-picker :deep(.p-datepicker-day-selected) {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #FFFFFF;
}

.reports-date-picker :deep(.p-datepicker-select-month),
.reports-date-picker :deep(.p-datepicker-select-year),
.reports-date-picker :deep(.p-select),
.reports-date-picker :deep(.p-select-label),
.reports-date-picker :deep(.p-select-dropdown) {
  background: transparent !important;
  border-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  color: #E8EDF5 !important;
}

.reports-date-picker :deep(.p-datepicker-select-month:hover),
.reports-date-picker :deep(.p-datepicker-select-year:hover),
.reports-date-picker :deep(.p-datepicker-select-month:focus),
.reports-date-picker :deep(.p-datepicker-select-year:focus),
.reports-date-picker :deep(.p-datepicker-select-month:focus-visible),
.reports-date-picker :deep(.p-datepicker-select-year:focus-visible) {
  background: transparent !important;
  border-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
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
