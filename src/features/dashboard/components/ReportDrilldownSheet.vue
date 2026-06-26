<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { BucketBreakdownTotals, BucketExpenseEntry } from '../composables/useBucketBreakdown'

defineProps<{
  title: string
  totals: BucketBreakdownTotals
  expenses: BucketExpenseEntry[]
  loading?: boolean
}>()

const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()
</script>

<template>
  <div class="drilldown-backdrop" @click.self="emit('close')">
    <section class="drilldown-sheet" dir="rtl">
      <header class="drilldown-header">
        <h3 class="drilldown-title">{{ title }}</h3>
        <button type="button" class="drilldown-close" data-test="drilldown-close" @click="emit('close')">{{ t('reports.close') }}</button>
      </header>

      <div v-if="loading" class="drilldown-loading">{{ t('reports.loading') }}</div>

      <template v-else>
        <ul class="drilldown-breakdown">
          <li><span>{{ t('reports.gross') }}</span><span dir="ltr">${{ totals.grossIncomeUsd.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.returns') }}</span><span dir="ltr">${{ totals.refundsUsd.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.cogs') }}</span><span dir="ltr">${{ totals.cogsUsd.toFixed(2) }}</span></li>
          <li><span>− {{ t('reports.expenses') }}</span><span dir="ltr">${{ totals.expensesUsd.toFixed(2) }}</span></li>
          <li class="total"><span>= {{ t('reports.profit') }}</span><span dir="ltr">${{ totals.profitUsd.toFixed(2) }}</span></li>
        </ul>

        <div v-if="expenses.length === 0" class="drilldown-empty">{{ t('reports.noExpensesInBucket') }}</div>

        <ul v-else class="drilldown-expenses">
          <li v-for="item in expenses" :key="item.id" class="expense-row">
            <div class="expense-main">
              <p class="expense-line">{{ item.expenseDate }} · {{ item.notes || item.category }}</p>
              <p class="expense-amount" dir="ltr">${{ item.amountUsd.toFixed(2) }}</p>
            </div>
            <img v-if="item.photoUrl" :src="item.photoUrl" :alt="item.category" class="expense-photo" />
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.drilldown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(2, 6, 13, 0.62);
  display: flex;
  align-items: flex-end;
}

.drilldown-sheet {
  width: 100%;
  max-height: 84vh;
  overflow: auto;
  border-radius: 1rem 1rem 0 0;
  padding: 1rem;
  background: linear-gradient(180deg, rgba(13,24,40,0.98), rgba(7,11,20,0.98));
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-bottom: none;
  color: #E8EDF5;
}

.drilldown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.drilldown-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
}

.drilldown-close {
  height: 2rem;
  padding: 0 0.7rem;
  border-radius: 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  color: #C8D5E8;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
}

.drilldown-loading,
.drilldown-empty {
  padding: 0.8rem;
  border-radius: 0.7rem;
  background: rgba(26, 86, 219, 0.10);
  border: 1px solid rgba(26, 86, 219, 0.24);
  font-size: 0.83rem;
}

.drilldown-breakdown {
  list-style: none;
  margin: 0 0 0.8rem;
  padding: 0.45rem 0.7rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(26, 86, 219, 0.24);
  background: rgba(26, 86, 219, 0.08);
}

.drilldown-breakdown li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.4rem 0;
  font-size: 0.84rem;
}

.drilldown-breakdown .total {
  border-top: 1px solid rgba(255, 255, 255, 0.10);
  margin-top: 0.25rem;
  padding-top: 0.55rem;
  font-weight: 800;
}

.drilldown-expenses {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.expense-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding: 0.6rem 0.7rem;
  border-radius: 0.7rem;
  border: 1px solid rgba(26, 86, 219, 0.20);
  background: rgba(26, 86, 219, 0.07);
}

.expense-main {
  min-width: 0;
  flex: 1;
}

.expense-line,
.expense-amount {
  margin: 0;
}

.expense-line {
  font-size: 0.8rem;
  color: #C8D5E8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.expense-amount {
  margin-top: 0.2rem;
  font-size: 0.83rem;
  font-weight: 700;
  color: #93C5FD;
}

.expense-photo {
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 0.5rem;
  object-fit: cover;
  border: 1px solid rgba(26, 86, 219, 0.28);
}
</style>
