<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useInvoiceDetail } from '@/features/customers/composables/useInvoiceDetail'
import type { OpenInvoice } from '@/features/customers/customer.types'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps<{ invoice: OpenInvoice }>()
const emit  = defineEmits<{ (e: 'close'): void }>()

const { lines, payments, loading, load } = useInvoiceDetail()

const paidUsd = computed(() =>
  Math.max(0, props.invoice.totalUsd - props.invoice.remainingUsd)
)

onMounted(() => load(props.invoice.saleId))

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <BaseModal
    title="تفاصيل الفاتورة"
    @close="emit('close')"
  >
    <div class="sheet-body" dir="rtl" data-testid="invoice-detail-sheet">
      <div class="invoice-meta">
        <h3 class="sheet-title">{{ invoice.displayNumber }}</h3>
        <p class="sheet-subtitle">{{ formatDate(invoice.saleDate) }}</p>
      </div>

        <!-- Line items -->
        <p class="section-label">المنتجات</p>
        <div v-if="loading" class="state-muted">جارٍ التحميل...</div>
        <div v-else-if="lines.length === 0" class="state-muted">لا توجد تفاصيل</div>
        <div v-else class="lines-list">
          <div v-for="(line, i) in lines" :key="i" class="line-row">
            <div class="line-info">
              <p class="line-name">{{ line.nameAr }}</p>
              <p class="line-unit">${{ line.unitPriceUsd.toFixed(2) }} × {{ line.quantity }}</p>
            </div>
            <span class="line-total" dir="ltr">${{ line.lineTotalUsd.toFixed(2) }}</span>
          </div>
        </div>

        <!-- Totals -->
        <div class="totals-block">
          <div class="total-line">
            <span class="total-line-label">المجموع</span>
            <span class="total-line-value" dir="ltr">${{ invoice.totalUsd.toFixed(2) }}</span>
          </div>
          <div class="total-line">
            <span class="total-line-label">المدفوع</span>
            <span class="total-line-value paid" dir="ltr">${{ paidUsd.toFixed(2) }}</span>
          </div>
          <div class="total-line total-line--strong">
            <span class="total-line-label">المتبقي</span>
            <span class="total-line-value remaining" dir="ltr">${{ invoice.remainingUsd.toFixed(2) }}</span>
          </div>
        </div>

        <!-- Payments against this invoice -->
        <template v-if="payments.length > 0">
          <p class="section-label">الدفعات على هذه الفاتورة</p>
          <div class="lines-list">
            <div v-for="p in payments" :key="p.id" class="payment-row">
              <span class="line-unit">{{ formatDate(p.paidAt) }}</span>
              <span class="payment-amount" dir="ltr">+${{ p.amountUsd.toFixed(2) }}</span>
            </div>
          </div>
        </template>
    </div>
  </BaseModal>
</template>

<style scoped>
.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 0;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.invoice-meta {
  margin-bottom: 0.95rem;
}

.sheet-title {
  font-size: 0.95rem;
  font-weight: 800;
  color: #E8EDF5;
  margin: 0;
}

.sheet-subtitle {
  font-size: 0.78rem;
  color: #9FB0C7;
  margin-top: 0.125rem;
}

/* ── Section label ───────────────────────────────────────── */
.section-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #9FB0C7;
  margin: 0 0 0.5rem;
  padding-inline-start: 0.125rem;
}

.state-muted {
  font-size: 0.8125rem;
  color: #637285;
  padding: 0.5rem 0;
}

/* ── Lines ───────────────────────────────────────────────── */
.lines-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.line-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.20);
}

.line-info { min-width: 0; flex: 1; }

.line-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.line-unit {
  font-size: 0.6875rem;
  color: #637285;
  margin: 0.125rem 0 0;
}

.line-total {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #60A5FA;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* ── Totals ──────────────────────────────────────────────── */
.totals-block {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.875rem 0;
  border-top: 1px solid rgba(26,86,219,0.18);
  margin-bottom: 1.25rem;
}

.total-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.total-line-label { font-size: 0.8125rem; color: #637285; }

.total-line-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
}

.total-line-value.paid { color: #22C55E; }

.total-line--strong .total-line-label {
  font-weight: 700;
  color: #E8EDF5;
}

.total-line-value.remaining {
  font-size: 1rem;
  font-weight: 800;
  color: #F59E0B;
}

/* ── Payments ────────────────────────────────────────────── */
.payment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(255,255,255,0.07);
}

.payment-amount {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #22C55E;
  font-variant-numeric: tabular-nums;
}
</style>
