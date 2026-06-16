<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import AppDialog from '@/components/ui/AppDialog.vue'

const emit = defineEmits<{ (e: 'pay'): void }>()
const store = useSaleStore()

const totalSyp = computed(() => {
  const rate = store.lockedExchangeRate
  if (rate === null) return null
  return Math.round(store.totalUsd * rate)
})

const showClearDialog = ref(false)

function handleClearSale() {
  store.clear()
  showClearDialog.value = false
}
</script>

<template>
  <div class="panel-root" dir="rtl">

    <!-- Header -->
    <div class="panel-header">
      <div class="header-left">
        <span class="receipt-icon">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
        </span>
        <span class="panel-title">الفاتورة</span>
        <span v-if="store.lines.length > 0" class="item-badge">{{ store.lines.length }}</span>
      </div>
      <button
        v-if="store.lines.length > 0"
        type="button"
        class="clear-btn"
        @click="showClearDialog = true"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
        مسح
      </button>
    </div>

    <!-- Line items -->
    <div class="lines-list">

      <!-- Empty state -->
      <div v-if="store.lines.length === 0" class="lines-empty">
        <div class="empty-icon-wrap">
          <svg width="22" height="22" fill="none" stroke="#3D4F6B" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
        </div>
        <p class="empty-text">اضغط على منتج لإضافته</p>
      </div>

      <!-- Line rows -->
      <div v-for="line in store.lines" :key="line.productId" class="line-row">
        <!-- Product info -->
        <div class="line-info">
          <p class="line-name">{{ line.nameAr }}</p>
          <div class="line-unit">
            <span class="price-edit">$<input
              type="number"
              min="0"
              step="0.01"
              inputmode="decimal"
              class="price-input"
              :value="line.unitPriceUsd"
              :aria-label="`سعر ${line.nameAr}`"
              @change="store.updateUnitPrice(line.productId, parseFloat(($event.target as HTMLInputElement).value))"
            /></span>
            <span class="times">× {{ line.quantity }}</span>
            <span
              v-if="line.listPriceUsd !== undefined && Math.abs(line.unitPriceUsd - line.listPriceUsd) > 0.001"
              class="price-delta"
              :class="line.unitPriceUsd > line.listPriceUsd ? 'delta-up' : 'delta-down'"
              :title="`السعر المعتاد $${line.listPriceUsd.toFixed(2)}`"
            >{{ line.unitPriceUsd > line.listPriceUsd ? '▲' : '▼' }} ${{ Math.abs(line.unitPriceUsd - line.listPriceUsd).toFixed(2) }}</span>
          </div>
        </div>

        <!-- Qty controls -->
        <div class="qty-controls">
          <button
            type="button"
            class="qty-btn"
            @click="line.quantity - 1 < 1 ? store.removeLine(line.productId) : store.updateQuantity(line.productId, line.quantity - 1)"
          >−</button>
          <span class="qty-value">{{ line.quantity }}</span>
          <button
            type="button"
            class="qty-btn"
            :disabled="line.quantity >= line.availableStock"
            :title="line.quantity >= line.availableStock ? `الكمية المتوفرة فقط ${line.availableStock}` : undefined"
            @click="store.updateQuantity(line.productId, line.quantity + 1)"
          >+</button>
        </div>

        <!-- Total + delete -->
        <div class="line-right">
          <span class="line-total">${{ line.lineTotalUsd.toFixed(2) }}</span>
          <button
            type="button"
            class="line-delete"
            aria-label="حذف"
            @click="store.removeLine(line.productId)"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Footer: totals + pay -->
    <div class="panel-footer">
      <div class="totals-block">
        <div class="total-main-row">
          <span class="total-main-label">المجموع</span>
          <span class="total-main-value">${{ store.totalUsd.toFixed(2) }}</span>
        </div>
        <div v-if="totalSyp !== null" class="total-syp-row">
          <span class="total-syp-label">بالليرة</span>
          <span class="total-syp-value">{{ totalSyp.toLocaleString() }} ل.س</span>
        </div>
      </div>

      <button
        type="button"
        :disabled="store.lines.length === 0 || store.totalUsd <= 0"
        class="pay-btn"
        @click="emit('pay')"
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
        <span>دفع</span>
      </button>
    </div>

  </div>

  <AppDialog
    v-if="showClearDialog"
    title="مسح البيع"
    message="متأكد من حذف جميع العناصر؟"
    confirm-label="نعم، امسح"
    cancel-label="إلغاء"
    :danger="true"
    @confirm="handleClearSale"
    @cancel="showClearDialog = false"
  />
