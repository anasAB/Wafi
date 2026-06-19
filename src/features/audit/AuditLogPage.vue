<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import Paginator from 'primevue/paginator'
import AppHeader from '@/components/ui/AppHeader.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { useSessionStore } from '@/store/session.store'
import { useStaff } from '@/features/staff/composables/useStaff'
import { eventLabel, formatAuditTime } from '@/features/audit/audit.format'
import type { AuditEvent, AuditLog } from '@/features/audit/audit.types'

const router = useRouter()
const session = useSessionStore()
const { staff, loadStaff } = useStaff()
const { period } = usePeriodToggle()
const { entries, loadLog } = useAuditLog()

const loading = ref(false)
const filterStaffId = ref<string | null>(null)
const filterEvent = ref<AuditEvent | null>(null)
const searchQuery = ref('')
const staffMenuOpen = ref(false)
const eventMenuOpen = ref(false)
const staffMenuRef = ref<HTMLElement | null>(null)
const eventMenuRef = ref<HTMLElement | null>(null)

type SortKey = 'createdAt' | 'staffName' | 'event' | 'entityType'
const sortKey = ref<SortKey>('createdAt')
const sortDir = ref<'asc' | 'desc'>('desc')

const first = ref(0)
const rows = ref(10)

const eventOptions: Array<{ value: AuditEvent | null; label: string }> = [
  { value: null, label: 'كل الأحداث' },
  { value: 'sale.completed', label: 'إتمام بيع' },
  { value: 'sale.deleted', label: 'حذف بيع' },
  { value: 'return.processed', label: 'تسجيل مرتجع' },
  { value: 'product.created', label: 'إضافة منتج' },
  { value: 'product.updated', label: 'تعديل منتج' },
  { value: 'product.deleted', label: 'حذف منتج' },
  { value: 'product.price_changed', label: 'تغيير سعر منتج' },
  { value: 'expense.created', label: 'إضافة مصروف' },
  { value: 'expense.updated', label: 'تعديل مصروف' },
  { value: 'expense.deleted', label: 'حذف مصروف' },
  { value: 'customer.created', label: 'إضافة عميل' },
  { value: 'customer.updated', label: 'تعديل عميل' },
  { value: 'customer.deleted', label: 'حذف عميل' },
  { value: 'customer.payment_recorded', label: 'تسجيل دفعة عميل' },
  { value: 'stock.adjusted', label: 'تعديل مخزون' },
  { value: 'shift.opened', label: 'فتح وردية' },
  { value: 'shift.closed', label: 'إغلاق وردية' },
  { value: 'exchange_rate.changed', label: 'تغيير سعر صرف' },
  { value: 'settings.receipt_updated', label: 'تعديل إعدادات الفاتورة' },
  { value: 'staff.created', label: 'إضافة موظف' },
  { value: 'staff.deactivated', label: 'تعطيل موظف' },
  { value: 'staff.permissions_changed', label: 'تعديل صلاحيات موظف' },
  { value: 'supplier.created', label: 'إضافة مورد' },
  { value: 'supplier.updated', label: 'تعديل مورد' },
  { value: 'receiving.created', label: 'تسجيل استلام بضاعة' },
]

