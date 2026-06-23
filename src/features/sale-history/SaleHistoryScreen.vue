<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import { db } from '@/data/powersync/db'
import { useSaleHistory } from './useSaleHistory'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import type { SaleRecord } from './sale-history.types'
import ReturnSheet from '@/features/returns/components/ReturnSheet.vue'
import ReturnDetailSheet from '@/features/returns/components/ReturnDetailSheet.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import WhatsAppPreviewSheet from '@/features/messaging/components/WhatsAppPreviewSheet.vue'
import { useSendReceipt } from '@/features/messaging/useSendReceipt'
import { buildReceiptData } from './useSaleHistory'

const router  = useRouter()
const route   = useRoute()
const { sales, loading, loadHistory, reprint } = useSaleHistory()
const { period, setPeriod } = usePeriodToggle()
const expandedId = ref<string | null>(null)
const toast      = ref<string | null>(null)
const toastType  = ref<'info' | 'error'>('info')
const methodMenuOpen = ref(false)
const methodMenuRef  = ref<HTMLElement | null>(null)
let unbindSyncListener: (() => void) | undefined
const returnSaleId     = ref<string | null>(null)
const returnSaleNumber = ref('')
const detailSaleId     = ref<string | null>(null)
const detailSaleNumber = ref('')

async function refreshHistoryForCurrentPeriod() {
  await loadHistory(getDateRange(period.value))
}

function openReturn(sale: SaleRecord) {
  returnSaleId.value     = sale.id
  returnSaleNumber.value = sale.displaySaleNumber
}

function openReturnDetail(sale: SaleRecord) {
  detailSaleId.value     = sale.id
  detailSaleNumber.value = sale.displaySaleNumber
}

