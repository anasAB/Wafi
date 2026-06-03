<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import { useSaleHistory } from './useSaleHistory'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'

const router  = useRouter()
const route   = useRoute()
const { sales, loading, loadHistory, reprint, reprintError } = useSaleHistory()
const { period, setPeriod } = usePeriodToggle()
const expandedId = ref<string | null>(null)
const toast      = ref<string | null>(null)
const toastType  = ref<'info' | 'error'>('info')

// If ?period= is in the URL, use that period; otherwise use the current singleton value
const isPeriodDrillDown = computed(() => !!route.query.period)

const periodTitle = computed(() => {
  const labels: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
  return isPeriodDrillDown.value ? `مبيعات ${labels[period.value] ?? ''}` : 'آخر المبيعات'
})

const periodTotal = computed(() =>
  sales.value.reduce((sum, s) => sum + s.totalUsd, 0)
)

onMounted(async () => {
  if (route.query.period) {
    // Sync singleton to URL param (handles direct navigation)
    const p = route.query.period as string
    if (p === 'today' || p === 'week' || p === 'month') setPeriod(p)
  }
  await loadHistory(isPeriodDrillDown.value ? getDateRange(period.value) : undefined)
})

// Reload when period changes (user taps toggle)
watch(period, async (newPeriod) => {
  if (isPeriodDrillDown.value) await loadHistory(getDateRange(newPeriod))
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'الآن'
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`
  if (diffMin < 24 * 60) return `قبل ${Math.floor(diffMin / 60)} ساعة`
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

const methodLabel: Record<string, string> = {
  cash_usd: '💵',
  cash_syp: 'ل.س',
  card:     '💳',
  credit:   '📋',
  split:    '💵+',
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
  <div class="flex flex-col min-h-dvh bg-bg-void">
    <AppHeader :title="periodTitle" :show-back="isPeriodDrillDown" @back="router.push('/')" />

    <div v-if="isPeriodDrillDown" class="px-4 pt-3 max-w-lg mx-auto w-full space-y-2">
      <PeriodToggle />
      <div v-if="sales.length > 0" class="text-sm font-bold text-blue-600 dark:text-blue-400 text-left">
        إجمالي: ${{ periodTotal.toFixed(2) }}
      </div>
    </div>

    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center py-10">
        <div
          class="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style="border-color: rgb(201 168 76 / 0.6); border-top-color: transparent"
        />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="sales.length === 0"
        class="flex flex-col items-center justify-center py-16 gap-3"
      >
        <svg class="w-12 h-12 text-text-muted opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"/>
        </svg>
        <p class="font-display italic text-text-muted text-lg">
          {{ isPeriodDrillDown ? 'لا توجد مبيعات في هذه الفترة' : 'لا توجد مبيعات في آخر 7 أيام' }}
        </p>
        <RouterLink to="/pos" class="btn-ghost text-sm h-10 px-5">بيع جديد</RouterLink>
      </div>

      <!-- Sale list -->
      <div v-else class="space-y-2">
        <div
          v-for="sale in sales"
          :key="sale.id"
          class="glass-sm overflow-hidden"
          :style="sale.isPending ? 'border-right: 2px solid #C9A84C' : ''"
        >
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 min-h-[56px] text-right"
            @click="expandedId = expandedId === sale.id ? null : sale.id"
          >
            <span class="text-sm font-mono text-gold-primary shrink-0">{{ sale.displaySaleNumber }}</span>
            <span class="flex-1 font-display text-lg text-text-primary">${{ sale.totalUsd.toFixed(2) }}</span>
            <span
              v-if="sale.isPending"
              class="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
              style="background: rgb(201 168 76 / 0.15); color: #C9A84C"
            >في الانتظار</span>
            <span class="text-xs text-text-muted shrink-0">{{ formatDate(sale.createdAt) }}</span>
            <span class="text-sm text-text-muted shrink-0">{{ methodLabel[sale.paymentMethod] ?? '?' }}</span>
          </button>

          <div
            v-if="expandedId === sale.id"
            class="px-4 py-3"
            style="border-top: 1px solid rgb(255 255 255 / 0.08)"
          >
            <div class="flex justify-between text-xs text-text-muted mb-3">
              <span>بالليرة: {{ sale.totalSyp.toLocaleString() }} ل.س</span>
              <span>السعر: {{ sale.exchangeRateAtSale.toLocaleString() }}</span>
            </div>
            <button
              type="button"
              class="btn-ghost w-full h-9 text-sm"
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
