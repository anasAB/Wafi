<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductList from './components/ProductList.vue'
import ProductForm from './components/ProductForm.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import QuickStockSheet from './components/QuickStockSheet.vue'
import { useProducts } from './composables/useProducts'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppToast from '@/components/ui/AppToast.vue'
import type { AdjustmentReason } from '@/features/products/product.types'
import { isCostImprecise } from '@/features/products/product.utils'

const router  = useRouter()
const route   = useRoute()
const { products, load, softDelete, adjustStock } = useProducts()
const scanner = useBarcodeScan()

const filterLowStock = computed(() => route.query.filter === 'low-stock')
// WAFI-013: renamed from filterMissingCost — the filter now covers both missing
// AND stale cost. 'missing-cost' is kept as a permanent backward-compatible
// alias for the query-param VALUE (not the variable name) — someone may have
// bookmarked or screenshotted the dashboard's old deep link
// (HomePage.vue's goToMissingCostProducts), and there's no mechanism in this
// app to notify a bookmark-holder that a URL changed.
const filterImpreciseCost = computed(() =>
  route.query.filter === 'imprecise-cost' || route.query.filter === 'missing-cost'
)
const impreciseCostCount = computed(() =>
  products.value.filter(p => isCostImprecise(p)).length
)
function setFilter(value: 'low-stock' | 'imprecise-cost' | null) {
  router.push({ query: { ...route.query, filter: value ?? undefined } })
}
const initialCategoryId = computed(() => (route.query.category as string | undefined) ?? null)
const deleteTarget   = ref<string | null>(null)
const toast          = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const missedBarcode  = ref<string | null>(null)
const stockTargetId  = ref<string | null>(null)
const showAddForm    = ref(false)
const addBarcode     = ref<string | undefined>(undefined)

function openAdd(barcode?: string) {
  addBarcode.value = barcode
  showAddForm.value = true
}

async function handleProductAdded() {
  showAddForm.value = false
  missedBarcode.value = null
  toast.value = { message: 'تم حفظ المنتج', type: 'success' }
  await load()
}

const stockTarget = computed(() =>
  products.value.find(p => p.id === stockTargetId.value) ?? null
)

async function handleStockConfirm(payload: { newValue: number; reason: AdjustmentReason; notes: string }) {
  if (!stockTargetId.value) return
  await adjustStock(stockTargetId.value, payload.newValue, payload.reason, payload.notes || undefined)
  stockTargetId.value = null
  toast.value = { message: 'تم تحديث الكمية', type: 'success' }
  await load()
}

onMounted(() => {
  load()
  scanner.onScan(handleBarcodeScan)
})

onUnmounted(() => {
  // Tear the scanner down fully (WAFI-032): offScan only drops the callback and
  // leaves the global keydown listener attached, so it accumulates on remount.
  scanner.destroy()
})

function handleBarcodeScan(code: string) {
  const match = products.value.find(p => p.barcode === code)
  if (match) {
    missedBarcode.value = null
  } else {
    missedBarcode.value = code
  }
}

function dismissMissedBarcode() {
  missedBarcode.value = null
}

