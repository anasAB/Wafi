<script setup lang="ts">
import { ref, computed } from 'vue'
import NumericKeypad from '@/components/ui/NumericKeypad.vue'
import CustomerPickerModal from '@/features/customers/components/CustomerPickerModal.vue'
import { usePayment } from './usePayment'
import type { CompletedSale } from './payment.types'
import type { Customer } from '@/features/customers/customer.types'

const emit = defineEmits<{
  (e: 'confirmed', sale: CompletedSale): void
  (e: 'close'):                          void
}>()

const { state, method, amountReceived, totalUsd, totalSyp, changeDue, error,
        selectMethod, back, cancel, confirm,
        pendingPayments, remainingUsd, isReadyToConfirm,
        addPayment, removeLastPayment } = usePayment()

const amountStr        = ref('')
const selectedCustomer = ref<Customer | null>(null)
const showPicker       = ref(false)

const displayAmount = computed(() => {
  if (!amountStr.value) return null
  return parseFloat(amountStr.value)
})

const amountSufficient = computed(() => {
  const amount = displayAmount.value
  if (amount === null || isNaN(amount)) return false
  // In split mode: any positive amount is sufficient
  if (pendingPayments.value.length > 0) return amount > 0
  // Single payment: must cover total
  if (method.value === 'cash_usd') return amount >= totalUsd.value
  if (method.value === 'cash_syp') return amount >= totalSyp.value
  return false
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
  if (!amountSufficient.value) return
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

async function handleConfirm() {
  if (method.value !== 'card' && method.value !== 'credit' && !amountSufficient.value) return
  try {
    const sale = await confirm(selectedCustomer.value?.id)
    emit('confirmed', sale)
  } catch {
    // error is set in usePayment
  }
}
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-40 bg-black/50" @click="state === 'method-selection' && handleCancel()" />

  <!-- Sheet -->
  <div class="fixed bottom-0 left-0 right-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-50">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      class="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90dvh] overflow-y-auto"
    >

      <!-- ── Method selection ── -->
      <div v-if="state === 'method-selection'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-blue-600 dark:text-blue-400" @click="handleCancel">
            إلغاء
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          إجمالي البيع
        </h2>

        <div class="mb-4 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <!-- Pending payments list -->
        <div
          v-if="pendingPayments.length > 0"
          data-testid="pending-payments-list"
          class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl"
          dir="rtl"
        >
          <div
            v-for="(entry, i) in pendingPayments"
            :key="i"
            class="flex justify-between items-center py-1 text-sm"
          >
            <div class="flex items-center gap-2">
              <span>{{ methodLabels[entry.method] }}</span>
              <button
                v-if="i === pendingPayments.length - 1"
                type="button"
                data-testid="remove-last-payment-btn"
                class="text-red-500 text-xs hover:text-red-700"
                @click="removeLastPayment"
              >×</button>
            </div>
            <span class="font-semibold">${{ entry.amountUsd.toFixed(2) }}</span>
          </div>
          <div class="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 flex justify-between text-sm font-semibold">
            <span dir="rtl">متبقي</span>
            <span :class="remainingUsd <= 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'">
              ${{ remainingUsd.toFixed(2) }}
            </span>
          </div>
        </div>

        <!-- Confirm split button (when all paid) -->
        <button
          v-if="isReadyToConfirm"
          type="button"
          data-testid="confirm-split-btn"
          class="w-full h-12 rounded-xl bg-green-600 text-white font-semibold active:scale-95 transition-all mb-3"
          @click="handleConfirm"
        >تأكيد البيع</button>

        <!-- Method tiles (hidden when ready to confirm) -->
        <template v-else>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <button
              v-for="m in [
                { key: 'cash_usd', label: 'نقدي دولار' },
                { key: 'cash_syp', label: 'نقدي ليرة' },
                { key: 'card',     label: 'بطاقة' },
              ]"
              :key="m.key"
              type="button"
              class="py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-blue-500 hover:text-blue-600 active:scale-95 transition-all"
              @click="selectMethod(m.key as any)"
            >{{ m.label }}</button>

            <!-- Credit tile (only in single-payment mode) -->
            <button
              v-if="pendingPayments.length === 0"
              type="button"
              data-testid="credit-method-btn"
              class="py-4 rounded-xl border-2 text-sm font-medium active:scale-95 transition-all"
              :class="selectedCustomer
                ? 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-900/20'
                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-amber-400 hover:text-amber-600'"
              @click="handleSelectCredit"
            >📋 آجل</button>
          </div>

          <!-- Selected customer chip (credit only) -->
          <div
            v-if="selectedCustomer && method === 'credit'"
            class="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex items-center justify-between"
            dir="rtl"
          >
            <div>
              <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">{{ selectedCustomer.name }}</p>
              <p v-if="selectedCustomer.phone" class="text-xs text-amber-600 dark:text-amber-400">{{ selectedCustomer.phone }}</p>
            </div>
            <button type="button" class="text-xs text-amber-600 underline" @click="showPicker = true">تغيير</button>
          </div>

          <button
            v-if="method === 'credit' && selectedCustomer"
            type="button"
            data-testid="confirm-credit-btn"
            class="w-full h-12 rounded-xl bg-amber-500 text-white font-semibold active:scale-95 transition-all"
            @click="handleConfirm"
          >تأكيد البيع الآجل</button>
        </template>

        <p v-if="error" class="mt-4 text-red-600 text-sm text-center">{{ error }}</p>
      </div>

      <!-- ── Amount entry (cash) ── -->
      <div v-else-if="state === 'amount-entry'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="handleBack">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          المبلغ المستلم
        </h2>

        <!-- Remaining balance banner (split mode only) -->
        <div v-if="pendingPayments.length > 0" class="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-center text-sm" dir="rtl">
          <span class="text-gray-500">متبقي: </span>
          <span class="font-bold text-blue-600 dark:text-blue-400">${{ remainingUsd.toFixed(2) }}</span>
        </div>

        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-center">
          <p class="text-sm text-gray-500 mb-1">
            {{ method === 'cash_syp' ? 'المجموع بالليرة' : 'المجموع بالدولار' }}
          </p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ method === 'cash_syp' ? `${totalSyp.toLocaleString()} ل.س` : `$${totalUsd.toFixed(2)}` }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-900 rounded-xl border-2 border-blue-500 p-4 mb-2 text-center">
          <p class="text-3xl font-mono font-bold text-gray-900 dark:text-white">
            {{ amountStr || '0' }}
          </p>
          <p v-if="showChangeDue" class="text-sm text-green-600 dark:text-green-400 mt-1">
            الباقي: {{ method === 'cash_syp' ? `${changeDue?.toLocaleString()} ل.س` : `$${changeDue?.toFixed(2)}` }}
          </p>
        </div>

        <p
          v-if="amountStr && !amountSufficient"
          class="text-red-600 dark:text-red-400 text-sm text-center mb-2"
        >
          المبلغ غير كافٍ
        </p>

        <NumericKeypad
          :confirm-disabled="!amountSufficient"
          @digit="handleDigit"
          @delete="handleDelete"
          @confirm="handleConfirm"
        />

        <!-- Add split payment button -->
        <button
          v-if="amountSufficient"
          type="button"
          data-testid="add-split-btn"
          class="w-full h-11 mt-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 active:scale-95 transition-all"
          @click="handleAddSplitPayment"
        >إضافة دفعة أخرى</button>

        <p v-if="error" class="text-red-600 text-sm text-center mt-2">{{ error }}</p>
      </div>

      <!-- ── Card confirm ── -->
      <div v-else-if="state === 'card-confirm'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="handleBack">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          إجمالي البيع
        </h2>

        <div class="mb-6 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-4 text-center">
          <p class="text-blue-700 dark:text-blue-300 font-medium">💳 بطاقة</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">سيتم تسجيل الدفع بالبطاقة</p>
        </div>

        <button
          type="button"
          class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold active:scale-95 transition-all mb-3"
          @click="handleConfirm"
        >تأكيد</button>

        <!-- Add card as split payment -->
        <button
          type="button"
          data-testid="add-card-split-btn"
          class="w-full h-11 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 active:scale-95 transition-all"
          @click="handleAddCardSplitPayment"
        >إضافة دفعة أخرى</button>
      </div>

      <!-- ── Credit confirm ── -->
      <div v-else-if="state === 'credit-confirm'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="handleBack">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          إجمالي البيع
        </h2>

        <div class="mb-6 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div
          v-if="selectedCustomer"
          class="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex items-center justify-between"
          dir="rtl"
        >
          <div>
            <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">{{ selectedCustomer.name }}</p>
            <p v-if="selectedCustomer.phone" class="text-xs text-amber-600 dark:text-amber-400">{{ selectedCustomer.phone }}</p>
          </div>
          <button type="button" class="text-xs text-amber-600 underline" @click="showPicker = true">تغيير</button>
        </div>

        <button
          type="button"
          data-testid="confirm-credit-btn"
          class="w-full h-12 rounded-xl bg-amber-500 text-white font-semibold active:scale-95 transition-all"
          @click="handleConfirm"
        >تأكيد البيع الآجل</button>
      </div>

      <!-- ── Confirming (spinner) ── -->
      <div v-else-if="state === 'confirming'" class="p-6 flex flex-col items-center gap-4">
        <div class="w-10 h-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
        <p class="text-gray-600 dark:text-gray-300">جارٍ التأكيد...</p>
      </div>

    </div>
  </div>

  <!-- Customer picker -->
  <CustomerPickerModal
    v-if="showPicker"
    @select="handleCustomerSelected"
    @cancel="showPicker = false"
  />
</template>
