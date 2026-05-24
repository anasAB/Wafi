<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

type Period      = 'today' | 'week' | 'month'
type DashState   = 'normal' | 'calm' | 'first-time'
type NavTab      = 'home' | 'inventory' | 'customers' | 'reports'
type ExpCurrency = 'USD' | 'SYP'

/* ── Router ─────────────────────────────────────────────── */
const router = useRouter()

/* ── Theme ──────────────────────────────────────────────── */
const isDark = ref(false)

/* ── Demo state switcher (dev only) ─────────────────────── */
const dashState = ref<DashState>('normal')

/* ── Pack gates (demo: all active) ──────────────────────── */
const hasStaffPack    = ref(true)
const hasCustomerPack = ref(true)
const hasReportPack   = ref(true)

/* ── Offline ─────────────────────────────────────────────── */
const isOffline       = ref(false)
const offlineMinutes  = ref(45)

/* ── Period toggle ───────────────────────────────────────── */
const period = ref<Period>('today')
type PLabel  = { ar: string }
const periodLabels: Record<Period, PLabel> = {
  today: { ar: 'اليوم'      },
  week:  { ar: 'هالأسبوع'   },
  month: { ar: 'هالشهر'     },
}
const periods = (['today', 'week', 'month'] as Period[])

/* ── Period data ─────────────────────────────────────────── */
type PData = { profit: number; revenue: number; cost: number; sales: number; expenses: number }
const data: Record<DashState, Record<Period, PData>> = {
  normal: {
    today: { profit: 340,  revenue: 1240,  cost: 900,   sales: 23,  expenses: 3  },
    week:  { profit: 1820, revenue: 6300,  cost: 4480,  sales: 142, expenses: 18 },
    month: { profit: 6540, revenue: 22400, cost: 15860, sales: 589, expenses: 67 },
  },
  calm: {
    today: { profit: 520,  revenue: 1800,  cost: 1280,  sales: 31,  expenses: 2  },
    week:  { profit: 2100, revenue: 7200,  cost: 5100,  sales: 178, expenses: 12 },
    month: { profit: 7800, revenue: 25000, cost: 17200, sales: 620, expenses: 45 },
  },
  'first-time': {
    today: { profit: 0, revenue: 0, cost: 0, sales: 0, expenses: 0 },
    week:  { profit: 0, revenue: 0, cost: 0, sales: 0, expenses: 0 },
    month: { profit: 0, revenue: 0, cost: 0, sales: 0, expenses: 0 },
  },
}

const d            = computed(() => data[dashState.value][period.value])
const profit       = computed(() => d.value.profit)
const revenue      = computed(() => d.value.revenue)
const cost         = computed(() => d.value.cost)
const salesCount   = computed(() => d.value.sales)
const expenseCount = computed(() => d.value.expenses)

/* ── Exchange rate ───────────────────────────────────────── */
const exchangeRate    = ref(13500)
const editingRate     = ref(false)
const tempRate        = ref('')
const rateLastUpdated = ref('اليوم ٨:٣٠ ص')

function startEditRate() { tempRate.value = String(exchangeRate.value); editingRate.value = true }
function saveRate() {
  const n = parseInt(tempRate.value.replace(/,/g, ''))
  if (n > 0) { exchangeRate.value = n; rateLastUpdated.value = 'الآن' }
  editingRate.value = false
}

/* ── Navigation ──────────────────────────────────────────── */
const activeNav = ref<NavTab>('home')

const navItems = computed(() => {
  const base: { id: NavTab; labelAr: string }[] = [
    { id: 'home',      labelAr: 'الرئيسية' },
    { id: 'inventory', labelAr: 'المخزون'  },
  ]
  if (hasCustomerPack.value) base.push({ id: 'customers', labelAr: 'الزبائن'  })
  if (hasReportPack.value)   base.push({ id: 'reports',   labelAr: 'التقارير' })
  return base
})

/* ── Alerts ──────────────────────────────────────────────── */
const alertsData = {
  lowStockCount: 4,
  lowStockNames: ['شاحن iPhone', 'سماعات Samsung'],
  totalDebt:    2100,
  overdueDebt:  680,
  cashVariance: 15,
  cashierName:  'أحمد',
  shiftName:    'وردية اليوم الصباحية',
}
const hasAlerts = computed(() => dashState.value === 'normal')

const showAlertsSheet = ref(false)
const alertsRead      = ref(false)
const hasUnreadAlerts = computed(() => !alertsRead.value && hasAlerts.value)

function openAlertsSheet() { showAlertsSheet.value = true; alertsRead.value = true }

/* ── Cashier shift ───────────────────────────────────────── */
const shift = { name: 'أحمد', open: true, start: '٨:٠٠ ص', cashTotal: 1240 }

/* ── Expense capture sheet ───────────────────────────────── */
const showExpenseSheet = ref(false)
const expPhoto    = ref<string | null>(null)
const expAmount   = ref('')
const expCurrency = ref<ExpCurrency>('USD')
const expCategory = ref('')
const expNote     = ref('')
const savingExp   = ref(false)
const expCats     = ['إيجار', 'فواتير', 'رواتب', 'مستلزمات', 'أخرى']

