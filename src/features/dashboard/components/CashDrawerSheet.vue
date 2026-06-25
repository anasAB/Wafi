<script setup lang="ts">
import type { CashMovement } from '@/features/dashboard/composables/useCashDrawer'
import CashMovementEntry from '@/features/shifts/components/CashMovementEntry.vue'

defineProps<{
  cashUsd:   number
  cashSyp:   number
  movements: CashMovement[]
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'recorded'): void }>()

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

function movementTone(m: CashMovement): 'positive' | 'negative' | 'neutral' {
  if (m.usd > 0 || m.syp > 0) return 'positive'
  if (m.usd < 0 || m.syp < 0) return 'negative'
  return 'neutral'
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
        <div>
          <h2 class="sheet-title">حركات النقد — اليوم</h2>
          <p class="sheet-subtitle">تتبّع كل عمليات الصندوق خلال اليوم</p>
        </div>
        <button type="button" class="header-close-btn" aria-label="إغلاق" @click="emit('close')">×</button>
      </div>

      <!-- Summary card -->
      <div class="summary-card">
        <p class="summary-label">الإجمالي المتوقع في الصندوق</p>
        <div class="summary-chips">
          <div class="summary-chip" dir="ltr">
            <span class="chip-k">USD</span>
            <span class="chip-v">${{ cashUsd.toFixed(2) }}</span>
          </div>
          <div class="summary-chip" dir="ltr">
            <span class="chip-k">SYP</span>
            <span class="chip-v">{{ Math.round(cashSyp).toLocaleString('en-US') }} ل.س</span>
          </div>
        </div>
      </div>

      <!-- Movements list -->
      <div class="movements-list">
        <p class="list-title">آخر الحركات</p>

        <div v-if="movements.length === 0" class="empty-state">
          لا توجد حركات نقدية اليوم
        </div>

        <div
          v-for="m in movements"
          :key="m.createdAt + m.type"
          class="movement-row"
          :class="`movement-row--${movementTone(m)}`"
        >
          <span class="movement-dot" :class="`movement-dot--${movementTone(m)}`"></span>
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

      <!-- Footer: record a new movement (only while a shift is open) + close -->
      <div class="sheet-footer">
        <CashMovementEntry variant="drawer" @recorded="emit('recorded')" />
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.sheet-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.sheet-subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: #637285;
}

.header-close-btn {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid rgba(26, 86, 219, 0.30);
  background: rgba(26, 86, 219, 0.10);
  color: #9CB3D0;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.header-close-btn:hover {
  color: #E8EDF5;
  border-color: rgba(26, 86, 219, 0.55);
  background: rgba(26, 86, 219, 0.18);
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

.summary-chips {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.summary-chip {
  border-radius: 0.72rem;
  border: 1px solid rgba(26, 86, 219, 0.24);
  background: rgba(255, 255, 255, 0.04);
  padding: 0.48rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.chip-k {
  font-size: 0.66rem;
  color: #637285;
  font-weight: 700;
}

.chip-v {
  color: #E8EDF5;
  font-size: 0.82rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.movements-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 1.25rem 0.75rem;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
  scrollbar-color: rgba(26, 86, 219, 0.45) transparent;
}

.movements-list::-webkit-scrollbar {
  width: 6px;
}

.movements-list::-webkit-scrollbar-track {
  background: transparent;
}

.movements-list::-webkit-scrollbar-thumb {
  background: rgba(26, 86, 219, 0.40);
  border-radius: 999px;
}

.list-title {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 8px 4px;
  margin: 0;
}

.empty-state {
  text-align: center;
  padding: 2.2rem 0;
  color: #3D4F6B;
  font-size: 0.875rem;
}

.movement-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.72rem 0.74rem;
  border: 1px solid rgba(26, 86, 219, 0.22);
  border-radius: 0.78rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.10), rgba(255, 255, 255, 0.03));
  margin-bottom: 0.45rem;
}

.movement-row--positive {
  border-color: rgba(34, 197, 94, 0.30);
}

.movement-row--negative {
  border-color: rgba(239, 68, 68, 0.28);
}

.movement-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  margin-top: 0.38rem;
  flex-shrink: 0;
}

.movement-dot--positive {
  background: #22C55E;
}

.movement-dot--negative {
  background: #EF4444;
}

.movement-dot--neutral {
  background: #60A5FA;
}

.movement-info {
  min-width: 0;
  flex: 1;
}

.movement-label {
  font-size: 0.875rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.movement-time {
  font-size: 0.72rem;
  color: #637285;
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
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.btn-close {
  width: 100%;
  height: 44px;
  border-radius: 0.75rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.8125rem;
  font-weight: 800;
  color: #E8EDF5;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 2px 12px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.btn-close:hover {
  border-color: rgba(26,86,219,0.45);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(255,255,255,0.06));
}
</style>
