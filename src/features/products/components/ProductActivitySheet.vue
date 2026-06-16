<script setup lang="ts">
import { onMounted } from 'vue'
import { useProductActivity } from '../composables/useProductActivity'

const props = defineProps<{ productId: string; productName: string }>()
const emit  = defineEmits<{ (e: 'close'): void }>()

const { entries, loading, load, totalQty, totalRevenueUsd, byPrice } = useProductActivity()

onMounted(() => load(props.productId))

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <div class="sheet" dir="rtl" data-testid="product-activity-sheet">
      <div class="sheet-handle-wrap"><div class="sheet-handle" /></div>

      <div class="sheet-header">
        <div>
          <h2 class="sheet-title">نشاط المنتج</h2>
          <p class="sheet-sub">{{ productName }}</p>
        </div>
        <button type="button" class="close-btn" aria-label="إغلاق" @click="emit('close')">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="sheet-scroll">
        <div v-if="loading" class="state-muted">جارٍ التحميل...</div>
        <div v-else-if="entries.length === 0" class="state-muted">لم يُبَع هذا المنتج بعد</div>

        <template v-else>
          <!-- Summary -->
          <div class="summary">
            <div class="summary-cell">
              <span class="summary-value">{{ totalQty }}</span>
              <span class="summary-label">إجمالي المُباع</span>
            </div>
            <div class="summary-cell">
              <span class="summary-value" dir="ltr">${{ totalRevenueUsd.toFixed(2) }}</span>
              <span class="summary-label">إجمالي الإيراد</span>
            </div>
          </div>

          <!-- Prices it sold at -->
          <p class="section-label">أسعار البيع</p>
          <div class="price-chips">
            <span v-for="p in byPrice" :key="p.price" class="price-chip">
              <span dir="ltr">${{ p.price.toFixed(2) }}</span> · {{ p.qty }}
            </span>
          </div>

          <!-- Each sale -->
          <p class="section-label">سجل المبيعات</p>
          <div class="rows">
            <div v-for="e in entries" :key="e.saleId + e.createdAt" class="row">
              <div class="row-info">
                <span class="row-number">{{ e.displayNumber }}</span>
                <span class="row-date">{{ formatDate(e.createdAt) }}</span>
              </div>
              <div class="row-amounts">
                <span class="row-qty" dir="ltr">${{ e.unitPriceUsd.toFixed(2) }} × {{ e.quantity }}</span>
                <span class="row-total" dir="ltr">${{ e.lineTotalUsd.toFixed(2) }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
  font-family: 'Tajawal', system-ui, sans-serif;
}
@media (min-width: 640px) { .sheet-backdrop { align-items: center; } }

.sheet {
  width: 100%; max-width: 32rem; max-height: 85dvh; display: flex; flex-direction: column;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06)), #0D1828;
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 1.25rem 1.25rem 0 0;
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}
@media (min-width: 640px) { .sheet { border-radius: 1.25rem; } }

.sheet-handle-wrap { display: flex; justify-content: center; padding: 10px 0 4px; }
.sheet-handle { width: 2.25rem; height: 0.25rem; border-radius: 9999px; background: rgba(255,255,255,0.20); }

.sheet-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 8px 16px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.sheet-title { font-size: 16px; font-weight: 700; color: #E8EDF5; margin: 0; }
.sheet-sub   { font-size: 12px; color: #637285; margin-top: 2px; }

.close-btn {
  width: 2rem; height: 2rem; border-radius: 0.625rem;
  display: flex; align-items: center; justify-content: center;
  color: #637285; background: rgba(255,255,255,0.06); border: none; cursor: pointer;
  transition: background 0.12s; flex-shrink: 0;
}
.close-btn:hover { background: rgba(255,255,255,0.10); }

.sheet-scroll { flex: 1; overflow-y: auto; padding: 14px 16px 20px; }

.state-muted { font-size: 13px; color: #637285; padding: 1rem 0; text-align: center; }

.summary {
  display: flex; gap: 10px; margin-bottom: 16px;
}
.summary-cell {
  flex: 1; display: flex; flex-direction: column; gap: 2px;
  padding: 12px; border-radius: 0.75rem;
  background: rgba(26,86,219,0.10); border: 1px solid rgba(26,86,219,0.20);
}
.summary-value { font-size: 1.125rem; font-weight: 800; color: #E8EDF5; font-variant-numeric: tabular-nums; }
.summary-label { font-size: 11px; color: #637285; }

.section-label {
  font-size: 0.6875rem; font-weight: 600; color: #637285;
  text-transform: uppercase; letter-spacing: 0.08em;
  margin: 0 0 0.5rem;
}

.price-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.price-chip {
  font-size: 12px; font-weight: 700; color: #60A5FA;
  background: rgba(26,86,219,0.12); border: 1px solid rgba(26,86,219,0.24);
  border-radius: 9999px; padding: 3px 10px;
  font-variant-numeric: tabular-nums;
}

.rows { display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 8px 10px; border-radius: 0.625rem;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
}
.row-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row-number { font-size: 12px; font-weight: 600; color: #E8EDF5; }
.row-date { font-size: 11px; color: #637285; }
.row-amounts { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.row-qty { font-size: 11px; color: #637285; font-variant-numeric: tabular-nums; }
.row-total { font-size: 13px; font-weight: 700; color: #60A5FA; font-variant-numeric: tabular-nums; }
</style>