const expCanSave = computed(() =>
  expPhoto.value !== null && expAmount.value.trim() !== '' && expCategory.value !== ''
)

function pickPhoto() { expPhoto.value = 'mock://receipt.jpg' }

async function saveExpense() {
  if (!expCanSave.value) return
  savingExp.value = true
  await new Promise(r => setTimeout(r, 700))
  savingExp.value = false
  showExpenseSheet.value = false
  expPhoto.value = null; expAmount.value = ''; expCategory.value = ''; expNote.value = ''
}

/* ── Onboarding checklist ────────────────────────────────── */
const onboardDone = ref([false, false, false])
function markOnboard(i: number) {
  if (i === 0 || onboardDone.value[i - 1]) onboardDone.value[i] = true
}

/* ── Helpers ─────────────────────────────────────────────── */
const hour     = new Date().getHours()
const greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير'

function fmtUSD(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtSYP(n: number) {
  return n.toLocaleString('ar-SA') + ' ل.س'
}
function toEastern(n: number) {
  return n.toString().replace(/[0-9]/g, ch => '٠١٢٣٤٥٦٧٨٩'[+ch])
}
</script>

<template>
  <div class="od-page" :class="{ dark: isDark }" dir="rtl">

    <!-- ── Dev controls (remove before prod) ─────────────── -->
    <div class="dev-bar">
      <button @click="isDark = !isDark" class="dev-btn">{{ isDark ? '☀️ فاتح' : '🌙 داكن' }}</button>
      <button @click="dashState = 'normal'"     class="dev-btn" :class="{ active: dashState === 'normal'     }">عادي</button>
      <button @click="dashState = 'calm'"       class="dev-btn" :class="{ active: dashState === 'calm'       }">هادئ</button>
      <button @click="dashState = 'first-time'" class="dev-btn" :class="{ active: dashState === 'first-time' }">أول مرة</button>
      <button @click="isOffline = !isOffline"   class="dev-btn" :class="{ active: isOffline }">أوفلاين</button>
    </div>

    <!-- ── Offline banner (above header) ──────────────────── -->
    <Transition name="banner">
      <div v-if="isOffline" class="offline-banner" role="status">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>تعرض آخر بيانات متزامنة · آخر تحديث منذ {{ toEastern(offlineMinutes) }} دقيقة</span>
      </div>
    </Transition>

    <!-- ══ Element 1 — App Header ══════════════════════════ -->
    <header class="od-header">
      <div class="hdr-right">
        <div class="hdr-greeting">{{ greeting }}</div>
        <div class="hdr-shop">محل النور</div>
      </div>
      <button class="bell-btn" @click="openAlertsSheet" aria-label="التنبيهات">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span v-if="hasUnreadAlerts" class="bell-dot" aria-hidden="true"></span>
      </button>
    </header>

    <!-- ── Scrollable body ─────────────────────────────────── -->
    <div class="od-body">

      <!-- ══ Element 2 — Period Toggle ══════════════════════ -->
      <div class="period-wrap">
        <div class="period-ctrl" role="tablist" aria-label="اختر الفترة الزمنية">
          <button
            v-for="p in periods" :key="p"
            class="period-seg"
            :class="{ active: period === p }"
            role="tab"
            :aria-selected="period === p"
            @click="period = p"
          >{{ periodLabels[p].ar }}</button>
        </div>
      </div>

      <!-- ══ Element 3 — Profit Hero ════════════════════════ -->
      <Transition name="fade" mode="out-in">
        <!-- First-time: zero data -->
        <div v-if="dashState === 'first-time'" key="ft-profit" class="profit-card profit-zero">
          <div class="profit-label zero-lbl">لسا ما سجلت أي بيعة</div>
          <div class="profit-usd zero-usd">$0.00</div>
        </div>

        <!-- Normal / calm: positive profit -->
        <div v-else-if="profit > 0" key="pos-profit" class="profit-card profit-pos">
          <div class="profit-label pos-lbl">ربحت {{ periodLabels[period].ar }}</div>
          <div class="profit-usd pos-usd" dir="ltr">{{ fmtUSD(profit) }}</div>
          <div class="profit-syp pos-syp">{{ fmtSYP(profit * exchangeRate) }}</div>
          <div class="profit-meta pos-meta">من {{ toEastern(salesCount) }} بيعة</div>
        </div>

        <!-- Negative profit: loss -->
        <div v-else-if="profit < 0" key="neg-profit" class="profit-card profit-neg">
          <div class="profit-label neg-lbl">خسرت {{ periodLabels[period].ar }}</div>
          <div class="profit-usd neg-usd" dir="ltr">−{{ fmtUSD(Math.abs(profit)) }}</div>
          <div class="profit-meta neg-meta">مصاريفك أكثر من دخلك اليوم</div>
        </div>

        <!-- Exactly zero and not first-time -->
        <div v-else key="zero-profit" class="profit-card profit-zero">
          <div class="profit-label zero-lbl">لسا ما في مبيعات {{ periodLabels[period].ar }}</div>
          <div class="profit-usd zero-usd">$0.00</div>
        </div>
      </Transition>

      <!-- ══ Element 4 — Income + Expenses ══════════════════ -->
      <div class="ie-row">
        <button class="ie-card" aria-label="عرض المبيعات">
          <div class="ie-label">الدخل</div>
          <div class="ie-val" dir="ltr">{{ dashState === 'first-time' ? '—' : fmtUSD(revenue) }}</div>
          <div class="ie-sub">{{ dashState === 'first-time' ? '' : toEastern(salesCount) + ' بيعة' }}</div>
        </button>
        <button class="ie-card" aria-label="عرض المصاريف">
          <div class="ie-label">المصاريف</div>
          <div class="ie-val" dir="ltr">{{ dashState === 'first-time' ? '—' : fmtUSD(cost) }}</div>
          <div class="ie-sub">{{ dashState === 'first-time' ? '' : toEastern(expenseCount) + ' مصروف' }}</div>
        </button>
      </div>

      <!-- ══ Element 5 — Alerts / Calm / Onboarding ═════════ -->

      <!-- First-time: onboarding card replaces alerts -->
      <div v-if="dashState === 'first-time'" class="onboard-card">
        <div class="onb-header">
          <div class="onb-title">خلينا نجهز محلك</div>
          <div class="onb-sub">٣ خطوات وتكون جاهز</div>
        </div>
        <div class="onb-rows">
          <button
            v-for="(step, i) in ['اضبط سعر الصرف', 'أضف منتجاتك', 'جرّب أول بيعة']"
            :key="i"
            class="onb-row"
            :class="{ done: onboardDone[i], disabled: i > 0 && !onboardDone[i - 1] }"
            @click="markOnboard(i)"
          >
            <div class="onb-check" :class="{ checked: onboardDone[i] }">
              <svg v-if="onboardDone[i]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <span class="onb-text" :class="{ 'onb-done-text': onboardDone[i] }">{{ step }}</span>
          </button>
        </div>
      </div>

      <!-- Calm day: single green success line -->
      <div v-else-if="dashState === 'calm'" class="calm-line" role="status">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>كل شي تمام اليوم</span>
      </div>

      <!-- Normal: alert cards -->
      <div v-else class="alerts-section">
        <div class="sec-title">يحتاج انتباهك</div>

        <!-- Low stock -->
        <button class="alert-card al-amber" @click="activeNav = 'inventory'" aria-label="عرض المخزون المنخفض">
          <svg class="al-ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div class="al-content">
            <div class="al-title">{{ toEastern(alertsData.lowStockCount) }} منتجات قاربت على النفاد</div>
            <div class="al-sub">{{ alertsData.lowStockNames.join('، ') + '، ...' }}</div>
          </div>
          <svg class="al-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        <!-- Customer debt -->
        <button class="alert-card al-blue" @click="activeNav = 'customers'" aria-label="عرض ديون الزبائن">
          <svg class="al-ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          <div class="al-content">
            <div class="al-title">${{ alertsData.totalDebt.toLocaleString() }} ديون على الزبائن</div>
            <div class="al-sub">${{ alertsData.overdueDebt }} منها متأخرة أكثر من ٦٠ يوم</div>
          </div>
          <svg class="al-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        <!-- Cash variance -->
        <button class="alert-card al-red" aria-label="عرض تقرير الوردية">
          <svg class="al-ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div class="al-content">
            <div class="al-title">${{ alertsData.cashVariance }} فرق في الصندوق</div>
            <div class="al-sub">{{ alertsData.cashierName }} · {{ alertsData.shiftName }}</div>
          </div>
          <svg class="al-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      </div>

      <!-- ══ Element 6 — Cashier Activity (Staff Pack) ══════ -->
      <div v-if="hasStaffPack && dashState !== 'first-time'" class="cashier-card">
        <div class="cashier-top">
          <span class="cashier-title">الصندوق الآن</span>
          <span class="shift-badge" :class="shift.open ? 'badge-open' : 'badge-closed'">
            {{ shift.open ? 'مفتوح' : 'مغلق' }}
          </span>
        </div>
        <div class="cashier-bottom">
          <span class="cashier-who">{{ shift.name }} · بدأ {{ shift.start }}</span>
          <span class="cashier-cash" dir="ltr">{{ fmtUSD(shift.cashTotal) }}</span>
        </div>
      </div>

      <!-- ── Open Cashier CTA ───────────────────────────────── -->
      <button class="open-pos-btn" @click="router.push('/pos')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span>افتح الكاشير</span>
      </button>

      <!-- ══ Element 7 — Exchange Rate ══════════════════════ -->
      <div class="rate-card">
        <Transition name="fade" mode="out-in">
          <!-- Display mode -->
          <div v-if="!editingRate" key="display" class="rate-display">
            <div class="rate-info">
              <div class="rate-lbl">سعر الصرف</div>
              <div class="rate-val">${{ (1).toLocaleString() }} = {{ exchangeRate.toLocaleString('ar-SA') }} ل.س</div>
              <div class="rate-ts" :class="{ 'rate-ts-amber': rateLastUpdated === 'أمس' }">
                آخر تحديث: {{ rateLastUpdated }}
              </div>
            </div>
            <button class="rate-edit-btn" @click="startEditRate">تعديل</button>
          </div>

          <!-- Edit mode -->
          <div v-else key="edit" class="rate-edit">
            <div class="rate-edit-row">
              <span class="rate-eq">$١ =</span>
              <input
                v-model="tempRate"
                type="number"
                class="rate-input"
                dir="ltr"
                inputmode="numeric"
                @keyup.enter="saveRate"
                @keyup.escape="editingRate = false"
                aria-label="سعر الصرف بالليرة السورية"
              />
              <span class="rate-suffix">ل.س</span>
            </div>
            <div class="rate-btns">
              <button class="rate-save" @click="saveRate">حفظ</button>
              <button class="rate-cancel" @click="editingRate = false">إلغاء</button>
            </div>
          </div>
        </Transition>
      </div>

      <!-- ══ Element 8 — Record Expense Button ══════════════ -->
      <button class="expense-btn" @click="showExpenseSheet = true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>سجّل مصروف</span>
      </button>

      <div style="height: 16px"></div>

    </div><!-- /.od-body -->

    <!-- ══ Element 9 — Bottom Navigation ══════════════════════ -->
    <nav class="od-nav" aria-label="التنقل الرئيسي">
      <button
        v-for="item in navItems" :key="item.id"
        class="nav-item"
        :class="{ active: activeNav === item.id }"
        @click="activeNav = item.id"
        :aria-label="item.labelAr"
        :aria-current="activeNav === item.id ? 'page' : undefined"
      >
        <!-- Home icon -->
        <svg v-if="item.id === 'home'" width="22" height="22" viewBox="0 0 24 24" :fill="activeNav === 'home' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline v-if="activeNav !== 'home'" points="9 22 9 12 15 12 15 22"/>
        </svg>
        <!-- Inventory icon -->
        <svg v-else-if="item.id === 'inventory'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <!-- Customers icon -->
        <svg v-else-if="item.id === 'customers'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
        <!-- Reports icon -->
        <svg v-else-if="item.id === 'reports'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
        <span class="nav-label">{{ item.labelAr }}</span>
      </button>
    </nav>

    <!-- ══ Expense Capture Bottom Sheet ════════════════════════ -->
    <Transition name="sheet">
      <div v-if="showExpenseSheet" class="sheet-overlay" @click.self="showExpenseSheet = false" role="dialog" aria-modal="true" aria-label="تسجيل مصروف">
        <div class="bottom-sheet">
          <div class="sheet-handle" aria-hidden="true"></div>
          <div class="sheet-header">
            <span class="sheet-title">تسجيل مصروف</span>
            <button class="sheet-close" @click="showExpenseSheet = false" aria-label="إغلاق">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <!-- Photo section -->
          <div class="exp-section">
            <div class="exp-photo-area" :class="{ 'has-photo': expPhoto }" @click="pickPhoto" role="button" aria-label="صوّر الإيصال" tabindex="0" @keyup.enter="pickPhoto">
              <template v-if="!expPhoto">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
                </svg>
                <span class="photo-hint">صوّر الإيصال</span>
              </template>
              <template v-else>
                <div class="photo-preview">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>تمت إضافة الصورة</span>
                </div>
                <button class="photo-remove" @click.stop="expPhoto = null" aria-label="إزالة الصورة">✕</button>
              </template>
            </div>
            <button class="gallery-link" @click="pickPhoto">اختر من الاستوديو</button>
          </div>

          <!-- Amount section -->
          <div class="exp-section">
            <label class="exp-label" for="exp-amount">المبلغ</label>
            <div class="exp-amount-row">
              <input
                id="exp-amount"
                v-model="expAmount"
                type="number"
                class="exp-input"
                dir="ltr"
                inputmode="decimal"
                placeholder="0.00"
              />
              <button class="currency-toggle" @click="expCurrency = expCurrency === 'USD' ? 'SYP' : 'USD'">
                {{ expCurrency === 'USD' ? '$' : 'ل.س' }}
              </button>
            </div>
            <div v-if="expAmount" class="exp-convert">
              <template v-if="expCurrency === 'USD'">
                {{ fmtSYP(parseFloat(expAmount || '0') * exchangeRate) }} تقريباً
              </template>
              <template v-else>
                {{ fmtUSD(parseFloat(expAmount || '0') / exchangeRate) }} تقريباً
              </template>
            </div>
          </div>

          <!-- Category section -->
          <div class="exp-section">
            <div class="exp-label">الفئة</div>
            <div class="cat-row">
              <button
                v-for="cat in expCats" :key="cat"
                class="cat-chip"
                :class="{ active: expCategory === cat }"
                @click="expCategory = cat"
              >{{ cat }}</button>
            </div>
          </div>

          <!-- Note section -->
          <div class="exp-section">
            <label class="exp-label" for="exp-note">ملاحظة (اختياري)</label>
            <input
              id="exp-note"
              v-model="expNote"
              type="text"
              class="exp-input exp-note-input"
              placeholder="مثلاً: دفع إيجار شهر كانون الثاني"
              dir="rtl"
            />
          </div>

          <!-- Save button -->
          <button
            class="exp-save"
            :disabled="!expCanSave || savingExp"
            @click="saveExpense"
          >
            <span v-if="savingExp" class="btn-spinner"></span>
            <span v-else>حفظ المصروف</span>
          </button>

        </div>
      </div>
    </Transition>

    <!-- ══ Alerts History Sheet ═════════════════════════════════ -->
    <Transition name="sheet">
      <div v-if="showAlertsSheet" class="sheet-overlay" @click.self="showAlertsSheet = false" role="dialog" aria-modal="true" aria-label="التنبيهات">
        <div class="bottom-sheet">
          <div class="sheet-handle" aria-hidden="true"></div>
          <div class="sheet-header">
            <span class="sheet-title">التنبيهات</span>
            <button class="sheet-close" @click="showAlertsSheet = false" aria-label="إغلاق">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="alerts-hist-list">
            <div class="hist-item">
              <span class="hist-dot amber-dot"></span>
              <div class="hist-body">
                <div class="hist-text">{{ toEastern(alertsData.lowStockCount) }} منتجات مخزونها منخفض</div>
                <div class="hist-time">اليوم ٩:١٥ ص</div>
              </div>
            </div>
            <div class="hist-item">
              <span class="hist-dot blue-dot"></span>
              <div class="hist-body">
                <div class="hist-text">ديون زبائن مستحقة: ${{ alertsData.totalDebt.toLocaleString() }}</div>
                <div class="hist-time">اليوم ٨:٣٠ ص</div>
              </div>
            </div>
            <div class="hist-item">
              <span class="hist-dot red-dot"></span>
              <div class="hist-body">
                <div class="hist-text">فرق في صندوق {{ alertsData.cashierName }}: ${{ alertsData.cashVariance }}</div>
                <div class="hist-time">أمس ٦:٤٥ م</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

  </div><!-- /.od-page -->
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');

/* ═══════════════════════════════════════════════
   CSS CUSTOM PROPERTIES — Light Mode (default)
═══════════════════════════════════════════════ */
.od-page {
  --bg:           #FFFFFF;
  --bg-muted:     #F3F4F6;
  --bg-card:      #FFFFFF;
  --bg-input:     #FFFFFF;
  --border:       #E5E7EB;
  --text-dark:    #111928;
  --text-body:    #4B5563;
  --text-muted:   #6B7280;
  --text-faint:   #9CA3AF;

  --primary:      #1A56DB;
  --primary-lt:   #EBF1FD;
  --primary-hover:#1447BE;

  --success:      #059669;
  --success-bg:   #D1FAE5;
  --success-dark: #065F46;
  --success-deep: #04342C;

  --warn-bg:      #FEF3C7;
  --warn:         #92400E;
  --warn-medium:  #633806;

  --error:        #DC2626;
  --error-dark:   #991B1B;
  --error-bg:     #FEE2E2;

  --info-bg:      #EBF1FD;
  --info-dark:    #0C447C;
  --info-medium:  #185FA5;

  --nav-bg:       rgba(255,255,255,.96);
  --nav-blur:     blur(12px);
  --shadow-sheet: 0 -4px 32px rgba(0,0,0,.12);
}

/* ── Dark Mode overrides ────────────────────────────────── */
.od-page.dark {
  --bg:           #05080F;
  --bg-muted:     #0D1828;
  --bg-card:      #0D1828;
  --bg-input:     #111D2E;
  --border:       rgba(255,255,255,.08);
  --text-dark:    #E8EDF5;
  --text-body:    #C8D5E8;
  --text-muted:   #637285;
  --text-faint:   #3D4F6B;

  --primary:      #3B82F6;
  --primary-lt:   rgba(59,130,246,.12);
  --primary-hover:#60A5FA;

  --success:      #10B981;
  --success-bg:   rgba(16,185,129,.10);
  --success-dark: #34D399;
  --success-deep: #6EE7B7;

  --warn-bg:      rgba(240,180,41,.08);
  --warn:         #F0B429;
  --warn-medium:  #FCD34D;

  --error:        #EF4444;
  --error-dark:   #FCA5A5;
  --error-bg:     rgba(239,68,68,.08);

  --info-bg:      rgba(59,130,246,.10);
  --info-dark:    #93C5FD;
  --info-medium:  #60A5FA;

  --nav-bg:       rgba(5,8,15,.95);
  --nav-blur:     blur(16px);
  --shadow-sheet: 0 -4px 40px rgba(0,0,0,.5);
}

/* ═══════════════════════════════════════════════
   BASE
═══════════════════════════════════════════════ */
.od-page {
  min-height: 100svh;
  max-width: 430px;
  margin: 0 auto;
  background: var(--bg);
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ── Dev controls ─────────────────────────────────────────── */
.dev-bar {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  background: #1A1A2E;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.dev-btn {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255,255,255,.08);
  color: #9CA3AF;
  border: 1px solid rgba(255,255,255,.1);
  cursor: pointer;
  font-family: 'Tajawal', sans-serif;
  transition: all .15s;
}
.dev-btn:hover { background: rgba(255,255,255,.14); color: #E5E7EB; }
.dev-btn.active { background: #1A56DB; color: #fff; border-color: #1A56DB; }

/* ── Offline banner ────────────────────────────────────────── */
.offline-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--warn-bg);
  color: var(--warn-medium);
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

/* ═══════════════════════════════════════════════
   ELEMENT 1 — APP HEADER
═══════════════════════════════════════════════ */
.od-header {
  height: 64px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 30;
  flex-shrink: 0;
}

.hdr-right {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.hdr-greeting {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.3;
}
.hdr-shop {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-dark);
  line-height: 1.3;
}

.bell-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 50%;
  position: relative;
  transition: background .15s, color .15s;
}
.bell-btn:hover { background: var(--bg-muted); color: var(--text-dark); }
.bell-dot {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 8px;
  height: 8px;
  background: var(--error);
  border-radius: 50%;
  border: 2px solid var(--bg);
}

/* ═══════════════════════════════════════════════
   BODY
═══════════════════════════════════════════════ */
.od-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ═══════════════════════════════════════════════
   ELEMENT 2 — PERIOD TOGGLE
═══════════════════════════════════════════════ */
.period-wrap {
  padding: 0;
}
.period-ctrl {
  display: flex;
  background: var(--bg-muted);
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
  height: 40px;
}
.period-seg {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-family: 'Tajawal', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: background .18s, color .18s, box-shadow .18s;
  height: 100%;
  padding: 0;
}
.period-seg.active {
  background: var(--bg);
  color: var(--primary);
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0,0,0,.10);
}

/* ═══════════════════════════════════════════════
   ELEMENT 3 — PROFIT HERO CARD
═══════════════════════════════════════════════ */
.profit-card {
  border-radius: 12px;
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Positive profit — green */
.profit-pos { background: var(--success-bg); border: 1px solid rgba(5,150,105,.25); }
.pos-lbl   { font-size: 13px; color: var(--success-dark); font-weight: 500; }
.pos-usd   { font-size: 34px; font-weight: 700; color: var(--success-deep); line-height: 1.1; margin: 4px 0 2px; }
.pos-syp   { font-size: 14px; color: var(--success-dark); opacity: .75; }
.pos-meta  { font-size: 12px; color: var(--success-dark); opacity: .65; margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(5,150,105,.15); }

/* Negative profit — red */
.profit-neg { background: var(--error-bg); border: 1px solid rgba(220,38,38,.2); }
.neg-lbl   { font-size: 13px; color: var(--error-dark); font-weight: 500; }
.neg-usd   { font-size: 34px; font-weight: 700; color: var(--error-dark); line-height: 1.1; margin: 4px 0 2px; }
.neg-meta  { font-size: 12px; color: var(--error-dark); opacity: .75; }

/* Zero / neutral */
.profit-zero { background: var(--bg-muted); border: 1px solid var(--border); }
.zero-lbl  { font-size: 14px; color: var(--text-muted); font-weight: 500; }
.zero-usd  { font-size: 34px; font-weight: 700; color: var(--text-muted); line-height: 1.1; margin-top: 4px; }

/* ═══════════════════════════════════════════════
   ELEMENT 4 — INCOME + EXPENSES
═══════════════════════════════════════════════ */
.ie-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ie-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: right;
  font-family: 'Tajawal', sans-serif;
  cursor: pointer;
  transition: background .15s;
}
.ie-card:hover  { background: var(--bg-muted); }
.ie-card:active { transform: scale(.98); }
.ie-label { font-size: 12px; color: var(--text-muted); }
.ie-val   { font-size: 20px; font-weight: 700; color: var(--text-dark); }
.ie-sub   { font-size: 12px; color: var(--text-muted); }

/* ═══════════════════════════════════════════════
   ELEMENT 5 — ALERTS / CALM / ONBOARDING
═══════════════════════════════════════════════ */
.sec-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-dark);
  margin-bottom: 8px;
}

