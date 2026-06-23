<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePrinter } from '@/composables/usePrinter'
import AppToast from '@/components/ui/AppToast.vue'
import type { CompletedSale } from '@/features/payment/payment.types'
import { useDeviceStore } from '@/store/device.store'
import type { ReceiptData } from '@/composables/usePrinter'
import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'
import { loadCompletedSale } from './loadCompletedSale'
import { db } from '@/data/powersync/db'
import WhatsAppPreviewSheet from '@/features/messaging/components/WhatsAppPreviewSheet.vue'
import { useSendReceipt } from '@/features/messaging/useSendReceipt'

const router  = useRouter()
const route   = useRoute()
const device  = useDeviceStore()
const printer = usePrinter()
const toast   = ref<{ message: string; type: 'success' | 'error' } | null>(null)

// Fast path: the sale is handed over via history.state on navigation. On a reload
// or app-kill that state is gone (WAFI-030), so fall back to loading the sale by
// id from the route — the sale is persisted, so confirmation + reprint still work.
const sale = ref<CompletedSale | null>((history.state as any)?.sale ?? null)

onMounted(async () => {
  if (sale.value) return
  const id = route.query.id as string | undefined
  if (id) sale.value = await loadCompletedSale(id)
})

const methodLabels: Record<string, string> = {
  cash_usd: 'نقداً دولار',
  cash_syp: 'نقداً ليرة',
  card:     'بطاقة',
  credit:   'آجل',
  split:    'متعدد',
}

/** Build ReceiptData from the current sale — shared by print and WhatsApp paths. */
async function buildReceipt(): Promise<ReceiptData | null> {
  if (!sale.value) return null
  const s = sale.value
  const { settings, load } = useReceiptSettings()
  await load()
  return {
    saleId:                 s.saleId,
    displaySaleNumber:      s.displaySaleNumber,
    shopName:               settings.value.shopName || device.shopId,
    createdAt:              s.createdAt,
    lines:                  s.lines,
    totalUsd:               s.totalUsd,
    totalSyp:               s.totalSyp,
    exchangeRate:           s.exchangeRateAtSale,
    paymentMethod:          s.paymentMethod,
    amountReceived:         s.amountReceived,
    amountReceivedCurrency: s.amountReceivedCurrency,
    changeDue:              s.changeDue,
    taxNumber:              settings.value.taxNumber  || undefined,
    headerText:             settings.value.headerText || undefined,
    footerText:             settings.value.footerText || undefined,
    splitPayments:          s.splitPayments?.map(p => ({ method: p.method, amountUsd: p.amountUsd })),
  }
}

async function handlePrint() {
  const receipt = await buildReceipt()
  if (!receipt) return
  try {
    await printer.print(receipt)
    toast.value = { message: 'تم إرسال الفاتورة للطباعة', type: 'success' }
  } catch {
    toast.value = { message: `خطأ في الطباعة: ${printer.error.value}`, type: 'error' }
  }
}

// ── WhatsApp send ─────────────────────────────────────────────────────────────
const { prepare, send } = useSendReceipt()
const waSheetOpen   = ref(false)
const waSheetText   = ref('')
const waSheetPhone  = ref<string | null>(null)

async function handleWhatsApp() {
  const receipt = await buildReceipt()
  if (!receipt) return

  // Try to look up the customer's phone if this sale has a customerId
  let phoneRaw: string | undefined
  if (sale.value?.customerId) {
    try {
      const res = await db.execute(
        `SELECT phone, mobile FROM customers WHERE id = ? LIMIT 1`,
        [sale.value.customerId],
      )
      const row = ((res as any).rows._array as any[])[0]
      phoneRaw = (row?.phone || row?.mobile) ?? undefined
    } catch {
      // DB error → fall back to enter-number path
    }
  }

  const prepared = prepare(receipt, phoneRaw)
  waSheetText.value  = prepared.text
  waSheetPhone.value = prepared.phone
  waSheetOpen.value  = true
}

function onWaSend(payload: { phone: string; text: string }) {
  send(payload.phone, payload.text)
  waSheetOpen.value = false
  toast.value = { message: 'تم فتح واتساب', type: 'success' }
}
</script>

