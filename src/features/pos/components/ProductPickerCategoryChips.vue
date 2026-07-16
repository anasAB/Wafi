<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useCategories } from '@/features/categories/composables/useCategories'

const emit = defineEmits<{ (e: 'select', categoryId: string | null, subcategoryId: string | null): void }>()

const { categoriesWithSubcategories, load } = useCategories()
const activeCategoryId = ref<string | null>(null)

onMounted(load)

const activeSubcategories = computed(() =>
  categoriesWithSubcategories.value.find(c => c.id === activeCategoryId.value)?.subcategories ?? []
)

function chooseCategory(id: string | null) {
  activeCategoryId.value = id
  emit('select', id, null)
}

function chooseSubcategory(id: string | null) {
  emit('select', activeCategoryId.value, id)
}
</script>

<template>
  <div dir="rtl" class="category-chips">
    <button
      data-testid="category-chip-all"
      :class="{ active: activeCategoryId === null }"
      @click="chooseCategory(null)"
    >الكل</button>
    <button
      v-for="cat in categoriesWithSubcategories"
      :key="cat.id"
      :data-testid="`category-chip-${cat.id}`"
      :class="{ active: activeCategoryId === cat.id }"
      @click="chooseCategory(cat.id)"
    >{{ cat.name }}</button>

    <div v-if="activeSubcategories.length" class="subcategory-chips">
      <button
        v-for="sub in activeSubcategories"
        :key="sub.id"
        :data-testid="`subcategory-chip-${sub.id}`"
        @click="chooseSubcategory(sub.id)"
      >{{ sub.name }}</button>
    </div>
  </div>
</template>

<style scoped>
.category-chips { display: flex; gap: 8px; overflow-x: auto; }
.category-chips button.active { font-weight: 700; }
.subcategory-chips { display: flex; gap: 6px; overflow-x: auto; margin-top: 6px; }
</style>
