<script setup lang="ts">
import type { BestSeller } from '@/features/dashboard/composables/useBestSellers'

defineProps<{ items: BestSeller[] }>()
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4" dir="rtl">
    <p class="text-sm font-semibold text-gray-900 dark:text-white mb-3">الأكثر مبيعاً</p>

    <div
      v-if="!items.length"
      class="text-center py-6 text-gray-400 text-sm"
    >لا توجد مبيعات في هذه الفترة</div>

    <div v-else class="flex flex-col gap-3">
      <div
        v-for="(item, i) in items"
        :key="i"
        class="flex items-center gap-3"
        :data-testid="`best-seller-${i}`"
      >
        <div
          class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
          :class="i === 0 ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'"
        >{{ i + 1 }}</div>

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ item.nameAr }}</p>
        </div>

        <div class="text-left shrink-0">
          <p class="text-sm font-semibold text-blue-600 dark:text-blue-400">${{ item.revenueUsd.toFixed(0) }}</p>
          <p class="text-xs text-gray-400">{{ item.unitsSold }} قطعة</p>
        </div>
      </div>
    </div>
  </div>
</template>
