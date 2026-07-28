<!-- WAFI-017 Unified "Money Owed" View. Point-in-time snapshot (no period
     selector) combining credit + installments per customer with aging
     buckets. Coexists with CollectionsWorklistPage.vue — does not replace
     it (see design doc §7): Collections is the daily follow-up workflow,
     this screen is the periodic risk-triage summary. USD only — see the
     on-screen caveat below. See
     docs/superpowers/specs/2026-07-28-wafi-017-money-owed-design.md. -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useMoneyOwed } from './composables/useMoneyOwed'
import type { MoneyOwedRow, AgingBucket } from './composables/useMoneyOwed'

const router = useRouter()
const { rows, totals, load } = useMoneyOwed()

type SortKey = 'customerName' | 'creditOwedUsd' | 'installmentOwedUsd' | 'totalOwedUsd' | 'ageDays'
const sortKey = ref<SortKey>('ageDays')
const sortDir = ref<'asc' | 'desc'>('desc')

const BUCKET_LABEL: Record<AgingBucket, string> = {
  '0_30': '0-30', '31_60': '31-60', '60_plus': '60+',
}

function selectSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = key
  sortDir.value = key === 'customerName' ? 'asc' : 'desc'
}

// Fixed tie-break chain regardless of the active sort column: ageDays desc,
// then totalOwedUsd desc, then customerName asc — always fully deterministic.
function compareRows(a: MoneyOwedRow, b: MoneyOwedRow): number {
  const primary = compareByKey(a, b, sortKey.value, sortDir.value)
  if (primary !== 0) return primary
  const byAge = compareByKey(a, b, 'ageDays', 'desc')
  if (byAge !== 0) return byAge
  const byTotal = compareByKey(a, b, 'totalOwedUsd', 'desc')
  if (byTotal !== 0) return byTotal
  return compareByKey(a, b, 'customerName', 'asc')
}

function compareByKey(a: MoneyOwedRow, b: MoneyOwedRow, key: SortKey, dir: 'asc' | 'desc'): number {
  const av = a[key]
  const bv = b[key]
  const cmp = typeof av === 'string' || typeof bv === 'string'
    ? String(av).localeCompare(String(bv), 'ar')
    : (av as number) - (bv as number)
  return dir === 'asc' ? cmp : -cmp
}

const sortedRows = computed(() => [...rows.value].sort(compareRows))
const hasActivity = computed(() => rows.value.length > 0)

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

onMounted(load)
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="المبالغ المستحقة" :show-back="true" @back="router.back()" />

    <main class="page-main">
      <div class="bucket-cards">
        <div class="bucket-card" data-test="bucket-0_30">
          <p class="bucket-label">0-30 يوم</p>
          <p class="bucket-amount" dir="ltr">{{ fmtUsd(totals['0_30']) }}</p>
        </div>
        <div class="bucket-card" data-test="bucket-31_60">
          <p class="bucket-label">31-60 يوم</p>
          <p class="bucket-amount" dir="ltr">{{ fmtUsd(totals['31_60']) }}</p>
        </div>
        <div class="bucket-card" data-test="bucket-60_plus">
          <p class="bucket-label">60+ يوم</p>
          <p class="bucket-amount" dir="ltr">{{ fmtUsd(totals['60_plus']) }}</p>
        </div>
      </div>
      <p class="grand-total" data-test="grand-total">
        الإجمالي: <span dir="ltr">{{ fmtUsd(totals.grandTotal) }}</span>
      </p>

      <EmptyState
        v-if="!hasActivity"
        data-test="empty"
        title="لا يوجد مبالغ مستحقة حالياً"
      />

      <div v-else class="table-wrap">
        <table class="owed-table" data-test="owed-table">
          <thead>
            <tr>
              <th data-test="sort-name" @click="selectSort('customerName')">الزبون</th>
              <th data-test="sort-credit" @click="selectSort('creditOwedUsd')">دين</th>
              <th data-test="sort-installment" @click="selectSort('installmentOwedUsd')">أقساط</th>
              <th data-test="sort-total" @click="selectSort('totalOwedUsd')">الإجمالي</th>
              <th data-test="sort-age" @click="selectSort('ageDays')">الأيام</th>
              <th>الفئة</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in sortedRows"
              :key="row.customerId"
              :data-test="`owed-row-${row.customerId}`"
              @click="router.push(`/customers/${row.customerId}`)"
            >
              <td class="name-cell">{{ row.customerName }}</td>
              <td dir="ltr">{{ fmtUsd(row.creditOwedUsd) }}</td>
              <td dir="ltr">{{ fmtUsd(row.installmentOwedUsd) }}</td>
              <td dir="ltr">{{ fmtUsd(row.totalOwedUsd) }}</td>
              <td>{{ row.ageDays }}</td>
              <td>{{ BUCKET_LABEL[row.bucket] }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="caption">المبالغ بالدولار فقط، ولا تشمل أي رصيد بالليرة السورية بشكل منفصل.</p>
    </main>
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
.page-main { flex: 1; padding: 1rem 1rem 6rem; max-width: 42rem; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 14px; }

.bucket-cards { display: flex; gap: 8px; flex-wrap: wrap; }
.bucket-card {
  flex: 1;
  min-width: 100px;
  padding: 12px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  text-align: center;
}
.bucket-label { margin: 0; font-size: 0.75rem; color: #93A3B8; }
.bucket-amount { margin: 4px 0 0; font-size: 1.05rem; font-weight: 800; color: #E8EDF5; font-variant-numeric: tabular-nums; }

.grand-total { margin: 0; font-size: 0.9rem; font-weight: 700; color: #C8D5E8; text-align: center; }

.table-wrap { overflow-x: auto; }
.owed-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.owed-table th {
  text-align: right; padding: 10px 12px; cursor: pointer; user-select: none;
  color: #93A3B8; font-weight: 700; white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.owed-table td {
  padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.owed-table tbody tr { cursor: pointer; }
.name-cell { font-weight: 700; color: #E8EDF5; }

.caption { margin: 0; font-size: 0.76rem; color: #93A3B8; line-height: 1.5; }
</style>
