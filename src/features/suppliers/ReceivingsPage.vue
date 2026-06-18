<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReceivings } from './composables/useReceivings'
import ReceivingDetail from './components/ReceivingDetail.vue'
import ReceivingSheet from './components/ReceivingSheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { ReceivingDetailData } from './receiving.types'

const { receivings, load, loadDetail } = useReceivings()
const detail    = ref<ReceivingDetailData | null>(null)
const showSheet = ref(false)

onMounted(load)

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
        <thead>
          <tr class="table-head-row">
            <th class="th">المورّد</th>
            <th class="th">التكلفة</th>
            <th class="th">التاريخ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in receivings" :key="r.id" class="table-row" @click="open(r.id)">
            <td class="td td-name">{{ r.supplierName }}</td>
            <td class="td td-total" dir="ltr">{{ r.totalCostUsd.toFixed(2) }}$</td>
            <td class="td td-muted">{{ new Date(r.receivedAt).toLocaleDateString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric' }) }}</td>
          </tr>
        </tbody>
      </table>
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
.data-table { width: 100%; border-collapse: collapse; }
.table-head-row { background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.05); }
.th { text-align: right; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #637285; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
.table-row { cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.12s; }
.table-row:last-child { border-bottom: none; }
.table-row:hover { background: rgba(26,86,219,0.06); }
.td { padding: 12px 14px; font-size: 0.875rem; color: #C8D5E8; }
.td-name { font-weight: 600; color: #E8EDF5; }
.td-total { color: #4ADE80; font-weight: 600; font-variant-numeric: tabular-nums; }
.td-muted { color: #637285; }
.btn-primary {
  display: flex; align-items: center; gap: 0.5rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; border: none;
  padding: 0.6rem 1.1rem; border-radius: 0.75rem; font-weight: 700; font-size: 0.875rem;
  cursor: pointer; box-shadow: 0 4px 16px rgba(26,86,219,0.40);
}
.btn-icon { width: 1rem; height: 1rem; flex-shrink: 0; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; padding: 0.5rem; }
.close-btn { background: transparent; color: #9CB3D0; border: none; float: inline-end; cursor: pointer; font-size: 1rem; }
</style>
