<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

const searchQuery  = ref('')
const payOpen      = ref(false)
const toast        = ref<{ message: string; type: 'error' | 'success' | 'info' } | null>(null)

onMounted(async () => {
  await loadRate()
  scanner.onScan(async (barcode) => {
    const productId = await sale.lookupByBarcode(barcode)
    if (productId) {
      await handleProductTap(productId)
    } else {
      toast.value = { message: 'الباركود غير معروف', type: 'error' }
    }
  })
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
        <!-- Search bar -->
        <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <input
            v-model="searchQuery"
            type="search"
            placeholder="ابحث عن منتج أو باركود..."
            class="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
            dir="rtl"
          />
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
