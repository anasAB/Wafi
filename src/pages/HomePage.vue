<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'

import AppDialog   from '@/components/ui/AppDialog.vue'
import AppToast    from '@/components/ui/AppToast.vue'
import NavIcon     from '@/components/ui/NavIcon.vue'
import ExpenseForm from '@/features/expenses/components/ExpenseForm.vue'
import ProfitSheet from '@/features/dashboard/components/ProfitSheet.vue'
import CashDrawerSheet from '@/features/dashboard/components/CashDrawerSheet.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'

import { useExchangeRate }     from '@/features/exchange-rate'
import { useSaleDraft }        from '@/composables/useSaleDraft'
import { useLowStockAlerts }   from '@/features/products/composables/useLowStockAlerts'
import { usePeriodToggle }     from '@/features/dashboard/composables/usePeriodToggle'
import { useDashboardMetrics } from '@/features/dashboard/composables/useDashboardMetrics'
import { useBestSellers }      from '@/features/dashboard/composables/useBestSellers'
import { useCashDrawer }       from '@/features/dashboard/composables/useCashDrawer'
import { useSalesChart }       from '@/features/dashboard/composables/useSalesChart'
import { useSaleHistory }      from '@/features/sale-history/useSaleHistory'
import { useDeviceStore }      from '@/store/device.store'
import { db }                  from '@/data/powersync/db'

const router = useRouter()
const device = useDeviceStore()

const { currentRate, loadRate } = useExchangeRate()
const { hasDraft, loadDraft, restoreDraft, clearDraft } = useSaleDraft()
const { count: lowStockCount, top3: lowStockTop3, allClear, load: loadAlerts } = useLowStockAlerts()
const { period, setPeriod } = usePeriodToggle()
const metrics    = useDashboardMetrics()
const sellers    = useBestSellers()
const drawer     = useCashDrawer()
const chart      = useSalesChart()
const history    = useSaleHistory()

// Modal state
const showDraftDialog    = ref(false)
const showExpenseForm    = ref(false)
const showProfitSheet    = ref(false)
const showCashDrawer     = ref(false)
const showRateEditor     = ref(false)
const toast              = ref<{ message: string; type: 'success' | 'error' } | null>(null)

// Sync / online status
const isOnline     = ref(db.status?.connected ?? false)
const lastSyncedAt = ref<string | null>(localStorage.getItem('wafi_last_synced'))
let syncTimer: ReturnType<typeof setInterval> | null = null

// Customers with open credit (health signal)
const openCreditCount = ref(0)

onMounted(async () => {
  try {
    await Promise.all([loadRate(), loadDraft(), loadAlerts()])
    if (hasDraft.value) showDraftDialog.value = true
    await Promise.all([
      metrics.load(period.value),
      sellers.load(period.value),
      drawer.load(),
      chart.load(),
      history.loadHistory(),
      loadOpenCreditCount(),
    ])
  } catch { /* errors shown via toast */ }

  syncTimer = setInterval(() => {
    const nowConnected = db.status?.connected ?? false
    if (nowConnected && !isOnline.value) {
      const now = new Date().toISOString()
      localStorage.setItem('wafi_last_synced', now)
      lastSyncedAt.value = now
    }
    isOnline.value = nowConnected
  }, 60_000)

  if (db.status?.connected) {
    const now = new Date().toISOString()
    localStorage.setItem('wafi_last_synced', now)
    lastSyncedAt.value = now
    isOnline.value = true
  }
})

onUnmounted(() => { if (syncTimer) clearInterval(syncTimer) })

watch(period, async (p) => {
  await Promise.all([metrics.load(p), sellers.load(p)])
})

