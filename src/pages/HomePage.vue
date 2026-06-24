<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import VueApexCharts from 'vue3-apexcharts'

import AppDialog   from '@/components/ui/AppDialog.vue'
import AppToast    from '@/components/ui/AppToast.vue'
import ExpenseForm from '@/features/expenses/components/ExpenseForm.vue'
import ProfitSheet from '@/features/dashboard/components/ProfitSheet.vue'
import CashDrawerSheet from '@/features/dashboard/components/CashDrawerSheet.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import ConnectionPill from '@/components/ui/ConnectionPill.vue'
import OperatorSwitchAction from '@/features/staff/components/OperatorSwitchAction.vue'

import { useExchangeRate }     from '@/features/exchange-rate'
import { useSaleDraft }        from '@/composables/useSaleDraft'
import { useLowStockAlerts }   from '@/features/products/composables/useLowStockAlerts'
import { usePeriodToggle }     from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange }        from '@/features/dashboard/composables/periodUtils'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { useBestSellers }      from '@/features/dashboard/composables/useBestSellers'
import { useCashDrawer }       from '@/features/dashboard/composables/useCashDrawer'
import { useSalesChart }       from '@/features/dashboard/composables/useSalesChart'
import { useSaleHistory }      from '@/features/sale-history/useSaleHistory'
import { useDeviceStore }      from '@/store/device.store'
import { db }                  from '@/data/powersync/db'

const router = useRouter()
const device = useDeviceStore()
const { t } = useI18n()

const { currentRate, loadRate } = useExchangeRate()
const { hasDraft, loadDraft, restoreDraft, clearDraft } = useSaleDraft()
const { count: lowStockCount, top3: lowStockTop3, allClear, load: loadAlerts } = useLowStockAlerts()
const { period, setPeriod } = usePeriodToggle()
const metrics    = useDashboardMetrics()
const sellers    = useBestSellers()
const drawer     = useCashDrawer()
const chart      = useSalesChart()
const history    = useSaleHistory()

const showDraftDialog    = ref(false)
const showExpenseForm    = ref(false)
const showProfitSheet    = ref(false)
const showCashDrawer     = ref(false)
const showRateEditor     = ref(false)
const toast              = ref<{ message: string; type: 'success' | 'error' } | null>(null)

const isOnline     = ref(db.currentStatus?.connected ?? false)
const lastSyncedAt = ref<string | null>(localStorage.getItem('wafi_last_synced'))
let syncTimer: ReturnType<typeof setInterval> | null = null
let chartRefreshTimer: ReturnType<typeof setInterval> | null = null

const openCreditCount = ref(0)

async function refreshSalesChart() {
  try {
    await chart.load(period.value)
  } catch {
    // Keep the page stable if refresh fails; next tick/focus will retry.
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void refreshSalesChart()
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadRate(), loadDraft(), loadAlerts()])
    if (hasDraft.value) showDraftDialog.value = true
    await Promise.all([
      metrics.load(period.value),
      sellers.load(period.value),
      drawer.load(period.value),
      refreshSalesChart(),
      history.loadHistory(getDateRange(period.value)),
      loadOpenCreditCount(),
    ])
  } catch { /* errors shown via toast */ }

  // Keep the selected-period chart fresh while the dashboard stays mounted.
  chartRefreshTimer = setInterval(() => {
    if (!document.hidden) {
      void refreshSalesChart()
    }
  }, 30_000)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  syncTimer = setInterval(() => {
    const nowConnected = db.currentStatus?.connected ?? false
    if (nowConnected && !isOnline.value) {
      const now = new Date().toISOString()
      localStorage.setItem('wafi_last_synced', now)
      lastSyncedAt.value = now
    }
    isOnline.value = nowConnected
  }, 60_000)

  if (db.currentStatus?.connected) {
    const now = new Date().toISOString()
    localStorage.setItem('wafi_last_synced', now)
    lastSyncedAt.value = now
    isOnline.value = true
  }
})

