<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import NumericKeypad from '@/components/ui/NumericKeypad.vue'
import CustomerPickerModal from '@/features/customers/components/CustomerPickerModal.vue'
import { usePayment } from './usePayment'
import { useSaleStore } from '@/store/sale.store'
import type { CompletedSale } from './payment.types'
import type { Customer } from '@/features/customers/customer.types'

const emit = defineEmits<{
  (e: 'confirmed', sale: CompletedSale): void
  (e: 'close'):                          void
}>()

const { state, method, amountReceived, totalUsd, totalSyp, changeDue, error, enteredUsd,
        selectMethod, back, cancel, confirm,
        pendingPayments, remainingUsd, isReadyToConfirm,
        canConfirmSingle, canAddLeg,
        addPayment, removeLastPayment } = usePayment()

const saleStore = useSaleStore()

const amountStr        = ref('')
const selectedCustomer = ref<Customer | null>(null)
const showPicker       = ref(false)

const displayAmount = computed(() => {
  if (!amountStr.value) return null
  return parseFloat(amountStr.value)
})

const showChangeDue = computed(() =>
  pendingPayments.value.length === 0 && changeDue.value !== null && changeDue.value > 0
)

const methodLabels: Record<string, string> = {
  cash_usd: 'نقدي دولار',
  cash_syp: 'نقدي ليرة',
  card:     'بطاقة',
}

function handleDigit(d: string) {
  if (d === '.' && amountStr.value.includes('.')) return
  amountStr.value += d
  amountReceived.value = displayAmount.value
}

function handleDelete() {
  amountStr.value = amountStr.value.slice(0, -1)
  amountReceived.value = displayAmount.value
}

// Wipe the whole entered amount in one tap (#2) — the value is keypad-driven,
// so there's no text field to select-and-delete.
function handleClearAmount() {
  amountStr.value = ''
  amountReceived.value = null
}

// Mirror the on-screen keypad on a physical keyboard so the amount can be typed
// on a laptop/tablet. The on-screen keypad stays the primary input on phones.
function handleKeydown(e: KeyboardEvent) {
  if (state.value !== 'amount-entry') return
  const k = e.key
  if (k >= '0' && k <= '9') {
    handleDigit(k)
  } else if (k === '.' || k === ',') {   // accept comma as a decimal separator too
    handleDigit('.')
  } else if (k === 'Backspace') {
    handleDelete()
  } else if (k === 'Enter') {
    handleConfirm()
  } else {
    return
  }
  e.preventDefault()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))

function handleSelectCredit() {
  selectMethod('credit')
  showPicker.value = true
}

function handleCustomerSelected(customer: Customer) {
  selectedCustomer.value = customer
  showPicker.value = false
}

function handleBack() {
  back()
  selectedCustomer.value = null
}

function handleCancel() {
  cancel()
  selectedCustomer.value = null
  emit('close')
}

function handleAddSplitPayment() {
  if (!canAddLeg.value) return
  const raw = displayAmount.value ?? 0
  addPayment(method.value as 'cash_usd' | 'cash_syp' | 'card', raw)
  amountStr.value      = ''
  amountReceived.value = null
  handleBack()
}

function handleAddCardSplitPayment() {
  addPayment('card', remainingUsd.value)
  handleBack()
}

async function handleConfirm(force = false) {
  // A credit (آجل) sale must be attributed to a customer — otherwise we record a
  // debt no one owns. Reopen the picker instead of completing the sale.
  if (method.value === 'credit' && !selectedCustomer.value) {
    showPicker.value = true
    return
  }
  // In split mode a card tender covers whatever is still owed — fold it in before confirming
  // so the card leg isn't dropped (confirm() settles from pendingPayments only).
  if (method.value === 'card' && pendingPayments.value.length > 0 && remainingUsd.value > 0.001) {
    addPayment('card', remainingUsd.value)
  }
  const canFinish = force ||
    method.value === 'card' || method.value === 'credit' ||
    canConfirmSingle.value || isReadyToConfirm.value
  if (!canFinish) return
  try {
    const sale = await confirm(selectedCustomer.value?.id)
    emit('confirmed', sale)
  } catch {
    // error is set in usePayment
  }
}

