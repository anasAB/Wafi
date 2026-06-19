<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useCustomerBalance } from '@/features/customers/composables/useCustomerBalance'
import type { OpenInvoice, PaymentAllocation } from '@/features/customers/customer.types'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps<{
  customerId:   string
  customerName: string
  openInvoices: OpenInvoice[]
}>()

const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>()

const { currentRate }   = useExchangeRate()
const { recordPayment } = useCustomerBalance(props.customerId)

const currency    = ref<'USD' | 'SYP'>('USD')
// Use array instead of Set for Vue 3 reactivity
const selectedIds = ref<string[]>([])

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
  <BaseModal
    title="تسجيل دفعة"
    @close="emit('cancel')"
  >
    <div class="sheet-body" dir="rtl">
      <p class="sheet-subtitle">{{ customerName }}</p>
      <p class="sheet-hint">اختر الفواتير وحدد المبلغ لكل فاتورة</p>

      <!-- Currency toggle -->
      <p class="section-label">عملة الدفع</p>
      <div class="currency-wrap">
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
      </div>

      <!-- Invoice list -->
      <p class="section-label">الفواتير المفتوحة</p>
      <div class="invoice-list-wrap">
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
  </BaseModal>
</template>

<style scoped>
/* ── Body ─────────────────────────────────────────────── */
.sheet-body {
  display: flex;
  flex-direction: column;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.sheet-subtitle {
  font-size: 0.78rem;
  color: #9FB0C7;
  margin: 0;
}

.sheet-hint {
  margin: 0.2rem 0 0.85rem;
  font-size: 0.72rem;
  color: #6F829E;
}

.section-label {
  margin: 0 0 0.45rem;
  padding-inline-start: 0.15rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: #9FB0C7;
}

/* ── Currency toggle ─────────────────────────────────────── */
.currency-wrap {
  margin-bottom: 0.9rem;
}

.currency-toggle {
  display: flex;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.22);
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
  color: #93A3B8;
  background: transparent;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}

.currency-btn--active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  box-shadow: 0 2px 8px rgba(26,86,219,0.40);
}

/* ── Invoice list ────────────────────────────────────────── */
.invoice-list-wrap {
  margin-bottom: 0.95rem;
  border-radius: 0.85rem;
  padding: 0.45rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.22);
}

.invoice-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  max-height: 13rem;
  overflow-y: auto;
}

.invoice-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(8, 14, 27, 0.72);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.invoice-row--selected {
  border-color: rgba(96,165,250,0.58);
  background: linear-gradient(135deg, rgba(26,86,219,0.24), rgba(26,86,219,0.12));
}

/* ── Checkbox ────────────────────────────────────────────── */
.checkbox {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 0.375rem;
  border: 2px solid rgba(147,163,184,0.45);
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
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(96,165,250,0.42);
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
  border-top: 1px solid rgba(26,86,219,0.20);
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