onUnmounted(() => {
  if (syncTimer) clearInterval(syncTimer)
  if (chartRefreshTimer) clearInterval(chartRefreshTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

watch(period, async (p) => {
  await Promise.all([
    metrics.load(p),
    sellers.load(p),
    chart.load(p),
    drawer.load(p),
    history.loadHistory(getDateRange(p)),
  ])
})

async function loadOpenCreditCount() {
  // Count customers who still OWE money — credit sales minus payments minus
  // returned goods. The old query counted anyone who ever bought on credit,
  // so paid-off and fully-returned customers stayed in the tally forever.
  const row = await db.getOptional<{ count: number }>(
    `SELECT COUNT(*) as count FROM customers c
     WHERE c.shop_id = ? AND (c.deleted = 0 OR c.deleted IS NULL)
       AND (
         COALESCE((SELECT SUM(total_usd)  FROM sales            WHERE customer_id = c.id AND is_credit = 1 AND shop_id = ?), 0)
       - COALESCE((SELECT SUM(amount_usd) FROM customer_payments WHERE customer_id = c.id                   AND shop_id = ?), 0)
       - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id WHERE s.customer_id = c.id AND s.is_credit = 1 AND r.shop_id = ?), 0)
       ) > 0.001`,
    [device.shopId, device.shopId, device.shopId, device.shopId]
  )
  openCreditCount.value = row?.count ?? 0
}

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
  await Promise.all([metrics.load(period.value), drawer.load(period.value)])
}

// WAFI-054: tap-through from the profit caveat → the products list filtered to
// the products missing a cost, so the owner can fix the source of the estimate.
function goToMissingCostProducts() {
  showProfitSheet.value = false
  router.push('/products?filter=missing-cost')
}

const canStartSale = computed(() => currentRate.value !== null)

const arabicDate = new Intl.DateTimeFormat('ar-SY', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date())

const hour = new Date().getHours()
const greeting = computed(() => {
  if (hour >= 5  && hour < 12) return 'صباح الخير'
  if (hour >= 12 && hour < 17) return 'مساء الخير'
  return 'مساء النور'
})

const revenueSyp = computed(() => currentRate.value ? Math.round(metrics.revenueUsd.value * currentRate.value) : 0)

const profitMarginPct = computed(() => {
  if (!metrics.revenueUsd.value) return 0
  return Math.round((metrics.profitUsd.value / metrics.revenueUsd.value) * 100)
})

const avgPerInvoice = computed(() => {
  if (!metrics.invoiceCount.value) return 0
  return Math.round(metrics.revenueUsd.value / metrics.invoiceCount.value * 100) / 100
})

const hasAlerts = computed(() =>
  !allClear.value || openCreditCount.value > 0
)

const ratePillText = computed(() =>
  currentRate.value
    ? `$١ = ${currentRate.value.toLocaleString('ar-SY')} ل.س`
    : 'حدد سعر الصرف'
)

const recentActivity = computed(() =>
  history.sales.value.slice(0, 5)
)

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)  return 'الآن'
  if (diff < 60) return `منذ ${diff} دقيقة`
  const h = Math.floor(diff / 60)
  return `منذ ${h} ساعة`
}

function formatUsdCompact(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)

  if (abs >= 1_000_000) {
    const unit = abs >= 10_000_000 ? 0 : 1
    return `${sign}$${(abs / 1_000_000).toFixed(unit)}M`
  }

  if (abs >= 1_000) {
    const unit = abs >= 10_000 ? 0 : 1
    return `${sign}$${(abs / 1_000).toFixed(unit)}K`
  }

  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

function formatUsdDetailed(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const chartSeries = computed(() => [
  { name: 'المبيعات', data: chart.data.value.sales  },
  { name: 'الربح',    data: chart.data.value.profit },
])

const chartOptions = computed(() => ({
  chart: {
    background: 'transparent',
    toolbar: { show: false },
    fontFamily: 'Tajawal, sans-serif',
  },
  colors: ['#1A56DB', '#22C55E'],
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.0, stops: [0, 100] },
  },
  stroke: { curve: 'smooth' as const, width: 2 },
  grid: {
    borderColor: 'rgba(255,255,255,0.05)',
    xaxis: { lines: { show: false } },
    padding: { left: 0, right: 0 },
  },
  xaxis: {
    categories: chart.data.value.labels,
    labels: {
      style: { colors: '#637285', fontFamily: 'Tajawal, sans-serif', fontSize: '11px' },
    },
    axisBorder: { show: false },
    axisTicks:  { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: ['#637285'] },
      formatter: formatUsdCompact,
    },
  },
  tooltip: {
    theme: 'dark' as const,
    y: { formatter: formatUsdDetailed },
  },
  legend: { show: false },
  dataLabels: { enabled: false },
}))

