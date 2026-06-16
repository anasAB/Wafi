<script setup lang="ts">
import { onMounted } from 'vue'
import { useReturnDetail } from '../composables/useReturnDetail'

const props = defineProps<{ saleId: string; saleNumber: string }>()
const emit  = defineEmits<{ (e: 'close'): void }>()

const { returns, loading, load } = useReturnDetail()

onMounted(() => load(props.saleId))

const METHOD_LABELS: Record<string, string> = {
  cash_usd:     'نقد $',
  cash_syp:     'نقد ل.س',
  store_credit: 'رصيد حساب',
  transfer:     'حوالة',
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <div class="sheet" dir="rtl" data-testid="return-detail-sheet">
      <!-- Handle -->
      <div class="sheet-handle-wrap"><div class="sheet-handle" /></div>

      <!-- Header -->
      <div class="sheet-header">
        <div>
          <span class="sheet-title">مرتجعات فاتورة {{ saleNumber }}</span>
        </div>
        <button type="button" class="close-btn" aria-label="إغلاق" @click="emit('close')">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="sheet-scroll">
        <div v-if="loading" class="state-muted">جارٍ التحميل...</div>
        <div v-else-if="returns.length === 0" class="state-muted">لا توجد مرتجعات</div>

        <div
          v-for="ret in returns"
          :key="ret.id"
          class="return-block"
        >
          <!-- Return header: date + refund -->
          <div class="return-top">
            <span class="return-date">{{ formatDate(ret.createdAt) }}</span>
            <span class="return-method">{{ METHOD_LABELS[ret.refundMethod] ?? ret.refundMethod }}</span>
          </div>

          <!-- Returned line items -->
          <div class="lines-list">
            <div v-for="(line, i) in ret.lines" :key="i" class="line-row">
              <div class="line-info">
                <p class="line-name">{{ line.nameAr }}</p>
                <p class="line-unit">
                  ${{ line.unitPriceUsd.toFixed(2) }} × {{ line.qtyReturned }}
                  <span v-if="!line.restock" class="no-restock">· لم يُعد للمخزون</span>
                </p>
              </div>
              <span class="line-total" dir="ltr">${{ (line.unitPriceUsd * line.qtyReturned).toFixed(2) }}</span>
            </div>
          </div>

          <!-- Reason / notes -->
          <p v-if="ret.reason" class="return-reason">السبب: {{ ret.reason }}</p>
          <p v-if="ret.notes" class="return-reason">ملاحظة: {{ ret.notes }}</p>

          <!-- Refund total -->
          <div class="refund-row">
            <span class="refund-label">إجمالي الاسترداد</span>
            <span class="refund-value" dir="ltr">${{ ret.refundAmountUsd.toFixed(2) }}</span>
          </div>
        </div>
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
@media (min-width: 640px) {
  .sheet-backdrop { align-items: center; }
}

.sheet {
  width: 100%; max-width: 32rem; max-height: 85dvh; display: flex; flex-direction: column;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06)), #0D1828;
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 1.25rem 1.25rem 0 0;
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}
@media (min-width: 640px) {
  .sheet { border-radius: 1.25rem; }
}

.sheet-handle-wrap { display: flex; justify-content: center; padding: 10px 0 4px; }
.sheet-handle { width: 2.25rem; height: 0.25rem; border-radius: 9999px; background: rgba(255,255,255,0.20); }

.sheet-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 8px 16px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.sheet-title { font-size: 16px; font-weight: 700; color: #E8EDF5; }

.close-btn {
  width: 2rem; height: 2rem; border-radius: 0.625rem;
  display: flex; align-items: center; justify-content: center;
  color: #637285; background: rgba(255,255,255,0.06); border: none; cursor: pointer;
  transition: background 0.12s; flex-shrink: 0;
}
.close-btn:hover { background: rgba(255,255,255,0.10); }

.sheet-scroll { flex: 1; overflow-y: auto; padding: 12px 16px 20px; }

.state-muted { font-size: 13px; color: #637285; padding: 1rem 0; text-align: center; }

.return-block {
  border: 1px solid rgba(26,86,219,0.18);
  border-radius: 0.875rem;
  padding: 12px;
  margin-bottom: 12px;
  background: rgba(255,255,255,0.02);
}

.return-top {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.return-date { font-size: 12px; color: #637285; }
.return-method {
  font-size: 11px; font-weight: 700; color: #60A5FA;
  background: rgba(26,86,219,0.14); border: 1px solid rgba(26,86,219,0.30);
  border-radius: 8px; padding: 2px 8px;
}

.lines-list { display: flex; flex-direction: column; gap: 6px; }

.line-row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 8px 10px; border-radius: 0.625rem;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
}
.line-info { min-width: 0; flex: 1; }
.line-name {
  font-size: 13px; font-weight: 600; color: #E8EDF5; margin: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.line-unit { font-size: 11px; color: #637285; margin: 2px 0 0; }
.no-restock { color: #F59E0B; }
.line-total { font-size: 13px; font-weight: 700; color: #60A5FA; flex-shrink: 0; font-variant-numeric: tabular-nums; }

.return-reason { font-size: 12px; color: #637285; margin: 10px 0 0; }

.refund-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid rgba(26,86,219,0.14);
}
.refund-label { font-size: 13px; font-weight: 700; color: #E8EDF5; }
.refund-value { font-size: 15px; font-weight: 800; color: #F59E0B; font-variant-numeric: tabular-nums; }
</style>
