<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import CustomerForm from './components/CustomerForm.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useCustomers } from './composables/useCustomers'

const router = useRouter()
const route  = useRoute()
const { customers, load } = useCustomers()
const showAddForm = ref(false)
const query = ref('')
const toast = ref<{ message: string; type: 'success' | 'error' } | null>(null)

// Arrived from the dashboard "زبائن بفواتير آجلة" signal → show only debtors.
const onlyDebtors = computed(() => route.query.filter === 'debtors')

onMounted(load)

const filtered = computed(() => {
  let list = customers.value
  if (onlyDebtors.value) {
    list = list.filter(c => (c.balanceUsd ?? 0) > 0.001)
  }
  if (!query.value.trim()) return list
  const q = query.value.trim().toLowerCase()
  return list.filter(c =>
    c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)
  )
})

function clearDebtorFilter() {
  router.replace({ query: {} })
}

async function handleSaved() {
  showAddForm.value = false
  toast.value = { message: 'تم إضافة الزبون', type: 'success' }
  await load()
}
</script>

<template>
  <div class="page-root" dir="rtl">

    <AppHeader title="الزبائن" />

    <main class="page-main">

      <!-- Toolbar -->
      <div class="toolbar">
        <!-- Search -->
        <div class="search-wrap">
          <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            v-model="query"
            type="text"
            placeholder="بحث بالاسم أو الهاتف..."
            class="search-input"
          />
        </div>

        <!-- Add button (desktop) -->
        <button type="button" class="btn-primary btn-add-desktop" @click="showAddForm = true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          إضافة زبون
        </button>
      </div>

      <!-- Debtor filter banner -->
      <div v-if="onlyDebtors" class="debtor-banner">
        <span>عرض الزبائن المدينين فقط</span>
        <button type="button" class="debtor-banner-clear" @click="clearDebtorFilter">عرض الكل</button>
      </div>

      <!-- Count -->
      <p class="count-label">{{ filtered.length }} زبون</p>

      <!-- Desktop: table layout -->
      <div class="desktop-table-wrap">
        <!-- Empty state (CTA only when not actively searching) -->
        <EmptyState
          v-if="filtered.length === 0"
          :title="query ? 'لا توجد نتائج مطابقة' : 'لا يوجد زبائن بعد'"
          :subtitle="query ? undefined : 'أضف أول زبون لبدء تتبّع الحسابات'"
          :cta-label="query ? undefined : 'إضافة زبون'"
          @cta="showAddForm = true"
        >
          <template #icon>
            <svg class="empty-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </template>
        </EmptyState>

        <table v-else class="customers-table">
          <thead>
            <tr class="table-header-row">
              <th class="th">الاسم</th>
              <th class="th">الهاتف</th>
              <th class="th">العنوان</th>
              <th class="th">الرصيد المستحق</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in filtered"
              :key="c.id"
              :data-testid="`customer-row-${c.id}`"
              class="table-row"
              @click="router.push(`/customers/${c.id}`)"
            >
              <td class="td"><p class="td-name">{{ c.name }}</p></td>
              <td class="td td-muted">{{ c.phone || '—' }}</td>
              <td class="td td-muted truncate" style="max-width: 200px">{{ c.address || '—' }}</td>
              <td class="td">
                <span v-if="(c.balanceUsd ?? 0) > 0.001" class="balance-owing" dir="ltr">${{ (c.balanceUsd ?? 0).toFixed(2) }}</span>
                <span v-else class="balance-clear">مسوّى</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile: card list -->
      <div class="mobile-list">
        <button
          v-for="c in filtered"
          :key="c.id"
          type="button"
          :data-testid="`customer-row-${c.id}`"
          class="customer-card"
          @click="router.push(`/customers/${c.id}`)"
        >
          <div>
            <p class="card-name">{{ c.name }}</p>
            <p v-if="c.phone" class="card-phone">{{ c.phone }}</p>
          </div>
          <div class="card-right">
            <span v-if="(c.balanceUsd ?? 0) > 0.001" class="balance-owing" dir="ltr">${{ (c.balanceUsd ?? 0).toFixed(2) }}</span>
            <span v-else class="balance-clear">مسوّى</span>
          </div>
        </button>

        <EmptyState
          v-if="filtered.length === 0"
          :title="query ? 'لا توجد نتائج مطابقة' : 'لا يوجد زبائن بعد'"
          :subtitle="query ? undefined : 'أضف أول زبون لبدء تتبّع الحسابات'"
          :cta-label="query ? undefined : 'إضافة زبون'"
          @cta="showAddForm = true"
        />
      </div>

    </main>

    <!-- Mobile FAB -->
    <button
      type="button"
      data-testid="add-customer-fab"
      class="fab"
      @click="showAddForm = true"
    >
      <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      إضافة زبون
    </button>
  </div>

  <!-- Add customer modal -->
  <Teleport v-if="showAddForm" to="body">
    <div class="modal-overlay" @click.self="showAddForm = false">
      <div class="modal-sheet" dir="rtl">
        <div class="sheet-handle"></div>

        <div class="modal-header">
          <h2 class="modal-title">إضافة زبون جديد</h2>
          <button type="button" class="modal-close-btn" @click="showAddForm = false">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <CustomerForm @saved="handleSaved" @cancel="showAddForm = false" />
        </div>
      </div>
    </div>
  </Teleport>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>