// Cash received exceeds the total. The cashier confirms the surplus is a higher
// sale price (not change): scale the cart up to the amount paid so it's recorded
// as revenue, then complete with no change.
async function confirmAsHigherPrice() {
  if (enteredUsd.value && enteredUsd.value > totalUsd.value) {
    saleStore.scalePricesToTotal(enteredUsd.value)
  }
  // This path is an explicit cashier decision: treat the extra cash as a higher
  // sale amount, then confirm even if post-scale rounding leaves canConfirmSingle false.
  await handleConfirm(true)
}
</script>

<template>
  <!-- Backdrop -->
  <div class="modal-backdrop" @click="state === 'method-selection' && handleCancel()" />

  <!-- Sheet wrapper -->
  <div class="modal-wrap" dir="rtl">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      class="modal-card"
    >

      <!-- ── Method selection ── -->
      <div v-if="state === 'method-selection'" class="state-pad">
        <div class="modal-top-bar">
          <button type="button" class="modal-back-btn" @click="handleCancel">رجوع إلى السلة</button>
          <button type="button" class="modal-cancel-btn" @click="handleCancel">إلغاء</button>
        </div>

        <h2 id="payment-modal-title" class="modal-heading">إجمالي البيع</h2>

        <div class="total-block">
          <p class="total-usd">${{ totalUsd.toFixed(2) }}</p>
          <p class="total-syp">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <!-- Pending payments -->
        <div
          v-if="pendingPayments.length > 0"
          class="pending-list"
          data-testid="pending-payments-list"
        >
          <div v-for="(entry, i) in pendingPayments" :key="i" class="pending-row">
            <div class="pending-method-wrap">
              <span>{{ methodLabels[entry.method] }}</span>
              <button
                v-if="i === pendingPayments.length - 1"
                type="button"
                class="remove-payment-btn"
                data-testid="remove-last-payment-btn"
                @click="removeLastPayment"
              >×</button>
            </div>
            <span class="pending-amount">${{ entry.amountUsd.toFixed(2) }}</span>
          </div>
          <div class="pending-remaining-row">
            <span>متبقي</span>
            <span :class="remainingUsd <= 0 ? 'remaining-zero' : 'remaining-nonzero'">
              ${{ remainingUsd.toFixed(2) }}
            </span>
          </div>
        </div>

        <!-- Ready-to-confirm (all split payments entered) -->
        <button
          v-if="isReadyToConfirm"
          type="button"
          class="confirm-btn confirm-btn-green"
          data-testid="confirm-split-btn"
          @click="handleConfirm()"
        >تأكيد البيع</button>

        <!-- Method tiles -->
        <template v-else>
          <div class="method-grid">
            <button
              v-for="m in [
                { key: 'cash_usd', label: 'نقدي دولار', icon: '💵' },
                { key: 'cash_syp', label: 'نقدي ليرة',  icon: '💴' },
                { key: 'card',     label: 'بطاقة',       icon: '💳' },
              ]"
              :key="m.key"
              type="button"
              class="method-tile"
              @click="selectMethod(m.key as any)"
            >
              <span class="method-tile-icon">{{ m.icon }}</span>
              <span class="method-tile-label">{{ m.label }}</span>
            </button>

            <button
              v-if="pendingPayments.length === 0"
              type="button"
              data-testid="credit-method-btn"
              :class="['method-tile', selectedCustomer ? 'method-tile-credit-sel' : 'method-tile-credit']"
              @click="handleSelectCredit"
            >
              <span class="method-tile-icon">📋</span>
              <span class="method-tile-label">آجل</span>
            </button>
          </div>

          <!-- Selected customer chip -->
          <div
            v-if="selectedCustomer && method === 'credit'"
            class="customer-chip"
          >
            <div>
              <p class="customer-chip-name">{{ selectedCustomer.name }}</p>
              <p v-if="selectedCustomer.phone" class="customer-chip-phone">{{ selectedCustomer.phone }}</p>
            </div>
            <button type="button" class="customer-chip-change" @click="showPicker = true">تغيير</button>
          </div>

          <button
            v-if="method === 'credit' && selectedCustomer"
            type="button"
            data-testid="confirm-credit-btn"
            class="confirm-btn confirm-btn-amber"
            @click="handleConfirm()"
          >تأكيد البيع الآجل</button>
        </template>

        <p v-if="error" class="modal-error">{{ error }}</p>
      </div>

      <!-- ── Amount entry (cash) ── -->
      <div v-else-if="state === 'amount-entry'" class="state-pad state-pad--amount">
        <div class="modal-top-bar">
          <button type="button" class="modal-back-btn" @click="handleBack">رجوع</button>
          <button type="button" class="modal-cancel-btn" @click="handleCancel">إلغاء</button>
        </div>

        <h2 id="payment-modal-title" class="modal-heading">المبلغ المستلم</h2>

        <div v-if="pendingPayments.length > 0" class="remaining-banner">
          <span class="remaining-banner-label">متبقي:</span>
          <span class="remaining-banner-value">${{ remainingUsd.toFixed(2) }}</span>
        </div>

        <div class="amount-ref-box">
          <p class="amount-ref-label">
            {{ method === 'cash_syp' ? 'المجموع بالليرة' : 'المجموع بالدولار' }}
          </p>
          <p class="amount-ref-value">
            {{ method === 'cash_syp'
                ? `${totalSyp.toLocaleString()} ل.س`
                : `$${totalUsd.toFixed(2)}` }}
          </p>
        </div>

        <div class="amount-input-box" :class="{ 'amount-input-box-error': amountStr && !canConfirmSingle && !canAddLeg }">
          <button v-if="amountStr" type="button" class="amount-clear-btn" aria-label="مسح المبلغ" @click="handleClearAmount">مسح</button>
          <p class="amount-input-value">{{ amountStr || '0' }}</p>
          <p v-if="showChangeDue" class="change-due-row">
            الباقي:
            {{ method === 'cash_syp'
                ? `${changeDue?.toLocaleString()} ل.س`
                : `$${changeDue?.toFixed(2)}` }}
          </p>
        </div>

        <p v-if="amountStr && !canConfirmSingle && !canAddLeg" class="modal-error">المبلغ غير كافٍ</p>

        <div class="keypad-wrap">
          <NumericKeypad
            :confirm-disabled="!canConfirmSingle"
            :hide-confirm="showChangeDue && pendingPayments.length === 0"
            @digit="handleDigit"
            @delete="handleDelete"
            @confirm="handleConfirm"
          />
        </div>

        <!-- Overpaid: was it change, or a higher sale price? Don't let the surplus vanish. -->
        <div v-if="showChangeDue && pendingPayments.length === 0" class="overpay-choice">
          <p class="overpay-q">المبلغ المدفوع أكبر من المطلوب —</p>
          <button
            type="button"
            class="overpay-btn overpay-btn-change"
            data-testid="confirm-change-btn"
            @click="handleConfirm()"
          >باقي للزبون ({{ method === 'cash_syp' ? `${changeDue?.toLocaleString()} ل.س` : `$${changeDue?.toFixed(2)}` }})</button>
          <button
            type="button"
            class="overpay-btn overpay-btn-price"
            data-testid="confirm-higher-price-btn"
            @click="confirmAsHigherPrice"
          >سعر بيع أعلى (سجّله كبيع كامل)</button>
        </div>

        <button
          v-if="canAddLeg"
          type="button"
          class="split-add-btn"
          data-testid="add-split-btn"
          @click="handleAddSplitPayment"
        >إضافة دفعة أخرى</button>

        <p v-if="error" class="modal-error">{{ error }}</p>
      </div>

      <!-- ── Card confirm ── -->
      <div v-else-if="state === 'card-confirm'" class="state-pad">
        <div class="modal-top-bar">
          <button type="button" class="modal-back-btn" @click="handleBack">رجوع</button>
          <button type="button" class="modal-cancel-btn" @click="handleCancel">إلغاء</button>
        </div>

        <h2 id="payment-modal-title" class="modal-heading">إجمالي البيع</h2>

        <div class="total-block">
          <p class="total-usd">${{ totalUsd.toFixed(2) }}</p>
          <p class="total-syp">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div class="card-info-box">
          <span class="card-info-icon">💳</span>
          <p class="card-info-label">بطاقة ائتمان / دفع</p>
          <p class="card-info-hint">سيتم تسجيل الدفع بالبطاقة</p>
        </div>

        <button type="button" class="confirm-btn confirm-btn-blue" @click="handleConfirm()">تأكيد</button>

        <button
          type="button"
          class="split-add-btn"
          data-testid="add-card-split-btn"
          @click="handleAddCardSplitPayment"
        >إضافة دفعة أخرى</button>
      </div>

      <!-- ── Credit confirm ── -->
      <div v-else-if="state === 'credit-confirm'" class="state-pad">
        <div class="modal-top-bar">
          <button type="button" class="modal-back-btn" @click="handleBack">رجوع</button>
          <button type="button" class="modal-cancel-btn" @click="handleCancel">إلغاء</button>
        </div>

        <h2 id="payment-modal-title" class="modal-heading">إجمالي البيع</h2>

        <div class="total-block">
          <p class="total-usd">${{ totalUsd.toFixed(2) }}</p>
          <p class="total-syp">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div v-if="selectedCustomer" class="customer-chip">
          <div>
            <p class="customer-chip-name">{{ selectedCustomer.name }}</p>
            <p v-if="selectedCustomer.phone" class="customer-chip-phone">{{ selectedCustomer.phone }}</p>
          </div>
          <button type="button" class="customer-chip-change" @click="showPicker = true">تغيير</button>
        </div>

        <!-- No customer chosen yet → must pick one before a credit sale can complete -->
        <button
          v-else
          type="button"
          class="confirm-btn confirm-btn-amber"
          data-testid="pick-credit-customer-btn"
          @click="showPicker = true"
        >اختر الزبون</button>

        <button
          type="button"
          class="confirm-btn confirm-btn-amber"
          data-testid="confirm-credit-btn"
          :disabled="!selectedCustomer"
          @click="handleConfirm()"
        >تأكيد البيع الآجل</button>
      </div>

      <!-- ── Confirming spinner ── -->
      <div v-else-if="state === 'confirming'" class="state-pad state-center">
        <div class="spinner" />
        <p class="spinner-label">جارٍ التأكيد...</p>
      </div>

    </div>
  </div>

  <CustomerPickerModal
    v-if="showPicker"
    @select="handleCustomerSelected"
    @cancel="showPicker = false"
  />
