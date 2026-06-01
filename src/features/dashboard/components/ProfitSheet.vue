<script setup lang="ts">
import { computed } from 'vue'
import type { Period } from '@/features/dashboard/composables/periodUtils'

const props = defineProps<{
  isOpen:      boolean
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

const netProfitClass = computed(() => {
  if (props.profitUsd > 0) return 'text-green-600 dark:text-green-400'
  if (props.profitUsd < 0) return 'text-red-600 dark:text-red-400'
  return 'text-gray-500 dark:text-gray-400'
})

function fmt(n: number, sign = false): string {
  const abs = Math.abs(n).toFixed(2)
  if (sign && n > 0) return `+$${abs}`
  if (n < 0)         return `−$${abs}`
  return `$${abs}`
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
    dir="rtl"
    data-testid="profit-backdrop"
    @click.self="emit('close')"
  >
    <div class="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 shadow-xl">
      <!-- Handle -->
      <div class="w-9 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-4 sm:hidden"></div>

      <h2 class="text-base font-bold text-gray-900 dark:text-white mb-1">تفصيل الربح</h2>
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-5">{{ periodLabel[period] }}</p>

      <!-- 5 rows -->
      <div class="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">

        <div class="flex justify-between items-center py-3" data-testid="row-revenue">
          <span class="text-sm text-gray-500 dark:text-gray-400">إجمالي البيع</span>
          <span class="text-sm font-semibold text-green-600 dark:text-green-400">{{ fmt(revenueUsd, true) }}</span>
        </div>

        <div class="flex justify-between items-center py-3" data-testid="row-cogs">
          <span class="text-sm text-gray-500 dark:text-gray-400">تكلفة البضاعة المباعة</span>
          <span class="text-sm font-semibold text-red-500">{{ cogsUsd > 0 ? `−$${cogsUsd.toFixed(2)}` : '$0.00' }}</span>
        </div>

        <!-- COGS warning -->
        <div
          v-if="showCogsWarning"
          data-testid="cogs-warning"
          class="py-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3"
        >
          ⚠ بعض المنتجات بدون سعر تكلفة — الربح الإجمالي قد يكون أعلى من الحقيقي
        </div>

        <div class="flex justify-between items-center py-3 font-medium" data-testid="row-gross">
          <span class="text-sm text-gray-700 dark:text-gray-300">الربح الإجمالي</span>
          <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ fmt(grossProfit) }}</span>
        </div>

        <div class="flex justify-between items-center py-3" data-testid="row-expenses">
          <span class="text-sm text-gray-500 dark:text-gray-400">المصاريف</span>
          <span class="text-sm font-semibold text-red-500">{{ expensesUsd > 0 ? `−$${expensesUsd.toFixed(2)}` : '$0.00' }}</span>
        </div>

        <div
          class="flex justify-between items-center pt-4"
          data-testid="row-net"
          :class="netProfitClass"
        >
          <span class="text-base font-bold">صافي الربح</span>
          <span class="text-xl font-extrabold">{{ fmt(profitUsd, true) }}</span>
        </div>

      </div>

      <!-- Close button -->
      <button
        type="button"
        class="mt-5 w-full h-11 rounded-xl text-sm text-gray-600 dark:text-gray-400
               border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="emit('close')"
      >إغلاق</button>
    </div>
  </div>
</template>