.alerts-section { display: flex; flex-direction: column; gap: 0; }

.alert-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  text-align: right;
  font-family: 'Tajawal', sans-serif;
  background: transparent;
  width: 100%;
  cursor: pointer;
  margin-bottom: 6px;
  transition: opacity .15s, transform .15s;
}
.alert-card:active { transform: scale(.99); opacity: .9; }

.al-amber { background: var(--warn-bg);  border-color: rgba(146,64,14,.2); }
.al-blue  { background: var(--info-bg);  border-color: rgba(26,86,219,.2); }
.al-red   { background: var(--error-bg); border-color: rgba(220,38,38,.2); }

.al-ico { flex-shrink: 0; }
.al-amber .al-ico { color: var(--warn);       }
.al-blue  .al-ico { color: var(--info-medium); }
.al-red   .al-ico { color: var(--error);       }

.al-content { flex: 1; min-width: 0; }
.al-title   { font-size: 14px; font-weight: 700; }
.al-sub     { font-size: 12px; margin-top: 2px; }

.al-amber .al-title { color: var(--warn-medium); }
.al-blue  .al-title { color: var(--info-dark);   }
.al-red   .al-title { color: var(--error-dark);  }
.al-amber .al-sub   { color: var(--warn);         }
.al-blue  .al-sub   { color: var(--info-medium);  }
.al-red   .al-sub   { color: var(--error);         }

