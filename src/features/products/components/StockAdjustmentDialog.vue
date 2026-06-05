<script setup lang="ts">
import { computed } from 'vue'
import type { AdjustmentReason } from '@/features/products/product.types'

const props = defineProps<{
  isOpen:       boolean
  productName:  string
  oldValue:     number
  newValue:     number
  reason:       AdjustmentReason
  notes:        string
}>()

const emit = defineEmits<{
  (e: 'update:reason', v: AdjustmentReason): void
  (e: 'update:notes',  v: string): void
  (e: 'confirm'): void
  (e: 'cancel'):  void
}>()

const reasonOptions: { value: AdjustmentReason; label: string }[] = [
  { value: 'stocktake', label: 'جرد' },
  { value: 'damaged',   label: 'تالف' },
  { value: 'lost',      label: 'مفقود' },
  { value: 'other',     label: 'أخرى' },
]

const canConfirm = computed(() =>
  props.reason !== 'other' || props.notes.trim().length > 0
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="overlay"
      dir="rtl"
      @click.self="emit('cancel')"
    >
      <div class="dialog">
        <!-- Drag handle (mobile) -->
        <div class="drag-handle sm:hidden"></div>

        <!-- Header -->
        <div class="dialog-header">
          <h2 class="dialog-title">سبب تعديل المخزون</h2>
          <p class="dialog-subtitle">{{ productName }}: {{ oldValue }} → {{ newValue }}</p>
        </div>

        <!-- Reason options -->
        <div class="reason-list">
          <label
            v-for="opt in reasonOptions"
            :key="opt.value"
            class="reason-option"
            :class="reason === opt.value ? 'reason-selected' : 'reason-idle'"
          >
            <input
              type="radio"
              :value="opt.value"
              :checked="reason === opt.value"
              :data-testid="`reason-${opt.value}`"
              class="reason-radio"
              @change="emit('update:reason', opt.value)"
            />
            <span
              class="reason-label"
              :class="reason === opt.value ? 'reason-label-active' : 'reason-label-idle'"
            >{{ opt.label }}</span>
          </label>
        </div>

        <!-- Notes textarea (when reason = other) -->
        <div class="notes-wrap">
          <textarea
            v-if="reason === 'other'"
            :value="notes"
            data-testid="notes-input"
            placeholder="ملاحظات (مطلوبة)"
            rows="2"
            class="notes-input"
            @input="emit('update:notes', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <!-- Buttons -->
        <div class="dialog-footer">
          <button
            type="button"
            data-testid="confirm-btn"
            :disabled="!canConfirm"
            class="btn-confirm"
            :class="canConfirm ? 'btn-confirm-active' : 'btn-confirm-disabled'"
            @click="emit('confirm')"
          >تأكيد</button>
          <button
            type="button"
            data-testid="cancel-btn"
            class="btn-cancel"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay ─────────────────────────────────────── */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 640px) {
  .overlay {
    align-items: center;
  }
}

/* ── Dialog panel ────────────────────────────────── */
.dialog {
  width: 100%;
  max-width: 400px;
  border-radius: 1.25rem 1.25rem 0 0;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.45);
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}

@media (min-width: 640px) {
  .dialog {
    border-radius: 1.25rem;
  }
}

/* ── Drag handle ─────────────────────────────────── */
.drag-handle {
  width: 36px;
  height: 4px;
  border-radius: 9999px;
  background: rgba(255,255,255,0.15);
  margin: 12px auto 0;
}

/* ── Header ──────────────────────────────────────── */
.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(26,86,219,0.14);
}

.dialog-title {
  font-size: 15px;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.dialog-subtitle {
  font-size: 13px;
  color: #637285;
  margin: 4px 0 0 0;
}

/* ── Reason options ──────────────────────────────── */
.reason-list {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reason-option {
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 0.75rem;
  padding: 12px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.reason-selected {
  border: 1px solid rgba(26,86,219,0.50);
  background: rgba(26,86,219,0.12);
}

.reason-idle {
  border: 1px solid rgba(255,255,255,0.07);
  background: transparent;
}

.reason-idle:hover {
  background: rgba(26,86,219,0.06);
  border-color: rgba(26,86,219,0.25);
}

.reason-radio {
  accent-color: #1A56DB;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.reason-label {
  font-size: 14px;
  font-weight: 600;
}

.reason-label-active {
  color: #60A5FA;
}

.reason-label-idle {
  color: #C8D5E8;
}

/* ── Notes ───────────────────────────────────────── */
.notes-wrap {
  padding: 0 20px 4px;
}

.notes-input {
  width: 100%;
  border-radius: 0.75rem;
  padding: 10px 14px;
  font-size: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  outline: none;
  resize: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.notes-input::placeholder {
  color: #3D4F6B;
}

.notes-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

/* ── Footer buttons ──────────────────────────────── */
.dialog-footer {
  padding: 16px 20px;
  display: flex;
  gap: 12px;
}

.btn-confirm {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-confirm-active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
}

.btn-confirm-active:hover {
  opacity: 0.88;
}

.btn-confirm-disabled {
  background: #3D4F6B;
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-cancel {
  height: 44px;
  padding: 0 20px;
  border-radius: 0.75rem;
  font-size: 14px;
  font-weight: 500;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #637285;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.18);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.btn-cancel:hover {
  color: #E8EDF5;
  border-color: rgba(255,255,255,0.30);
}
</style>
