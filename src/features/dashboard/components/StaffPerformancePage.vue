<!-- WAFI-018 Staff Performance Dashboard. Owner-only (can_view_staff_performance,
     see router/index.ts + staff.types.ts). Reuses the week/month/quarter/custom
     period pattern from ReportsPage.vue and the periodUtils range helpers — NOT
     PeriodToggle.vue, which is a different today/week/month component used
     elsewhere. "Contribution Margin" internally; the UI column is plain language
     ("المبيعات بعد تكلفة البضاعة" — sales after the cost of goods), per the
     design doc's split between accounting-precise naming and owner-facing
     wording (docs/superpowers/specs/2026-07-28-wafi-018-staff-performance-design.md). -->
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { getReportRange } from '../composables/periodUtils'
import type { ReportPeriod } from '../composables/periodUtils'
import { useStaffPerformanceMetrics } from '../composables/useStaffPerformanceMetrics'
import type { StaffPerformanceRow } from '../composables/useStaffPerformanceMetrics'

type SortKey = 'name' | 'revenueUsd' | 'cogsUsd' | 'marginUsd' | 'salesCount' | 'avgTicketUsd'

const perf = useStaffPerformanceMetrics()

const period       = ref<ReportPeriod>('month')
const customStart  = ref('')
const customEnd    = ref('')

// Sort persists across period changes (does not reset on `reload`) — an
// owner who sorts by Average Ticket shouldn't have to reapply it every time
// they switch the period.
const sortKey = ref<SortKey>('marginUsd')
const sortDir = ref<'asc' | 'desc'>('desc')

const rangeError = computed(() =>
  period.value === 'custom'
  && !!customStart.value && !!customEnd.value
  && customStart.value > customEnd.value)

const isCustomIncomplete = computed(() =>
  period.value === 'custom' && (!customStart.value || !customEnd.value))

function selectPeriod(p: ReportPeriod) { period.value = p }

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = key
  // Numbers default to a descending "biggest first" view; name defaults to
  // alphabetical (ascending) since "biggest name" is meaningless.
  sortDir.value = key === 'name' ? 'asc' : 'desc'
}

// null (no sales → no avg ticket) always sinks to the bottom of the sorted
// list regardless of sort direction — it's "no data," not "zero."
function compareRows(a: StaffPerformanceRow, b: StaffPerformanceRow): number {
  const key = sortKey.value
  const av = a[key]
  const bv = b[key]
  if (av === null && bv === null) return 0
  if (av === null) return 1
  if (bv === null) return -1
  if (typeof av === 'string' || typeof bv === 'string') {
    const cmp = String(av).localeCompare(String(bv), 'ar')
    return sortDir.value === 'asc' ? cmp : -cmp
  }
  const cmp = (av as number) - (bv as number)
  return sortDir.value === 'asc' ? cmp : -cmp
}

const sortedRows = computed(() => [...perf.rows.value].sort(compareRows))
const hasActivity = computed(() => perf.rows.value.length > 0)

async function reload() {
  if (rangeError.value || isCustomIncomplete.value) return
  const { start, end } = getReportRange(period.value, customStart.value, customEnd.value)
  if (!start || !end) return
  await perf.load(start, end)
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

function marginPctLabel(row: StaffPerformanceRow): string {
  return row.marginPct === null ? '' : ` (${Math.round(row.marginPct)}%)`
}

watch([period, customStart, customEnd], reload)
onMounted(reload)
</script>

<template>
  <section class="staff-performance-page" dir="rtl">
    <h1 class="page-title">أداء الموظفين</h1>

    <div class="period-toggle">
      <button data-test="period-week"    :class="{ active: period === 'week' }"    @click="selectPeriod('week')">الأسبوع</button>
      <button data-test="period-month"   :class="{ active: period === 'month' }"   @click="selectPeriod('month')">الشهر</button>
      <button data-test="period-quarter" :class="{ active: period === 'quarter' }" @click="selectPeriod('quarter')">الربع</button>
      <button data-test="period-custom"  :class="{ active: period === 'custom' }"  @click="selectPeriod('custom')">مخصص</button>
    </div>

    <div v-if="period === 'custom'" class="custom-range">
      <label class="date-label">
        <span>من</span>
        <input v-model="customStart" type="date" data-test="custom-start" class="form-input" />
      </label>
      <label class="date-label">
        <span>إلى</span>
        <input v-model="customEnd" type="date" data-test="custom-end" class="form-input" />
      </label>
      <p v-if="rangeError" data-test="range-error" class="warn">نطاق التاريخ غير صحيح</p>
    </div>

    <template v-if="!rangeError && !isCustomIncomplete">
      <p v-if="!hasActivity" data-test="empty" class="empty-state">
        لا يوجد نشاط للموظفين خلال هذه الفترة
      </p>

      <div v-else class="table-wrap card">
        <table class="staff-table" data-test="staff-table">
          <thead>
            <tr>
              <th data-test="sort-name" @click="toggleSort('name')">الموظف</th>
              <th data-test="sort-revenue" @click="toggleSort('revenueUsd')">المبيعات</th>
              <th data-test="sort-cogs" @click="toggleSort('cogsUsd')">التكلفة</th>
              <th data-test="sort-margin" @click="toggleSort('marginUsd')">المبيعات بعد تكلفة البضاعة</th>
              <th data-test="sort-count" @click="toggleSort('salesCount')">عدد الفواتير</th>
              <th data-test="sort-avg-ticket" @click="toggleSort('avgTicketUsd')">متوسط الفاتورة</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sortedRows" :key="row.staffId" :data-test="`staff-row-${row.staffId}`">
              <td class="name-cell">{{ row.name }}</td>
              <td dir="ltr">{{ fmtUsd(row.revenueUsd) }}</td>
              <td dir="ltr">{{ fmtUsd(row.cogsUsd) }}</td>
              <td dir="ltr" data-test="margin-cell">{{ fmtUsd(row.marginUsd) }}{{ marginPctLabel(row) }}</td>
              <td>{{ row.salesCount }}</td>
              <td dir="ltr" data-test="avg-ticket-cell">
                {{ row.avgTicketUsd === null ? '—' : fmtUsd(row.avgTicketUsd) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="caption">هذه الأرقام إجمالية لهذه الفترة، وليست معدّلة حسب عدد أيام أو ورديات العمل.</p>
      <p class="caption">المرتجعات تُحسب على الموظف الذي قام بمعالجتها.</p>
    </template>
  </section>
</template>

<style scoped>
.staff-performance-page {
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
.date-label { display: flex; flex-direction: column; gap: 6px; font-size: 0.8125rem; color: #93A3B8; min-width: 160px; flex: 1; }
.form-input {
  width: 100%; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem; padding: 0.625rem 0.875rem; color: #E8EDF5; font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif; box-sizing: border-box;
}
.warn { color: #FBBF24; font-size: 0.85rem; margin: 0; width: 100%; }

.card {
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}
.table-wrap { overflow-x: auto; padding: 4px; }
.staff-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.staff-table th {
  text-align: right; padding: 10px 12px; cursor: pointer; user-select: none;
  color: #93A3B8; font-weight: 700; white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.staff-table td {
  padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.name-cell { font-weight: 700; color: #E8EDF5; }

.empty-state {
  margin: 0; padding: 40px 16px; text-align: center; color: #93A3B8;
  border-radius: 0.75rem; background: rgba(26, 86, 219, 0.10); border: 1px solid rgba(26, 86, 219, 0.24);
}

.caption { margin: 0; font-size: 0.76rem; color: #93A3B8; line-height: 1.5; }
</style>
