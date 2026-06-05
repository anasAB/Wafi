<script setup lang="ts">
import { ref } from 'vue'

const emit      = defineEmits<{ confirm: [usd: number, syp: number] }>()
const usdAmount = ref('')
const sypAmount = ref('')

function confirm() {
  emit('confirm', parseFloat(usdAmount.value) || 0, parseFloat(sypAmount.value) || 0)
}
</script>

<template>
  <div class="overlay" dir="rtl">
    <div class="sheet">

      <!-- Handle -->
      <div class="sheet-handle"></div>

      <!-- Title -->
      <div class="sheet-header">
        <h2 class="sheet-title">عدّ الصندوق</h2>
        <p class="sheet-subtitle">كم موجود في الصندوق الآن قبل الإغلاق؟</p>
      </div>

      <!-- Inputs -->
      <div class="inputs-wrap">

        <!-- USD -->
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

        <!-- SYP -->
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

      <!-- Confirm button -->
      <div class="sheet-footer">
        <button class="btn-confirm" @click="confirm">
          التالي — عرض تقرير الوردية
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ─── Overlay ─────────────────────────────────────────────── */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ─── Sheet container ─────────────────────────────────────── */
.sheet {
  width: 100%;
  max-width: 512px;
  border-radius: 1.25rem 1.25rem 0 0;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.45);
  border-bottom: none;
  box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
}

/* ─── Sheet handle ────────────────────────────────────────── */
.sheet-handle {
  width: 40px;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  margin: 12px auto;
}

/* ─── Sheet header ────────────────────────────────────────── */
.sheet-header {
  text-align: center;
  padding: 0 24px 20px;
}

.sheet-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0 0 4px;
}

.sheet-subtitle {
  font-size: 0.875rem;
  color: #637285;
  margin: 0;
}

/* ─── Inputs ──────────────────────────────────────────────── */
.inputs-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 24px 20px;
}

.cash-input-card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 1rem;
  padding: 12px 16px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.cash-input-card:focus-within {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

/* ─── Cash label ──────────────────────────────────────────── */
.cash-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

/* ─── Cash input ──────────────────────────────────────────── */
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

/* ─── Sheet footer / confirm ──────────────────────────────── */
.sheet-footer {
  padding: 0 24px 32px;
}

.btn-confirm {
  width: 100%;
  height: 56px;
  border-radius: 1rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: white;
  border: none;
  font-size: 1rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.1s;
}

.btn-confirm:hover { opacity: 0.88; }
.btn-confirm:active { transform: scale(0.98); }
</style>
