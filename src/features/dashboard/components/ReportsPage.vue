<!-- Profit report (Reporting Pack). Reuses the verified profit engine
     (useDashboardMetrics.loadRange) for the headline + breakdown and useProfitTrend
     for the chart, so the bars sum to the headline. Owns its own period state (does
     NOT touch the shared usePeriodToggle singleton). Offline: all-local queries. -->
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCan } from '@/composables/useCan'
import AppDatePicker from '@/components/ui/AppDatePicker.vue'
import { getReportRange, bucketForRange, getPreviousReportRange } from '../composables/periodUtils'
import type { ReportPeriod } from '../composables/periodUtils'
import { useDashboardMetrics } from '../composables/useDashboardMetrics'
import { useProfitTrend } from '../composables/useProfitTrend'
import { useBucketBreakdown } from '../composables/useBucketBreakdown'
import { useExpenseBreakdown } from '../composables/useExpenseBreakdown'
import { useCategoryBreakdown, type CategoryBreakdownRow } from '../composables/useCategoryBreakdown'
import { useAnomalyDetection } from '@/composables/useAnomalyDetection'
import { useDeadStockReport } from '../composables/useDeadStockReport'
import type { DeadStockThresholdDays } from '../composables/useDeadStockReport'
import { useUncostedSalesNotice } from '../composables/useUncostedSalesNotice'
import ProfitCumulativeChart from './ProfitCumulativeChart.vue'
import ReportDrilldownSheet from './ReportDrilldownSheet.vue'
import ExpenseDonutChart from './ExpenseDonutChart.vue'
import TopExpensesList from './TopExpensesList.vue'

const { t } = useI18n()
const { can } = useCan()
// WAFI-018: structurally owner-only, never granted to a manager (permissionsForRole).
const canViewStaffPerformance = can('can_view_staff_performance')
const metrics = useDashboardMetrics()
const previousMetrics = useDashboardMetrics()
const trend   = useProfitTrend()
const drilldown = useBucketBreakdown()
const expenseBreakdown = useExpenseBreakdown()
const categoryBreakdown = useCategoryBreakdown()
const deadStock = useDeadStockReport()
const uncostedSales = useUncostedSalesNotice()
const { anomalies, load: loadAnomalies } = useAnomalyDetection()

const period      = ref<ReportPeriod>('month')
const customStart = ref('')
const customEnd   = ref('')
const showProfitInfo = ref(false)
const showCashMovementInfo = ref(false)
const previousProfitUsd = ref<number | null>(null)
const previousInvoiceCount = ref(0)
const chartBucket = ref<'day' | 'month'>('day')
const drilldownTitle = ref('')
const drilldownOpen = ref(false)
const drilldownLoading = ref(false)
const selectedTrendPointIndex = ref<number | null>(null)
const activeTab = ref<'profitability' | 'expenses' | 'category' | 'deadStock'>('profitability')
const selectedExpenseCategory = ref<string | null>(null)
const expandedCategoryId = ref<string | null>(null)
const expandedCategorySubrows = ref<CategoryBreakdownRow[]>([])

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
const showTrendChart = computed(() => chartBucket.value === 'month' || trend.points.value.length >= 3)
const popDeltaPct = computed<number | null>(() => {
  if (previousInvoiceCount.value <= 0) return null
  const prev = previousProfitUsd.value
  if (prev === null || prev === 0) return null
  return ((metrics.profitUsd.value - prev) / Math.abs(prev)) * 100
})
const popDirection = computed<'up' | 'down' | null>(() => {
  if (popDeltaPct.value === null) return null
  return popDeltaPct.value >= 0 ? 'up' : 'down'
})
const popDeltaLabel = computed(() => {
  if (popDeltaPct.value === null) return ''
  const rounded = Math.round(Math.abs(popDeltaPct.value))
  const sign = popDeltaPct.value >= 0 ? '+' : '-'
  return `${sign}${rounded}%`
})

