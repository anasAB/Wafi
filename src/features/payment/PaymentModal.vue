<script setup lang="ts">
import { ref, computed } from 'vue'
import NumericKeypad from '@/components/ui/NumericKeypad.vue'
import { usePayment } from './usePayment'
import type { CompletedSale } from './payment.types'

const emit = defineEmits<{
  (e: 'confirmed', sale: CompletedSale): void
  (e: 'close'):                          void
}>()

const { state, method, amountReceived, totalUsd, totalSyp, changeDue, error,
        selectMethod, back, cancel, confirm } = usePayment()

const amountStr = ref('')

const displayAmount = computed(() => {
  if (!amountStr.value) return null
  return parseFloat(amountStr.value)
})

const amountSufficient = computed(() => {
  const amount = displayAmount.value
  if (amount === null || isNaN(amount)) return false
  if (method.value === 'cash_usd') return amount >= totalUsd.value
  if (method.value === 'cash_syp') return amount >= totalSyp.value
  return false
})

function handleDigit(d: string) {
  if (d === '.' && amountStr.value.includes('.')) return
  amountStr.value += d
  amountReceived.value = displayAmount.value
}

function handleDelete() {
  amountStr.value = amountStr.value.slice(0, -1)
  amountReceived.value = displayAmount.value
}

async function handleConfirm() {
  if (method.value !== 'card' && !amountSufficient.value) return
  try {
    const sale = await confirm()
    emit('confirmed', sale)
  } catch {
    // error is set in usePayment
  }
}

function handleCancel() {
  cancel()
  emit('close')
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

        <div class="mb-6 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div class="grid grid-cols-3 gap-3">
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
        </div>

        <p v-if="error" class="mt-4 text-red-600 text-sm text-center">{{ error }}</p>
      </div>

      <!-- ── Amount entry (cash) ── -->
      <div v-else-if="state === 'amount-entry'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="back">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          المبلغ المستلم
        </h2>

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
          <p v-if="changeDue !== null && changeDue > 0" class="text-sm text-green-600 dark:text-green-400 mt-1">
            الباقي: {{ method === 'cash_syp' ? `${changeDue.toLocaleString()} ل.س` : `$${changeDue.toFixed(2)}` }}
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
        <p v-if="error" class="text-red-600 text-sm text-center mt-2">{{ error }}</p>
      </div>

      <!-- ── Card confirm ── -->
      <div v-else-if="state === 'card-confirm'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="back">
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

        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-6 text-center">
          <p class="text-blue-700 dark:text-blue-300 font-medium">💳 بطاقة</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">سيتم تسجيل الدفع بالبطاقة</p>
        </div>

        <button
          type="button"
          class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold active:scale-95 transition-all"
          @click="handleConfirm"
        >
          تأكيد
        </button>
      </div>

      <!-- ── Confirming (spinner) ── -->
      <div v-else-if="state === 'confirming'" class="p-6 flex flex-col items-center gap-4">
        <div class="w-10 h-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
        <p class="text-gray-600 dark:text-gray-300">جارٍ التأكيد...</p>
      </div>

    </div>
  </div>
</template>
