<script setup lang="ts">
import { ref, onMounted }  from 'vue'
import { useStaff }        from '@/features/staff/composables/useStaff'
import { verifyPin }       from '@/features/staff/composables/usePinAuth'
import { useShift }        from '@/features/shifts/composables/useShift'
import PinPad              from '@/features/staff/components/PinPad.vue'
import type { Staff }      from '@/features/staff/staff.types'

const { staff, loadStaff } = useStaff()
const { openShift }        = useShift()

type Step = 'pick-staff' | 'enter-pin' | 'opening-cash'

const step           = ref<Step>('pick-staff')
const selectedStaff  = ref<Staff | null>(null)
const openingCashUsd = ref('')
const pinPadRef      = ref<InstanceType<typeof PinPad> | null>(null)
const loading        = ref(false)

onMounted(() => loadStaff())

function selectStaff(s: Staff) {
  selectedStaff.value = s
  step.value = 'enter-pin'
}

async function onPinComplete(pin: string) {
  if (!selectedStaff.value) return
  const ok = await verifyPin(pin, selectedStaff.value.pinHash)
  if (!ok) { pinPadRef.value?.shake(); return }
  step.value = 'opening-cash'
}

async function confirmOpen() {
  if (!selectedStaff.value) return
  loading.value = true
  try {
    await openShift(selectedStaff.value, parseFloat(openingCashUsd.value) || 0)
  } finally {
    loading.value = false
  }
}

function back() {
  if (step.value === 'enter-pin')    { step.value = 'pick-staff'; selectedStaff.value = null }
  if (step.value === 'opening-cash') { step.value = 'enter-pin' }
}
</script>

<template>
  <div class="fixed inset-0 bg-[#06090F] flex flex-col items-center justify-center p-6 z-50" dir="rtl">
    <div class="text-white text-3xl font-bold mb-10">وافي</div>

    <!-- Step 1: pick staff -->
    <template v-if="step === 'pick-staff'">
      <p class="text-[#C8D5E8] mb-6 text-lg">من أنت؟</p>
      <div class="flex flex-col gap-3 w-full max-w-xs">
        <button
          v-for="s in staff" :key="s.id"
          @click="selectStaff(s)"
          class="w-full py-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-lg font-medium transition-all active:scale-95"
        >{{ s.name }}</button>
      </div>
    </template>

    <!-- Step 2: enter PIN -->
    <template v-else-if="step === 'enter-pin'">
      <p class="text-[#C8D5E8] mb-2 text-lg">مرحباً {{ selectedStaff?.name }}</p>
      <p class="text-[#637285] mb-8 text-sm">أدخل الرقم السري</p>
      <PinPad ref="pinPadRef" @complete="onPinComplete" />
      <button @click="back" class="mt-8 text-[#637285] text-sm">← رجوع</button>
    </template>

    <!-- Step 3: opening cash -->
    <template v-else-if="step === 'opening-cash'">
      <p class="text-[#C8D5E8] mb-2 text-lg">كم في الصندوق؟</p>
      <p class="text-[#637285] mb-8 text-sm">أدخل رصيد الفتح بالدولار</p>
      <div class="flex items-center gap-2 bg-white/10 rounded-2xl px-4 py-3 w-full max-w-xs">
        <span class="text-[#637285]">$</span>
        <input
          v-model="openingCashUsd"
          type="number" min="0" step="0.01"
          class="bg-transparent text-white text-2xl w-full outline-none"
          placeholder="0.00" dir="ltr" autofocus
        />
      </div>
      <button
        @click="confirmOpen" :disabled="loading"
        class="mt-6 w-full max-w-xs py-4 rounded-2xl bg-[#1A56DB] hover:bg-blue-600 text-white text-lg font-semibold transition-all disabled:opacity-50"
      >{{ loading ? 'جاري الفتح...' : 'فتح الوردية' }}</button>
      <button @click="back" class="mt-4 text-[#637285] text-sm">← رجوع</button>
    </template>
  </div>
</template>