async function loadOpenCreditCount() {
  const row = await db.getOptional<{ count: number }>(
    `SELECT COUNT(DISTINCT customer_id) as count
     FROM sales
     WHERE shop_id = ? AND is_credit = 1 AND customer_id IS NOT NULL`,
    [device.shopId]
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
  await metrics.load(period.value)
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
const profitSyp  = computed(() => currentRate.value ? Math.round(metrics.profitUsd.value  * currentRate.value) : 0)

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
    ? `💱 $١ = ${currentRate.value.toLocaleString('ar-SY')} ل.س`
    : '💱 حدد سعر الصرف'
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
    gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.0, stops: [0, 100] },
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
      style: { colors: '#3D4F6B', fontFamily: 'Tajawal, sans-serif', fontSize: '11px' },
    },
    axisBorder: { show: false },
    axisTicks:  { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: ['#3D4F6B'] },
      formatter: (v: number) => `$${Math.round(v)}`,
    },
  },
  tooltip: {
    theme: 'dark',
    y: { formatter: (v: number) => `$${v.toFixed(2)}` },
  },
  legend: { show: false },
  dataLabels: { enabled: false },
}))

const navItems = [
  { label: 'لوحة التحكم', route: '/',            icon: 'grid'     },
  { label: 'نقطة البيع',  route: '/pos',          icon: 'cart'     },
  { label: 'سجل المبيعات',route: '/history',      icon: 'doc'      },
  { label: 'المخزون',     route: '/products',     icon: 'inventory'},
  { label: 'الزبائن',     route: '/customers',    icon: 'users'    },
  { label: 'المصاريف',    route: '/expenses',     icon: 'expense'  },
]

const bottomNavItems = [
  { label: 'الرئيسية', route: '/',         icon: 'grid'     },
  { label: 'المخزون',  route: '/products', icon: 'inventory'},
  { label: 'الزبائن',  route: '/customers',icon: 'users'    },
  { label: 'التقارير', route: '/history',  icon: 'doc'      },
]