const PERIOD_LABEL: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
const PERIOD_HEADING: Record<string, string> = { today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر' }
const ACTIVITY_HEADING: Record<string, string> = { today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر' }
</script>

<template>
  <!-- Page content only — App.vue provides sidebar + bottom nav -->
  <div class="hp-root" dir="rtl">

    <!-- ── HEADER ────────────────────────────────────────── -->
    <header class="hp-header">
      <!-- Mobile: shop name pill -->
      <div class="hp-m hp-shop-pill">
        <svg class="shop-pill-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
        </svg>
        <span class="shop-pill-name">الرئيسية</span>
      </div>
      <!-- Desktop: greeting -->
      <div class="hp-d hp-greeting-hdr">
        <div class="ghdr-main">{{ greeting }}</div>
        <div class="ghdr-date">{{ arabicDate }}</div>
      </div>
      <!-- Header actions -->
      <div class="hp-header-actions">
        <OperatorSwitchAction variant="compact" />
        <ConnectionPill />
        <button class="rate-pill" @click="showRateEditor = true">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
          {{ ratePillText }}
        </button>
        <button class="icon-btn" :class="{ 'has-alert': hasAlerts }" aria-label="التنبيهات">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- ── SCROLLABLE BODY ──────────────────────────────── -->
    <div class="hp-body">

      <!-- Mobile greeting -->
      <div class="hp-m hp-greeting-mobile">
        <p class="gm-date">{{ arabicDate }}</p>
        <h1 class="gm-name">{{ greeting }} 👋</h1>
      </div>

      <!-- Period + sell row -->
      <div class="hp-period-row">
        <div class="hp-d">
          <h2 class="period-heading">{{ PERIOD_HEADING[period] }}</h2>
        </div>
        <div class="period-toggle-wrap">
          <div class="period-toggle">
            <button
              v-for="p in (['today','week','month'] as const)" :key="p"
              class="pt-btn" :class="{ active: period === p }"
              @click="setPeriod(p)"
            >{{ PERIOD_LABEL[p] }}</button>
          </div>
          <button
            class="hp-d sell-btn-inline"
            :disabled="!canStartSale"
            @click="router.push('/pos')"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            بيع جديد
          </button>
        </div>
      </div>

      <!-- KPI strip -->
      <div class="kpi-strip">
        <div
          class="kpi-card kpi-card--invoices"
          role="button"
          tabindex="0"
          aria-label="فتح الفواتير"
          @click="router.push(`/history?period=${period}`)"
          @keydown.enter="router.push(`/history?period=${period}`)"
          @keydown.space.prevent="router.push(`/history?period=${period}`)"
        >
          <div class="kc-icon">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
            </svg>
          </div>
          <div class="kc-label">المال الداخل</div>
          <div class="kc-value" dir="ltr">${{ metrics.revenueUsd.value.toLocaleString() }}</div>
          <div class="kc-accent-bar"></div>
          <div class="kc-sub" v-if="revenueSyp" dir="ltr">{{ revenueSyp.toLocaleString() }} ل.س</div>
        </div>
        <div class="kpi-card" @click="showProfitSheet = true">
          <div class="kc-icon">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div class="kc-label">
            الربح الإجمالي
            <!-- WAFI-054: degrade the headline to "estimated" (never blank) when a
                 sale in the period had no cost — full caveat is in the ProfitSheet. -->
            <span
              v-if="metrics.profitIsEstimated.value"
              class="kc-estimated-badge"
              data-testid="profit-estimated-badge"
            >{{ t('dashboard.profitEstimatedBadge') }}</span>
          </div>
          <div class="kc-value" dir="ltr" :class="metrics.profitUsd.value >= 0 ? 'positive' : 'negative'">
            ${{ metrics.profitUsd.value.toLocaleString() }}
          </div>
          <div class="kc-accent-bar"></div>
          <div class="kc-sub">هامش {{ profitMarginPct }}%</div>
        </div>
        <div class="kpi-card" @click="router.push(`/history?period=${period}`)">
          <div class="kc-icon">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <div class="kc-label">الفواتير</div>
          <div class="kc-value" dir="ltr">{{ metrics.invoiceCount.value.toLocaleString() }}</div>
          <div class="kc-accent-bar"></div>
          <div class="kc-sub" v-if="avgPerInvoice">متوسط ${{ avgPerInvoice }}</div>
        </div>
        <div class="kpi-card" @click="showCashDrawer = true">
          <div class="kc-icon">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          </div>
          <div class="kc-label">النقد في الصندوق</div>
          <div class="kc-value" dir="ltr">${{ drawer.cashUsd.value.toLocaleString() }}</div>
          <div class="kc-accent-bar"></div>
          <div class="kc-sub" v-if="drawer.cashSyp.value" dir="ltr">{{ drawer.cashSyp.value.toLocaleString() }} ل.س</div>
        </div>
      </div>

      <!-- Mobile sell button -->
      <button
        class="hp-m sell-btn-full"
        :disabled="!canStartSale"
        @click="router.push('/pos')"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        بيع جديد
      </button>

      <!-- Two-column layout: chart+sellers | signals+feed -->
      <div class="hp-content-row">

        <!-- Left / main column -->
        <div class="hp-col-main">

          <!-- Area chart -->
          <div class="section-card chart-card">
            <div class="card-hdr">
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="activity-live-dot"></span>
                <span class="card-title">المبيعات والربح — {{ PERIOD_HEADING[period] }} (USD)</span>
              </div>
              <div class="chart-legend">
                <span class="legend-item">
                  <span class="legend-dot legend-dot-sales"></span>
                  <span class="legend-label">المبيعات</span>
                </span>
                <span class="legend-item">
                  <span class="legend-dot legend-dot-profit"></span>
                  <span class="legend-label">الربح</span>
                </span>
              </div>
            </div>
            <VueApexCharts type="area" :height="150" :series="chartSeries" :options="chartOptions" />
          </div>

          <!-- Best sellers -->
          <div class="section-card">
            <div class="card-hdr">
              <span class="card-title">أكثر المنتجات مبيعاً</span>
              <span class="card-badge">حسب الكمية</span>
            </div>
            <div v-if="sellers.items.value.length === 0" class="empty-state">
              لا توجد مبيعات في هذه الفترة
            </div>
            <div v-else class="sellers-table">
              <div
                v-for="(item, i) in sellers.items.value.slice(0, 5)"
                :key="item.nameAr"
                class="seller-row"
              >
                <div class="sr-rank">{{ i + 1 }}</div>
                <div class="sr-name">{{ item.nameAr }}</div>
                <div class="sr-units">{{ item.unitsSold }} مبيعة</div>
                <div class="sr-rev" dir="ltr">${{ item.revenueUsd.toFixed(0) }}</div>
              </div>
            </div>
          </div>

        </div>

        <!-- Right column -->
        <div class="hp-col-right">

          <!-- Health signals -->
          <div class="section-card">
            <div class="card-hdr">
              <span class="card-title">إشارات الصحة</span>
            </div>
            <div class="signals-list">
              <RouterLink
                to="/products?filter=low-stock"
                class="signal-row"
                :class="allClear ? 'sig-green' : 'sig-yellow'"
              >
                <span class="sig-dot" :class="allClear ? 'dot-green' : 'dot-yellow'"></span>
                <div class="sig-body">
                  <div class="sig-main">
                    {{ allClear ? 'كل المنتجات متوفرة' : `${lowStockCount} أصناف مخزون منخفض` }}
                  </div>
                  <div v-if="!allClear" class="sig-sub">
                    {{ lowStockTop3.map(p => p.nameAr).join('، ') }}
                  </div>
                </div>
                <svg class="sig-arr" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </RouterLink>

              <RouterLink
                :to="openCreditCount > 0 ? '/customers?filter=debtors' : '/customers'"
                class="signal-row"
                :class="openCreditCount > 0 ? 'sig-blue' : 'sig-green'"
              >
                <span class="sig-dot" :class="openCreditCount > 0 ? 'dot-blue' : 'dot-green'"></span>
                <div class="sig-body">
                  <div class="sig-main">
                    {{ openCreditCount > 0 ? `${openCreditCount} زبون بفواتير آجل` : 'لا ديون مفتوحة' }}
                  </div>
                </div>
                <svg class="sig-arr" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </RouterLink>

              <div
                class="signal-row"
                :class="profitMarginPct >= 20 ? 'sig-green' : profitMarginPct >= 10 ? 'sig-yellow' : 'sig-red'"
              >
                <span class="sig-dot"
                  :class="profitMarginPct >= 20 ? 'dot-green' : profitMarginPct >= 10 ? 'dot-yellow' : 'dot-red'"
                ></span>
                <div class="sig-body">
                  <div class="sig-main">الهامش {{ profitMarginPct }}%</div>
                  <div class="sig-sub">
                    {{ profitMarginPct >= 20 ? 'هامش صحي' : profitMarginPct >= 10 ? 'هامش متوسط' : 'هامش منخفض' }}
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- Live activity feed (desktop only) -->
          <div class="section-card hp-d">
            <div class="card-hdr">
              <span class="activity-live-dot"></span>
              <span class="card-title">النشاط المباشر</span>
            </div>
            <div v-if="recentActivity.length === 0" class="empty-state">لا يوجد نشاط في {{ ACTIVITY_HEADING[period] }}</div>
            <div v-else class="activity-list">
              <div v-for="sale in recentActivity" :key="sale.id" class="activity-item">
                <div class="ai-amount" dir="ltr">
                  {{ sale.paymentMethod === 'cash_syp'
                    ? (sale.totalSyp ?? 0).toLocaleString() + ' ل.س'
                    : '$' + sale.totalUsd.toFixed(2) }}
                </div>
                <div class="ai-meta">{{ timeAgo(sale.createdAt) }}</div>
              </div>
            </div>
          </div>

          <!-- Add expense -->
          <button class="add-expense-btn" @click="showExpenseForm = true">
            <div class="ae-plus">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </div>
            <div>
              <div class="ae-title">سجّل مصروف</div>
              <div class="ae-sub">صوّر الفاتورة وأدخل المبلغ</div>
            </div>
          </button>

        </div>

      </div><!-- /.hp-content-row -->

      <!-- Bottom padding -->
      <div style="height: 24px"></div>

    </div><!-- /.hp-body -->
  </div><!-- /.hp-root -->

  <!-- ─── Modals ─────────────────────────────────────────── -->
  <AppDialog
    v-if="showDraftDialog"
    title="بيع غير مكتمل"
    message="يوجد بيع لم يتم تأكيده. هل تريد المتابعة؟"
    confirm-label="متابعة"
    cancel-label="تجاهل"
    @confirm="handleRestoreDraft"
    @cancel="handleDiscardDraft"
  />
  <ExpenseForm v-if="showExpenseForm" @saved="handleExpenseSaved" @cancel="showExpenseForm = false" />
  <ProfitSheet
    v-if="showProfitSheet"
    :revenue-usd="metrics.revenueUsd.value"
    :cogs-usd="metrics.cogsUsd.value"
    :expenses-usd="metrics.expensesUsd.value"
    :profit-usd="metrics.profitUsd.value"
    :period="period"
    :profit-is-estimated="metrics.profitIsEstimated.value"
    :costless-sales-in-period="metrics.costlessSalesInPeriod.value"
    @close="showProfitSheet = false"
    @fix="goToMissingCostProducts"
  />
  <CashDrawerSheet
    v-if="showCashDrawer"
    :cash-usd="drawer.cashUsd.value"
    :cash-syp="drawer.cashSyp.value"
    :movements="drawer.movements.value"
    @close="showCashDrawer = false"
  />
  <ExchangeRateEditor v-if="showRateEditor" @close="showRateEditor = false" />
  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>

<style scoped>
/* ─── ROOT ───────────────────────────────────────────────
   App.vue provides the sidebar + bottom nav shell.
   This component is just the page content.
──────────────────────────────────────────────────────── */
.hp-root {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: #06090F;
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
}

/* Responsive helpers (1024px = Tailwind lg, matches AppSidebar breakpoint) */
@media (min-width: 1024px) { .hp-m { display: none !important; } }
@media (max-width: 1023px) { .hp-d { display: none !important; } }

/* ─── HEADER ─────────────────────────────────────────── */
.hp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 56px;
  background: #06090F;
  border-bottom: 1px solid rgba(26,86,219,0.18);
  position: sticky;
  top: 0;
  z-index: 20;
  flex-shrink: 0;
}
@media (min-width: 1024px) {
  .hp-header { height: 64px; padding: 0 28px; }
}

.hp-shop-pill { display: flex; align-items: center; gap: 8px; }
.shop-pill-icon {
  width: 28px; height: 28px;
  background: rgba(26,86,219,.12); border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  color: #60A5FA;
}
.shop-pill-name { font-size: 15px; font-weight: 700; color: #E8EDF5; }

.hp-greeting-hdr { display: flex; flex-direction: column; gap: 2px; }
.ghdr-main { font-size: 15px; font-weight: 700; color: #E8EDF5; }
.ghdr-date { font-size: 11px; color: #637285; }

.hp-header-actions { display: flex; align-items: center; gap: 8px; }

.rate-pill {
  display: flex; align-items: center; gap: 6px;
  background: rgba(26,86,219,.12); border: 1px solid rgba(26,86,219,.35);
  border-radius: 20px; padding: 5px 12px;
  font-family: 'Tajawal', sans-serif;
  font-size: 12px; font-weight: 700; color: #60A5FA; cursor: pointer;
  box-shadow: 0 2px 10px rgba(26,86,219,0.15);
  transition: border-color .2s, background .2s, box-shadow .2s;
}
.rate-pill:hover {
  border-color: rgba(26,86,219,.60);
  background: rgba(26,86,219,.18);
  box-shadow: 0 2px 16px rgba(26,86,219,0.25);
}

.icon-btn {
  width: 36px; height: 36px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.07); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #637285; cursor: pointer; position: relative;
  transition: all .2s;
}
.icon-btn:hover { background: rgba(255,255,255,.09); color: #C8D5E8; }
.icon-btn.has-alert::after {
  content: ''; position: absolute; top: 5px; right: 6px;
  width: 8px; height: 8px;
  background: #EF4444; border-radius: 50%;
  border: 2px solid #06090F;
}

/* ─── BODY ───────────────────────────────────────────── */
.hp-body {
  flex: 1;
  padding: 16px 16px 80px;
}
@media (min-width: 1024px) {
  .hp-body { padding: 24px 28px 40px; }
}

/* ─── MOBILE GREETING ────────────────────────────────── */
.hp-greeting-mobile { margin-bottom: 16px; }
.gm-date { font-size: 11px; color: #637285; margin-bottom: 2px; }
.gm-name { font-size: 21px; font-weight: 800; color: #E8EDF5; }

/* ─── PERIOD ROW ─────────────────────────────────────── */
.hp-period-row {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; margin-bottom: 16px;
}
.period-heading { font-size: 19px; font-weight: 800; color: #E8EDF5; }
.period-toggle-wrap { display: flex; align-items: center; gap: 10px; }
.period-toggle {
  display: flex;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
  border-radius: 10px; padding: 3px; gap: 2px;
}
.pt-btn {
  flex: 1; padding: 7px 14px; border-radius: 8px;
  background: transparent; border: none;
  color: #637285; font-family: 'Tajawal', sans-serif;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .15s, color .15s; white-space: nowrap;
}
.pt-btn.active { background: #1A56DB; color: white; font-weight: 700; }
.pt-btn:hover:not(.active) { color: #C8D5E8; }

/* ─── KPI STRIP ──────────────────────────────────────── */
.kpi-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px; margin-bottom: 16px;
}
@media (min-width: 1024px) {
  .kpi-strip { grid-template-columns: repeat(4, 1fr); }
}

.kpi-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  border-radius: 14px; padding: 14px 15px; cursor: pointer;
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
  transition: border-color .2s, transform .15s, box-shadow .2s;
}
.kpi-card:hover {
  border-color: rgba(26,86,219,0.45);
  box-shadow: 0 4px 28px rgba(26,86,219,0.18), inset 0 1px 0 rgba(255,255,255,0.09);
}
.kpi-card:active { transform: scale(.98); }
/* All four KPI cards now share one surface/border for consistency (BUG-006 of
   the new list). Semantic color stays on the profit *value* (.positive/.negative),
   not the card, so the cards read as one uniform set. */

.kpi-card--invoices {
  border-color: rgba(96,165,250,0.45);
  box-shadow: 0 6px 26px rgba(26,86,219,0.2), inset 0 1px 0 rgba(255,255,255,0.09);
}

.kpi-card--invoices:hover {
  transform: translateY(-1px);
  border-color: rgba(147,197,253,0.75);
  box-shadow: 0 10px 30px rgba(59,130,246,0.28), inset 0 1px 0 rgba(255,255,255,0.1);
}

.kpi-card--invoices:focus-visible {
  outline: none;
  border-color: rgba(147,197,253,0.95);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.26), 0 10px 30px rgba(59,130,246,0.3);
}

.kpi-card--invoices .kc-icon {
  color: #93C5FD;
}

.kpi-card--invoices .kc-accent-bar {
  width: 72%;
  background: linear-gradient(90deg, #60A5FA, rgba(96,165,250,0));
}

.kc-icon { margin-bottom: 8px; color: #637285; }
.kc-label { font-size: 11px; color: #637285; margin-bottom: 5px; }
/* WAFI-054: amber "estimated" chip on the profit tile when cost data is missing. */
.kc-estimated-badge {
  display: inline-block;
  margin-inline-start: 5px;
  padding: 1px 6px;
  border-radius: 9999px;
  font-size: 9px;
  font-weight: 700;
  color: #FCD34D;
  background: rgba(245,158,11,0.12);
  border: 1px solid rgba(245,158,11,0.32);
  vertical-align: middle;
}
.kc-value {
  font-size: 19px; font-weight: 800; color: #E8EDF5;
  text-align: right; margin-bottom: 3px;
}
@media (min-width: 1024px) { .kc-value { font-size: 21px; } }
.kc-value.positive { color: #22C55E; }
.kc-value.negative { color: #EF4444; }
/* Reserve the sub-line height so cards stay equal even when a card has no sub. */
.kc-sub { font-size: 10px; color: #3D4F6B; min-height: 13px; }
.kc-accent-bar {
  height: 2px;
  width: 55%;
  border-radius: 1px;
  background: linear-gradient(90deg, #1A56DB, transparent);
  margin: 4px 0 2px;
}

/* ─── SELL BUTTONS ───────────────────────────────────── */
.sell-btn-inline {
  background: #1A56DB; border: none; border-radius: 10px;
  padding: 9px 18px; display: flex; align-items: center; gap: 7px;
  color: white; font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: 0 3px 12px rgba(26,86,219,.35);
  transition: background .2s, opacity .2s;
}
.sell-btn-inline:disabled { opacity: .4; cursor: not-allowed; }
.sell-btn-inline:not(:disabled):hover { background: #1248B3; }

.sell-btn-full {
  width: 100%; height: 48px; border: none; border-radius: 12px;
  background: #1A56DB; color: white;
  font-family: 'Tajawal', sans-serif; font-size: 15px; font-weight: 700;
  cursor: pointer; margin-bottom: 16px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: 0 4px 16px rgba(26,86,219,.35);
  transition: background .2s, opacity .2s;
}
.sell-btn-full:disabled { opacity: .4; cursor: not-allowed; }
.sell-btn-full:not(:disabled):active { transform: scale(.98); }

/* ─── CONTENT ROW ────────────────────────────────────── */
.hp-content-row {
  display: flex; flex-direction: column; gap: 12px;
}
@media (min-width: 1024px) {
  .hp-content-row {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 14px; align-items: start;
  }
}
.hp-col-main  { display: flex; flex-direction: column; gap: 12px; }
.hp-col-right { display: flex; flex-direction: column; gap: 12px; }

/* ─── SECTION CARD ───────────────────────────────────── */
.section-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.25);
  border-radius: 14px; padding: 16px 18px;
  box-shadow: 0 4px 20px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
}
.card-hdr {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.card-title { font-size: 13px; font-weight: 700; color: #E8EDF5; }

.card-badge {
  font-size: 10px; font-weight: 700;
  color: #60A5FA; background: rgba(26,86,219,.12);
  padding: 3px 8px; border-radius: 20px;
}

/* ─── CHART LEGEND ───────────────────────────────────── */
.chart-legend { display: flex; align-items: center; gap: 12px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.legend-dot        { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.legend-dot-sales  { background: #1A56DB; }
.legend-dot-profit { background: #22C55E; }
.legend-label { font-size: 12px; font-weight: 700; color: #A8B8CC; }

/* ─── BEST SELLERS ───────────────────────────────────── */
.empty-state { font-size: 12px; color: #3D4F6B; text-align: center; padding: 12px 0; }
.sellers-table { display: flex; flex-direction: column; }
.seller-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.05);
}
.seller-row:last-child { border-bottom: none; }
.seller-row:not(:last-child):hover {
  background: rgba(26,86,219,0.06);
  border-radius: 8px;
  padding-inline: 6px;
}
.sr-rank {
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(255,255,255,.05);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #637285; flex-shrink: 0;
}
.sr-name  { flex: 1; font-size: 13px; font-weight: 600; color: #C8D5E8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-units { font-size: 11px; color: #3D4F6B; flex-shrink: 0; }
.sr-rev   { font-size: 13px; font-weight: 700; color: #22C55E; flex-shrink: 0; }

/* ─── HEALTH SIGNALS ─────────────────────────────────── */
.signals-list  { display: flex; flex-direction: column; }
.signal-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.05);
  text-decoration: none; font-family: 'Tajawal', sans-serif;
  background: transparent; border-right: none; border-left: none;
  border-top: none; cursor: pointer; width: 100%; text-align: right;
  transition: opacity .15s;
}
.signal-row:last-child { border-bottom: none; }
.signal-row:hover { opacity: .8; }

.sig-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
.dot-green  { background: #22C55E;  box-shadow: 0 0 8px rgba(34,197,94,.75);  }
.dot-yellow { background: #F59E0B; box-shadow: 0 0 8px rgba(245,158,11,.75); }
.dot-red    { background: #EF4444;    box-shadow: 0 0 8px rgba(239,68,68,.75);  }
.dot-blue   { background: #60A5FA;       box-shadow: 0 0 8px rgba(96,165,250,.75); }

.sig-body { flex: 1; min-width: 0; }
.sig-main { font-size: 12px; font-weight: 700; color: #C8D5E8; }
.sig-sub  { font-size: 11px; color: #3D4F6B; margin-top: 2px; }
.sig-arr  { color: #3D4F6B; flex-shrink: 0; margin-top: 3px; }

/* ─── ACTIVITY FEED ──────────────────────────────────── */
.activity-live-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #22C55E; box-shadow: 0 0 5px rgba(34,197,94,.6);
  flex-shrink: 0;
  animation: livepulse 2s ease-in-out infinite;
}
@keyframes livepulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }

.activity-list { display: flex; flex-direction: column; }
.activity-item {
  padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05);
  display: flex; align-items: center; justify-content: space-between;
}
.activity-item:last-child { border-bottom: none; }
.ai-amount { font-size: 13px; font-weight: 700; color: #E8EDF5; }
.ai-meta   { font-size: 11px; color: #3D4F6B; }

/* ─── ADD EXPENSE ────────────────────────────────────── */
.add-expense-btn {
  display: flex; align-items: center; gap: 12px;
  width: 100%; border: 1.5px dashed rgba(26,86,219,.3);
  border-radius: 12px; padding: 13px 16px;
  background: rgba(26,86,219,.04);
  font-family: 'Tajawal', sans-serif; text-align: right; cursor: pointer;
  transition: background .2s, border-color .2s;
}
.add-expense-btn:hover { background: rgba(26,86,219,.08); border-color: rgba(26,86,219,.5); }
.ae-plus {
  width: 32px; height: 32px; background: #1A56DB; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; flex-shrink: 0;
}
.ae-title { font-size: 13px; font-weight: 700; color: #C8D5E8; }
.ae-sub   { font-size: 11px; color: #3D4F6B; margin-top: 2px; }
</style>
