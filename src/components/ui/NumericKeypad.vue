<script setup lang="ts">
const emit = defineEmits<{
  (e: 'digit',   d: string): void
  (e: 'delete'):              void
  (e: 'confirm'):             void
}>()

const keys = ['7','8','9','4','5','6','1','2','3','.',  '0', '⌫']
</script>

<template>
  <div class="grid grid-cols-3 gap-2 p-4">
    <button
      v-for="key in keys"
      :key="key"
      type="button"
      :aria-label="key === '⌫' ? 'حذف' : key"
      :class="[
        'flex items-center justify-center h-14 rounded-xl text-xl font-medium',
        'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white',
        'active:scale-95 transition-transform',
        key === '⌫' ? 'text-red-500' : '',
      ]"
      @click="key === '⌫' ? emit('delete') : emit('digit', key)"
    >{{ key }}</button>
    <button
      type="button"
      aria-label="تأكيد"
      class="col-span-3 h-12 rounded-xl bg-blue-600 text-white text-base font-semibold active:scale-95 transition-transform"
      @click="emit('confirm')"
    >تأكيد</button>
  </div>
</template>
