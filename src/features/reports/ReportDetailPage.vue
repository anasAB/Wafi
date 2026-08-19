<!-- src/features/reports/ReportDetailPage.vue -->
<!--
  WAFI-147A: lazy per-report generation -- compute() runs exactly once per
  (range, staffId) combination the owner asks for, for the one report this
  route selected. Never called from ReportsListPage.vue.
-->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import { formatLocalDate, addCalendarDays } from './dateUtils'
import { REPORT_DEFINITIONS } from './index'
import type { ReportId } from './index'
import type { Report, ReportDateRange, ReportSection } from './report.types'
import SummaryReportView from './components/SummaryReportView.vue'
import DetailReportView from './components/DetailReportView.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const report = ref<Report | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const staffOptions = ref<{ id: string; name: string }[]>([])
const selectedStaffId = ref<string>('')
const rangeError = ref<string | null>(null)

const reportId = route.params.reportId as ReportId
const definition = REPORT_DEFINITIONS[reportId]

// Task 0 P0 finding 3: section-level authorization happens HERE, not just as
// whole-report list hiding (Task 20 still hides Employee Summary from the
// list for a non-permitted viewer, but a composite report like Weekly
// Summary must render normally minus its staff-identifying sections, not be
// hidden outright over one section). visibility: 'shop' sections always pass.
const canSeeStaffSections = computed(() => canUserDo(session.activeStaff, 'can_view_staff_performance'))
const visibleSections = computed((): ReportSection[] =>
  (report.value?.sections ?? []).filter((s) => s.visibility === 'shop' || canSeeStaffSections.value),
)

function defaultRangeForCadence(cadenceHint: string): ReportDateRange {
  const today = formatLocalDate(new Date())
  // Task 0 finding 9: rolling windows, not calendar-aligned week/month -- a
  // report opened mid-week/mid-month should show a meaningful trailing
  // window, not a partial current one. Isolated here, no report definition
  // hardcodes a window length itself.
  if (cadenceHint === 'weekly') return { from: addCalendarDays(today, -6), to: today }
  if (cadenceHint === 'monthly') return { from: addCalendarDays(today, -29), to: today }
  return { from: today, to: today }
}

const range = ref<ReportDateRange>(definition ? defaultRangeForCadence(definition.cadenceHint) : { from: '', to: '' })
// Task 0 P0 finding 4: contextRequirement, NOT cadenceHint, is what drives
// invocation behavior here. cadenceHint stays purely a display/default-range
// hint (defaultRangeForCadence above is the one place it legitimately
// matters, and even there only for picking a default window length).
const needsStaffContext = computed(() => definition?.contextRequirement === 'staff')

// Task 0 P0 finding 5 (second review): Employee Summary is WHOLE-REPORT
// gated, not merely section-filtered -- unlike a composite report (Weekly
// Summary etc.) where hiding one section still leaves a meaningful report,
// Employee Summary's entire purpose is staff-identifying figures, so an
// unpermitted viewer should never reach the staff selector or trigger
// compute() at all, not just see an empty result after the fact. Every
// report requiring 'staff' context is, by definition, whole-report gated
// this way (currently only Employee Summary; if a future report is added
// with contextRequirement: 'staff', it inherits the same gate for free).
const isAuthorizedForThisReport = computed(() =>
  !needsStaffContext.value || canUserDo(session.activeStaff, 'can_view_staff_performance'),
)

async function generate() {
  if (!definition) { error.value = 'التقرير غير موجود'; return }
  if (!isAuthorizedForThisReport.value) return // whole-report gate; UI never reaches the staff selector for this case either
  if (needsStaffContext.value && !selectedStaffId.value) return // withhold until a staff member is chosen

  // Task 0 P0 finding 18: reject an inverted range before calling compute() --
  // an invalid range must surface as a visible error, never a silently empty
  // "valid-looking" report.
  rangeError.value = null
  if (range.value.from > range.value.to) {
    rangeError.value = 'يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساويًا له'
    return
  }

  loading.value = true
  error.value = null
  try {
    const { shopId } = useDeviceStore()
    const context = selectedStaffId.value ? { staffId: selectedStaffId.value } : undefined
    report.value = await definition.compute(shopId, range.value, context)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'تعذّر إنشاء التقرير'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!isAuthorizedForThisReport.value) return // do not generate, do not show the staff selector, do not query staff -- "not authorized" renders from the template's own check
  if (needsStaffContext.value) {
    const { shopId } = useDeviceStore()
    staffOptions.value = await db.getAll<{ id: string; name: string }>(
      `SELECT id, name FROM staff WHERE shop_id = ? AND is_active = 1 ORDER BY name`,
      [shopId],
    )
    return // wait for staff selection before generating (see `generate()`'s own guard)
  }
  await generate()
})

watch(selectedStaffId, (id) => { if (id) generate() })
</script>

<template>
  <div class="lg:hidden">
    <AppHeader :title="definition?.name ?? 'تقرير'" :show-back="true" @back="router.back()" />
  </div>
  <div class="page-body" dir="rtl">
    <!-- Task 0 P0 finding 5 (second review): whole-report gate, checked BEFORE
         the staff selector or anything else renders -- an unpermitted viewer
         never sees the selector, never triggers a staff query, never calls
         compute(). -->
    <p v-if="!isAuthorizedForThisReport" class="state-message state-message--error" data-testid="not-authorized">
      لا تملك صلاحية عرض هذا التقرير
    </p>
    <template v-else>
      <div v-if="needsStaffContext" class="staff-picker">
        <label>الموظف</label>
        <select data-testid="staff-select" v-model="selectedStaffId">
          <option value="" disabled>اختر موظفًا</option>
          <option v-for="s in staffOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <div v-if="definition && !needsStaffContext" class="range-picker">
        <label>من<input type="date" v-model="range.from" data-testid="range-from"></label>
        <label>إلى<input type="date" v-model="range.to" data-testid="range-to"></label>
        <button type="button" data-testid="regenerate-button" @click="generate">تحديث</button>
      </div>
      <p v-if="rangeError" class="state-message state-message--error" data-testid="range-error">{{ rangeError }}</p>

      <p v-if="loading" class="state-message">...جارٍ إنشاء التقرير</p>
      <p v-else-if="error" class="state-message state-message--error">{{ error }}</p>
      <template v-else-if="report">
        <template v-for="(s, i) in visibleSections" :key="i">
          <SummaryReportView v-if="s.type === 'summary'" :section="s" />
          <DetailReportView v-else :section="s" />
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.page-body { padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; font-family: 'Tajawal', system-ui, sans-serif; }
.state-message { text-align: center; color: #9AA8BE; font-size: 0.85rem; padding: 2rem 0; }
.state-message--error { color: #EF4444; }
.staff-picker, .range-picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; font-size: 0.8rem; color: #C8D5E8; }
.staff-picker select, .range-picker input { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 8px; color: #E8EDF5; font-family: inherit; }
.range-picker button { background: linear-gradient(135deg, #1A56DB, #1248B3); border: none; border-radius: 8px; padding: 6px 12px; color: #fff; font-weight: 700; cursor: pointer; }
</style>
