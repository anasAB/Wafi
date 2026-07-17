<script setup lang="ts">
import { ref } from 'vue'
import { useCategories } from '@/features/categories/composables/useCategories'

const emit = defineEmits<{ (e: 'created', categoryId: string): void }>()

const { createCategory } = useCategories()
const name = ref('')
const errorMessage = ref<string | null>(null)

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  const result = await createCategory(trimmed)
  if (result.error === 'duplicate') {
    errorMessage.value = 'هذه الفئة موجودة بالفعل'
    return
  }
  errorMessage.value = null
  name.value = ''
  emit('created', result.id!)
}
</script>

<template>
  <div dir="rtl" class="category-quick-add">
    <input
      v-model="name"
      data-testid="quick-add-category-input"
      class="quick-add-input"
      :class="{ 'input-error': errorMessage }"
      placeholder="اسم الفئة"
      @keyup.enter="submit"
      @input="errorMessage = null"
    />
    <button type="button" data-testid="quick-add-category-submit" class="quick-add-submit" @click="submit">
      حفظ واستخدام
    </button>
    <p v-if="errorMessage" data-testid="quick-add-category-error" class="quick-add-error">
      {{ errorMessage }}
    </p>
  </div>
</template>

<style scoped>
.category-quick-add {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.quick-add-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding-inline: 0.75rem;
  border-radius: 0.625rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.07);
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.quick-add-input::placeholder {
  color: #3D4F6B;
}

.quick-add-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

.quick-add-input.input-error {
  border-color: #EF4444;
}

.quick-add-submit {
  height: 40px;
  padding-inline: 1rem;
  border-radius: 0.625rem;
  border: none;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  white-space: nowrap;
  cursor: pointer;
}

.quick-add-submit:hover {
  opacity: 0.88;
}

.quick-add-submit:active {
  transform: scale(0.98);
}

.quick-add-error {
  width: 100%;
  margin: 0;
  font-size: 0.75rem;
  color: #EF4444;
}
</style>
