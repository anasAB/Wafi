<script setup lang="ts">
import { computed } from 'vue'
import Select from 'primevue/select'
import type { FieldMapping, PriceCurrency, TargetField } from '../import.types'

const props = defineProps<{ headers: string[]; modelValue: FieldMapping }>()
const emit = defineEmits<{ 'update:modelValue': [FieldMapping]; confirm: [] }>()

const FIELDS: { key: TargetField; label: string; required?: boolean }[] = [
  { key: 'nameAr', label: 'الاسم', required: true },
  { key: 'salePrice', label: 'سعر البيع', required: true },
  { key: 'cost', label: 'التكلفة' },
  { key: 'barcode', label: 'الباركود' },
  { key: 'currentStock', label: 'المخزون الحالي' },
  { key: 'lowStockThreshold', label: 'حد التنبيه' },
  { key: 'category', label: 'الفئة' },
  { key: 'nameEn', label: 'الاسم بالإنجليزية' },
]

const canAdvance = computed(() => !!props.modelValue.nameAr && !!props.modelValue.salePrice)
const headerOptions = computed(() => props.headers.map((h) => ({ label: h, value: h })))
const currencyOptions: { label: string; value: PriceCurrency }[] = [
  { label: 'ليرة سورية', value: 'SYP' },
  { label: 'دولار', value: 'USD' },
]

function optionsForField(field: TargetField) {
  const selectedByOtherFields = new Set(
    FIELDS
      .map((f) => f.key)
      .filter((k) => k !== field)
      .map((k) => props.modelValue[k])
      .filter((v): v is string => !!v),
  )

  const current = props.modelValue[field]
  return headerOptions.value.filter(
    (opt) => opt.value === current || !selectedByOtherFields.has(opt.value),
  )
}

function setField(key: TargetField, value: string | null) {
  emit('update:modelValue', { ...props.modelValue, [key]: value || null })
}
function setCurrency(key: 'priceCurrency' | 'costCurrency', value: PriceCurrency) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

defineExpose({ canAdvance })
</script>

<template>
  <div class="mapping-step" dir="rtl">
    <p class="hint">حدد أي عمود من ملفك يقابل كل حقل. الحقول المميزة بـ * مطلوبة.</p>

    <div v-for="f in FIELDS" :key="f.key" class="field-row">
      <label class="field-label">{{ f.label }}<span v-if="f.required" class="required-star">*</span></label>
      <Select
        class="field-select"
        :model-value="(modelValue as any)[f.key] ?? null"
        :options="optionsForField(f.key)"
        option-label="label"
        option-value="value"
        placeholder="—"
        show-clear
        @update:model-value="setField(f.key, $event as string | null)"
      />
    </div>

    <div class="field-row">
      <label class="field-label">عملة السعر</label>
      <Select
        class="field-select"
        :model-value="modelValue.priceCurrency"
        :options="currencyOptions"
        option-label="label"
        option-value="value"
        @update:model-value="setCurrency('priceCurrency', $event as PriceCurrency)"
      />
    </div>
    <div class="field-row">
      <label class="field-label">عملة التكلفة</label>
      <Select
        class="field-select"
        :model-value="modelValue.costCurrency"
        :options="currencyOptions"
        option-label="label"
        option-value="value"
        @update:model-value="setCurrency('costCurrency', $event as PriceCurrency)"
      />
    </div>

    <button type="button" class="advance-btn" :disabled="!canAdvance" @click="emit('confirm')">متابعة</button>
  </div>
</template>

<style scoped>
.mapping-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.hint { font-size: 13px; color: #637285; margin: 0; }
.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.field-label {
  width: 140px;
  flex-shrink: 0;
  font-size: 13px;
  color: #C8D5E8;
}
.required-star { color: #FCA5A5; margin-inline-start: 2px; }
.field-select {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-height: 39px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem;
  padding: 8px 56px 8px 10px;
  transition: border-color 0.15s, box-shadow 0.15s;
  cursor: pointer;
}
.field-select:focus-within {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}
.field-select :deep(.p-select-label) {
  padding: 0;
  color: #E8EDF5;
  font-size: 13px;
  font-family: inherit;
}
.field-select :deep(.p-placeholder) {
  color: #637285;
}
.field-select :deep(.p-select-dropdown) {
  position: absolute;
  inset-inline-end: 10px;
  inset-block: 0;
  margin: auto;
  width: 1rem;
  height: 1rem;
  color: #637285;
}
.field-select :deep(.p-select-clear-icon) {
  position: absolute;
  inset-inline-end: 30px;
  inset-block: 0;
  margin: auto;
  width: 0.9rem;
  height: 0.9rem;
  color: #8ea1bb;
}
.advance-btn {
  align-self: flex-start;
  margin-top: 6px;
  background: #1A56DB;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}
.advance-btn:disabled {
  background: rgba(255,255,255,0.06);
  color: #637285;
  cursor: not-allowed;
}
</style>
