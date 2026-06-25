<!-- Record an in-shift cash movement (pay-in / pay-out / drop). Presentational:
     holds NO DB logic — the parent calls useCashMovements().record() on @record. -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { categoriesForDirection } from '../cashMovement.types'
import type {
  CashMovementDirection, CashMovementCategory, CashCurrency,
} from '../cashMovement.types'

const props = defineProps<{ liveDrawerUsd: number; liveDrawerSyp: number }>()
const emit  = defineEmits<{
  (e: 'record', v: {
    direction: CashMovementDirection; category: CashMovementCategory
    currency: CashCurrency; amount: number; note: string | null
  }): void
  (e: 'close'): void
}>()

const direction = ref<CashMovementDirection>('out')
const currency  = ref<CashCurrency>('USD')
const category  = ref<CashMovementCategory | null>(null)
const amountStr = ref('')
const note      = ref('')

const categories = computed(() => categoriesForDirection(direction.value))

function selectDirection(d: CashMovementDirection) {
  direction.value = d
  category.value = null   // categories are direction-specific; reset on switch
}

const amount = computed(() => Number(amountStr.value))
const amountValid = computed(() => {
  if (!(amount.value > 0)) return false
  if (currency.value === 'SYP' && !Number.isInteger(amount.value)) return false
  return true
})
const drawerForCurrency = computed(() =>
  currency.value === 'USD' ? props.liveDrawerUsd : props.liveDrawerSyp)
// Overdraw is only meaningful for outflows (you can't take out more than the
// drawer holds). The physical drawer is the source of truth, so we warn but allow.
const isOverdraw = computed(() =>
  direction.value === 'out' && amountValid.value && amount.value > drawerForCurrency.value)

const canConfirm = computed(() => amountValid.value && category.value !== null)

function confirm() {
  if (!canConfirm.value || category.value === null) return
  emit('record', {
    direction: direction.value, category: category.value,
    currency: currency.value, amount: amount.value,
    note: note.value.trim() ? note.value.trim() : null,
  })
}
</script>

<template>
  <div class="cash-movement-sheet" dir="rtl">
    <header class="sheet-header">حركة نقدية</header>

    <div class="dir-toggle seg">
      <button data-test="dir-out" :class="{ active: direction === 'out' }" @click="selectDirection('out')">صرف من الصندوق</button>
      <button data-test="dir-in"  :class="{ active: direction === 'in'  }" @click="selectDirection('in')">إيداع في الصندوق</button>
    </div>

    <div class="categories">
      <button
        v-for="c in categories" :key="c.key"
        :data-test="`cat-${c.key}`"
        class="chip"
        :class="{ active: category === c.key }"
        @click="category = c.key"
      >{{ c.labelAr }}</button>
    </div>

    <div class="currency-toggle seg">
      <button data-test="cur-USD" :class="{ active: currency === 'USD' }" @click="currency = 'USD'">دولار</button>
      <button data-test="cur-SYP" :class="{ active: currency === 'SYP' }" @click="currency = 'SYP'">ليرة</button>
    </div>

    <input
      data-test="amount" v-model="amountStr" type="number" inputmode="decimal"
      class="amount-input"
      :step="currency === 'SYP' ? '1' : 'any'" min="0" placeholder="المبلغ"
    />

    <p v-if="isOverdraw" data-test="overdraw-warning" class="warn">
      أكثر مما يظهر في الصندوق ({{ drawerForCurrency }}) — تأكد من العدّ
    </p>

    <textarea v-model="note" data-test="note" class="note-input" placeholder="ملاحظة (اختياري)"></textarea>

    <footer class="sheet-footer">
      <button data-test="cancel" class="btn-ghost" @click="emit('close')">إلغاء</button>
      <button data-test="confirm" class="btn-primary" :disabled="!canConfirm" @click="confirm">تأكيد</button>
    </footer>
  </div>
</template>

<style scoped>
.cash-movement-sheet {
  background: #0D1828;
  color: #E5E7EB;
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sheet-header { font-size: 1.1rem; font-weight: 700; }
.seg { display: flex; gap: 8px; }
.seg button {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  cursor: pointer;
}
.seg button.active { background: #1A56DB; border-color: #1A56DB; color: #fff; }
.categories { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  cursor: pointer;
}
.chip.active { background: #1A56DB; border-color: #1A56DB; color: #fff; }
.amount-input, .note-input {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font-size: 1.1rem;
}
.note-input { min-height: 56px; resize: vertical; font-size: 0.95rem; }
.warn { color: #FBBF24; font-size: 0.9rem; margin: 0; }
.sheet-footer { display: flex; gap: 10px; justify-content: flex-end; }
.btn-ghost, .btn-primary { padding: 10px 20px; border-radius: 10px; cursor: pointer; border: none; }
.btn-ghost { background: rgba(255, 255, 255, 0.06); color: inherit; }
.btn-primary { background: #1A56DB; color: #fff; }
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
