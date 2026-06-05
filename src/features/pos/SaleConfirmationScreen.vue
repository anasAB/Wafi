<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePrinter } from '@/composables/usePrinter'
import AppToast from '@/components/ui/AppToast.vue'
import type { CompletedSale } from '@/features/payment/payment.types'
import { useDeviceStore } from '@/store/device.store'
import type { ReceiptData } from '@/composables/usePrinter'
import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'

const router  = useRouter()
const device  = useDeviceStore()
const printer = usePrinter()
const toast   = ref<{ message: string; type: 'success' | 'error' } | null>(null)

const sale = (history.state as any)?.sale as CompletedSale | undefined

const methodLabels: Record<string, string> = {
  cash_usd: 'نقداً دولار',
  cash_syp: 'نقداً ليرة',
  card:     'بطاقة',
  credit:   'آجل',
  split:    'متعدد',
}

async function handlePrint() {
  if (!sale) return
  const { settings, load } = useReceiptSettings()
  await load()

  const receipt: ReceiptData = {
    saleId:                 sale.saleId,
    displaySaleNumber:      sale.displaySaleNumber,
    shopName:               settings.value.shopName || device.shopId,
    createdAt:              sale.createdAt,
    lines:                  sale.lines,
    totalUsd:               sale.totalUsd,
    totalSyp:               sale.totalSyp,
    exchangeRate:           sale.exchangeRateAtSale,
    paymentMethod:          sale.paymentMethod,
    amountReceived:         sale.amountReceived,
    amountReceivedCurrency: sale.amountReceivedCurrency,
    changeDue:              sale.changeDue,
    taxNumber:              settings.value.taxNumber  || undefined,
    headerText:             settings.value.headerText || undefined,
    footerText:             settings.value.footerText || undefined,
  }
  try {
    await printer.print(receipt)
    toast.value = { message: 'تم إرسال الفاتورة للطباعة', type: 'success' }
  } catch {
    toast.value = { message: `خطأ في الطباعة: ${printer.error.value}`, type: 'error' }
  }
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
  height: 40px;
  font-size: 13px;
  font-weight: 500;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #637285;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}

.btn-ghost:hover { color: #C8D5E8; }
</style>
