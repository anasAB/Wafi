<script setup lang="ts">
import { computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'

const emit = defineEmits<{ (e: 'pay'): void }>()
const store = useSaleStore()

const totalSyp = computed(() => {
  const rate = store.lockedExchangeRate
  if (rate === null) return null
  return Math.round(store.totalUsd * rate)
})
</script>

<template>
  <div class="flex flex-col h-full bg-white dark:bg-gray-800 border-t sm:border-t-0 sm:border-r border-gray-200 dark:border-gray-700">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
      <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">الفاتورة</span>
      <span class="text-xs text-gray-400">{{ store.lines.length }} صنف</span>
    </div>

    <!-- Line items -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-if="store.lines.length === 0"
        class="flex items-center justify-center h-20 text-gray-400 text-sm"
      >
        لا توجد أصناف
      </div>

      <div
        v-for="line in store.lines"
        :key="line.productId"
        class="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700"
      >
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ line.nameAr }}</p>
          <p class="text-xs text-gray-400">${{ line.unitPriceUsd.toFixed(2) }}</p>
        </div>

        <!-- Quantity stepper -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
            @click="line.quantity - 1 < 1 ? store.removeLine(line.productId) : store.updateQuantity(line.productId, line.quantity - 1)"
          >−</button>
          <span class="text-sm font-semibold w-5 text-center">{{ line.quantity }}</span>
          <button
            type="button"
            class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
            @click="store.updateQuantity(line.productId, line.quantity + 1)"
          >+</button>
        </div>

        <span class="text-sm font-semibold text-gray-900 dark:text-white w-16 text-left">
          ${{ line.lineTotalUsd.toFixed(2) }}
        </span>
      </div>
    </div>

    <!-- Totals -->
    <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
      <div class="flex justify-between text-sm text-gray-600 dark:text-gray-300 mb-1">
        <span>المجموع (دولار)</span>
        <span class="font-bold text-gray-900 dark:text-white">${{ store.totalUsd.toFixed(2) }}</span>
      </div>
      <div v-if="totalSyp !== null" class="flex justify-between text-xs text-gray-400 mb-3">
        <span>بالليرة (السعر المقفل)</span>
        <span>{{ totalSyp.toLocaleString() }} ل.س</span>
      </div>

      <button
        type="button"
        :disabled="store.lines.length === 0"
        class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
        @click="emit('pay')"
      >
        دفع
      </button>
    </div>
  </div>
</template>