const PERIOD_LABEL: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
const PERIOD_HEADING: Record<string, string> = { today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر' }
</script>

<template>
  <div class="hp-shell" dir="rtl">

    <!-- ═══ SIDEBAR (desktop only) ═══════════════════ -->
    <aside class="hp-sidebar">
      <div class="sb-brand">
        <div class="sb-icon">🏪</div>
        <div>
          <div class="sb-shop-name">محل النور</div>
          <div class="sb-shop-sub">وافي POS</div>
        </div>
      </div>

      <nav class="sb-nav">
        <div class="sb-section-hdr">القائمة</div>
        <RouterLink
          v-for="item in navItems.slice(0, 3)" :key="item.route"
          :to="item.route"
          class="sb-nav-item"
          :class="{ active: $route.path === item.route }"
        >
          <NavIcon :name="item.icon" />
          {{ item.label }}
        </RouterLink>

        <div class="sb-section-hdr" style="margin-top:8px">الإدارة</div>
        <RouterLink
          v-for="item in navItems.slice(3)" :key="item.route"
          :to="item.route"
          class="sb-nav-item"
          :class="{ active: $route.path === item.route }"
        >
          <NavIcon :name="item.icon" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="sb-footer">
        <div class="sb-user">
          <div class="sb-av">م</div>
          <div>
            <div class="sb-user-name">أبو محمد</div>
            <div class="sb-user-role">مالك</div>
          </div>
        </div>
      </div>
    </aside>

    <!-- ═══ MAIN ══════════════════════════════════════ -->
    <div class="hp-main">

      <!-- ── TOPBAR (desktop) / HEADER (mobile) ───── -->
      <header class="hp-header">
        <!-- Mobile: shop name -->
        <div class="hp-m hp-shop-pill">
          <span class="shop-pill-icon">🏪</span>
          <span class="shop-pill-name">محل النور</span>
        </div>
        <!-- Desktop: greeting -->
        <div class="hp-d hp-greeting-hdr">
          <div class="ghdr-main">{{ greeting }}، أبو محمد 👋</div>
          <div class="ghdr-date">{{ arabicDate }}</div>
        </div>
        <!-- Actions -->
        <div class="hp-header-actions">
          <button class="rate-pill" @click="showRateEditor = true">{{ ratePillText }}</button>
          <button class="icon-btn" :class="{ 'has-alert': hasAlerts }" aria-label="التنبيهات">
            <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>
        </div>
      </header>

      <!-- ── SCROLLABLE BODY ───────────────────────── -->
      <div class="hp-body">

        <!-- Greeting (mobile only) -->
        <div class="hp-m hp-greeting-mobile">
          <p class="gm-date">{{ arabicDate }}</p>
          <h1 class="gm-name">أهلاً 👋</h1>
        </div>

        <!-- Period row -->
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
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
      بيع جديد
    </button>
  </div>
</div>

<!-- No rate warning -->
<div v-if="!currentRate" class="no-rate-warning">
  حدد سعر صرف الدولار من الأعلى قبل البدء في البيع.
</div>

<!-- KPI strip -->
<div class="kpi-strip">
  <div class="kpi-card blue-accent" @click="router.push(`/history?period=${period}`)">
    <div class="kc-label">المال الداخل</div>
    <div class="kc-value" dir="ltr">${{ metrics.revenueUsd.value.toLocaleString() }}</div>
    <div class="kc-sub" v-if="revenueSyp">{{ revenueSyp.toLocaleString('ar-SY') }} ل.س</div>
  </div>
  <div class="kpi-card" @click="showProfitSheet = true">
    <div class="kc-label">الربح الإجمالي</div>
    <div class="kc-value" dir="ltr" :class="metrics.profitUsd.value >= 0 ? 'positive' : 'negative'">
      ${{ metrics.profitUsd.value.toLocaleString() }}
    </div>
    <div class="kc-sub">هامش {{ profitMarginPct }}%</div>
  </div>
  <div class="kpi-card">
    <div class="kc-label">الفواتير</div>
    <div class="kc-value">{{ metrics.invoiceCount.value.toLocaleString('ar-SY') }}</div>
    <div class="kc-sub" v-if="avgPerInvoice">متوسط ${{ avgPerInvoice }}</div>
  </div>
  <div class="kpi-card green-accent" @click="showCashDrawer = true">
    <div class="kc-label">النقد في الصندوق</div>
    <div class="kc-value" dir="ltr">${{ drawer.cashUsd.value.toLocaleString() }}</div>
    <div class="kc-sub" v-if="drawer.cashSyp.value">{{ drawer.cashSyp.value.toLocaleString('ar-SY') }} ل.س</div>
  </div>
</div>

<!-- Sell button — mobile full width -->
<button
  class="hp-m sell-btn-full"
  :disabled="!canStartSale"
  @click="router.push('/pos')"
>بيع جديد</button>

<!-- Two-column layout: chart+sellers | signals+feed -->
<div class="hp-content-row">

  <!-- Left column -->
  <div class="hp-col-main">

    <!-- Area chart -->
    <div class="section-card chart-card">
      <div class="card-hdr">
        <span class="card-title">المبيعات والربح — آخر ٧ أيام</span>
        <div class="chart-legend">
          <span class="legend-dot legend-dot-sales"></span>
          <span class="legend-label">المبيعات</span>
          <span class="legend-dot legend-dot-profit"></span>
          <span class="legend-label">الربح</span>
        </div>
      </div>
      <VueApexCharts
        type="area"
        :height="160"
        :series="chartSeries"
        :options="chartOptions"
      />
    </div>

    <!-- Best sellers table -->
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
      v-for="(item, i) in sellers.items.value.slice(0, 3)"
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

  <!-- Right column (desktop only) -->
  <div class="hp-col-right">
    <!-- Health signals -->
<div class="section-card">
  <div class="signals-title">إشارات الصحة</div>
  <div class="signals-list">

    <!-- Low stock -->
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

    <!-- Open credit customers -->
    <RouterLink
      to="/customers"
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

    <!-- Margin signal -->
    <div
      class="signal-row"
      :class="profitMarginPct >= 20 ? 'sig-green' : profitMarginPct >= 10 ? 'sig-yellow' : 'sig-red'"
    >
      <span
        class="sig-dot"
        :class="profitMarginPct >= 20 ? 'dot-green' : profitMarginPct >= 10 ? 'dot-yellow' : 'dot-red'"
      ></span>
      <div class="sig-body">
        <div class="sig-main">الهامش {{ profitMarginPct }}%</div>
        <div class="sig-sub">
          {{ profitMarginPct >= 20 ? 'هامش صحي' : profitMarginPct >= 10 ? 'هامش متوسط' : 'هامش منخفض' }}
        </div>
      </div>
    </div>

    <!-- Cash drawer -->
    <button class="signal-row sig-green" @click="showCashDrawer = true">
      <span class="sig-dot dot-green"></span>
      <div class="sig-body">
        <div class="sig-main">النقد في الصندوق</div>
        <div class="sig-sub" dir="ltr">${{ drawer.cashUsd.value.toFixed(2) }}</div>
      </div>
      <svg class="sig-arr" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </button>

  </div>
</div>

    <!-- Live activity feed (desktop only) -->
<div class="section-card hp-d">
  <div class="activity-hdr">
    <span class="activity-live-dot"></span>
    <span class="card-title">النشاط المباشر</span>
  </div>
  <div v-if="recentActivity.length === 0" class="empty-state">لا يوجد نشاط اليوم</div>
  <div v-else class="activity-list">
    <div v-for="sale in recentActivity" :key="sale.id" class="activity-item">
      <div class="ai-amount" dir="ltr">
        {{ sale.paymentMethod === 'cash_syp'
          ? (sale.totalSyp ?? 0).toLocaleString('ar-SY') + ' ل.س'
          : '$' + sale.totalUsd.toFixed(2) }}
      </div>
      <div class="ai-meta">{{ timeAgo(sale.createdAt) }}</div>
    </div>
  </div>
</div>

<!-- Add expense button (both layouts) -->
<button class="add-expense-btn" @click="showExpenseForm = true">
  <div class="ae-plus">+</div>
  <div>
    <div class="ae-title">سجّل مصروف</div>
    <div class="ae-sub">صوّر الفاتورة وأدخل المبلغ</div>
  </div>
</button>
  </div>

</div>

      </div><!-- /.hp-body -->

      <!-- ── BOTTOM NAV (mobile only) ─────────────── -->
      <nav class="hp-bottom-nav hp-m">
        <RouterLink
          v-for="item in bottomNavItems" :key="item.route"
          :to="item.route"
          class="bn-item"
          :class="{ active: $route.path === item.route }"
        >
          <NavIcon :name="item.icon" class="bn-icon" />
          <span class="bn-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

    </div><!-- /.hp-main -->
  </div><!-- /.hp-shell -->

  <!-- ─── Modals ─────────────────────────────────── -->
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
    @close="showProfitSheet = false"
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
/* ─── TOKENS ─────────────────────────────────────────── */
.hp-shell {
  --bg-main:    #06090F;
  --bg-sidebar: #070B14;
  --bg-card:    #0D1828;
  --accent:     #1A56DB;
  --accent-h:   #1D4ED8;
  --accent-m:   rgba(26,86,219,.12);
  --text-1:     #E8EDF5;
  --text-2:     #C8D5E8;
  --text-3:     #637285;
  --text-4:     #3D4F6B;
  --border:     rgba(255,255,255,.06);
  --green:      #22C55E;
  --yellow:     #F59E0B;
  --red:        #EF4444;
}

/* ─── SHELL ──────────────────────────────────────────── */
.hp-shell {
  min-height: 100svh;
  background: var(--bg-main);
  display: flex;
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
}

/* ─── RESPONSIVE HELPERS ─────────────────────────────── */
@media (min-width: 900px) { .hp-m { display: none !important; } }
@media (max-width: 899px) { .hp-d { display: none !important; } }

/* ─── SIDEBAR ────────────────────────────────────────── */
.hp-sidebar { display: none; }
@media (min-width: 900px) {
  .hp-sidebar {
    display: flex; flex-direction: column;
    width: 220px; flex-shrink: 0;
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border);
    position: sticky; top: 0; height: 100svh;
    overflow-y: auto;
  }
}