.al-chevron { flex-shrink: 0; }
.al-amber .al-chevron { color: var(--warn);       }
.al-blue  .al-chevron { color: var(--info-medium); }
.al-red   .al-chevron { color: var(--error);       }

/* Calm day line */
.calm-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--success-dark);
}
.calm-line svg { color: var(--success); flex-shrink: 0; }

/* Onboarding card */
.onboard-card {
  background: var(--bg-card);
  border-inline-start: 4px solid var(--primary);
  border-radius: 0 10px 10px 0;
  border: 1px solid var(--border);
  border-inline-start-width: 4px;
  border-inline-start-color: var(--primary);
  padding: 16px;
}
.onb-header { margin-bottom: 12px; }
.onb-title  { font-size: 14px; font-weight: 700; color: var(--primary); }
.onb-sub    { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.onb-rows   { display: flex; flex-direction: column; gap: 4px; }
.onb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  font-family: 'Tajawal', sans-serif;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: right;
  width: 100%;
  border-bottom: 1px solid var(--border);
}
.onb-row:last-child { border-bottom: none; }
.onb-row.disabled   { opacity: .45; cursor: default; }

.onb-check {
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 2px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all .2s;
  color: #fff;
}
.onb-check.checked { background: var(--success); border-color: var(--success); }
.onb-text           { font-size: 14px; font-weight: 500; color: var(--text-dark); }
.onb-done-text      { text-decoration: line-through; color: var(--text-muted); }

