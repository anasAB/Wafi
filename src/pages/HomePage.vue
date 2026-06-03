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
  history.sales.value
    .filter(s => s.paymentMethod === 'cash_usd' || s.paymentMethod === 'cash_syp')
    .slice(0, 5)
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

        <!-- SECTIONS ADDED IN LATER TASKS -->

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
</style>
