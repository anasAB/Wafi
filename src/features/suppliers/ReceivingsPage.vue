<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Paginator from 'primevue/paginator'
import { useReceivings } from './composables/useReceivings'
import ReceivingDetail from './components/ReceivingDetail.vue'
import ReceivingSheet from './components/ReceivingSheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppDatePicker from '@/components/ui/AppDatePicker.vue'
import type { Receiving, ReceivingDetailData } from './receiving.types'

const { receivings, load, loadDetail } = useReceivings()
const detail    = ref<ReceivingDetailData | null>(null)
const showSheet = ref(false)
const filterDate = ref<Date | null>(null)
const searchQuery = ref('')

type SortKey = 'supplierName' | 'receivedAt' | 'exchangeRateAtReceiving' | 'meta' | 'totalCostUsd'
const sortKey = ref<SortKey>('receivedAt')
const sortDir = ref<'asc' | 'desc'>('desc')

const first = ref(0)
const rows = ref(10)

const filteredReceivings = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const dateKey = filterDate.value ? localDateKeyFromDate(filterDate.value) : ''

  return receivings.value.filter((r) => {
    const matchesDate = !dateKey || localDateKey(r.receivedAt) === dateKey
    if (!matchesDate) return false

    if (!q) return true

    return [
      r.supplierName,
      r.notes ?? '',
      fmtDate(r.receivedAt),
      fmtRate(r.exchangeRateAtReceiving),
      `${r.totalCostUsd.toFixed(2)}`,
    ].some((value) => value.toLowerCase().includes(q))
  })
})

const sortedReceivings = computed(() => {
  const list = [...filteredReceivings.value]
  const dir = sortDir.value === 'asc' ? 1 : -1

  return list.sort((a, b) => {
    if (sortKey.value === 'supplierName') {
      return a.supplierName.localeCompare(b.supplierName, 'ar') * dir
    }

    if (sortKey.value === 'receivedAt') {
      return (new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()) * dir
    }

    if (sortKey.value === 'exchangeRateAtReceiving') {
      return (a.exchangeRateAtReceiving - b.exchangeRateAtReceiving) * dir
    }

    if (sortKey.value === 'totalCostUsd') {
      return (a.totalCostUsd - b.totalCostUsd) * dir
    }

    const metaRank = (item: Receiving): number => {
      const hasPhoto = Boolean(item.invoicePhotoUrl)
      const hasNotes = Boolean(item.notes)
      if (hasPhoto && hasNotes) return 2
      if (hasPhoto || hasNotes) return 1
      return 0
    }

    return (metaRank(a) - metaRank(b)) * dir
  })
})

const paginatedReceivings = computed(() =>
  sortedReceivings.value.slice(first.value, first.value + rows.value),
)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'receivedAt' ? 'desc' : 'asc'
  }
  first.value = 0
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-SY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function fmtRate(rate: number): string {
  return rate.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function localDateKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return localDateKeyFromDate(d)
}

function localDateKeyFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function onPage(e: { first: number; rows: number }) {
  first.value = e.first
  rows.value = e.rows
}

onMounted(load)

watch(
  () => sortedReceivings.value.length,
  (len) => {
    if (first.value >= len) {
      first.value = Math.max(0, (Math.ceil(Math.max(len, 1) / rows.value) - 1) * rows.value)
    }
  },
)

watch([filterDate, searchQuery], () => {
  first.value = 0
})

async function open(id: string) {
  detail.value = await loadDetail(id)
}

// Created a receiving — the sheet lets the user pick the supplier inline, so no
// preset is needed when adding from this top-level page (BUG-004 of the new list).
async function onSaved() {
  showSheet.value = false
  await load()
}
</script>