/* ═══════════════════════════════════════════════
   ELEMENT 6 — CASHIER ACTIVITY CARD
═══════════════════════════════════════════════ */
.cashier-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
}
.cashier-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.cashier-title { font-size: 14px; font-weight: 700; color: var(--text-dark); }

.shift-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 100px;
}
.badge-open   { background: var(--success-bg);  color: var(--success-dark); }
.badge-closed { background: var(--bg-muted);    color: var(--text-muted);   }

.cashier-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.cashier-who  { font-size: 13px; color: var(--text-muted); }
.cashier-cash { font-size: 14px; font-weight: 700; color: var(--text-dark); }

/* ── Open Cashier CTA ──────────────────────────────────── */
.open-pos-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity .15s;
}
.open-pos-btn:active { opacity: .85; }

/* ═══════════════════════════════════════════════
   ELEMENT 7 — EXCHANGE RATE
═══════════════════════════════════════════════ */
.rate-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 13px 16px;
  min-height: 62px;
}
.rate-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.rate-info { display: flex; flex-direction: column; gap: 2px; }
.rate-lbl  { font-size: 12px; color: var(--text-muted); }
.rate-val  { font-size: 15px; font-weight: 700; color: var(--text-dark); }
.rate-ts   { font-size: 11px; color: var(--text-faint); }
.rate-ts-amber { color: var(--warn); }

