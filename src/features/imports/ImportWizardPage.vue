<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import SourceStep from './components/SourceStep.vue'
import MappingStep from './components/MappingStep.vue'
import PreviewStep from './components/PreviewStep.vue'
import ResultStep from './components/ResultStep.vue'
import { autoDetectMapping } from './composables/useColumnMapping'
import { buildCanonicalRows, validateRows } from './composables/useImportValidation'
import { useProductImport } from './composables/useProductImport'
import { useExchangeRate } from '@/features/exchange-rate/useExchangeRate'
import { buildAndDownload } from '@/features/exports/composables/useExportFile'
import { TEMPLATE_HEADERS } from './composables/useImportParse'
import type { FieldMapping, ImportResult, RowStatus } from './import.types'

const router = useRouter()
const step = ref(1)
const headers = ref<string[]>([])
const rawRows = ref<Record<string, unknown>[]>([])
const mapping = ref<FieldMapping | null>(null)
const statuses = ref<RowStatus[]>([])
const result = ref<ImportResult | null>(null)

const { fetchExistingBarcodes, commitImport } = useProductImport()
const { currentRate, loadRate } = useExchangeRate()
onMounted(loadRate)

const needsRate = computed(() =>
  !!mapping.value &&
  (mapping.value.priceCurrency === 'SYP' || mapping.value.costCurrency === 'SYP') &&
  !currentRate.value,
)

function onParsed(p: { headers: string[]; rawRows: Record<string, unknown>[] }) {
  headers.value = p.headers
  rawRows.value = p.rawRows
  mapping.value = autoDetectMapping(p.headers)
  step.value = 2
}

async function goToPreview() {
  const existing = await fetchExistingBarcodes()
  const canonical = buildCanonicalRows(rawRows.value, mapping.value!)
  statuses.value = validateRows(canonical, existing)
  step.value = 3
}

async function runCommit() {
  result.value = await commitImport(statuses.value, {
    rate: currentRate.value ?? 0,
    priceCurrency: mapping.value!.priceCurrency,
    costCurrency: mapping.value!.costCurrency,
  })
  step.value = 4
}

function downloadErrors() {
  const headerRow = [...TEMPLATE_HEADERS, 'السبب']
  const rows = statuses.value
    .filter((s) => s.kind !== 'import')
    .map((s) => ({
      'الاسم': s.row.nameAr, 'الباركود': s.row.barcode ?? '',
      'سعر البيع': s.row.salePriceRaw ?? '', 'التكلفة': s.row.costRaw ?? '',
      'المخزون الحالي': s.row.currentStock ?? '', 'حد التنبيه': s.row.lowStockThreshold ?? '',
      'الفئة': s.row.category ?? '', 'السبب': s.reason ?? '',
    }))
  buildAndDownload(headerRow, rows, 'wafi-import-errors.xlsx', 'xlsx')
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="استيراد المنتجات من Excel" :show-back="true" @back="router.back()" />
    <main class="wizard-body">
      <SourceStep v-if="step === 1" @parsed="onParsed" />
      <MappingStep
        v-else-if="step === 2 && mapping"
        :headers="headers"
        v-model="mapping"
        @confirm="goToPreview"
      />
      <PreviewStep
        v-else-if="step === 3"
        :statuses="statuses"
        :needs-rate="needsRate"
        @commit="runCommit"
      />
      <ResultStep
        v-else-if="step === 4 && result"
        :result="result"
        @download-errors="downloadErrors"
      />
    </main>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.wizard-body { padding: 16px; }
</style>
