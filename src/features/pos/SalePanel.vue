<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import AppDialog from '@/components/ui/AppDialog.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { db } from '@/data/powersync/db'

const emit = defineEmits<{ (e: 'pay'): void }>()
const store = useSaleStore()

const totalSyp = computed(() => {
  const rate = store.lockedExchangeRate
  if (rate === null) return null
  return Math.round(store.totalUsd * rate)
})

const totalProfitUsd = computed(() =>
  store.lines.reduce((sum, line) => {
    const unitCost = line.unitCostUsd ?? 0
    return sum + (line.unitPriceUsd - unitCost) * line.quantity
  }, 0)
)

const showClearDialog = ref(false)

type PreviewData = {
  productId: string
  nameAr: string
  salePriceUsd: number
  listPriceUsd: number | null
  costPriceUsd: number
  stockQty: number | null
  barcode: string | null
  category: string | null
}

const previewOpen = ref(false)
const previewLoading = ref(false)
const previewData = ref<PreviewData | null>(null)

const SWIPE_REMOVE_THRESHOLD_PX = 72
const SWIPE_MAX_OFFSET_PX = 120
const SWIPE_MAX_VERTICAL_DRIFT_PX = 26

const lineOffsets = ref<Record<string, number>>({})
const activeSwipe = ref<{
  productId: string
  pointerId: number
  startX: number
  startY: number
} | null>(null)

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('button, input, textarea, select, a, label'))
}

function onLinePointerDown(productId: string, event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (isInteractiveTarget(event.target)) return
  activeSwipe.value = {
    productId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
  }
  lineOffsets.value = { ...lineOffsets.value, [productId]: 0 }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function onLinePointerMove(productId: string, event: PointerEvent) {
  const swipe = activeSwipe.value
  if (!swipe || swipe.productId !== productId || swipe.pointerId !== event.pointerId) return

  const deltaX = event.clientX - swipe.startX
  const deltaY = Math.abs(event.clientY - swipe.startY)

  if (deltaY > SWIPE_MAX_VERTICAL_DRIFT_PX && deltaY > Math.abs(deltaX)) {
    lineOffsets.value = { ...lineOffsets.value, [productId]: 0 }
    activeSwipe.value = null
    return
  }

  const offset = Math.max(-SWIPE_MAX_OFFSET_PX, Math.min(0, deltaX))
  lineOffsets.value = { ...lineOffsets.value, [productId]: offset }
}

function resetLineOffset(productId: string) {
  lineOffsets.value = { ...lineOffsets.value, [productId]: 0 }
}

function onLinePointerUp(productId: string, event: PointerEvent) {
  const swipe = activeSwipe.value
  if (!swipe || swipe.productId !== productId || swipe.pointerId !== event.pointerId) return

  const offset = lineOffsets.value[productId] ?? 0
  ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId)
  activeSwipe.value = null
  resetLineOffset(productId)

  if (offset <= -SWIPE_REMOVE_THRESHOLD_PX) {
    store.removeLine(productId)
  }
}

function onLinePointerCancel(productId: string, event: PointerEvent) {
  const swipe = activeSwipe.value
  if (!swipe || swipe.productId !== productId || swipe.pointerId !== event.pointerId) return
  ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId)
  activeSwipe.value = null
  resetLineOffset(productId)
}

function lineRowStyle(productId: string) {
  const offset = lineOffsets.value[productId] ?? 0
  const swiping = activeSwipe.value?.productId === productId
  return {
    transform: `translateX(${offset}px)`,
    transition: swiping ? 'none' : 'transform 0.16s ease-out, background 0.12s, border-color 0.12s',
  }
}

async function openProductPreview(line: (typeof store.lines)[number]) {
  previewOpen.value = true
  previewLoading.value = true
  previewData.value = {
    productId: line.productId,
    nameAr: line.nameAr,
    salePriceUsd: line.unitPriceUsd,
    listPriceUsd: line.listPriceUsd ?? null,
    costPriceUsd: line.unitCostUsd ?? 0,
    stockQty: line.availableStock ?? null,
    barcode: null,
    category: null,
  }

  try {
    const result = await db.execute(
      `SELECT name_ar, price_usd, cost_price_usd, current_stock, barcode, category
       FROM products WHERE id = ?`,
      [line.productId]
    )
    const row = (result as any).rows?._array?.[0]
    if (row && previewData.value?.productId === line.productId) {
      previewData.value = {
        productId: line.productId,
        nameAr: row.name_ar ?? line.nameAr,
        salePriceUsd: line.unitPriceUsd,
        listPriceUsd: row.price_usd ?? line.listPriceUsd ?? null,
        costPriceUsd: row.cost_price_usd ?? line.unitCostUsd ?? 0,
        stockQty: row.current_stock ?? line.availableStock ?? null,
        barcode: row.barcode ?? null,
        category: row.category ?? null,
      }
    }
  } finally {
    previewLoading.value = false
  }
}