function handleDelete(id: string) {
  deleteTarget.value = id
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  await softDelete(deleteTarget.value)
  deleteTarget.value = null
  toast.value = { message: 'تم حذف المنتج', type: 'success' }
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader
      title="المنتجات"
      @back="router.back()"
    />

    <main class="page-main">
      <!-- Toolbar -->
      <div class="toolbar">
        <p class="product-count">{{ products.length }} منتج</p>
        <div class="toolbar-actions">
          <button
            type="button"
            class="btn-secondary"
            @click="router.push('/categories')"
          >إدارة الفئات</button>
          <button
            type="button"
            class="btn-secondary"
            @click="router.push('/stock-take')"
          >بدء جرد</button>
          <button
            type="button"
            class="btn-secondary"
            @click="router.push('/products/import')"
          >استيراد من Excel</button>
          <button
            type="button"
            class="btn-primary"
            @click="openAdd()"
          >
            <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            إضافة منتج
          </button>
        </div>
      </div>

      <!-- Filter chips (WAFI-013 — first visible chip UI for either filter; both
           low-stock and imprecise-cost were previously deep-link-only) -->
      <div class="filter-chips">
        <button
          type="button"
          class="filter-chip"
          :class="{ 'filter-chip-active': !filterLowStock && !filterImpreciseCost }"
          @click="setFilter(null)"
        >الكل</button>
        <button
          type="button"
          class="filter-chip"
          :class="{ 'filter-chip-active': filterLowStock }"
          @click="setFilter(filterLowStock ? null : 'low-stock')"
        >مخزون منخفض</button>
        <button
          type="button"
          class="filter-chip"
          :class="{ 'filter-chip-active': filterImpreciseCost }"
          @click="setFilter(filterImpreciseCost ? null : 'imprecise-cost')"
        >
          بدون سعر دقيق
          <span v-if="impreciseCostCount > 0" class="filter-chip-badge">{{ impreciseCostCount }}</span>
        </button>
      </div>

      <!-- Missed barcode banner -->
      <div v-if="missedBarcode" class="barcode-banner">
        <span class="barcode-banner-text">
          لم يُعثر على الباركود: <span class="barcode-code">{{ missedBarcode }}</span>
        </span>
        <button
          type="button"
          class="barcode-banner-action"
          @click="openAdd(missedBarcode!)"
        >إضافة بهذا الباركود</button>
        <button
          type="button"
          class="barcode-banner-close"
          aria-label="إغلاق"
          @click="dismissMissedBarcode"
        >&times;</button>
      </div>

      <ProductList
        class="product-list-block"
        :products="products"
        :filter-low-stock="filterLowStock"
        :filter-imprecise-cost="filterImpreciseCost"
        :initial-category-id="initialCategoryId"
        @edit="id => router.push(`/products/${id}/edit`)"
        @delete="handleDelete"
        @adjust-stock="id => stockTargetId = id"
      />
    </main>

    <!-- Add product as a modal (consistent with Add Expense; no navbar overlap) -->
    <BaseModal v-if="showAddForm" title="إضافة منتج" @close="showAddForm = false">
      <ProductForm
        mode="add"
        :initial-barcode="addBarcode"
        embedded
        @saved="handleProductAdded"
        @cancel="showAddForm = false"
      />
    </BaseModal>

    <QuickStockSheet
      v-if="stockTarget"
      :product-name="stockTarget.nameAr"
      :current-stock="stockTarget.currentStock"
      @confirm="handleStockConfirm"
      @close="stockTargetId = null"
    />

    <AppDialog
      v-if="deleteTarget"
      title="حذف المنتج"
      message="حذف هذا المنتج؟ لن يظهر في القائمة بعد الآن، لكن سجلات البيع السابقة ستبقى."
      confirm-label="حذف"
      cancel-label="إلغاء"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />

    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 1024px) {
  .page-root {
    height: 100dvh;
    overflow: hidden;
  }
}

.page-main {
  flex: 1;
  padding: 1rem 1rem 80px;
  width: 100%;
}

@media (min-width: 1024px) {
  .page-main {
    padding: 1.25rem 1.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
}

.product-list-block {
  min-height: 0;
}

@media (min-width: 1024px) {
  .product-list-block {
    flex: 1;
    overflow: hidden;
  }
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  gap: 0.75rem;
}

.product-count {
  font-size: 0.875rem;
  color: #637285;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-secondary {
  min-height: 40px;
  padding-inline: 0.9rem;
  background: transparent;
  color: #60A5FA;
  border: 1px dashed rgba(26,86,219,0.45);
  border-radius: 0.75rem;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.875rem;
}

.btn-secondary:hover {
  background: rgba(26,86,219,0.08);
}

/* Primary button */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding-inline: 1.5rem;
  height: 44px;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-primary:hover {
  opacity: 0.88;
}

.btn-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

/* Missed barcode banner */
.barcode-banner {
  margin-bottom: 1rem;
  border-radius: 1rem;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.barcode-banner-text {
  font-size: 0.875rem;
  color: #E8EDF5;
}

.barcode-code {
  font-family: monospace;
  color: #60A5FA;
  font-weight: 700;
}

.barcode-banner-action {
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
  padding: 0.375rem 0.75rem;
  border-radius: 0.625rem;
  color: #60A5FA;
  background: rgba(26, 86, 219, 0.15);
  border: 1px solid rgba(26, 86, 219, 0.30);
  cursor: pointer;
  transition: opacity 0.15s;
}

.barcode-banner-action:hover {
  opacity: 0.85;
}

.barcode-banner-close {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  line-height: 1;
  font-size: 1.25rem;
  color: #93A3B8;
  background: transparent;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}

.barcode-banner-close:hover {
  color: #E8EDF5;
  background: rgba(255, 255, 255, 0.08);
}

.filter-chips {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.filter-chip {
  height: 36px;
  padding-inline: 0.875rem;
  border-radius: 9999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14);
  color: #9CB3D0;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.filter-chip:hover {
  background: rgba(26,86,219,0.10);
  color: #E8EDF5;
}

.filter-chip-active {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20));
  border-color: rgba(26,86,219,0.45);
  color: #FFFFFF;
}

.filter-chip-badge {
  min-width: 1.25rem;
  height: 1.25rem;
  padding-inline: 0.25rem;
  border-radius: 9999px;
  background: rgba(245,158,11,0.9);
  color: #1a1a1a;
  font-size: 0.6875rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

</style>
