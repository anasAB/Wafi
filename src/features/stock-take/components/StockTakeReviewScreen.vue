<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const { loadSession, reviewLines, totalShrinkageValueUsd, confirmSession } = useStockTake()
const loading = ref(true)
const confirming = ref(false)

onMounted(async () => {
  loading.value = true
  await loadSession(sessionId)
  loading.value = false
})

async function onConfirm() {
  confirming.value = true
  try {
    await confirmSession()
    router.push('/stock-take/history')
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="مراجعة الجرد" show-back @back="router.push(`/stock-take/${sessionId}`)" />

    <main class="main-content">
      <div v-if="loading" class="loading-wrap">
        <div class="spinner" />
      </div>

      <template v-else>
        <div class="summary-card">
          <span class="summary-label">إجمالي قيمة العجز</span>
          <span
            class="summary-value"
            data-testid="stock-take-total-shrinkage"
            :class="totalShrinkageValueUsd < 0 ? 'loss' : 'gain'"
          >
            {{ totalShrinkageValueUsd.toFixed(2) }} $
          </span>
        </div>

        <EmptyState
          v-if="reviewLines.length === 0"
          title="لا توجد فروقات"
          subtitle="جميع الكميات المعدودة تطابق المخزون المسجل"
        />

        <div v-else class="line-list">
          <div v-for="line in reviewLines" :key="line.id" class="line-card">
            <div class="line-info">
              <span class="line-name">{{ line.productNameAr }}</span>
              <span class="line-variance">الفرق: {{ line.variance }}</span>
            </div>
            <span
              v-if="line.varianceValueUsd !== null"
              class="line-value"
              :class="line.varianceValueUsd < 0 ? 'loss' : 'gain'"
            >
              {{ line.varianceValueUsd.toFixed(2) }} $
            </span>
            <span v-else class="line-value line-value-muted">—</span>
          </div>
        </div>

        <button
          type="button"
          class="btn-primary"
          data-testid="stock-take-confirm"
          :disabled="confirming"
          @click="onConfirm"
        >
          {{ confirming ? 'جاري التطبيق...' : 'تأكيد وتطبيق' }}
        </button>
      </template>
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
  color: #E8EDF5;
}

.main-content {
  flex: 1;
  padding: 1rem;
  max-width: 32rem;
  width: 100%;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
@media (min-width: 1024px) { .main-content { padding: 1.5rem; } }

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

.summary-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.25rem;
  border-radius: 1rem;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.summary-label { font-size: 0.8125rem; color: #637285; }
.summary-value { font-size: 1.375rem; font-weight: 700; }

.line-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.line-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 0.875rem;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.line-info { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.line-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.line-variance { font-size: 0.75rem; color: #637285; }
.line-value { font-size: 0.9375rem; font-weight: 700; flex-shrink: 0; }
.line-value-muted { color: #637285; }

.loss { color: #EF4444; }
.gain { color: #4ADE80; }

.btn-primary {
  width: 100%;
  height: 46px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.9375rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: transform 0.15s, opacity 0.15s;
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary:not(:disabled):active { transform: scale(0.98); }
</style>
