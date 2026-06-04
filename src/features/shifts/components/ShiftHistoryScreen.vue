<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useShift }       from '@/features/shifts/composables/useShift'
import type { CashierShift } from '@/features/shifts/shift.types'

const { loadShiftHistory } = useShift()
const shifts  = ref<CashierShift[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try { shifts.value = await loadShiftHistory() }
  finally { loading.value = false }
})

function fmtDate(iso: string)     { return new Date(iso).toLocaleDateString('ar-SY') }
function fmtTime(iso: string)     { return new Date(iso).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }) }
function fmtDuration(s: CashierShift): string {
  if (!s.closedAt) return 'مفتوحة'
  const ms    = new Date(s.closedAt).getTime() - new Date(s.openedAt).getTime()
  const mins  = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  return hours > 0 ? `${hours}س ${mins % 60}د` : `${mins}د`
}
</script>

<template>
  <div class="p-4 max-w-lg mx-auto" dir="rtl">
    <h1 class="text-white text-xl font-bold mb-4">سجل الورديات</h1>

    <div v-if="loading" class="text-[#637285] text-center py-8">جاري التحميل...</div>

    <div v-else-if="shifts.length === 0" class="text-[#637285] text-center py-8">
      لا توجد ورديات مسجّلة بعد
    </div>

    <div v-else class="flex flex-col gap-3">
      <div v-for="s in shifts" :key="s.id" class="bg-[#0D1828] rounded-2xl p-4">
        <div class="flex items-center justify-between mb-1">
          <span class="text-white font-medium">{{ fmtDate(s.openedAt) }}</span>
          <span :class="['text-xs px-2 py-0.5 rounded-full',
            s.status === 'open' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-[#637285]']">
            {{ s.status === 'open' ? 'مفتوحة' : 'مغلقة' }}
          </span>
        </div>
        <div class="text-[#637285] text-sm space-y-0.5">
          <div>{{ fmtTime(s.openedAt) }} — {{ s.closedAt ? fmtTime(s.closedAt) : '...' }}</div>
          <div>المدة: {{ fmtDuration(s) }}</div>
          <div v-if="s.closingCashUsd !== null">عند الإغلاق: ${{ s.closingCashUsd?.toFixed(2) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