.rate-edit-btn {
  font-family: 'Tajawal', sans-serif;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 0;
  flex-shrink: 0;
  transition: opacity .15s;
}
.rate-edit-btn:hover { opacity: .7; }

.rate-edit { display: flex; flex-direction: column; gap: 10px; }
.rate-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rate-eq     { font-size: 14px; font-weight: 700; color: var(--text-dark); white-space: nowrap; }
.rate-suffix { font-size: 13px; color: var(--text-muted); white-space: nowrap; }
.rate-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1.5px solid var(--primary);
  border-radius: 8px;
  color: var(--text-dark);
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  font-weight: 700;
  outline: none;
  text-align: left;
}
.rate-input:focus { box-shadow: 0 0 0 3px rgba(26,86,219,.12); }
.rate-input::-webkit-outer-spin-button,
.rate-input::-webkit-inner-spin-button { -webkit-appearance: none; }

.rate-btns  { display: flex; gap: 8px; }
.rate-save {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 700;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 7px 16px;
  cursor: pointer;
  transition: background .15s;
  min-height: 36px;
}
.rate-save:hover { background: var(--primary-hover); }

.rate-cancel {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 500;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px 14px;
  cursor: pointer;
  transition: all .15s;
  min-height: 36px;
}
.rate-cancel:hover { color: var(--text-dark); border-color: var(--text-muted); }