</template>

<style scoped>
/* ── Backdrop ──────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
}

/* ── Wrapper ───────────────────────────────────── */
.modal-wrap {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

@media (min-width: 640px) {
  .modal-wrap { align-items: center; }
}

/* ── Card ──────────────────────────────────────── */
.modal-card {
  width: 100%;
  max-width: 440px;
  max-height: 90dvh;
  overflow-y: auto;
  border-radius: 24px 24px 0 0;
  background: linear-gradient(180deg,
    rgba(26, 86, 219, 0.20) 0%,
    rgba(7, 11, 20, 0.99) 80px
  );
  border: 1px solid rgba(26, 86, 219, 0.32);
  border-bottom: none;
  box-shadow:
    0 -8px 48px rgba(26, 86, 219, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  font-family: 'Tajawal', system-ui, sans-serif;
  /* Keep it scrollable on short screens but hide the bar (#1). */
  scrollbar-width: none;
}
.modal-card::-webkit-scrollbar { display: none; }

@media (min-width: 640px) {
  .modal-card {
    border-radius: 20px;
    border-bottom: 1px solid rgba(26, 86, 219, 0.32);
    box-shadow:
      0 32px 80px rgba(0, 0, 0, 0.65),
      0 0 0 1px rgba(26, 86, 219, 0.18),
      0 0 40px rgba(26, 86, 219, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
}

/* ── State pads ────────────────────────────────── */
.state-pad {
  padding: 20px 20px 28px;
}

.state-pad--amount {
  padding-bottom: 18px;
}

.state-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 20px;
}

/* ── Top bar ───────────────────────────────────── */
.modal-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.state-pad--amount .modal-top-bar {
  margin-bottom: 14px;
}

.modal-cancel-btn {
  height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #FCA5A5;
  background: rgba(127, 29, 29, 0.22);
  border: 1px solid rgba(239, 68, 68, 0.35);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.modal-cancel-btn:hover {
  color: #FECACA;
  background: rgba(153, 27, 27, 0.30);
  border-color: rgba(248, 113, 113, 0.48);
}

.modal-back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #CFE0FF;
  background: rgba(26, 86, 219, 0.20);
  border: 1px solid rgba(59, 130, 246, 0.42);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.modal-back-btn:hover {
  color: #E3ECFF;
  background: rgba(26, 86, 219, 0.30);
  border-color: rgba(96, 165, 250, 0.58);
}

/* ── Heading ───────────────────────────────────── */
.modal-heading {
  font-size: 15px;
  font-weight: 600;
  color: #637285;
  text-align: center;
  margin: 0 0 10px;
}

.state-pad--amount .modal-heading {
  margin-bottom: 8px;
}

/* ── Total block ───────────────────────────────── */
.total-block {
  text-align: center;
  margin-bottom: 24px;
}

.total-usd {
  font-size: 40px;
  font-weight: 800;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  margin: 0;
  line-height: 1.1;
}

.total-syp {
  font-size: 15px;
  color: #637285;
  margin: 6px 0 0;
  font-variant-numeric: tabular-nums;
}

/* ── Pending payments list ─────────────────────── */
.pending-list {
  background: rgba(26, 86, 219, 0.08);
  border: 1px solid rgba(26, 86, 219, 0.18);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 16px;
}

.pending-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
  color: #C8D5E8;
}

.pending-method-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.remove-payment-btn {
  font-size: 18px;
  line-height: 1;
  color: #EF4444;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.pending-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pending-remaining-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid rgba(26, 86, 219, 0.16);
  margin-top: 8px;
  padding-top: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #E8EDF5;
}

.remaining-zero   { color: #22C55E; }
.remaining-nonzero { color: #E8EDF5; }

/* ── Method grid ───────────────────────────────── */
.method-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

/* ── Method tiles ──────────────────────────────── */
.method-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 84px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.12), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(26, 86, 219, 0.24);
  color: #E8EDF5;
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.1s;
}

.method-tile:hover {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.22), rgba(255, 255, 255, 0.06));
  border-color: rgba(26, 86, 219, 0.52);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.22);
}

