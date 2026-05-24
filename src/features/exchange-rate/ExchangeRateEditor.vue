<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useExchangeRate } from './useExchangeRate'
import AppDialog from '@/components/ui/AppDialog.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const { currentRate, rateHistory, needsConfirmation, pendingRate, saving, error, loadRate, saveRate, confirmSave } = useExchangeRate()

const input = ref('')

onMounted(async () => {
  await loadRate()
  input.value = currentRate.value ? String(currentRate.value) : ''
})

async function handleSave() {
  const val = parseFloat(input.value)
  if (isNaN(val) || val <= 0) return
  await saveRate(val)
  if (!needsConfirmation.value && !error.value) {
    emit('saved')
    emit('close')
  }
}

async function handleConfirm() {
  await confirmSave()
  emit('saved')
  emit('close')
}

function formatRelative(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (h < 1) return 'منذ لحظات'
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${d} يوم`
}
</script>

<template>
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-right">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">سعر صرف الدولار</h2>

      <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1">السعر الجديد (ل.س)</label>
      <input
        v-model="input"
        type="number"
        inputmode="numeric"
        min="1"
        class="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-lg text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        dir="ltr"
        placeholder="مثال: 14500"
      />

      <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

      <ul v-if="rateHistory.length" class="mb-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <li v-for="r in rateHistory" :key="r.setAt" class="flex justify-between">
          <span>{{ r.rate.toLocaleString() }} ل.س</span>
          <span>{{ formatRelative(r.setAt) }}</span>
        </li>
      </ul>

      <div class="flex gap-3">
        <button
          type="button"
          class="flex-1 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
          @click="emit('close')"
        >إلغاء</button>
        <button
          type="button"
          :disabled="saving"
          class="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          @click="handleSave"
        >{{ saving ? '...' : 'حفظ' }}</button>
      </div>
    </div>
  </div>

  <AppDialog
    v-if="needsConfirmation"
    title="تغيير كبير في السعر"
    :message="`السعر الجديد ${pendingRate?.toLocaleString()} ل.س يختلف أكثر من 50٪ عن الحالي. هل أنت متأكد؟`"
    confirm-label="نعم، حفظ"
    :danger="true"
    @confirm="handleConfirm"
    @cancel="needsConfirmation = false"
  />
</template>
