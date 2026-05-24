<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from './pos.types'

const props = defineProps<{ searchQuery: string }>()
const emit  = defineEmits<{ (e: 'product-tap', productId: string): void }>()

const device   = useDeviceStore()
const products = ref<Product[]>([])
const flashId  = ref<string | null>(null)

async function loadProducts() {
  const q = props.searchQuery.trim()
  const result = q
    ? await db.execute(
        `SELECT id, name_ar, name_en, price_usd, barcode FROM products
         WHERE shop_id = ? AND is_active = 1 AND (name_ar LIKE ? OR name_en LIKE ? OR barcode = ?)`,
        [device.shopId, `%${q}%`, `%${q}%`, q]
      )
    : await db.execute(
        `SELECT id, name_ar, name_en, price_usd, barcode FROM products WHERE shop_id = ? AND is_active = 1`,
        [device.shopId]
      )

  products.value = ((result as any).rows._array as any[]).map(r => ({
    id: r.id, shopId: device.shopId, nameAr: r.name_ar, nameEn: r.name_en,
    priceUsd: r.price_usd, barcode: r.barcode, isActive: true,
  }))
}

onMounted(loadProducts)
watch(() => props.searchQuery, loadProducts)

function handleTap(productId: string) {
  flashId.value = productId
  setTimeout(() => { flashId.value = null }, 200)
  emit('product-tap', productId)
}
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
      <span class="text-xs text-blue-600 dark:text-blue-400 mt-1">${{ p.priceUsd.toFixed(2) }}</span>
    </button>
  </div>
</template>
