<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useStockTakeHistory } from '@/features/stock-take/composables/useStockTakeHistory'

const router = useRouter()
const { sessions, load, lastThreeTrendUsd } = useStockTakeHistory()
const loading = ref(true)

onMounted(async () => {
  loading.value = true
  await load()
  loading.value = false
})

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="سجل الجرد" show-back @back="router.push('/stock-take')" />

    <div class="toolbar-row">
      <button type="button" class="btn-primary btn-desktop-add" @click="router.push('/stock-take')">
        <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        جرد جديد
      </button>
    </div>

    <main class="main-content">
      <div v-if="loading" class="loading-wrap">
        <div class="spinner" />
      </div>

      <template v-else>
        <div class="trend-card">
          <span class="trend-label">اتجاه العجز (آخر 3 عمليات)</span>
          <span
            class="trend-value"
            data-testid="stock-take-trend"
            :class="lastThreeTrendUsd < 0 ? 'loss' : 'gain'"
          >
            {{ lastThreeTrendUsd.toFixed(2) }} $
          </span>
        </div>

        <EmptyState
          v-if="sessions.length === 0"
          title="لا يوجد سجل جرد بعد"
          subtitle="ستظهر عمليات الجرد المكتملة هنا"
          cta-label="بدء جرد جديد"
          @cta="router.push('/stock-take')"
        />

        <div v-else class="session-list">
          <div
            v-for="s in sessions"
            :key="s.id"
            data-testid="stock-take-history-row"
            class="session-card"
            @click="router.push(`/stock-take/${s.id}/review`)"
          >
            <div class="session-info">
              <span class="session-date">{{ formatDate(s.startedAt) }}</span>
              <span class="session-count">{{ s.productsCounted }} منتج</span>
            </div>
            <span class="session-value" :class="s.totalShrinkageUsd < 0 ? 'loss' : 'gain'">
              {{ s.totalShrinkageUsd.toFixed(2) }} $
            </span>
          </div>
        </div>
      </template>
    </main>

    <button type="button" class="fab" @click="router.push('/stock-take')">
      <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      جرد جديد
    </button>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
}

.main-content {
  flex: 1;
  padding: 1rem 1rem 7rem;
  max-width: 32rem;
  width: 100%;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
@media (min-width: 1024px) {
  .main-content { padding: 1.5rem 1.5rem 2.5rem; }
}

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
  border: 2px solid rgba(26, 86, 219, 0.28);
  border-top-color: #1A56DB;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.trend-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem;
  border-radius: 1rem;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.trend-label { font-size: 0.8125rem; color: #637285; }
.trend-value { font-size: 1.25rem; font-weight: 700; }

.session-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.session-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.session-card:active { transform: scale(0.98); }
.session-card:hover {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(255, 255, 255, 0.06));
  box-shadow: 0 4px 24px rgba(26, 86, 219, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.09);
}
.session-info { display: flex; flex-direction: column; gap: 0.125rem; }
.session-date { font-size: 0.875rem; font-weight: 600; color: #E8EDF5; }
.session-count { font-size: 0.75rem; color: #637285; }
.session-value { font-size: 1rem; font-weight: 700; flex-shrink: 0; }

.loss { color: #EF4444; }
.gain { color: #4ADE80; }

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
  box-shadow: 0 6px 24px rgba(26, 86, 219, 0.50);
  z-index: 20;
  transition: transform 0.15s;
}
.fab:active { transform: scale(0.95); }
@media (min-width: 1024px) { .fab { display: none; } }
.btn-icon { width: 1rem; height: 1rem; flex-shrink: 0; }

.toolbar-row {
  display: flex;
  justify-content: flex-end;
  max-width: 32rem;
  width: 100%;
  margin-inline: auto;
  padding: 1rem 1rem 0;
}
@media (min-width: 1024px) { .toolbar-row { padding: 1.25rem 1.5rem 0; } }

.btn-desktop-add {
  display: none;
}
@media (min-width: 1024px) { .btn-desktop-add { display: flex; } }

.btn-primary {
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
</style>