async function reload() {
  if (rangeError.value || isCustomIncomplete.value) return
  const { start, end } = getReportRange(period.value, customStart.value, customEnd.value)
  if (!start || !end) return
  const bucket = bucketForRange(start, end)
  const previousRange = getPreviousReportRange(period.value, start, end)

  showProfitInfo.value = false
  chartBucket.value = bucket
  selectedTrendPointIndex.value = null
  expandedCategoryId.value = null
  expandedCategorySubrows.value = []

  await Promise.all([
    metrics.loadRange(start, end),
    trend.load(start, end, bucket),
    expenseBreakdown.load(start, end),
    expenseBreakdown.loadEntries(start, end, selectedExpenseCategory.value ?? undefined),
    categoryBreakdown.load(start, end),
    uncostedSales.load(start, end),
    previousRange
      ? previousMetrics.loadRange(previousRange.start, previousRange.end)
      : Promise.resolve(),
  ])

  // Runs after metrics.loadRange resolves (not in parallel with it above):
  // the anomaly engine reads metrics' just-updated revenue/COGS/expenses/refunds
  // values, so it must not race the load that produces them (see WAFI-015 plan §2a).
  await loadAnomalies({ start, end }, {
    revenueUsd: metrics.revenueUsd.value,
    cogsUsd: metrics.cogsUsd.value,
    expensesUsd: metrics.expensesUsd.value,
    refundsUsd: metrics.refundsUsd.value,
  })

  if (trend.points.value.length > 0) {
    selectedTrendPointIndex.value = trend.points.value.length - 1
  }

  if (!previousRange) {
    previousProfitUsd.value = null
    previousInvoiceCount.value = 0
    return
  }

  previousProfitUsd.value = previousMetrics.profitUsd.value
  previousInvoiceCount.value = previousMetrics.invoiceCount.value
}

function selectPeriod(p: ReportPeriod) { period.value = p }

async function selectExpenseCategory(category: string) {
  selectedExpenseCategory.value = category
  const { start, end } = getReportRange(period.value, customStart.value, customEnd.value)
  if (!start || !end) return
  await expenseBreakdown.loadEntries(start, end, category)
}

async function clearExpenseCategoryFilter() {
  selectedExpenseCategory.value = null
  const { start, end } = getReportRange(period.value, customStart.value, customEnd.value)
  if (!start || !end) return
  await expenseBreakdown.loadEntries(start, end)
}

async function toggleCategoryRow(categoryId: string) {
  if (expandedCategoryId.value === categoryId) {
    expandedCategoryId.value = null
    expandedCategorySubrows.value = []
    return
  }
  const { start, end } = getReportRange(period.value, customStart.value, customEnd.value)
  if (!start || !end) return
  expandedCategoryId.value = categoryId
  expandedCategorySubrows.value = await categoryBreakdown.loadSubcategoryRows(categoryId, start, end)
}

