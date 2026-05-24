<script setup lang="ts">
import { ref, computed } from 'vue'

/* ── Time-aware greeting ──────────────────────────────── */
const hour = new Date().getHours()
const greeting = computed(() => {
  if (hour >= 5  && hour < 12) return 'صباح الخير'
  if (hour >= 12 && hour < 17) return 'مساء الخير'
  return 'مساء النور'
})
const dateStr = computed(() =>
  new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
)

/* ── Period toggle ───────────────────────────────────── */
type Period = 'today' | 'week' | 'month'
const period = ref<Period>('today')
const periodLabel: Record<Period, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
const periods = (['today', 'week', 'month'] as Period[])

const periodData: Record<Period, { profit: number; revenue: number; cost: number; invoices: number; expCount: number }> = {
  today: { profit: 340,  revenue: 1240,  cost: 900,   invoices: 24,  expCount: 3  },
  week:  { profit: 1820, revenue: 6300,  cost: 4480,  invoices: 142, expCount: 18 },
  month: { profit: 6540, revenue: 22400, cost: 15860, invoices: 589, expCount: 67 },
}

const d            = computed(() => periodData[period.value])
const profitUSD    = computed(() => d.value.profit)
const revenueUSD   = computed(() => d.value.revenue)
const costUSD      = computed(() => d.value.cost)
const invoiceCount = computed(() => d.value.invoices)
const expenseCount = computed(() => d.value.expCount)
const profitSYP    = computed(() => fmtSYP(profitUSD.value * exchangeRate.value))

/* ── Exchange rate (Sacred Rule #2) ─────────────────── */
const exchangeRate = ref(13500)
const editingRate  = ref(false)
const tempRate     = ref('')

function startEdit() { tempRate.value = String(exchangeRate.value); editingRate.value = true }
function saveRate()  {
  const n = parseInt(tempRate.value.replace(/,/g, ''))
  if (n > 0) exchangeRate.value = n
  editingRate.value = false
}

/* ── Alerts ──────────────────────────────────────────── */
const lowStockCount = ref(5)
const customerDebt  = ref(1240)
const cashVariance  = ref(25)
const hasAlerts = computed(() => lowStockCount.value > 0 || customerDebt.value > 0 || cashVariance.value > 0)

/* ── Live cashier shift ──────────────────────────────── */
const shift = { name: 'أحمد', open: true, openedAt: '٠٨:٣٠ ص', elapsed: '٣س ٤٥د', sales: 18, cashIn: 720 }

/* ── Expense quick action ────────────────────────────── */
const showExpForm = ref(false)
const expAmount   = ref('')
const expNote     = ref('')
const savingExp   = ref(false)

async function saveExpense() {
  if (!expAmount.value) return
  savingExp.value = true
  await new Promise(r => setTimeout(r, 700))
  savingExp.value = false
  showExpForm.value = false
  expAmount.value = ''
  expNote.value = ''
}

/* ── Helpers ─────────────────────────────────────────── */
function fmtSYP(n: number)  { return n.toLocaleString('ar-SA') + ' ل.س' }
function fmtRate(n: number) { return n.toLocaleString('ar-SA') }

/* ── Nav ─────────────────────────────────────────────── */
const activeNav = ref('home')
const navItems = [
  { id: 'home',      icon: '🏠', label: 'الرئيسية' },
  { id: 'inventory', icon: '📦', label: 'المخزون'  },
  { id: 'customers', icon: '👥', label: 'الزبائن'  },
  { id: 'reports',   icon: '📈', label: 'التقارير' },
]

/* ── Inventory view data ─────────────────────────────── */
const products = [
  { name: 'آيفون ١٤ برو',       sku: 'IPH-14P', stock: 3,  threshold: 5,  price: 899 },
  { name: 'سامسونج S٢٣',        sku: 'SAM-S23', stock: 0,  threshold: 3,  price: 749 },
  { name: 'سماعات AirPods Pro', sku: 'APD-PRO', stock: 12, threshold: 10, price: 199 },
  { name: 'شاحن MagSafe ٥٠W',   sku: 'MAG-50W', stock: 8,  threshold: 5,  price: 45  },
  { name: 'كابل USB-C مجدول',   sku: 'USB-C2M', stock: 2,  threshold: 20, price: 8   },
  { name: 'غطاء حماية شفاف',    sku: 'CVR-SLK', stock: 45, threshold: 10, price: 12  },
]
const lowItems = computed(() => products.filter(p => p.stock > 0 && p.stock < p.threshold))
const outItems = computed(() => products.filter(p => p.stock === 0))

/* ── Customers view data ─────────────────────────────── */
const customers = [
  { name: 'أبو خالد',           phone: '٩٤٤ ١٢٣ ٤٥٦', balance: 420, lastDate: '١٥ أبريل' },
  { name: 'شركة النور للتجارة', phone: '٩١٢ ٧٨٩ ٠١٢', balance: 650, lastDate: '٢ مايو'   },
  { name: 'أبو سامر',           phone: '٩٨٨ ٣٤٥ ٦٧٨', balance: 170, lastDate: '١٠ أبريل' },
]
const totalDebt = computed(() => customers.reduce((s, c) => s + c.balance, 0))

/* ── Reports view data ───────────────────────────────── */
const thisMonth = { revenue: 4820, cost: 3240, profit: 1580, invoices: 89 }
const lastMonth = { revenue: 4310, cost: 3000, profit: 1310, invoices: 74 }
function delta(now: number, prev: number) {
  const d2 = Math.round(((now - prev) / prev) * 100)
  return { pct: Math.abs(d2), up: d2 >= 0 }
}
</script>