.sb-brand {
  display: flex; align-items: center; gap: 12px;
  padding: 22px 18px 18px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  flex-shrink: 0;
}
.sb-icon {
  width: 38px; height: 38px;
  background: var(--accent-m); border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.sb-shop-name { font-size: 14px; font-weight: 800; color: var(--text-1); }
.sb-shop-sub  { font-size: 11px; color: var(--text-4); margin-top: 1px; }

.sb-nav { flex: 1; padding: 14px 10px; display: flex; flex-direction: column; gap: 2px; }
.sb-section-hdr {
  font-size: 10px; font-weight: 700; color: var(--text-4);
  letter-spacing: 1px; padding: 8px 12px 4px;
}
.sb-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 13px; border-radius: 10px;
  color: var(--text-3); font-size: 13px; font-weight: 600;
  text-decoration: none;
  transition: background .15s, color .15s;
}
.sb-nav-item:hover:not(.active) { background: rgba(255,255,255,.04); color: var(--text-2); }
.sb-nav-item.active              { background: var(--accent-m); color: #60A5FA; }

.sb-footer {
  padding: 10px 10px 16px;
  border-top: 1px solid rgba(255,255,255,.05);
  flex-shrink: 0;
}
.sb-user {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 13px; border-radius: 10px;
  background: rgba(255,255,255,.03);
}
.sb-av {
  width: 33px; height: 33px;
  background: var(--accent-m); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800; color: #60A5FA; flex-shrink: 0;
}
.sb-user-name { font-size: 12px; font-weight: 700; color: var(--text-2); }
.sb-user-role { font-size: 10px; color: var(--text-4); }

/* ─── MAIN ───────────────────────────────────────────── */
.hp-main {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  min-height: 100svh;
  background: var(--bg-main);
}

/* ─── HEADER ─────────────────────────────────────────── */
.hp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 18px; height: 58px;
  background: var(--bg-main);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 20;
  flex-shrink: 0;
}
@media (min-width: 900px) {
  .hp-header { height: 64px; padding: 0 30px; }
}
.hp-shop-pill { display: flex; align-items: center; gap: 8px; }
.shop-pill-icon {
  width: 30px; height: 30px;
  background: var(--accent-m); border-radius: 8px;
  display: flex; align-items: center; justify-content: center; font-size: 14px;
}
.shop-pill-name { font-size: 15px; font-weight: 800; color: var(--text-1); }

