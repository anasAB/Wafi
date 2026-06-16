<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import { useSaleHistory } from './useSaleHistory'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import type { SaleRecord } from './sale-history.types'
import ReturnSheet from '@/features/returns/components/ReturnSheet.vue'
import ReturnDetailSheet from '@/features/returns/components/ReturnDetailSheet.vue'

const router  = useRouter()
const route   = useRoute()
const { sales, loading, loadHistory, reprint, reprintError } = useSaleHistory()
const { period, setPeriod } = usePeriodToggle()
const expandedId = ref<string | null>(null)
const toast      = ref<string | null>(null)
const toastType  = ref<'info' | 'error'>('info')
const returnSaleId     = ref<string | null>(null)
const returnSaleNumber = ref('')
const detailSaleId     = ref<string | null>(null)
const detailSaleNumber = ref('')

function openReturn(sale: SaleRecord) {
  returnSaleId.value     = sale.id
  returnSaleNumber.value = sale.displaySaleNumber
}

function openReturnDetail(sale: SaleRecord) {
  detailSaleId.value     = sale.id
  detailSaleNumber.value = sale.displaySaleNumber
}

function onReturnConfirmed() {
  loadHistory(getDateRange(period.value))
}

// If ?period= is in the URL, use that period; otherwise use the current singleton value
const isPeriodDrillDown = computed(() => !!route.query.period)

const periodTitle = computed(() => {
  const labels: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
  return isPeriodDrillDown.value ? `مبيعات ${labels[period.value] ?? ''}` : 'آخر المبيعات'
})

// ── Filters ──────────────────────────────────────────────
const searchQuery  = ref('')
const methodFilter = ref<'all' | string>('all')

const METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all',      label: 'كل الطرق' },
  { value: 'cash_usd', label: 'نقد $' },
  { value: 'cash_syp', label: 'نقد ل.س' },
  { value: 'card',     label: 'بطاقة' },
  { value: 'credit',   label: 'آجل' },
  { value: 'split',    label: 'مقسّم' },
]

const filteredSales = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return sales.value.filter(s => {
    if (methodFilter.value !== 'all' && s.paymentMethod !== methodFilter.value) return false
    if (q && !s.displaySaleNumber.toLowerCase().includes(q)) return false
    return true
  })
})

const periodTotal = computed(() =>
  filteredSales.value.reduce((sum, s) => sum + s.totalUsd, 0)
)

onMounted(async () => {
  if (route.query.period) {
    // Sync singleton to URL param (handles direct navigation)
    const p = route.query.period as string
    if (p === 'today' || p === 'week' || p === 'month') setPeriod(p)
  }
  await loadHistory(getDateRange(period.value))
})

