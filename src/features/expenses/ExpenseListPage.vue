<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import ExpenseForm from './components/ExpenseForm.vue'
import { useExpenses } from './composables/useExpenses'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import type { Expense } from './expense.types'

const router = useRouter()
const route = useRoute()
const { expenses, load, deleteExpense } = useExpenses()
const { period, setPeriod } = usePeriodToggle()

const editingExpense = ref<Expense | null>(null)
const showAddForm    = ref(false)
const deleteTarget   = ref<string | null>(null)
const toast          = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const loading        = ref(false)

const periodTitle = computed(() => {
  const labels: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
  return `مصاريف ${labels[period.value] ?? ''}`
})

const periodTotal = computed(() =>
  expenses.value.reduce((sum, e) => sum + e.amountUsd, 0)
)

async function reload() {
  loading.value = true
  try {
    const { start, end } = getDateRange(period.value)
    await load(start, end)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  const p = route.query.period as string | undefined
  if (p === 'today' || p === 'week' || p === 'month') setPeriod(p)
  await reload()
})
watch(period, reload)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await deleteExpense(deleteTarget.value)
    deleteTarget.value = null
    toast.value = { message: 'تم حذف المصروف', type: 'success' }
    await reload()
  } catch {
    toast.value = { message: 'فشل الحذف', type: 'error' }
  }
}

function handleExpenseSaved() {
  editingExpense.value = null
  showAddForm.value = false
  toast.value = { message: 'تم حفظ المصروف', type: 'success' }
  reload()
}
</script>

<template>
  <div class="page-root" dir="rtl">

    <AppHeader
      :title="periodTitle"
      :show-back="true"
      @back="router.push('/')"
    />

    <!-- Period toggle + desktop add button -->
    <div class="toolbar-row">
      <PeriodToggle />
      <!-- Desktop: add expense button -->
      <button
        type="button"
        class="btn-primary btn-desktop-add"
        @click="showAddForm = true"
      >
        <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        إضافة مصروف
      </button>
    </div>

    <main class="main-content">

      <!-- Summary row -->
      <div v-if="expenses.length > 0" class="summary-row">
        <span class="summary-count">{{ expenses.length }} عملية</span>
        <span class="summary-total">${{ periodTotal.toFixed(2) }} إجمالي</span>
      </div>

      <!-- Loading skeleton -->
      <div v-if="loading" class="skeleton-list">
        <div v-for="i in 4" :key="i" class="skeleton-item"></div>
      </div>

      <!-- Empty state -->
      <div v-else-if="expenses.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <svg class="empty-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        </div>
        <div class="empty-text">
          <p class="empty-title">لا توجد مصاريف في هذه الفترة</p>
          <p class="empty-sub">أضف أول مصروف بالضغط على الزر أدناه</p>
        </div>
        <button type="button" class="btn-primary" @click="showAddForm = true">
          <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          إضافة مصروف
        </button>
      </div>

      <template v-else>
        <!-- Mobile: card list -->
        <div class="card-list sm-only">
          <div
            v-for="e in expenses"
            :key="e.id"
            :data-testid="`expense-row-${e.id}`"
            class="expense-card"
            @click="editingExpense = e"
          >
            <div class="expense-card-body">
              <div class="expense-card-top">
                <span class="expense-amount" dir="ltr">${{ e.amountUsd.toFixed(2) }}</span>
                <span class="expense-date">{{ formatDate(e.createdAt) }}</span>
              </div>
              <div class="expense-category">{{ e.category }}</div>
              <div v-if="e.notes" class="expense-notes">{{ e.notes }}</div>
            </div>
            <div v-if="e.photoUrl" class="expense-photo">
              <img :src="e.photoUrl" :alt="e.category" class="expense-photo-img" />
            </div>
          </div>
        </div>

        <!-- Desktop: table -->
        <div class="table-wrap desktop-only">
          <table class="expense-table">
            <thead>
              <tr class="table-head-row">
                <th class="th">التاريخ</th>
                <th class="th">الفئة</th>
                <th class="th">المبلغ</th>
                <th class="th">ملاحظات</th>
                <th class="th"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in expenses"
                :key="e.id"
                :data-testid="`expense-row-${e.id}`"
                class="table-row"
                @click="editingExpense = e"
              >
                <td class="td td-muted">{{ formatDate(e.createdAt) }}</td>
                <td class="td td-primary">{{ e.category }}</td>
                <td class="td td-amount" dir="ltr">${{ e.amountUsd.toFixed(2) }}</td>
                <td class="td td-muted td-notes">{{ e.notes ?? '—' }}</td>
                <td class="td">
                  <button
                    type="button"
                    class="btn-delete-inline"
                    @click.stop="deleteTarget = e.id"
                  >حذف</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

    </main>

    <!-- Mobile FAB -->
    <button
      type="button"
      class="fab"
      @click="showAddForm = true"
    >
      <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      إضافة مصروف
    </button>

    <!-- Delete confirmation -->
    <AppDialog
      v-if="deleteTarget"
      title="حذف المصروف"
      message="هل أنت متأكد من حذف هذا المصروف؟"
      confirm-label="حذف"
      cancel-label="إلغاء"
      danger
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />

    <!-- Add new expense -->
    <ExpenseForm
      v-if="showAddForm"
      @saved="handleExpenseSaved"
      @cancel="showAddForm = false"
    />

    <!-- Edit existing expense -->
    <ExpenseForm
      v-if="editingExpense"
      :initial-expense="editingExpense"
      @saved="handleExpenseSaved"
      @cancel="editingExpense = null"
    />

    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>

