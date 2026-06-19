<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSuppliers } from './composables/useSuppliers'
import SupplierForm from './components/SupplierForm.vue'
import ReceivingSheet from './components/ReceivingSheet.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import type { NewSupplier } from './supplier.types'

const router = useRouter()
const { suppliers, load, save } = useSuppliers()
const adding  = ref(false)
const query   = ref('')
const receivingFor = ref<{ id: string; name: string } | null>(null)

onMounted(load)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return suppliers.value
  return suppliers.value.filter(s =>
    s.name.toLowerCase().includes(q) || (s.phone ?? '').includes(q)
  )
})

async function onAdd(data: NewSupplier) {
  await save(data)
  adding.value = false
  await load()
}

async function onReceivingSaved() {
  receivingFor.value = null
  await load()
}

function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="الموردون" />

    <main class="page-main">
      <!-- Toolbar: search + add -->
      <div class="toolbar">
        <div class="search-wrap">
          <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input v-model="query" type="search" class="search-input" placeholder="بحث بالاسم أو الهاتف..." />
        </div>
        <button type="button" class="btn-primary" @click="adding = true">
          <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          مورّد جديد
        </button>
      </div>

      <!-- Empty -->
      <EmptyState
        v-if="!suppliers.length"
        title="لا يوجد موردون بعد"
        subtitle="أضف أول مورّد بالضغط على الزر أدناه"
        cta-label="مورّد جديد"
        @cta="adding = true"
      />

      <p v-else-if="!filtered.length" class="no-results">لا توجد نتائج مطابقة</p>

      <!-- Desktop table -->
      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr class="table-head-row">
              <th class="th">الاسم</th>
              <th class="th">الهاتف</th>
              <th class="th">إجمالي المشتريات</th>
              <th class="th">آخر استلام</th>
              <th class="th th-actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in filtered" :key="s.id" class="table-row" @click="router.push(`/suppliers/${s.id}`)">
              <td class="td td-name">{{ s.name }}</td>
              <td class="td td-muted">{{ s.phone || '—' }}</td>
              <td class="td td-total" dir="ltr">{{ s.totalPurchasedUsd.toFixed(0) }}$</td>
              <td class="td td-muted">{{ fmtDate(s.lastReceivedAt) }}</td>
              <td class="td td-actions" @click.stop>
                <button type="button" class="row-action" @click="receivingFor = { id: s.id, name: s.name }">تسجيل استلام</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <!-- Add supplier modal -->
    <BaseModal v-if="adding" title="مورّد جديد" @close="adding = false">
      <SupplierForm @submit="onAdd" @cancel="adding = false" />
    </BaseModal>

    <!-- Record receiving for a specific supplier -->
    <div v-if="receivingFor" class="overlay" @click.self="receivingFor = null">
      <div class="overlay-card">
        <ReceivingSheet
          :preset-supplier="receivingFor"
          @saved="onReceivingSaved"
          @close="receivingFor = null"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-root { display: flex; flex-direction: column; min-height: 100dvh; background: #06090F; font-family: 'Tajawal', system-ui, sans-serif; }

@media (min-width: 1024px) {
  .page-root { height: 100dvh; overflow: hidden; }
}

.page-main { flex: 1; padding: 1rem 1rem 6rem; width: 100%; }
@media (min-width: 1024px) {
  .page-main {
    padding: 1.25rem 1.5rem 6rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
}

.toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; }
.search-wrap { position: relative; flex: 1; max-width: 28rem; }
.search-icon { position: absolute; inset-block: 0; inset-inline-end: 0.75rem; margin: auto; width: 1rem; height: 1rem; color: #637285; pointer-events: none; }
.search-input {
  width: 100%; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem; padding: 0.625rem 2.5rem 0.625rem 0.875rem; color: #E8EDF5; font-size: 0.875rem;
  outline: none; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s;
}
.search-input::placeholder { color: #3D4F6B; }

.btn-primary {
  display: inline-flex; align-items: center; gap: 0.5rem; flex-shrink: 0;
  height: 44px; padding-inline: 1.25rem; border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; border: none;
  font-size: 0.875rem; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(26,86,219,0.40);
  font-family: inherit;
}
.btn-icon { width: 1rem; height: 1rem; flex-shrink: 0; }

.no-results { text-align: center; color: #637285; padding: 3rem 0; font-size: 0.875rem; }

.table-wrap {
  border-radius: 1rem; overflow: hidden;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28); box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}

@media (min-width: 1024px) {
  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}
.data-table { width: 100%; border-collapse: collapse; }
.table-head-row { background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.05); }
.th { text-align: right; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #637285; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
.th-actions { width: 1%; }
.table-row { cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.12s; }
.table-row:last-child { border-bottom: none; }
.table-row:hover { background: rgba(26,86,219,0.06); }
.td { padding: 12px 14px; font-size: 0.875rem; color: #C8D5E8; }
.td-name { font-weight: 600; color: #E8EDF5; }
.td-muted { color: #637285; }
.td-total { color: #4ADE80; font-weight: 600; font-variant-numeric: tabular-nums; }
.td-actions { white-space: nowrap; }
.row-action {
  font-size: 0.75rem; font-weight: 700; padding: 0.4rem 0.75rem; border-radius: 0.5rem;
  color: #60A5FA; background: rgba(26,86,219,0.12); border: 1px solid rgba(26,86,219,0.30);
  cursor: pointer; font-family: inherit; transition: background 0.12s;
}
.row-action:hover { background: rgba(26,86,219,0.22); }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 1rem; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow: hidden; }
</style>
