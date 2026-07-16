<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import Paginator from 'primevue/paginator'
import ProductAvatar from '@/components/ui/ProductAvatar.vue'
import { matchesArabicQuery } from '@/shared/text/arabic'
import { useCategories } from '@/features/categories/composables/useCategories'
import type { Product } from '@/features/pos/pos.types'

const props = defineProps<{
  products:           Product[]
  filterLowStock?:    boolean
  filterMissingCost?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit',   id: string): void
  (e: 'delete', id: string): void
  (e: 'adjust-stock', id: string): void
}>()

const search    = ref('')
const openKebab = ref<string | null>(null)
const isCategoryMenuOpen = ref(false)
const categoryMenuRef = ref<HTMLElement | null>(null)
const isSubcategoryMenuOpen = ref(false)
const subcategoryMenuRef = ref<HTMLElement | null>(null)

// ── Category filter (#9) — real categories table, not derived from products ──
const { categoriesWithSubcategories, load: loadCategories } = useCategories()

const selectedCategoryId    = ref<string | null>(null)   // null = all categories
const selectedSubcategoryId = ref<string | null>(null)    // null = all subcategories in the selected category

const categoryOptions = computed(() => [
  { label: 'كل الفئات', value: null },
  ...categoriesWithSubcategories.value.map(c => ({ label: c.name, value: c.id })),
])
const selectedCategoryLabel = computed(() => {
  if (!selectedCategoryId.value) return 'كل الفئات'
  return categoriesWithSubcategories.value.find(c => c.id === selectedCategoryId.value)?.name ?? 'كل الفئات'
})
const subcategoryOptions = computed(() => {
  const cat = categoriesWithSubcategories.value.find(c => c.id === selectedCategoryId.value)
  if (!cat) return []
  return [{ label: 'كل الفئات الفرعية', value: null }, ...cat.subcategories.map(s => ({ label: s.name, value: s.id }))]
})
const selectedSubcategoryLabel = computed(() => {
  if (!selectedSubcategoryId.value) return 'كل الفئات الفرعية'
  return subcategoryOptions.value.find(s => s.value === selectedSubcategoryId.value)?.label ?? 'كل الفئات الفرعية'
})

