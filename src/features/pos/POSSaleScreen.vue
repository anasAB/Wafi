<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import ProductGrid from './ProductGrid.vue'
import ProductPickerCategoryChips from './components/ProductPickerCategoryChips.vue'
import SalePanel from './SalePanel.vue'
import { useSale, ExchangeRateNotSetError } from './useSale'
import { useExchangeRate } from '@/features/exchange-rate'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import { useSaleDraft } from '@/composables/useSaleDraft'
import PaymentModal from '@/features/payment/PaymentModal.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useSaleStore } from '@/store/sale.store'
import type { CompletedSale } from '@/features/payment/payment.types'

const router     = useRouter()
const { currentRate, loadRate } = useExchangeRate()
const sale       = useSale(currentRate)
const { scheduleSave, clearDraft } = useSaleDraft()
const scanner    = useBarcodeScan()
const saleStore  = useSaleStore()

// Leaving the POS abandons the cart — confirm first, then clear it so it doesn't
// silently reappear on return (#4). A completed sale already empties the cart,
// so checkout navigation passes straight through.
const showLeaveConfirm = ref(false)
const pendingTo = ref<string | null>(null)
let confirmedLeave = false

onBeforeRouteLeave((to) => {
  if (confirmedLeave || saleStore.lines.length === 0) return true
  pendingTo.value = to.fullPath
  showLeaveConfirm.value = true
  return false
})

async function confirmLeave() {
  confirmedLeave = true
  saleStore.clear()
  await clearDraft()
  showLeaveConfirm.value = false
  if (pendingTo.value) router.push(pendingTo.value)
}

function cancelLeave() {
  showLeaveConfirm.value = false
  pendingTo.value = null
}

const searchQuery   = ref('')
const selectedCategoryId    = ref<string | null>(null)
const selectedSubcategoryId = ref<string | null>(null)
const payOpen       = ref(false)
const toast         = ref<{ message: string; type: 'error' | 'success' | 'info' } | null>(null)

const cameraOpen    = ref(false)
const cameraError   = ref<'permission-denied' | null>(null)
const videoRef      = ref<HTMLVideoElement | null>(null)
let   stopCamera: (() => void) | null = null

onMounted(async () => {
  await loadRate()
  scanner.onScan(handleBarcode)
})

watch(currentRate, () => {
  // A mid-sale rate edit must NOT re-price the open cart (WAFI-002): the rate
  // locked at the first line holds for this sale. Surface the "next sale only"
  // notice instead — the cart total and its locked rate stay put.
  sale.checkRateChanged()
})

function onCategorySelect(categoryId: string | null, subcategoryId: string | null) {
  selectedCategoryId.value = categoryId
  selectedSubcategoryId.value = subcategoryId
}

async function handleProductTap(productId: string) {
  try {
    await sale.addLine(productId)
    scheduleSave()
  } catch (err) {
    // Map known domain errors to localized, actionable Arabic guidance.
    // The exchange-rate case tells the user exactly how to fix it (BUG-013/014).
    toast.value = {
      message: err instanceof ExchangeRateNotSetError
        ? 'حدّد سعر صرف الدولار من الأعلى قبل البدء في البيع'
        : err instanceof Error ? err.message : 'خطأ في الإضافة',
      type: 'error',
    }
  }
}

async function handleBarcode(barcode: string) {
  const productId = await sale.lookupByBarcode(barcode)
  if (productId) {
    await handleProductTap(productId)
  } else {
    toast.value = { message: 'الباركود غير معروف', type: 'error' }
  }
}

