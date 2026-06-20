<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useCustomerBalance } from '@/features/customers/composables/useCustomerBalance'
<<<<<<< Updated upstream
import type { OpenInvoice, PaymentAllocation } from '@/features/customers/customer.types'
=======
import type { OpenInvoice, PaymentAllocation, PaymentMethod } from '@/features/customers/customer.types'
import BaseModal from '@/components/ui/BaseModal.vue'
>>>>>>> Stashed changes

const props = defineProps<{
  customerId:   string
  customerName: string
  openInvoices: OpenInvoice[]
}>()

const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>()

const { currentRate }   = useExchangeRate()
const { recordPayment } = useCustomerBalance(props.customerId)

const currency    = ref<'USD' | 'SYP'>('USD')
const method      = ref<PaymentMethod>('cash')
// Use array instead of Set for Vue 3 reactivity
const selectedIds = ref<string[]>([])

// Only cash collections enter the drawer; the rest are tracked for the ledger.
const methodOptions: { value: PaymentMethod; label: string }[] = [
  { value: 'cash',     label: 'نقداً' },
  { value: 'transfer', label: 'حوالة بنكية' },
  { value: 'usdt',     label: 'USDT' },
  { value: 'hawala',   label: 'حوالة' },
]

// Invoice remaining expressed in the currently selected currency.
function remainingIn(inv: OpenInvoice): number {
  if (currency.value === 'USD') return inv.remainingUsd
  return currentRate.value ? Math.round(inv.remainingUsd * currentRate.value) : inv.remainingUsd
}

const amounts = ref<Record<string, number>>(
  Object.fromEntries(props.openInvoices.map(inv => [inv.saleId, remainingIn(inv)]))
)

// When the cashier switches currency, re-seed the prefilled amounts in that currency —
// otherwise a USD figure (e.g. 160) gets reinterpreted as 160 SYP.
watch(currency, () => {
  amounts.value = Object.fromEntries(props.openInvoices.map(inv => [inv.saleId, remainingIn(inv)]))
})

const saving = ref(false)

function isSelected(saleId: string): boolean {
  return selectedIds.value.includes(saleId)
}

function toggleInvoice(saleId: string) {
  if (isSelected(saleId)) {
    selectedIds.value = selectedIds.value.filter(id => id !== saleId)
  } else {
    selectedIds.value = [...selectedIds.value, saleId]
  }
}

const totalUsd = computed(() => {
  let total = 0
  for (const saleId of selectedIds.value) {
    const raw = amounts.value[saleId] ?? 0
    total += currency.value === 'USD' ? raw : (currentRate.value ? raw / currentRate.value : raw)
  }
  return total
})

const hasSelection = computed(() => selectedIds.value.length > 0)

