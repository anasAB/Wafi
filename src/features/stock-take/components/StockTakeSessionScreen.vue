<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'
import { useBarcodeScan } from '@/composables/useBarcodeScan'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const { lines, loadSession, recordCount, progress } = useStockTake()
const currentIndex = ref(0)
const inputValue = ref('')
const loading = ref(true)

const remainingLines = computed(() => lines.value.filter(l => l.countedStock === null))
const currentLine = computed(() => remainingLines.value[0] ?? null)

const progressPct = computed(() =>
  progress.value.total === 0 ? 0 : Math.round((progress.value.counted / progress.value.total) * 100)
)

const canSubmit = computed(() => {
  const trimmed = String(inputValue.value).trim()
  if (!trimmed) return false
  const qty = Number(trimmed)
  return Number.isFinite(qty) && qty >= 0
})

async function submitCount() {
  if (!currentLine.value || !canSubmit.value) return
  const qty = Number(String(inputValue.value).trim())
  await recordCount(currentLine.value.id, qty)
  inputValue.value = ''
  if (remainingLines.value.length === 0) {
    router.push(`/stock-take/${sessionId}/review`)
  }
}

const { onScan, offScan } = useBarcodeScan()
function handleScan(barcode: string) {
  const match = lines.value.find(l => l.productId === barcode)
  if (match) {
    const idx = remainingLines.value.findIndex(l => l.id === match.id)
    if (idx >= 0) currentIndex.value = idx
  }
}

onMounted(async () => {
  loading.value = true
  await loadSession(sessionId)
  loading.value = false
  onScan(handleScan)
})
onUnmounted(() => offScan(handleScan))
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="جرد المخزون" show-back @back="router.push('/stock-take')" />

    <main class="main-content">
      <div v-if="loading" class="loading-wrap">
        <div class="spinner" />
      </div>

      <template v-else>
        <div class="progress-card">
          <div class="progress-top">
            <span class="progress-label">التقدم</span>
            <span class="progress-count" data-testid="stock-take-progress">
              {{ progress.counted }} من {{ progress.total }}
            </span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: progressPct + '%' }" />
          </div>
        </div>

        <div v-if="currentLine" class="count-card">
          <p class="product-name">{{ currentLine.productNameAr }}</p>
          <p class="field-label">الكمية المعدودة</p>
          <input
            data-testid="stock-take-count-input"
            type="number"
            min="0"
            inputmode="decimal"
            class="form-input count-input"
            v-model="inputValue"
            @keyup.enter="submitCount"
          />
          <button
            type="button"
            class="btn-primary"
            data-testid="stock-take-count-submit"
            :disabled="!canSubmit"
            @click="submitCount"
          >
            التالي
          </button>
        </div>

        <div v-else class="done-card">
          <div class="done-icon-wrap">
            <svg class="done-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p class="done-title">تم عد جميع المنتجات</p>
        </div>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
@media (min-width: 1024px) {
  .main-content { padding: 2rem; gap: 1.25rem; }
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

.progress-card {
  width: 100%;
  max-width: 28rem;
  padding: 1rem 1.25rem;
  border-radius: 1rem;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
@media (min-width: 1024px) { .progress-card { max-width: 34rem; } }
.progress-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.625rem;
}
.progress-label { font-size: 0.75rem; color: #637285; }
.progress-count { font-size: 0.875rem; font-weight: 700; color: #E8EDF5; }
.progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  transition: width 0.2s ease;
}

.count-card {
  width: 100%;
  max-width: 28rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 1.5rem 1.25rem;
  border-radius: 1rem;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
@media (min-width: 1024px) {
  .count-card {
    max-width: 34rem;
    padding: 2rem 1.75rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
  .product-name { font-size: 1.25rem; }
  .count-input { height: 60px; font-size: 1.75rem; }
  .btn-primary { height: 50px; font-size: 1rem; }
}
.product-name {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  text-align: center;
  margin-bottom: 0.25rem;
}
.field-label { font-size: 0.75rem; color: #637285; }

.form-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0 0.875rem;
  color: #E8EDF5;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}
.count-input {
  height: 52px;
  text-align: center;
  font-size: 1.5rem;
  font-weight: 700;
}

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
  transition: transform 0.15s;
  margin-top: 0.25rem;
}
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.done-card {
  width: 100%;
  max-width: 28rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem 1.25rem;
  border-radius: 1rem;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.done-icon-wrap {
  width: 4rem;
  height: 4rem;
  border-radius: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(39, 174, 96, 0.15), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(39, 174, 96, 0.35);
  color: #4ADE80;
}
.done-icon { width: 2rem; height: 2rem; }
.done-title { font-size: 0.9375rem; font-weight: 600; color: #E8EDF5; }
</style>
