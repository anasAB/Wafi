<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCategories } from '@/features/categories/composables/useCategories'

const { categoriesWithSubcategories, load, createCategory, renameCategory,
        createSubcategory, deleteCategory, deleteSubcategory } = useCategories()

const newCategoryName = ref('')
const newSubcategoryName = ref<Record<string, string>>({})
const blockedMessage = ref<string | null>(null)

onMounted(load)

async function addCategory() {
  const name = newCategoryName.value.trim()
  if (!name) return
  const result = await createCategory(name)
  if (result.error === 'duplicate') {
    blockedMessage.value = 'هذه الفئة موجودة بالفعل'
    return
  }
  newCategoryName.value = ''
}

async function addSubcategory(categoryId: string) {
  const name = (newSubcategoryName.value[categoryId] ?? '').trim()
  if (!name) return
  const result = await createSubcategory(categoryId, name)
  if (result.error === 'duplicate') {
    blockedMessage.value = 'هذه الفئة الفرعية موجودة بالفعل'
    return
  }
  newSubcategoryName.value[categoryId] = ''
}

async function removeCategory(id: string) {
  const result = await deleteCategory(id)
  if (result.deleted) {
    blockedMessage.value = null
  } else if (result.blockedReason === 'fallback') {
    // "غير مصنف" is the shop's protected fallback for uncategorized products (spec:
    // "غير مصنف" sanctity) — it can be renamed but never deleted while it serves that role.
    blockedMessage.value = 'لا يمكن حذف فئة "غير مصنف" لأنها الفئة الاحتياطية للمنتجات غير المصنفة.'
  } else {
    // No bulk-reassignment UI in v1 (spec: Category management — out of scope) — point
    // the owner at the Product List's own category filter instead of promising a path
    // that doesn't exist here.
    blockedMessage.value = `لا يمكن حذف هذه الفئة، ${result.productCount} منتج مرتبط بها. أعد تصنيف هذه المنتجات من قائمة المنتجات أولاً.`
  }
}

async function removeSubcategory(id: string) {
  const result = await deleteSubcategory(id)
  blockedMessage.value = result.deleted
    ? null
    : `لا يمكن حذف هذه الفئة الفرعية، ${result.productCount} منتج مرتبط بها.`
}
</script>

<template>
  <div dir="rtl" class="categories-screen">
    <h1>إدارة الفئات</h1>

    <p v-if="blockedMessage" data-testid="blocked-message">{{ blockedMessage }}</p>

    <div class="new-category-row">
      <input v-model="newCategoryName" data-testid="new-category-input" placeholder="اسم فئة جديدة" />
      <button data-testid="new-category-submit" @click="addCategory">إضافة</button>
    </div>

    <div v-for="cat in categoriesWithSubcategories" :key="cat.id" class="category-block">
      <div class="category-row">
        <input :value="cat.name" @change="renameCategory(cat.id, ($event.target as HTMLInputElement).value)" />
        <button :data-testid="`delete-category-${cat.id}`" @click="removeCategory(cat.id)">حذف</button>
      </div>

      <ul>
        <li v-for="sub in cat.subcategories" :key="sub.id">
          <input :value="sub.name" @change="renameSubcategory(sub.id, ($event.target as HTMLInputElement).value)" />
          <button :data-testid="`delete-subcategory-${sub.id}`" @click="removeSubcategory(sub.id)">حذف</button>
        </li>
      </ul>

      <div class="new-subcategory-row">
        <input v-model="newSubcategoryName[cat.id]" placeholder="فئة فرعية جديدة" />
        <button @click="addSubcategory(cat.id)">إضافة فئة فرعية</button>
      </div>
    </div>
  </div>
</template>