// ── Column sorting (#9) ──
type SortKey = 'nameAr' | 'category' | 'costPriceUsd' | 'salePriceUsd' | 'currentStock'
const sortKey = ref<SortKey | null>(null)            // null = original order
const sortDir = ref<'asc' | 'desc'>('asc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

const displayed = computed(() => {
  let list = props.filterLowStock
    ? props.products.filter(p => p.currentStock <= p.lowStockThreshold)
    : props.products

  // WAFI-054: tap-through target from the dashboard profit caveat — show only the
  // products with no cost price so the owner can fix the source of the estimate.
  if (props.filterMissingCost) {
    list = list.filter(p => !p.costPriceUsd || p.costPriceUsd <= 0)
  }

  if (selectedCategoryId.value) {
    list = list.filter(p => p.categoryId === selectedCategoryId.value)
  }
  if (selectedSubcategoryId.value) {
    list = list.filter(p => p.subcategoryId === selectedSubcategoryId.value)
  }

  if (search.value.trim()) {
    // Search across every product field, folded for Arabic (WAFI-018) so a query
    // without harakat / with alef variants still matches.
    list = list.filter(p => matchesArabicQuery(
      [p.nameAr, p.nameEn, p.barcode, categoryNameFor(p),
       p.costPriceUsd, p.salePriceUsd, p.currentStock].join(' '),
      search.value,
    ))
  }

  if (sortKey.value) {
    const key = sortKey.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    // Copy before sorting so we never mutate the incoming products prop.
    list = [...list].sort((a, b) => {
      // 'category' sorts by the resolved real-category name, not the (now
      // unwritten) free-text column — see categoryNameFor below.
      const av = key === 'category' ? categoryNameFor(a) : a[key]
      const bv = key === 'category' ? categoryNameFor(b) : b[key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av ?? '').localeCompare(String(bv ?? ''), 'ar') * dir
    })
  }

  return list
})

// ── Pagination (default 10/page) ──
const first = ref(0)
const rows  = ref(10)
const paginated = computed(() => displayed.value.slice(first.value, first.value + rows.value))

function onPage(e: { first: number; rows: number }) {
  first.value = e.first
  rows.value  = e.rows
}

// Jump back to the first page whenever the result set changes (filter, search,
// category, or a product removed), so we never land on an empty page.
watch(
  () => [search.value, selectedCategoryId.value, selectedSubcategoryId.value, props.filterLowStock, props.filterMissingCost, displayed.value.length],
  () => { if (first.value >= displayed.value.length) first.value = 0 },
)
watch([search, selectedCategoryId, selectedSubcategoryId], () => { first.value = 0 })
watch(categoriesWithSubcategories, (next) => {
  if (selectedCategoryId.value && !next.some(c => c.id === selectedCategoryId.value)) {
    selectedCategoryId.value = null
    selectedSubcategoryId.value = null
  }
})

function chooseCategory(categoryId: string | null) {
  selectedCategoryId.value = categoryId
  selectedSubcategoryId.value = null
  isCategoryMenuOpen.value = false
}

function chooseSubcategory(subcategoryId: string | null) {
  selectedSubcategoryId.value = subcategoryId
  isSubcategoryMenuOpen.value = false
}

function toggleCategoryMenu() {
  isCategoryMenuOpen.value = !isCategoryMenuOpen.value
}

function toggleSubcategoryMenu() {
  isSubcategoryMenuOpen.value = !isSubcategoryMenuOpen.value
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (!categoryMenuRef.value?.contains(target)) {
    isCategoryMenuOpen.value = false
  }
  if (!subcategoryMenuRef.value?.contains(target)) {
    isSubcategoryMenuOpen.value = false
  }
}

onMounted(() => {
  loadCategories()
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

function isLowStock(p: Product): boolean {
  return p.currentStock <= p.lowStockThreshold
}

function categoryNameFor(p: Product): string {
  return categoriesWithSubcategories.value.find(c => c.id === p.categoryId)?.name ?? ''
}

function toggleKebab(id: string) {
  openKebab.value = openKebab.value === id ? null : id
}

function closeKebab() {
  openKebab.value = null
}

function handleEdit(id: string) {
  closeKebab()
  emit('edit', id)
}

function handleDelete(id: string) {
  closeKebab()
  emit('delete', id)
}

function handleAdjustStock(id: string) {
  closeKebab()
  emit('adjust-stock', id)
}
</script>

<template>
  <div class="list-root" dir="rtl">

    <!-- Search + scan toolbar -->
    <div class="toolbar">
      <div class="search-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" class="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          v-model="search"
          data-testid="search"
          dir="rtl"
          type="text"
          placeholder="بحث بالاسم، الباركود، الفئة، السعر..."
          class="search-input"
          @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
          @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'"
        />
      </div>

      <div v-if="categoriesWithSubcategories.length" ref="categoryMenuRef" class="search-filter-wrap">
        <button
          type="button"
          data-testid="category-filter-btn"
          class="search-filter-btn"
          :aria-expanded="isCategoryMenuOpen"
          aria-haspopup="listbox"
          @click="toggleCategoryMenu"
        >
          <span class="search-filter-text">{{ selectedCategoryLabel }}</span>
          <svg
            class="search-filter-chevron"
            :class="{ 'search-filter-chevron-open': isCategoryMenuOpen }"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div v-if="isCategoryMenuOpen" class="search-filter-menu" role="listbox" aria-label="تصفية حسب الفئة">
          <button
            v-for="option in categoryOptions"
            :key="option.label"
            type="button"
            :data-testid="`category-option-${option.value ?? 'all'}`"
            class="search-filter-item"
            :class="{ 'search-filter-item-active': selectedCategoryId === option.value }"
            @click="chooseCategory(option.value)"
          >{{ option.label }}</button>
        </div>
      </div>

      <div v-if="subcategoryOptions.length > 1" ref="subcategoryMenuRef" class="search-filter-wrap">
        <button
          type="button"
          data-testid="subcategory-filter-btn"
          class="search-filter-btn"
          :aria-expanded="isSubcategoryMenuOpen"
          aria-haspopup="listbox"
          @click="toggleSubcategoryMenu"
        >
          <span class="search-filter-text">{{ selectedSubcategoryLabel }}</span>
          <svg
            class="search-filter-chevron"
            :class="{ 'search-filter-chevron-open': isSubcategoryMenuOpen }"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div v-if="isSubcategoryMenuOpen" class="search-filter-menu" role="listbox" aria-label="تصفية حسب الفئة الفرعية">
          <button
            v-for="option in subcategoryOptions"
            :key="option.label"
            type="button"
            :data-testid="`subcategory-option-${option.value ?? 'all'}`"
            class="search-filter-item"
            :class="{ 'search-filter-item-active': selectedSubcategoryId === option.value }"
            @click="chooseSubcategory(option.value)"
          >{{ option.label }}</button>
        </div>
      </div>

      <!-- Barcode scan affordance -->
      <button
        type="button"
        aria-label="مسح الباركود"
        title="امسح الباركود بالماسح الضوئي أو اكتبه في خانة البحث"
        class="scan-btn"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="scan-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75V16.5zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
        </svg>
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="!displayed.length" class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
      <p class="empty-title">
        {{ search ? 'لا توجد نتائج مطابقة' : 'لا يوجد منتجات بعد' }}
      </p>
      <p class="empty-subtitle">
        {{ search ? 'جرّب كلمة بحث مختلفة أو امسح الباركود' : 'أضف منتجك الأول لبدء تتبع المخزون والأسعار' }}
      </p>
    </div>

    <!-- ─── DESKTOP TABLE (lg+) ─── -->
    <div v-if="displayed.length" class="table-wrap">
      <table class="data-table" dir="rtl">
        <thead>
          <tr class="table-head-row">
            <th class="th w-14">صورة</th>
            <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'nameAr' }" @click="toggleSort('nameAr')">
              الاسم<span class="sort-arrow">{{ sortKey === 'nameAr' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort w-28" :class="{ 'th-sort--active': sortKey === 'category' }" @click="toggleSort('category')">
              الفئة<span class="sort-arrow">{{ sortKey === 'category' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort w-24" :class="{ 'th-sort--active': sortKey === 'costPriceUsd' }" @click="toggleSort('costPriceUsd')">
              التكلفة<span class="sort-arrow">{{ sortKey === 'costPriceUsd' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort w-24" :class="{ 'th-sort--active': sortKey === 'salePriceUsd' }" @click="toggleSort('salePriceUsd')">
              البيع<span class="sort-arrow">{{ sortKey === 'salePriceUsd' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort w-24" :class="{ 'th-sort--active': sortKey === 'currentStock' }" @click="toggleSort('currentStock')">
              المخزون<span class="sort-arrow">{{ sortKey === 'currentStock' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th v-if="!filterLowStock" class="w-10" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in paginated"
            :key="p.id"
            class="table-row group"
            @click="emit('edit', p.id)"
          >
            <!-- Photo -->
            <td class="td">
              <div class="thumb-wrap">
                <ProductAvatar :name="p.nameAr" :photo-url="p.photoUrl" />
              </div>
            </td>
            <!-- Name -->
            <td class="td">
              <p class="product-name">{{ p.nameAr }}</p>
              <p v-if="p.nameEn" class="product-name-en">{{ p.nameEn }}</p>
            </td>
            <!-- Category -->
            <td class="td">
              <span class="text-muted text-xs">{{ categoryNameFor(p) || '—' }}</span>
            </td>
            <!-- Cost -->
            <td class="td">
              <span class="cost-price">${{ p.costPriceUsd.toFixed(2) }}</span>
            </td>
            <!-- Sale Price -->
            <td class="td">
              <span class="sale-price">${{ p.salePriceUsd.toFixed(2) }}</span>
            </td>
            <!-- Stock -->
            <td class="td">
              <div class="stock-cell">
                <span
                  :data-testid="`stock-${p.id}`"
                  class="stock-num"
                  :class="p.currentStock < 0 ? 'stock-neg' : isLowStock(p) ? 'stock-low' : 'stock-ok'"
                >{{ p.currentStock }}</span>
                <span
                  v-if="isLowStock(p)"
                  :data-testid="`low-stock-badge-${p.id}`"
                  aria-label="مخزون منخفض"
                  class="low-stock-icon"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </span>
              </div>
            </td>
            <!-- Actions (hidden in low-stock view — row click already navigates to edit) -->
            <td v-if="!filterLowStock" class="td relative" @click.stop>
              <button
                type="button"
                class="kebab-btn opacity-0 group-hover:opacity-100"
                aria-label="الإجراءات"
                @click="toggleKebab(p.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                </svg>
              </button>
              <!-- Kebab dropdown -->
              <div v-if="openKebab === p.id" class="kebab-dropdown">
                <button type="button" class="kebab-item" @click="handleAdjustStock(p.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                  </svg>
                  تعديل الكمية
                </button>
                <div class="kebab-divider" />
                <button type="button" class="kebab-item" @click="handleEdit(p.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  تعديل البيانات
                </button>
                <div class="kebab-divider" />
                <button type="button" class="kebab-item kebab-danger" @click="handleDelete(p.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  حذف
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Outside click overlay to close kebab -->
      <div v-if="openKebab" class="fixed inset-0 z-20" @click="closeKebab" />
    </div>

    <!-- ─── MOBILE CARDS (< lg) ─── -->
    <div class="mobile-list">
      <div
        v-for="p in paginated"
        :key="p.id"
        :data-testid="`product-card-${p.id}`"
        class="mobile-card"
        :class="isLowStock(p) ? 'mobile-card-low' : 'mobile-card-normal'"
        @click="emit('edit', p.id)"
      >
        <!-- Photo -->
        <div class="mobile-thumb">
          <ProductAvatar :name="p.nameAr" :photo-url="p.photoUrl" />
        </div>
        <!-- Name + barcode -->
        <div class="mobile-info">
          <p class="product-name truncate">{{ p.nameAr }}</p>
          <p v-if="p.barcode" class="text-xs text-muted mt-0.5">{{ p.barcode }}</p>
        </div>
        <!-- Price + stock -->
        <div class="mobile-meta">
          <p class="sale-price">${{ p.salePriceUsd.toFixed(2) }}</p>
          <button
            type="button"
            :data-testid="`stock-${p.id}`"
            class="mobile-stock mobile-stock-btn"
            :class="p.currentStock < 0 ? 'stock-neg' : isLowStock(p) ? 'stock-low' : 'text-muted'"
            aria-label="تعديل الكمية"
            @click.stop="emit('adjust-stock', p.id)"
          >
            <span v-if="isLowStock(p)" :data-testid="`low-stock-badge-${p.id}`" aria-label="مخزون منخفض">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </span>
            {{ p.currentStock }}
            <svg class="edit-pencil" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
          </button>
        </div>
        <!-- Delete (hidden in low-stock view) -->
        <button
          v-if="!filterLowStock"
          type="button"
          class="mobile-delete"
          aria-label="حذف"
          @click.stop="emit('delete', p.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Pagination — shared by desktop table + mobile cards -->
    <Paginator
      v-if="displayed.length > 10"
      :first="first"
      :rows="rows"
      :total-records="displayed.length"
      :rows-per-page-options="[10, 25, 50]"
      class="list-paginator"
      dir="rtl"
      @page="onPage"
    />
  </div>
</template>

<style scoped>
.list-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Toolbar ─────────────────────────────────────── */
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.search-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 12px;
  margin: auto 0;
  width: 16px;
  height: 16px;
  color: #637285;
  pointer-events: none;
}

.search-input {
  width: 100%;
  border-radius: 0.75rem;
  padding: 10px 40px 10px 16px;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input::placeholder {
  color: #3D4F6B;
}

.search-input:focus {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.scan-btn {
  width: 44px;
  height: 44px;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  color: #637285;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}

.scan-btn:hover {
  color: #E8EDF5;
}

.scan-icon {
  width: 20px;
  height: 20px;
}

.search-filter-wrap {
  position: relative;
  width: 132px;
  flex-shrink: 0;
}

.search-filter-btn {
  width: 100%;
  height: 44px;
  border-radius: 0.75rem;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  outline: none;
}

.search-filter-btn:hover {
  border-color: rgba(26,86,219,0.40);
}

.search-filter-btn:focus {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.search-filter-text {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.search-filter-chevron {
  color: #637285;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.search-filter-chevron-open {
  transform: rotate(180deg);
}

.search-filter-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  inset-inline-start: 0;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px;
  border-radius: 12px;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  border: 1px solid rgba(26,86,219,0.30);
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.search-filter-menu::-webkit-scrollbar {
  width: 10px;
}

.search-filter-menu::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.search-filter-menu::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.search-filter-menu::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.search-filter-item {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #E8EDF5;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  text-align: right;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-filter-item:hover {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.24);
}

.search-filter-item-active {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20));
  border-color: rgba(26,86,219,0.35);
  color: #FFFFFF;
}

@media (max-width: 420px) {
  .search-filter-wrap {
    width: 112px;
  }
}

/* ── Empty state ─────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  text-align: center;
}

.empty-icon {
  width: 64px;
  height: 64px;
  color: #637285;
  opacity: 0.20;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0 0 6px 0;
}

.empty-subtitle {
  font-size: 13px;
  color: #637285;
  max-width: 280px;
  margin: 0;
}

/* ── Desktop Table ───────────────────────────────── */
.table-wrap {
  display: none;
  overflow-x: auto;
}

@media (min-width: 1024px) {
  .table-wrap {
    display: block;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.table-head-row {
  border-bottom: 1px solid rgba(26,86,219,0.14);
}

.th {
  text-align: right;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #637285;
  white-space: nowrap;
}

/* ── Sortable headers (#9) ── */
.th-sort {
  cursor: pointer;
  user-select: none;
  transition: color 0.12s;
}
.th-sort:hover { color: #93B4F0; }
.th-sort--active { color: #60A5FA; }
.sort-arrow {
  display: inline-block;
  margin-inline-start: 4px;
  font-size: 9px;
}

/* ── Paginator (#table navigation) ── */
.list-paginator {
  margin-top: 16px;
}
.list-paginator :deep(.p-paginator) {
  background: transparent;
  border: none;
  color: #637285;
  flex-wrap: wrap;
  gap: 4px;
}
.list-paginator :deep(.p-paginator-page),
.list-paginator :deep(.p-paginator-first),
.list-paginator :deep(.p-paginator-prev),
.list-paginator :deep(.p-paginator-next),
.list-paginator :deep(.p-paginator-last) {
  color: #C8D5E8;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  border-radius: 0.5rem;
  min-width: 2.25rem;
  height: 2.25rem;
}
.list-paginator :deep(.p-paginator-page:hover),
.list-paginator :deep(.p-paginator-first:not(:disabled):hover),
.list-paginator :deep(.p-paginator-prev:not(:disabled):hover),
.list-paginator :deep(.p-paginator-next:not(:disabled):hover),
.list-paginator :deep(.p-paginator-last:not(:disabled):hover) {
  border-color: rgba(26,86,219,0.40);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(255,255,255,0.06));
}
.list-paginator :deep(.p-paginator-page.p-paginator-page-selected) {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border-color: transparent;
  box-shadow: 0 6px 20px rgba(26,86,219,0.35), inset 0 1px 0 rgba(255,255,255,0.10);
  color: #fff;
}
.list-paginator :deep(.p-paginator-rpp-dropdown) {
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  border-radius: 0.75rem;
  height: 2.25rem;
  overflow: hidden;
}
.list-paginator :deep(.p-paginator-rpp-dropdown .p-select-label) {
  color: #E8EDF5;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  padding-block: 0;
  padding-inline: 10px;
}
.list-paginator :deep(.p-paginator-rpp-dropdown .p-select-dropdown) {
  color: #637285;
  border-inline-start: 1px solid rgba(26,86,219,0.22);
  min-width: 2rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.list-paginator :deep(.p-paginator-rpp-dropdown:hover .p-select-dropdown) {
  border-inline-start-color: rgba(26,86,219,0.40);
}
.list-paginator :deep(.p-paginator-rpp-dropdown.p-focus) {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

/* PrimeVue Select panel is portaled, so these need global deep selectors. */
:deep(.p-select-overlay) {
  padding: 6px;
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  border: 1px solid rgba(26,86,219,0.30);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  backdrop-filter: blur(20px) saturate(180%);
}

:deep(.p-select-list-container) {
  max-height: 220px;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

:deep(.p-select-list) {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

:deep(.p-select-list-container::-webkit-scrollbar) {
  width: 10px;
}

:deep(.p-select-list-container::-webkit-scrollbar-track) {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

:deep(.p-select-list-container::-webkit-scrollbar-thumb) {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

:deep(.p-select-list-container::-webkit-scrollbar-thumb:hover) {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

:deep(.p-select-option) {
  color: #E8EDF5;
  border-radius: 8px;
  border: 1px solid transparent;
  min-height: 34px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
}

:deep(.p-select-option-label) {
  width: 100%;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.p-select-option:hover) {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.24);
}

:deep(.p-select-option.p-select-option-selected),
:deep(.p-select-option.p-highlight),
:deep(.p-select-option[aria-selected="true"]) {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20)) !important;
  color: #FFFFFF !important;
}

:deep(.p-select-option.p-focus),
:deep(.p-select-option:focus-visible) {
  background: rgba(26,86,219,0.16) !important;
  color: #E8EDF5 !important;
}

:deep(.p-select-option.p-select-option-selected.p-focus),
:deep(.p-select-option.p-highlight.p-focus),
:deep(.p-select-option[aria-selected="true"].p-focus) {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20)) !important;
  color: #FFFFFF !important;
}

.table-row {
  border-bottom: 1px solid rgba(255,255,255,0.05);
  cursor: pointer;
  transition: background 0.12s;
}

.table-row:hover {
  background: rgba(26,86,219,0.06);
}

.td {
  padding: 10px 12px;
  vertical-align: middle;
}

/* ── Thumbnail ───────────────────────────────────── */
.thumb-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.18);
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  width: 16px;
  height: 16px;
  color: #637285;
  opacity: 0.4;
}

/* ── Product names ───────────────────────────────── */
.product-name {
  font-size: 14px;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0;
}

.product-name-en {
  font-size: 12px;
  color: #637285;
  margin: 2px 0 0 0;
}

/* ── Prices ──────────────────────────────────────── */
.cost-price {
  font-size: 13px;
  color: #637285;
  font-variant-numeric: tabular-nums;
}

.sale-price {
  font-size: 13px;
  font-weight: 700;
  color: #60A5FA;
  font-variant-numeric: tabular-nums;
}

/* ── Stock ───────────────────────────────────────── */
.stock-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stock-num {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stock-ok  { color: #E8EDF5; }
.stock-low { color: #F59E0B; }
.stock-neg { color: #EF4444; }

.low-stock-icon {
  color: #F59E0B;
}

/* ── Kebab button ────────────────────────────────── */
.kebab-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #637285;
  cursor: pointer;
  transition: color 0.12s, background 0.12s, opacity 0.15s;
}

.kebab-btn:hover {
  color: #E8EDF5;
  background: rgba(26,86,219,0.08);
}

/* ── Kebab dropdown ──────────────────────────────── */
.kebab-dropdown {
  position: absolute;
  inset-inline-start: 0;
  top: 40px;
  z-index: 30;
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 0.75rem;
  overflow: hidden;
  min-width: 144px;
  box-shadow: 0 8px 48px rgba(26,86,219,0.22);
}

.kebab-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 13px;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: right;
  transition: background 0.12s;
}

.kebab-item:hover {
  background: rgba(26,86,219,0.12);
}

.kebab-danger {
  color: #EF4444;
}

.kebab-divider {
  height: 1px;
  background: rgba(26,86,219,0.14);
}

/* ── Mobile Cards ────────────────────────────────── */
.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (min-width: 1024px) {
  .mobile-list { display: none; }
}

.mobile-card {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  border-radius: 1rem;
  transition: transform 0.1s, background 0.12s;
}

.mobile-card:active {
  transform: scale(0.99);
}

.mobile-card-normal {
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(255,255,255,0.07);
}

.mobile-card-low {
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.35);
}

.mobile-card:hover {
  background: rgba(26,86,219,0.10);
}

.mobile-thumb {
  width: 44px;
  height: 44px;
  border-radius: 0.75rem;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.18);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobile-info {
  flex: 1;
  min-width: 0;
}

.mobile-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.mobile-stock {
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mobile-stock-btn {
  background: rgba(26,86,219,0.10);
  border: 1px solid rgba(26,86,219,0.25);
  border-radius: 9999px;
  padding: 3px 10px;
  cursor: pointer;
  font-family: inherit;
}

.mobile-stock-btn:hover { background: rgba(26,86,219,0.18); }

.edit-pencil {
  width: 11px;
  height: 11px;
  opacity: 0.6;
}

.mobile-delete {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: #637285;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.12s;
}

.mobile-delete:hover {
  color: #EF4444;
}

/* ── Utility ─────────────────────────────────────── */
.text-muted {
  color: #637285;
}
</style>
