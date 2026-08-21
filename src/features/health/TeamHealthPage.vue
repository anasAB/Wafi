<!-- WAFI-148: internal-only /team-health screen -- the founders' cross-shop
     operational health view. Structurally separate from OwnerHealthPage.vue's
     can_view_health_metrics gate: this screen is platform_admins-gated the
     same way RolloutAdminScreen.vue is (requiresPlatformAdmin in the router),
     never a per-shop permission flag. Composable logic (RPC calls, grouping,
     stale-device computation, rate/count formatting) lives in
     composables/useTeamHealth.ts and is unit-tested there -- this component is
     thin wiring, per the project's test pyramid. -->
<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useTeamHealth } from './composables/useTeamHealth'

const router = useRouter()
const team = useTeamHealth()

onMounted(() => { team.refresh().catch(() => {}) })

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(team.query, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { team.refresh().catch(() => {}) }, 300)
})
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="صحة المتاجر (فريق العمل)" :show-back="true" @back="router.back()" />

    <main class="page-main">
      <p class="caption">
        عرض تشغيلي عابر للمتاجر لفريق العمل الداخلي فقط. مستقل تمامًا عن صلاحية
        صاحب المتجر لعرض بيانات الصحة الخاصة بمتجره.
      </p>

      <p v-if="team.error.value" class="feedback error" data-test="team-health-error">
        {{ team.error.value }}
      </p>

      <input
        v-model="team.query.value"
        type="text"
        class="search-input"
        placeholder="ابحث عن متجر..."
        data-test="team-health-search"
      />

      <div v-if="team.loading.value" class="status-loading">جارٍ التحميل…</div>

      <EmptyState
        v-else-if="team.shops.value.length === 0"
        data-test="empty"
        title="لا توجد متاجر مطابقة"
      />

      <div v-else class="shop-list">
        <details
          v-for="shop in team.shops.value"
          :key="shop.shopId"
          class="shop-card"
          :data-test="`team-health-shop-${shop.shopId}`"
        >
          <summary class="shop-summary">
            <span class="shop-name">{{ shop.shopName }}</span>
            <span v-if="shop.staleDeviceCount > 0" class="badge badge-warning" data-test="stale-badge">
              {{ shop.staleDeviceCount }} جهاز غير متصل
            </span>
          </summary>

          <dl class="metric-grid">
            <div class="metric-row">
              <dt>عمليات إغلاق تلقائي للورديات</dt>
              <dd>{{ shop.neverClosedShiftCount.display }}</dd>
            </div>
            <div class="metric-row">
              <dt>عدم توازن الدرج</dt>
              <dd>{{ shop.drawerMismatchCount.display }}</dd>
            </div>
            <div class="metric-row">
              <dt>فشل مزامنة البيانات</dt>
              <dd>{{ shop.syncFailureRate.display }}</dd>
            </div>
            <div class="metric-row">
              <dt>مدة الانقطاع عن الإنترنت (ثوانٍ)</dt>
              <dd>{{ shop.offlineDurationSeconds.display }}</dd>
            </div>
            <div class="metric-row">
              <dt>فشل المهام المؤجلة</dt>
              <dd>{{ shop.deferredJobFailureRate.display }}</dd>
            </div>
            <div class="metric-row">
              <dt>أخطاء التطبيق</dt>
              <dd>{{ shop.appErrorRate.display }}</dd>
            </div>
            <div class="metric-row">
              <dt>رسائل عالقة (dead-letter)</dt>
              <dd>
                {{ shop.deadLetterCount.display }}
                <span v-if="shop.deadLetterFreshness" class="freshness">
                  ({{ shop.deadLetterFreshness.ageLabel }}<template v-if="shop.deadLetterFreshness.isStale"> · قديم</template>)
                </span>
              </dd>
            </div>
            <div class="metric-row">
              <dt>فترات قياس مفقودة (تشخيصي)</dt>
              <dd>{{ shop.telemetryPeriodsDropped.display }}</dd>
            </div>
          </dl>

          <div class="device-table-wrap">
            <table class="device-table" data-test="device-table">
              <thead>
                <tr>
                  <th>الجهاز</th>
                  <th>نشط</th>
                  <th>آخر ظهور</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="device in shop.devices" :key="device.deviceId" :data-test="`device-row-${device.deviceId}`">
                  <td class="mono">{{ device.deviceId }}</td>
                  <td>{{ device.isActive ? 'نعم' : 'لا' }}</td>
                  <td>{{ device.lastSeenAt ?? '—' }}</td>
                  <td>
                    <span :class="['device-status', device.isStale ? 'stale' : 'ok']">
                      {{ device.isStale ? 'غير متصل' : 'متصل' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.page-main { flex: 1; padding: 1rem 1rem 6rem; max-width: 56rem; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 14px; }

.caption { margin: 0; font-size: 0.8rem; color: #93A3B8; line-height: 1.6; }

.feedback {
  margin: 0;
  padding: 8px 12px;
  border-radius: 0.5rem;
  font-size: 0.82rem;
  background: rgba(219, 26, 26, 0.15);
  border: 1px solid rgba(219, 26, 26, 0.4);
  color: #F5C6C6;
}

.search-input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #E8EDF5;
  font-family: inherit;
  font-size: 0.9rem;
}
.search-input:focus { outline: none; border-color: rgba(26, 86, 219, 0.5); }

.status-loading { padding: 2rem 0; text-align: center; color: #93A3B8; }

.shop-list { display: flex; flex-direction: column; gap: 10px; }

.shop-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.02);
  padding: 10px 14px;
}
.shop-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  font-weight: 700;
  color: #E8EDF5;
  list-style: none;
}
.shop-summary::-webkit-details-marker { display: none; }

.badge {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
}
.badge-warning { background: rgba(217, 119, 6, 0.2); color: #f0b74e; border: 1px solid rgba(217, 119, 6, 0.4); }

.metric-grid { margin: 12px 0 0; display: flex; flex-direction: column; gap: 6px; }
.metric-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.82rem;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.metric-row dt { color: #93A3B8; margin: 0; }
.metric-row dd { color: #E8EDF5; margin: 0; font-variant-numeric: tabular-nums; }
.freshness { color: #93A3B8; font-size: 0.75rem; }

.device-table-wrap { overflow-x: auto; margin-top: 10px; }
.device-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.device-table th {
  text-align: right; padding: 6px 10px; white-space: nowrap;
  color: #93A3B8; font-weight: 700;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.device-table td { padding: 6px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); white-space: nowrap; }
.mono { font-family: monospace; font-size: 0.72rem; color: #93A3B8; }

.device-status { font-weight: 700; }
.device-status.ok { color: #4ade80; }
.device-status.stale { color: #f0b74e; }
</style>