.hp-greeting-hdr { display: flex; flex-direction: column; gap: 2px; }
.ghdr-main { font-size: 15px; font-weight: 700; color: var(--text-1); }
.ghdr-date { font-size: 11px; color: var(--text-4); }

.hp-header-actions { display: flex; align-items: center; gap: 8px; }
.rate-pill {
  display: flex; align-items: center; gap: 5px;
  background: var(--bg-card); border: 1px solid rgba(26,86,219,.25);
  border-radius: 20px; padding: 5px 12px;
  font-family: 'Tajawal', sans-serif;
  font-size: 12px; font-weight: 700; color: #60A5FA; cursor: pointer;
  transition: border-color .2s;
}
.rate-pill:hover { border-color: rgba(26,86,219,.5); }

.icon-btn {
  width: 36px; height: 36px;
  background: rgba(255,255,255,.05);
  border: 1px solid var(--border); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); cursor: pointer; position: relative;
  transition: all .2s;
}
.icon-btn:hover { background: rgba(255,255,255,.09); color: var(--text-2); }
.icon-btn.has-alert::after {
  content: ''; position: absolute; top: 5px; right: 6px;
  width: 8px; height: 8px;
  background: var(--red); border-radius: 50%;
  border: 2px solid var(--bg-main);
}

/* ─── BODY ───────────────────────────────────────────── */
.hp-body {
  flex: 1; overflow-y: auto;
  padding: 18px 18px 80px;
  -webkit-overflow-scrolling: touch;
}
@media (min-width: 900px) {
  .hp-body { padding: 26px 30px 40px; }
}

/* ─── MOBILE GREETING ────────────────────────────────── */
.hp-greeting-mobile { margin-bottom: 16px; }
.gm-date { font-size: 11px; color: var(--text-4); margin-bottom: 2px; }
.gm-name { font-size: 22px; font-weight: 800; color: var(--text-1); }

/* ─── BOTTOM NAV ─────────────────────────────────────── */
.hp-bottom-nav {
  display: grid; grid-template-columns: repeat(4, 1fr);
  height: 60px;
  background: rgba(6,9,15,.97);
  backdrop-filter: blur(16px);
  border-top: 1px solid var(--border);
  position: sticky; bottom: 0; z-index: 20; flex-shrink: 0;
}
.bn-item {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 3px; text-decoration: none;
  color: #364A66; transition: color .2s;
}
.bn-item.active { color: var(--accent); }
.bn-icon { width: 22px; height: 22px; }
.bn-label { font-size: 9px; font-weight: 600; font-family: 'Tajawal', sans-serif; }

