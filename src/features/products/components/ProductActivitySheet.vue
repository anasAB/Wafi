<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useProductActivity } from '../composables/useProductActivity'

const props = defineProps<{ productId: string; productName: string }>()
const emit  = defineEmits<{ (e: 'close'): void }>()

const { entries, loading, load, totalQty, totalRevenueUsd, byPrice } = useProductActivity()
const selectedPrice = ref<number | null>(null)

const filteredEntries = computed(() =>
  selectedPrice.value === null
    ? entries.value
    : entries.value.filter((e) => e.unitPriceUsd === selectedPrice.value),
)

const hasActivePriceFilter = computed(() => selectedPrice.value !== null)

onMounted(() => load(props.productId))

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

function togglePriceFilter(price: number) {
  selectedPrice.value = selectedPrice.value === price ? null : price
}

function clearPriceFilter() {
  selectedPrice.value = null
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
          <p class="sheet-note">تحليل المبيعات والأسعار لهذا المنتج</p>
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
              <span class="summary-label">إجمالي المُباع</span>
              <span class="summary-value">{{ totalQty }}</span>
            </div>
            <div class="summary-cell">
              <span class="summary-label">إجمالي الإيراد</span>
              <span class="summary-value" dir="ltr">${{ totalRevenueUsd.toFixed(2) }}</span>
            </div>
          </div>

          <!-- Prices it sold at -->
          <p class="section-label">أسعار البيع (اضغط للتصفية)</p>
          <div class="price-chips">
            <button
              v-for="p in byPrice"
              :key="p.price"
              type="button"
              class="price-chip"
              :class="{ 'price-chip--active': selectedPrice === p.price }"
              @click="togglePriceFilter(p.price)"
            >
              <span class="price-chip-price" dir="ltr">${{ p.price.toFixed(2) }}</span>
              <span class="price-chip-sep">•</span>
              <span class="price-chip-count">{{ p.qty }} مرات بيع</span>
            </button>

            <button
              v-if="hasActivePriceFilter"
              type="button"
              class="price-chip price-chip--clear"
              @click="clearPriceFilter"
            >عرض الكل</button>
          </div>

          <!-- Each sale -->
          <p class="section-label">سجل المبيعات</p>
          <p v-if="hasActivePriceFilter" class="filter-note" dir="ltr">
            عرض السجل على السعر: ${{ selectedPrice?.toFixed(2) }}
          </p>

          <div v-if="filteredEntries.length === 0" class="state-muted">لا توجد عمليات بهذا السعر</div>
          <div class="rows">
            <div v-for="e in filteredEntries" :key="e.saleId + e.createdAt" class="row">
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

      <div class="sheet-footer">
        <button type="button" class="btn-close" @click="emit('close')">إغلاق</button>
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
  width: calc(100% - 16px);
  max-width: 34rem;
  max-height: 88dvh;
  margin: 0 8px calc(8px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.32);
  border-radius: 1.25rem;
  box-shadow: 0 12px 56px rgba(0,0,0,0.55), 0 4px 24px rgba(26,86,219,0.16), inset 0 1px 0 rgba(255,255,255,0.08);
}
@media (min-width: 640px) {
  .sheet {
    width: 100%;
    margin: 0;
  }
}

.sheet-handle-wrap { display: flex; justify-content: center; padding: 10px 0 4px; }
.sheet-handle { width: 2.25rem; height: 0.25rem; border-radius: 9999px; background: rgba(255,255,255,0.20); }
@media (min-width: 640px) { .sheet-handle-wrap { display: none; } }

.sheet-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 10px 16px 12px;
  border-bottom: 1px solid rgba(26,86,219,0.14);
}
.sheet-title { font-size: 16px; font-weight: 700; color: #E8EDF5; margin: 0; }
.sheet-sub   { font-size: 12px; color: #637285; margin-top: 2px; }
.sheet-note  { font-size: 12px; color: #9CB3D0; margin-top: 2px; }

.close-btn {
  width: 2rem; height: 2rem; border-radius: 0.7rem;
  display: flex; align-items: center; justify-content: center;
  color: #9CB3D0;
  background: rgba(26,86,219,0.10);
  border: 1px solid rgba(26,86,219,0.28);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  flex-shrink: 0;
}
.close-btn:hover { background: rgba(26,86,219,0.18); color: #E8EDF5; border-color: rgba(26,86,219,0.45); }

.sheet-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 14px;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.sheet-scroll::-webkit-scrollbar { width: 10px; }
.sheet-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.06); }
.sheet-scroll::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}
.sheet-scroll::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.state-muted { font-size: 13px; color: #637285; padding: 1rem 0; text-align: center; }

.summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.summary-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 0.8rem;
  background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.20);
}
.summary-value { font-size: 1.02rem; font-weight: 800; color: #E8EDF5; font-variant-numeric: tabular-nums; }
.summary-label { font-size: 0.72rem; color: #637285; }

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 0 0 0.42rem;
  padding: 0 2px;
}

.price-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.price-chip {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #60A5FA;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(26,86,219,0.24);
  border-radius: 9999px;
  padding: 3px 10px;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.price-chip:hover {
  border-color: rgba(26,86,219,0.42);
  background: rgba(26,86,219,0.12);
}

.price-chip--active {
  border-color: rgba(96,165,250,0.7);
  background: rgba(26,86,219,0.22);
  box-shadow: 0 0 0 2px rgba(26,86,219,0.18);
}

.price-chip--clear {
  color: #C8D5E8;
  background: rgba(255,255,255,0.04);
}

.price-chip-price {
  color: #93C5FD;
}

.price-chip-sep {
  color: #637285;
}

.price-chip-count {
  color: #C8D5E8;
  font-size: 11px;
  font-weight: 700;
}

.filter-note {
  margin: 0 2px 8px;
  font-size: 12px;
  color: #9CB3D0;
}

.rows { display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 9px 10px;
  border-radius: 0.72rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.20);
}
.row-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row-number { font-size: 12px; font-weight: 700; color: #E8EDF5; }
.row-date { font-size: 11px; color: #637285; }
.row-amounts { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.row-qty { font-size: 11px; color: #637285; font-variant-numeric: tabular-nums; }
.row-total { font-size: 13px; font-weight: 800; color: #60A5FA; font-variant-numeric: tabular-nums; }

.sheet-footer {
  padding: 1rem 1rem 1.1rem;
  border-top: 1px solid rgba(26,86,219,0.14);
  background: linear-gradient(180deg, rgba(8,14,24,0.96), rgba(6,9,15,0.98));
}

.btn-close {
  width: 100%;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(26,86,219,0.24);
  background: rgba(255,255,255,0.04);
  color: #C8D5E8;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.btn-close:hover {
  border-color: rgba(26,86,219,0.42);
  background: rgba(26,86,219,0.12);
  color: #E8EDF5;
}
</style>
