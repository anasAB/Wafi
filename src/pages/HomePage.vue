<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader    from '@/components/ui/AppHeader.vue'
import AppDialog    from '@/components/ui/AppDialog.vue'
import AppToast     from '@/components/ui/AppToast.vue'
import { useExchangeRate }      from '@/features/exchange-rate'
import { useSaleDraft }         from '@/composables/useSaleDraft'
import { useLowStockAlerts }    from '@/features/products/composables/useLowStockAlerts'
import { usePeriodToggle }      from '@/features/dashboard/composables/usePeriodToggle'
import { useDashboardMetrics }  from '@/features/dashboard/composables/useDashboardMetrics'
import { useBestSellers }       from '@/features/dashboard/composables/useBestSellers'
import { useCashDrawer }        from '@/features/dashboard/composables/useCashDrawer'
import MetricCard               from '@/features/dashboard/components/MetricCard.vue'
import ProfitSheet             from '@/features/dashboard/components/ProfitSheet.vue'
import PeriodToggle             from '@/features/dashboard/components/PeriodToggle.vue'
import BestSellersCard          from '@/features/dashboard/components/BestSellersCard.vue'
import StalenessBar             from '@/features/dashboard/components/StalenessBar.vue'
import CashDrawerBar            from '@/features/dashboard/components/CashDrawerBar.vue'
import CashDrawerSheet          from '@/features/dashboard/components/CashDrawerSheet.vue'
import ExpenseForm              from '@/features/expenses/components/ExpenseForm.vue'
import { db }                   from '@/data/powersync/db'

const router  = useRouter()
const { currentRate, loadRate } = useExchangeRate()
const { hasDraft, loadDraft, restoreDraft, clearDraft } = useSaleDraft()
const { count: lowStockCount, top3: lowStockTop3, allClear, load: loadAlerts } = useLowStockAlerts()
const { period }           = usePeriodToggle()
const metrics              = useDashboardMetrics()
const sellers              = useBestSellers()
const drawer               = useCashDrawer()

const showDraftDialog  = ref(false)
const showExpenseForm  = ref(false)
const showProfitSheet  = ref(false)
const showCashDrawer   = ref(false)
const toast           = ref<{ message: string; type: 'success' | 'error' } | null>(null)

// Staleness tracking
const lastSyncedAt = ref<string | null>(localStorage.getItem('wafi_last_synced'))
const isOnline     = ref(db.status?.connected ?? false)

let syncTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  try {
    await Promise.all([loadRate(), loadDraft(), loadAlerts()])
    if (hasDraft.value) showDraftDialog.value = true
    await Promise.all([metrics.load(period.value), sellers.load(period.value), drawer.load()])
  } catch { /* errors shown via toast */ }

  // Poll sync status every 60s; update lastSyncedAt when connection is restored
  syncTimer = setInterval(() => {
    const nowConnected = db.status?.connected ?? false
    if (nowConnected && !isOnline.value) {
      const now = new Date().toISOString()
      localStorage.setItem('wafi_last_synced', now)
      lastSyncedAt.value = now
    }
    isOnline.value = nowConnected
  }, 60_000)

  // Mark initial sync time if connected at mount
  if (db.status?.connected) {
    const now = new Date().toISOString()
    localStorage.setItem('wafi_last_synced', now)
    lastSyncedAt.value = now
    isOnline.value = true
  }
})

onUnmounted(() => {
  if (syncTimer) clearInterval(syncTimer)
})

// Reload metrics and sellers when period changes
watch(period, async (newPeriod) => {
  await Promise.all([metrics.load(newPeriod), sellers.load(newPeriod)])
})

async function handleRestoreDraft() {
  await restoreDraft()
  showDraftDialog.value = false
  router.push('/pos')
}

async function handleDiscardDraft() {
  await clearDraft()
  showDraftDialog.value = false
}

async function handleExpenseSaved() {
  showExpenseForm.value = false
  toast.value = { message: 'تم حفظ المصروف', type: 'success' }
  await metrics.load(period.value)
}

const canStartSale = computed(() => currentRate.value !== null)

const arabicDate = new Intl.DateTimeFormat('ar-SY', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date())

const revenueSyp  = computed(() => currentRate.value ? Math.round(metrics.revenueUsd.value * currentRate.value) : 0)
const expensesSyp = computed(() => currentRate.value ? Math.round(metrics.expensesUsd.value * currentRate.value) : 0)
const profitSyp   = computed(() => currentRate.value ? Math.round(metrics.profitUsd.value * currentRate.value) : 0)

