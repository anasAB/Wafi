<!-- List of a shift's cash movements. Presentational: emits 'void' with a movement
     id; the parent calls useCashMovements().voidMovement(). Reversed originals are
     struck through and a void row is labelled; the void button is hidden for void
     rows, already-reversed originals, and when canVoid is false. -->
<script setup lang="ts">
import { computed } from 'vue'
import { CASH_MOVEMENT_CATEGORIES } from '../cashMovement.types'
import type { CashMovement } from '../cashMovement.types'

const props = defineProps<{ movements: CashMovement[]; canVoid: boolean }>()
const emit  = defineEmits<{ (e: 'void', movementId: string): void }>()

const labelOf = (key: string) =>
  CASH_MOVEMENT_CATEGORIES.find(c => c.key === key)?.labelAr ?? key

// Ids of originals that already have a reversing void row → render struck-through,
// no further void allowed.
const voidedIds = computed(() =>
  new Set(props.movements.filter(m => m.voidsMovementId).map(m => m.voidsMovementId!)))

function isVoidRow(m: CashMovement): boolean { return m.voidsMovementId !== null }
function isVoided(m: CashMovement): boolean { return voidedIds.value.has(m.id) }
function canVoidRow(m: CashMovement): boolean {
  return props.canVoid && !isVoidRow(m) && !isVoided(m)
}
function fmt(m: CashMovement): string {
  const sign = m.direction === 'in' ? '+' : '−'
  return m.currency === 'USD'
    ? `${sign}$${m.amount.toFixed(2)}`
    : `${sign}${m.amount.toLocaleString()} ل.س`
}
</script>

<template>
  <ul class="cash-movements" dir="rtl">
    <li v-if="movements.length === 0" class="empty">لا توجد حركات نقدية</li>
    <li
      v-for="m in movements" :key="m.id"
      :data-test="`row-${m.id}`"
      class="row"
      :class="{ voided: isVoided(m), 'void-row': isVoidRow(m) }"
    >
      <span class="cat">{{ labelOf(m.category) }}<span v-if="isVoidRow(m)" class="tag"> (عكس)</span></span>
      <span class="amt" :class="m.direction">{{ fmt(m) }}</span>
      <span v-if="m.note" class="note">{{ m.note }}</span>
      <button
        v-if="canVoidRow(m)"
        :data-test="`void-${m.id}`"
        class="void-btn"
        @click="emit('void', m.id)"
      >عكس</button>
    </li>
  </ul>
</template>

<style scoped>
.cash-movements { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.empty { color: #9CA3AF; font-size: 0.9rem; padding: 8px 0; }
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}
.row.voided { opacity: 0.6; }
.row.voided .cat, .row.voided .amt { text-decoration: line-through; }
.cat { flex: 1; }
.tag { color: #9CA3AF; font-size: 0.8rem; }
.amt { font-variant-numeric: tabular-nums; font-weight: 600; }
.amt.in { color: #34D399; }
.amt.out { color: #F87171; }
.note { color: #9CA3AF; font-size: 0.85rem; }
.void-btn {
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: #E5E7EB;
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
}
</style>