<template>
  <div class="confirm-root" dir="rtl">

    <!-- Success icon -->
    <div class="success-icon-wrap">
      <svg width="36" height="36" fill="none" stroke="#60A5FA" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </div>

    <h1 class="success-title">تم البيع بنجاح</h1>
    <p class="sale-number">{{ sale?.displaySaleNumber ?? '—' }}</p>

    <!-- Receipt card -->
    <div class="receipt-card">
      <div class="receipt-row">
        <span class="receipt-label">المجموع</span>
        <span class="receipt-value receipt-value-primary">${{ sale?.totalUsd.toFixed(2) }}</span>
      </div>
      <div class="receipt-row">
        <span class="receipt-label">بالليرة</span>
        <span class="receipt-value">{{ sale?.totalSyp.toLocaleString() }} ل.س</span>
      </div>
      <div class="receipt-divider" />
      <div class="receipt-row">
        <span class="receipt-label">طريقة الدفع</span>
        <span class="receipt-value">
          {{ sale ? (sale.paymentMethod === 'split' ? 'متعدد' : methodLabels[sale.paymentMethod]) : '—' }}
        </span>
      </div>

      <!-- Split breakdown -->
      <template v-if="sale?.splitPayments?.length">
        <div v-for="(entry, i) in sale.splitPayments" :key="i" class="receipt-row receipt-row-indent">
          <span class="receipt-label-muted">{{ methodLabels[entry.method] }}</span>
          <span class="receipt-value-muted">${{ entry.amountUsd.toFixed(2) }}</span>
        </div>
      </template>

      <div v-if="sale?.changeDue && sale.changeDue > 0" class="receipt-row">
        <span class="receipt-label">الباقي</span>
        <span class="receipt-value receipt-value-green">
          {{ sale.amountReceivedCurrency === 'SYP'
              ? `${sale.changeDue.toLocaleString()} ل.س`
              : `$${sale.changeDue.toFixed(2)}` }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button
        type="button"
        :disabled="printer.printing.value"
        class="btn-print"
        @click="handlePrint"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
        </svg>
        {{ printer.printing.value ? 'جارٍ الطباعة...' : 'طباعة الفاتورة' }}
      </button>

      <button
        type="button"
        class="btn-whatsapp"
        @click="handleWhatsApp"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M11.953 2C6.465 2 2 6.465 2 11.953c0 1.821.497 3.53 1.359 4.997L2 22l5.218-1.328A9.912 9.912 0 0011.953 22c5.488 0 9.953-4.465 9.953-9.953S17.441 2 11.953 2zm0 18.12a8.16 8.16 0 01-4.159-1.139l-.298-.177-3.098.789.812-3.006-.196-.31A8.12 8.12 0 013.84 11.953c0-4.476 3.638-8.12 8.113-8.12 4.476 0 8.12 3.644 8.12 8.12s-3.644 8.167-8.12 8.167z"/>
        </svg>
        إرسال الفاتورة عبر واتساب
      </button>

      <button type="button" class="btn-new-sale" @click="router.push('/pos')">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        بيع جديد
      </button>

      <button type="button" class="btn-ghost" @click="router.push('/history')">آخر المبيعات</button>
      <button type="button" class="btn-ghost" @click="router.push('/')">العودة للرئيسية</button>
    </div>

  </div>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />

  <WhatsAppPreviewSheet
    v-if="waSheetOpen"
    :text="waSheetText"
    :phone="waSheetPhone"
    @send="onWaSend"
    @cancel="waSheetOpen = false"
  />
</template>

<style scoped>
.confirm-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* Success icon */
.success-icon-wrap {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(26,86,219,0.25), rgba(26,86,219,0.10));
  border: 1px solid rgba(26,86,219,0.45);
  box-shadow: 0 0 40px rgba(26,86,219,0.30), inset 0 1px 0 rgba(255,255,255,0.10);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.success-title {
  font-size: 22px;
  font-weight: 800;
  color: #E8EDF5;
  margin: 0 0 8px;
  text-align: center;
}

.sale-number {
  font-size: 15px;
  font-weight: 700;
  color: #60A5FA;
  font-variant-numeric: tabular-nums;
  margin: 0 0 24px;
  letter-spacing: 0.04em;
}

/* Receipt card */
.receipt-card {
  width: 100%;
  max-width: 360px;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  border-radius: 18px;
  box-shadow: 0 4px 24px rgba(26,86,219,0.12), inset 0 1px 0 rgba(255,255,255,0.07);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
  text-align: right;
}

.receipt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.receipt-row-indent {
  padding-inline-start: 16px;
}

.receipt-label {
  font-size: 13px;
  color: #637285;
}

.receipt-label-muted {
  font-size: 12px;
  color: #3D4F6B;
}

.receipt-value {
  font-size: 13px;
  font-weight: 600;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
}

.receipt-value-primary {
  font-size: 17px;
  font-weight: 800;
  color: #60A5FA;
}

.receipt-value-green {
  color: #22C55E;
}

.receipt-value-muted {
  font-size: 12px;
  color: #637285;
  font-variant-numeric: tabular-nums;
}

.receipt-divider {
  height: 1px;
  background: rgba(26,86,219,0.16);
}

/* Actions */
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 360px;
}

.btn-print {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.16);
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn-print:hover:not(:disabled) { background: rgba(255,255,255,0.11); }
.btn-print:disabled { opacity: 0.50; cursor: not-allowed; }

.btn-whatsapp {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #25D366, #128C7E);
  border: none;
  box-shadow: 0 4px 20px rgba(37, 211, 102, 0.30);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.btn-whatsapp:hover  { opacity: 0.90; }
.btn-whatsapp:active { transform: scale(0.98); }

.btn-new-sale {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 800;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  box-shadow: 0 4px 20px rgba(26,86,219,0.45);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.btn-new-sale:hover { opacity: 0.90; }
.btn-new-sale:active { transform: scale(0.98); }

.btn-ghost {
  width: 100%;
  height: 42px;
  font-size: 13px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #C8D5E8;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.30);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.06);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s;
}

.btn-ghost:hover {
  color: #E8EDF5;
  border-color: rgba(26,86,219,0.46);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(255,255,255,0.05));
  box-shadow: 0 4px 16px rgba(26,86,219,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
}

.btn-ghost:focus-visible {
  outline: none;
  border-color: rgba(96,165,250,0.75);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.22), 0 4px 16px rgba(26,86,219,0.18);
}
</style>