async function handleConfirm() {
  if (!hasSelection.value) return
  saving.value = true
  try {
    const allocations: PaymentAllocation[] = []
    for (const saleId of selectedIds.value) {
      const raw = amounts.value[saleId] ?? 0
      const amountUsd = currency.value === 'USD'
        ? raw
        : (currentRate.value ? raw / currentRate.value : raw)
      allocations.push({
        saleId,
        amountUsd,
        currency:              currency.value,
        amountRaw:             raw,
        method:                method.value,
        exchangeRateAtPayment: currentRate.value ?? undefined,
      })
    }
    await recordPayment(allocations)
    emit('saved')
  } finally {
    saving.value = false
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <Teleport to="body">
    <div
      class="modal-overlay"
      @click.self="emit('cancel')"
    >
      <div class="sheet-container" dir="rtl">
        <!-- Handle -->
        <div class="sheet-handle"></div>

        <!-- Header -->
        <div class="sheet-header">
          <div>
            <h2 class="sheet-title">تسجيل دفعة</h2>
            <p class="sheet-subtitle">{{ customerName }}</p>
          </div>
          <button type="button" class="close-btn" @click="emit('cancel')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Currency toggle -->
        <div class="currency-toggle">
          <button
            type="button"
            class="currency-btn"
            :class="{ 'currency-btn--active': currency === 'USD' }"
            @click="currency = 'USD'"
          >USD</button>
          <button
            type="button"
            class="currency-btn"
            :class="{ 'currency-btn--active': currency === 'SYP' }"
            @click="currency = 'SYP'"
          >SYP</button>
        </div>

<<<<<<< Updated upstream
        <!-- Invoice list -->
=======
      <!-- Payment method -->
      <p class="section-label">طريقة الدفع</p>
      <div class="method-wrap">
        <button
          v-for="opt in methodOptions"
          :key="opt.value"
          type="button"
          :data-testid="`method-${opt.value}`"
          class="method-btn"
          :class="{ 'method-btn--active': method === opt.value }"
          @click="method = opt.value"
        >{{ opt.label }}</button>
      </div>
      <p v-if="method !== 'cash'" class="method-note">لن تُحتسب ضمن نقد الصندوق</p>

      <!-- Invoice list -->
      <p class="section-label">الفواتير المفتوحة</p>
      <div class="invoice-list-wrap">
>>>>>>> Stashed changes
        <div class="invoice-list">
          <div
            v-for="inv in openInvoices"
            :key="inv.saleId"
            :data-testid="`invoice-${inv.saleId}`"
            class="invoice-row"
            :class="{ 'invoice-row--selected': isSelected(inv.saleId) }"
            @click="toggleInvoice(inv.saleId)"
          >
            <!-- Checkbox -->
            <button
              type="button"
              :data-testid="`checkbox-${inv.saleId}`"
              class="checkbox"
              :class="{ 'checkbox--checked': isSelected(inv.saleId) }"
              @click.stop="toggleInvoice(inv.saleId)"
            >
              <svg v-if="isSelected(inv.saleId)" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>

            <!-- Info -->
            <div class="invoice-info">
              <div class="invoice-top-row">
                <span class="invoice-number">{{ inv.displayNumber }}</span>
                <span class="invoice-date">{{ formatDate(inv.saleDate) }}</span>
              </div>
              <p class="invoice-summary">{{ inv.itemsSummary }}</p>
            </div>

            <!-- Amount -->
            <div class="invoice-amount-col">
              <input
                v-if="isSelected(inv.saleId)"
                :data-testid="`amount-${inv.saleId}`"
                type="number"
                min="0.01"
                :max="remainingIn(inv)"
                step="0.01"
                :value="amounts[inv.saleId]"
                class="amount-input"
                @click.stop
                @input="amounts[inv.saleId] = parseFloat(($event.target as HTMLInputElement).value) || 0"
              />
              <span v-else class="invoice-remaining">${{ inv.remainingUsd.toFixed(2) }}</span>
            </div>
          </div>
        </div>

        <!-- Total row -->
        <div class="total-row">
          <span class="total-label">إجمالي الدفعة</span>
          <span class="total-amount">${{ totalUsd.toFixed(2) }}</span>
        </div>

        <!-- Action buttons -->
        <div class="actions">
          <button
            type="button"
            data-testid="confirm-btn"
            :disabled="!hasSelection || saving"
            class="btn-confirm"
            @click="handleConfirm"
          >{{ saving ? '...' : 'تأكيد الدفعة' }}</button>

          <button
            type="button"
            data-testid="cancel-btn"
            class="btn-ghost"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay ─────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Sheet ───────────────────────────────────────────────── */
.sheet-container {
  width: 100%;
  max-width: 32rem;
  border-radius: 1.25rem 1.25rem 0 0;
  padding: 0 1.25rem 1.5rem;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.45);
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}

/* ── Handle ──────────────────────────────────────────────── */
.sheet-handle {
  width: 2.25rem;
  height: 0.25rem;
  background: rgba(255,255,255,0.20);
  border-radius: 9999px;
  margin: 0.75rem auto 1rem;
}

/* ── Header ──────────────────────────────────────────────── */
.sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.sheet-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.sheet-subtitle {
  font-size: 0.875rem;
  color: #637285;
  margin-top: 0.125rem;
}

.close-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  background: rgba(255,255,255,0.06);
  border: none;
  cursor: pointer;
  transition: background 0.12s;
  flex-shrink: 0;
}

