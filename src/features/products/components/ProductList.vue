<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Product } from '@/features/pos/pos.types'

const props = defineProps<{
  products:        Product[]
  filterLowStock?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit',   id: string): void
  (e: 'delete', id: string): void
}>()

const search = ref('')

const displayed = computed(() => {
  let list = props.filterLowStock
    ? props.products.filter(p => p.currentStock <= p.lowStockThreshold)
    : props.products

  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    list = list.filter(p =>
      p.nameAr.toLowerCase().includes(q) ||
      (p.nameEn ?? '').toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q)
    )
  }

  return list
})

function isLowStock(p: Product): boolean {
  return p.currentStock <= p.lowStockThreshold
}
</script>

<template>
  <div dir="rtl">
    <div class="mb-4">
      <input
        v-model="search"
        data-testid="search"
        type="text"
        placeholder="بحث..."
        class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm
               dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>

    <div
      v-if="!displayed.length"
      class="flex flex-col items-center justify-center py-16 text-gray-400"
    >
      <span class="text-4xl mb-3">📦</span>
      <p class="text-sm">{{ search ? 'لا توجد نتائج' : 'لا توجد منتجات بعد' }}</p>
    </div>

    <!-- Unified list: card on mobile, table-like row on desktop -->
    <div class="flex flex-col gap-3">
      <div
        v-for="p in displayed"
        :key="p.id"
        :data-testid="`product-card-${p.id}`"
        class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
        :class="isLowStock(p) ? 'border border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/10' : ''"
        @click="emit('edit', p.id)"
      >
        <!-- Photo -->
        <div class="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.nameAr" class="w-full h-full object-cover" />
          <span v-else class="text-xl">📦</span>
        </div>

        <!-- Name + barcode -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 dark:text-white truncate">{{ p.nameAr }}</p>
          <p class="text-xs text-gray-400 dark:text-gray-500">{{ p.barcode ?? '—' }}</p>
        </div>

        <!-- Prices (desktop only) -->
        <div class="hidden sm:flex flex-col items-end text-xs text-gray-500 gap-0.5">
          <span>تكلفة: ${{ p.costPriceUsd }}</span>
        </div>

        <!-- Sale price + stock -->
        <div class="text-left flex-shrink-0">
          <p class="text-sm font-semibold text-blue-600 dark:text-blue-400">${{ p.salePriceUsd }}</p>
          <p
            :data-testid="`stock-${p.id}`"
            class="text-xs font-medium"
            :class="p.currentStock < 0 ? 'text-red-600' : isLowStock(p) ? 'text-yellow-600' : 'text-gray-500'"
          >
            <span v-if="isLowStock(p)" :data-testid="`low-stock-badge-${p.id}`">⚠ </span>
            {{ p.currentStock }}
          </p>
        </div>

        <!-- Delete button (desktop only) -->
        <button
          type="button"
          class="hidden sm:inline-block text-xs text-gray-400 hover:text-red-500 px-2 py-1"
          @click.stop="emit('delete', p.id)"
        >حذف</button>
      </div>
    </div>
  </div>
</template>
