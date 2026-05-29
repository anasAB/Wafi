<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import ProductGrid from './ProductGrid.vue'
import SalePanel from './SalePanel.vue'
import { useSale } from './useSale'
import { useExchangeRate } from '@/features/exchange-rate'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import { useSaleDraft } from '@/composables/useSaleDraft'
import PaymentModal from '@/features/payment/PaymentModal.vue'
import type { CompletedSale } from '@/features/payment/payment.types'

const router     = useRouter()
const { currentRate, loadRate } = useExchangeRate()
const sale       = useSale(currentRate)
const { scheduleSave } = useSaleDraft()
const scanner    = useBarcodeScan()

const searchQuery   = ref('')
const payOpen       = ref(false)
const toast         = ref<{ message: string; type: 'error' | 'success' | 'info' } | null>(null)

// Camera state
const cameraOpen    = ref(false)
const cameraError   = ref<'permission-denied' | null>(null)
const videoRef      = ref<HTMLVideoElement | null>(null)
let   stopCamera: (() => void) | null = null

onMounted(async () => {
  await loadRate()
  scanner.onScan(handleBarcode)
})

async function handleProductTap(productId: string) {
  try {
    await sale.addLine(productId)
    scheduleSave()
  } catch (err) {
    toast.value = {
      message: err instanceof Error ? err.message : 'خطأ في الإضافة',
      type: 'error',
    }
  }
}

async function handleBarcode(barcode: string) {
  const productId = await sale.lookupByBarcode(barcode)
  if (productId) {
    await handleProductTap(productId)
  } else {
    toast.value = { message: 'الباركود غير معروف', type: 'error' }
  }
}

async function openCamera() {
  cameraOpen.value  = true
  cameraError.value = null
  await nextTick()
  try {
    stopCamera = await scanner.startCamera(videoRef.value!, async (barcode) => {
      closeCamera()
      await handleBarcode(barcode)
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      cameraError.value = 'permission-denied'
    } else {
      cameraOpen.value = false
      toast.value = { message: 'لا يمكن فتح الكاميرا', type: 'error' }
    }
  }
}

function closeCamera() {
  stopCamera?.()
  stopCamera        = null
  cameraOpen.value  = false
  cameraError.value = null
}

onUnmounted(() => { closeCamera() })

function handlePaymentConfirmed(completedSale: CompletedSale) {
  payOpen.value = false
  router.push({ path: '/pos/confirmation', state: { sale: completedSale } })
}
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/')" />

    <!-- Rate change notice -->
    <div
      v-if="sale.hasRateChangeNotice.value"
      class="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 text-sm px-4 py-2 border-b border-orange-200"
    >
      تغيّر سعر الصرف — سيُطبق السعر الجديد على البيع التالي فقط
    </div>

    <!-- Phone: stacked. Tablet: side-by-side -->
    <div class="flex-1 flex flex-col sm:flex-row overflow-hidden">
      <!-- Product area (60%) -->
      <div class="flex flex-col sm:flex-[60]">
        <!-- Search bar with optional camera icon -->
        <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <div class="relative flex-1">
            <input
              v-model="searchQuery"
              type="search"
              placeholder="ابحث عن منتج أو باركود..."
              class="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              dir="rtl"
            />
          </div>
          <button
            v-if="scanner.cameraAvailable.value"
            type="button"
            aria-label="مسح بالكاميرا"
            class="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 hover:text-blue-600 hover:border-blue-400 transition-colors"
            @click="openCamera"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <ProductGrid :search-query="searchQuery" @product-tap="handleProductTap" />
        </div>
      </div>

      <!-- Sale panel (40%) -->
      <div class="sm:flex-[40] min-h-[40vh] sm:min-h-0">
        <SalePanel @pay="payOpen = true" />
      </div>
    </div>
  </div>

  <!-- Camera overlay (full screen) -->
  <div v-if="cameraOpen" class="fixed inset-0 z-50 bg-black flex flex-col">
    <!-- Permission denied state -->
    <div v-if="cameraError === 'permission-denied'" class="flex-1 flex flex-col items-center justify-center gap-4 px-6">
      <p class="text-white text-center text-sm">
        يجب السماح للكاميرا في إعدادات المتصفح
      </p>
      <button
        type="button"
        class="px-6 py-3 bg-blue-600 rounded-xl text-white text-sm font-medium"
        @click="openCamera"
      >
        حاول مرة أخرى
      </button>
    </div>

    <!-- Live camera view -->
    <template v-else>
      <video ref="videoRef" class="flex-1 object-cover w-full" autoplay playsinline muted />
    </template>

    <button
      type="button"
      class="py-5 text-white text-center text-sm bg-black/60"
      @click="closeCamera"
    >
      إلغاء
    </button>
  </div>

  <PaymentModal
    v-if="payOpen"
    @confirmed="handlePaymentConfirmed"
    @close="payOpen = false"
  />

  <AppToast
    v-if="toast"
    :message="toast.message"
    :type="toast.type"
    @dismiss="toast = null"
  />
</template>