.method-tile:active { transform: scale(0.95); }

.method-tile-icon {
  font-size: 24px;
  line-height: 1;
}

.method-tile-label {
  font-size: 14px;
  font-weight: 700;
}

.method-tile-credit {
  border-color: rgba(245, 158, 11, 0.28);
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.09), rgba(255, 255, 255, 0.02));
  color: #FCD34D;
}

.method-tile-credit:hover {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(255, 255, 255, 0.04));
  border-color: rgba(245, 158, 11, 0.50);
  box-shadow: 0 4px 20px rgba(245, 158, 11, 0.16);
}

.method-tile-credit-sel {
  border-color: rgba(245, 158, 11, 0.60);
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(245, 158, 11, 0.08));
  color: #FCD34D;
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.22);
}

/* ── Customer chip ─────────────────────────────── */
.customer-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.customer-chip-name {
  font-size: 14px;
  font-weight: 700;
  color: #FCD34D;
  margin: 0;
}

.customer-chip-phone {
  font-size: 12px;
  color: #D97706;
  margin: 2px 0 0;
}

.customer-chip-change {
  font-size: 12px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #D97706;
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
}

/* ── Confirm buttons ───────────────────────────── */
.confirm-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 52px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: none;
  cursor: pointer;
  margin-bottom: 8px;
  transition: opacity 0.15s, transform 0.1s;
}