const profitAccent = computed(() => {
  if (metrics.profitUsd.value > 0) return 'green' as const
  if (metrics.profitUsd.value < 0) return 'red' as const
  return 'gray' as const
})
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-gray-50 dark:bg-gray-950">
    <AppHeader title="وافي" :show-exchange-rate="true" />

    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full pb-24" dir="rtl">

      <!-- Greeting -->
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-0.5">{{ arabicDate }}</p>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">أهلاً 👋</h1>

      <!-- Staleness banner -->
      <StalenessBar :last-synced-at="lastSyncedAt" :is-online="isOnline" class="mb-2" />

      <!-- Period toggle -->
      <PeriodToggle class="mb-4" />

      <!-- No rate warning -->
      <div
        v-if="!currentRate"
        id="no-rate-warning"
        class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700
               rounded-xl p-3 mb-4 text-sm text-yellow-800 dark:text-yellow-200"
      >حدد سعر صرف الدولار من الأعلى قبل البدء في البيع.</div>

      <!-- Three metric cards -->
      <div class="flex flex-col gap-3 mb-4">
        <MetricCard
          label="المال الداخل"
          :amount-usd="metrics.revenueUsd.value"
          :syp="revenueSyp"
          accent="blue"
          data-testid="card-revenue"
          @tap="router.push(`/history?period=${period}`)"
        />
        <MetricCard
          label="المصاريف"
          :amount-usd="metrics.expensesUsd.value"
          :syp="expensesSyp"
          accent="orange"
          data-testid="card-expenses"
          @tap="router.push(`/expenses?period=${period}`)"
        />
        <MetricCard
          label="الربح"
          :amount-usd="metrics.profitUsd.value"
          :syp="profitSyp"
          :accent="profitAccent"
          :warning-count="metrics.missingCostCount.value"
          data-testid="card-profit"
          @tap="showProfitSheet = true"
          @warning-tap="router.push('/products?filter=missing-cost')"
        />
      </div>

      <!-- Add expense inline button -->
      <button
        type="button"
        data-testid="add-expense-btn"
        class="w-full border-2 border-dashed border-green-300 dark:border-green-700 rounded-2xl py-3
               text-sm font-semibold text-green-700 dark:text-green-400 mb-4
               hover:bg-green-50 dark:hover:bg-green-900/10 transition-colors"
        @click="showExpenseForm = true"
      >+ إضافة مصروف</button>

      <!-- Best sellers -->
      <BestSellersCard :items="sellers.items.value" class="mb-4" />

      <!-- Cash drawer summary -->
      <CashDrawerBar
        :cash-usd="drawer.cashUsd.value"
        :cash-syp="drawer.cashSyp.value"
        class="mb-4"
        @tap="showCashDrawer = true"
      />

      <!-- Low-stock card (from Epic 2) -->
      <RouterLink
        to="/products?filter=low-stock"
        class="block bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 mb-4 no-underline"
        data-testid="low-stock-card"
      >
        <div class="flex items-center justify-between">
          <div>
            <p v-if="allClear" class="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ كل المنتجات متوفرة
            </p>
            <template v-else>
              <p class="text-sm text-yellow-600 dark:text-yellow-400 font-semibold mb-1">
                ⚠ مخزون منخفض ({{ lowStockCount }})
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ lowStockTop3.map(p => p.nameAr).join('، ') }}
              </p>
            </template>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-400 rtl:rotate-180"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </div>
      </RouterLink>

    </main>

    <!-- Sticky bottom: New Sale button -->
    <div class="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-3 z-10">
      <button
        type="button"
        :disabled="!canStartSale"
        aria-describedby="no-rate-warning"
        class="w-full h-12 rounded-2xl text-base font-bold text-white bg-blue-600
               hover:bg-blue-700 active:scale-95 transition-all
               disabled:opacity-40 disabled:cursor-not-allowed"
        @click="router.push('/pos')"
      >بيع جديد</button>
    </div>
  </div>

  <!-- Draft recovery dialog (unchanged from Epic 1) -->
  <AppDialog
    v-if="showDraftDialog"
    title="بيع غير مكتمل"
    message="يوجد بيع لم يتم تأكيده. هل تريد المتابعة؟"
    confirm-label="متابعة"
    cancel-label="تجاهل"
    @confirm="handleRestoreDraft"
    @cancel="handleDiscardDraft"
  />

  <!-- Expense form modal -->
  <ExpenseForm
    v-if="showExpenseForm"
    @saved="handleExpenseSaved"
    @cancel="showExpenseForm = false"
  />

  <!-- Profit breakdown sheet -->
  <ProfitSheet
    v-if="showProfitSheet"
    :revenue-usd="metrics.revenueUsd.value"
    :cogs-usd="metrics.cogsUsd.value"
    :expenses-usd="metrics.expensesUsd.value"
    :profit-usd="metrics.profitUsd.value"
    :period="period"
    @close="showProfitSheet = false"
  />

  <!-- Cash drawer detail sheet -->
  <CashDrawerSheet
    v-if="showCashDrawer"
    :cash-usd="drawer.cashUsd.value"
    :cash-syp="drawer.cashSyp.value"
    :movements="drawer.movements.value"
    @close="showCashDrawer = false"
  />

  <!-- Toast -->
  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>
