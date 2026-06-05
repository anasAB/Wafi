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

const showClearDialog  = ref(false)
const swipedProductId  = ref<string | null>(null)
let   touchStartX      = 0
let   touchStartY      = 0

function onTouchStart(e: TouchEvent, productId: string) {
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  if (swipedProductId.value !== productId) swipedProductId.value = null
}

function onTouchEnd(e: TouchEvent, productId: string) {
  const dx = touchStartX - e.changedTouches[0].clientX
  const dy = touchStartY - e.changedTouches[0].clientY
  if (Math.abs(dx) < Math.abs(dy)) return
  if (dx > 50)       swipedProductId.value = productId
  else if (dx < -20) swipedProductId.value = null
}

function onTouchCancel() {
  swipedProductId.value = null
}

function handleDeleteLine(productId: string) {
  store.removeLine(productId)
  swipedProductId.value = null
}

function handleClearSale() {
  store.clear()
  showClearDialog.value = false
}
</script>

<template>
  <div class="panel-root" dir="rtl">

    <!-- Header -->
    <div class="panel-header">
      <span class="panel-title">الفاتورة</span>
      <div class="panel-header-meta">
        <span class="item-count">{{ store.lines.length }} صنف</span>
        <button
          v-if="store.lines.length > 0"
          type="button"
          class="clear-btn"
          @click="showClearDialog = true"
        >مسح</button>
      </div>
    </div>

    <!-- Line items -->
    <div class="lines-list">
      <!-- Empty state -->
      <div v-if="store.lines.length === 0" class="lines-empty">
        <svg width="24" height="24" fill="none" stroke="#3D4F6B" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
        <p class="lines-empty-text">لا توجد منتجات في البيع</p>
      </div>

      <!-- Line rows -->
      <div
        v-for="line in store.lines"
        :key="line.productId"
        class="line-wrap"
        @touchstart="(e) => onTouchStart(e, line.productId)"
        @touchend="(e) => onTouchEnd(e, line.productId)"
        @touchcancel="onTouchCancel"
      >
        <!-- Swipe-to-delete reveal -->
        <div class="delete-reveal">
          <button type="button" class="delete-reveal-btn" @click="handleDeleteLine(line.productId)">حذف</button>
        </div>

        <!-- Row (slides on swipe) -->
        <div
          :class="['line-row', swipedProductId === line.productId ? 'line-row-swiped' : '']"
        >
          <div class="line-info">
            <p class="line-name">{{ line.nameAr }}</p>
            <p class="line-unit">${{ line.unitPriceUsd.toFixed(2) }}</p>
          </div>

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
              @click="store.updateQuantity(line.productId, line.quantity + 1)"
            >+</button>
          </div>

          <span class="line-total">${{ line.lineTotalUsd.toFixed(2) }}</span>
        </div>
      </div>
    </div>

    <!-- Totals + Pay -->
    <div class="panel-footer">
      <div class="total-row">
        <span class="total-label">المجموع</span>
        <span class="total-usd">${{ store.totalUsd.toFixed(2) }}</span>
      </div>
      <div v-if="totalSyp !== null" class="total-syp-row">
        <span class="total-syp-label">بالليرة</span>
        <span class="total-syp-value">{{ totalSyp.toLocaleString() }} ل.س</span>
      </div>

      <button
        type="button"
        :disabled="store.lines.length === 0"
        class="pay-btn"
        @click="emit('pay')"
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
        دفع
      </button>
    </div>
  </div>

  <AppDialog
    v-if="showClearDialog"
    title="مسح البيع"
    message="متأكد من حذف البيع؟"
    confirm-label="نعم"
    cancel-label="لا"
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
  background: linear-gradient(180deg, rgba(26,86,219,0.08) 0%, rgba(7,11,20,0.98) 100%);
  border-inline-end: 1px solid rgba(26,86,219,0.18);
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* Header */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(26,86,219,0.16);
  background: rgba(26,86,219,0.08);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: #E8EDF5;
}

.panel-header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.item-count {
  font-size: 12px;
  color: #637285;
}

.clear-btn {
  font-size: 12px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #EF4444;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.22);
  border-radius: 8px;
  padding: 3px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.clear-btn:hover {
  background: rgba(239,68,68,0.14);
}

/* Lines list */
.lines-list {
  flex: 1;
  overflow-y: auto;
}

.lines-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
  text-align: center;
}

.lines-empty-text {
  font-size: 13px;
  color: #3D4F6B;
}

/* Line item */
.line-wrap {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid rgba(26,86,219,0.10);
}

.delete-reveal {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(239,68,68,0.80), rgba(239,68,68,0.60));
}

.delete-reveal-btn {
  width: 100%;
  height: 100%;
  font-size: 13px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: transparent;
  border: none;
  cursor: pointer;
}

.line-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: transparent;
  transition: transform 0.2s;
}

.line-row-swiped {
  transform: translateX(-72px);
}

/* RTL: swipe in the correct direction */
[dir="rtl"] .line-row-swiped {
  transform: translateX(72px);
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
  margin: 0;
}

.line-unit {
  font-size: 11px;
  color: #637285;
  margin: 2px 0 0;
}

/* Qty controls */
.qty-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.qty-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 500;
  background: rgba(26,86,219,0.14);
  border: 1px solid rgba(26,86,219,0.28);
  color: #60A5FA;
  cursor: pointer;
  transition: background 0.12s, transform 0.1s;
}

.qty-btn:hover {
  background: rgba(26,86,219,0.22);
}

.qty-btn:active {
  transform: scale(0.90);
}

.qty-value {
  font-size: 14px;
  font-weight: 700;
  color: #E8EDF5;
  min-width: 20px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.line-total {
  font-size: 13px;
  font-weight: 700;
  color: #60A5FA;
  min-width: 56px;
  text-align: left;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* Footer */
.panel-footer {
  padding: 14px 16px;
  border-top: 1px solid rgba(26,86,219,0.18);
  background: rgba(26,86,219,0.06);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.total-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.total-label {
  font-size: 13px;
  color: #637285;
}

.total-usd {
  font-size: 18px;
  font-weight: 800;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
}

.total-syp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: -2px;
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
  height: 48px;
  margin-top: 6px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  box-shadow: 0 4px 20px rgba(26,86,219,0.45);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.pay-btn:hover:not(:disabled) {
  opacity: 0.90;
}

.pay-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.pay-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