/* ─── PERIOD ROW ─────────────────────────────────────── */
.hp-period-row {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; margin-bottom: 18px;
}
.period-heading { font-size: 20px; font-weight: 800; color: var(--text-1); }
.period-toggle-wrap { display: flex; align-items: center; gap: 10px; }
.period-toggle {
  display: flex;
  background: rgba(255,255,255,.04); border: 1px solid var(--border);
  border-radius: 11px; padding: 3px; gap: 2px;
}
.pt-btn {
  flex: 1; padding: 8px 14px; border-radius: 9px;
  background: transparent; border: none;
  color: var(--text-3); font-family: 'Tajawal', sans-serif;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .15s, color .15s; white-space: nowrap;
}
.pt-btn.active { background: var(--accent); color: white; font-weight: 800; }
.pt-btn:hover:not(.active) { color: var(--text-2); }

/* ─── NO RATE WARNING ────────────────────────────────── */
.no-rate-warning {
  background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.25);
  border-radius: 12px; padding: 10px 14px; margin-bottom: 16px;
  font-size: 13px; color: #FCD34D;
}

/* ─── KPI STRIP ──────────────────────────────────────── */
.kpi-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px; margin-bottom: 18px;
}
@media (min-width: 900px) {
  .kpi-strip { grid-template-columns: repeat(4, 1fr); }
}
.kpi-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 14px; padding: 15px 16px; cursor: pointer;
  transition: border-color .2s;
}
.kpi-card:hover { border-color: rgba(255,255,255,.14); }
.kpi-card.blue-accent  { border-color: rgba(26,86,219,.25); }
.kpi-card.green-accent { border-color: rgba(34,197,94,.18); }

.kc-label { font-size: 11px; color: var(--text-3); margin-bottom: 5px; }
.kc-value {
  font-size: 20px; font-weight: 800; color: var(--text-1);
  text-align: right; margin-bottom: 3px;
}
@media (min-width: 900px) { .kc-value { font-size: 22px; } }
.kc-value.positive { color: var(--green); }
.kc-value.negative { color: var(--red); }
.kc-sub { font-size: 10px; color: var(--text-4); }

/* ─── SELL BUTTONS ───────────────────────────────────── */
.sell-btn-inline {
  background: var(--accent); border: none; border-radius: 11px;
  padding: 9px 20px; display: flex; align-items: center; gap: 7px;
  color: white; font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 800; cursor: pointer;
  box-shadow: 0 3px 14px rgba(26,86,219,.3);
  transition: background .2s, opacity .2s;
}
.sell-btn-inline:disabled { opacity: .4; cursor: not-allowed; }
.sell-btn-inline:not(:disabled):hover { background: var(--accent-h); }

.sell-btn-full {
  width: 100%; height: 50px; border: none; border-radius: 14px;
  background: var(--accent); color: white;
  font-family: 'Tajawal', sans-serif; font-size: 16px; font-weight: 800;
  cursor: pointer; margin-bottom: 18px;
  box-shadow: 0 4px 18px rgba(26,86,219,.35);
  transition: background .2s, opacity .2s;
}
.sell-btn-full:disabled { opacity: .4; cursor: not-allowed; }
.sell-btn-full:not(:disabled):active { transform: scale(.98); }

/* ─── CONTENT ROW ────────────────────────────────────── */
.hp-content-row {
  display: flex; flex-direction: column; gap: 14px;
}
@media (min-width: 900px) {
  .hp-content-row {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 16px; align-items: start;
  }
}
.hp-col-main  { display: flex; flex-direction: column; gap: 14px; }
.hp-col-right { display: flex; flex-direction: column; gap: 14px; }

