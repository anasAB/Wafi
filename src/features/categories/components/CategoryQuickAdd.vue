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
    <input v-model="name" data-testid="quick-add-category-input" placeholder="اسم الفئة" />
    <button data-testid="quick-add-category-submit" @click="submit">حفظ واستخدام</button>
    <p v-if="errorMessage" data-testid="quick-add-category-error">{{ errorMessage }}</p>
  </div>
</template>
