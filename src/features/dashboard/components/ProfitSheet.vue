<script setup lang="ts">
import { computed } from 'vue'
import type { Period } from '@/features/dashboard/composables/periodUtils'

const props = defineProps<{
  revenueUsd:  number
  cogsUsd:     number
  expensesUsd: number
  profitUsd:   number
  period:      Period
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const grossProfit = computed(() => props.revenueUsd - props.cogsUsd)

const periodLabel: Record<Period, string> = {
  today: 'اليوم',
  week:  'الأسبوع',
  month: 'الشهر',
}

const showCogsWarning = computed(() => props.cogsUsd === 0 && props.revenueUsd > 0)

function fmt(n: number, sign = false): string {
  const abs = Math.abs(n).toFixed(2)
  if (sign && n > 0) return `+$${abs}`
  if (n < 0)         return `−$${abs}`
  return `$${abs}`
}
</script>

<template>
  <!-- Backdrop -->
  <div
    class="backdrop"
    dir="rtl"
    data-testid="profit-backdrop"
    @click.self="emit('close')"
  >
    <!-- Sheet panel -->
    <div class="sheet">
      <!-- Drag handle (mobile) -->
      <div class="drag-handle sm:hidden"></div>

      <!-- Header -->
      <div class="sheet-header">
        <h2 class="sheet-title">تفصيل الربح</h2>
        <p class="sheet-subtitle">{{ periodLabel[period] }}</p>
      </div>

      <!-- Rows -->
      <div class="rows-container">
        <div class="profit-row" data-testid="row-revenue">
          <span class="row-label">إجمالي البيع</span>
          <span class="row-value positive" dir="ltr">{{ fmt(revenueUsd, true) }}</span>
        </div>

        <div class="profit-row" data-testid="row-cogs">
          <span class="row-label">تكلفة البضاعة المباعة</span>
          <span class="row-value negative" dir="ltr">
            {{ cogsUsd > 0 ? `−$${cogsUsd.toFixed(2)}` : '$0.00' }}
          </span>
        </div>

        <!-- COGS warning -->
        <div
          v-if="showCogsWarning"
          data-testid="cogs-warning"
          class="cogs-warning"
        >
          بعض المنتجات بدون سعر تكلفة — الربح الإجمالي قد يكون أعلى من الحقيقي
        </div>

        <div class="profit-row" data-testid="row-gross">
          <span class="row-label row-label--emphasis">الربح الإجمالي</span>
          <span class="row-value row-value--emphasis" dir="ltr">{{ fmt(grossProfit) }}</span>
        </div>

        <div class="profit-row" data-testid="row-expenses">
          <span class="row-label">المصاريف</span>
          <span class="row-value negative" dir="ltr">
            {{ expensesUsd > 0 ? `−$${expensesUsd.toFixed(2)}` : '$0.00' }}
          </span>
        </div>

        <div class="profit-row profit-row--net" data-testid="row-net">
          <span class="net-label">صافي الربح</span>
          <span
            class="net-value"
            :class="profitUsd > 0 ? 'positive' : profitUsd < 0 ? 'negative' : 'muted'"
            dir="ltr"
          >{{ fmt(profitUsd, true) }}</span>
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
}

.sheet-header {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.sheet-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.sheet-subtitle {
  font-size: 0.75rem;
  color: #637285;
  margin: 0.125rem 0 0;
}

.rows-container {
  padding: 0 1.25rem;
  display: flex;
  flex-direction: column;
}

.profit-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 0;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.profit-row--net {
  padding: 1rem 0;
  border-bottom: none;
}

.row-label {
  font-size: 0.875rem;
  color: #8A9BBF;
}

.row-label--emphasis {
  font-weight: 500;
  color: #C8D5E8;
}

.row-value {
  font-size: 0.875rem;
  font-weight: 600;
}

.row-value--emphasis {
  color: #C8D5E8;
}

.net-label {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
}

.net-value {
  font-size: 1.25rem;
  font-weight: 800;
}

.positive {
  color: #22C55E;
}

.negative {
  color: #EF4444;
}

.muted {
  color: #637285;
}

.cogs-warning {
  margin: 0.5rem 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  font-size: 0.75rem;
  color: #FCD34D;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.28);
}

.sheet-footer {
  padding: 1rem 1.25rem 1.25rem;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
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
