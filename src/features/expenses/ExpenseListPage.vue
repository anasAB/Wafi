<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import ExpenseForm from './components/ExpenseForm.vue'
import { useExpenses } from './composables/useExpenses'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange, getMonthRange } from '@/features/dashboard/composables/periodUtils'
import type { Expense } from './expense.types'

const router = useRouter()
const route = useRoute()
const { expenses, load, deleteExpense } = useExpenses()
const { period, setPeriod } = usePeriodToggle()

// Month browsing (only meaningful in the 'month' period): 0 = current month,
// -1 = previous, +1 = next. Lets the owner reach recurring costs stored in other
// months, not just the current one.
const monthOffset    = ref(0)

const monthLabel = computed(() => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + monthOffset.value, 1)
  return new Intl.DateTimeFormat('ar-SY', { month: 'long', year: 'numeric' }).format(d)
})

const editingExpense = ref<Expense | null>(null)
const showAddForm    = ref(false)
const deleteTarget   = ref<string | null>(null)
const toast          = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const loading        = ref(false)
const searchQuery = ref('')
const selectedCategory = ref<string | null>(null)
const isCategoryMenuOpen = ref(false)
const categoryMenuRef = ref<HTMLElement | null>(null)

type SortKey = 'createdAt' | 'category' | 'amountUsd'
const sortKey = ref<SortKey | null>('createdAt')
const sortDir = ref<'asc' | 'desc'>('desc')

const periodTitle = computed(() => {
  const labels: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
  return `مصاريف ${labels[period.value] ?? ''}`
})

const categories = computed(() => {
  const set = new Set<string>()
  for (const e of expenses.value) {
    const c = e.category?.trim()
    if (c) set.add(c)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ar'))
})

const categoryOptions = computed(() => [
  { label: 'كل الفئات', value: null as string | null },
  ...categories.value.map((c) => ({ label: c, value: c })),
])

const selectedCategoryLabel = computed(() => selectedCategory.value ?? 'كل الفئات')

const hasActiveFilters = computed(() => Boolean(searchQuery.value.trim() || selectedCategory.value))

const displayedExpenses = computed(() => {
  let list = expenses.value

  if (selectedCategory.value) {
    list = list.filter((e) => (e.category ?? '').trim() === selectedCategory.value)
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter((e) =>
      [
        e.category,
        e.notes,
        e.amountUsd,
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ')
        .includes(q),
    )
  }

  if (sortKey.value) {
    const key = sortKey.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      if (key === 'amountUsd') return (a.amountUsd - b.amountUsd) * dir
      if (key === 'createdAt') {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
      }
      return String(a.category ?? '').localeCompare(String(b.category ?? ''), 'ar') * dir
    })
  }

  return list
})

const periodTotal = computed(() =>
  displayedExpenses.value.reduce((sum, e) => sum + e.amountUsd, 0)
)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'createdAt' ? 'desc' : 'asc'
  }
}

function chooseCategory(category: string | null) {
  selectedCategory.value = category
  isCategoryMenuOpen.value = false
}

function toggleCategoryMenu() {
  isCategoryMenuOpen.value = !isCategoryMenuOpen.value
}

function clearSearch() {
  searchQuery.value = ''
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (!categoryMenuRef.value?.contains(target)) {
    isCategoryMenuOpen.value = false
  }
}

async function reload() {
  loading.value = true
  try {
    // In 'month' mode, browse the offset month (full calendar month); today/week
    // are always the current period, so reset the offset there.
    let range: { start: string; end: string }
    if (period.value === 'month') {
      range = getMonthRange(monthOffset.value)
    } else {
      monthOffset.value = 0
      range = getDateRange(period.value)
    }
    await load(range.start, range.end)
  } finally {
    loading.value = false
  }
}

function prevMonth() {
  monthOffset.value -= 1
  reload()
}

function nextMonth() {
  monthOffset.value += 1
  reload()
}