<template>
  <section class="page" dir="rtl">
    <header class="page-head">
      <h1>استلام البضائع</h1>
      <button class="btn-primary" @click="showSheet = true">
        <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        تسجيل استلام
      </button>
    </header>

    <!-- Empty state with a clear way to create the first entry -->
    <EmptyState
      v-if="!receivings.length"
      title="لا يوجد استلام مسجّل بعد"
      subtitle="سجّل أول عملية استلام بضاعة من مورّد"
      cta-label="تسجيل استلام"
      @cta="showSheet = true"
    />

    <div v-else class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-fields">
          <div class="search-wrap">
            <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
            </svg>
            <input
              v-model="searchQuery"
              class="search-input"
              type="search"
              placeholder="بحث بالمورّد أو الملاحظة"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="search-clear-btn"
              aria-label="مسح البحث"
              @click="searchQuery = ''"
            >×</button>
          </div>

          <label class="date-filter">
            <span class="date-filter-label">تاريخ الاستلام</span>
            <AppDatePicker
              v-model="filterDate"
              class="receivings-date-picker"
              input-id="receivings-filter-date"
              append-to="self"
              date-format="yy-mm-dd"
              :show-icon="true"
              icon-display="input"
              :manual-input="false"
              :input-class="'form-input date-input prime-date-input'"
              placeholder="اختر تاريخاً"
            />
          </label>
        </div>

        <button v-if="filterDate || searchQuery" class="btn-secondary" @click="filterDate = null; searchQuery = ''">إلغاء الفلتر</button>
      </div>

      <table class="data-table">
        <colgroup>
          <col class="col-supplier" />
          <col class="col-date" />
          <col class="col-rate" />
          <col class="col-meta" />
          <col class="col-cost" />
        </colgroup>
        <thead>
          <tr class="table-head-row">
            <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'supplierName' }" @click="toggleSort('supplierName')">
              المورّد<span class="sort-arrow">{{ sortKey === 'supplierName' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-date th-sort" :class="{ 'th-sort--active': sortKey === 'receivedAt' }" @click="toggleSort('receivedAt')">
              التاريخ<span class="sort-arrow">{{ sortKey === 'receivedAt' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-rate th-sort" :class="{ 'th-sort--active': sortKey === 'exchangeRateAtReceiving' }" @click="toggleSort('exchangeRateAtReceiving')">
              سعر الصرف<span class="sort-arrow">{{ sortKey === 'exchangeRateAtReceiving' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'meta' }" @click="toggleSort('meta')">
              مرفقات وملاحظات<span class="sort-arrow">{{ sortKey === 'meta' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-total th-sort" :class="{ 'th-sort--active': sortKey === 'totalCostUsd' }" @click="toggleSort('totalCostUsd')">
              التكلفة<span class="sort-arrow">{{ sortKey === 'totalCostUsd' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in paginatedReceivings" :key="r.id" class="table-row" @click="open(r.id)">
            <td class="td td-name">{{ r.supplierName }}</td>
            <td class="td td-date td-muted">{{ fmtDate(r.receivedAt) }}</td>
            <td class="td td-rate" dir="ltr">{{ fmtRate(r.exchangeRateAtReceiving) }}</td>
            <td class="td td-meta-cell">
              <div class="meta-badges">
                <span v-if="r.invoicePhotoUrl" class="mini-badge mini-badge-photo">فاتورة</span>
                <span v-if="r.notes" class="mini-badge mini-badge-note">ملاحظة</span>
                <span v-if="!r.invoicePhotoUrl && !r.notes" class="mini-badge mini-badge-empty">—</span>
              </div>
            </td>
            <td class="td td-total" dir="ltr">{{ r.totalCostUsd.toFixed(2) }}$</td>
          </tr>
          <tr v-if="!paginatedReceivings.length" class="table-row-empty">
            <td colspan="5" class="td td-empty">لا توجد نتائج لهذا التاريخ</td>
          </tr>
        </tbody>
      </table>

      <Paginator
        v-if="sortedReceivings.length > 10"
        :first="first"
        :rows="rows"
        :total-records="sortedReceivings.length"
        :rows-per-page-options="[10, 20, 50]"
        class="list-paginator"
        dir="rtl"
        @page="onPage"
      />
    </div>

    <!-- New receiving -->
    <div v-if="showSheet" class="overlay" @click.self="showSheet = false">
      <div class="overlay-card">
        <ReceivingSheet @saved="onSaved" @close="showSheet = false" />
      </div>
    </div>

    <!-- Receiving detail -->
    <div v-if="detail" class="overlay" @click.self="detail = null">
      <div class="overlay-card detail-overlay-card">
        <button class="close-btn" aria-label="إغلاق" @click="detail = null">✕</button>
        <ReceivingDetail :data="detail" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; }
.page-head h1 { font-size: 1.25rem; font-weight: 700; color: #E8EDF5; }
.table-wrap {
  border-radius: 1rem; overflow: hidden;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28); box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}

.table-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(7, 14, 24, 0.35);
}

.toolbar-fields {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.search-wrap {
  position: relative;
  flex: 1;
  max-width: 28rem;
  min-width: min(320px, 70vw);
}

.search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0.75rem;
  margin: auto;
  width: 1rem;
  height: 1rem;
  color: #637285;
  pointer-events: none;
}

.search-input {
  width: 100%;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
  min-height: 40px;
  padding: 0.625rem 2.5rem 0.625rem 2.1rem;
}

.search-input::placeholder { color: #3D4F6B; }

.search-clear-btn {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 7px;
  margin: auto 0;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: #7A8DAA;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}

.search-clear-btn:hover {
  background: rgba(255,255,255,0.08);
  color: #C8D5E8;
}

.date-filter {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  min-width: min(240px, 65vw);
}

.date-filter-label {
  font-size: 0.74rem;
  color: #9CB3D0;
  font-weight: 700;
}

.receivings-date-picker {
  width: min(260px, 70vw);
}

.btn-secondary {
  min-height: 40px;
  padding-inline: 0.9rem;
  background: transparent;
  color: #60A5FA;
  border: 1px dashed rgba(26,86,219,0.45);
  border-radius: 0.75rem;
  cursor: pointer;
  font-weight: 700;
}

.btn-secondary:hover {
  background: rgba(26,86,219,0.08);
}

.form-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.date-input {
  height: 40px;
  min-height: 40px;
  padding-inline-end: 2.75rem;
  padding-inline-start: 0.875rem;
  color-scheme: dark;
  line-height: 1.2;
}

.prime-date-input {
  font-variant-numeric: tabular-nums;
}

.receivings-date-picker :deep(.p-inputtext),
.receivings-date-picker :deep(input.p-datepicker-input) {
  background: rgba(255, 255, 255, 0.07) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  color: #E8EDF5 !important;
}

.receivings-date-picker :deep(.p-inputtext:enabled:hover),
.receivings-date-picker :deep(input.p-datepicker-input:enabled:hover) {
  border-color: rgba(26, 86, 219, 0.45) !important;
}

.receivings-date-picker :deep(.p-inputtext:enabled:focus),
.receivings-date-picker :deep(input.p-datepicker-input:enabled:focus) {
  border-color: rgba(26, 86, 219, 0.8) !important;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15) !important;
}

.receivings-date-picker :deep(.p-datepicker-input) {
  height: 40px !important;
  min-height: 40px !important;
  line-height: 1.2;
  box-sizing: border-box;
  padding-inline-start: 0.875rem !important;
  padding-inline-end: 2.75rem !important;
  padding-right: 0.875rem !important;
  padding-left: 2.75rem !important;
  text-align: right;
}

.receivings-date-picker :deep(.p-inputtext::placeholder) {
  color: #3D4F6B;
  opacity: 1;
}

.receivings-date-picker :deep(.p-datepicker-input-icon-container) {
  position: absolute;
  inset-inline-end: 0.75rem;
  inset-block: 0;
  margin: auto;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  padding: 0;
  background: transparent;
  border: none;
  pointer-events: none;
}

.receivings-date-picker :deep(.p-datepicker-input-icon) {
  font-size: 0.95rem;
  line-height: 1;
}

.receivings-date-picker :deep(.p-datepicker-dropdown) {
  display: none;
}

.receivings-date-picker :deep(.p-datepicker-panel) {
  margin-top: 6px;
  border-radius: 12px;
  border: 1px solid rgba(26,86,219,0.30);
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  color: #E8EDF5;
}

.receivings-date-picker :deep(.p-datepicker-calendar-container),
.receivings-date-picker :deep(.p-datepicker-calendar),
.receivings-date-picker :deep(.p-datepicker-month-view),
.receivings-date-picker :deep(.p-datepicker-year-view) {
  background: transparent !important;
}

.receivings-date-picker :deep(.p-datepicker-header) {
  background: transparent;
  border-bottom: 1px solid rgba(26,86,219,0.20);
  color: #E8EDF5;
}

.receivings-date-picker :deep(.p-datepicker-title button),
.receivings-date-picker :deep(.p-datepicker-prev),
.receivings-date-picker :deep(.p-datepicker-next) {
  color: #C8D5E8;
}

.receivings-date-picker :deep(.p-datepicker-title button:hover),
.receivings-date-picker :deep(.p-datepicker-prev:hover),
.receivings-date-picker :deep(.p-datepicker-next:hover) {
  background: rgba(26, 86, 219, 0.16) !important;
}

.receivings-date-picker :deep(.p-datepicker-day),
.receivings-date-picker :deep(.p-datepicker-month),
.receivings-date-picker :deep(.p-datepicker-year) {
  color: #C8D5E8;
}

.receivings-date-picker :deep(.p-datepicker-day:hover) {
  background: rgba(26,86,219,0.16);
}

.receivings-date-picker :deep(.p-datepicker-day-selected) {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #FFFFFF;
}

@media (max-width: 760px) {
  .table-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-fields {
    width: 100%;
  }

  .search-wrap,
  .date-filter,
  .search-input,
  .receivings-date-picker {
    width: 100%;
    min-width: 0;
  }

  .btn-secondary {
    align-self: flex-end;
  }
}

@media (min-width: 1024px) {
  /* Match the sibling Back Office list pages: fixed-height shell, only the
     table scrolls (sticky header/toolbar) — instead of a magic max-height. */
  .page { height: 100dvh; overflow: hidden; }
  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}
.data-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.col-supplier { width: 25%; }
.col-date { width: 22%; }
.col-rate { width: 16%; }
.col-meta { width: 21%; }
.col-cost { width: 16%; }
.table-head-row { background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.05); }
.th { text-align: right; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #637285; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
.th-sort { cursor: pointer; user-select: none; transition: color 0.12s; }
.th-sort:hover { color: #93B4F0; }
.th-sort--active { color: #60A5FA; }
.sort-arrow { display: inline-block; margin-inline-start: 4px; font-size: 9px; }
.table-row { cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.12s; }
.table-row:last-child { border-bottom: none; }
.table-row:hover { background: rgba(26,86,219,0.06); }
.table-row-empty { border-bottom: none; }
.td { padding: 12px 14px; font-size: 0.875rem; color: #C8D5E8; vertical-align: middle; }
.td-name { font-weight: 600; color: #E8EDF5; }
.td-total { color: #4ADE80; font-weight: 600; font-variant-numeric: tabular-nums; }
.td-muted { color: #637285; }
.td-empty {
  text-align: center;
  color: #8FA7C6;
  padding-block: 1rem;
}
.th-date, .td-date { white-space: nowrap; }
.th-rate, .th-total,
.td-rate, .td-total {
  text-align: left;
  direction: ltr;
  white-space: nowrap;
}

.meta-badges {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.35rem;
  min-height: 1.5rem;
}

.mini-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  border: 1px solid transparent;
  white-space: nowrap;
}

.mini-badge-photo {
  color: #8FD3FF;
  background: rgba(35, 143, 255, 0.16);
  border-color: rgba(35, 143, 255, 0.3);
}

.mini-badge-note {
  color: #F8D98A;
  background: rgba(255, 189, 47, 0.14);
  border-color: rgba(255, 189, 47, 0.28);
}

.mini-badge-empty {
  color: #7A8DAA;
  background: rgba(122, 141, 170, 0.16);
  border-color: rgba(122, 141, 170, 0.24);
}

.list-paginator {
  margin-top: 16px;
}

.list-paginator :deep(.p-paginator) {
  background: transparent;
  border: none;
  color: #637285;
  flex-wrap: wrap;
  gap: 4px;
}

.list-paginator :deep(.p-paginator-page),
.list-paginator :deep(.p-paginator-first),
.list-paginator :deep(.p-paginator-prev),
.list-paginator :deep(.p-paginator-next),
.list-paginator :deep(.p-paginator-last) {
  color: #C8D5E8;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  border-radius: 0.5rem;
  min-width: 2.25rem;
  height: 2.25rem;
}

.list-paginator :deep(.p-paginator-page:hover),
.list-paginator :deep(.p-paginator-first:not(:disabled):hover),
.list-paginator :deep(.p-paginator-prev:not(:disabled):hover),
.list-paginator :deep(.p-paginator-next:not(:disabled):hover),
.list-paginator :deep(.p-paginator-last:not(:disabled):hover) {
  border-color: rgba(26,86,219,0.40);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(255,255,255,0.06));
}

.list-paginator :deep(.p-paginator-page.p-paginator-page-selected) {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border-color: transparent;
  box-shadow: 0 6px 20px rgba(26,86,219,0.35), inset 0 1px 0 rgba(255,255,255,0.10);
  color: #fff;
}

.list-paginator :deep(.p-paginator-rpp-dropdown) {
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  border-radius: 0.75rem;
  height: 2.25rem;
  overflow: hidden;
}

.list-paginator :deep(.p-paginator-rpp-dropdown .p-select-label) {
  color: #E8EDF5;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  padding-block: 0;
  padding-inline: 10px;
}

.list-paginator :deep(.p-paginator-rpp-dropdown .p-select-dropdown) {
  color: #637285;
  border-inline-start: 1px solid rgba(26,86,219,0.22);
  min-width: 2rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.list-paginator :deep(.p-paginator-rpp-dropdown:hover .p-select-dropdown) {
  border-inline-start-color: rgba(26,86,219,0.40);
}

.list-paginator :deep(.p-paginator-rpp-dropdown.p-focus) {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}
.btn-primary {
  display: flex; align-items: center; gap: 0.5rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; border: none;
  padding: 0.6rem 1.1rem; border-radius: 0.75rem; font-weight: 700; font-size: 0.875rem;
  cursor: pointer; box-shadow: 0 4px 16px rgba(26,86,219,0.40);
}
.btn-icon { width: 1rem; height: 1rem; flex-shrink: 0; }
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  padding: 1rem;
}

.overlay-card {
  background: #0A1320;
  border-radius: 1rem;
  width: min(560px, 94vw);
  max-height: 90vh;
  overflow: hidden;
  padding: 0.5rem;
}

.detail-overlay-card {
  position: relative;
  width: min(760px, 96vw);
  max-height: 92vh;
  padding: 2.7rem 0.55rem 0.55rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(10,19,32,0.98));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 20px 60px rgba(2,6,23,0.6), 0 8px 24px rgba(26,86,219,0.22);
}

.close-btn {
  position: absolute;
  inset-inline-end: 0.95rem;
  inset-block-start: 0.7rem;
  z-index: 2;
  width: 2rem;
  height: 2rem;
  border-radius: 0.65rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.06);
  color: #C8D5E8;
  border: 1px solid rgba(148,163,184,0.18);
  cursor: pointer;
  font-size: 0.92rem;
  transition: background 0.12s, border-color 0.12s, transform 0.12s;
}

.close-btn:hover {
  background: rgba(255,255,255,0.12);
  border-color: rgba(26,86,219,0.45);
  transform: translateY(-1px);
}
</style>
