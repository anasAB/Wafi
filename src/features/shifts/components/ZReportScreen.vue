<script setup lang="ts">
import { ref, onMounted }  from 'vue'
import { useShift }        from '@/features/shifts/composables/useShift'
import { useZReport }      from '@/features/shifts/composables/useZReport'
import { useShiftStore }   from '@/features/shifts/shift.store'
import { useDeviceStore }  from '@/store/device.store'
import CashCountSheet      from './CashCountSheet.vue'
import type { ZReportMetrics } from '@/features/shifts/shift.types'
import type { CashierShift }   from '@/features/shifts/shift.types'

const { loadActiveShift, closeShift } = useShift()
const { compute, printZReport }       = useZReport()
const shiftStore = useShiftStore()
const device     = useDeviceStore()

const step       = ref<'cash-count' | 'report'>('cash-count')
const shift      = ref<CashierShift | null>(null)
const metrics    = ref<ZReportMetrics | null>(null)
const closingUsd = ref(0)
const closingSyp = ref(0)
const closing    = ref(false)

onMounted(async () => { shift.value = await loadActiveShift() })

async function onCashCounted(usd: number, syp: number) {
  if (!shift.value) return
  closingUsd.value = usd
  closingSyp.value = syp
  metrics.value = await compute(shift.value, usd, syp)
  step.value = 'report'
}

async function handleClose(withPrint: boolean) {
  if (!shift.value || !metrics.value) return
  closing.value = true
  try {
    if (withPrint) {
      printZReport(
        shift.value,
        shiftStore.activeStaff?.name ?? '',
        device.deviceCode,
        metrics.value
      )
    }
    await closeShift(closingUsd.value, closingSyp.value)
  } finally {
    closing.value = false
  }
}

const fmt    = (n: number) => `$${n.toFixed(2)}`
const fmtSyp = (n: number) => `${n.toLocaleString()} ل.س`
</script>

<template>
  <CashCountSheet v-if="step === 'cash-count'" @confirm="onCashCounted" />

  <div v-else-if="step === 'report' && metrics"
    class="fixed inset-0 bg-[#06090F] overflow-y-auto z-50 p-4" dir="rtl">

    <h1 class="text-white text-2xl font-bold text-center mb-4">تقرير الوردية</h1>

    <!-- Shift info -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8] space-y-1">
      <div class="flex justify-between"><span class="text-[#637285]">الكاشير</span><span>{{ shiftStore.activeStaff?.name }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">الجهاز</span><span>{{ device.deviceCode }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">فتح</span><span>{{ new Date(shift!.openedAt).toLocaleTimeString('ar-SY') }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">المدة</span><span>{{ Math.floor(metrics.durationMinutes / 60) }}س {{ metrics.durationMinutes % 60 }}د</span></div>
    </div>

    <!-- Sales summary -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8]">
      <p class="text-white font-semibold mb-2">المبيعات</p>
      <div class="flex justify-between mb-1"><span class="text-[#637285]">عدد الفواتير</span><span>{{ metrics.invoiceCount }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">إجمالي المبيعات</span><span class="text-white font-semibold">{{ fmt(metrics.totalRevenueUsd) }}</span></div>
    </div>

    <!-- Payment breakdown -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8] space-y-1">
      <p class="text-white font-semibold mb-2">تفصيل طريقة الدفع</p>
      <div class="flex justify-between"><span class="text-[#637285]">نقد دولار</span><span>{{ fmt(metrics.cashUsdSales) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">نقد ليرة</span><span>{{ fmtSyp(metrics.cashSypSalesRaw) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">بطاقة</span><span>{{ fmt(metrics.cardSales) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">آجل (دين)</span><span>{{ fmt(metrics.creditSales) }}</span></div>
    </div>

    <!-- Expenses -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-4 text-sm text-[#C8D5E8]">
      <p class="text-white font-semibold mb-2">المصاريف</p>
      <div class="flex justify-between"><span class="text-[#637285]">مصاريف الوردية</span><span>{{ fmt(metrics.cashExpensesUsd) }}</span></div>
    </div>

    <!-- Cash reconciliation -->
    <div class="bg-[#0D1828] rounded-2xl p-4 mb-6 text-sm text-[#C8D5E8] space-y-1">
      <p class="text-white font-semibold mb-2">حساب الصندوق</p>
      <div class="flex justify-between"><span class="text-[#637285]">رصيد الفتح</span><span>{{ fmt(shift!.openingCashUsd) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">+ نقد مبيعات</span><span>{{ fmt(metrics.cashUsdSales) }}</span></div>
      <div class="flex justify-between"><span class="text-[#637285]">- مصاريف نقدية</span><span>{{ fmt(metrics.cashExpensesUsd) }}</span></div>
      <div class="flex justify-between border-t border-white/10 pt-1">
        <span class="text-[#637285]">متوقع في الصندوق</span><span>{{ fmt(metrics.expectedUsd) }}</span>
      </div>
      <div class="flex justify-between"><span class="text-[#637285]">عند العد الفعلي</span><span>{{ fmt(metrics.actualUsd) }}</span></div>
      <div class="flex justify-between font-semibold"
        :class="metrics.varianceUsd < 0 ? 'text-red-400' : 'text-green-400'">
        <span>الفرق</span>
        <span>{{ metrics.varianceUsd >= 0 ? '+' : '' }}{{ fmt(metrics.varianceUsd) }} {{ metrics.varianceUsd < 0 ? '⚠️' : '✓' }}</span>
      </div>
      <div class="border-t border-white/10 pt-2 mt-1 space-y-1">
        <div class="flex justify-between"><span class="text-[#637285]">ليرة متوقع</span><span>{{ fmtSyp(metrics.expectedSyp) }}</span></div>
        <div class="flex justify-between"><span class="text-[#637285]">ليرة عند العد</span><span>{{ fmtSyp(metrics.actualSyp) }}</span></div>
        <div class="flex justify-between font-semibold"
          :class="metrics.varianceSyp < 0 ? 'text-red-400' : 'text-green-400'">
          <span>فرق الليرة</span>
          <span>{{ metrics.varianceSyp >= 0 ? '+' : '' }}{{ fmtSyp(metrics.varianceSyp) }}</span>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex flex-col gap-3 pb-8">
      <button @click="handleClose(true)" :disabled="closing"
        class="w-full py-4 rounded-2xl bg-[#1A56DB] text-white font-semibold text-lg disabled:opacity-50">
        طباعة وإغلاق
      </button>
      <button @click="handleClose(false)" :disabled="closing"
        class="w-full py-4 rounded-2xl bg-white/10 text-white font-semibold disabled:opacity-50">
        إغلاق بدون طباعة
      </button>
    </div>
  </div>
</template>