<style scoped>
/* ── Page shell ─────────────────────────────────────────── */
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

/* ── Toolbar ────────────────────────────────────────────── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

/* ── Search ─────────────────────────────────────────────── */
.search-wrap {
  position: relative;
  flex: 1;
  max-width: 28rem;
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
  padding: 0.625rem 2.5rem 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}

.search-input::placeholder { color: #637285; }

.search-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn-primary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 44px;
  padding-inline: 1.5rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
  transition: opacity 0.15s, box-shadow 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
  font-family: inherit;
}

.btn-primary:hover {
  opacity: 0.88;
  box-shadow: 0 6px 24px rgba(26,86,219,0.55);
}

.btn-add-desktop { display: none; }
@media (min-width: 1024px) { .btn-add-desktop { display: flex; } }

/* ── Debtor filter banner ────────────────────────────────── */
.debtor-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  margin-bottom: 0.75rem;
  border-radius: 0.75rem;
  background: rgba(245, 158, 11, 0.10);
  border: 1px solid rgba(245, 158, 11, 0.28);
  color: #FCD34D;
  font-size: 0.8125rem;
  font-weight: 600;
}

.debtor-banner-clear {
  font-size: 0.75rem;
  font-weight: 700;
  color: #60A5FA;
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  font-family: inherit;
}

/* ── Count label ─────────────────────────────────────────── */
.count-label {
  font-size: 0.75rem;
  color: #637285;
  margin-bottom: 0.75rem;
}

/* ── Balance ─────────────────────────────────────────────── */
.balance-owing {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #F59E0B;
  font-variant-numeric: tabular-nums;
}

.balance-clear {
  font-size: 0.75rem;
  font-weight: 600;
  color: #22C55E;
}

.card-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

/* ── Desktop table ───────────────────────────────────────── */
.desktop-table-wrap {
  display: none;
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}

@media (min-width: 1024px) {
  .desktop-table-wrap {
    display: block;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}

.customers-table { width: 100%; border-collapse: collapse; }

.table-header-row {
  background: rgba(255,255,255,0.05);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.th {
  text-align: right;
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: #637285;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.table-row {
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  transition: background 0.12s;
}

.table-row:last-child { border-bottom: none; }

.table-row:hover { background: rgba(26,86,219,0.06); }

.td { padding: 10px 14px; }

.td-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

.td-muted {
  font-size: 0.875rem;
  color: #637285;
}

/* ── Empty state (desktop) ───────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 1rem;
  gap: 0.75rem;
  color: #637285;
}

.empty-icon {
  width: 2.5rem;
  height: 2.5rem;
  opacity: 0.3;
}

.empty-text { font-size: 0.875rem; }

/* ── Chevron ─────────────────────────────────────────────── */
.chevron-icon {
  width: 1rem;
  height: 1rem;
  color: #637285;
  transform: scaleX(-1); /* RTL flip */
}

/* ── Mobile list ─────────────────────────────────────────── */
.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

@media (min-width: 1024px) { .mobile-list { display: none; } }

.customer-card {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-radius: 1rem;
  text-align: right;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  transition: background 0.12s, transform 0.1s;
  font-family: inherit;
}

.customer-card:active { transform: scale(0.99); }
.customer-card:hover { background: linear-gradient(135deg, rgba(26,86,219,0.17), rgba(255,255,255,0.06)); }

.card-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

.card-phone {
  font-size: 0.75rem;
  color: #637285;
  margin-top: 0.125rem;
}

/* ── Empty state (mobile) ────────────────────────────────── */
.empty-state-mobile {
  text-align: center;
  padding: 4rem 1rem;
  font-size: 0.875rem;
  color: #637285;
}

/* ── FAB ─────────────────────────────────────────────────── */
.fab {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  position: fixed;
  bottom: 5rem;
  inset-inline-start: 1rem;
  height: 3rem;
  padding-inline: 1.25rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 6px 24px rgba(26,86,219,0.5);
  z-index: 20;
  transition: opacity 0.15s, transform 0.1s;
  font-family: inherit;
}

.fab:active { transform: scale(0.95); }
.fab:hover { opacity: 0.9; }

@media (min-width: 1024px) { .fab { display: none; } }

/* ── Modal overlay ───────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
}

@media (min-width: 1024px) {
  .modal-overlay { align-items: center; }
}

/* ── Modal sheet ─────────────────────────────────────────── */
.modal-sheet {
  width: 100%;
  max-width: 28rem;
  border-radius: 1.25rem 1.25rem 0 0;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.45);
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}

@media (min-width: 1024px) {
  .modal-sheet { border-radius: 1.25rem; }
}

.sheet-handle {
  width: 2.5rem;
  height: 0.25rem;
  background: rgba(255,255,255,0.20);
  border-radius: 9999px;
  margin: 0.75rem auto 0;
}

@media (min-width: 1024px) { .sheet-handle { display: none; } }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid rgba(26,86,219,0.14);
}

.modal-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
}

.modal-close-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  background: rgba(255,255,255,0.06);
  border: none;
  cursor: pointer;
  transition: background 0.12s;
}

.modal-close-btn:hover { background: rgba(255,255,255,0.10); }

.modal-body { padding: 1.25rem 1.5rem 1.5rem; }
</style>
