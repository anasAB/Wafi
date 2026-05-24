<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePrinter } from '@/composables/usePrinter'
import AppToast from '@/components/ui/AppToast.vue'
import type { CompletedSale } from '@/features/payment/payment.types'
import { useDeviceStore } from '@/store/device.store'
import type { ReceiptData } from '@/composables/usePrinter'

const router  = useRouter()
const device  = useDeviceStore()
const printer = usePrinter()
const toast   = ref<string | null>(null)

const sale = (history.state as any)?.sale as CompletedSale | undefined

const methodLabels: Record<string, string> = {
  cash_usd: 'نقداً دولار',
  cash_syp: 'نقداً ليرة',
  card:     'بطاقة',
}

async function handlePrint() {
  if (!sale) return
  const receipt: ReceiptData = {
    saleId:            sale.saleId,
    displaySaleNumber: sale.displaySaleNumber,
    shopName:          device.shopId,
    createdAt:         sale.createdAt,
    lines:             [],
    totalUsd:          sale.totalUsd,
    totalSyp:          sale.totalSyp,
    exchangeRate:      sale.exchangeRateAtSale,
    paymentMethod:     sale.paymentMethod,
    amountReceived:    sale.amountReceived,
    amountReceivedCurrency: sale.amountReceivedCurrency,
    changeDue:         sale.changeDue,
  }
  try {
    await printer.print(receipt)
    toast.value = 'تم إرسال الفاتورة للطباعة'
  } catch {
    toast.value = `خطأ في الطباعة: ${printer.error.value}`
  }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh items-center justify-center px-6 text-center">
    <div class="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
      <span class="text-4xl" aria-hidden="true">✓</span>
    </div>

    <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">تم البيع بنجاح</h1>
    <p class="text-lg text-blue-600 dark:text-blue-400 font-mono font-semibold mb-6">
      {{ sale?.displaySaleNumber ?? '—' }}
    </p>

    <div class="bg-gray-50 dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm mb-6 text-right space-y-2">
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">المجموع</span>
        <span class="font-semibold">${{ sale?.totalUsd.toFixed(2) }}</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">بالليرة</span>
        <span class="font-semibold">{{ sale?.totalSyp.toLocaleString() }} ل.س</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">طريقة الدفع</span>
        <span class="font-semibold">{{ sale ? methodLabels[sale.paymentMethod] : '—' }}</span>
      </div>
      <div v-if="sale?.changeDue && sale.changeDue > 0" class="flex justify-between text-sm">
        <span class="text-gray-500">الباقي</span>
        <span class="font-semibold text-green-600">
          {{ sale.amountReceivedCurrency === 'SYP'
              ? `${sale.changeDue.toLocaleString()} ل.س`
              : `$${sale.changeDue.toFixed(2)}` }}
        </span>
      </div>
    </div>

    <button
      type="button"
      :disabled="printer.printing.value"
      class="w-full max-w-sm h-12 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold mb-3 disabled:opacity-50 active:scale-95 transition-all"
      @click="handlePrint"
    >
      {{ printer.printing.value ? 'جارٍ الطباعة...' : 'طباعة الفاتورة' }}
    </button>

    <button
      type="button"
      class="w-full max-w-sm h-12 rounded-xl bg-blue-600 text-white font-semibold mb-3 active:scale-95 transition-all"
      @click="router.push('/pos')"
    >
      بيع جديد
    </button>

    <button
      type="button"
      class="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
      @click="router.push('/history')"
    >
      آخر المبيعات
    </button>
  </div>

  <AppToast v-if="toast" :message="toast" type="success" @dismiss="toast = null" />
</template>