.close-btn:hover { background: rgba(255,255,255,0.10); }

/* ── Currency toggle ─────────────────────────────────────── */
.currency-toggle {
  display: flex;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 0.75rem;
  padding: 0.25rem;
  gap: 0.25rem;
  width: fit-content;
  margin-bottom: 1rem;
}

.currency-btn {
  padding: 0.375rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  color: #637285;
  background: transparent;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}

.currency-btn--active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  box-shadow: 0 2px 8px rgba(26,86,219,0.40);
}

/* ── Payment method ──────────────────────────────────────── */
.method-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.22);
  border-radius: 0.75rem;
  padding: 0.25rem;
  width: fit-content;
  margin-bottom: 0.5rem;
}

.method-btn {
  padding: 0.375rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  color: #93A3B8;
  background: transparent;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}

.method-btn--active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  box-shadow: 0 2px 8px rgba(26,86,219,0.40);
}

.method-note {
  margin: 0 0 0.9rem;
  font-size: 0.68rem;
  color: #F59E0B;
}

/* ── Invoice list ────────────────────────────────────────── */
.invoice-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
  max-height: 13rem;
  overflow-y: auto;
}

.invoice-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.invoice-row--selected {
  border-color: rgba(26,86,219,0.55);
  background: rgba(26,86,219,0.10);
}

/* ── Checkbox ────────────────────────────────────────────── */
.checkbox {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 0.375rem;
  border: 2px solid rgba(255,255,255,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: transparent;
  cursor: pointer;
  color: #fff;
  transition: background 0.12s, border-color 0.12s;
}

.checkbox--checked {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border-color: #1A56DB;
  box-shadow: 0 2px 8px rgba(26,86,219,0.40);
}

/* ── Invoice info ────────────────────────────────────────── */
.invoice-info { flex: 1; min-width: 0; }

.invoice-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.invoice-number {
  font-size: 0.75rem;
  font-weight: 600;
  color: #E8EDF5;
}

.invoice-date { font-size: 0.75rem; color: #637285; }

.invoice-summary {
  font-size: 0.75rem;
  color: #637285;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 0.125rem;
}

/* ── Invoice amount column ───────────────────────────────── */
.invoice-amount-col { flex-shrink: 0; }

.invoice-remaining {
  font-size: 0.75rem;
  font-weight: 600;
  color: #F59E0B;
}

.amount-input {
  width: 5rem;
  text-align: center;
  font-size: 0.875rem;
  font-weight: 600;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 0.5rem;
  padding: 0.25rem 0.5rem;
  color: #E8EDF5;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}

.amount-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.20);
}

/* ── Total row ───────────────────────────────────────────── */
.total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-top: 1px solid rgba(26,86,219,0.14);
  margin-bottom: 1rem;
}

.total-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

.total-amount {
  font-size: 1rem;
  font-weight: 800;
  color: #22C55E;
}

/* ── Actions ─────────────────────────────────────────────── */
.actions { display: flex; gap: 0.5rem; }

/* ── Confirm button ──────────────────────────────────────── */
.btn-confirm {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
  transition: opacity 0.15s, box-shadow 0.15s, transform 0.1s;
  font-family: inherit;
}

.btn-confirm:hover { opacity: 0.88; box-shadow: 0 6px 24px rgba(26,86,219,0.55); }
.btn-confirm:active { transform: scale(0.98); }
.btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Ghost button ────────────────────────────────────────── */
.btn-ghost {
  height: 44px;
  padding-inline: 1.25rem;
  border-radius: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.18);
  color: #E8EDF5;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.12s;
  font-family: inherit;
}

.btn-ghost:hover { background: rgba(255,255,255,0.06); }
</style>
