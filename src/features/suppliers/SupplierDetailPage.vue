<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSuppliers } from './composables/useSuppliers'
import { useReceivings } from './composables/useReceivings'
import ReceivingSheet from './components/ReceivingSheet.vue'
import type { Supplier } from './supplier.types'

const route = useRoute()
const supplierId = route.params.id as string

const { getById } = useSuppliers()
const { receivings, loadForSupplier } = useReceivings()

const supplier = ref<Supplier | null>(null)
const showSheet = ref(false)

async function refresh() {
  supplier.value = await getById(supplierId)
  await loadForSupplier(supplierId)
}

onMounted(refresh)

async function onSaved() {
  showSheet.value = false
  await refresh()
}
</script>

<template>
  <section class="page" dir="rtl">
    <header v-if="supplier" class="info">
      <h1>{{ supplier.name }}</h1>
      <p v-if="supplier.phone">{{ supplier.phone }}</p>
      <p v-if="supplier.contactPerson">{{ supplier.contactPerson }}</p>
      <p v-if="supplier.address">{{ supplier.address }}</p>
      <p v-if="supplier.notes" class="muted">{{ supplier.notes }}</p>
    </header>

    <div class="section-head">
      <h2>سجلّ الاستلام</h2>
      <button class="btn-primary" @click="showSheet = true">
        <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        تسجيل استلام
      </button>
    </div>

    <div v-if="receivings.length" class="table-wrap">
      <table class="data-table">
        <thead>
          <tr class="table-head-row">
            <th class="th">التاريخ</th>
            <th class="th">التكلفة</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in receivings" :key="r.id" class="table-row">
            <td class="td td-muted">{{ new Date(r.receivedAt).toLocaleDateString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric' }) }}</td>
            <td class="td td-total" dir="ltr">{{ r.totalCostUsd.toFixed(2) }}$</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="empty">لا يوجد استلام مسجّل.</p>

    <div v-if="showSheet" class="overlay">
      <div class="overlay-card">
        <ReceivingSheet
          :preset-supplier="supplier ? { id: supplier.id, name: supplier.name } : undefined"
          @saved="onSaved"
          @close="showSheet = false"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.info p { margin: 0.15rem 0; }
.muted { color: #9CB3D0; }
.section-head { display: flex; align-items: center; justify-content: space-between; }
.section-head h2 { font-size: 1rem; font-weight: 700; color: #E8EDF5; }
.empty { color: #9CB3D0; text-align: center; padding: 1.5rem 0; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; border: none;
  padding: 0.5rem 0.9rem; border-radius: 0.625rem; font-weight: 700; font-size: 0.8125rem;
  cursor: pointer; box-shadow: 0 4px 16px rgba(26,86,219,0.35); font-family: inherit;
}
.btn-icon { width: 0.9rem; height: 0.9rem; flex-shrink: 0; }
.table-wrap {
  border-radius: 1rem; overflow: hidden;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28); box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}
.data-table { width: 100%; border-collapse: collapse; }
.table-head-row { background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.05); }
.th { text-align: right; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #637285; text-transform: uppercase; letter-spacing: 0.06em; }
.table-row { border-bottom: 1px solid rgba(255,255,255,0.05); }
.table-row:last-child { border-bottom: none; }
.td { padding: 12px 14px; font-size: 0.875rem; color: #C8D5E8; }
.td-muted { color: #637285; }
.td-total { color: #4ADE80; font-weight: 600; font-variant-numeric: tabular-nums; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; }
</style>
