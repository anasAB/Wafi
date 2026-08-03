<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AdjustmentReason } from '@/features/products/product.types'

const props = defineProps<{
  productName:  string
  currentStock: number
}>()

const emit = defineEmits<{
  (e: 'confirm', payload: { newValue: number; reason: AdjustmentReason; notes: string }): void
  (e: 'close'): void
}>()

const newValue = ref<number>(props.currentStock)
const reason   = ref<AdjustmentReason>('stocktake')
const notes    = ref('')
const saving   = ref(false)

// BUG-M01 (/products) fix: native <input type="number"> plus v-model.number
// briefly renders blank while focused after a select-all + retype, because
// Vue's DOM patch is skipped whenever the parsed numeric model happens not to
// change on an intermediate keystroke, leaving the field out of sync with
// what was actually typed. Driving the input as plain text against its own
// display ref (kept in lockstep with `newValue`) means what's on screen is
// always exactly what was typed, never a value Vue decided not to re-render.
const qtyDisplay = ref(String(props.currentStock))

function onQtyInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  qtyDisplay.value = raw
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits !== '') newValue.value = Number(digits)
}

function onQtyBlur() {
  // Re-sync display to the canonical numeric value — covers leaving the
  // field empty/non-numeric, and just tidies up any leading zeros.
  qtyDisplay.value = String(newValue.value)
}

const reasonOptions: { value: AdjustmentReason; label: string }[] = [
  { value: 'stocktake', label: 'جرد' },
  { value: 'damaged',   label: 'تالف' },
  { value: 'lost',      label: 'مفقود' },
  { value: 'other',     label: 'أخرى' },
]

const delta = computed(() => newValue.value - props.currentStock)
const canConfirm = computed(() =>
  Number.isFinite(newValue.value) &&
  newValue.value !== props.currentStock &&
  (reason.value !== 'other' || notes.value.trim().length > 0)
)

function step(n: number) {
  newValue.value = Math.max(0, (Number(newValue.value) || 0) + n)
  qtyDisplay.value = String(newValue.value)
}

function confirm() {
  if (!canConfirm.value || saving.value) return
  saving.value = true
  emit('confirm', { newValue: Number(newValue.value), reason: reason.value, notes: notes.value.trim() })
}
</script>

<template>
  <div class="overlay" dir="rtl" @click.self="emit('close')">
    <div class="sheet" data-testid="quick-stock-sheet">
      <div class="handle-wrap"><div class="handle" /></div>

      <div class="header">
        <div>
          <h2 class="title">تعديل الكمية</h2>
          <p class="subtitle">{{ productName }}</p>
        </div>
        <button type="button" class="close-btn" aria-label="إغلاق" @click="emit('close')">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="body">
        <p class="current">الكمية الحالية: <strong>{{ currentStock }}</strong></p>

        <!-- New quantity stepper -->
        <div class="stepper">
          <button type="button" class="step-btn" aria-label="إنقاص" @click="step(-1)">−</button>
          <input
            :value="qtyDisplay"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            class="qty-input"
            aria-label="الكمية الجديدة"
            @input="onQtyInput"
            @blur="onQtyBlur"
          />
          <button type="button" class="step-btn" aria-label="زيادة" @click="step(1)">+</button>
        </div>
        <p v-if="delta !== 0" class="delta" :class="delta > 0 ? 'delta-up' : 'delta-down'">
          {{ delta > 0 ? `+${delta}` : delta }}
        </p>

        <!-- Reason -->
        <p class="section-label">السبب</p>
        <div class="reason-chips">
          <button
            v-for="opt in reasonOptions"
            :key="opt.value"
            type="button"
            class="reason-chip"
            :class="{ 'reason-chip--active': reason === opt.value }"
            @click="reason = opt.value"
          >{{ opt.label }}</button>
        </div>

        <textarea
          v-if="reason === 'other'"
          v-model="notes"
          rows="2"
          class="notes"
          placeholder="ملاحظة (مطلوبة)"
        />

        <button
          type="button"
          class="confirm-btn"
          data-testid="quick-stock-confirm"
          :disabled="!canConfirm"
          @click="confirm"
        >حفظ الكمية</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
  font-family: 'Tajawal', system-ui, sans-serif;
}
@media (min-width: 640px) { .overlay { align-items: center; } }

.sheet {
  width: 100%; max-width: 28rem;
  border-radius: 1.25rem 1.25rem 0 0;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06)), #0D1828;
  border: 1px solid rgba(26,86,219,0.45);
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}
@media (min-width: 640px) { .sheet { border-radius: 1.25rem; } }

.handle-wrap { display: flex; justify-content: center; padding: 10px 0 4px; }
.handle { width: 2.25rem; height: 0.25rem; border-radius: 9999px; background: rgba(255,255,255,0.20); }

.header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 8px 20px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.title { font-size: 16px; font-weight: 700; color: #E8EDF5; margin: 0; }
.subtitle { font-size: 12px; color: #637285; margin-top: 2px; }

.close-btn {
  width: 2rem; height: 2rem; border-radius: 0.625rem;
  display: flex; align-items: center; justify-content: center;
  color: #637285; background: rgba(255,255,255,0.06); border: none; cursor: pointer; flex-shrink: 0;
}
.close-btn:hover { background: rgba(255,255,255,0.10); }

.body { padding: 16px 20px 20px; }

.current { font-size: 13px; color: #637285; margin: 0 0 12px; text-align: center; }
.current strong { color: #E8EDF5; }

.stepper { display: flex; align-items: center; justify-content: center; gap: 12px; }
.step-btn {
  width: 44px; height: 44px; border-radius: 0.75rem; font-size: 22px; font-weight: 600;
  color: #60A5FA; background: rgba(26,86,219,0.14); border: 1px solid rgba(26,86,219,0.30);
  cursor: pointer; line-height: 1;
}
.step-btn:active { transform: scale(0.94); }
.qty-input {
  width: 100px; height: 52px; text-align: center;
  font-size: 24px; font-weight: 800; color: #E8EDF5; font-variant-numeric: tabular-nums;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(26,86,219,0.35);
  border-radius: 0.75rem; outline: none; font-family: inherit;
}
.qty-input:focus { border-color: rgba(26,86,219,0.8); box-shadow: 0 0 0 3px rgba(26,86,219,0.2); }

.delta { text-align: center; font-size: 13px; font-weight: 700; margin: 8px 0 0; font-variant-numeric: tabular-nums; }
.delta-up { color: #22C55E; }
.delta-down { color: #F59E0B; }

.section-label {
  font-size: 0.6875rem; font-weight: 600; color: #637285;
  text-transform: uppercase; letter-spacing: 0.08em; margin: 18px 0 8px;
}
.reason-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.reason-chip {
  padding: 7px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; cursor: pointer;
  color: #94A3B8; background: rgba(26,86,219,0.10); border: 1px solid rgba(26,86,219,0.22);
  font-family: inherit;
}
.reason-chip--active { background: #1A56DB; color: #fff; border-color: #1A56DB; }

.notes {
  width: 100%; margin-top: 10px; border-radius: 0.75rem; padding: 10px 14px;
  font-size: 14px; font-family: inherit; color: #E8EDF5; resize: none;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18); outline: none;
}
.notes::placeholder { color: #3D4F6B; }
.notes:focus { border-color: rgba(26,86,219,0.8); box-shadow: 0 0 0 3px rgba(26,86,219,0.2); }

.confirm-btn {
  width: 100%; height: 48px; margin-top: 18px; border-radius: 0.75rem;
  font-size: 15px; font-weight: 800; font-family: inherit; color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3); border: none; cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
}
.confirm-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
</style>
