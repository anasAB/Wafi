<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
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
const assigningCategoryId = ref<string | null>(null)
const productPickerOpen = ref(false)
const productSearchQuery = ref('')
const assignableProducts = ref<Array<{ id: string; nameAr: string; categoryId: string | null }>>([])
const selectedProductIds = ref<Set<string>>(new Set())
const assigningProducts = ref(false)

const device = useDeviceStore()

const activeCategory = computed(() =>
  categoriesWithSubcategories.value.find((category) => category.id === assigningCategoryId.value) ?? null
)

const filteredAssignableProducts = computed(() => {
  const query = productSearchQuery.value.trim().toLowerCase()
  const scoped = assigningCategoryId.value
    ? assignableProducts.value.filter((product) => product.categoryId !== assigningCategoryId.value)
    : assignableProducts.value
  if (!query) return scoped
  return scoped.filter((product) => product.nameAr.toLowerCase().includes(query))
})

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

async function openProductPicker(categoryId: string) {
  assigningCategoryId.value = categoryId
  productSearchQuery.value = ''
  selectedProductIds.value = new Set()
  productPickerOpen.value = true
  const products = await db.getAll<{ id: string; name_ar: string; category_id: string | null }>(
    `SELECT id, name_ar, category_id
     FROM products
     WHERE shop_id = ?
       AND is_active = 1
       AND (deleted = 0 OR deleted IS NULL)
     ORDER BY name_ar`,
    [device.shopId]
  )
  assignableProducts.value = products.map((product) => ({
    id: product.id,
    nameAr: product.name_ar,
    categoryId: product.category_id ?? null,
  }))
}

function closeProductPicker() {
  productPickerOpen.value = false
  assigningCategoryId.value = null
  productSearchQuery.value = ''
  selectedProductIds.value = new Set()
}

function toggleProductSelection(productId: string) {
  const next = new Set(selectedProductIds.value)
  if (next.has(productId)) next.delete(productId)
  else next.add(productId)
  selectedProductIds.value = next
}

async function assignProductsToCategory() {
  if (!assigningCategoryId.value || selectedProductIds.value.size === 0 || assigningProducts.value) return
  assigningProducts.value = true
  const now = new Date().toISOString()
  try {
    for (const productId of selectedProductIds.value) {
      await db.execute(
        `UPDATE products
         SET category_id = ?, subcategory_id = NULL, updated_at = ?, sync_status = 'pending'
         WHERE id = ? AND shop_id = ?`,
        [assigningCategoryId.value, now, productId, device.shopId]
      )
    }
    blockedMessage.value = null
    blockedCategoryId.value = null
    closeProductPicker()
  } finally {
    assigningProducts.value = false
  }
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
            <button
              type="button"
              class="btn-secondary"
              :data-testid="`open-product-picker-${cat.id}`"
              @click="openProductPicker(cat.id)"
            >
              + إضافة منتج
            </button>
          </div>
        </div>
      </div>

      <div v-if="productPickerOpen" class="picker-backdrop" @click.self="closeProductPicker">
        <div class="picker-sheet" role="dialog" aria-modal="true" aria-label="اختيار منتجات">
          <div class="picker-handle" />

          <div class="picker-header">
            <div class="picker-header-text">
              <h3 class="picker-title">اختيار منتجات</h3>
              <p class="picker-subtitle">الفئة: {{ activeCategory?.name ?? '' }}</p>
            </div>
            <button type="button" class="picker-close" aria-label="إغلاق" @click="closeProductPicker">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="picker-search-wrap">
            <svg class="picker-search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              v-model="productSearchQuery"
              class="picker-search-input"
              placeholder="ابحث عن منتج..."
            />
          </div>

          <p v-if="filteredAssignableProducts.length === 0" class="picker-empty">
            لا توجد منتجات متاحة للإضافة.
          </p>

          <ul v-else class="picker-list">
            <li
              v-for="product in filteredAssignableProducts"
              :key="product.id"
              class="picker-item"
            >
              <label class="picker-item-label">
                <input
                  type="checkbox"
                  :checked="selectedProductIds.has(product.id)"
                  :data-testid="`product-picker-item-${product.id}`"
                  @change="toggleProductSelection(product.id)"
                />
                <span>{{ product.nameAr }}</span>
              </label>
            </li>
          </ul>

          <div class="picker-actions">
            <button type="button" class="btn-secondary" @click="closeProductPicker">إلغاء</button>
            <button
              type="button"
              class="btn-primary"
              data-testid="assign-selected-products"
              :disabled="selectedProductIds.size === 0 || assigningProducts"
              @click="assignProductsToCategory"
            >
              إسناد {{ selectedProductIds.size }} منتج
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

.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
}

