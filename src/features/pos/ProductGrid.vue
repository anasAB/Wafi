<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { rowToProduct } from '@/features/products/product.utils'
import type { Product } from './pos.types'

const props = defineProps<{ searchQuery: string }>()
const emit  = defineEmits<{ (e: 'product-tap', productId: string): void }>()

const device     = useDeviceStore()
const products   = ref<Product[]>([])
const flashId    = ref<string | null>(null)
const flashTimer = ref<ReturnType<typeof setTimeout> | null>(null)

async function loadProducts() {
  const q = props.searchQuery.trim()
  const result = q
    ? await db.execute(
        `SELECT id, shop_id, name_ar, name_en, price_usd, cost_price_usd, barcode, category, photo_url, current_stock, low_stock_threshold, is_active, created_at, updated_at FROM products
         WHERE shop_id = ? AND is_active = 1 AND (name_ar LIKE ? OR name_en LIKE ? OR barcode = ?)`,
        [device.shopId, `%${q}%`, `%${q}%`, q]
      )
    : await db.execute(
        `SELECT id, shop_id, name_ar, name_en, price_usd, cost_price_usd, barcode, category, photo_url, current_stock, low_stock_threshold, is_active, created_at, updated_at FROM products WHERE shop_id = ? AND is_active = 1`,
        [device.shopId]
      )

  products.value = ((result as any).rows._array as any[]).map(rowToProduct)
}

onMounted(loadProducts)

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.searchQuery, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(loadProducts, 250)
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
    <div v-if="products.length === 0" class="empty-state">
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
        v-for="p in products"
        :key="p.id"
        type="button"
        :class="['product-btn', flashId === p.id ? 'product-btn-flash' : '', p.currentStock <= 0 ? 'product-btn-out' : '']"
        :disabled="p.currentStock <= 0"
        @click="handleTap(p.id)"
      >
        <!-- Photo or placeholder -->
        <div v-if="p.photoUrl" class="product-photo-wrap">
          <img :src="p.photoUrl" :alt="p.nameAr" class="product-photo" />
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
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

@media (min-width: 480px) {
  .product-grid { grid-template-columns: repeat(3, 1fr); }
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
  gap: 6px;
  padding: 14px 8px 12px;
  min-height: 110px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 14px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  transition: transform 0.1s, border-color 0.15s, box-shadow 0.15s, background 0.15s;
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
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 2px;
  flex-shrink: 0;
}

.product-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Text */
.product-name {
  font-size: 13px;
  font-weight: 700;
  color: #E8EDF5;
  line-height: 1.3;
  word-break: break-word;
}

.product-price {
  font-size: 13px;
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