.confirm-btn:hover:not(:disabled) { opacity: 0.90; }
.confirm-btn:active:not(:disabled) { transform: scale(0.98); }
.confirm-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.confirm-btn-blue {
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 6px 24px rgba(26, 86, 219, 0.52);
}

.confirm-btn-green {
  color: #fff;
  background: linear-gradient(135deg, #16A34A, #15803D);
  box-shadow: 0 6px 24px rgba(22, 163, 74, 0.40);
}

.confirm-btn-amber {
  color: #fff;
  background: linear-gradient(135deg, #D97706, #B45309);
  box-shadow: 0 6px 24px rgba(217, 119, 6, 0.40);
}

/* ── Split add button ──────────────────────────── */
.split-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 44px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #637285;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.10);
  cursor: pointer;
  margin-top: 8px;
  transition: color 0.15s, background 0.15s;
}

.split-add-btn:hover { color: #C8D5E8; background: rgba(255, 255, 255, 0.08); }

/* ── Amount entry ──────────────────────────────── */
.remaining-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(26, 86, 219, 0.10);
  border: 1px solid rgba(26, 86, 219, 0.20);
  font-size: 13px;
  margin-bottom: 12px;
}

.remaining-banner-label { color: #637285; }
.remaining-banner-value { font-weight: 700; color: #60A5FA; font-variant-numeric: tabular-nums; }

.amount-ref-box {
  background: rgba(26, 86, 219, 0.08);
  border: 1px solid rgba(26, 86, 219, 0.16);
  border-radius: 12px;
  padding: 10px 16px;
  text-align: center;
  margin-bottom: 8px;
}

.amount-ref-label {
  font-size: 12px;
  color: #637285;
  margin: 0 0 2px;
}

.amount-ref-value {
  font-size: 18px;
  font-weight: 700;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
  margin: 0;
}

.amount-input-box {
  position: relative;
  background: rgba(26, 86, 219, 0.10);
  border: 2px solid rgba(26, 86, 219, 0.42);
  border-radius: 12px;
  padding: 14px 16px;
  text-align: center;
  margin-bottom: 4px;
  transition: border-color 0.15s;
}

.amount-clear-btn {
  position: absolute;
  top: 8px;
  inset-inline-start: 10px;
  font-size: 12px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #637285;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.amount-clear-btn:hover { color: #E8EDF5; background: rgba(255, 255, 255, 0.12); }

.amount-input-box-error { border-color: rgba(239, 68, 68, 0.52); }

.amount-input-value {
  font-size: 36px;
  font-weight: 800;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
  font-family: monospace;
  margin: 0;
  letter-spacing: 0.02em;
}

.keypad-wrap {
  margin-top: 2px;
}

.keypad-wrap :deep(div.grid) {
  padding: 10px 6px 8px;
  gap: 0.4rem;
}

.keypad-wrap :deep(div.grid > button) {
  height: 2.9rem;
  border-radius: 0.72rem;
  font-size: 1.05rem;
}

.keypad-wrap :deep(div.grid > button[aria-label='تأكيد']) {
  height: 2.55rem;
  font-size: 0.95rem;
}

.change-due-row {
  font-size: 14px;
  font-weight: 700;
  color: #22C55E;
  margin: 6px 0 0;
}

/* ── Overpaid: change vs higher price ──────────────── */
.overpay-choice {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 4px 0;
}

.overpay-q {
  font-size: 12px;
  color: #637285;
  text-align: center;
  margin: 0;
}

.overpay-btn {
  height: 44px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 800;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.overpay-btn:active { transform: scale(0.98); }

.overpay-btn-change {
  color: #fff;
  background: linear-gradient(135deg, #16A34A, #15803D);
  box-shadow: 0 4px 16px rgba(22,163,74,0.35);
}

.overpay-btn-price {
  color: #CFE0FF;
  background: rgba(26, 86, 219, 0.22);
  border: 1px solid rgba(96, 165, 250, 0.45);
}

.overpay-btn-price:hover {
  color: #E3ECFF;
  background: rgba(26, 86, 219, 0.34);
  border-color: rgba(147, 197, 253, 0.65);
}

/* ── Card info box ─────────────────────────────── */
.card-info-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: rgba(26, 86, 219, 0.10);
  border: 1px solid rgba(26, 86, 219, 0.22);
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 16px;
  text-align: center;
}

.card-info-icon { font-size: 28px; }

.card-info-label {
  font-size: 15px;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0;
}

.card-info-hint {
  font-size: 12px;
  color: #637285;
  margin: 0;
}

/* ── Spinner ───────────────────────────────────── */
.spinner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid rgba(26, 86, 219, 0.22);
  border-top-color: #1A56DB;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.spinner-label {
  font-size: 14px;
  color: #637285;
}

/* ── Error ─────────────────────────────────────── */
.modal-error {
  text-align: center;
  font-size: 13px;
  color: #EF4444;
  margin-top: 8px;
}

@media (max-width: 430px) {
  .state-pad--amount {
    padding: 14px 14px 12px;
  }

  .amount-ref-box {
    padding: 8px 12px;
    margin-bottom: 6px;
  }

  .amount-input-box {
    padding: 11px 12px;
  }

  .amount-input-value {
    font-size: 30px;
  }

  .split-add-btn {
    height: 40px;
    margin-top: 6px;
  }

  .overpay-choice {
    gap: 6px;
    padding-top: 10px;
  }

  .overpay-btn {
    height: 42px;
    font-size: 13px;
  }
}
</style>
