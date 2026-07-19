<script setup lang="ts">
import { ref } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import DenominationTally from './DenominationTally.vue'
import { useDenominationConfig } from '../composables/useDenominationConfig'
import type { DenominationBreakdown } from '../shift.types'

const props = defineProps<{ errorMessage?: string }>()
const emit = defineEmits<{
  confirm: [usd: number, syp: number, breakdown: { usd: DenominationBreakdown | null; syp: DenominationBreakdown | null }]
  cancel: []
}>()

const { usd: usdDenoms, syp: sypDenoms, load: loadDenoms } = useDenominationConfig()
loadDenoms()

const usdTotal = ref(0)
const sypTotal = ref(0)
const usdBreakdown = ref<DenominationBreakdown | null>(null)
const sypBreakdown = ref<DenominationBreakdown | null>(null)

function onUsdChange(payload: { total: number; breakdown: DenominationBreakdown | null }) {
  usdTotal.value = payload.total
  usdBreakdown.value = payload.breakdown
}

function onSypChange(payload: { total: number; breakdown: DenominationBreakdown | null }) {
  sypTotal.value = payload.total
  sypBreakdown.value = payload.breakdown
}

function confirm() {
  emit('confirm', usdTotal.value, sypTotal.value, { usd: usdBreakdown.value, syp: sypBreakdown.value })
}
</script>

<template>
  <BaseModal title="عدّ الصندوق" @close="emit('cancel')">
    <div class="sheet-body" dir="rtl">
      <p class="sheet-subtitle">كم موجود في الصندوق الآن قبل الإغلاق؟</p>

      <p v-if="props.errorMessage" class="sheet-error">{{ props.errorMessage }}</p>

      <div class="inputs-wrap">
        <DenominationTally
          label="دولار أمريكي $"
          :denominations="usdDenoms.map(d => d.value)"
          :is-syp="false"
          @change="onUsdChange"
        />
        <DenominationTally
          label="ليرة سورية ل.س"
          :denominations="sypDenoms.map(d => d.value)"
          :is-syp="true"
          @change="onSypChange"
        />
      </div>
    </div>

    <template #footer>
      <div class="sheet-footer">
        <button type="button" class="btn-cancel" @click="emit('cancel')">إلغاء</button>
        <button type="button" class="btn-confirm" @click="confirm">
          التالي — عرض تقرير الوردية
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.sheet-body {
  font-family: 'Tajawal', system-ui, sans-serif;
}

.sheet-subtitle {
  text-align: center;
  font-size: 0.875rem;
  color: #637285;
  margin: 0 0 1rem;
}

.sheet-error {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.8125rem;
  color: #FCA5A5;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(127, 29, 29, 0.22);
  border-radius: 0.75rem;
  padding: 0.5rem 0.625rem;
}

.inputs-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 60vh;
  overflow-y: auto;
}

.sheet-footer {
  display: flex;
  gap: 0.75rem;
}

.btn-cancel {
  height: 48px;
  min-width: 112px;
  padding-inline: 1rem;
  border-radius: 1rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #E8EDF5;
  font-size: 1rem;
  font-weight: 500;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-cancel:hover { background: rgba(255, 255, 255, 0.06); }

.btn-confirm {
  flex: 1;
  height: 48px;
  border-radius: 1rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: white;
  border: none;
  font-size: 0.95rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.1s;
}

.btn-confirm:hover { opacity: 0.88; }
.btn-confirm:active { transform: scale(0.98); }

@media (max-width: 420px) {
  .sheet-footer {
    flex-direction: column-reverse;
  }

  .btn-cancel,
  .btn-confirm {
    width: 100%;
  }
}
</style>