/* ═══════════════════════════════════════════════
   ELEMENT 8 — EXPENSE BUTTON
═══════════════════════════════════════════════ */
.expense-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  height: 52px;
  background: var(--bg);
  color: var(--primary);
  border: 1.5px solid var(--primary);
  border-radius: 10px;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s;
}
.expense-btn:hover  { background: var(--primary-lt); }
.expense-btn:active { transform: scale(.99); }

/* ═══════════════════════════════════════════════
   ELEMENT 9 — BOTTOM NAVIGATION
═══════════════════════════════════════════════ */
.od-nav {
  display: flex;
  background: var(--nav-bg);
  backdrop-filter: var(--nav-blur);
  -webkit-backdrop-filter: var(--nav-blur);
  border-top: 1px solid var(--border);
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  position: sticky;
  bottom: 0;
  z-index: 30;
  flex-shrink: 0;
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-family: 'Tajawal', sans-serif;
  padding: 0;
  transition: color .2s;
  min-height: 44px;
}
.nav-item.active { color: var(--primary); }
.nav-item:active:not(.active) { color: var(--text-muted); }
.nav-label { font-size: 10px; font-weight: 600; letter-spacing: .2px; }

/* ═══════════════════════════════════════════════
   BOTTOM SHEETS
═══════════════════════════════════════════════ */
.sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}
.od-page.dark .sheet-overlay { background: rgba(0,0,0,.7); }

