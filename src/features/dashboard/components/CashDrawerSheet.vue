<script setup lang="ts">
import type { CashMovement } from '@/features/dashboard/composables/useCashDrawer'

const props = defineProps<{
  cashUsd:   number
  cashSyp:   number
  movements: CashMovement[]
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diffMin < 1)  return 'الآن'
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`
  return `قبل ${Math.floor(diffMin / 60)} ساعة`
}

function fmtUsd(n: number): string {
  if (n === 0) return ''
  return n > 0 ? `+$${n.toFixed(2)}` : `−$${Math.abs(n).toFixed(2)}`
}

function fmtSyp(n: number): string {
  if (n === 0) return ''
  const abs = Math.round(Math.abs(n)).toLocaleString('en-US')
  return n > 0 ? `+${abs} ل.س` : `−${abs} ل.س`
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
    dir="rtl"
    @click.self="emit('close')"
  >
    <div class="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[80vh] flex flex-col">
      <!-- Handle -->
      <div class="w-9 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-4 sm:hidden shrink-0"></div>

      <h2 class="text-base font-bold text-gray-900 dark:text-white mb-1 shrink-0">حركات النقد — اليوم</h2>

      <!-- Summary -->
      <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-4 shrink-0">
        <p class="text-xs text-gray-500 mb-1">الإجمالي المتوقع</p>
        <p class="text-sm font-bold text-gray-900 dark:text-white">
          <span v-if="cashUsd !== 0">${{ cashUsd.toFixed(2) }}</span>
          <span v-if="cashUsd !== 0 && cashSyp !== 0" class="text-gray-400 mx-1">+</span>
          <span v-if="cashSyp !== 0">{{ Math.round(cashSyp).toLocaleString('en-US') }} ل.س</span>
          <span v-if="cashUsd === 0 && cashSyp === 0" class="text-gray-400">$0</span>
        </p>
      </div>

      <!-- Movements list -->
      <div class="flex-1 overflow-y-auto flex flex-col gap-2 mb-4">
        <div
          v-if="movements.length === 0"
          class="text-center py-8 text-gray-400 text-sm"
        >لا توجد حركات نقدية اليوم</div>

        <div
          v-for="(m, i) in movements"
          :key="i"
          class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
        >
          <div>
            <p class="text-sm font-medium" :class="m.type === 'sale' ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'">
              {{ m.label }}
            </p>
            <p class="text-xs text-gray-400">{{ relativeTime(m.createdAt) }}</p>
          </div>
          <div class="text-left">
            <p v-if="m.usd !== 0" class="text-sm font-semibold" :class="m.usd > 0 ? 'text-green-600' : 'text-red-500'">
              {{ fmtUsd(m.usd) }}
            </p>
            <p v-if="m.syp !== 0" class="text-sm font-semibold" :class="m.syp > 0 ? 'text-green-600' : 'text-red-500'">
              {{ fmtSyp(m.syp) }}
            </p>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="w-full h-11 rounded-xl text-sm text-gray-600 dark:text-gray-400
               border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 shrink-0"
        @click="emit('close')"
      >إغلاق</button>
    </div>
  </div>
</template>
