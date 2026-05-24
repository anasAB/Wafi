<script setup lang="ts">
import { onMounted } from 'vue'

const props = defineProps<{ message: string; type?: 'info' | 'error' | 'success' }>()
const emit  = defineEmits<{ (e: 'dismiss'): void }>()

onMounted(() => {
  setTimeout(() => emit('dismiss'), 4000)
})

const colorClass = {
  info:    'bg-blue-600',
  error:   'bg-red-600',
  success: 'bg-green-600',
}[props.type ?? 'info']
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    :class="['fixed bottom-20 right-4 left-4 sm:left-auto sm:w-80 z-50 rounded-lg px-4 py-3 text-white text-sm shadow-lg', colorClass]"
  >
    <div class="flex items-center justify-between gap-3">
      <span>{{ message }}</span>
      <button
        class="shrink-0 opacity-70 hover:opacity-100 text-lg leading-none"
        aria-label="إغلاق"
        @click="emit('dismiss')"
      >×</button>
    </div>
  </div>
</template>