function monthWindow(monthKey: string): { start: string; end: string } | null {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return null
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

async function openDrilldownForPoint(index: number) {
  const point = trend.points.value[index]
  if (!point?.bucketKey) return

  const window = chartBucket.value === 'day'
    ? { start: point.bucketKey, end: point.bucketKey }
    : monthWindow(point.bucketKey)

  if (!window) return

  drilldownTitle.value = chartBucket.value === 'day'
    ? t('reports.drilldownDayTitle', { label: point.bucketKey })
    : t('reports.drilldownMonthTitle', { label: point.bucketKey })

  drilldownLoading.value = true
  drilldownOpen.value = true
  try {
    await drilldown.load(window.start, window.end)
  } finally {
    drilldownLoading.value = false
  }
}

function selectTrendPoint(index: number) {
  selectedTrendPointIndex.value = index
  void openDrilldownForPoint(index)
}

const DEAD_STOCK_THRESHOLDS: DeadStockThresholdDays[] = [30, 60, 90, 180]

function selectDeadStockThreshold(days: DeadStockThresholdDays) {
  deadStock.thresholdDays.value = days
}

watch(deadStock.thresholdDays, () => deadStock.load())

watch([period, customStart, customEnd], reload)
onMounted(() => { reload(); deadStock.load() })
</script>

<template>
  <section class="reports-page" dir="rtl">
    <h1 class="page-title">{{ t('reports.title') }}</h1>

    <RouterLink
      v-if="canViewStaffPerformance"
      to="/reports/staff"
      data-test="staff-performance-link"
      class="staff-performance-link"
    >أداء الموظفين ←</RouterLink>

    <div class="period-toggle">
      <button data-test="period-week"    :class="{ active: period === 'week' }"    @click="selectPeriod('week')">{{ t('reports.week') }}</button>
      <button data-test="period-month"   :class="{ active: period === 'month' }"   @click="selectPeriod('month')">{{ t('reports.month') }}</button>
      <button data-test="period-quarter" :class="{ active: period === 'quarter' }" @click="selectPeriod('quarter')">{{ t('reports.quarter') }}</button>
      <button data-test="period-custom"  :class="{ active: period === 'custom' }"  @click="selectPeriod('custom')">{{ t('reports.custom') }}</button>
    </div>

    <div v-if="anomalies.length > 0" class="anomalies-wrap">
      <p v-for="a in anomalies" :key="a.code" class="anomaly-banner">
        {{ t(`anomalies.${a.code}.title`) }} — {{ t(`anomalies.${a.code}.message`) }}
      </p>
    </div>

    <div class="reports-tabs" role="tablist" aria-label="report tabs">
      <button
        type="button"
        data-test="tab-profitability"
        class="reports-tab"
        :class="{ active: activeTab === 'profitability' }"
        @click="activeTab = 'profitability'"
      >{{ t('reports.tabProfitability') }}</button>
      <button
        type="button"
        data-test="tab-expenses"
        class="reports-tab"
        :class="{ active: activeTab === 'expenses' }"
        @click="activeTab = 'expenses'"
      >{{ t('reports.tabExpenses') }}</button>
      <button
        type="button"
        data-test="tab-category"
        class="reports-tab"
        :class="{ active: activeTab === 'category' }"
        @click="activeTab = 'category'"
      >{{ t('reports.tabCategory') }}</button>
      <button
        type="button"
        data-test="tab-dead-stock"
        class="reports-tab"
        :class="{ active: activeTab === 'deadStock' }"
        @click="activeTab = 'deadStock'"
      >بضاعة راكدة</button>
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
      <div v-if="hasSales && activeTab === 'profitability'" class="report-body" data-test="profitability-tab-panel">
        <div class="headline card" :class="isProfit ? 'pos' : 'neg'">
          <div class="headline-row">
            <span class="verb">{{ isProfit ? t('reports.profitVerb') : t('reports.lossVerb') }}</span>
            <button
              type="button"
              class="info-btn"
              data-test="profit-info"
              :aria-expanded="showProfitInfo"
              @click="showProfitInfo = !showProfitInfo"
            >ⓘ</button>
          </div>
          <span class="amount" data-test="profit-headline" dir="ltr">${{ Math.abs(metrics.profitUsd.value).toFixed(2) }}</span>
          <p
            v-if="popDeltaPct !== null"
            data-test="profit-delta"
            class="delta-chip"
            :class="popDirection === 'up' ? 'delta-chip--up' : 'delta-chip--down'"
            dir="ltr"
          >
            <span>{{ popDirection === 'up' ? '▲' : '▼' }}</span>
            <span>{{ popDeltaLabel }}</span>
          </p>
          <p v-if="showProfitInfo" data-test="profit-info-text" class="profit-info-note">
            {{ t('reports.profitInfo') }}
          </p>
        </div>

        <p v-if="metrics.profitIsEstimated.value" class="caveat">{{ t('reports.estimated') }}</p>
        <p v-if="uncostedSales.count.value > 0" class="caveat" data-test="uncosted-sales-notice">
          الربح لا يشمل {{ uncostedSales.count.value }} {{ uncostedSales.count.value === 1 ? 'بيعة' : 'مبيعات' }} بدون تكلفة
        </p>

        <div v-if="showTrendChart" class="card chart-card">
          <ProfitCumulativeChart
            :points="trend.points.value"
            :selected-index="selectedTrendPointIndex"
            @point-select="selectTrendPoint"
          />
        </div>
        <p v-if="showTrendChart" class="chart-basis-note">{{ t('reports.chartBasisNote') }}</p>
        <p v-if="showTrendChart" class="chart-tap-hint">{{ t('reports.chartTapHint') }}</p>
        <p v-else data-test="trend-cold-start" class="cold-start-note">{{ t('reports.trendColdStart') }}</p>

        <ul class="breakdown card">
          <li><span>{{ t('reports.gross') }}</span><span dir="ltr">${{ metrics.grossIncomeUsd.value.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.returns') }}</span><span dir="ltr">${{ metrics.refundsUsd.value.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.cogs') }}</span><span dir="ltr">${{ metrics.cogsUsd.value.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.expenses') }}</span><span dir="ltr">${{ metrics.expensesUsd.value.toFixed(2) }}</span></li>
          <li class="total"><span>= {{ t('reports.profit') }}</span><span dir="ltr">${{ metrics.profitUsd.value.toFixed(2) }}</span></li>
        </ul>

        <div class="cash-movement-note-row">
          <button
            type="button"
            class="info-btn"
            data-test="cash-movement-info"
            :aria-expanded="showCashMovementInfo"
            @click="showCashMovementInfo = !showCashMovementInfo"
          >ⓘ</button>
          <span>{{ t('reports.cashMovementFootnote') }}</span>
          <RouterLink to="/shifts/history" class="cash-movement-link" data-test="cash-movement-link">
            {{ t('reports.viewCashMovements') }}
          </RouterLink>
        </div>
        <p v-if="showCashMovementInfo" data-test="cash-movement-info-text" class="profit-info-note">
          {{ t('reports.cashMovementInfo') }}
        </p>
      </div>

      <section v-else-if="activeTab === 'expenses'" class="report-body" data-test="expenses-tab-panel">
        <div v-if="expenseBreakdown.totalUsd.value > 0" class="card chart-card">
          <ExpenseDonutChart
            :slices="expenseBreakdown.slices.value"
            :total-usd="expenseBreakdown.totalUsd.value"
            @category-select="selectExpenseCategory"
          />
        </div>
        <p v-else class="cold-start-note">{{ t('reports.noExpensesInBucket') }}</p>

        <TopExpensesList
          :entries="expenseBreakdown.entries.value"
          :selected-category="selectedExpenseCategory"
          @clear-filter="clearExpenseCategoryFilter"
        />
      </section>

      <section v-else-if="activeTab === 'category'" class="report-body" data-test="category-tab-panel">
        <ul v-if="categoryBreakdown.rows.value.length" class="category-list card">
          <li v-for="row in categoryBreakdown.rows.value" :key="row.categoryId" class="category-row-wrap">
            <button
              type="button"
              class="category-row"
              :data-test="`category-row-${row.categoryId}`"
              @click="toggleCategoryRow(row.categoryId)"
            >
              <span class="category-name">{{ row.categoryName }}</span>
              <span class="category-figures">
                <span dir="ltr">${{ row.revenueUsd.toFixed(2) }}</span>
                <span dir="ltr">${{ row.cogsUsd.toFixed(2) }}</span>
                <span dir="ltr" :class="row.profitUsd >= 0 ? 'pos-text' : 'neg-text'">${{ row.profitUsd.toFixed(2) }}</span>
              </span>
            </button>
            <p v-if="row.hasMissingCost" class="caveat">{{ t('reports.estimated') }}</p>

            <ul v-if="expandedCategoryId === row.categoryId && expandedCategorySubrows.length" class="subcategory-list">
              <li v-for="sub in expandedCategorySubrows" :key="sub.categoryId" class="subcategory-row">
                <span class="category-name">{{ sub.categoryName }}</span>
                <span class="category-figures">
                  <span dir="ltr">${{ sub.revenueUsd.toFixed(2) }}</span>
                  <span dir="ltr">${{ sub.cogsUsd.toFixed(2) }}</span>
                  <span dir="ltr" :class="sub.profitUsd >= 0 ? 'pos-text' : 'neg-text'">${{ sub.profitUsd.toFixed(2) }}</span>
                </span>
              </li>
            </ul>
          </li>
        </ul>
        <p v-else class="cold-start-note">{{ t('reports.empty') }}</p>
      </section>

      <section v-else-if="activeTab === 'deadStock'" class="report-body" data-test="dead-stock-tab-panel">
        <div class="dead-stock-threshold-row">
          <button
            v-for="d in DEAD_STOCK_THRESHOLDS"
            :key="d"
            type="button"
            class="sort-chip"
            :class="{ active: deadStock.thresholdDays.value === d }"
            @click="selectDeadStockThreshold(d)"
          >{{ d }} يوم</button>
        </div>

        <div class="card headline dead-stock-headline">
          <span class="verb">لديك بضاعة راكدة بقيمة</span>
          <span class="amount" data-test="dead-stock-headline" dir="ltr">${{ deadStock.totalFrozenCapitalUsd.value.toFixed(2) }}</span>
          <p class="dead-stock-sub">لم تُبع منذ {{ deadStock.thresholdDays.value }} يوماً</p>
        </div>

        <div class="dead-stock-sort-row">
          <button type="button" class="sort-chip" :class="{ active: deadStock.sort.value === 'value' }" @click="deadStock.sort.value = 'value'">الأعلى قيمة</button>
          <button type="button" class="sort-chip" :class="{ active: deadStock.sort.value === 'age' }" @click="deadStock.sort.value = 'age'">الأقدم</button>
        </div>

        <ul v-if="deadStock.rows.value.length" class="dead-stock-list card">
          <li v-for="row in deadStock.rows.value" :key="row.productId" class="dead-stock-row" :class="{ 'dead-stock-row--uncosted': row.isUncosted }">
            <div class="dead-stock-info">
              <span class="dead-stock-name">{{ row.nameAr }}</span>
              <span class="dead-stock-meta">
                {{ row.neverSold ? 'لم تُبع أبداً' : `آخر بيع قبل ${deadStock.daysSince(row.lastSoldAt!)} يوماً` }}
                · المخزون {{ row.currentStock }}
              </span>
            </div>
            <span v-if="row.isUncosted" class="dead-stock-value dead-stock-value--uncosted">غير مُسعّرة</span>
            <span v-else class="dead-stock-value" dir="ltr">${{ row.valueUsd.toFixed(2) }}</span>
          </li>
        </ul>
        <p v-else class="cold-start-note">لا توجد بضاعة راكدة ضمن هذه المدة</p>
      </section>

      <p v-else data-test="empty" class="empty">{{ t('reports.empty') }}</p>
    </template>

    <ReportDrilldownSheet
      v-if="drilldownOpen"
      :title="drilldownTitle"
      :loading="drilldownLoading"
      :totals="drilldown.totals.value"
      :expenses="drilldown.expenses.value"
      @close="drilldownOpen = false"
    />
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

.staff-performance-link {
  align-self: flex-start;
  font-size: 0.82rem;
  font-weight: 700;
  color: #60A5FA;
  text-decoration: none;
}

.period-toggle { display: flex; gap: 8px; flex-wrap: wrap; }
.period-toggle button {
  flex: 1; min-width: 64px; padding: 9px 10px; border-radius: 10px; cursor: pointer;
  font-family: inherit; font-size: 0.8125rem; font-weight: 700; color: #C8D5E8;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(26, 86, 219, 0.28);
  transition: background 0.15s, border-color 0.15s;
}
.period-toggle button.active { background: #1A56DB; border-color: #1A56DB; color: #fff; }

.reports-tabs {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(26, 86, 219, 0.24);
  background: rgba(26, 86, 219, 0.08);
}

.reports-tab {
  flex: 1;
  height: 2.25rem;
  border-radius: 0.6rem;
  border: 1px solid transparent;
  background: transparent;
  color: #C8D5E8;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.reports-tab.active {
  background: #1A56DB;
  border-color: #1A56DB;
  color: #fff;
}

.anomalies-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.anomaly-banner {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: 0.7rem;
  border: 1px solid rgba(234, 179, 8, 0.45);
  background: rgba(234, 179, 8, 0.14);
  color: #FCD34D;
  font-size: 0.83rem;
  font-weight: 700;
}

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
.headline-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.headline .verb { font-size: 0.9rem; color: #93A3B8; }
.headline .amount { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.headline.pos .amount { color: #22C55E; }
.headline.neg .amount { color: #EF4444; }

.info-btn {
  width: 1.35rem;
  height: 1.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(26, 86, 219, 0.35);
  background: rgba(26, 86, 219, 0.12);
  color: #BFDBFE;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.delta-chip {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.delta-chip--up {
  color: #22C55E;
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(34, 197, 94, 0.35);
}

.delta-chip--down {
  color: #EF4444;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.35);
}

.profit-info-note {
  margin: 0.25rem 0 0;
  font-size: 0.77rem;
  line-height: 1.5;
  color: #C8D5E8;
  text-align: center;
  max-width: 38rem;
}

.caveat {
  margin: 0; padding: 10px 12px; border-radius: 10px; font-size: 0.85rem; color: #FCD34D;
  background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25);
}

.cash-movement-note-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.77rem;
  color: #93A3B8;
  flex-wrap: wrap;
}

.cash-movement-link {
  margin-inline-start: auto;
  color: #60A5FA;
  font-weight: 600;
  text-decoration: none;
}

.chart-card { padding: 8px 8px 0; }

.chart-basis-note {
  margin: -0.2rem 0 0;
  font-size: 0.76rem;
  color: #93A3B8;
  text-align: center;
  line-height: 1.45;
}

.chart-tap-hint {
  margin: -0.2rem 0 0;
  font-size: 0.74rem;
  color: #93A3B8;
  text-align: center;
}

.chart-details-btn {
  height: 2rem;
  padding: 0 0.7rem;
  border-radius: 0.55rem;
  border: 1px solid rgba(26, 86, 219, 0.35);
  background: rgba(26, 86, 219, 0.12);
  color: #BFDBFE;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
}

.chart-details-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cold-start-note {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 0.75rem;
  font-size: 0.86rem;
  color: #C8D5E8;
  background: rgba(26, 86, 219, 0.10);
  border: 1px solid rgba(26, 86, 219, 0.24);
  text-align: center;
}

.breakdown { list-style: none; margin: 0; padding: 8px 16px; }
.breakdown li {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.9rem; color: #C8D5E8; font-variant-numeric: tabular-nums;
}
.breakdown li:last-child { border-bottom: none; }
.breakdown .total { font-weight: 800; color: #E8EDF5; padding-top: 12px; }

.empty { text-align: center; padding: 40px 0; color: #637285; }

/* ── Dead-stock tab ───────────────────────────────── */
.dead-stock-threshold-row, .dead-stock-sort-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }

.sort-chip {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  color: #9FB0C7;
  cursor: pointer;
  font-family: inherit;
}

.sort-chip.active { background: rgba(26,86,219,0.20); border-color: rgba(26,86,219,0.55); color: #60A5FA; }

.dead-stock-headline .amount { color: #F59E0B; }
.dead-stock-sub { margin: 0; font-size: 0.78rem; color: #93A3B8; }

.dead-stock-list { list-style: none; margin: 0; padding: 8px 16px; }
.dead-stock-row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 10px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.dead-stock-row:last-child { border-bottom: none; }
.dead-stock-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dead-stock-name { font-size: 0.875rem; font-weight: 700; color: #E8EDF5; }
.dead-stock-meta { font-size: 0.72rem; color: #637285; }
.dead-stock-value { font-size: 0.875rem; font-weight: 800; color: #F59E0B; flex-shrink: 0; }
.dead-stock-value--uncosted { color: #93A3B8; font-weight: 600; font-size: 0.78rem; }
.dead-stock-row--uncosted .dead-stock-name { opacity: 0.75; }

/* ── By-category tab ─────────────────────────────── */
.category-list { list-style: none; margin: 0; padding: 8px 16px; }
.category-row-wrap { border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding: 4px 0; }
.category-row-wrap:last-child { border-bottom: none; }
.category-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 0;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  color: #C8D5E8;
  font-size: 0.9rem;
}
.category-name { font-weight: 700; color: #E8EDF5; }
.category-figures { display: flex; gap: 12px; font-variant-numeric: tabular-nums; font-size: 0.85rem; }
.pos-text { color: #22C55E; }
.neg-text { color: #EF4444; }
.subcategory-list {
  list-style: none;
  margin: 4px 0 6px;
  padding: 6px 10px;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.03);
}
.subcategory-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  font-size: 0.83rem;
  color: #93A3B8;
}
</style>
