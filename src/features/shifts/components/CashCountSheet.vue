<script setup lang="ts">
import { ref } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps<{ errorMessage?: string }>()
const emit      = defineEmits<{ confirm: [usd: number, syp: number]; cancel: [] }>()
const usdAmount = ref('')
const sypAmount = ref('')

function confirm() {
  emit('confirm', parseFloat(usdAmount.value) || 0, parseFloat(sypAmount.value) || 0)
}
</script>

<template>
  <BaseModal title="عدّ الصندوق" @close="emit('cancel')">
    <div class="sheet-body" dir="rtl">
      <p class="sheet-subtitle">كم موجود في الصندوق الآن قبل الإغلاق؟</p>

      <p v-if="props.errorMessage" class="sheet-error">{{ props.errorMessage }}</p>

      <div class="inputs-wrap">
        <div class="cash-input-card">
          <label class="cash-label">دولار أمريكي $</label>
          <input
            v-model="usdAmount"
            type="number"
            min="0"
            step="0.01"
            class="cash-input"
            placeholder="0.00"
            dir="ltr"
          />
        </div>

        <div class="cash-input-card">
          <label class="cash-label">ليرة سورية ل.س</label>
          <input
            v-model="sypAmount"
            type="number"
            min="0"
            step="1"
            class="cash-input"
            placeholder="0"
            dir="ltr"
          />
        </div>
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
}

.cash-input-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 1rem;
  padding: 0.75rem 0.875rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.cash-input-card:focus-within {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

.cash-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #637285;
  margin-bottom: 0.45rem;
}

.cash-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #E8EDF5;
  font-size: 1.5rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  padding: 0;
}

.cash-input::placeholder { color: #3D4F6B; }

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
