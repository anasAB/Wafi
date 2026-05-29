<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import AppDialog from '@/components/ui/AppDialog.vue'

const emit = defineEmits<{ (e: 'pay'): void }>()
const store = useSaleStore()

const totalSyp = computed(() => {
  const rate = store.lockedExchangeRate
  if (rate === null) return null
  return Math.round(store.totalUsd * rate)
})

const showClearDialog  = ref(false)
const swipedProductId  = ref<string | null>(null)
let   touchStartX      = 0
let   touchStartY      = 0

function onTouchStart(e: TouchEvent, productId: string) {
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  if (swipedProductId.value !== productId) swipedProductId.value = null
}

function onTouchEnd(e: TouchEvent, productId: string) {
  const dx = touchStartX - e.changedTouches[0].clientX
  const dy = touchStartY - e.changedTouches[0].clientY
  if (Math.abs(dx) < Math.abs(dy)) return   // vertical scroll wins — ignore
  if (dx > 50)       swipedProductId.value = productId
  else if (dx < -20) swipedProductId.value = null
}

function onTouchCancel() {
  swipedProductId.value = null
}

function handleDeleteLine(productId: string) {
  store.removeLine(productId)
  swipedProductId.value = null
}

function handleClearSale() {
  store.clear()
  showClearDialog.value = false
}
</script>

<template>
  <div class="flex flex-col h-full bg-white dark:bg-gray-800 border-t sm:border-t-0 sm:border-r border-gray-200 dark:border-gray-700">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
      <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">الفاتورة</span>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-400">{{ store.lines.length }} صنف</span>
        <button
          v-if="store.lines.length > 0"
          type="button"
          class="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
          @click="showClearDialog = true"
        >مسح</button>
      </div>
    </div>

    <!-- Line items -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-if="store.lines.length === 0"
        class="flex items-center justify-center h-20 text-gray-400 text-sm"
      >
        لا توجد منتجات في البيع
      </div>

      <div
        v-for="line in store.lines"
        :key="line.productId"
        class="relative overflow-hidden border-b border-gray-100 dark:border-gray-700"
        @touchstart="(e) => onTouchStart(e, line.productId)"
        @touchend="(e) => onTouchEnd(e, line.productId)"
        @touchcancel="onTouchCancel"
      >
        <!-- Delete button revealed on swipe -->
        <div class="absolute inset-y-0 start-0 w-20 flex items-center justify-center bg-red-600">
          <button
            type="button"
            class="text-white text-sm font-medium w-full h-full"
            @click="handleDeleteLine(line.productId)"
          >حذف</button>
        </div>

        <!-- Row content (slides left to reveal delete button) -->
        <div
          :class="swipedProductId === line.productId ? '-translate-x-20' : 'translate-x-0'"
          class="relative flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 transition-transform duration-200"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ line.nameAr }}</p>
            <p class="text-xs text-gray-400">${{ line.unitPriceUsd.toFixed(2) }}</p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
              @click="line.quantity - 1 < 1 ? store.removeLine(line.productId) : store.updateQuantity(line.productId, line.quantity - 1)"
            >−</button>
            <span class="text-sm font-semibold w-5 text-center">{{ line.quantity }}</span>
            <button
              type="button"
              class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
              @click="store.updateQuantity(line.productId, line.quantity + 1)"
            >+</button>
          </div>

          <span class="text-sm font-semibold text-gray-900 dark:text-white w-16 text-left">
            ${{ line.lineTotalUsd.toFixed(2) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Totals + actions -->
    <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
      <div class="flex justify-between text-sm text-gray-600 dark:text-gray-300 mb-1">
        <span>المجموع (دولار)</span>
        <span class="font-bold text-gray-900 dark:text-white">${{ store.totalUsd.toFixed(2) }}</span>
      </div>
      <div v-if="totalSyp !== null" class="flex justify-between text-xs text-gray-400 mb-3">
        <span>بالليرة (السعر المقفل)</span>
        <span>{{ totalSyp.toLocaleString() }} ل.س</span>
      </div>

      <button
        type="button"
        :disabled="store.lines.length === 0"
        class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
        @click="emit('pay')"
      >
        دفع
      </button>
    </div>
  </div>

  <AppDialog
    v-if="showClearDialog"
    title="مسح البيع"
    message="متأكد من حذف البيع؟"
    confirm-label="نعم"
    cancel-label="لا"
    :danger="true"
    @confirm="handleClearSale"
    @cancel="showClearDialog = false"
  />
</template>