.bottom-sheet {
  background: var(--bg);
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-height: 85svh;
  overflow-y: auto;
  padding: 0 0 env(safe-area-inset-bottom, 16px);
  box-shadow: var(--shadow-sheet);
}

.sheet-handle {
  width: 36px; height: 4px;
  background: var(--border);
  border-radius: 100px;
  margin: 12px auto 8px;
  flex-shrink: 0;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.sheet-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-dark);
}
.sheet-close {
  width: 32px; height: 32px;
  background: var(--bg-muted);
  border: none;
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.sheet-close:hover { background: var(--border); }

/* ── Expense Sheet ─────────────────────────────────────────── */
.exp-section { padding: 16px 20px 0; }
.exp-label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.exp-photo-area {
  height: 140px;
  border-radius: 10px;
  border: 1.5px dashed var(--border);
  background: var(--bg-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  color: var(--text-muted);
  position: relative;
  transition: border-color .2s, background .2s;
}
.exp-photo-area:hover { border-color: var(--primary); background: var(--primary-lt); }
.exp-photo-area.has-photo { border-style: solid; border-color: var(--success); background: var(--success-bg); }
.photo-hint { font-size: 14px; font-weight: 500; color: var(--text-muted); }
.photo-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--success-dark);
  font-size: 14px;
  font-weight: 600;
}
.photo-remove {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 28px; height: 28px;
  background: var(--error-bg);
  border: none;
  border-radius: 50%;
  color: var(--error);
  cursor: pointer;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
.gallery-link {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  padding: 8px 0 0;
  display: block;
  width: 100%;
  text-align: center;
  font-family: 'Tajawal', sans-serif;
  transition: color .15s;
}
.gallery-link:hover { color: var(--primary); }

.exp-amount-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.exp-input {
  flex: 1;
  height: 48px;
  padding: 0 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dark);
  font-family: 'Tajawal', sans-serif;
  font-size: 16px;
  outline: none;
  transition: border-color .2s;
}
.exp-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(26,86,219,.10); }
.exp-input::placeholder { color: var(--text-faint); }
.exp-note-input { text-align: right; direction: rtl; }

.currency-toggle {
  width: 56px;
  height: 48px;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dark);
  font-family: 'Tajawal', sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: background .15s;
}
.currency-toggle:hover { background: var(--primary-lt); color: var(--primary); }

.exp-convert {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
  text-align: left;
}

.cat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cat-chip {
  padding: 8px 14px;
  border-radius: 100px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-body);
  font-family: 'Tajawal', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
  min-height: 36px;
}
.cat-chip:hover  { border-color: var(--primary); color: var(--primary); }
.cat-chip.active { background: var(--primary); color: #fff; border-color: var(--primary); }

.exp-save {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(100% - 40px);
  margin: 20px 20px 8px;
  height: 52px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s, opacity .2s;
}
.exp-save:not(:disabled):hover { background: var(--primary-hover); }
.exp-save:disabled { opacity: .45; cursor: not-allowed; }

.btn-spinner {
  width: 20px; height: 20px;
  border: 2.5px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Alerts History Sheet ─────────────────────────────────── */
.alerts-hist-list {
  padding: 8px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hist-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.hist-item:last-child { border-bottom: none; }
.hist-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}
.amber-dot { background: var(--warn);    }
.blue-dot  { background: var(--primary); }
.red-dot   { background: var(--error);   }

.hist-body { flex: 1; }
.hist-text { font-size: 14px; font-weight: 500; color: var(--text-dark); }
.hist-time { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

/* ═══════════════════════════════════════════════
   TRANSITIONS
═══════════════════════════════════════════════ */
.fade-enter-active,
.fade-leave-active { transition: opacity .15s ease, transform .15s ease; }
.fade-enter-from   { opacity: 0; transform: translateY(6px); }
.fade-leave-to     { opacity: 0; }

.sheet-enter-active,
.sheet-leave-active { transition: opacity .25s ease; }
.sheet-enter-active .bottom-sheet,
.sheet-leave-active .bottom-sheet { transition: transform .25s cubic-bezier(.4,0,.2,1); }
.sheet-enter-from   { opacity: 0; }
.sheet-enter-from   .bottom-sheet { transform: translateY(100%); }
.sheet-leave-to     { opacity: 0; }
.sheet-leave-to     .bottom-sheet { transform: translateY(100%); }

.banner-enter-active,
.banner-leave-active { transition: opacity .2s, max-height .2s; max-height: 48px; }
.banner-enter-from,
.banner-leave-to     { opacity: 0; max-height: 0; overflow: hidden; }
</style>