function onReturnConfirmed() {
  returnSaleId.value = null
  refreshHistoryForCurrentPeriod()
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
const selectedMethodLabel = computed(() =>
  METHOD_OPTIONS.find(m => m.value === methodFilter.value)?.label ?? 'كل الطرق'
)

function chooseMethod(value: string) {
  methodFilter.value = value
  methodMenuOpen.value = false
}

function toggleMethodMenu() {
  methodMenuOpen.value = !methodMenuOpen.value
}

function clearSearch() {
  searchQuery.value = ''
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (!methodMenuRef.value?.contains(target)) {
    methodMenuOpen.value = false
  }
}

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
  document.addEventListener('click', onDocumentClick)
  unbindSyncListener = db.registerListener?.({
    statusChanged: async (status) => {
      const flow = status.dataFlowStatus
      if (!status.connected) return
      if (flow?.downloading || flow?.uploading) return
      if (loading.value) return
      await refreshHistoryForCurrentPeriod()
    },
  })
  if (route.query.period) {
    // Sync singleton to URL param (handles direct navigation)
    const p = route.query.period as string
    if (p === 'today' || p === 'week' || p === 'month') setPeriod(p)
  }
  await refreshHistoryForCurrentPeriod()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  unbindSyncListener?.()
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

// ── WhatsApp send ─────────────────────────────────────────────────────────────
const { prepare, send } = useSendReceipt()
const waSheetOpen   = ref(false)
const waSheetText   = ref('')
const waSheetPhone  = ref<string | null>(null)

async function handleWhatsApp(saleId: string) {
  try {
    const receipt  = await buildReceiptData(saleId)
    // SaleRecord has no phone — always go through the enter-number path
    const prepared = prepare(receipt)
    waSheetText.value  = prepared.text
    waSheetPhone.value = prepared.phone   // null
    waSheetOpen.value  = true
  } catch (e) {
    toastType.value = 'error'
    toast.value = `خطأ: ${e instanceof Error ? e.message : String(e)}`
  }
}

function onWaSend(payload: { phone: string; text: string }) {
  send(payload.phone, payload.text)
  waSheetOpen.value = false
  toastType.value = 'info'
  toast.value = 'تم فتح واتساب'
}
</script>

<template>
  <div class="page-root">
    <AppHeader :title="periodTitle" @back="router.push('/')" />

    <!-- Filters: period range + search by invoice number + payment method.
         All controls live on one wrapping row so they read as one group and
         stay aligned instead of drifting to opposite edges (BUG-011 new list). -->
    <div class="filter-bar" dir="rtl">
      <div class="filter-row">
        <PeriodToggle class="filter-period" />
        <div class="search-wrap">
          <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="ابحث برقم الفاتورة..."
          />
          <button
            v-if="searchQuery"
            type="button"
            class="search-clear-btn"
            aria-label="مسح البحث"
            @click="clearSearch"
          >×</button>
        </div>
        <div ref="methodMenuRef" class="method-filter-wrap">
          <button
            type="button"
            class="method-filter-btn"
            :aria-expanded="methodMenuOpen"
            aria-haspopup="listbox"
            @click="toggleMethodMenu"
          >
            <span class="method-filter-text">{{ selectedMethodLabel }}</span>
            <svg
              class="method-filter-chevron"
              :class="{ 'method-filter-chevron-open': methodMenuOpen }"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <div v-if="methodMenuOpen" class="method-filter-menu" role="listbox" aria-label="تصفية حسب طريقة الدفع">
            <button
              v-for="m in METHOD_OPTIONS"
              :key="m.value"
              type="button"
              class="method-filter-item"
              :class="{ 'method-filter-item-active': methodFilter === m.value }"
              @click="chooseMethod(m.value)"
            >{{ m.label }}</button>
          </div>
        </div>
        <div v-if="filteredSales.length > 0" class="period-total">
          إجمالي: ${{ periodTotal.toFixed(2) }}
        </div>
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
        <!-- Desktop: PrimeVue DataTable (sortable + paginated).
             Smoke test of the PrimeVue + Tailwind v4 theming path. Styled via
             scoped :deep() overrides below to match the app's glass/blue
             surface; RTL is inherited from the dir="rtl" wrapper. -->
        <div class="desktop-table-wrap" dir="rtl">
          <DataTable
            :value="filteredSales"
            data-key="id"
            removable-sort
            paginator
            :rows="15"
            :rows-per-page-options="[15, 30, 50]"
            class="sale-datatable"
          >
            <Column field="displaySaleNumber" header="رقم الفاتورة" sortable>
              <template #body="{ data }">
                <span class="sale-number">{{ data.displaySaleNumber }}</span>
              </template>
            </Column>
            <Column field="createdAt" header="التاريخ" sortable>
              <template #body="{ data }">
                <span class="td-muted">{{ formatDate(data.createdAt) }}</span>
              </template>
            </Column>
            <Column field="totalUsd" header="المبلغ" sortable>
              <template #body="{ data }">
                <span class="sale-amount" dir="ltr">${{ data.totalUsd.toFixed(2) }}</span>
              </template>
            </Column>
            <Column field="totalSyp" header="بالليرة" sortable>
              <template #body="{ data }">
                <span class="td-muted" dir="ltr">{{ data.totalSyp.toLocaleString() }} ل.س</span>
              </template>
            </Column>
            <Column header="طريقة الدفع">
              <template #body="{ data }">
                <span class="td-muted">{{ methodLabel[data.paymentMethod] ?? '?' }}</span>
              </template>
            </Column>
            <Column header="الحالة">
              <template #body="{ data }">
                <span v-if="data.isPending" class="badge-warning">في الانتظار</span>
                <span v-else-if="data.paymentMethod === 'credit'" class="badge-credit">آجل (غير مدفوع)</span>
                <span v-else class="td-muted text-xs">مدفوع</span>
              </template>
            </Column>
            <Column header="">
              <template #body="{ data }">
                <div style="display:flex;gap:6px;align-items:center;">
                  <button
                    v-if="data.hasReturn"
                    type="button"
                    class="badge-return badge-return--btn"
                    @click="openReturnDetail(data)"
                  >{{ data.isFullyReturned ? 'مرتجع بالكامل' : 'مرتجع جزئي' }}</button>
                  <button type="button" class="btn-reprint" @click="handleReprint(data.id)">
                    إعادة طباعة
                  </button>
                  <button
                    type="button"
                    class="btn-reprint btn-reprint--wa"
                    @click="handleWhatsApp(data.id)"
                  >
                    واتساب
                  </button>
                  <button
                    v-if="!data.isFullyReturned"
                    type="button"
                    class="btn-reprint"
                    @click="openReturn(data)"
                  >
                    إرجاع
                  </button>
                </div>
              </template>
            </Column>
          </DataTable>
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
                type="button"
                class="btn-reprint-full btn-reprint-full--wa"
                @click="handleWhatsApp(sale.id)"
              >إرسال عبر واتساب</button>
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

  <WhatsAppPreviewSheet
    v-if="waSheetOpen"
    :text="waSheetText"
    :phone="waSheetPhone"
    title="إرسال الفاتورة عبر واتساب"
    @send="onWaSend"
    @cancel="waSheetOpen = false"
  />
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

@media (min-width: 1024px) {
  .page-root {
    height: 100dvh;
    overflow: hidden;
  }
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

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* Period tabs keep their natural width; don't stretch in the flex row. */
.filter-period {
  flex: 0 0 auto;
  display: flex;
  height: 40px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}

.filter-period :deep(.pt-btn),
.filter-period :deep(.toggle-btn) {
  flex: 1;
  min-height: 100%;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: #637285;
  font-family: 'Tajawal', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, color .15s;
  white-space: nowrap;
  line-height: 1;
}

.filter-period :deep(.pt-btn.active),
.filter-period :deep(.toggle-btn.active) {
  background: #1A56DB;
  color: #FFFFFF;
  font-weight: 700;
}

.filter-period :deep(.pt-btn:hover:not(.active)),
.filter-period :deep(.toggle-btn:hover:not(.active)) {
  color: #C8D5E8;
}

.period-total {
  font-size: 0.875rem;
  font-weight: 700;
  color: #60A5FA;
  /* Pushed to the row's end (left in RTL), away from the filters. */
  margin-inline-start: auto;
}

.search-wrap {
  position: relative;
  flex: 1 1 180px;
  min-width: 180px;
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
  height: 40px;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  border-radius: 0.625rem;
  padding: 0 2.25rem 0 2.25rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-clear-btn {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0.5rem;
  margin: auto;
  width: 1.4rem;
  height: 1.4rem;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #9FB1C8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.search-clear-btn:hover {
  background: rgba(26, 86, 219, 0.24);
  color: #E8EDF5;
}

.search-clear-btn:focus-visible {
  outline: 2px solid rgba(96, 165, 250, 0.75);
  outline-offset: 1px;
}

.search-input::placeholder { color: #3D4F6B; }

.search-input:focus {
  border-color: rgba(26,86,219,0.7);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.method-filter-wrap {
  position: relative;
  width: 118px;
  flex-shrink: 0;
}

.method-filter-btn {
  width: 100%;
  height: 40px;
  padding: 0 0.75rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.method-filter-btn:hover {
  border-color: rgba(26,86,219,0.40);
}

.method-filter-btn:focus {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.method-filter-text {
  min-width: 0;
  flex: 1;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.method-filter-chevron {
  color: #637285;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.method-filter-chevron-open {
  transform: rotate(180deg);
}

.method-filter-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  inset-inline-start: 0;
  width: 100%;
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px;
  border-radius: 12px;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  border: 1px solid rgba(26,86,219,0.30);
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.method-filter-menu::-webkit-scrollbar {
  width: 10px;
}

.method-filter-menu::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.method-filter-menu::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.method-filter-menu::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.method-filter-item {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #E8EDF5;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  text-align: right;
  cursor: pointer;
}

.method-filter-item:hover {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.24);
}

.method-filter-item-active {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20));
  border-color: rgba(26,86,219,0.35);
  color: #FFFFFF;
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
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
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
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10);
}

@media (min-width: 1024px) {
  .desktop-table-wrap {
    display: block;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}

/* ─── PrimeVue DataTable theming ──────────────────────────── */
/* Scoped styles are unlayered, so they reliably win over PrimeVue's
   `primevue` CSS layer. We strip the Aura surface so the wrapper's glass
   gradient shows through, then restyle header/rows to match the old table. */
.sale-datatable :deep(.p-datatable-table),
.sale-datatable :deep(.p-datatable-thead > tr > th),
.sale-datatable :deep(.p-datatable-tbody > tr) {
  background: transparent;
}

.sale-datatable:deep(.p-datatable),
.sale-datatable :deep(.p-datatable),
.sale-datatable :deep(.p-datatable-table-container) {
  border: none;
  box-shadow: none;
  background: transparent;
}

.sale-datatable:deep(.p-datatable-header),
.sale-datatable:deep(.p-datatable-footer),
.sale-datatable :deep(.p-datatable-header),
.sale-datatable :deep(.p-datatable-footer),
.sale-datatable :deep(.p-datatable-wrapper) {
  border: none;
  box-shadow: none;
  background: transparent;
}

.sale-datatable :deep(.p-datatable-thead > tr > th) {
  text-align: right;
  padding: 12px 16px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #637285;
  white-space: nowrap;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.sale-datatable :deep(.p-datatable-tbody > tr) {
  color: #E8EDF5;
  transition: background 0.15s;
}

.sale-datatable :deep(.p-datatable-tbody > tr > td) {
  padding: 14px 16px;
  vertical-align: middle;
  border-bottom: 1px solid rgba(26, 86, 219, 0.12);
}

.sale-datatable :deep(.p-datatable-tbody > tr:hover > td) {
  background: rgba(26, 86, 219, 0.06);
}

.sale-datatable :deep(.p-datatable-tbody > tr:last-child > td) {
  border-bottom: none;
}

/* Sort icons + paginator inherit the muted/blue palette */
.sale-datatable :deep(.p-datatable-sort-icon) { color: #637285; }
.sale-datatable :deep(.p-datatable-column-sorted .p-datatable-sort-icon) { color: #60A5FA; }

.sale-datatable :deep(.p-paginator) {
  background: transparent;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
  color: #637285;
}

.sale-datatable :deep(.p-datatable-paginator-bottom),
.sale-datatable :deep(nav.p-datatable-paginator-bottom) {
  border-bottom: none !important;
}
.sale-datatable :deep(.p-paginator .p-paginator-page),
.sale-datatable :deep(.p-paginator .p-paginator-first),
.sale-datatable :deep(.p-paginator .p-paginator-prev),
.sale-datatable :deep(.p-paginator .p-paginator-next),
.sale-datatable :deep(.p-paginator .p-paginator-last) {
  color: #C8D5E8;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  border-radius: 0.5rem;
  min-width: 2.25rem;
  height: 2.25rem;
}

.sale-datatable :deep(.p-paginator .p-paginator-page:hover),
.sale-datatable :deep(.p-paginator .p-paginator-first:not(:disabled):hover),
.sale-datatable :deep(.p-paginator .p-paginator-prev:not(:disabled):hover),
.sale-datatable :deep(.p-paginator .p-paginator-next:not(:disabled):hover),
.sale-datatable :deep(.p-paginator .p-paginator-last:not(:disabled):hover) {
  border-color: rgba(26,86,219,0.40);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(255,255,255,0.06));
}

.sale-datatable :deep(.p-paginator .p-paginator-page.p-paginator-page-selected) {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border-color: transparent;
  box-shadow: 0 6px 20px rgba(26,86,219,0.35), inset 0 1px 0 rgba(255,255,255,0.10);
  color: #fff;
}

.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown) {
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  border-radius: 0.75rem;
  height: 2.25rem;
  overflow: hidden;
}

.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown .p-select-label) {
  color: #E8EDF5;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  padding-block: 0;
  padding-inline: 10px;
}

.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown .p-select-dropdown) {
  color: #637285;
  border-inline-start: 1px solid rgba(26,86,219,0.22);
  min-width: 2rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown:hover .p-select-dropdown) {
  border-inline-start-color: rgba(26,86,219,0.40);
}

.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown.p-focus) {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown.p-inputwrapper-focus),
.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown.p-overlay-open),
.sale-datatable :deep(.p-paginator .p-paginator-rpp-dropdown[aria-expanded="true"]) {
  border-color: rgba(26,86,219,0.70);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(255,255,255,0.06));
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

/* PrimeVue Select panel is portaled, so overlay styles need top-level deep selectors. */
:deep(.p-select-overlay) {
  padding: 6px;
  margin-top: 6px;
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  border: 1px solid rgba(26,86,219,0.30);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  backdrop-filter: blur(20px) saturate(180%);
}

:deep(.p-select-popover),
:deep(.p-dropdown-panel) {
  padding: 6px !important;
  margin-top: 6px !important;
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97)) !important;
  border: 1px solid rgba(26,86,219,0.30) !important;
  border-radius: 12px !important;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16) !important;
  backdrop-filter: blur(20px) saturate(180%);
}

