<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Paginator from 'primevue/paginator'
import { useReceivings } from './composables/useReceivings'
import ReceivingDetail from './components/ReceivingDetail.vue'
import ReceivingSheet from './components/ReceivingSheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { Receiving, ReceivingDetailData } from './receiving.types'

const { receivings, load, loadDetail } = useReceivings()
const detail    = ref<ReceivingDetailData | null>(null)
const showSheet = ref(false)

type SortKey = 'supplierName' | 'receivedAt' | 'exchangeRateAtReceiving' | 'meta' | 'totalCostUsd'
const sortKey = ref<SortKey>('receivedAt')
const sortDir = ref<'asc' | 'desc'>('desc')

const first = ref(0)
const rows = ref(10)

const sortedReceivings = computed(() => {
  const list = [...receivings.value]
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
            <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'receivedAt' }" @click="toggleSort('receivedAt')">
              التاريخ<span class="sort-arrow">{{ sortKey === 'receivedAt' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'exchangeRateAtReceiving' }" @click="toggleSort('exchangeRateAtReceiving')">
              سعر الصرف<span class="sort-arrow">{{ sortKey === 'exchangeRateAtReceiving' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'meta' }" @click="toggleSort('meta')">
              مرفقات وملاحظات<span class="sort-arrow">{{ sortKey === 'meta' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
            <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'totalCostUsd' }" @click="toggleSort('totalCostUsd')">
              التكلفة<span class="sort-arrow">{{ sortKey === 'totalCostUsd' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in paginatedReceivings" :key="r.id" class="table-row" @click="open(r.id)">
            <td class="td td-name">{{ r.supplierName }}</td>
            <td class="td td-muted">{{ fmtDate(r.receivedAt) }}</td>
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
      <div class="overlay-card">
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
.td { padding: 12px 14px; font-size: 0.875rem; color: #C8D5E8; }
.td-name { font-weight: 600; color: #E8EDF5; }
.td-total { color: #4ADE80; font-weight: 600; font-variant-numeric: tabular-nums; }
.td-muted { color: #637285; }
.td-rate, .td-total { text-align: left; white-space: nowrap; }

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
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow: hidden; padding: 0.5rem; }
.close-btn { background: transparent; color: #9CB3D0; border: none; float: inline-end; cursor: pointer; font-size: 1rem; }
</style>
