<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { useSaleHistory } from './useSaleHistory'

const router  = useRouter()
const { sales, loading, loadHistory, reprint, reprintError } = useSaleHistory()
const expandedId = ref<string | null>(null)
const toast      = ref<string | null>(null)
const toastType  = ref<'info' | 'error'>('info')

onMounted(loadHistory)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

const methodLabel: Record<string, string> = {
  cash_usd: '$', cash_syp: 'ل.س', card: '💳',
}

async function handleReprint(saleId: string) {
  try {
    await reprint(saleId)
    toastType.value = 'info'
    toast.value = 'تم إرسال الفاتورة للطباعة'
  } catch (e) {
    toastType.value = 'error'
    toast.value = `خطأ: ${e instanceof Error ? e.message : String(e)}`
  }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader title="آخر المبيعات" :show-back="true" @back="router.push('/')" />

    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
      <div v-if="loading" class="flex justify-center py-10">
        <div class="w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
      </div>

      <div
        v-else-if="sales.length === 0"
        class="flex flex-col items-center justify-center py-16 text-gray-400 text-sm"
      >
        <p class="text-3xl mb-3">🧾</p>
        <p>لا توجد مبيعات في آخر 7 أيام</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="sale in sales"
          :key="sale.id"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
          <!-- Row -->
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 min-h-[56px] text-right"
            @click="expandedId = expandedId === sale.id ? null : sale.id"
          >
            <span class="text-sm font-mono text-blue-600 dark:text-blue-400 shrink-0">{{ sale.displaySaleNumber }}</span>
            <span class="flex-1 text-sm font-semibold text-gray-900 dark:text-white">${{ sale.totalUsd.toFixed(2) }}</span>
            <span class="text-xs text-gray-400 shrink-0">{{ formatDate(sale.createdAt) }}</span>
            <span class="text-sm shrink-0">{{ methodLabel[sale.paymentMethod] ?? '?' }}</span>
          </button>

          <!-- Expanded detail -->
          <div v-if="expandedId === sale.id" class="border-t border-gray-100 dark:border-gray-700 px-4 py-3">
            <div class="flex justify-between text-xs text-gray-500 mb-2">
              <span>بالليرة: {{ sale.totalSyp.toLocaleString() }} ل.س</span>
              <span>السعر: {{ sale.exchangeRateAtSale.toLocaleString() }}</span>
            </div>
            <button
              type="button"
              class="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="handleReprint(sale.id)"
            >
              إعادة طباعة
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>
