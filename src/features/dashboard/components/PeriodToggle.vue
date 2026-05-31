<script setup lang="ts">
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import type { Period } from '@/features/dashboard/composables/periodUtils'

const { period, setPeriod } = usePeriodToggle()

const options: { value: Period; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'week',  label: 'الأسبوع' },
  { value: 'month', label: 'الشهر' },
]
</script>

<template>
  <div
    class="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1"
    dir="rtl"
    role="tablist"
    aria-label="اختر الفترة الزمنية"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :data-testid="`period-${opt.value}`"
      role="tab"
      :aria-selected="period.value === opt.value"
      class="flex-1 py-2 text-sm font-medium rounded-lg transition-colors"
      :class="period.value === opt.value
        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
      @click="setPeriod(opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>
