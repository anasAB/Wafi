<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
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
  <div class="page-root" dir="rtl">
    <AppHeader title="تصدير البيانات" :show-back="true" @back="router.back()" />

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
              <input v-model="customStart" type="date" class="date-input" />
            </label>
            <label class="date-label">
              <span>إلى</span>
              <input v-model="customEnd" type="date" class="date-input" />
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
.page-root {
  display: flex; flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.page-main {
  flex: 1; padding: 1.5rem 1rem 80px;
  max-width: 42rem; margin-inline: auto; width: 100%;
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
.date-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #637285; }
.date-input {
  padding: 7px 10px; border-radius: 8px; font-size: 13px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(26,86,219,0.25);
  color: #E8EDF5; font-family: 'Tajawal', system-ui, sans-serif;
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