const isOwner = computed(() => session.activeStaff?.role === 'owner')
const periodLabel = computed(() =>
  ({ today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر' } as Record<string, string>)[period.value] ?? '',
)
const hasActiveFilters = computed(() =>
  Boolean(searchQuery.value.trim() || filterStaffId.value || filterEvent.value),
)
const selectedStaffLabel = computed(() =>
  filterStaffId.value
    ? staff.value.find((s) => s.id === filterStaffId.value)?.name ?? 'كل الموظفين'
    : 'كل الموظفين',
)
const selectedEventLabel = computed(() =>
  eventOptions.find((opt) => opt.value === filterEvent.value)?.label ?? 'كل الأحداث',
)

const filteredEntries = computed(() => {
  let list = entries.value

  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((e) => {
      const haystack = [
        eventLabel(e),
        e.staffName,
        e.entityType,
        e.event,
        formatAuditTime(e.createdAt),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  return list
})

const sortedEntries = computed(() => {
  const list = [...filteredEntries.value]
  const dir = sortDir.value === 'asc' ? 1 : -1

  return list.sort((a, b) => {
    if (sortKey.value === 'createdAt') {
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
    }
    if (sortKey.value === 'staffName') {
      return a.staffName.localeCompare(b.staffName, 'ar') * dir
    }
    if (sortKey.value === 'event') {
      return eventLabel(a).localeCompare(eventLabel(b), 'ar') * dir
    }
    return entityLabel(a).localeCompare(entityLabel(b), 'ar') * dir
  })
})

const paginatedEntries = computed(() =>
  sortedEntries.value.slice(first.value, first.value + rows.value),
)

function entityLabel(entry: AuditLog): string {
  const map: Record<string, string> = {
    sale: 'بيع',
    return: 'مرتجع',
    product: 'منتج',
    expense: 'مصروف',
    customer: 'عميل',
    stock: 'مخزون',
    shift: 'وردية',
    exchange_rate: 'سعر صرف',
    settings: 'إعدادات',
    staff: 'موظف',
    supplier: 'مورد',
    receiving: 'استلام',
  }
  return map[entry.entityType] ?? entry.entityType
}

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'createdAt' ? 'desc' : 'asc'
  }
  first.value = 0
}

function onPage(e: { first: number; rows: number }) {
  first.value = e.first
  rows.value = e.rows
}

function clearSearch() {
  searchQuery.value = ''
}

function toggleStaffMenu() {
  staffMenuOpen.value = !staffMenuOpen.value
  if (staffMenuOpen.value) eventMenuOpen.value = false
}

function toggleEventMenu() {
  eventMenuOpen.value = !eventMenuOpen.value
  if (eventMenuOpen.value) staffMenuOpen.value = false
}

function chooseStaff(staffId: string | null) {
  filterStaffId.value = staffId
  staffMenuOpen.value = false
}

function chooseEvent(eventValue: AuditEvent | null) {
  filterEvent.value = eventValue
  eventMenuOpen.value = false
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (!staffMenuRef.value?.contains(target)) staffMenuOpen.value = false
  if (!eventMenuRef.value?.contains(target)) eventMenuOpen.value = false
}

async function reload() {
  loading.value = true
  try {
    const { start, end } = getDateRange(period.value)
    await loadLog({
      startDate: start,
      endDate: end,
      staffId: filterStaffId.value,
      event: filterEvent.value,
    })
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', onDocumentClick)
  await loadStaff()
  await reload()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})

watch(period, reload)
watch([filterStaffId, filterEvent], reload)
watch([searchQuery, filterStaffId, filterEvent], () => {
  first.value = 0
})
watch(
  () => sortedEntries.value.length,
  (len) => {
    if (first.value >= len) {
      first.value = Math.max(0, (Math.ceil(Math.max(len, 1) / rows.value) - 1) * rows.value)
    }
  },
)
</script>

<template>
  <div class="page-root" dir="rtl">
    <div class="lg:hidden">
      <AppHeader title="سجل النشاط" :show-back="true" @back="router.push('/settings')" />
    </div>

    <div class="page-body">
      <div v-if="!isOwner" class="unauth-card">
        <p class="unauth-title">هذه الصفحة للمالك فقط</p>
        <p class="unauth-sub">يمكن فقط للمالك مراجعة سجل النشاط الكامل</p>
      </div>

      <template v-else>
        <div class="intro-card">
          <p class="intro-title">سجل النشاط</p>
          <p class="intro-sub">مراجعة كل العمليات حسب الفترة والموظف ونوع الحدث</p>
        </div>

        <div class="summary-row">
          <div class="summary-chip">
            <span class="summary-label">إجمالي السجل</span>
            <span class="summary-value">{{ entries.length }}</span>
          </div>
          <div class="summary-chip">
            <span class="summary-label">بعد التصفية</span>
            <span class="summary-value summary-value--blue">{{ sortedEntries.length }}</span>
          </div>
        </div>

        <div class="filters-card">
          <div class="filters-grid">
            <div class="search-wrap">
              <svg xmlns="http://www.w3.org/2000/svg" class="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                v-model="searchQuery"
                dir="rtl"
                type="text"
                placeholder="بحث باسم الموظف أو النشاط..."
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

            <div ref="staffMenuRef" class="method-filter-wrap">
              <button
                type="button"
                class="method-filter-btn"
                :aria-expanded="staffMenuOpen"
                aria-haspopup="listbox"
                @click="toggleStaffMenu"
              >
                <span class="method-filter-text">{{ selectedStaffLabel }}</span>
                <svg
                  class="method-filter-chevron"
                  :class="{ 'method-filter-chevron-open': staffMenuOpen }"
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

              <div v-if="staffMenuOpen" class="method-filter-menu" role="listbox" aria-label="تصفية حسب الموظف">
                <button
                  type="button"
                  class="method-filter-item"
                  :class="{ 'method-filter-item-active': filterStaffId === null }"
                  @click="chooseStaff(null)"
                >كل الموظفين</button>
                <button
                  v-for="s in staff"
                  :key="s.id"
                  type="button"
                  class="method-filter-item"
                  :class="{ 'method-filter-item-active': filterStaffId === s.id }"
                  @click="chooseStaff(s.id)"
                >{{ s.name }}</button>
              </div>
            </div>

            <div ref="eventMenuRef" class="method-filter-wrap">
              <button
                type="button"
                class="method-filter-btn"
                :aria-expanded="eventMenuOpen"
                aria-haspopup="listbox"
                @click="toggleEventMenu"
              >
                <span class="method-filter-text">{{ selectedEventLabel }}</span>
                <svg
                  class="method-filter-chevron"
                  :class="{ 'method-filter-chevron-open': eventMenuOpen }"
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

              <div v-if="eventMenuOpen" class="method-filter-menu" role="listbox" aria-label="تصفية حسب نوع الحدث">
                <button
                  v-for="opt in eventOptions"
                  :key="opt.label"
                  type="button"
                  class="method-filter-item"
                  :class="{ 'method-filter-item-active': filterEvent === opt.value }"
                  @click="chooseEvent(opt.value)"
                >{{ opt.label }}</button>
              </div>
            </div>

            <PeriodToggle />
          </div>
        </div>

        <p class="section-label">النشاط</p>

        <main class="main">
          <div v-if="loading" class="skeleton-list">
            <div v-for="i in 6" :key="i" class="skeleton-item" />
          </div>

          <div v-else-if="sortedEntries.length === 0" class="empty-card">
            <p class="empty-title">
              {{ hasActiveFilters ? 'لا توجد نتائج مطابقة' : `لا يوجد نشاط خلال ${periodLabel}` }}
            </p>
            <p class="empty-sub">
              {{ hasActiveFilters ? 'جرّب تغيير البحث أو الفلاتر' : 'غيّر الفترة أو راجع لاحقًا' }}
            </p>
          </div>

          <template v-else>
            <div class="table-wrap desktop-only">
              <table class="audit-table">
                <colgroup>
                  <col class="col-time" />
                  <col class="col-event" />
                  <col class="col-staff" />
                  <col class="col-entity" />
                </colgroup>
                <thead>
                  <tr class="table-head-row">
                    <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'createdAt' }" @click="toggleSort('createdAt')">
                      الوقت<span class="sort-arrow">{{ sortKey === 'createdAt' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                    </th>
                    <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'event' }" @click="toggleSort('event')">
                      النشاط<span class="sort-arrow">{{ sortKey === 'event' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                    </th>
                    <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'staffName' }" @click="toggleSort('staffName')">
                      الموظف<span class="sort-arrow">{{ sortKey === 'staffName' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                    </th>
                    <th class="th th-sort" :class="{ 'th-sort--active': sortKey === 'entityType' }" @click="toggleSort('entityType')">
                      النوع<span class="sort-arrow">{{ sortKey === 'entityType' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="e in paginatedEntries" :key="e.id" class="table-row">
                    <td class="td td-time">{{ formatAuditTime(e.createdAt) }}</td>
                    <td class="td td-event">{{ eventLabel(e) }}</td>
                    <td class="td td-staff">{{ e.staffName }}</td>
                    <td class="td td-entity">
                      <span class="entity-badge">{{ entityLabel(e) }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mobile-list mobile-only">
              <div v-for="e in paginatedEntries" :key="e.id" class="log-card">
                <div class="log-card-top">
                  <span class="log-time">{{ formatAuditTime(e.createdAt) }}</span>
                  <span class="entity-badge">{{ entityLabel(e) }}</span>
                </div>
                <p class="log-label">{{ eventLabel(e) }}</p>
                <p class="log-staff">{{ e.staffName }}</p>
              </div>
            </div>

            <Paginator
              v-if="sortedEntries.length > 10"
              :first="first"
              :rows="rows"
              :total-records="sortedEntries.length"
              :rows-per-page-options="[10, 20, 50]"
              class="list-paginator"
              dir="rtl"
              @page="onPage"
            />
          </template>
        </main>
      </template>
    </div>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  color: #E8EDF5;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 1024px) {
  .page-root {
    height: 100dvh;
    overflow: hidden;
  }
}

.page-body {
  padding: 16px;
  max-width: 980px;
  margin: 0 auto;
  width: 100%;
  padding-bottom: 80px;
}

@media (min-width: 1024px) {
  .page-body {
    padding: 20px;
    max-width: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
}

.intro-card {
  margin-bottom: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.intro-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #E8EDF5;
}

.intro-sub {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: #637285;
}

.summary-row {
  margin-bottom: 0.85rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.summary-chip {
  border-radius: 0.8rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.08);
  padding: 0.55rem 0.65rem;
}

.summary-label {
  display: block;
  color: #637285;
  font-size: 0.72rem;
}

.summary-value {
  display: block;
  margin-top: 0.2rem;
  color: #E8EDF5;
  font-size: 0.95rem;
  font-weight: 800;
}

.summary-value--blue {
  color: #60A5FA;
}

.filters-card {
  border-radius: 1rem;
  border: 1px solid rgba(26, 86, 219, 0.28);
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  padding: 0.75rem;
  margin-bottom: 0.65rem;
}

.filters-grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr auto;
  gap: 0.5rem;
  align-items: center;
}

@media (max-width: 980px) {
  .filters-grid {
    grid-template-columns: 1fr;
  }
}

.search-wrap {
  position: relative;
  width: 100%;
}

.search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 12px;
  margin: auto 0;
  width: 16px;
  height: 16px;
  color: #637285;
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 40px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 0.65rem;
  color: #E8EDF5;
  padding: 0 2.3rem 0 2rem;
  font-size: 0.82rem;
  font-family: inherit;
  outline: none;
}

.search-input::placeholder {
  color: #637285;
}

.search-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.2);
}

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

.method-filter-wrap {
  position: relative;
  width: 100%;
}

.method-filter-btn {
  width: 100%;
  height: 40px;
  padding: 0 0.75rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.method-filter-btn:hover {
  border-color: rgba(26,86,219,0.40);
}

.method-filter-btn:focus {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.method-filter-text {
  min-width: 0;
  flex: 1;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.method-filter-chevron {
  color: #637285;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.method-filter-chevron-open {
  transform: rotate(180deg);
}

.method-filter-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  inset-inline-start: 0;
  width: 100%;
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

.method-filter-menu::-webkit-scrollbar {
  width: 10px;
}

.method-filter-menu::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.method-filter-menu::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.method-filter-menu::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.method-filter-item {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #E8EDF5;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  text-align: right;
  cursor: pointer;
}

.method-filter-item:hover {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.24);
}

.method-filter-item-active {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20));
  border-color: rgba(26,86,219,0.35);
  color: #FFFFFF;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 8px 4px;
  margin-bottom: 6px;
}

.main {
  min-height: 12rem;
}

@media (min-width: 1024px) {
  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.skeleton-item {
  height: 3.75rem;
  border-radius: 0.75rem;
  background: rgba(255,255,255,0.05);
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.empty-card,
.unauth-card {
  border-radius: 1rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.08);
  padding: 2.2rem 1rem;
  text-align: center;
}

.empty-title,
.unauth-title {
  margin: 0;
  color: #E8EDF5;
  font-weight: 700;
  font-size: 0.92rem;
}

.empty-sub,
.unauth-sub {
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

.audit-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.col-time { width: 24%; }
.col-event { width: 40%; }
.col-staff { width: 18%; }
.col-entity { width: 18%; }

.table-head-row {
  background: rgba(255,255,255,0.05);
  border-bottom: 1px solid rgba(26,86,219,0.14);
}

.th {
  text-align: right;
  padding: 12px 14px;
  font-size: 11px;
  font-weight: 700;
  color: #637285;
  text-transform: uppercase;
  letter-spacing: 0.06em;
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
  border-bottom: 1px solid rgba(26,86,219,0.11);
}

.table-row:last-child {
  border-bottom: none;
}

.table-row:hover {
  background: rgba(26,86,219,0.07);
}

.td {
  padding: 12px 14px;
  font-size: 0.84rem;
  color: #C8D5E8;
  vertical-align: middle;
}

.td-time {
  color: #8FA2BC;
  white-space: nowrap;
}

.td-event {
  color: #E8EDF5;
  font-weight: 600;
}

.td-staff {
  color: #9CB3D0;
}

.entity-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.16rem 0.5rem;
  border-radius: 999px;
  border: 1px solid rgba(26,86,219,0.28);
  background: rgba(26,86,219,0.12);
  color: #60A5FA;
  font-size: 0.68rem;
  font-weight: 700;
}

.mobile-list {
  flex-direction: column;
  gap: 0.55rem;
}

.log-card {
  border-radius: 0.95rem;
  border: 1px solid rgba(26,86,219,0.24);
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  box-shadow: 0 4px 16px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
  padding: 0.8rem 0.9rem;
}

.log-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.log-time {
  color: #9CB3D0;
  font-size: 0.78rem;
}

.log-label {
  margin: 0.42rem 0 0;
  color: #E8EDF5;
  font-size: 0.86rem;
  font-weight: 700;
}

.log-staff {
  margin: 0.2rem 0 0;
  color: #637285;
  font-size: 0.76rem;
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
</style>
