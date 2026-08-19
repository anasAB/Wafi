<!-- src/features/reports/ReportsListPage.vue -->
<!--
  WAFI-147A: reads ONLY registry metadata (id/name/cadenceHint) -- never calls
  compute() here. Per-report generation happens lazily on ReportDetailPage.vue
  when the owner opens one specific report (design spec S1's lazy-computation
  requirement).
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSessionStore } from '@/store/session.store'
import { canUserDo } from '@/router/permissions'
import { REPORT_DEFINITIONS } from './index'
import type { ReportId } from './index'

const router = useRouter()
const session = useSessionStore()

// Employee Summary's entire purpose is staff identification -- whole-report
// gating (design spec S5), matching /reports/staff's precedent.
const STAFF_ONLY_REPORT_IDS: ReportId[] = ['employee-summary']

const reports = computed(() =>
  Object.values(REPORT_DEFINITIONS).filter((def) =>
    !STAFF_ONLY_REPORT_IDS.includes(def.id) || canUserDo(session.activeStaff, 'can_view_staff_performance'),
  ),
)
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="التقارير" :show-back="true" @back="router.back()" />
  </div>
  <div class="page-body" dir="rtl">
    <div class="settings-card">
      <button
        v-for="def in reports"
        :key="def.id"
        type="button"
        class="report-row"
        :data-testid="`report-row-${def.id}`"
        @click="router.push(`/reports/${def.id}`)"
      >
        <span>{{ def.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.page-body { padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; font-family: 'Tajawal', system-ui, sans-serif; }
.settings-card { background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; overflow: hidden; }
.report-row { display: block; width: 100%; text-align: start; padding: 0.8rem 0.95rem; border: none; background: transparent; border-bottom: 1px solid rgba(26, 86, 219, 0.14); color: #E8EDF5; font-size: 0.9rem; font-family: inherit; cursor: pointer; }
.report-row:last-child { border-bottom: none; }
</style>
