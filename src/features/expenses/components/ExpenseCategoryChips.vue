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

function select(cat: string) { emit('update:modelValue', cat) }

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
  <div class="chips-root" dir="rtl">
    <div class="chips-strip">
      <button
        v-for="cat in allCategories"
        :key="cat"
        type="button"
        :data-testid="`chip-${cat}`"
        :class="['chip', modelValue === cat ? 'chip-active' : 'chip-default']"
        @click="select(cat)"
      >{{ cat }}</button>
    </div>

    <input
      v-if="showCustomInput"
      :value="customText"
      data-testid="custom-category-input"
      type="text"
      placeholder="اسم الفئة..."
      class="custom-input"
      @input="handleCustomInput(($event.target as HTMLInputElement).value)"
      @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
      @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'"
    />
  </div>
</template>

<style scoped>
/* ── Root ──────────────────────────────────────────── */
.chips-root {
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Chip strip ────────────────────────────────────── */
.chips-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* ── Chip base ─────────────────────────────────────── */
.chip {
  display: inline-flex;
  align-items: center;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.12s, box-shadow 0.15s;
  white-space: nowrap;
}
.chip:active { transform: scale(0.95); }

/* ── Default chip ──────────────────────────────────── */
.chip-default {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #637285;
}
.chip-default:hover {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.20);
  color: #E8EDF5;
}

/* ── Active chip ───────────────────────────────────── */
.chip-active {
  background: rgba(26, 86, 219, 0.20);
  border: 1px solid rgba(26, 86, 219, 0.45);
  color: #60A5FA;
  box-shadow: 0 0 10px rgba(26, 86, 219, 0.20);
}

/* ── Custom category input ─────────────────────────── */
.custom-input {
  margin-top: 0.75rem;
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.custom-input::placeholder { color: #3D4F6B; }
.custom-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}
</style>
