<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Paginator from 'primevue/paginator'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSuppliers } from './composables/useSuppliers'
import { useReceivings } from './composables/useReceivings'
import ReceivingSheet from './components/ReceivingSheet.vue'
import type { Supplier } from './supplier.types'
import type { Receiving } from './receiving.types'

const route = useRoute()
const router = useRouter()
const supplierId = route.params.id as string

const { getById } = useSuppliers()
const { receivings, loadForSupplier } = useReceivings()

const supplier = ref<Supplier | null>(null)
const showSheet = ref(false)

type SortKey = 'receivedAt' | 'exchangeRateAtReceiving' | 'meta' | 'totalCostUsd'
const sortKey = ref<SortKey>('receivedAt')
const sortDir = ref<'asc' | 'desc'>('desc')

const first = ref(0)
const rows = ref(10)

const sortedReceivings = computed(() => {
  const list = [...receivings.value]
  const dir = sortDir.value === 'asc' ? 1 : -1

  return list.sort((a, b) => {
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

const receivingsTotalUsd = computed(() =>
  receivings.value.reduce((sum, r) => sum + r.totalCostUsd, 0),
)

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

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'receivedAt' ? 'desc' : 'asc'
  }
  first.value = 0
}

function onPage(e: { first: number; rows: number }) {
  first.value = e.first
  rows.value = e.rows
}

async function refresh() {
  supplier.value = await getById(supplierId)
  await loadForSupplier(supplierId)
}

onMounted(refresh)

watch(
  () => sortedReceivings.value.length,
  (len) => {
    if (first.value >= len) {
      first.value = Math.max(0, (Math.ceil(Math.max(len, 1) / rows.value) - 1) * rows.value)
    }
  },
)

async function onSaved() {
  showSheet.value = false
  await refresh()
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader
      :title="supplier?.name || 'تفاصيل المورد'"
      :show-back="true"
      @back="router.back()"
    />

    <main class="page-main">
      <div v-if="supplier" class="supplier-card">
        <div class="supplier-main">
          <h1 class="supplier-name">{{ supplier.name }}</h1>
          <p v-if="supplier.notes" class="supplier-notes">{{ supplier.notes }}</p>
        </div>

        <div class="supplier-meta">
          <div class="meta-chip" v-if="supplier.phone">
            <span class="meta-label">الهاتف</span>
            <span class="meta-value" dir="ltr">{{ supplier.phone }}</span>
          </div>
          <div class="meta-chip" v-if="supplier.contactPerson">
            <span class="meta-label">جهة الاتصال</span>
            <span class="meta-value">{{ supplier.contactPerson }}</span>
          </div>
          <div class="meta-chip" v-if="supplier.address">
            <span class="meta-label">العنوان</span>
            <span class="meta-value">{{ supplier.address }}</span>
          </div>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-box">
          <span class="stat-label">عدد الاستلامات</span>
          <span class="stat-value">{{ receivings.length }}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">إجمالي التكلفة</span>
          <span class="stat-value stat-value-green" dir="ltr">${{ receivingsTotalUsd.toFixed(2) }}</span>
        </div>
      </div>

      <div class="section-head">
        <h2 class="section-title">سجلّ الاستلام</h2>
        <button type="button" class="btn-primary" @click="showSheet = true">
          <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          تسجيل استلام
        </button>
      </div>

      <div v-if="receivings.length" class="table-wrap desktop-only">
        <table class="data-table">
          <colgroup>
            <col class="col-date" />
            <col class="col-rate" />
            <col class="col-meta" />
            <col class="col-cost" />
          </colgroup>
          <thead>
            <tr class="table-head-row">
              <th class="th th-date th-sort" :class="{ 'th-sort--active': sortKey === 'receivedAt' }" @click="toggleSort('receivedAt')">
                التاريخ<span class="sort-arrow">{{ sortKey === 'receivedAt' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
              </th>
              <th class="th th-rate th-sort" :class="{ 'th-sort--active': sortKey === 'exchangeRateAtReceiving' }" @click="toggleSort('exchangeRateAtReceiving')">
                سعر الصرف<span class="sort-arrow">{{ sortKey === 'exchangeRateAtReceiving' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
              </th>
              <th class="th th-meta th-sort" :class="{ 'th-sort--active': sortKey === 'meta' }" @click="toggleSort('meta')">
                مرفقات وملاحظات<span class="sort-arrow">{{ sortKey === 'meta' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
              </th>
              <th class="th th-cost th-sort" :class="{ 'th-sort--active': sortKey === 'totalCostUsd' }" @click="toggleSort('totalCostUsd')">
                التكلفة<span class="sort-arrow">{{ sortKey === 'totalCostUsd' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paginatedReceivings" :key="r.id" class="table-row">
              <td class="td td-date td-muted">{{ fmtDate(r.receivedAt) }}</td>
              <td class="td td-rate" dir="ltr">{{ fmtRate(r.exchangeRateAtReceiving) }}</td>
              <td class="td td-meta-cell">
                <div class="meta-badges">
                  <span v-if="r.invoicePhotoUrl" class="mini-badge mini-badge-photo">فاتورة</span>
                  <span v-if="r.notes" class="mini-badge mini-badge-note">ملاحظة</span>
                  <span v-if="!r.invoicePhotoUrl && !r.notes" class="mini-badge mini-badge-empty">—</span>
                </div>
              </td>
              <td class="td td-cost td-total" dir="ltr">{{ r.totalCostUsd.toFixed(2) }}$</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="receivings.length" class="mobile-list mobile-only">
        <div v-for="r in paginatedReceivings" :key="r.id" class="receiving-card">
          <div class="receiving-top">
            <span class="receiving-date">{{ fmtDate(r.receivedAt) }}</span>
            <span class="receiving-total" dir="ltr">${{ r.totalCostUsd.toFixed(2) }}</span>
          </div>
        </div>
      </div>

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

      <div v-else class="empty-card">
        <p class="empty-title">لا يوجد استلام مسجّل</p>
        <p class="empty-sub">ابدأ بإضافة أول استلام من الزر بالأعلى</p>
      </div>
    </main>

    <div v-if="showSheet" class="overlay" @click.self="showSheet = false">
      <div class="overlay-card">
        <ReceivingSheet
          :preset-supplier="supplier ? { id: supplier.id, name: supplier.name } : undefined"
          @saved="onSaved"
          @close="showSheet = false"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.page-main {
  flex: 1;
  padding: 1rem 1rem 6rem;
  width: 100%;
}

@media (min-width: 1024px) {
  .page-main {
    padding: 1.25rem 1.5rem 6rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
}

.supplier-card {
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
  padding: 1rem;
  margin-bottom: 0.875rem;
}

.supplier-name {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #E8EDF5;
}

.supplier-notes {
  margin: 0.35rem 0 0;
  color: #9CB3D0;
  font-size: 0.8125rem;
}

.supplier-meta {
  margin-top: 0.875rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.meta-chip {
  border-radius: 0.75rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.10);
  padding: 0.45rem 0.6rem;
  min-width: 9rem;
}

.meta-label {
  display: block;
  font-size: 0.675rem;
  color: #637285;
  margin-bottom: 0.15rem;
}

.meta-value {
  display: block;
  font-size: 0.8125rem;
  color: #E8EDF5;
  font-weight: 600;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
  margin-bottom: 0.95rem;
}

.stat-box {
  border-radius: 0.875rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.22);
  padding: 0.7rem 0.8rem;
}

.stat-label {
  display: block;
  color: #637285;
  font-size: 0.72rem;
}

.stat-value {
  display: block;
  margin-top: 0.22rem;
  color: #E8EDF5;
  font-size: 1rem;
  font-weight: 700;
}

.stat-value-green {
  color: #4ADE80;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.7rem;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 40px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  border: none;
  padding-inline: 0.9rem;
  border-radius: 0.625rem;
  font-weight: 700;
  font-size: 0.8125rem;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.35);
  font-family: inherit;
}

.btn-icon { width: 0.9rem; height: 0.9rem; flex-shrink: 0; }

.table-wrap {
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}

@media (min-width: 768px) {
  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}

.data-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.col-date { width: 34%; }
.col-rate { width: 22%; }
.col-meta { width: 24%; }
.col-cost { width: 20%; }
.table-head-row { background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(26,86,219,0.14); }
.th { text-align: right; padding: 12px 14px; font-size: 11px; font-weight: 700; color: #637285; text-transform: uppercase; letter-spacing: 0.06em; }
.th-sort {
  cursor: pointer;
  user-select: none;
}

.th-sort--active {
  color: #BFDBFE;
}

.sort-arrow {
  margin-inline-start: 0.35rem;
  font-size: 0.625rem;
}
.table-row { border-bottom: 1px solid rgba(26,86,219,0.12); }
.table-row:last-child { border-bottom: none; }
.table-row:hover { background: rgba(26,86,219,0.07); }
.td { padding: 12px 14px; font-size: 0.875rem; color: #C8D5E8; }
.td-muted { color: #637285; }
.td-total { color: #4ADE80; font-weight: 600; font-variant-numeric: tabular-nums; }
.th-date, .td-date {
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.th-rate, .td-rate, .th-cost, .td-cost {
  text-align: left;
  white-space: nowrap;
}
.th-meta, .td-meta-cell {
  text-align: right;
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

.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.receiving-card {
  border-radius: 0.95rem;
  border: 1px solid rgba(26,86,219,0.24);
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  box-shadow: 0 4px 16px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
  padding: 0.8rem 0.9rem;
}

.receiving-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.receiving-date {
  color: #9CB3D0;
  font-size: 0.8125rem;
}

.receiving-total {
  color: #4ADE80;
  font-weight: 700;
  font-size: 0.9rem;
}

.empty-card {
  border-radius: 1rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.08);
  padding: 2.25rem 1rem;
  text-align: center;
}

.empty-title {
  margin: 0;
  color: #E8EDF5;
  font-weight: 700;
  font-size: 0.9rem;
}

.empty-sub {
  margin: 0.35rem 0 0;
  color: #637285;
  font-size: 0.8rem;
}

.desktop-only { display: none; }
.mobile-only { display: flex; }

@media (min-width: 768px) {
  .desktop-only { display: block; }
  .mobile-only { display: none; }
}

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow: hidden; }
</style>
