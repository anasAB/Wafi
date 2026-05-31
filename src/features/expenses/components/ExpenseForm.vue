<script setup lang="ts">
import { ref, computed } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useExpenses } from '@/features/expenses/composables/useExpenses'
import ExpenseCategoryChips from './ExpenseCategoryChips.vue'
import type { NewExpense } from '@/features/expenses/expense.types'

const emit = defineEmits<{
  (e: 'saved'):  void
  (e: 'cancel'): void
}>()

const { currentRate } = useExchangeRate()
const { save }        = useExpenses()

const amount      = ref<number | ''>('')
const currency    = ref<'USD' | 'SYP'>('USD')
const category    = ref('')
const expenseDate = ref(new Date().toISOString().slice(0, 10))
const notes       = ref('')
const saving      = ref(false)
const errors      = ref<Record<string, string>>({})

const chipsRef = ref<InstanceType<typeof ExpenseCategoryChips> | null>(null)

const usdEquivalent = computed(() => {
  if (currency.value !== 'SYP' || !currentRate.value || !amount.value) return null
  return (Number(amount.value) / currentRate.value).toFixed(2)
})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!amount.value || Number(amount.value) <= 0) e['amount']   = 'أدخل المبلغ'
  if (!category.value.trim())                     e['category'] = 'اختر فئة'
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave(addAnother = false) {
  if (!validate()) return
  saving.value = true
  try {
    const amountNum = Number(amount.value)
    const amountUsd = currency.value === 'USD'
      ? amountNum
      : currentRate.value ? amountNum / currentRate.value : amountNum

    const data: NewExpense = {
      amount:      amountNum,
      currency:    currency.value,
      amountUsd,
      category:    category.value.trim(),
      expenseDate: expenseDate.value,
      notes:       notes.value.trim() || undefined,
      paidInCash:  true,
    }

    await save(data)
    chipsRef.value?.persistCustom(data.category)

    if (addAnother) {
      amount.value   = ''
      category.value = ''
      notes.value    = ''
      errors.value   = {}
    } else {
      emit('saved')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
    dir="rtl"
    @click.self="emit('cancel')"
  >
    <div class="bg-white dark:bg-gray-900 rounded-t-2xl w-full max-w-lg p-6 shadow-xl">
      <div class="w-9 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-5"></div>
      <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-4">إضافة مصروف</h2>

        <!-- Amount -->
        <div class="mb-4">
          <div class="flex gap-2">
            <input
              v-model="amount"
              data-testid="amount-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              class="flex-1 border rounded-xl px-4 py-3 text-xl font-bold dark:bg-gray-800 dark:text-white
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
              :class="errors['amount'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
              autofocus
              @input="delete errors['amount']"
            />
            <div class="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1 shrink-0">
              <button
                type="button"
                data-testid="currency-usd"
                class="px-3 py-2 text-sm font-semibold rounded-lg transition-colors"
                :class="currency === 'USD' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
                @click="currency = 'USD'"
              >USD</button>
              <button
                type="button"
                data-testid="currency-syp"
                class="px-3 py-2 text-sm font-semibold rounded-lg transition-colors"
                :class="currency === 'SYP' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'"
                @click="currency = 'SYP'"
              >SYP</button>
            </div>
          </div>
          <p v-if="errors['amount']" data-testid="error-amount" class="text-xs text-red-500 mt-1">{{ errors['amount'] }}</p>
          <p v-if="usdEquivalent" data-testid="usd-equivalent" class="text-xs text-gray-400 mt-1">≈ ${{ usdEquivalent }}</p>
        </div>

        <!-- Category -->
        <div class="mb-4">
          <label class="block text-sm text-gray-600 dark:text-gray-400 mb-2">الفئة *</label>
          <ExpenseCategoryChips
            ref="chipsRef"
            v-model="category"
            @update:model-value="delete errors['category']"
          />
          <p v-if="errors['category']" data-testid="error-category" class="text-xs text-red-500 mt-1">{{ errors['category'] }}</p>
        </div>

        <!-- Date -->
        <div class="mb-4">
          <label class="block text-sm text-gray-600 dark:text-gray-400 mb-1">التاريخ</label>
          <input
            v-model="expenseDate"
            data-testid="expense-date"
            type="date"
            :max="new Date().toISOString().slice(0, 10)"
            class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm
                   dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <!-- Notes -->
        <div class="mb-5">
          <label class="block text-sm text-gray-600 dark:text-gray-400 mb-1">ملاحظات</label>
          <textarea
            v-model="notes"
            data-testid="notes-input"
            rows="2"
            placeholder="اختياري..."
            class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm
                   dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <!-- Buttons -->
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="save-btn"
            :disabled="saving"
            class="flex-1 h-12 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700
                   disabled:opacity-50 transition-colors"
            @click="handleSave(false)"
          >{{ saving ? '...' : 'حفظ' }}</button>

          <button
            type="button"
            data-testid="save-another-btn"
            :disabled="saving"
            class="h-12 px-4 rounded-xl text-sm text-gray-600 dark:text-gray-300
                   border border-gray-200 dark:border-gray-600"
            @click="handleSave(true)"
          >إضافة أخرى</button>

          <button
            type="button"
            data-testid="cancel-btn"
            class="h-12 px-4 rounded-xl text-sm text-gray-500 dark:text-gray-400"
            @click="emit('cancel')"
          >إلغاء</button>
      </div>
    </div>
  </div>
</template>
