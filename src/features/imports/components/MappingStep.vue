<script setup lang="ts">
import { computed } from 'vue'
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

function setField(key: TargetField, value: string) {
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
      <select
        class="field-select"
        :value="(modelValue as any)[f.key] ?? ''"
        @change="setField(f.key, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">—</option>
        <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
      </select>
    </div>

    <div class="field-row">
      <label class="field-label">عملة السعر</label>
      <select
        class="field-select"
        :value="modelValue.priceCurrency"
        @change="setCurrency('priceCurrency', ($event.target as HTMLSelectElement).value as PriceCurrency)"
      >
        <option value="SYP">ليرة سورية</option>
        <option value="USD">دولار</option>
      </select>
    </div>
    <div class="field-row">
      <label class="field-label">عملة التكلفة</label>
      <select
        class="field-select"
        :value="modelValue.costCurrency"
        @change="setCurrency('costCurrency', ($event.target as HTMLSelectElement).value as PriceCurrency)"
      >
        <option value="SYP">ليرة سورية</option>
        <option value="USD">دولار</option>
      </select>
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
  flex: 1;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(26,86,219,0.20);
  border-radius: 10px;
  color: #E8EDF5;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
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
