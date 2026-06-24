<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AppDatePicker from '@/components/ui/AppDatePicker.vue'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import {
  fetchSalesRows, fetchExpensesRows,
  fetchProductsRows, fetchCustomersRows,
} from './composables/useExportData'
import { buildAndDownload } from './composables/useExportFile'
import {
  SALES_HEADERS, EXPENSES_HEADERS,
  PRODUCTS_HEADERS, CUSTOMERS_HEADERS,
} from './export.types'
import { validateCustomRange, isLargeExport } from './export.validation'
import type { ExportDataset, ExportFormat } from './export.types'

const router = useRouter()
const { period } = usePeriodToggle()

const selectedDataset  = ref<ExportDataset>('sales')
const selectedFormat   = ref<ExportFormat>('xlsx')
const useCustomRange   = ref(false)
const customStart      = ref('')
const customEnd        = ref('')
const loading          = ref(false)
const toast            = ref<{ message: string; type: 'success' | 'error' } | null>(null)

const showDateRange = computed(() =>
  selectedDataset.value === 'sales' || selectedDataset.value === 'expenses'
)

function parseIsoDate(value: string): Date | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const customStartDate = computed<Date | null>({
  get: () => parseIsoDate(customStart.value),
  set: (value) => {
    customStart.value = value ? toIsoDate(value) : ''
  },
})

const customEndDate = computed<Date | null>({
  get: () => parseIsoDate(customEnd.value),
  set: (value) => {
    customEnd.value = value ? toIsoDate(value) : ''
  },
})

const effectiveDateRange = computed(() => {
  if (useCustomRange.value && customStart.value && customEnd.value) {
    return { start: customStart.value, end: customEnd.value }
  }
  return getDateRange(period.value)
})

const datasets: { key: ExportDataset; label: string; desc: string }[] = [
  { key: 'sales',     label: 'المبيعات',  desc: 'تفصيل الفواتير وأسطر البيع' },
  { key: 'expenses',  label: 'المصاريف', desc: 'مصاريف المحل حسب الفترة' },
  { key: 'products',  label: 'المنتجات',  desc: 'المخزون الحالي والأسعار' },
  { key: 'customers', label: 'الزبائن',   desc: 'الأرصدة والديون المستحقة' },
]