onMounted(async () => {
  document.addEventListener('click', onDocumentClick)
  const p = route.query.period as string | undefined
  if (p === 'today' || p === 'week' || p === 'month') setPeriod(p)
  await reload()
})
watch(period, reload)

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

watch(categories, (next) => {
  if (selectedCategory.value && !next.includes(selectedCategory.value)) {
    selectedCategory.value = null
  }
})

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
      @back="router.push('/')"
    />

    <!-- Period toggle + desktop add button -->
    <div class="toolbar-row">
      <div class="period-controls">
        <PeriodToggle class="filter-period" />
      </div>
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

    <!-- Month navigation: only in month view, so recurring costs in other months are reachable -->
    <div v-if="period === 'month'" class="month-nav">
      <button type="button" class="month-nav-btn" aria-label="الشهر السابق" @click="prevMonth">‹</button>
      <span class="month-nav-label">{{ monthLabel }}</span>
      <button type="button" class="month-nav-btn" aria-label="الشهر التالي" @click="nextMonth">›</button>
    </div>

    <div class="filters-row">
      <div class="search-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" class="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          v-model="searchQuery"
          dir="rtl"
          type="text"
          placeholder="بحث في المصاريف..."
          class="search-input"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="search-clear-btn"
          aria-label="مسح البحث"
          @click="clearSearch"
        >×</button>
      </div>

      <div v-if="categories.length" ref="categoryMenuRef" class="search-filter-wrap">
        <button
          type="button"
          class="search-filter-btn"
          :aria-expanded="isCategoryMenuOpen"
          aria-haspopup="listbox"
          @click="toggleCategoryMenu"
        >
          <span class="search-filter-text">{{ selectedCategoryLabel }}</span>
          <svg
            class="search-filter-chevron"
            :class="{ 'search-filter-chevron-open': isCategoryMenuOpen }"
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

        <div v-if="isCategoryMenuOpen" class="search-filter-menu" role="listbox" aria-label="تصفية حسب الفئة">
          <button
            v-for="option in categoryOptions"
            :key="option.label"
            type="button"
            class="search-filter-item"
            :class="{ 'search-filter-item-active': selectedCategory === option.value }"
            @click="chooseCategory(option.value)"
          >{{ option.label }}</button>
        </div>
      </div>
    </div>

    <main class="main-content">
      <!-- Loading (same behavior as /history) -->
      <div v-if="loading" class="loading-wrap">
        <div class="spinner" />
      </div>

      <template v-else>
        <!-- Summary row -->
        <div v-if="displayedExpenses.length > 0" class="summary-row">
          <span class="summary-count">{{ displayedExpenses.length }} عملية</span>
          <span class="summary-total">${{ periodTotal.toFixed(2) }} إجمالي</span>
        </div>

        <!-- Empty state -->
        <div v-if="displayedExpenses.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <svg class="empty-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        </div>
        <div class="empty-text">
          <p class="empty-title">{{ hasActiveFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد مصاريف في هذه الفترة' }}</p>
          <p class="empty-sub">{{ hasActiveFilters ? 'جرّب تغيير البحث أو الفئة' : 'أضف أول مصروف بالضغط على الزر أدناه' }}</p>
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
            v-for="e in displayedExpenses"
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
              <span v-if="e.isRecurringMonthly" class="recurring-badge">متكرر شهريًا</span>
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
                <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'createdAt' }" @click="toggleSort('createdAt')">
                  التاريخ<span class="sort-arrow">{{ sortKey === 'createdAt' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                </th>
                <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'category' }" @click="toggleSort('category')">
                  الفئة<span class="sort-arrow">{{ sortKey === 'category' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                </th>
                <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'amountUsd' }" @click="toggleSort('amountUsd')">
                  المبلغ<span class="sort-arrow">{{ sortKey === 'amountUsd' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                </th>
                <th class="th">ملاحظات</th>
                <th class="th"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in displayedExpenses"
                :key="e.id"
                :data-testid="`expense-row-${e.id}`"
                class="table-row"
                @click="editingExpense = e"
              >
                <td class="td td-muted">{{ formatDate(e.createdAt) }}</td>
                <td class="td td-primary">{{ e.category }}</td>
                <td class="td td-amount" dir="ltr">${{ e.amountUsd.toFixed(2) }}</td>
                <td class="td td-muted td-notes">
                  <span v-if="e.isRecurringMonthly" class="recurring-badge recurring-badge-inline">متكرر شهريًا</span>
                  <span>{{ e.notes ?? '—' }}</span>
                </td>
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

@media (min-width: 1024px) {
  .page-root {
    height: 100dvh;
    overflow: hidden;
  }
}

/* ── Toolbar ───────────────────────────────────────── */
.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1rem 0.5rem;
}

.month-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.25rem 1rem 0.5rem;
}

.month-nav-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  line-height: 1;
  color: #C8D5E8;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.month-nav-btn:hover {
  border-color: rgba(26,86,219,0.45);
  background: linear-gradient(135deg, rgba(26,86,219,0.20), rgba(255,255,255,0.06));
  color: #E8EDF5;
}

.month-nav-label {
  min-width: 8rem;
  text-align: center;
  font-size: 0.875rem;
  font-weight: 700;
  color: #9FB0C7;
}

.filters-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.25rem 1rem 0.5rem;
}
@media (min-width: 1024px) {
  .filters-row {
    padding: 0.25rem 1.5rem 0.625rem;
  }
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

.search-input::placeholder {
  color: #3D4F6B;
}

.search-input:focus {
  border-color: rgba(26,86,219,0.7);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.16);
}

.search-filter-wrap {
  position: relative;
  flex: 0 0 auto;
}

.search-filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 8.25rem;
  height: 44px;
  border-radius: 0.75rem;
  border: 1px solid rgba(26,86,219,0.28);
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  color: #E8EDF5;
  padding-inline: 0.75rem;
  cursor: pointer;
}