</template>

<style scoped>
.panel-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(180deg,
    rgba(26,86,219,0.14) 0%,
    rgba(13,24,40,0.98)  40%,
    rgba(7,11,20,1.00)   100%
  );
  border-right: 1px solid rgba(26,86,219,0.22);
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Header ─────────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  height: 48px;
  border-bottom: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.10);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.receipt-icon {
  display: flex;
  align-items: center;
  color: #60A5FA;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: #E8EDF5;
}

.item-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 700;
  color: #60A5FA;
  background: rgba(26,86,219,0.22);
  border: 1px solid rgba(26,86,219,0.35);
  padding-inline: 5px;
}

.clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #EF4444;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.20);
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.clear-btn:hover { background: rgba(239,68,68,0.14); }

/* ── Lines list ─────────────────────────────────── */
.lines-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* Empty state */
.lines-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 20px;
  text-align: center;
}

.empty-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.16);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-text {
  font-size: 13px;
  color: #3D4F6B;
}

/* Line row */
.line-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(26,86,219,0.08);
  transition: background 0.12s;
}

.line-row:hover {
  background: rgba(26,86,219,0.06);
}

.line-info {
  flex: 1;
  min-width: 0;
}

.line-name {
  font-size: 13px;
  font-weight: 600;
  color: #E8EDF5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0 0 2px;
}

.line-unit {
  font-size: 11px;
  color: #637285;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.price-edit {
  display: inline-flex;
  align-items: center;
  color: #60A5FA;
  font-weight: 700;
}

.price-input {
  width: 56px;
  background: rgba(26,86,219,0.10);
  border: 1px solid rgba(26,86,219,0.28);
  border-radius: 6px;
  padding: 2px 6px;
  margin-inline-start: 2px;
  color: #E8EDF5;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  outline: none;
  font-variant-numeric: tabular-nums;
}

.price-input:focus {
  border-color: rgba(26,86,219,0.7);
  box-shadow: 0 0 0 2px rgba(26,86,219,0.20);
}

.times { color: #637285; }

.price-delta {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.price-delta.delta-up   { color: #22C55E; }
.price-delta.delta-down { color: #F59E0B; }

/* Qty controls */
.qty-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  background: rgba(26,86,219,0.10);
  border: 1px solid rgba(26,86,219,0.22);
  border-radius: 10px;
  padding: 3px;
}

.qty-btn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 500;
  line-height: 1;
  background: rgba(26,86,219,0.18);
  border: 1px solid rgba(26,86,219,0.30);
  color: #60A5FA;
  cursor: pointer;
  transition: background 0.12s, transform 0.1s;
}

.qty-btn:hover:not(:disabled) { background: rgba(26,86,219,0.28); }
.qty-btn:active:not(:disabled) { transform: scale(0.88); }

.qty-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.qty-value {
  font-size: 14px;
  font-weight: 700;
  color: #E8EDF5;
  min-width: 22px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* Right-side: total + delete */
.line-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.line-total {
  font-size: 13px;
  font-weight: 700;
  color: #60A5FA;
  min-width: 50px;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.line-delete {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: #3D4F6B;
  cursor: pointer;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
  flex-shrink: 0;
}

.line-delete:hover {
  color: #EF4444;
  background: rgba(239,68,68,0.10);
  border-color: rgba(239,68,68,0.22);
}

/* ── Footer ─────────────────────────────────────── */
.panel-footer {
  flex-shrink: 0;
  padding: 14px;
  border-top: 1px solid rgba(26,86,219,0.20);
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(26,86,219,0.04));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.totals-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.total-main-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.total-main-label {
  font-size: 13px;
  color: #637285;
}

.total-main-value {
  font-size: 22px;
  font-weight: 800;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.total-syp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.total-syp-label {
  font-size: 11px;
  color: #3D4F6B;
}

.total-syp-value {
  font-size: 12px;
  color: #637285;
  font-variant-numeric: tabular-nums;
}

/* Pay button */
.pay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 52px;
  border-radius: 14px;
  font-size: 17px;
  font-weight: 800;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB 0%, #1248B3 100%);
  border: none;
  box-shadow:
    0 6px 24px rgba(26,86,219,0.55),
    0 1px 0 rgba(255,255,255,0.12) inset;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s;
}

.pay-btn:hover:not(:disabled) {
  opacity: 0.92;
  box-shadow: 0 8px 32px rgba(26,86,219,0.65), 0 1px 0 rgba(255,255,255,0.12) inset;
}

.pay-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.pay-btn:disabled {
  opacity: 0.30;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