<template>
  <div class="od-shell" dir="rtl">

    <!-- ── Desktop Sidebar (RIGHT in RTL, first in DOM) ── -->
    <aside class="od-sidebar">
      <div class="sb-brand">
        <span class="sb-shop-icon">🏪</span>
        <div class="sb-brand-text">
          <span class="sb-shop-name">محل النور</span>
          <span class="sb-shop-sub">وافي POS</span>
        </div>
      </div>

      <nav class="sb-nav">
        <button
          v-for="item in navItems" :key="item.id"
          class="snav-item"
          :class="{ active: activeNav === item.id }"
          @click="activeNav = item.id"
        >
          <span class="snav-icon">{{ item.icon }}</span>
          <span class="snav-label">{{ item.label }}</span>
        </button>
      </nav>

      <div class="sb-footer">
        <button class="snav-item snav-settings">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span class="snav-label">الإعدادات</span>
        </button>
        <div class="sb-user">
          <div class="sb-av">م</div>
          <div class="sb-user-info">
            <div class="sb-user-name">أبو محمد</div>
            <div class="sb-user-role">مالك</div>
          </div>
        </div>
      </div>
    </aside>

    <!-- ── Main column ─────────────────────────────────── -->
    <div class="od-main">

      <!-- ── Header ──────────────────────────────────── -->
      <header class="od-header">
        <!-- Mobile: shop name pill -->
        <!-- Mobile: shop name -->
        <div class="od-shop od-m">
          <span class="od-shop-icon">🏪</span>
          <span class="od-shop-name">محل النور</span>
        </div>
        <!-- Desktop: greeting in header -->
        <div class="od-hgreeting od-d">
          <div class="hg-text">{{ greeting }}، أبو محمد 👋</div>
          <div class="hg-date">{{ dateStr }}</div>
        </div>
        <!-- Header actions: bell + cog -->
        <div class="od-header-end">
          <button v-if="activeNav === 'home'" class="bell-btn" aria-label="التنبيهات">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span v-if="hasAlerts" class="bell-dot"></span>
          </button>
          <button class="od-cog" aria-label="الإعدادات">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>

      <!-- ── Scrollable body ──────────────────────────── -->
      <div class="od-body">

        <!-- ── View switcher ───────────────────────────── -->
        <Transition name="vfade" mode="out-in">

          <!-- ══ HOME VIEW — 8 sections ══ -->
          <div v-if="activeNav === 'home'" key="home">
            <div class="home-grid">

              <!-- 1 · GREETING + bell (mobile only — desktop shows in sticky header) -->
              <div class="hg-greeting od-m">
                <div class="hg-g-text">
                  <div class="greeting-text">{{ greeting }}، أبو محمد 👋</div>
                  <div class="greeting-date">{{ dateStr }}</div>
                </div>
                <button class="bell-btn" aria-label="التنبيهات">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  <span v-if="hasAlerts" class="bell-dot"></span>
                </button>
              </div>

              <!-- 2 · PERIOD TOGGLE -->
              <div class="hg-period">
                <div class="period-toggle">
                  <button
                    v-for="p in periods" :key="p"
                    class="period-btn"
                    :class="{ active: period === p }"
                    @click="period = p"
                  >{{ periodLabel[p] }}</button>
                </div>
              </div>

              <!-- 3 · HERO: PROFIT -->
              <div class="profit-card hg-profit">
                <div class="profit-glow"></div>
                <div class="profit-label">ربحت {{ periodLabel[period] }}</div>
                <div class="profit-usd">${{ profitUSD.toLocaleString() }}</div>
                <div class="profit-syp">{{ profitSYP }}</div>
                <div class="profit-meta">من {{ invoiceCount.toLocaleString() }} فاتورة</div>
              </div>

              <!-- 4 · INCOME + EXPENSES -->
              <div class="hg-ie">
                <div class="ie-row">
                  <div class="ie-card income">
                    <div class="ie-icon-wrap income-wrap">↑</div>
                    <div class="ie-nums">
                      <div class="ie-val" dir="ltr">${{ revenueUSD.toLocaleString() }}</div>
                      <div class="ie-label">دخل · {{ invoiceCount }} فاتورة</div>
                    </div>
                  </div>
                  <div class="ie-card expense">
                    <div class="ie-icon-wrap expense-wrap">↓</div>
                    <div class="ie-nums">
                      <div class="ie-val" dir="ltr">${{ costUSD.toLocaleString() }}</div>
                      <div class="ie-label">مصاريف · {{ expenseCount }} عملية</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 5 · ALERTS (only if non-empty) -->
              <div class="hg-alerts" v-if="hasAlerts">
                <div class="sec-hdr">يحتاج انتباهك</div>
                <div class="alerts-stack">
                  <button v-if="lowStockCount > 0" class="alert-item al-yellow" @click="activeNav = 'inventory'">
                    <span class="al-ico">📦</span>
                    <div class="al-text">
                      <div class="al-title">مخزون منخفض</div>
                      <div class="al-sub">{{ lowStockCount }} أصناف تحت الحد الأدنى</div>
                    </div>
                    <span class="al-badge al-badge-yellow">{{ lowStockCount }}</span>
                    <span class="al-arr">←</span>
                  </button>
                  <button v-if="customerDebt > 0" class="alert-item al-blue" @click="activeNav = 'customers'">
                    <span class="al-ico">🤝</span>
                    <div class="al-text">
                      <div class="al-title">ديون مستحقة</div>
                      <div class="al-sub" dir="ltr">${{ customerDebt }} · {{ customers.length }} زبائن</div>
                    </div>
                    <span class="al-badge al-badge-blue">!</span>
                    <span class="al-arr">←</span>
                  </button>
                  <button v-if="cashVariance > 0" class="alert-item al-red">
                    <span class="al-ico">⚠️</span>
                    <div class="al-text">
                      <div class="al-title">فرق في الصندوق</div>
                      <div class="al-sub" dir="ltr">${{ cashVariance }} فرق في وردية أحمد</div>
                    </div>
                    <span class="al-badge al-badge-red">!</span>
                    <span class="al-arr">←</span>
                  </button>
                </div>
              </div>

              <!-- 6 · LIVE CASHIER -->
              <div class="hg-cashier">
                <div class="sec-hdr">الكاشير الآن</div>
                <div class="cashier-card">
                  <div class="cashier-top">
                    <div class="cashier-who">
                      <div class="cashier-av">{{ shift.name.charAt(0) }}</div>
                      <div>
                        <div class="cashier-name">{{ shift.name }}</div>
                        <div class="cashier-since">فتح {{ shift.openedAt }} · {{ shift.elapsed }}</div>
                      </div>
                    </div>
                    <span class="cashier-status" :class="shift.open ? 'cs-open' : 'cs-closed'">
                      {{ shift.open ? '● مفتوح' : '● مغلق' }}
                    </span>
                  </div>
                  <div class="cashier-row">
                    <div class="cashier-stat">
                      <div class="cashier-num">{{ shift.sales }}</div>
                      <div class="cashier-lbl">فاتورة</div>
                    </div>
                    <div class="cashier-div"></div>
                    <div class="cashier-stat">
                      <div class="cashier-num" dir="ltr">${{ shift.cashIn }}</div>
                      <div class="cashier-lbl">نقداً</div>
                    </div>
                    <div class="cashier-div"></div>
                    <div class="cashier-stat">
                      <div class="cashier-num">{{ fmtRate(shift.cashIn * exchangeRate) }}</div>
                      <div class="cashier-lbl">ل.س</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 7 · EXCHANGE RATE -->
              <div class="rate-row hg-rate">
                <div class="rate-left">
                  <span class="rate-icon">💱</span>
                  <span class="rate-static" v-if="!editingRate">$١ = {{ fmtRate(exchangeRate) }} ل.س</span>
                  <div class="rate-edit-inline" v-else>
                    <span class="rate-eq">$١ =</span>
                    <input v-model="tempRate" type="number" class="rate-input" dir="ltr"
                      inputmode="numeric" @keyup.enter="saveRate" @keyup.escape="editingRate = false" />
                    <span class="rate-suffix">ل.س</span>
                  </div>
                </div>
                <div class="rate-actions">
                  <template v-if="!editingRate">
                    <button class="rate-btn" @click="startEdit">تعديل</button>
                  </template>
                  <template v-else>
                    <button class="rate-save" @click="saveRate">حفظ</button>
                    <button class="rate-cancel" @click="editingRate = false">إلغاء</button>
                  </template>
                </div>
              </div>

              <!-- 8 · QUICK ACTION: Photo expense capture -->
              <div class="hg-action">
                <Transition name="ef-fade" mode="out-in">
                  <div v-if="!showExpForm" key="btn" class="quick-action" @click="showExpForm = true">
                    <span class="qa-icon">📷</span>
                    <div class="qa-text">
                      <div class="qa-title">سجّل مصروف</div>
                      <div class="qa-sub">صوّر الفاتورة وأدخل المبلغ</div>
                    </div>
                    <div class="qa-plus">+</div>
                  </div>
                  <div v-else key="form" class="expense-form">
                    <div class="ef-header">
                      <span class="ef-title">📷 مصروف جديد</span>
                      <button class="ef-close" @click="showExpForm = false">✕</button>
                    </div>
                    <input v-model="expAmount" type="number" class="ef-amount"
                      dir="ltr" inputmode="decimal" placeholder="٠.٠٠  $" />
                    <input v-model="expNote" type="text" class="ef-note"
                      placeholder="وصف المصروف (اختياري)" />
                    <button class="ef-save" :disabled="savingExp" @click="saveExpense">
                      {{ savingExp ? 'جاري الحفظ...' : 'حفظ المصروف' }}
                    </button>
                  </div>
                </Transition>
              </div>

            </div><!-- /.home-grid -->
          </div><!-- /home -->

          <!-- ══ INVENTORY VIEW ══ -->
          <div v-else-if="activeNav === 'inventory'" key="inventory">
            <div class="view-header">
              <div class="vh-title">المخزون</div>
              <div class="vh-sub">{{ products.length }} صنف · آخر تحديث: اليوم</div>
            </div>

            <div class="summary-row">
              <div class="sum-card">
                <div class="sum-num">{{ products.length }}</div>
                <div class="sum-label">إجمالي الأصناف</div>
              </div>
              <div class="sum-card warn">
                <div class="sum-num">{{ lowItems.length }}</div>
                <div class="sum-label">مخزون منخفض</div>
              </div>
              <div class="sum-card danger">
                <div class="sum-num">{{ outItems.length }}</div>
                <div class="sum-label">نفد المخزون</div>
              </div>
            </div>

            <div class="sec-hdr" style="margin-top: 8px">الأصناف</div>
            <div class="product-list">
              <div v-for="p in products" :key="p.sku" class="product-row">
                <div class="pr-info">
                  <div class="pr-name">{{ p.name }}</div>
                  <div class="pr-sku">{{ p.sku }}</div>
                </div>
                <div class="pr-right">
                  <div class="pr-stock" :class="p.stock === 0 ? 'stock-out' : p.stock < p.threshold ? 'stock-low' : 'stock-ok'">
                    {{ p.stock === 0 ? 'نفد' : p.stock + ' قطعة' }}
                  </div>
                  <div class="pr-price" dir="ltr">${{ p.price }}</div>
                </div>
              </div>
            </div>
          </div><!-- /inventory -->

          <!-- ══ CUSTOMERS VIEW ══ -->
          <div v-else-if="activeNav === 'customers'" key="customers">
            <div class="view-header">
              <div class="vh-title">الزبائن</div>
              <div class="vh-sub">{{ customers.length }} زبائن بديون مفتوحة</div>
            </div>

            <div class="summary-row">
              <div class="sum-card">
                <div class="sum-num">{{ customers.length }}</div>
                <div class="sum-label">زبائن بديون</div>
              </div>
              <div class="sum-card warn">
                <div class="sum-num" dir="ltr">${{ totalDebt }}</div>
                <div class="sum-label">إجمالي مستحق</div>
              </div>
              <div class="sum-card">
                <div class="sum-num" dir="ltr">${{ fmtRate(totalDebt * exchangeRate) }}</div>
                <div class="sum-label">بالليرة السورية</div>
              </div>
            </div>

            <div class="sec-hdr" style="margin-top: 8px">سجل الديون</div>
            <div class="customer-list">
              <div v-for="c in customers" :key="c.phone" class="customer-row">
                <div class="cu-av">{{ c.name.charAt(0) }}</div>
                <div class="cu-info">
                  <div class="cu-name">{{ c.name }}</div>
                  <div class="cu-date">آخر دفعة: {{ c.lastDate }}</div>
                </div>
                <div class="cu-balance" dir="ltr">${{ c.balance }}</div>
              </div>
            </div>
          </div><!-- /customers -->

          <!-- ══ REPORTS VIEW ══ -->
          <div v-else-if="activeNav === 'reports'" key="reports">
            <div class="view-header">
              <div class="vh-title">التقارير</div>
              <div class="vh-sub">مقارنة هذا الشهر مع الشهر الماضي</div>
            </div>

            <div class="report-grid">
              <div class="report-card">
                <div class="rc-label">الإيراد هذا الشهر</div>
                <div class="rc-val" dir="ltr">${{ thisMonth.revenue.toLocaleString() }}</div>
                <div class="rc-delta" :class="delta(thisMonth.revenue, lastMonth.revenue).up ? 'up' : 'down'">
                  {{ delta(thisMonth.revenue, lastMonth.revenue).up ? '↑' : '↓' }}
                  {{ delta(thisMonth.revenue, lastMonth.revenue).pct }}٪ عن الشهر الماضي
                </div>
              </div>
              <div class="report-card">
                <div class="rc-label">التكلفة هذا الشهر</div>
                <div class="rc-val" dir="ltr">${{ thisMonth.cost.toLocaleString() }}</div>
                <div class="rc-delta" :class="delta(thisMonth.cost, lastMonth.cost).up ? 'down' : 'up'">
                  {{ delta(thisMonth.cost, lastMonth.cost).up ? '↑' : '↓' }}
                  {{ delta(thisMonth.cost, lastMonth.cost).pct }}٪ عن الشهر الماضي
                </div>
              </div>
              <div class="report-card profit-report">
                <div class="rc-label">الربح الصافي</div>
                <div class="rc-val green" dir="ltr">${{ thisMonth.profit.toLocaleString() }}</div>
                <div class="rc-delta up">
                  ↑ {{ delta(thisMonth.profit, lastMonth.profit).pct }}٪ عن الشهر الماضي
                </div>
              </div>
              <div class="report-card">
                <div class="rc-label">عدد الفواتير</div>
                <div class="rc-val">{{ thisMonth.invoices }}</div>
                <div class="rc-delta up">
                  ↑ {{ delta(thisMonth.invoices, lastMonth.invoices).pct }}٪ عن الشهر الماضي
                </div>
              </div>
            </div>

            <div class="rate-row" style="margin-top: 16px">
              <div class="rate-left">
                <span class="rate-icon">💱</span>
                <span class="rate-static">$١ = {{ fmtRate(exchangeRate) }} ل.س</span>
              </div>
              <button class="rate-btn" @click="activeNav = 'home'">تعديل سعر الصرف</button>
            </div>
          </div><!-- /reports -->

        </Transition>

        <div style="height: 20px"></div>
      </div><!-- /.od-body -->

      <!-- ── Bottom nav (mobile only) ────────────────── -->
      <nav class="od-nav od-m">
        <button
          v-for="item in navItems" :key="item.id"
          class="od-nav-item"
          :class="{ active: activeNav === item.id }"
          @click="activeNav = item.id"
        >
          <span class="od-nav-icon">{{ item.icon }}</span>
          <span class="od-nav-label">{{ item.label }}</span>
        </button>
      </nav>

    </div><!-- /.od-main -->
  </div><!-- /.od-shell -->