async function onExport() {
  // Validate a custom range before doing any work, so reversed/blank dates give a
  // clear message instead of a silently-empty file (which surfaces as "no data").
  if (showDateRange.value && useCustomRange.value) {
    const err = validateCustomRange(customStart.value, customEnd.value)
    if (err) {
      toast.value = { message: err, type: 'error' }
      return
    }
  }

  loading.value = true
  toast.value   = null
  try {
    const today    = new Date().toISOString().slice(0, 10)
    const ext      = selectedFormat.value
    const range    = effectiveDateRange.value
    let rows: Record<string, unknown>[]
    let headers: readonly string[]
    let filename: string

    if (selectedDataset.value === 'sales') {
      rows     = await fetchSalesRows(range)
      headers  = SALES_HEADERS
      filename = `wafi-sales-${today}.${ext}`
    } else if (selectedDataset.value === 'expenses') {
      rows     = await fetchExpensesRows(range)
      headers  = EXPENSES_HEADERS
      filename = `wafi-expenses-${today}.${ext}`
    } else if (selectedDataset.value === 'products') {
      rows     = await fetchProductsRows()
      headers  = PRODUCTS_HEADERS
      filename = `wafi-products-${today}.${ext}`
    } else {
      rows     = await fetchCustomersRows()
      headers  = CUSTOMERS_HEADERS
      filename = `wafi-customers-${today}.${ext}`
    }

    // A very large file is built synchronously and can briefly freeze a low-end
    // device — warn and let the owner decide before committing to the build.
    if (isLargeExport(rows.length) &&
        !window.confirm(`الملف كبير (${rows.length} سطر) وقد يستغرق وقتاً. هل تريد المتابعة؟`)) {
      return
    }

    buildAndDownload(headers, rows, filename, selectedFormat.value)
    toast.value = { message: 'تم تصدير الملف بنجاح', type: 'success' }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'حدث خطأ أثناء التصدير'
    toast.value = { message: msg, type: 'error' }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <!-- Mobile-only header; on desktop this renders inside the Settings content panel -->
  <div class="lg:hidden">
    <AppHeader title="تصدير البيانات" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <main class="page-main">

      <!-- Step 1: Dataset -->
      <div class="step-section">
        <div class="step-label">١. اختر البيانات</div>
        <div class="dataset-grid">
          <button
            v-for="ds in datasets"
            :key="ds.key"
            type="button"
            class="dataset-card"
            :class="{ active: selectedDataset === ds.key }"
            @click="selectedDataset = ds.key"
          >
            <span class="ds-label">{{ ds.label }}</span>
            <span class="ds-desc">{{ ds.desc }}</span>
          </button>
        </div>
      </div>

      <!-- Step 2: Date range (Sales + Expenses only) -->
      <div v-if="showDateRange" class="step-section">
        <div class="step-label">٢. الفترة الزمنية</div>
        <div class="range-card">
          <div class="range-default">
            <span class="range-default-label">الفترة الحالية:</span>
            <span class="range-default-value">{{ effectiveDateRange.start }} → {{ effectiveDateRange.end }}</span>
          </div>
          <button type="button" class="custom-toggle" @click="useCustomRange = !useCustomRange">
            {{ useCustomRange ? 'استخدام الفترة الحالية' : 'تخصيص الفترة' }}
          </button>
          <div v-if="useCustomRange" class="custom-range-inputs">
            <label class="date-label">
              <span>من</span>
              <AppDatePicker
                v-model="customStartDate"
                class="export-date-picker"
                date-format="yy-mm-dd"
                placeholder="اختر التاريخ"
                show-icon
                icon-display="input"
                append-to="self"
                input-id="export-custom-start"
                :input-class="'form-input date-input prime-date-input'"
              />
            </label>
            <label class="date-label">
              <span>إلى</span>
              <AppDatePicker
                v-model="customEndDate"
                class="export-date-picker"
                date-format="yy-mm-dd"
                placeholder="اختر التاريخ"
                show-icon
                icon-display="input"
                append-to="self"
                input-id="export-custom-end"
                :input-class="'form-input date-input prime-date-input'"
              />
            </label>
          </div>
        </div>
      </div>

      <!-- Step 3: Format -->
      <div class="step-section">
        <div class="step-label">{{ showDateRange ? '٣' : '٢' }}. الصيغة</div>
        <div class="format-row">
          <button
            type="button"
            class="format-btn"
            :class="{ active: selectedFormat === 'xlsx' }"
            @click="selectedFormat = 'xlsx'"
          >
            Excel (.xlsx)
          </button>
          <button
            type="button"
            class="format-btn"
            :class="{ active: selectedFormat === 'csv' }"
            @click="selectedFormat = 'csv'"
          >
            CSV (.csv)
          </button>
        </div>
      </div>

      <!-- Step 4: Export button -->
      <div class="step-section">
        <button
          type="button"
          class="export-btn"
          :disabled="loading"
          @click="onExport"
        >
          <span v-if="loading" class="spinner" aria-hidden="true"></span>
          <span>{{ loading ? 'جارٍ التصدير...' : 'تصدير' }}</span>
        </button>
      </div>

    </main>

    <AppToast
      v-if="toast"
      :message="toast.message"
      :type="toast.type"
      @dismiss="toast = null"
    />
  </div>
</template>

<style scoped>
.page-body {
  padding: 1.5rem 1rem 80px;
  max-width: 42rem; margin: 0 auto; width: 100%;
  font-family: 'Tajawal', system-ui, sans-serif;
}
@media (min-width: 1024px) {
  .page-body { padding: 20px; max-width: none; }
}
.page-main {
  display: flex; flex-direction: column; gap: 1.5rem;
}
.step-section { display: flex; flex-direction: column; gap: 0.75rem; }
.step-label {
  font-size: 11px; font-weight: 700; color: #3D4F6B;
  text-transform: uppercase; letter-spacing: 0.1em;
}
.dataset-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.625rem;
}
.dataset-card {
  display: flex; flex-direction: column; gap: 3px;
  padding: 14px 16px; border-radius: 12px; cursor: pointer;
  text-align: right; border: 1px solid rgba(26,86,219,0.18);
  background: rgba(255,255,255,0.03);
  transition: background 0.15s, border-color 0.15s;
}
.dataset-card.active {
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(26,86,219,0.08));
  border-color: rgba(26,86,219,0.50);
  box-shadow: 0 2px 12px rgba(26,86,219,0.15);
}
.ds-label { font-size: 14px; font-weight: 700; color: #E8EDF5; }
.ds-desc  { font-size: 11px; color: #637285; line-height: 1.4; }
.range-card {
  padding: 14px 16px; border-radius: 12px;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.22);
  display: flex; flex-direction: column; gap: 10px;
}
.range-default { display: flex; gap: 8px; align-items: center; }
.range-default-label { font-size: 12px; color: #637285; }
.range-default-value { font-size: 13px; color: #C8D5E8; font-weight: 600; }
.custom-toggle {
  font-size: 13px; font-weight: 600; color: #60A5FA;
  background: none; border: none; cursor: pointer; text-align: right; padding: 0;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.custom-range-inputs { display: flex; gap: 12px; flex-wrap: wrap; }
.date-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #637285;
  flex: 1;
  min-width: 180px;
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

.export-date-picker {
  width: 100%;
}

.export-date-picker :deep(.p-inputtext),
.export-date-picker :deep(input.p-datepicker-input) {
  background: rgba(255, 255, 255, 0.07) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  color: #E8EDF5 !important;
}

.export-date-picker :deep(.p-inputtext:enabled:hover),
.export-date-picker :deep(input.p-datepicker-input:enabled:hover) {
  border-color: rgba(26, 86, 219, 0.45) !important;
}

.export-date-picker :deep(.p-inputtext:enabled:focus),
.export-date-picker :deep(input.p-datepicker-input:enabled:focus) {
  border-color: rgba(26, 86, 219, 0.8) !important;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15) !important;
}

.export-date-picker :deep(.p-datepicker-input) {
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

.export-date-picker :deep(.p-inputtext::placeholder) {
  color: #3D4F6B;
  opacity: 1;
}

.export-date-picker :deep(.p-datepicker-input-icon-container) {
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

.export-date-picker :deep(.p-datepicker-input-icon) {
  font-size: 0.95rem;
  line-height: 1;
}

.export-date-picker :deep(.p-datepicker-dropdown) {
  display: none;
}

.export-date-picker :deep(.p-datepicker-panel) {
  margin-top: 6px;
  min-width: 18rem;
  border-radius: 12px;
  border: 1px solid rgba(26,86,219,0.30);
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  color: #E8EDF5;
}

.export-date-picker :deep(.p-datepicker-calendar-container),
.export-date-picker :deep(.p-datepicker-calendar),
.export-date-picker :deep(.p-datepicker-month-view),
.export-date-picker :deep(.p-datepicker-year-view) {
  background: transparent !important;
}

.export-date-picker :deep(.p-datepicker-header) {
  background: transparent;
  border-bottom: 1px solid rgba(26,86,219,0.20);
  color: #E8EDF5;
}

.export-date-picker :deep(.p-datepicker-title button),
.export-date-picker :deep(.p-datepicker-prev),
.export-date-picker :deep(.p-datepicker-next) {
  color: #C8D5E8;
}

.export-date-picker :deep(.p-datepicker-title) {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.export-date-picker :deep(.p-datepicker-select-month),
.export-date-picker :deep(.p-datepicker-select-year) {
  min-width: 5.25rem;
  height: 2rem;
  border-radius: 0;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.export-date-picker :deep(.p-datepicker-select-month:hover),
.export-date-picker :deep(.p-datepicker-select-year:hover),
.export-date-picker :deep(.p-datepicker-select-month:focus),
.export-date-picker :deep(.p-datepicker-select-year:focus),
.export-date-picker :deep(.p-datepicker-select-month:focus-visible),
.export-date-picker :deep(.p-datepicker-select-year:focus-visible) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.export-date-picker :deep(.p-datepicker-calendar table) {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0.2rem;
}

.export-date-picker :deep(.p-datepicker-calendar th),
.export-date-picker :deep(.p-datepicker-calendar td) {
  text-align: center;
}

.export-date-picker :deep(.p-datepicker-title button:hover),
.export-date-picker :deep(.p-datepicker-prev:hover),
.export-date-picker :deep(.p-datepicker-next:hover) {
  background: rgba(26, 86, 219, 0.16) !important;
}

.export-date-picker :deep(.p-datepicker-day),
.export-date-picker :deep(.p-datepicker-month),
.export-date-picker :deep(.p-datepicker-year) {
  width: 2.15rem;
  height: 2.15rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  color: #C8D5E8;
}

.export-date-picker :deep(.p-datepicker-day:hover) {
  background: rgba(26,86,219,0.16);
}

.export-date-picker :deep(.p-datepicker-day-selected) {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #FFFFFF;
}

.export-date-picker :deep(.p-datepicker-select-month),
.export-date-picker :deep(.p-datepicker-select-year),
.export-date-picker :deep(.p-select),
.export-date-picker :deep(.p-select-label),
.export-date-picker :deep(.p-select-dropdown) {
  background: transparent !important;
  border-color: transparent !important;
  color: #E8EDF5 !important;
}

.format-row { display: flex; gap: 10px; }
.format-btn {
  flex: 1; padding: 10px; border-radius: 10px; font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: 'Tajawal', system-ui, sans-serif;
  border: 1px solid rgba(26,86,219,0.22);
  background: rgba(255,255,255,0.03); color: #637285;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.format-btn.active {
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(26,86,219,0.08));
  border-color: rgba(26,86,219,0.50); color: #E8EDF5;
}
.export-btn {
  width: 100%; height: 52px; border-radius: 14px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none; color: white; font-size: 16px; font-weight: 700;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  font-family: 'Tajawal', system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(26,86,219,0.40);
  transition: opacity 0.2s;
}
.export-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.spinner {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
