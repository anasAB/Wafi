<!-- src/features/dashboard/components/Dashboard2Screen.vue -->
<!-- WAFI-146: Dashboard 2.0. Home (HomePage.vue) stays the fast operational
     glance; this screen is the "why did this move" layer, gated behind the
     Reporting Pack same as /reports. -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useCan } from '@/composables/useCan'
import { useDeviceStore } from '@/store/device.store'
import { useEventSubscription } from '@/services/events/useEventSubscription'
import type { DomainEventType } from '@/services/events/domainEvent.types'
import type { InsightPeriod } from '../composables/insightRanges'
import RevenueIntelligenceCard from './RevenueIntelligenceCard.vue'
import ProfitIntelligenceCard from './ProfitIntelligenceCard.vue'
import InventoryIntelligenceCard from './InventoryIntelligenceCard.vue'
import StaffIntelligenceCard from './StaffIntelligenceCard.vue'
import CustomerIntelligenceCard from './CustomerIntelligenceCard.vue'
import ExpenseForm from '@/features/expenses/components/ExpenseForm.vue'

const { t } = useI18n()
const router = useRouter()
const device = useDeviceStore()
const { can } = useCan()
const canViewStaffPerformance = can('can_view_staff_performance')

const period = ref<InsightPeriod>('day')

// Mobile accordion: only one card expanded at a time on narrow screens; desktop
// tracks each card's expand state independently (design spec "Expand behavior").
const expandedKey = ref<string | null>(null)
const cardExpanded = ref<Record<string, boolean>>({
  revenue: false, profit: false, inventory: false, staff: false, customer: false,
})
const isMobile = ref(window.matchMedia('(max-width: 767px)').matches)

function onToggle(key: string) {
  if (isMobile.value) {
    expandedKey.value = expandedKey.value === key ? null : key
  } else {
    cardExpanded.value[key] = !cardExpanded.value[key]
  }
}
function isExpanded(key: string): boolean {
  return isMobile.value ? expandedKey.value === key : cardExpanded.value[key]
}

const showExpenseForm = ref(false)

const revenueRef = ref<InstanceType<typeof RevenueIntelligenceCard> | null>(null)
const profitRef = ref<InstanceType<typeof ProfitIntelligenceCard> | null>(null)
const inventoryRef = ref<InstanceType<typeof InventoryIntelligenceCard> | null>(null)
const staffRef = ref<InstanceType<typeof StaffIntelligenceCard> | null>(null)
const customerRef = ref<InstanceType<typeof CustomerIntelligenceCard> | null>(null)

async function reloadAll() {
  const loaders = [
    revenueRef.value?.reload(),
    profitRef.value?.reload(),
    inventoryRef.value?.reload(),
    customerRef.value?.reload(),
  ]
  if (canViewStaffPerformance.value) loaders.push(staffRef.value?.reload())
  await Promise.allSettled(loaders)
}

function setPeriod(p: InsightPeriod) { period.value = p }

// Coalesced event-driven refresh: several of these can fire within
// milliseconds of a single sale (sale.completed + customer.debt_changed,
// etc.) — batch them into one refresh cycle rather than one per event.
let refreshTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { void reloadAll() }, 300)
}

const REFRESH_ON_EVENTS: DomainEventType[] = [
  'sale.completed', 'sale.returned', 'customer.debt_changed', 'sale.discounted',
]
const subs = REFRESH_ON_EVENTS.map(type =>
  useEventSubscription(type, scheduleRefresh, { shopId: device.shopId }),
)

onBeforeUnmount(() => {
  subs.forEach(s => s.stop())
  if (refreshTimer) clearTimeout(refreshTimer)
})

onMounted(reloadAll)

const PERIODS: InsightPeriod[] = ['day', 'week', 'month']
const PERIOD_LABEL_KEY: Record<InsightPeriod, 'today' | 'week' | 'month'> = {
  day: 'today', week: 'week', month: 'month',
}
</script>

<template>
  <div class="d2-root" dir="rtl">
    <header class="d2-period-row">
      <div class="d2-period-toggle">
        <button
          v-for="p in PERIODS" :key="p"
          type="button"
          class="d2-period-btn" :class="{ active: period === p }"
          @click="setPeriod(p)"
        >{{ t(`dashboard2.periodLabel.${PERIOD_LABEL_KEY[p]}`) }}</button>
      </div>
    </header>

    <div class="d2-grid">
      <RevenueIntelligenceCard
        ref="revenueRef" :period="period"
        :expanded="isExpanded('revenue')" @toggle="onToggle('revenue')"
      />
      <ProfitIntelligenceCard
        ref="profitRef" :period="period"
        :expanded="isExpanded('profit')" @toggle="onToggle('profit')"
      />
      <InventoryIntelligenceCard
        ref="inventoryRef"
        :expanded="isExpanded('inventory')" @toggle="onToggle('inventory')"
      />
      <StaffIntelligenceCard
        v-if="canViewStaffPerformance"
        ref="staffRef" :period="period"
        :expanded="isExpanded('staff')" @toggle="onToggle('staff')"
      />
      <CustomerIntelligenceCard
        ref="customerRef"
        :expanded="isExpanded('customer')" @toggle="onToggle('customer')"
      />
    </div>

    <div class="d2-quick-actions">
      <button type="button" @click="router.push('/pos')">بيع جديد</button>
      <button type="button" @click="showExpenseForm = true">تسجيل مصروف</button>
      <button type="button" @click="router.push('/customers/collections')">تسجيل دفعة</button>
      <button type="button" @click="router.push('/pos')">فتح دوام</button>
    </div>

    <ExpenseForm
      v-if="showExpenseForm"
      @saved="showExpenseForm = false"
      @cancel="showExpenseForm = false"
    />
  </div>
</template>

<style scoped>
.d2-root { padding: 16px; }
.d2-period-row { margin-bottom: 16px; }
.d2-period-toggle { display: flex; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 3px; gap: 2px; width: fit-content; }
.d2-period-btn { padding: 7px 14px; border-radius: 8px; background: transparent; border: none; color: #637285; font-family: 'Tajawal', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; }
.d2-period-btn.active { background: #1A56DB; color: white; font-weight: 700; }
.d2-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-bottom: 20px;
}
@media (min-width: 768px) { .d2-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .d2-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); } }
.d2-quick-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.d2-quick-actions button {
  flex: 1; min-width: 140px; padding: 10px; border-radius: 10px;
  border: 1.5px dashed rgba(26,86,219,.3); background: rgba(26,86,219,.04);
  color: #C8D5E8; font-family: 'Tajawal', sans-serif; font-size: 12px; cursor: pointer;
}
</style>
