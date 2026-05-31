<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from './pos.types'

const props = defineProps<{ searchQuery: string }>()
const emit  = defineEmits<{ (e: 'product-tap', productId: string): void }>()

const device   = useDeviceStore()
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

  products.value = ((result as any).rows._array as any[]).map(r => ({
    id:                r.id,
    shopId:            r.shop_id,
    nameAr:            r.name_ar,
    nameEn:            r.name_en ?? undefined,
    salePriceUsd:      r.price_usd,
    costPriceUsd:      r.cost_price_usd ?? 0,
    barcode:           r.barcode ?? undefined,
    category:          r.category ?? undefined,
    photoUrl:          r.photo_url ?? undefined,
    currentStock:      r.current_stock ?? 0,
    lowStockThreshold: r.low_stock_threshold ?? 5,
    isActive:          r.is_active === 1,
    createdAt:         r.created_at ?? '',
    updatedAt:         r.updated_at ?? '',
  }))
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
  <div
    v-if="products.length === 0"
    class="flex items-center justify-center h-32 text-gray-400 text-sm"
  >
    {{ searchQuery ? 'لا توجد نتائج' : 'لا توجد منتجات' }}
  </div>

  <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-2">
    <button
      v-for="p in products"
      :key="p.id"
      type="button"
      :class="[
        'flex flex-col items-center justify-center text-center rounded-xl p-3 min-h-[56px] transition-all',
        'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
        'hover:border-blue-400 active:scale-95',
        flashId === p.id ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 scale-95' : '',
      ]"
      @click="handleTap(p.id)"
    >
      <span class="text-sm font-medium text-gray-900 dark:text-white leading-tight">{{ p.nameAr }}</span>
      <span class="text-xs text-blue-600 dark:text-blue-400 mt-1">${{ p.salePriceUsd.toFixed(2) }}</span>
    </button>
  </div>
</template>
