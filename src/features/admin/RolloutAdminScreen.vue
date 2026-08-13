<!-- WAFI-155 internal-only /admin/rollouts screen. Lets a platform admin flip
     engineering rollout flags (dashboard_v2, pos_brain, insights) per shop.
     Shop-wide, applied after the shop's next device sync. Composable logic
     (optimistic toggle, pending-lock, revert-on-failure, stale-response
     guarding) is unit-tested in composables/__tests__/useRolloutAdmin.test.ts
     -- this component is thin wiring, per the project's test pyramid. -->
<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useRolloutAdmin } from './composables/useRolloutAdmin'
import { ROLLOUT_FLAG_KEYS } from '@/features/flags/flagRegistry'

const router = useRouter()
const admin = useRolloutAdmin()

onMounted(() => { admin.refresh().catch(() => {}) })

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(admin.query, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { admin.refresh().catch(() => {}) }, 300)
})
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="ضبط الإصدارات التجريبية" :show-back="true" @back="router.back()" />

    <main class="page-main">
      <p class="caption">
        هذه الأعلام تتحكم بميزات قيد التطوير أو التجربة. أي تغيير يشمل المتجر
        بالكامل ويؤثر على جميع أجهزته بعد أول مزامنة تالية للجهاز.
      </p>

      <p
        v-if="admin.message.value"
        class="feedback"
        :class="{ error: admin.message.value.isError }"
        data-test="rollout-message"
      >
        {{ admin.message.value.text }}
      </p>

      <input
        v-model="admin.query.value"
        type="text"
        class="search-input"
        placeholder="ابحث عن متجر..."
        data-test="rollout-search"
      />

      <EmptyState
        v-if="!admin.loading.value && admin.shops.value.length === 0"
        data-test="empty"
        title="لا توجد متاجر مطابقة"
      />

      <div v-else class="table-wrap">
        <table class="rollout-table" data-test="rollout-table">
          <thead>
            <tr>
              <th>المتجر</th>
              <th v-for="key in ROLLOUT_FLAG_KEYS" :key="key">{{ key }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="shop in admin.shops.value" :key="shop.shopId" :data-test="`rollout-row-${shop.shopId}`">
              <td class="name-cell">{{ shop.shopName }}</td>
              <td v-for="key in ROLLOUT_FLAG_KEYS" :key="key">
                <button
                  type="button"
                  class="toggle-btn"
                  :class="{ on: admin.valueFor(shop, key), pending: admin.isPending(shop.shopId, key) }"
                  :disabled="admin.isPending(shop.shopId, key)"
                  :data-test="`toggle-${shop.shopId}-${key}`"
                  @click="admin.toggle(shop.shopId, key).catch(() => {})"
                >
                  {{ admin.valueFor(shop, key) ? 'ON' : 'OFF' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="admin.capped.value" class="caption" data-test="capped-notice">
        تُعرض أول 100 نتيجة مطابقة فقط. ضيّق نطاق البحث لإيجاد متجر محدد.
      </p>
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
  background: rgba(26, 86, 219, 0.15);
  color: #E8EDF5;
  border: 1px solid rgba(26, 86, 219, 0.4);
}
.feedback.error {
  background: rgba(219, 26, 26, 0.15);
  border-color: rgba(219, 26, 26, 0.4);
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

.table-wrap { overflow-x: auto; }
.rollout-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.rollout-table th {
  text-align: right; padding: 10px 12px; white-space: nowrap;
  color: #93A3B8; font-weight: 700;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.rollout-table td {
  padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  white-space: nowrap;
}
.name-cell { font-weight: 700; color: #E8EDF5; }

.toggle-btn {
  min-width: 56px;
  padding: 6px 12px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #93A3B8;
  transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
}
.toggle-btn.on {
  background: rgba(26, 86, 219, 0.22);
  border-color: rgba(26, 86, 219, 0.55);
  color: #E8EDF5;
}
.toggle-btn.pending { opacity: 0.5; cursor: wait; }
.toggle-btn:disabled { cursor: wait; }
</style>
