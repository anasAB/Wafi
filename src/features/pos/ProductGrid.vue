<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { rowToProduct } from '@/features/products/product.utils'
import { matchesArabicQuery } from '@/shared/text/arabic'
import type { Product } from './pos.types'

const props = defineProps<{
  searchQuery: string
  selectedCategoryId: string | null
  selectedSubcategoryId: string | null
}>()
const emit  = defineEmits<{
  (e: 'product-tap', productId: string): void
}>()

const device     = useDeviceStore()
const products   = ref<Product[]>([])
const flashId    = ref<string | null>(null)
const flashTimer = ref<ReturnType<typeof setTimeout> | null>(null)
// Filter client-side (WAFI-018): SQL LIKE can't fold Arabic harakat / alef
// variants. Fetch the shop's active products once, then fold + match the search
// query and category in memory — fast enough for a single shop's catalog and the
// only way diacritic-insensitive search works.
const visibleProducts = computed(() => {
  let list = props.selectedCategoryId
    ? products.value.filter(p => p.categoryId === props.selectedCategoryId)
    : products.value
  if (props.selectedSubcategoryId) {
    list = list.filter(p => p.subcategoryId === props.selectedSubcategoryId)
  }
  if (props.searchQuery.trim()) {
    list = list.filter(p => matchesArabicQuery(
      [p.nameAr, p.nameEn, p.barcode].join(' '),
      props.searchQuery,
    ))
  }
  return list
})

async function loadProducts() {
  const result = await db.execute(
    `SELECT id, shop_id, name_ar, name_en, price_usd, cost_price_usd, barcode, category, category_id, subcategory_id, photo_url, current_stock, low_stock_threshold, is_active, created_at, updated_at FROM products WHERE shop_id = ? AND is_active = 1`,
    [device.shopId]
  )
  products.value = ((result as any).rows._array as any[]).map(rowToProduct)
}

onMounted(() => {
  loadProducts()
})

function handleTap(productId: string) {
  if (flashTimer.value) clearTimeout(flashTimer.value)
  flashId.value = productId
  flashTimer.value = setTimeout(() => { flashId.value = null; flashTimer.value = null }, 200)
  emit('product-tap', productId)
}

onUnmounted(() => {
  if (flashTimer.value) clearTimeout(flashTimer.value)
})
</script>

<template>
  <div class="grid-root" dir="rtl">
    <!-- Empty state -->
    <div v-if="visibleProducts.length === 0" class="empty-state">
      <div class="empty-icon">
        <svg fill="none" stroke="#3D4F6B" stroke-width="1" viewBox="0 0 24 24" width="28" height="28">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      </div>
      <p class="empty-text">{{ searchQuery ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات' }}</p>
    </div>

    <!-- Product grid -->
    <div v-else class="product-grid">
      <button
        v-for="p in visibleProducts"
        :key="p.id"
        type="button"
        :class="['product-btn', flashId === p.id ? 'product-btn-flash' : '', p.currentStock <= 0 ? 'product-btn-out' : '']"
        :disabled="p.currentStock <= 0"
        @click="handleTap(p.id)"
      >
        <!-- Photo if present; otherwise a neutral placeholder icon. -->
        <div class="product-photo-wrap">
          <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.nameAr" class="product-photo" />
          <div v-else class="product-photo-fallback" aria-hidden="true">
            <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </div>
        </div>

        <span class="product-name">{{ p.nameAr }}</span>
        <span class="product-price">${{ p.salePriceUsd.toFixed(2) }}</span>
        <span
          class="product-stock"
          :class="p.currentStock <= 0 ? 'stock-out' : (p.currentStock <= p.lowStockThreshold ? 'stock-low' : '')"
        >{{ p.currentStock > 0 ? `المتبقي: ${p.currentStock}` : 'نفد المخزون' }}</span>

        <!-- Low stock warning -->
        <span v-if="p.currentStock <= p.lowStockThreshold && p.currentStock > 0" class="low-stock-dot" title="مخزون منخفض" />
        <span v-if="p.currentStock <= 0" class="out-stock-dot" title="نفد المخزون" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.grid-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 12px;
}

.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.16);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-text {
  font-size: 14px;
  color: #637285;
}

/* Grid */
.product-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  align-content: start;
  overflow-y: auto;
  padding-inline-end: 6px;
  padding-block-end: 6px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.product-grid::-webkit-scrollbar {
  width: 10px;
}

.product-grid::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.product-grid::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.product-grid::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

@media (min-width: 480px) {
  .product-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 13px;
  }
}

@media (min-width: 900px) {
  .product-grid { grid-template-columns: repeat(4, 1fr); }
}

/* Product tile */
.product-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  padding: 16px 10px 14px;
  min-height: 132px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 14px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  transition: transform 0.1s, border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

@media (min-width: 480px) {
  .product-btn {
    min-height: 138px;
  }
}

.product-btn:hover {
  border-color: rgba(26,86,219,0.40);
  box-shadow: 0 4px 20px rgba(26,86,219,0.16), inset 0 1px 0 rgba(255,255,255,0.08);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(255,255,255,0.06));
}

.product-btn:active {
  transform: scale(0.96);
}

.product-btn-out {
  opacity: 0.45;
  cursor: not-allowed;
}

.product-btn-out:hover {
  border-color: rgba(26,86,219,0.22);
  box-shadow: 0 2px 14px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
}

.product-btn-out:active {
  transform: none;
}

.product-btn-flash {
  border-color: rgba(26,86,219,0.70) !important;
  box-shadow: 0 0 20px rgba(26,86,219,0.40), inset 0 1px 0 rgba(255,255,255,0.10) !important;
  background: linear-gradient(135deg, rgba(26,86,219,0.24), rgba(26,86,219,0.10)) !important;
}

/* Photo */
.product-photo-wrap {
  width: 46px;
  height: 46px;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 1px;
  flex-shrink: 0;
}

.product-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.product-photo-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #60A5FA;
  background: rgba(26,86,219,0.16);
}

/* Text */
.product-name {
  font-size: 13px;
  font-weight: 700;
  color: #E8EDF5;
  line-height: 1.3;
  display: block;
  overflow: visible;
  white-space: normal;
  word-break: break-word;
}

.product-price {
  font-size: 14px;
  font-weight: 800;
  color: #60A5FA;
  font-variant-numeric: tabular-nums;
}

/* Remaining stock on the tile */
.product-stock {
  font-size: 10px;
  font-weight: 600;
  color: #637285;
  font-variant-numeric: tabular-nums;
}
.product-stock.stock-low { color: #F59E0B; }
.product-stock.stock-out { color: #EF4444; }

/* Stock indicators */
.low-stock-dot {
  position: absolute;
  top: 6px;
  inset-inline-start: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #F59E0B;
  box-shadow: 0 0 6px rgba(245,158,11,0.60);
}

.out-stock-dot {
  position: absolute;
  top: 6px;
  inset-inline-start: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #EF4444;
  box-shadow: 0 0 6px rgba(239,68,68,0.60);
}
</style>