@media (min-width: 640px) {
  .picker-backdrop {
    align-items: center;
    justify-content: center;
  }
}

.picker-sheet {
  width: calc(100% - 16px);
  max-width: 32rem;
  margin: 0 8px calc(8px + env(safe-area-inset-bottom));
  max-height: 84dvh;
  backdrop-filter: blur(24px) saturate(180%);
  background: linear-gradient(180deg, rgba(26, 86, 219, 0.22) 0%, rgba(7, 11, 20, 0.98) 72px);
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-bottom: none;
  border-radius: 1.25rem 1.25rem 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 -8px 48px rgba(0, 0, 0, 0.55), 0 0 40px rgba(26, 86, 219, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

@media (min-width: 640px) {
  .picker-sheet {
    width: 100%;
    margin: 0;
    border-radius: 1.25rem;
    border-bottom: 1px solid rgba(26, 86, 219, 0.28);
  }
}

.picker-handle {
  width: 2.25rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.20);
  margin: 0.75rem auto 0.35rem;
  flex-shrink: 0;
}

@media (min-width: 640px) {
  .picker-handle {
    display: none;
  }
}

.picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.85rem;
  padding: 0.75rem 1rem 0.6rem;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.picker-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.picker-title {
  margin: 0;
  font-size: 1rem;
  line-height: 1.2;
  font-weight: 700;
  color: #E8EDF5;
}

.picker-subtitle {
  margin: 0;
  font-size: 0.78rem;
  color: #8FA1BC;
}

.picker-close {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  cursor: pointer;
  transition: background 0.12s;
}

.picker-close:hover {
  background: rgba(255, 255, 255, 0.10);
}

.picker-search-wrap {
  position: relative;
  margin: 0.75rem 1rem;
}

.picker-search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0.9rem;
  margin: auto;
  width: 1rem;
  height: 1rem;
  color: #637285;
  pointer-events: none;
}

.picker-search-input {
  width: 100%;
  height: 44px;
  border-radius: 0.75rem;
  padding: 0.625rem 2.5rem 0.625rem 0.875rem;
  color: #E8EDF5;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  font-size: 0.875rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.picker-search-input::placeholder {
  color: #3D4F6B;
}

.picker-search-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

.picker-empty {
  margin: 0 1rem;
  padding: 1rem 0.5rem;
  text-align: center;
  color: #8A96A8;
  font-size: 0.88rem;
}

.picker-list {
  list-style: none;
  margin: 0 1rem;
  padding: 0;
  overflow: auto;
  border: 1px solid rgba(26, 86, 219, 0.18);
  border-radius: 10px;
  background: rgba(8, 16, 29, 0.6);
}

.picker-item {
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.picker-item:last-child {
  border-bottom: none;
}

.picker-item-label {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.75rem;
  color: #E8EDF5;
  font-size: 0.9rem;
  cursor: pointer;
}

.picker-item-label input[type='checkbox'] {
  width: 1rem;
  height: 1rem;
  accent-color: #1A56DB;
}

.picker-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.8rem;
  padding: 0 1rem 1rem;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
  padding-top: 0.8rem;
}

.picker-actions .btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
