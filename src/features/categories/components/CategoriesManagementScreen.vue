<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useCategories } from '@/features/categories/composables/useCategories'

const router = useRouter()
const { categoriesWithSubcategories, load, createCategory, renameCategory,
        createSubcategory, renameSubcategory, deleteCategory, deleteSubcategory } = useCategories()

const newCategoryName = ref('')
const newSubcategoryName = ref<Record<string, string>>({})
const blockedMessage = ref<string | null>(null)
// Set alongside blockedMessage whenever the block is "N products use this
// category" — lets the message offer a direct link to see exactly which
// products, instead of just a count with no way to find them.
const blockedCategoryId = ref<string | null>(null)
const loadError = ref<string | null>(null)

onMounted(async () => {
  try {
    await load()
  } catch {
    // Local PowerSync read failed (e.g. shop not yet resolved) — surface it
    // instead of leaving the screen silently blank.
    loadError.value = 'تعذّر تحميل الفئات. حاول مرة أخرى.'
  }
})

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
    blockedCategoryId.value = null
  } else if (result.blockedReason === 'fallback') {
    // "غير مصنف" is the shop's protected fallback for uncategorized products (spec:
    // "غير مصنف" sanctity) — it can be renamed but never deleted while it serves that role.
    blockedMessage.value = result.productCount > 0
      ? `لا يمكن حذف فئة "غير مصنف" لأنها الفئة الاحتياطية للمنتجات غير المصنفة، و${result.productCount} منتج مصنّف تحتها حالياً.`
      : 'لا يمكن حذف فئة "غير مصنف" لأنها الفئة الاحتياطية للمنتجات غير المصنفة.'
    blockedCategoryId.value = id
  } else {
    // No bulk-reassignment UI in v1 (spec: Category management — out of scope) — point
    // the owner at the Product List's own category filter instead of promising a path
    // that doesn't exist here.
    blockedMessage.value = `لا يمكن حذف هذه الفئة، ${result.productCount} منتج مرتبط بها. أعد تصنيف هذه المنتجات من قائمة المنتجات أولاً.`
    blockedCategoryId.value = id
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
  <div class="page-root" dir="rtl">
    <AppHeader title="إدارة الفئات" show-back @back="router.back()" />

    <main class="page-main">
      <p v-if="loadError" class="error-banner" data-testid="load-error">{{ loadError }}</p>
      <div v-if="blockedMessage" class="blocked-banner">
        <p data-testid="blocked-message">{{ blockedMessage }}</p>
        <button
          v-if="blockedCategoryId"
          type="button"
          class="blocked-banner-link"
          data-testid="blocked-view-products"
          @click="router.push(`/products?category=${blockedCategoryId}`)"
        >
          عرض هذه المنتجات
        </button>
      </div>

      <div class="new-category-row">
        <input
          v-model="newCategoryName"
          data-testid="new-category-input"
          class="text-input"
          placeholder="اسم فئة جديدة"
          @keyup.enter="addCategory"
        />
        <button type="button" class="btn-primary" data-testid="new-category-submit" @click="addCategory">
          إضافة
        </button>
      </div>

      <p v-if="categoriesWithSubcategories.length === 0 && !loadError" class="empty-hint">
        لا توجد فئات بعد. أضف أول فئة أعلاه.
      </p>

      <div class="category-list">
        <div v-for="cat in categoriesWithSubcategories" :key="cat.id" class="category-card">
          <div class="category-row">
            <input
              :value="cat.name"
              class="text-input category-name-input"
              @change="renameCategory(cat.id, ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="btn-danger"
              :data-testid="`delete-category-${cat.id}`"
              @click="removeCategory(cat.id)"
            >
              حذف
            </button>
          </div>

          <ul class="subcategory-list">
            <li v-for="sub in cat.subcategories" :key="sub.id" class="subcategory-row">
              <input
                :value="sub.name"
                class="text-input subcategory-name-input"
                @change="renameSubcategory(sub.id, ($event.target as HTMLInputElement).value)"
              />
              <button
                type="button"
                class="btn-danger btn-danger--small"
                :data-testid="`delete-subcategory-${sub.id}`"
                @click="removeSubcategory(sub.id)"
              >
                حذف
              </button>
            </li>
          </ul>

          <div class="new-subcategory-row">
            <input
              v-model="newSubcategoryName[cat.id]"
              class="text-input"
              placeholder="فئة فرعية جديدة"
              @keyup.enter="addSubcategory(cat.id)"
            />
            <button type="button" class="btn-secondary" @click="addSubcategory(cat.id)">
              إضافة فئة فرعية
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
}

.page-main {
  flex: 1;
  padding: 1rem 1rem 6rem;
  width: 100%;
  max-width: 640px;
  margin-inline: auto;
}

.error-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.12);
  border: 1px solid rgba(220, 38, 38, 0.35);
  color: #FCA5A5;
  font-size: 0.875rem;
}

.blocked-banner {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: rgba(217, 119, 6, 0.12);
  border: 1px solid rgba(217, 119, 6, 0.35);
  color: #FCD34D;
  font-size: 0.875rem;
}

.blocked-banner p {
  margin: 0;
}

.blocked-banner-link {
  margin-top: 0.5rem;
  padding: 0;
  border: none;
  background: none;
  color: #93B4F0;
  font-size: 0.8125rem;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.blocked-banner-link:hover {
  color: #C8D5E8;
}

.empty-hint {
  color: #8A96A8;
  font-size: 0.9rem;
  text-align: center;
  padding: 2rem 1rem;
}

.new-category-row,
.new-subcategory-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.text-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding-inline: 0.9rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #0D1828;
  color: #E8EDF5;
  font-family: inherit;
  font-size: 0.9rem;
}

.text-input:focus {
  outline: none;
  border-color: #1A56DB;
}

.btn-primary {
  padding-inline: 1.1rem;
  height: 44px;
  border-radius: 10px;
  border: none;
  background: #1A56DB;
  color: #fff;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  white-space: nowrap;
}

.btn-primary:hover {
  background: #1747B8;
}

.btn-secondary {
  padding-inline: 1rem;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #C8D5E8;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.08);
}

.btn-danger {
  padding-inline: 1rem;
  height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(220, 38, 38, 0.35);
  background: rgba(220, 38, 38, 0.1);
  color: #FCA5A5;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}

.btn-danger:hover {
  background: rgba(220, 38, 38, 0.18);
}

.btn-danger--small {
  height: 36px;
  padding-inline: 0.75rem;
  font-size: 0.8rem;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.category-card {
  padding: 1rem;
  border-radius: 14px;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.category-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.category-name-input {
  font-weight: 700;
}

.subcategory-list {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.subcategory-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding-inline-start: 1rem;
  border-inline-start: 2px solid rgba(26, 86, 219, 0.35);
}

.subcategory-name-input {
  height: 38px;
  font-size: 0.85rem;
}

.new-subcategory-row {
  margin-top: 0.75rem;
  margin-bottom: 0;
}
</style>
