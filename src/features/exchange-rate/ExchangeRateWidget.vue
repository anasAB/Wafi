<script setup lang="ts">
import { onMounted } from 'vue'
import { useExchangeRate } from './useExchangeRate'

const emit = defineEmits<{ (e: 'open-editor'): void }>()
const { currentRate, loadRate } = useExchangeRate()

onMounted(loadRate)
</script>

<template>
  <button
    type="button"
    :class="[
      'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
      currentRate
        ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600'
        : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200 animate-pulse',
    ]"
    :aria-label="currentRate ? `سعر الصرف: ${currentRate.toLocaleString()} ل.س` : 'سعر الصرف غير محدد — انقر للإضافة'"
    @click="emit('open-editor')"
  >
    <span v-if="currentRate">{{ currentRate.toLocaleString() }} ل.س</span>
    <span v-else class="flex items-center gap-1">
      <span class="text-yellow-600" aria-hidden="true">⚠</span> حدد السعر
    </span>
    <span class="text-gray-400 dark:text-gray-500 text-xs" aria-hidden="true">✎</span>
  </button>
</template>