function closeProductPreview() {
  previewOpen.value = false
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
      <div
        v-for="line in store.lines"
        :key="line.productId"
        :data-testid="`sale-line-${line.productId}`"
        class="line-row"
        :style="lineRowStyle(line.productId)"
        @pointerdown="onLinePointerDown(line.productId, $event)"
        @pointermove="onLinePointerMove(line.productId, $event)"
        @pointerup="onLinePointerUp(line.productId, $event)"
        @pointercancel="onLinePointerCancel(line.productId, $event)"
      >
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
            class="line-view"
            aria-label="عرض المنتج"
            @click="openProductPreview(line)"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <button
            type="button"
            class="line-delete"
            :data-testid="`line-delete-${line.productId}`"
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
        <div class="total-profit-row">
          <span class="total-profit-label">الربح</span>
          <span
            class="total-profit-value"
            :class="totalProfitUsd >= 0 ? 'profit-pos' : 'profit-neg'"
          >${{ totalProfitUsd.toFixed(2) }}</span>
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

  <BaseModal
    v-if="previewOpen"
    title="معلومات المنتج"
    @close="closeProductPreview"
  >
    <div v-if="previewLoading || !previewData" class="preview-loading">جارٍ التحميل...</div>
    <div v-else class="preview-body">
      <p class="preview-name">{{ previewData.nameAr }}</p>
      <div class="preview-grid">
        <div class="preview-item">
          <span class="preview-label">سعر البيع (في السلة)</span>
          <span class="preview-value" dir="ltr">${{ previewData.salePriceUsd.toFixed(2) }}</span>
        </div>
        <div class="preview-item">
          <span class="preview-label">سعر التكلفة</span>
          <span class="preview-value" dir="ltr">${{ previewData.costPriceUsd.toFixed(2) }}</span>
        </div>
        <div class="preview-item">
          <span class="preview-label">السعر المعتاد</span>
          <span class="preview-value" dir="ltr">
            {{ previewData.listPriceUsd !== null ? `$${previewData.listPriceUsd.toFixed(2)}` : '—' }}
          </span>
        </div>
        <div class="preview-item">
          <span class="preview-label">المخزون</span>
          <span class="preview-value">{{ previewData.stockQty !== null ? previewData.stockQty : '—' }}</span>
        </div>
        <div class="preview-item">
          <span class="preview-label">الفئة</span>
          <span class="preview-value">{{ previewData.category || '—' }}</span>
        </div>
        <div class="preview-item">
          <span class="preview-label">الباركود</span>
          <span class="preview-value" dir="ltr">{{ previewData.barcode || '—' }}</span>
        </div>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.panel-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0;
  padding-inline-end: 4px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.lines-list::-webkit-scrollbar {
  width: 10px;
}

.lines-list::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.lines-list::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.lines-list::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
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
  margin: 0 8px 8px;
  padding: 11px 12px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 10px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
  transition: background 0.12s, border-color 0.12s;
  touch-action: pan-y;
}

.line-row:hover {
  border-color: rgba(26,86,219,0.38);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(255,255,255,0.06));
}

.line-info {
  flex: 1;
  min-width: 0;
}

.line-name {
  font-size: 14px;
  font-weight: 600;
  color: #F1F5FB;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0 0 2px;
}

.line-unit {
  font-size: 12px;
  color: #9FB0C6;
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
  background: rgba(26,86,219,0.18);
  border: 1px solid rgba(26,86,219,0.40);
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
  background: rgba(26,86,219,0.16);
  border: 1px solid rgba(26,86,219,0.34);
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
  font-size: 15px;
  font-weight: 700;
  color: #F1F5FB;
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
  font-size: 14px;
  font-weight: 800;
  color: #93C5FD;
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
  color: #7E93AE;
  cursor: pointer;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
  flex-shrink: 0;
}

.line-delete:hover {
  color: #EF4444;
  background: rgba(239,68,68,0.10);
  border-color: rgba(239,68,68,0.22);
}

.line-view {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: #7E93AE;
  cursor: pointer;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
  flex-shrink: 0;
}

.line-view:hover {
  color: #60A5FA;
  background: rgba(26,86,219,0.10);
  border-color: rgba(26,86,219,0.26);
}

.preview-loading {
  color: #9FB0C6;
  font-size: 13px;
  padding: 8px 0;
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-name {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #E8EDF5;
}

.preview-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.preview-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-radius: 10px;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(255,255,255,0.03);
  padding: 8px 10px;
}

.preview-label {
  font-size: 12px;
  color: #637285;
}

.preview-value {
  font-size: 13px;
  font-weight: 700;
  color: #E8EDF5;
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

.total-profit-row {
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

.total-profit-label {
  font-size: 12px;
  color: #637285;
}

.total-profit-value {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.profit-pos { color: #22C55E; }
.profit-neg { color: #F87171; }

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
