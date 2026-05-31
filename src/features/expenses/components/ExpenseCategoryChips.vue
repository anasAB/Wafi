<script setup lang="ts">
import { ref, computed } from 'vue'
import { PREDEFINED_CATEGORIES } from '@/features/expenses/expense.types'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const STORAGE_KEY = 'wafi_custom_expense_cats'

function loadCustom(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') }
  catch { return [] }
}

const customCategories = ref<string[]>(loadCustom())

const allCategories = computed(() => [
  ...PREDEFINED_CATEGORIES,
  ...customCategories.value.filter(c => !PREDEFINED_CATEGORIES.includes(c as any)),
])

const showCustomInput = computed(() => props.modelValue === 'أخرى')
const customText = ref('')

function select(cat: string) {
  emit('update:modelValue', cat)
}

function handleCustomInput(val: string) {
  customText.value = val
  emit('update:modelValue', val)
}

function persistCustom(category: string) {
  if (PREDEFINED_CATEGORIES.includes(category as any)) return
  if (!customCategories.value.includes(category)) {
    customCategories.value = [...customCategories.value, category]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customCategories.value))
  }
}

defineExpose({ persistCustom })
</script>

<template>
  <div dir="rtl">
    <div class="flex flex-wrap gap-2">
      <button
        v-for="cat in allCategories"
        :key="cat"
        type="button"
        :data-testid="`chip-${cat}`"
        class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
        :class="modelValue === cat
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'"
        @click="select(cat)"
      >{{ cat }}</button>
    </div>

    <input
      v-if="showCustomInput"
      :value="customText"
      data-testid="custom-category-input"
      type="text"
      placeholder="اسم الفئة..."
      class="mt-2 w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2
             text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      @input="handleCustomInput(($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
