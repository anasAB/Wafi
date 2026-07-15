<!-- src/features/payment/components/InstallmentPlanForm.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { generateInstallmentSchedule } from '@/features/installments/installmentSchedule'
import type { TermFrequency } from '@/features/installments/installment.types'

const props = defineProps<{ totalUsd: number }>()
const emit = defineEmits<{
  (e: 'confirm', payload: { downPaymentUsd: number; termCount: number; termFrequency: TermFrequency; startDate: string }): void
}>()

function defaultStartDate(frequency: TermFrequency): string {
  const d = new Date()
  if (frequency === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const downPaymentStr = ref('0')
const termCountStr    = ref('3')
const termFrequency   = ref<TermFrequency>('monthly')
const startDate       = ref(defaultStartDate('monthly'))
const error           = ref<string | null>(null)

const downPaymentUsd = computed(() => parseFloat(downPaymentStr.value) || 0)
const termCount      = computed(() => parseInt(termCountStr.value, 10) || 0)

function onFrequencyChange(freq: TermFrequency) {
  termFrequency.value = freq
  startDate.value = defaultStartDate(freq)
}

const schedule = computed(() => {
  if (termCount.value <= 0 || downPaymentUsd.value > props.totalUsd || downPaymentUsd.value < 0) return []
  try {
    return generateInstallmentSchedule(props.totalUsd, downPaymentUsd.value, termCount.value, termFrequency.value, startDate.value)
  } catch {
    return []
  }
})

const previewText = computed(() => {
  if (!schedule.value.length) return ''
  const first = schedule.value[0]
  const freqLabel = termFrequency.value === 'weekly' ? 'أسبوعياً' : 'شهرياً'
  return `دفعة أولى: $${downPaymentUsd.value.toFixed(2)}، ثم ${termCount.value} دفعة ${freqLabel} من $${first.amountDueUsd.toFixed(2)} ابتداءً من ${first.dueDate}`
})

function handleConfirm() {
  error.value = null
  if (downPaymentUsd.value < 0 || downPaymentUsd.value > props.totalUsd) {
    error.value = 'الدفعة الأولى يجب أن تكون بين صفر والمجموع الكلي'
    return
  }
  if (termCount.value <= 0) {
    error.value = 'عدد الدفعات يجب أن يكون رقماً أكبر من صفر'
    return
  }
  if (!startDate.value) {
    error.value = 'يرجى اختيار تاريخ الدفعة الأولى'
    return
  }
  emit('confirm', {
    downPaymentUsd: downPaymentUsd.value,
    termCount: termCount.value,
    termFrequency: termFrequency.value,
    startDate: startDate.value,
  })
}
</script>

<template>
  <div class="installment-form" dir="rtl">
    <div class="field-group">
      <label class="field-label">الدفعة الأولى ($)</label>
      <input v-model="downPaymentStr" type="number" inputmode="decimal" min="0" class="field-input" />
    </div>

    <div class="field-group">
      <label class="field-label">عدد الدفعات</label>
      <input v-model="termCountStr" type="number" inputmode="numeric" min="1" class="field-input" />
    </div>

    <div class="field-group">
      <label class="field-label">التكرار</label>
      <div class="freq-toggle">
        <button
          type="button"
          class="freq-btn"
          :class="{ 'freq-btn-active': termFrequency === 'monthly' }"
          @click="onFrequencyChange('monthly')"
        >شهرياً</button>
        <button
          type="button"
          class="freq-btn"
          :class="{ 'freq-btn-active': termFrequency === 'weekly' }"
          @click="onFrequencyChange('weekly')"
        >أسبوعياً</button>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">تاريخ الدفعة الأولى</label>
      <input v-model="startDate" type="date" class="field-input" dir="ltr" />
    </div>

    <p v-if="previewText" class="preview-text">{{ previewText }}</p>
    <p v-if="error" class="form-error">{{ error }}</p>

    <button type="button" class="confirm-btn" @click="handleConfirm">تأكيد خطة التقسيط</button>
  </div>
</template>

<style scoped>
.installment-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: #637285; }
.field-input {
  height: 44px;
  border-radius: 10px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #E8EDF5;
  font-size: 15px;
  font-family: inherit;
}
.freq-toggle { display: flex; gap: 8px; }
.freq-btn {
  flex: 1;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(26, 86, 219, 0.24);
  background: rgba(26, 86, 219, 0.08);
  color: #C8D5E8;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}
.freq-btn-active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  border-color: transparent;
}
.preview-text {
  font-size: 13px;
  color: #60A5FA;
  background: rgba(26, 86, 219, 0.08);
  border: 1px solid rgba(26, 86, 219, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 0;
}
.form-error { color: #EF4444; font-size: 13px; margin: 0; }
.confirm-btn {
  height: 52px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  cursor: pointer;
}
</style>
