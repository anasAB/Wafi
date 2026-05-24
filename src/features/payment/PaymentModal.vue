<script setup lang="ts">
import { ref, computed } from 'vue'
import NumericKeypad from '@/components/ui/NumericKeypad.vue'
import { usePayment } from './usePayment'
import type { CompletedSale } from './payment.types'

const emit = defineEmits<{
  (e: 'confirmed', sale: CompletedSale): void
  (e: 'close'):                          void
}>()

const { state, method, amountReceived, totalUsd, totalSyp, changeDue, confirming, error,
        selectMethod, back, cancel, confirm } = usePayment()

const amountStr = ref('')

const displayAmount = computed(() => {
  if (!amountStr.value) return null
  return parseFloat(amountStr.value)
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
    <div class="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90dvh] overflow-y-auto">

      <!-- Method selection -->
      <div v-if="state === 'method-selection'" class="p-6">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">طريقة الدفع</h2>
          <button type="button" class="text-gray-400 text-2xl leading-none" @click="handleCancel">×</button>
        </div>

        <div class="mb-4 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.value.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.value.toLocaleString() }} ل.س</p>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="m in [
              { key: 'cash_usd', label: 'نقداً دولار' },
              { key: 'cash_syp', label: 'نقداً ليرة' },
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

      <!-- Amount entry (cash only) -->
      <div v-else-if="state === 'amount-entry'" class="p-6">
        <div class="flex items-center gap-3 mb-4">
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="back">←</button>
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">المبلغ المستلم</h2>
        </div>

        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-center">
          <p class="text-sm text-gray-500 mb-1">{{ method === 'cash_syp' ? 'المجموع بالليرة' : 'المجموع بالدولار' }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ method === 'cash_syp' ? `${totalSyp.value.toLocaleString()} ل.س` : `$${totalUsd.value.toFixed(2)}` }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-900 rounded-xl border-2 border-blue-500 p-4 mb-4 text-center">
          <p class="text-3xl font-mono font-bold text-gray-900 dark:text-white">
            {{ amountStr || '0' }}
          </p>
          <p v-if="changeDue.value !== null && changeDue.value > 0" class="text-sm text-green-600 dark:text-green-400 mt-1">
            الباقي: {{ method === 'cash_syp' ? `${changeDue.value.toLocaleString()} ل.س` : `$${changeDue.value.toFixed(2)}` }}
          </p>
        </div>

        <NumericKeypad @digit="handleDigit" @delete="handleDelete" @confirm="handleConfirm" />
        <p v-if="error" class="text-red-600 text-sm text-center mt-2">{{ error }}</p>
      </div>

      <!-- Confirming -->
      <div v-else-if="state === 'confirming'" class="p-6 flex flex-col items-center gap-4">
        <div class="w-10 h-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
        <p class="text-gray-600 dark:text-gray-300">جارٍ التأكيد...</p>
        <div v-if="method === 'card'" class="w-full">
          <div class="hidden" v-once @vue:mounted="handleConfirm()" />
        </div>
      </div>

    </div>
  </div>
</template>
