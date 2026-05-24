<script setup lang="ts">
defineProps<{
  title:       string
  message:     string
  confirmLabel?: string
  cancelLabel?:  string
  danger?:     boolean
}>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'):  void
}>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" @keydown.esc="emit('cancel')">
    <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-right">
      <h2 id="dialog-title" class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ title }}</h2>
      <p  class="text-sm text-gray-600 dark:text-gray-300 mb-6">{{ message }}</p>
      <div class="flex gap-3 justify-end">
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="emit('cancel')"
        >{{ cancelLabel ?? 'إلغاء' }}</button>
        <button
          type="button"
          :class="['px-4 py-2 rounded-lg text-sm font-semibold text-white',
                   danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700']"
          @click="emit('confirm')"
        >{{ confirmLabel ?? 'تأكيد' }}</button>
      </div>
    </div>
  </div>
</template>