/* ─── SECTION CARD ───────────────────────────────────── */
.section-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 16px; padding: 18px 20px;
}
.card-hdr {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.card-title { font-size: 13px; font-weight: 700; color: var(--text-1); }

/* ─── CHART LEGEND ───────────────────────────────────── */
.chart-legend { display: flex; align-items: center; gap: 8px; }
.legend-dot        { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.legend-dot-sales  { background: var(--accent); }
.legend-dot-profit { background: var(--green); }
.legend-label { font-size: 11px; color: var(--text-3); }

/* ─── BEST SELLERS ───────────────────────────────────── */
.card-badge {
  font-size: 10px; font-weight: 700;
  color: #60A5FA; background: var(--accent-m);
  padding: 3px 8px; border-radius: 20px;
}
.empty-state { font-size: 12px; color: var(--text-4); text-align: center; padding: 12px 0; }
.sellers-table { display: flex; flex-direction: column; }
.seller-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 0; border-bottom: 1px solid var(--border);
}
.seller-row:last-child { border-bottom: none; }
.sr-rank {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(255,255,255,.05);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: var(--text-3); flex-shrink: 0;
}
.sr-name  { flex: 1; font-size: 13px; font-weight: 600; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-units { font-size: 11px; color: var(--text-4); flex-shrink: 0; }
.sr-rev   { font-size: 13px; font-weight: 700; color: var(--green); flex-shrink: 0; }

/* ─── HEALTH SIGNALS ─────────────────────────────────── */
.signals-title { font-size: 13px; font-weight: 700; color: var(--text-1); margin-bottom: 10px; }
.signals-list  { display: flex; flex-direction: column; }

.signal-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid var(--border);
  text-decoration: none; font-family: 'Tajawal', sans-serif;
  background: transparent; border-right: none; border-left: none;
  border-top: none; cursor: pointer; width: 100%; text-align: right;
  transition: opacity .15s;
}
.signal-row:last-child { border-bottom: none; }
.signal-row:hover { opacity: .8; }

.sig-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px;
}
.dot-green  { background: var(--green);  box-shadow: 0 0 5px rgba(34,197,94,.5);  }
.dot-yellow { background: var(--yellow); box-shadow: 0 0 5px rgba(245,158,11,.5); }
.dot-red    { background: var(--red);    box-shadow: 0 0 5px rgba(239,68,68,.5);  }
.dot-blue   { background: #60A5FA;       box-shadow: 0 0 5px rgba(96,165,250,.5); }

.sig-body { flex: 1; min-width: 0; }
.sig-main { font-size: 12px; font-weight: 700; color: var(--text-2); }
.sig-sub  { font-size: 11px; color: var(--text-4); margin-top: 2px; }
.sig-arr  { color: var(--text-4); flex-shrink: 0; margin-top: 2px; }

/* ─── ACTIVITY FEED ──────────────────────────────────── */
.activity-hdr {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
}
.activity-live-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--green); box-shadow: 0 0 5px rgba(34,197,94,.6);
  flex-shrink: 0;
  animation: livepulse 2s ease-in-out infinite;
}
@keyframes livepulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }

.activity-list { display: flex; flex-direction: column; }
.activity-item {
  padding: 8px 0; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.activity-item:last-child { border-bottom: none; }
.ai-amount { font-size: 13px; font-weight: 700; color: var(--text-1); }
.ai-meta   { font-size: 11px; color: var(--text-4); }

/* ─── ADD EXPENSE ────────────────────────────────────── */
.add-expense-btn {
  display: flex; align-items: center; gap: 12px;
  width: 100%; border: 1.5px dashed rgba(26,86,219,.3);
  border-radius: 14px; padding: 14px 18px;
  background: rgba(26,86,219,.04);
  font-family: 'Tajawal', sans-serif; text-align: right; cursor: pointer;
  transition: background .2s, border-color .2s;
}
.add-expense-btn:hover { background: rgba(26,86,219,.08); border-color: rgba(26,86,219,.5); }
.ae-plus {
  width: 34px; height: 34px; background: var(--accent); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 20px; font-weight: 800; flex-shrink: 0;
}
.ae-title { font-size: 13px; font-weight: 700; color: var(--text-2); }
.ae-sub   { font-size: 11px; color: var(--text-4); margin-top: 2px; }
</style>