<style scoped>
/* ── Page root ─────────────────────────────────────── */
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
}

/* ── Toolbar ───────────────────────────────────────── */
.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1rem 0.5rem;
}
@media (min-width: 1024px) {
  .toolbar-row {
    padding: 1.25rem 1.5rem 0.5rem;
  }
}

/* ── Buttons ───────────────────────────────────────── */
.btn-primary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-inline: 1.25rem;
  height: 44px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.15s;
}
.btn-primary:active { transform: scale(0.97); }

.btn-desktop-add {
  display: none;
  flex-shrink: 0;
}
@media (min-width: 1024px) {
  .btn-desktop-add { display: flex; }
}

.btn-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

/* ── Main content ──────────────────────────────────── */
.main-content {
  flex: 1;
  padding: 0.5rem 1rem 7rem;
  width: 100%;
}
@media (min-width: 1024px) {
  .main-content { padding: 0.75rem 1.5rem 2.5rem; }
}

/* ── Summary row ───────────────────────────────────── */
.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-top: 0.25rem;
}
.summary-count {
  font-size: 0.75rem;
  color: #637285;
}
.summary-total {
  font-size: 0.875rem;
  font-weight: 700;
  color: #EF4444;
}

/* ── Skeleton ──────────────────────────────────────── */
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.skeleton-item {
  height: 4rem;
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── Empty state ───────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 5rem 0;
  gap: 1rem;
  color: #637285;
}
.empty-icon-wrap {
  width: 4rem;
  height: 4rem;
  border-radius: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}
.empty-icon { width: 2rem; height: 2rem; }
.empty-text { text-align: center; }
.empty-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
  margin-bottom: 0.25rem;
}
.empty-sub { font-size: 0.75rem; color: #637285; }

/* ── Card list (mobile) ────────────────────────────── */
.card-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.sm-only { display: flex; }
@media (min-width: 640px) { .sm-only { display: none; } }

.expense-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.expense-card:active { transform: scale(0.98); }
.expense-card:hover {
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(255,255,255,0.06));
  box-shadow: 0 4px 24px rgba(26,86,219,0.18), inset 0 1px 0 rgba(255,255,255,0.09);
}

.expense-card-body { flex: 1; min-width: 0; }
.expense-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}
.expense-amount {
  font-size: 1.125rem;
  font-weight: 700;
  color: #EF4444;
}
.expense-date { font-size: 0.75rem; color: #637285; }
.expense-category {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}
.expense-notes {
  font-size: 0.75rem;
  color: #637285;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 0.125rem;
}
.expense-photo {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(26,86,219,0.20);
}
.expense-photo-img { width: 100%; height: 100%; object-fit: cover; }

/* ── Desktop table ─────────────────────────────────── */
.desktop-only { display: none; }
@media (min-width: 640px) { .desktop-only { display: block; } }

.table-wrap {
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}
.expense-table {
  width: 100%;
  font-size: 0.875rem;
  text-align: right;
  border-collapse: collapse;
}
.table-head-row {
  border-bottom: 1px solid rgba(26,86,219,0.18);
}
.th {
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #637285;
}
.table-row {
  border-bottom: 1px solid rgba(26,86,219,0.10);
  cursor: pointer;
  transition: background 0.12s;
}
.table-row:last-child { border-bottom: none; }
.table-row:hover { background: rgba(26,86,219,0.06); }
.td { padding: 0.875rem 1rem; }
.td-muted { color: #637285; }
.td-primary { font-weight: 600; color: #E8EDF5; }
.td-amount { font-weight: 700; color: #EF4444; }
.td-notes { max-width: 18rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.btn-delete-inline {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.625rem;
  border-radius: 0.5rem;
  color: #EF4444;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.28);
  cursor: pointer;
  transition: background 0.12s;
}
.btn-delete-inline:hover { background: rgba(239,68,68,0.16); }

/* ── FAB (mobile) ──────────────────────────────────── */
.fab {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  position: fixed;
  bottom: 5rem;
  inset-inline-start: 1rem;
  padding-inline: 1.25rem;
  height: 3rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 6px 24px rgba(26,86,219,0.50);
  z-index: 20;
  transition: transform 0.15s;
}
.fab:active { transform: scale(0.95); }
@media (min-width: 1024px) { .fab { display: none; } }
</style>