</template>

<style scoped>

/* ═══════════════════════════════════════════════════════
   SHELL + SIDEBAR
═══════════════════════════════════════════════════════ */

.od-shell {
  min-height: 100svh;
  background: #020509;
  display: flex;
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
}

/* Sidebar hidden on mobile */
.od-sidebar { display: none; }

@media (min-width: 900px) {
  .od-sidebar {
    display: flex;
    flex-direction: column;
    width: 240px;
    flex-shrink: 0;
    background: #070B14;
    border-left: 1px solid rgba(255,255,255,.06);
    position: sticky;
    top: 0;
    height: 100svh;
    overflow-y: auto;
  }
}

.sb-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 20px 20px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  flex-shrink: 0;
}
.sb-shop-icon {
  width: 40px; height: 40px;
  background: rgba(0,204,136,.12);
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.sb-brand-text   { display: flex; flex-direction: column; gap: 1px; }
.sb-shop-name    { font-size: 15px; font-weight: 800; color: #E8EDF5; }
.sb-shop-sub     { font-size: 11px; color: #3D4F6B; }

.sb-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 12px;
}

.snav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-radius: 10px;
  background: transparent;
  border: none;
  color: #637285;
  cursor: pointer;
  font-family: 'Tajawal', sans-serif;
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  transition: background .15s, color .15s;
  width: 100%;
}
.snav-item:hover:not(.active) { background: rgba(255,255,255,.04); color: #C8D5E8; }
.snav-item.active              { background: rgba(0,204,136,.1);   color: #00CC88; }
.snav-icon    { font-size: 18px; flex-shrink: 0; }
.snav-label   { font-size: 14px; }
.snav-settings { color: #3D4F6B; margin-top: 2px; }

.sb-footer {
  padding: 12px;
  border-top: 1px solid rgba(255,255,255,.05);
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.sb-user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255,255,255,.03);
  margin-top: 2px;
}
.sb-av {
  width: 34px; height: 34px;
  background: rgba(0,204,136,.15);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 800; color: #00CC88;
  flex-shrink: 0;
}
.sb-user-info { display: flex; flex-direction: column; gap: 1px; }
.sb-user-name { font-size: 13px; font-weight: 700; color: #C8D5E8; }
.sb-user-role { font-size: 11px; color: #3D4F6B; }

/* ═══════════════════════════════════════════════════════
   MAIN COLUMN
═══════════════════════════════════════════════════════ */

.od-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  min-width: 0;
  background: #06090F;
}

/* Responsive helpers */
@media (min-width: 900px) { .od-m { display: none !important; } }
@media (max-width: 899px) { .od-d { display: none !important; } }

/* ── Header ──────────────────────────────────────────── */
.od-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 60px;
  background: #06090F;
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid rgba(255,255,255,.05);
  flex-shrink: 0;
}

@media (min-width: 900px) {
  .od-header { height: 68px; padding: 0 32px; }
}

.od-shop { display: flex; align-items: center; gap: 9px; }
.od-shop-icon {
  width: 32px; height: 32px;
  background: rgba(0,204,136,.12);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
}
.od-shop-name { font-size: 16px; font-weight: 800; color: #E8EDF5; }

.od-hgreeting { display: flex; flex-direction: column; gap: 2px; }
.hg-text      { font-size: 16px; font-weight: 700; color: #E8EDF5; }
.hg-date      { font-size: 12px; color: #3D4F6B; }

.od-cog {
  width: 40px; height: 40px;
  background: transparent; border: none;
  color: #637285; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px;
  transition: background .2s, color .2s;
}
.od-cog:hover { background: rgba(255,255,255,.06); color: #E8EDF5; }

/* ── Body ────────────────────────────────────────────── */
.od-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 20px 20px 80px;
}

@media (min-width: 900px) {
  .od-body { padding: 28px 32px 40px; }
}

/* Mobile greeting */
.greeting        { display: flex; flex-direction: column; gap: 3px; margin-bottom: 20px; }
.greeting-text   { font-size: 17px; font-weight: 700; color: #E8EDF5; }
.greeting-date   { font-size: 12px; color: #3D4F6B; }

/* ═══════════════════════════════════════════════════════
   CONTENT GRID
   Mobile: single column stack
   Desktop ≥900px: profit(1fr) | attention(300px) top row,
                   rate bar full width,
                   stats full width
═══════════════════════════════════════════════════════ */

.od-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

@media (min-width: 900px) {
  .od-grid {
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-areas:
      "profit attention"
      "rate   rate"
      "stats  stats";
    gap: 16px;
    align-items: start;
  }
  .od-a-profit    { grid-area: profit; }
  .od-a-attention { grid-area: attention; }
  .od-a-rate      { grid-area: rate; }
  .od-a-stats     { grid-area: stats; }
}

/* ═══════════════════════════════════════════════════════
   PROFIT CARD — the emotional anchor
═══════════════════════════════════════════════════════ */

.profit-card {
  background: linear-gradient(145deg, #071F0F 0%, #0B3018 60%, #07200F 100%);
  border: 1px solid rgba(0,204,136,.22);
  border-radius: 20px;
  padding: 28px 24px 22px;
  position: relative;
  overflow: hidden;
}

@media (min-width: 900px) {
  .profit-card { padding: 36px 32px 28px; }
}

.profit-glow {
  position: absolute;
  width: 320px; height: 320px;
  background: radial-gradient(circle, rgba(0,204,136,.13) 0%, transparent 70%);
  top: -90px; left: -90px;
  pointer-events: none;
}

.profit-label {
  font-size: 13px; font-weight: 700;
  color: rgba(0,204,136,.65);
  letter-spacing: .3px;
  margin-bottom: 12px;
  position: relative;
}

.profit-usd {
  font-size: 56px; font-weight: 900;
  color: #E8EDF5;
  line-height: 1;
  margin-bottom: 6px;
  letter-spacing: -1px;
  position: relative;
  direction: ltr;
  text-align: right;
}

@media (min-width: 900px) {
  .profit-usd { font-size: 76px; }
}

.profit-syp {
  font-size: 20px; font-weight: 700;
  color: rgba(0,204,136,.7);
  margin-bottom: 18px;
  position: relative;
}

.profit-meta {
  font-size: 12px;
  color: rgba(255,255,255,.3);
  position: relative;
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,.07);
}
.profit-open { color: rgba(240,180,41,.6); }

/* ═══════════════════════════════════════════════════════
   ATTENTION SECTION
═══════════════════════════════════════════════════════ */

.od-a-attention { display: flex; flex-direction: column; gap: 10px; }

.sec-hdr {
  font-size: 11px; font-weight: 700;
  color: #3D4F6B;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 2px;
}

/* 2-col on mobile → 1-col inside the 300px sidebar column */
.attention-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (min-width: 900px) {
  .attention-col { grid-template-columns: 1fr; }
}

.att-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 14px;
  border-radius: 14px;
  cursor: pointer;
  text-align: right;
  border: 1px solid transparent;
  font-family: 'Tajawal', sans-serif;
  background: transparent;
  transition: transform .15s, border-color .15s, background .15s;
}
.att-card:active { transform: scale(.97); }

.att-card.yellow { background: rgba(240,180,41,.07); border-color: rgba(240,180,41,.2); }
.att-card.yellow:hover { background: rgba(240,180,41,.11); border-color: rgba(240,180,41,.32); }

.att-card.blue { background: rgba(75,158,255,.07); border-color: rgba(75,158,255,.2); }
.att-card.blue:hover { background: rgba(75,158,255,.11); border-color: rgba(75,158,255,.32); }

.att-top   { display: flex; justify-content: space-between; align-items: center; }
.att-ico   { font-size: 22px; }

.att-badge {
  font-size: 10px; font-weight: 800;
  padding: 2px 7px; border-radius: 100px;
}
.yellow-badge { background: rgba(240,180,41,.2); color: #F0B429; }
.blue-badge   { background: rgba(75,158,255,.2);  color: #4B9EFF; }

.att-title { font-size: 13px; font-weight: 800; color: #E8EDF5; margin-top: 4px; }
.att-sub   { font-size: 12px; color: #637285; }
.att-cta   { font-size: 11px; font-weight: 700; margin-top: 6px; }
.att-card.yellow .att-cta { color: rgba(240,180,41,.8); }
.att-card.blue   .att-cta { color: rgba(75,158,255,.8); }

/* ═══════════════════════════════════════════════════════
   EXCHANGE RATE BAR
═══════════════════════════════════════════════════════ */

.rate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 13px;
  padding: 13px 16px;
  gap: 12px;
  min-height: 50px;
}

.rate-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.rate-icon   { font-size: 16px; flex-shrink: 0; }
.rate-static { font-size: 14px; font-weight: 700; color: #C8D5E8; }

.rate-edit-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.rate-eq { font-size: 14px; font-weight: 700; color: #C8D5E8; white-space: nowrap; }

.rate-input {
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(0,204,136,.35);
  border-radius: 8px;
  color: #E8EDF5;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px; font-weight: 700;
  padding: 4px 10px;
  width: 90px;
  outline: none;
  min-height: 34px;
  text-align: left;
}
.rate-input:focus {
  border-color: #00CC88;
  box-shadow: 0 0 0 3px rgba(0,204,136,.12);
}
.rate-input::-webkit-outer-spin-button,
.rate-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.rate-suffix  { font-size: 13px; color: #637285; white-space: nowrap; }
.rate-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.rate-btn {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 700;
  color: #00CC88;
  background: rgba(0,204,136,.1);
  border: 1px solid rgba(0,204,136,.22);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  min-height: 34px;
  transition: background .2s;
}
.rate-btn:hover { background: rgba(0,204,136,.18); }

.rate-save {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 800;
  color: #03070D; background: #00CC88;
  border: none; border-radius: 8px;
  padding: 6px 14px; min-height: 34px; cursor: pointer;
  transition: background .2s;
}
.rate-save:hover { background: #00DFA0; }

.rate-cancel {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  color: #637285; background: transparent;
  border: 1px solid rgba(255,255,255,.08); border-radius: 8px;
  padding: 6px 12px; min-height: 34px; cursor: pointer;
  transition: all .2s;
}
.rate-cancel:hover { color: #E8EDF5; border-color: rgba(255,255,255,.18); }

/* ═══════════════════════════════════════════════════════
   STATS GRID
═══════════════════════════════════════════════════════ */

.od-a-stats { display: flex; flex-direction: column; gap: 10px; }

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (min-width: 900px) {
  .stats-grid { grid-template-columns: repeat(4, 1fr); }
}

.stat-box {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 13px;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sb-label {
  font-size: 11px; font-weight: 700;
  color: #3D4F6B;
  letter-spacing: .3px;
}
.sb-val {
  font-size: 20px; font-weight: 800;
  color: #C8D5E8;
  direction: ltr;
  text-align: right;
}

/* ═══════════════════════════════════════════════════════
   BOTTOM NAV (mobile only — hidden ≥900px via .od-m)
═══════════════════════════════════════════════════════ */

.od-nav {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: 62px;
  background: rgba(6,9,15,.96);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid rgba(255,255,255,.07);
  position: sticky;
  bottom: 0;
  flex-shrink: 0;
  z-index: 20;
}

.od-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: transparent;
  border: none;
  color: #364A66;
  cursor: pointer;
  font-family: 'Tajawal', sans-serif;
  transition: color .2s;
  padding: 0;
}
.od-nav-item.active            { color: #00CC88; }
.od-nav-item:active:not(.active) { color: #8A9BBF; }

.od-nav-icon  { font-size: 22px; line-height: 1; }
.od-nav-label { font-size: 10px; font-weight: 600; letter-spacing: .3px; }

/* ── Header end cluster (bell + cog) ──────────────────── */
.od-header-end { display: flex; align-items: center; gap: 6px; }

.bell-btn {
  width: 40px; height: 40px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #637285; cursor: pointer;
  position: relative;
  transition: background .2s, color .2s;
}
.bell-btn:hover { background: rgba(255,255,255,.09); color: #C8D5E8; }
.bell-dot {
  position: absolute; top: 5px; right: 6px;
  width: 9px; height: 9px;
  background: #FF6B6B; border-radius: 50%;
  border: 2px solid #06090F;
}

/* ── HOME GRID ─────────────────────────────────────────── */
/* Mobile: single column. Desktop ≥900px: 2-col named areas */

.home-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

@media (min-width: 900px) {
  .home-grid {
    grid-template-columns: 1fr 300px;
    grid-template-areas:
      "period   period"
      "profit   alerts"
      "ie       rate"
      "cashier  action";
    gap: 16px;
    align-items: start;
  }
  .hg-period  { grid-area: period;  }
  .hg-profit  { grid-area: profit;  }
  .hg-ie      { grid-area: ie;      }
  .hg-alerts  { grid-area: alerts;  }
  .hg-cashier { grid-area: cashier; }
  .hg-rate    { grid-area: rate;    }
  .hg-action  { grid-area: action;  }
}

/* ── 1 · Greeting row (mobile only) ──────────────────── */
.hg-greeting {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hg-g-text { display: flex; flex-direction: column; gap: 2px; }

/* ── 2 · Period toggle ───────────────────────────────── */
.period-toggle {
  display: flex;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 13px;
  padding: 4px;
  gap: 3px;
}
.period-btn {
  flex: 1;
  padding: 9px 0;
  border-radius: 10px;
  background: transparent; border: none;
  color: #637285;
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background .2s, color .2s;
}
.period-btn.active  { background: #00CC88; color: #021008; font-weight: 800; }
.period-btn:hover:not(.active) { color: #C8D5E8; }

/* ── 4 · Income + Expenses ───────────────────────────── */
.ie-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.ie-card {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 14px;
  padding: 16px 14px;
  display: flex; align-items: center; gap: 12px;
}
.ie-card.income  { border-color: rgba(0,204,136,.14); }
.ie-card.expense { border-color: rgba(255,90,90,.1);  }

.ie-icon-wrap {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 800; flex-shrink: 0;
}
.income-wrap  { background: rgba(0,204,136,.12); color: #00CC88; }
.expense-wrap { background: rgba(255,90,90,.1);  color: #FF6B6B; }

.ie-nums { flex: 1; min-width: 0; }
.ie-val  { font-size: 18px; font-weight: 800; color: #C8D5E8; }
.ie-label { font-size: 11px; color: #3D4F6B; margin-top: 3px; }

/* ── 5 · Alerts ──────────────────────────────────────── */
.hg-alerts { display: flex; flex-direction: column; gap: 8px; }
.alerts-stack { display: flex; flex-direction: column; gap: 6px; }

.alert-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 12px;
  cursor: pointer; text-align: right;
  border: 1px solid transparent;
  font-family: 'Tajawal', sans-serif;
  background: transparent; width: 100%;
  transition: background .15s, border-color .15s;
}
.al-yellow { background: rgba(240,180,41,.07); border-color: rgba(240,180,41,.18); }
.al-yellow:hover { background: rgba(240,180,41,.12); border-color: rgba(240,180,41,.3); }
.al-blue   { background: rgba(75,158,255,.07);  border-color: rgba(75,158,255,.18); }
.al-blue:hover   { background: rgba(75,158,255,.12); border-color: rgba(75,158,255,.3); }
.al-red    { background: rgba(255,90,90,.07);   border-color: rgba(255,90,90,.18); }
.al-red:hover    { background: rgba(255,90,90,.12);  border-color: rgba(255,90,90,.3); }

.al-ico  { font-size: 20px; flex-shrink: 0; }
.al-text { flex: 1; min-width: 0; }
.al-title { font-size: 13px; font-weight: 700; color: #E8EDF5; }
.al-sub   { font-size: 11px; color: #637285; margin-top: 2px; }
.al-arr   { font-size: 14px; color: #3D4F6B; flex-shrink: 0; }

.al-badge { font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 100px; flex-shrink: 0; }
.al-badge-yellow { background: rgba(240,180,41,.2); color: #F0B429; }
.al-badge-blue   { background: rgba(75,158,255,.2); color: #4B9EFF; }
.al-badge-red    { background: rgba(255,90,90,.2);  color: #FF6B6B; }

/* ── 6 · Live cashier ────────────────────────────────── */
.hg-cashier { display: flex; flex-direction: column; gap: 8px; }

.cashier-card {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 16px;
  padding: 18px 20px;
}
.cashier-top {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.cashier-who {
  display: flex; align-items: center; gap: 11px;
}
.cashier-av {
  width: 38px; height: 38px;
  background: rgba(0,204,136,.12); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 800; color: #00CC88; flex-shrink: 0;
}
.cashier-name  { font-size: 14px; font-weight: 700; color: #E8EDF5; }
.cashier-since { font-size: 11px; color: #3D4F6B; margin-top: 2px; }
.cashier-status { font-size: 12px; font-weight: 700; }
.cs-open   { color: #00CC88; }
.cs-closed { color: #637285; }

.cashier-row {
  display: flex; align-items: center;
  background: rgba(255,255,255,.03);
  border-radius: 10px; padding: 11px 0;
}
.cashier-stat { flex: 1; text-align: center; }
.cashier-num  { font-size: 16px; font-weight: 800; color: #C8D5E8; }
.cashier-lbl  { font-size: 10px; color: #3D4F6B; margin-top: 2px; }
.cashier-div  { width: 1px; height: 28px; background: rgba(255,255,255,.07); flex-shrink: 0; }

/* ── 8 · Quick action ────────────────────────────────── */
.quick-action {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px;
  background: rgba(0,204,136,.04);
  border: 1.5px dashed rgba(0,204,136,.25);
  border-radius: 16px; cursor: pointer;
  font-family: 'Tajawal', sans-serif; text-align: right; width: 100%;
  transition: background .2s, border-color .2s;
}
.quick-action:hover { background: rgba(0,204,136,.08); border-color: rgba(0,204,136,.42); }
.qa-icon { font-size: 28px; flex-shrink: 0; }
.qa-text { flex: 1; }
.qa-title { font-size: 15px; font-weight: 700; color: #C8D5E8; }
.qa-sub   { font-size: 12px; color: #3D4F6B; margin-top: 3px; }
.qa-plus  {
  width: 32px; height: 32px;
  background: #00CC88; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #021008; font-size: 22px; font-weight: 800; flex-shrink: 0;
}

.expense-form {
  background: #0D1828;
  border: 1px solid rgba(0,204,136,.2);
  border-radius: 16px;
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 10px;
}
.ef-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 2px;
}
.ef-title { font-size: 14px; font-weight: 700; color: #C8D5E8; }
.ef-close {
  width: 28px; height: 28px;
  background: rgba(255,255,255,.05); border: none; border-radius: 50%;
  color: #637285; cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.ef-close:hover { background: rgba(255,255,255,.1); color: #E8EDF5; }

.ef-amount, .ef-note {
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px;
  color: #E8EDF5;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px; padding: 12px 14px; outline: none;
  transition: border-color .2s;
}
.ef-amount:focus, .ef-note:focus { border-color: rgba(0,204,136,.4); }
.ef-note { text-align: right; direction: rtl; }

.ef-save {
  background: #00CC88; border: none; border-radius: 10px;
  color: #021008;
  font-family: 'Tajawal', sans-serif;
  font-size: 14px; font-weight: 800;
  padding: 13px; cursor: pointer;
  transition: background .2s, opacity .2s;
}
.ef-save:disabled { opacity: .65; cursor: not-allowed; }
.ef-save:not(:disabled):hover { background: #00DFA0; }

.ef-fade-enter-active,
.ef-fade-leave-active { transition: opacity .15s ease, transform .15s ease; }
.ef-fade-enter-from   { opacity: 0; transform: scale(.97); }
.ef-fade-leave-to     { opacity: 0; }

/* ═══════════════════════════════════════════════════════
   VIEW TRANSITION
═══════════════════════════════════════════════════════ */

.vfade-enter-active,
.vfade-leave-active { transition: opacity .18s ease, transform .18s ease; }
.vfade-enter-from   { opacity: 0; transform: translateY(8px); }
.vfade-leave-to     { opacity: 0; transform: translateY(-4px); }

/* ═══════════════════════════════════════════════════════
   SHARED VIEW ELEMENTS
═══════════════════════════════════════════════════════ */

.view-header { margin-bottom: 20px; }
.vh-title    { font-size: 22px; font-weight: 800; color: #E8EDF5; margin-bottom: 3px; }
.vh-sub      { font-size: 13px; color: #3D4F6B; }

/* Summary row — 3 equal cards */
.summary-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}
.sum-card {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 13px;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sum-card.warn   { border-color: rgba(240,180,41,.2); background: rgba(240,180,41,.05); }
.sum-card.danger { border-color: rgba(255,90,90,.2);  background: rgba(255,90,90,.05);  }

.sum-num   { font-size: 24px; font-weight: 800; color: #E8EDF5; direction: ltr; text-align: right; }
.sum-label { font-size: 11px; color: #637285; }

.sum-card.warn   .sum-num { color: #F0B429; }
.sum-card.danger .sum-num { color: #FF6B6B; }

/* ═══════════════════════════════════════════════════════
   INVENTORY VIEW
═══════════════════════════════════════════════════════ */

.product-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.product-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.05);
  border-radius: 11px;
  gap: 12px;
}
.product-row:hover { border-color: rgba(255,255,255,.1); }

.pr-info { flex: 1; min-width: 0; }
.pr-name { font-size: 14px; font-weight: 700; color: #C8D5E8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-sku  { font-size: 11px; color: #3D4F6B; margin-top: 2px; direction: ltr; text-align: right; }

.pr-right  { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.pr-price  { font-size: 13px; font-weight: 700; color: #637285; }

.pr-stock  { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 100px; }
.stock-ok  { background: rgba(0,204,136,.12); color: #00CC88; }
.stock-low { background: rgba(240,180,41,.15); color: #F0B429; }
.stock-out { background: rgba(255,90,90,.15);  color: #FF6B6B; }

/* ═══════════════════════════════════════════════════════
   CUSTOMERS VIEW
═══════════════════════════════════════════════════════ */

.customer-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.customer-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.05);
  border-radius: 11px;
}
.customer-row:hover { border-color: rgba(255,255,255,.1); }

.cu-av {
  width: 38px; height: 38px;
  background: rgba(75,158,255,.12);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; color: #4B9EFF;
  flex-shrink: 0;
}
.cu-info   { flex: 1; min-width: 0; }
.cu-name   { font-size: 14px; font-weight: 700; color: #C8D5E8; }
.cu-date   { font-size: 11px; color: #3D4F6B; margin-top: 2px; }
.cu-balance { font-size: 17px; font-weight: 800; color: #F0B429; flex-shrink: 0; }

/* ═══════════════════════════════════════════════════════
   REPORTS VIEW
═══════════════════════════════════════════════════════ */

.report-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 8px;
}

@media (min-width: 900px) {
  .report-grid { grid-template-columns: repeat(4, 1fr); }
}

.report-card {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 14px;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.report-card.profit-report {
  background: linear-gradient(145deg, #071F0F, #0B3018);
  border-color: rgba(0,204,136,.2);
}

.rc-label { font-size: 11px; font-weight: 700; color: #3D4F6B; letter-spacing: .3px; }
.rc-val   { font-size: 24px; font-weight: 800; color: #E8EDF5; }
.rc-val.green { color: #00CC88; }
.rc-delta { font-size: 11px; font-weight: 700; margin-top: 2px; }
.rc-delta.up   { color: rgba(0,204,136,.7); }
.rc-delta.down { color: rgba(255,90,90,.7); }
</style>
