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
  <div class="fixed inset-0 z-50 flex items-center justify-center px-4" style="background: rgb(0 0 0 / 0.6)" @keydown.esc="emit('cancel')">
    <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="glass-lg w-full max-w-sm p-6 text-right" style="border-color: var(--color-border-gold)">
      <h2 id="dialog-title" class="text-base font-semibold text-text-primary mb-2">{{ title }}</h2>
      <p class="text-sm text-text-muted mb-6">{{ message }}</p>
      <div class="flex gap-3 justify-end">
        <button
          type="button"
          class="btn-ghost px-4 h-10 text-sm"
          @click="emit('cancel')"
        >{{ cancelLabel ?? 'إلغاء' }}</button>
        <button
          type="button"
          class="px-4 h-10 rounded-xl text-sm font-semibold text-white transition-colors"
          :class="danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gold-primary hover:opacity-90'"
          @click="emit('confirm')"
        >{{ confirmLabel ?? 'تأكيد' }}</button>
      </div>
    </div>
  </div>
</template>