.search-filter-text {
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
}

.search-filter-chevron {
  color: #9AB0CE;
  transition: transform 0.2s ease;
}

.search-filter-chevron-open {
  transform: rotate(180deg);
}

.search-filter-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  inset-inline-end: 0;
  min-width: 10.5rem;
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

.search-filter-menu::-webkit-scrollbar {
  width: 10px;
}

.search-filter-menu::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.search-filter-menu::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.search-filter-menu::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.search-filter-item {
  width: 100%;
  border: none;
  background: transparent;
  color: #E8EDF5;
  text-align: right;
  border-radius: 0.5rem;
  padding: 0.5rem 0.625rem;
  font-size: 0.8125rem;
  cursor: pointer;
}

.search-filter-item:hover {
  background: rgba(26,86,219,0.16);
}

.search-filter-item-active {
  background: rgba(26,86,219,0.22);
  color: #BFDBFE;
}
@media (min-width: 1024px) {
  .toolbar-row {
    padding: 1.25rem 1.5rem 0.5rem;
  }
}

.filter-period {
  flex: 0 0 auto;
  height: 44px;
}

.filter-period :deep(.pt-btn),
.filter-period :deep(.toggle-btn) {
  min-height: 100%;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
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
  .main-content {
    padding: 0.75rem 1.5rem 2.5rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
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

/* ── Loading ───────────────────────────────────────── */
.loading-wrap {
  flex: 1;
  min-height: 14rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  border: 2px solid rgba(26,86,219,0.28);
  border-top-color: #1A56DB;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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

.recurring-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.25rem;
  width: fit-content;
  min-height: 20px;
  padding-inline: 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  color: #93C5FD;
  background: rgba(26,86,219,0.16);
  border: 1px solid rgba(26,86,219,0.30);
}

.recurring-badge-inline {
  margin-top: 0;
  margin-inline-end: 0.4rem;
  vertical-align: middle;
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

@media (min-width: 1024px) {
  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
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