// Reload from the DB whenever the selected period changes.
watch(period, async (newPeriod) => {
  await loadHistory(getDateRange(newPeriod))
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
  <div class="page-root">
    <AppHeader :title="periodTitle" :show-back="isPeriodDrillDown" @back="router.push('/')" />

    <!-- Filters: period range + search by invoice number + payment method -->
    <div class="filter-bar" dir="rtl">
      <div class="filter-top">
        <PeriodToggle />
        <div v-if="filteredSales.length > 0" class="period-total">
          إجمالي: ${{ periodTotal.toFixed(2) }}
        </div>
      </div>
      <div class="filter-controls">
        <div class="search-wrap">
          <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            v-model="searchQuery"
            type="search"
            class="search-input"
            placeholder="ابحث برقم الفاتورة..."
          />
        </div>
        <select v-model="methodFilter" class="method-select">
          <option v-for="m in METHOD_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </div>
    </div>

    <main class="page-main">

      <!-- Loading -->
      <div v-if="loading" class="loading-wrap">
        <div class="spinner" />
      </div>

      <!-- Empty: nothing in this period -->
      <div v-else-if="sales.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"/>
          </svg>
        </div>
        <p class="empty-text">لا توجد مبيعات في هذه الفترة</p>
        <RouterLink to="/pos" class="btn-ghost-sm">بيع جديد</RouterLink>
      </div>

      <!-- Empty: filtered out -->
      <div v-else-if="filteredSales.length === 0" class="empty-state">
        <p class="empty-text">لا توجد فواتير مطابقة للبحث</p>
      </div>

      <template v-else>
        <!-- Desktop: table -->
        <div class="desktop-table-wrap">
          <table class="sale-table">
            <thead>
              <tr class="table-head-row">
                <th class="th">رقم الفاتورة</th>
                <th class="th">التاريخ</th>
                <th class="th">المبلغ</th>
                <th class="th">بالليرة</th>
                <th class="th">طريقة الدفع</th>
                <th class="th">الحالة</th>
                <th class="w-28"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="sale in filteredSales"
                :key="sale.id"
                class="table-row"
              >
                <td class="td">
                  <span class="sale-number">{{ sale.displaySaleNumber }}</span>
                </td>
                <td class="td td-muted">{{ formatDate(sale.createdAt) }}</td>
                <td class="td">
                  <span class="sale-amount" dir="ltr">${{ sale.totalUsd.toFixed(2) }}</span>
                </td>
                <td class="td td-muted" dir="ltr">
                  {{ sale.totalSyp.toLocaleString() }} ل.س
                </td>
                <td class="td td-muted">{{ methodLabel[sale.paymentMethod] ?? '?' }}</td>
                <td class="td">
                  <span v-if="sale.isPending" class="badge-warning">في الانتظار</span>
                  <span v-else-if="sale.paymentMethod === 'credit'" class="badge-credit">آجل (غير مدفوع)</span>
                  <span v-else class="td-muted text-xs">مدفوع</span>
                </td>
                <td class="td">
                  <div style="display:flex;gap:6px;align-items:center;">
                    <button
                      v-if="sale.hasReturn"
                      type="button"
                      class="badge-return badge-return--btn"
                      @click="openReturnDetail(sale)"
                    >{{ sale.isFullyReturned ? 'مرتجع بالكامل' : 'مرتجع جزئي' }}</button>
                    <button type="button" class="btn-reprint" @click="handleReprint(sale.id)">
                      إعادة طباعة
                    </button>
                    <button
                      v-if="!sale.isFullyReturned"
                      type="button"
                      class="btn-reprint"
                      @click="openReturn(sale)"
                    >
                      إرجاع
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile: card list -->
        <div class="mobile-list">
          <div
            v-for="sale in filteredSales"
            :key="sale.id"
            class="sale-card"
            :class="{ 'sale-card--pending': sale.isPending }"
          >
            <button
              type="button"
              class="sale-card-header"
              @click="expandedId = expandedId === sale.id ? null : sale.id"
            >
              <span class="sale-number">{{ sale.displaySaleNumber }}</span>
              <span class="sale-amount flex-1" dir="ltr">${{ sale.totalUsd.toFixed(2) }}</span>
              <span v-if="sale.isPending" class="badge-warning shrink-0">في الانتظار</span>
              <span class="td-muted text-xs shrink-0">{{ formatDate(sale.createdAt) }}</span>
              <span class="td-muted text-sm shrink-0">{{ methodLabel[sale.paymentMethod] ?? '?' }}</span>
            </button>

            <div v-if="expandedId === sale.id" class="sale-card-body">
              <div class="sale-extra-row">
                <span>بالليرة: {{ sale.totalSyp.toLocaleString() }} ل.س</span>
                <span>السعر: {{ sale.exchangeRateAtSale.toLocaleString() }}</span>
              </div>
              <button
                v-if="sale.hasReturn"
                type="button"
                class="badge-return badge-return--btn"
                style="width:fit-content;"
                @click="openReturnDetail(sale)"
              >{{ sale.isFullyReturned ? 'مرتجع بالكامل — عرض التفاصيل' : 'مرتجع جزئي — عرض التفاصيل' }}</button>
              <button
                type="button"
                class="btn-reprint-full"
                @click="handleReprint(sale.id)"
              >إعادة طباعة</button>
              <button
                v-if="!sale.isFullyReturned"
                type="button"
                class="btn-reprint-full"
                @click="openReturn(sale)"
              >إرجاع</button>
            </div>
          </div>
        </div>
      </template>

    </main>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />

  <Teleport to="body">
    <ReturnSheet
      v-if="returnSaleId"
      :sale-id="returnSaleId"
      :sale-number="returnSaleNumber"
      @close="returnSaleId = null"
      @confirmed="onReturnConfirmed"
    />
  </Teleport>

  <Teleport to="body">
    <ReturnDetailSheet
      v-if="detailSaleId"
      :sale-id="detailSaleId"
      :sale-number="detailSaleNumber"
      @close="detailSaleId = null"
    />
  </Teleport>
</template>

<style scoped>
/* ─── Layout ─────────────────────────────────────────────── */
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.filter-bar {
  padding: 12px 16px 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (min-width: 1024px) {
  .filter-bar { padding: 12px 24px 0; }
}

.filter-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.period-total {
  font-size: 0.875rem;
  font-weight: 700;
  color: #60A5FA;
  text-align: left;
}

.filter-controls {
  display: flex;
  gap: 8px;
}

.search-wrap {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0.625rem;
  margin: auto;
  width: 0.9rem;
  height: 0.9rem;
  color: #637285;
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 38px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 0.625rem;
  padding: 0 2.25rem 0 0.75rem;
  color: #E8EDF5;
  font-size: 0.8125rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input::placeholder { color: #3D4F6B; }

.search-input:focus {
  border-color: rgba(26,86,219,0.7);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.method-select {
  height: 38px;
  padding: 0 0.625rem;
  border-radius: 0.625rem;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  color: #E8EDF5;
  font-size: 0.8125rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  cursor: pointer;
  flex-shrink: 0;
}

.page-main {
  flex: 1;
  padding: 16px;
  max-width: 672px;
  margin: 0 auto;
  width: 100%;
  padding-bottom: 80px;
}

@media (min-width: 1024px) {
  .page-main {
    padding: 20px 24px;
    max-width: none;
  }
}

/* ─── Loading ──────────────────────────────────────────────── */
.loading-wrap {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid rgba(26, 86, 219, 0.3);
  border-top-color: #1A56DB;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Empty state ─────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 0;
  gap: 12px;
}

.empty-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 86, 219, 0.08);
  border: 1px solid rgba(26, 86, 219, 0.18);
}

.empty-icon {
  width: 32px;
  height: 32px;
  color: #3D4F6B;
}

.empty-text {
  font-size: 1rem;
  color: #637285;
  text-align: center;
}

.btn-ghost-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 20px;
  border-radius: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  transition: opacity 0.15s;
}

.btn-ghost-sm:hover { opacity: 0.8; }

/* ─── Desktop Table ───────────────────────────────────────── */
/* Desktop table / mobile cards are mutually exclusive. Use scoped media queries
   (not Tailwind utilities) — a scoped `.mobile-list { display:flex }` was
   overriding `lg:hidden`, so both rendered together on laptops. */
.desktop-table-wrap {
  display: none;
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

@media (min-width: 1024px) { .desktop-table-wrap { display: block; } }

.sale-table {
  width: 100%;
  border-collapse: collapse;
}

.table-head-row {
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.th {
  text-align: right;
  padding: 12px 16px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #637285;
  white-space: nowrap;
}

.table-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s;
}

.table-row:hover { background: rgba(26, 86, 219, 0.06); }
.table-row:last-child { border-bottom: none; }

.td {
  padding: 14px 16px;
  vertical-align: middle;
}

.td-muted {
  font-size: 0.875rem;
  color: #637285;
}

/* ─── Sale data atoms ─────────────────────────────────────── */
.sale-number {
  font-family: 'Tajawal', monospace;
  font-size: 0.875rem;
  font-weight: 600;
  color: #60A5FA;
}

.sale-amount {
  font-size: 0.875rem;
  font-weight: 700;
  color: #E8EDF5;
}

/* ─── Badges ──────────────────────────────────────────────── */
.badge-warning {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.28);
  color: #F59E0B;
}

.badge-credit {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.28);
  color: #F59E0B;
}

.badge-return {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: #10B981;
}

/* Clickable badge → opens the read-only return details */
.badge-return--btn {
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, border-color 0.12s;
}
.badge-return--btn:hover {
  background: rgba(16, 185, 129, 0.20);
  border-color: rgba(16, 185, 129, 0.45);
}

/* ─── Reprint buttons ─────────────────────────────────────── */
.btn-reprint {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 0.5rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: #637285;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-reprint:hover {
  border-color: rgba(26, 86, 219, 0.40);
  color: #60A5FA;
}

.btn-reprint-full {
  width: 100%;
  height: 36px;
  border-radius: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #637285;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-reprint-full:hover {
  border-color: rgba(26, 86, 219, 0.40);
  color: #60A5FA;
}

/* ─── Mobile cards ────────────────────────────────────────── */
.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (min-width: 1024px) { .mobile-list { display: none; } }

.sale-card {
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.sale-card--pending {
  border-inline-start: 3px solid #F59E0B;
}

.sale-card-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  min-height: 60px;
  text-align: right;
  cursor: pointer;
  background: transparent;
  border: none;
}

.sale-card-body {
  padding: 12px 16px;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sale-extra-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #637285;
}
</style>
