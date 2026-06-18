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
  // From PIN entry → staff list. From cash entry → also back to staff list (not
  // PIN re-entry), per the requested flow (#21).
  step.value = 'pick-staff'
  selectedStaff.value = null
}
</script>

<template>
  <div class="lock-root" dir="rtl">
    <div class="lock-card">
      <!-- Brand -->
      <h1 class="brand">وافي</h1>

      <!-- Step 1: pick staff -->
      <template v-if="step === 'pick-staff'">
        <p class="prompt">من أنت؟</p>
        <div class="staff-list">
          <button
            v-for="s in staff"
            :key="s.id"
            type="button"
            class="staff-btn"
            @click="selectStaff(s)"
          >
            <span class="staff-name">{{ s.name }}</span>
            <span class="staff-role">{{ s.role === 'owner' ? 'مالك' : 'كاشير' }}</span>
          </button>
        </div>
      </template>

      <!-- Step 2: enter PIN -->
      <template v-else-if="step === 'enter-pin'">
        <p class="prompt">مرحباً {{ selectedStaff?.name }}</p>
        <p class="sub">أدخل الرقم السري</p>
        <PinPad ref="pinPadRef" @complete="onPinComplete" />
        <button type="button" class="back-btn" @click="back">رجوع</button>
      </template>

      <!-- Step 3: opening cash -->
      <template v-else-if="step === 'opening-cash'">
        <p class="prompt">كم في الصندوق؟</p>
        <p class="sub">أدخل رصيد الفتح بالدولار</p>
        <div class="cash-input-card">
          <span class="cash-currency">$</span>
          <input
            v-model="openingCashUsd"
            type="number" min="0" step="0.01"
            class="cash-input"
            placeholder="0.00" dir="ltr" autofocus
          />
        </div>
        <button type="button" class="btn-primary" :disabled="loading" @click="confirmOpen">
          {{ loading ? 'جاري الفتح...' : 'فتح الوردية' }}
        </button>
        <button type="button" class="back-btn" @click="back">رجوع</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lock-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.lock-card {
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1.5rem;
  border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.40);
  box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
}

.brand {
  font-family: var(--font-display-ar, 'Tajawal'), serif;
  font-size: 2.5rem;
  font-weight: 800;
  color: var(--color-gold-primary, #1A56DB);
  margin-bottom: 1.5rem;
  line-height: 1;
}

.prompt { font-size: 1.125rem; font-weight: 700; color: #E8EDF5; margin-bottom: 0.25rem; text-align: center; }
.sub    { font-size: 0.8125rem; color: #637285; margin-bottom: 1.5rem; text-align: center; }

.staff-list { display: flex; flex-direction: column; gap: 0.625rem; width: 100%; margin-top: 0.75rem; }
.staff-btn {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 0.9rem 1.1rem; border-radius: 0.875rem; border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06); color: #E8EDF5; cursor: pointer;
  font-family: inherit; transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.staff-btn:hover { background: rgba(26, 86, 219, 0.16); border-color: rgba(26, 86, 219, 0.35); }
.staff-btn:active { transform: scale(0.98); }
.staff-name { font-size: 0.9375rem; font-weight: 600; }
.staff-role { font-size: 0.75rem; color: #637285; }

.cash-input-card {
  display: flex; align-items: center; gap: 0.5rem; width: 100%;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.875rem; padding: 0.875rem 1rem; transition: border-color 0.15s, box-shadow 0.15s;
}
.cash-input-card:focus-within {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25);
}
.cash-currency { color: #637285; font-size: 1.25rem; }
.cash-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: #E8EDF5; font-size: 1.5rem; font-weight: 700; font-family: inherit;
}
.cash-input::placeholder { color: #3D4F6B; }

.btn-primary {
  width: 100%; height: 52px; margin-top: 1rem; border-radius: 0.875rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff;
  font-size: 1rem; font-weight: 700; font-family: inherit; border: none; cursor: pointer;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.40); transition: opacity 0.15s, transform 0.1s;
}
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-primary:active:not(:disabled) { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.back-btn {
  margin-top: 1.25rem; padding: 0.5rem 1rem; border-radius: 0.75rem;
  background: transparent; border: 1px solid rgba(255, 255, 255, 0.14);
  color: #637285; font-size: 0.875rem; font-family: inherit; cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.back-btn:hover { color: #C8D5E8; background: rgba(255, 255, 255, 0.05); }
</style>
