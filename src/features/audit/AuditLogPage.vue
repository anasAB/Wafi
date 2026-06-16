<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter }     from 'vue-router'
import AppHeader         from '@/components/ui/AppHeader.vue'
import PeriodToggle      from '@/features/dashboard/components/PeriodToggle.vue'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange }  from '@/features/dashboard/composables/periodUtils'
import { useAuditLog }   from '@/features/audit/composables/useAuditLog'
import { useSessionStore } from '@/store/session.store'
import { useStaff }      from '@/features/staff/composables/useStaff'
import { eventLabel, formatAuditTime } from '@/features/audit/audit.format'

const router    = useRouter()
const session   = useSessionStore()
const { staff, loadStaff } = useStaff()
const { period, setPeriod } = usePeriodToggle()
const { entries, loadLog }  = useAuditLog()

const loading        = ref(false)
const filterStaffId  = ref<string | null>(null)
const filterEvent    = ref<string | null>(null)

const isOwner = computed(() => session.activeStaff?.role === 'owner')

// Name the active period so the empty state says *which* period had no activity (#20).
const periodLabel = computed(() =>
  ({ today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر' } as Record<string, string>)[period.value] ?? ''
)

async function reload() {
  loading.value = true
  try {
    const { start, end } = getDateRange(period.value)
    await loadLog({
      startDate: start,
      endDate:   end,
      staffId:   filterStaffId.value,
      event:     filterEvent.value,
    })
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadStaff()
  await reload()
})
watch(period, reload)
watch([filterStaffId, filterEvent], reload)

</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="سجل النشاط" :show-back="true" @back="router.push('/settings')" />

    <!-- Unauthorized -->
    <div v-if="!isOwner" class="unauth">
      <p class="unauth-text">هذه الصفحة للمالك فقط</p>
    </div>

    <template v-else>
      <!-- Filters -->
      <div class="filters">
        <PeriodToggle />
        <select v-model="filterStaffId" class="filter-select">
          <option :value="null">كل الموظفين</option>
          <option v-for="s in staff" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <main class="main">
        <!-- Loading skeleton -->
        <div v-if="loading" class="skeleton-list">
          <div v-for="i in 6" :key="i" class="skeleton-item" />
        </div>

        <!-- Empty state -->
        <div v-else-if="entries.length === 0" class="empty">
          <p class="empty-title">لا يوجد نشاط خلال {{ periodLabel }}</p>
        </div>

        <!-- Log rows -->
        <div v-else class="log-list">
          <div
            v-for="e in entries"
            :key="e.id"
            class="log-row"
          >
            <div class="log-row-main">
              <div class="log-left">
                <span class="log-label">{{ eventLabel(e) }}</span>
                <span class="log-staff">{{ e.staffName }}</span>
              </div>
              <span class="log-time">{{ formatAuditTime(e.createdAt) }}</span>
            </div>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>

<style scoped>
.page-root {
  display: flex; flex-direction: column; min-height: 100dvh;
  background: #06090F; font-family: 'Tajawal', system-ui, sans-serif; color: #E8EDF5;
}
.unauth {
  flex: 1; display: flex; align-items: center; justify-content: center;
}
.unauth-text { font-size: 0.875rem; color: #637285; }
.filters {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; padding: 1rem 1rem 0.5rem;
}
.filter-select {
  height: 36px; padding: 0 0.75rem; border-radius: 0.625rem;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14);
  color: #E8EDF5; font-family: 'Tajawal', system-ui, sans-serif; font-size: 0.8125rem;
  outline: none; cursor: pointer;
}
.main { flex: 1; padding: 0.5rem 1rem 5rem; }
.skeleton-list { display: flex; flex-direction: column; gap: 0.375rem; }
.skeleton-item {
  height: 3.5rem; border-radius: 0.75rem;
  background: rgba(255,255,255,0.05); animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.empty { display: flex; align-items: center; justify-content: center; padding: 5rem 0; }
.empty-title { font-size: 0.875rem; color: #637285; }
.log-list { display: flex; flex-direction: column; gap: 0.375rem; }
.log-row {
  border-radius: 0.875rem; padding: 0.75rem 1rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.20);
}
.log-row-main { display: flex; justify-content: space-between; align-items: flex-start; }
.log-left { display: flex; flex-direction: column; gap: 0.125rem; flex: 1; min-width: 0; }
.log-label { font-size: 0.875rem; font-weight: 600; color: #E8EDF5; }
.log-staff { font-size: 0.75rem; color: #637285; }
.log-time { font-size: 0.75rem; color: #3D4F6B; flex-shrink: 0; margin-inline-start: 0.75rem; }
</style>
