<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useExchangeRate } from './useExchangeRate'
import AppDialog from '@/components/ui/AppDialog.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const { currentRate, rateHistory, needsConfirmation, pendingRate, saving, error, loadRate, saveRate, confirmSave } = useExchangeRate()

const input = ref('')
const validationError = ref<string | null>(null)

onMounted(async () => {
  await loadRate()
  input.value = currentRate.value ? String(currentRate.value) : ''
})

async function handleSave() {
  const val = parseFloat(input.value)
  if (isNaN(val) || val <= 0) {
    validationError.value = 'السعر يجب أن يكون أكبر من صفر'
    return
  }
  if (!Number.isInteger(val)) {
    validationError.value = 'السعر يجب أن يكون رقماً صحيحاً بدون كسور'
    return
  }
  validationError.value = null
  await saveRate(val)
  if (!needsConfirmation.value && !error.value) {
    emit('saved')
    emit('close')
  }
}

async function handleConfirm() {
  await confirmSave()
  if (!error.value) {
    emit('saved')
    emit('close')
  }
}

function formatRelative(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (h < 1) return 'منذ لحظات'
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${d} يوم`
}
</script>

<template>
  <!-- Backdrop -->
  <div
    class="backdrop"
    @click.self="emit('close')"
  >
    <!-- Dialog -->
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exchange-rate-dialog-title"
    >
      <!-- Header -->
      <div class="dialog-header">
        <div class="header-row">
          <div class="icon-badge">
            <svg class="icon" fill="none" stroke="#60A5FA" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M7 10.5h10M7 13.5h10"/>
            </svg>
          </div>
          <h2 id="exchange-rate-dialog-title" class="dialog-title">سعر صرف الدولار</h2>
        </div>
        <p v-if="currentRate" class="current-rate-text">
          الحالي:
          <span class="rate-pill" dir="ltr">${1} = {{ currentRate.toLocaleString('ar-SY') }} ل.س</span>
        </p>
      </div>

      <div class="dialog-body">
        <!-- Input -->
        <label for="exchange-rate-input" class="input-label">
          السعر الجديد (ليرة سورية لكل دولار)
        </label>
        <input
          id="exchange-rate-input"
          v-model="input"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          autofocus
          class="rate-input"
          dir="ltr"
          placeholder="مثال: 14500"
        />

        <p v-if="validationError" class="error-msg">{{ validationError }}</p>
        <p v-else-if="error" class="error-msg">{{ error }}</p>
        <div v-else class="error-spacer"></div>

        <!-- Rate history -->
        <div v-if="rateHistory.length" class="history-card">
          <p class="history-title">السجل</p>
          <ul class="history-list">
            <li v-for="r in rateHistory" :key="r.setAt" class="history-item">
              <span class="history-rate" dir="ltr">{{ r.rate.toLocaleString() }} ل.س</span>
              <span class="history-time">{{ formatRelative(r.setAt) }}</span>
            </li>
          </ul>
        </div>

        <!-- Buttons -->
        <div class="btn-row">
          <button
            type="button"
            class="btn-cancel"
            @click="emit('close')"
          >إلغاء</button>
          <button
            type="button"
            :disabled="saving"
            :aria-busy="saving"
            class="btn-save"
            @click="handleSave"
          >{{ saving ? 'جاري الحفظ...' : 'حفظ' }}</button>
        </div>
      </div>
    </div>
  </div>

  <AppDialog
    v-if="needsConfirmation"
    title="تغيير كبير في السعر"
    :message="`السعر الجديد ${pendingRate?.toLocaleString()} ل.س يختلف أكثر من 50٪ عن الحالي. هل أنت متأكد؟`"
    confirm-label="نعم، حفظ"
    :danger="true"
    @confirm="handleConfirm"
    @cancel="needsConfirmation = false"
  />
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 1rem;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

.dialog {
  font-family: 'Tajawal', system-ui, sans-serif;
  width: 100%;
  max-width: 24rem;
  overflow: hidden;
  border-radius: 1.25rem;
  text-align: right;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.45);
  box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
}

.dialog-header {
  padding: 1.25rem 1.25rem 1rem;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.header-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.375rem;
}

.icon-badge {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(26, 86, 219, 0.18);
  border: 1px solid rgba(26, 86, 219, 0.30);
}

.icon {
  width: 1rem;
  height: 1rem;
}

.dialog-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.current-rate-text {
  font-size: 0.75rem;
  color: #637285;
  margin: 0;
  margin-inline-start: 2.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.rate-pill {
  display: inline-flex;
  align-items: center;
  background: rgba(26, 86, 219, 0.12);
  border: 1px solid rgba(26, 86, 219, 0.35);
  border-radius: 20px;
  padding: 2px 10px;
  color: #60A5FA;
  font-weight: 700;
  font-size: 0.75rem;
}

.dialog-body {
  padding: 1.25rem;
}

.input-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #637285;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.rate-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0.75rem 0.875rem;
  color: #E8EDF5;
  font-size: 1.25rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.rate-input::placeholder {
  color: #3D4F6B;
  font-weight: 400;
}

.rate-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

/* Remove number input spinners */
.rate-input::-webkit-outer-spin-button,
.rate-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.rate-input[type=number] {
  -moz-appearance: textfield;
}

.error-msg {
  font-size: 0.75rem;
  color: #EF4444;
  margin: 0.375rem 0 0.75rem;
}

.error-spacer {
  height: 1rem;
  margin-bottom: 0.75rem;
}

.history-card {
  margin-bottom: 1rem;
  padding: 0.75rem;
  border-radius: 0.875rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.08), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(26, 86, 219, 0.18);
}

.history-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: #637285;
  margin: 0 0 0.5rem;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.history-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #637285;
}

.history-rate {
  font-weight: 600;
  color: #E8EDF5;
}

.history-time {
  color: #637285;
}

.btn-row {
  display: flex;
  gap: 0.625rem;
}

.btn-cancel {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  color: #E8EDF5;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-cancel:hover {
  opacity: 0.8;
}

.btn-save {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.1s;
}

.btn-save:hover {
  opacity: 0.88;
}

.btn-save:active {
  transform: scale(0.98);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
