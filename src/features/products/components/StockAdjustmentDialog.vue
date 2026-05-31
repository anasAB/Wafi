<script setup lang="ts">
import { computed } from 'vue'
import type { AdjustmentReason } from '@/features/products/product.types'

const props = defineProps<{
  isOpen:       boolean
  productName:  string
  oldValue:     number
  newValue:     number
  reason:       AdjustmentReason
  notes:        string
}>()

const emit = defineEmits<{
  (e: 'update:reason', v: AdjustmentReason): void
  (e: 'update:notes',  v: string): void
  (e: 'confirm'): void
  (e: 'cancel'):  void
}>()

const reasonOptions: { value: AdjustmentReason; label: string }[] = [
  { value: 'stocktake', label: 'جرد (Stocktake)' },
  { value: 'damaged',   label: 'تالف (Damaged)' },
  { value: 'lost',      label: 'مفقود (Lost)' },
  { value: 'other',     label: 'أخرى (Other)' },
]

const canConfirm = computed(() =>
  props.reason !== 'other' || props.notes.trim().length > 0
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      dir="rtl"
      @click.self="emit('cancel')"
    >
      <div class="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-6 shadow-xl">
        <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-1">
          سبب تعديل المخزون
        </h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
          {{ productName }}: {{ oldValue }} → {{ newValue }}
        </p>

        <div class="flex flex-col gap-2 mb-5">
          <label
            v-for="opt in reasonOptions"
            :key="opt.value"
            class="flex items-center gap-3 border rounded-xl p-3 cursor-pointer transition-colors"
            :class="reason === opt.value
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700'"
          >
            <input
              type="radio"
              :value="opt.value"
              :checked="reason === opt.value"
              :data-testid="`reason-${opt.value}`"
              class="accent-blue-600"
              @change="emit('update:reason', opt.value)"
            />
            <span class="text-sm text-gray-800 dark:text-gray-200">{{ opt.label }}</span>
          </label>
        </div>

        <textarea
          v-if="reason === 'other'"
          :value="notes"
          data-testid="notes-input"
          placeholder="ملاحظات (مطلوبة)"
          rows="2"
          class="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2
                 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 mb-4
                 focus:outline-none focus:ring-2 focus:ring-blue-500"
          @input="emit('update:notes', ($event.target as HTMLTextAreaElement).value)"
        />

        <div class="flex gap-3">
          <button
            type="button"
            data-testid="confirm-btn"
            :disabled="!canConfirm"
            class="flex-1 h-11 rounded-xl text-sm font-semibold text-white bg-blue-600
                   hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="emit('confirm')"
          >تأكيد</button>
          <button
            type="button"
            data-testid="cancel-btn"
            class="h-11 px-5 rounded-xl text-sm text-gray-600 dark:text-gray-300
                   border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