:deep(.p-select-list-container) {
  max-height: 220px;
  background: transparent;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

:deep(.p-dropdown-items-wrapper),
:deep(.p-select-popover .p-select-list-container),
:deep(.p-dropdown-panel .p-dropdown-items-wrapper) {
  max-height: 220px !important;
  background: transparent !important;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

:deep(.p-select-list) {
  margin: 0;
  padding: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

:deep(.p-dropdown-items),
:deep(.p-select-popover .p-select-list),
:deep(.p-dropdown-panel .p-dropdown-items) {
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

:deep(.p-select-list-container::-webkit-scrollbar) {
  width: 10px;
}

:deep(.p-dropdown-items-wrapper::-webkit-scrollbar) {
  width: 10px;
}

:deep(.p-select-list-container::-webkit-scrollbar-track) {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

:deep(.p-dropdown-items-wrapper::-webkit-scrollbar-track) {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

:deep(.p-select-list-container::-webkit-scrollbar-thumb) {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

:deep(.p-dropdown-items-wrapper::-webkit-scrollbar-thumb) {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

:deep(.p-select-list-container::-webkit-scrollbar-thumb:hover) {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

:deep(.p-dropdown-items-wrapper::-webkit-scrollbar-thumb:hover) {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

:deep(.p-select-option) {
  color: #E8EDF5;
  border-radius: 8px;
  border: 1px solid transparent;
  min-height: 34px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
}

:deep(.p-dropdown-item),
:deep(.p-select-popover .p-select-option),
:deep(.p-dropdown-panel .p-dropdown-item) {
  color: #E8EDF5 !important;
  border-radius: 8px;
  border: 1px solid transparent;
  min-height: 34px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
}

:deep(.p-select-option-label) {
  width: 100%;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.p-dropdown-item-label) {
  width: 100%;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.p-select-option:hover) {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.24);
}

:deep(.p-dropdown-item:hover),
:deep(.p-dropdown-item.p-focus) {
  background: rgba(26,86,219,0.16) !important;
  border-color: rgba(26,86,219,0.24) !important;
  color: #E8EDF5 !important;
}

:deep(.p-select-option.p-select-option-selected),
:deep(.p-select-option.p-highlight),
:deep(.p-select-option[aria-selected="true"]) {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20)) !important;
  color: #FFFFFF !important;
}

:deep(.p-dropdown-item.p-highlight),
:deep(.p-dropdown-item[aria-selected="true"]) {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20)) !important;
  color: #FFFFFF !important;
}

:deep(.p-select-option.p-focus),
:deep(.p-select-option:focus-visible) {
  background: rgba(26,86,219,0.16) !important;
  color: #E8EDF5 !important;
}

:deep(.p-select-option.p-select-option-selected.p-focus),
:deep(.p-select-option.p-highlight.p-focus),
:deep(.p-select-option[aria-selected="true"].p-focus) {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20)) !important;
  color: #FFFFFF !important;
}

.td-muted {
  font-size: 0.875rem;
  color: #637285;
}

/* ─── Sale data atoms ─────────────────────────────────────── */
.sale-number {
  font-family: 'Tajawal', monospace;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #60A5FA;
}

.sale-amount {
  font-size: 0.95rem;
  font-weight: 800;
  color: #F1F5FB;
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

.btn-reprint--wa {
  border-color: rgba(37, 211, 102, 0.25);
  color: #25D366;
}

.btn-reprint--wa:hover {
  border-color: rgba(37, 211, 102, 0.55);
  color: #25D366;
  background: rgba(37, 211, 102, 0.08);
}

.btn-reprint-full {
  width: 100%;
  height: 40px;
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

.btn-reprint-full--wa {
  border-color: rgba(37, 211, 102, 0.25);
  color: #25D366;
}

.btn-reprint-full--wa:hover {
  border-color: rgba(37, 211, 102, 0.55);
  background: rgba(37, 211, 102, 0.08);
}

/* ─── Mobile cards ────────────────────────────────────────── */
.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (min-width: 1024px) { .mobile-list { display: none; } }

.sale-card {
  border-radius: 1.125rem;
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
  gap: 14px;
  padding: 10px 16px;
  min-height: 72px;
  text-align: right;
  cursor: pointer;
  background: transparent;
  border: none;
}

.sale-card-body {
  padding: 14px 16px;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sale-extra-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8125rem;
  color: #93A3B8;
}
</style>