async function openCamera() {
  cameraOpen.value  = true
  cameraError.value = null
  await nextTick()
  try {
    stopCamera = await scanner.startCamera(videoRef.value!, async (barcode) => {
      closeCamera()
      await handleBarcode(barcode)
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      cameraError.value = 'permission-denied'
    } else {
      cameraOpen.value = false
      toast.value = { message: 'لا يمكن فتح الكاميرا', type: 'error' }
    }
  }
}

function closeCamera() {
  stopCamera?.()
  stopCamera        = null
  cameraOpen.value  = false
  cameraError.value = null
}

onUnmounted(() => {
  closeCamera()
  scanner.destroy()   // detach the scanner's global keydown listener (WAFI-032)
})

// The sale was persisted, but the installment plan that was supposed to go with
// it failed to save. Don't hide the completed sale (handlePaymentConfirmed still
// runs right after and navigates to the confirmation screen) — just remember the
// message so it can be handed over and shown there, since this screen unmounts
// before a locally-set toast would ever be seen.
let installmentPlanErrorMessage: string | null = null
function handleInstallmentPlanFailed(_sale: CompletedSale, message: string) {
  installmentPlanErrorMessage = message
}

function handlePaymentConfirmed(completedSale: CompletedSale) {
  // Sale is done (cart already cleared in usePayment) — skip the leave guard.
  confirmedLeave = true
  payOpen.value = false
  // Pass the sale via history.state (fast path) AND its id in the query, so a
  // reload on the confirmation screen can reload the sale by id (WAFI-030).
  // Vue Router's history `state` type requires an index signature; a structured
  // object is fine at runtime (it's serialized), so cast at this boundary.
  router.push({
    path: '/pos/confirmation',
    query: { id: completedSale.saleId },
    state: { sale: completedSale, installmentPlanError: installmentPlanErrorMessage } as any,
  })
  installmentPlanErrorMessage = null
}
</script>

<template>
  <div class="pos-root" dir="rtl">
    <AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/')" />

    <!-- Rate change notice -->
    <div v-if="sale.hasRateChangeNotice.value" class="rate-notice">
      تغيّر سعر الصرف — سيُطبق السعر الجديد على البيع التالي فقط
    </div>

    <!-- Body: products + sale panel -->
    <div class="pos-body">

      <!-- Product area -->
      <div class="products-area">
        <!-- Search bar -->
        <div class="search-bar">
          <div class="search-wrap">
            <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              v-model="searchQuery"
              type="search"
              placeholder="ابحث عن منتج أو باركود..."
              class="search-input"
              dir="rtl"
            />
          </div>

          <button
            v-if="scanner.cameraAvailable.value"
            type="button"
            aria-label="مسح بالكاميرا"
            class="camera-btn"
            @click="openCamera"
          >
            <svg class="camera-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <ProductPickerCategoryChips @select="onCategorySelect" />

        <div class="products-scroll">
          <ProductGrid
            :search-query="searchQuery"
            :selected-category-id="selectedCategoryId"
            :selected-subcategory-id="selectedSubcategoryId"
            @product-tap="handleProductTap"
          />
        </div>
      </div>

      <!-- Sale panel -->
      <div class="sale-area">
        <SalePanel @pay="payOpen = true" />
      </div>
    </div>
  </div>

  <!-- Camera overlay -->
  <div v-if="cameraOpen" class="camera-overlay">
    <div v-if="cameraError === 'permission-denied'" class="camera-denied">
      <div class="camera-denied-icon">
        <svg width="28" height="28" fill="none" stroke="#637285" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        </svg>
      </div>
      <p class="camera-denied-text">يجب السماح للكاميرا في إعدادات المتصفح</p>
      <button type="button" class="camera-retry-btn" @click="openCamera">حاول مرة أخرى</button>
    </div>
    <template v-else>
      <video ref="videoRef" class="camera-video" autoplay playsinline muted />
    </template>
    <button type="button" class="camera-cancel-btn" @click="closeCamera">إلغاء</button>
  </div>

  <PaymentModal
    v-if="payOpen"
    @confirmed="handlePaymentConfirmed"
    @installment-plan-failed="handleInstallmentPlanFailed"
    @close="payOpen = false"
  />

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />

  <!-- Confirm before abandoning a non-empty cart (#4) -->
  <AppDialog
    v-if="showLeaveConfirm"
    title="مغادرة البيع"
    message="ستُحذف العناصر الموجودة في السلة. هل تريد المغادرة؟"
    confirm-label="نعم، غادر"
    cancel-label="ابقَ"
    :danger="true"
    @confirm="confirmLeave"
    @cancel="cancelLeave"
  />
</template>

<style scoped>
.pos-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
  overflow: hidden;
}

/* Rate notice */
.rate-notice {
  padding: 8px 16px;
  font-size: 13px;
  color: #FCD34D;
  background: rgba(245,158,11,0.08);
  border-bottom: 1px solid rgba(245,158,11,0.22);
}

/* Layout */
.pos-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (min-width: 640px) {
  .pos-body {
    flex-direction: row;
  }
}

.products-area {
  display: flex;
  flex-direction: column;
  flex: 6;
  overflow: hidden;
  border-bottom: 1px solid rgba(26,86,219,0.14);
}

@media (min-width: 640px) {
  .products-area {
    border-bottom: none;
  }
}

.products-scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sale-area {
  flex: 4;
  min-height: 40vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (min-width: 640px) {
  .sale-area {
    min-height: 0;
  }
}

/* Search bar */
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid rgba(26,86,219,0.14);
  flex-shrink: 0;
}

.search-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 12px;
  margin: auto 0;
  width: 16px;
  height: 16px;
  color: #637285;
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  padding: 0 40px 0 12px;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input::placeholder { color: #3D4F6B; }

.search-input:focus {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.camera-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  color: #637285;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s, border-color 0.15s;
}

.camera-btn:hover {
  color: #60A5FA;
  border-color: rgba(26,86,219,0.35);
}

.camera-icon {
  width: 18px;
  height: 18px;
}

.search-filter-wrap {
  position: relative;
  width: 124px;
  flex-shrink: 0;
}

.search-filter-btn {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.22);
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  cursor: pointer;
  outline: none;
}

.search-filter-btn:hover {
  border-color: rgba(26,86,219,0.40);
}

.search-filter-btn:focus {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}

.search-filter-text {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.search-filter-chevron {
  color: #637285;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.search-filter-chevron-open {
  transform: rotate(180deg);
}

.search-filter-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  inset-inline-start: 0;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px;
  border-radius: 12px;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  border: 1px solid rgba(26,86,219,0.30);
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.search-filter-menu::-webkit-scrollbar {
  width: 10px;
}

.search-filter-menu::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.search-filter-menu::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.search-filter-menu::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.search-filter-item {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #E8EDF5;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  text-align: right;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-filter-item:hover {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.24);
}

.search-filter-item-active {
  background: linear-gradient(135deg, rgba(26,86,219,0.28), rgba(18,72,179,0.20));
  border-color: rgba(26,86,219,0.35);
  color: #FFFFFF;
}

@media (max-width: 420px) {
  .search-filter-wrap {
    width: 108px;
  }
}

/* Camera overlay */
.camera-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: #000;
  display: flex;
  flex-direction: column;
}

.camera-video {
  flex: 1;
  object-fit: cover;
  width: 100%;
}

.camera-denied {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
}

.camera-denied-icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  display: flex;
  align-items: center;
  justify-content: center;
}

.camera-denied-text {
  font-size: 14px;
  color: #C8D5E8;
  text-align: center;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.camera-retry-btn {
  height: 44px;
  padding-inline: 24px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  cursor: pointer;
}

.camera-cancel-btn {
  padding: 20px;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #C8D5E8;
  background: rgba(0,0,0,0.6);
  border: none;
  cursor: pointer;
  text-align: center;
}
</style>
