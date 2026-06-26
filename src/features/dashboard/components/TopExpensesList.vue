<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ExpenseBreakdownEntry } from '../composables/useExpenseBreakdown'

defineProps<{
  entries: ExpenseBreakdownEntry[]
  selectedCategory?: string | null
}>()

const emit = defineEmits<{ (e: 'clear-filter'): void }>()
const { t } = useI18n()
</script>

<template>
  <section class="top-expenses" dir="rtl">
    <div class="top-expenses-header">
      <h3 class="top-expenses-title">{{ t('reports.topExpensesTitle') }}</h3>
      <button
        v-if="selectedCategory"
        type="button"
        class="top-expenses-clear"
        data-test="clear-expense-filter"
        @click="emit('clear-filter')"
      >
        {{ t('reports.clearFilter') }} ({{ selectedCategory }})
      </button>
    </div>

    <p v-if="entries.length === 0" class="top-expenses-empty">{{ t('reports.noExpensesInBucket') }}</p>

    <ul v-else class="top-expenses-list">
      <li v-for="entry in entries" :key="entry.id" class="top-expense-row">
        <div class="top-expense-main">
          <p class="top-expense-line">{{ entry.expenseDate }} · {{ entry.description }}</p>
          <p class="top-expense-category">{{ entry.category }}</p>
        </div>
        <p class="top-expense-amount" dir="ltr">${{ entry.amountUsd.toFixed(2) }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.top-expenses {
  border-radius: 1rem;
  border: 1px solid rgba(26, 86, 219, 0.24);
  background: rgba(26, 86, 219, 0.08);
  padding: 0.8rem;
}

.top-expenses-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  margin-bottom: 0.7rem;
}

.top-expenses-title {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 800;
  color: #E8EDF5;
}

.top-expenses-clear {
  height: 2rem;
  padding: 0 0.65rem;
  border-radius: 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  color: #93B4F0;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.75rem;
  cursor: pointer;
}

.top-expenses-empty {
  margin: 0;
  font-size: 0.8rem;
  color: #93A3B8;
}

.top-expenses-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.top-expense-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.65rem;
  border: 1px solid rgba(26, 86, 219, 0.2);
  background: rgba(255, 255, 255, 0.03);
}

.top-expense-main {
  min-width: 0;
  flex: 1;
}

.top-expense-line,
.top-expense-category,
.top-expense-amount {
  margin: 0;
}

.top-expense-line {
  font-size: 0.79rem;
  color: #C8D5E8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-expense-category {
  margin-top: 0.18rem;
  font-size: 0.72rem;
  color: #93A3B8;
}

.top-expense-amount {
  font-size: 0.8rem;
  font-weight: 700;
  color: #93C5FD;
}
</style>
