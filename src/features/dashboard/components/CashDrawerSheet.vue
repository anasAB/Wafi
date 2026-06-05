<script setup lang="ts">
import type { CashMovement } from '@/features/dashboard/composables/useCashDrawer'

defineProps<{
  cashUsd:   number
  cashSyp:   number
  movements: CashMovement[]
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diffMin < 1)  return 'الآن'
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`
  return `قبل ${Math.floor(diffMin / 60)} ساعة`
}

function fmtUsd(n: number): string {
  if (n === 0) return ''
  return n > 0 ? `+$${n.toFixed(2)}` : `−$${Math.abs(n).toFixed(2)}`
}

function fmtSyp(n: number): string {
  if (n === 0) return ''
  const abs = Math.round(Math.abs(n)).toLocaleString('en-US')
  return n > 0 ? `+${abs} ل.س` : `−${abs} ل.س`
}
</script>

<template>
  <!-- Backdrop -->
  <div
    class="backdrop"
    dir="rtl"
    @click.self="emit('close')"
  >
    <!-- Sheet panel -->
    <div class="sheet">
      <!-- Drag handle (mobile only) -->
      <div class="drag-handle sm:hidden"></div>

      <!-- Header -->
      <div class="sheet-header">
        <h2 class="sheet-title">حركات النقد — اليوم</h2>
      </div>

      <!-- Summary card -->
      <div class="summary-card">
        <p class="summary-label">الإجمالي المتوقع في الصندوق</p>
        <p class="summary-value" dir="ltr">
          <span v-if="cashUsd !== 0">${{ cashUsd.toFixed(2) }}</span>
          <span v-if="cashUsd !== 0 && cashSyp !== 0" class="sep">+</span>
          <span v-if="cashSyp !== 0">{{ Math.round(cashSyp).toLocaleString('en-US') }} ل.س</span>
          <span v-if="cashUsd === 0 && cashSyp === 0" class="muted">$0.00</span>
        </p>
      </div>

      <!-- Movements list -->
      <div class="movements-list">
        <div v-if="movements.length === 0" class="empty-state">
          لا توجد حركات نقدية اليوم
        </div>

        <div
          v-for="m in movements"
          :key="m.createdAt + m.type"
          class="movement-row"
        >
          <div class="movement-info">
            <p class="movement-label">{{ m.label }}</p>
            <p class="movement-time">{{ relativeTime(m.createdAt) }}</p>
          </div>
          <div class="movement-amounts">
            <p v-if="m.usd !== 0" class="amount-usd" dir="ltr"
               :class="m.usd > 0 ? 'positive' : 'negative'">
              {{ fmtUsd(m.usd) }}
            </p>
            <p v-if="m.syp !== 0" class="amount-syp" dir="ltr"
               :class="m.syp > 0 ? 'positive' : 'negative'">
              {{ fmtSyp(m.syp) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Close button -->
      <div class="sheet-footer">
        <button type="button" class="btn-close" @click="emit('close')">إغلاق</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

@media (min-width: 640px) {
  .backdrop {
    align-items: center;
  }
}

.sheet {
  font-family: 'Tajawal', system-ui, sans-serif;
  width: 100%;
  max-width: 28rem;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top-left-radius: 1.25rem;
  border-top-right-radius: 1.25rem;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.45);
  box-shadow: 0 -8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
}

@media (min-width: 640px) {
  .sheet {
    border-radius: 1.25rem;
    box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
  }
}

.drag-handle {
  width: 40px;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  margin: 12px auto 0;
  flex-shrink: 0;
}

.sheet-header {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  flex-shrink: 0;
}

.sheet-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.summary-card {
  margin: 1rem 1.25rem 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.summary-label {
  font-size: 0.75rem;
  color: #637285;
  margin: 0 0 0.375rem;
}

.summary-value {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.summary-value .sep {
  color: #637285;
}

.summary-value .muted {
  color: #637285;
}

.movements-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 1.25rem 0.5rem;
  display: flex;
  flex-direction: column;
}

.empty-state {
  text-align: center;
  padding: 2.5rem 0;
  color: #3D4F6B;
  font-size: 0.875rem;
}

.movement-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.movement-info {
  min-width: 0;
}

.movement-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #C8D5E8;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.movement-time {
  font-size: 0.75rem;
  color: #3D4F6B;
  margin: 0.125rem 0 0;
}

.movement-amounts {
  text-align: left;
  flex-shrink: 0;
  margin-inline-start: 0.75rem;
}

.amount-usd {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0;
}

.amount-syp {
  font-size: 0.75rem;
  font-weight: 500;
  margin: 0.125rem 0 0;
}

.positive {
  color: #22C55E;
}

.negative {
  color: #EF4444;
}

.sheet-footer {
  padding: 1rem 1.25rem;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
  flex-shrink: 0;
}

.btn-close {
  width: 100%;
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

.btn-close:hover {
  opacity: 0.8;
}
</style>
