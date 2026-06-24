<script setup lang="ts">
import { ref, onMounted }  from 'vue'
import { useRouter }       from 'vue-router'
import { useI18n }         from 'vue-i18n'
import { useStaff }        from '@/features/staff/composables/useStaff'
import { verifyPin }       from '@/features/staff/composables/usePinAuth'
import { usePinLockout }   from '@/features/staff/composables/usePinLockout'
import { useShift }        from '@/features/shifts/composables/useShift'
import { useOperatorSwitch } from '@/features/staff/composables/useOperatorSwitch'
import { useAuditLog }     from '@/features/audit/composables/useAuditLog'
import PinPad              from '@/features/staff/components/PinPad.vue'
import PinRecovery         from '@/features/staff/components/PinRecovery.vue'
import type { Staff, StaffPermissions } from '@/features/staff/staff.types'
import { roleLabel }       from '@/features/staff/staff.types'
import { resolveLanding, isRouteAllowed } from '@/router/permissions'

// `login` (default): the app gate — pick staff, PIN, then open a shift with a
// cash count. `switch`: re-auth as another operator inside an open shift — no
// cash count, no shift change (see switch-operator design).
const props = withDefaults(defineProps<{ mode?: 'login' | 'switch' }>(), { mode: 'login' })
const emit  = defineEmits<{ done: []; cancel: [] }>()

const { t } = useI18n()
const router = useRouter()
const { staff, loadStaff } = useStaff()
const { openShift }        = useShift()
const { switchTo }         = useOperatorSwitch()
const lockout              = usePinLockout()
const { logLoginFailed, logLockedOut } = useAuditLog()

type Step = 'pick-staff' | 'enter-pin' | 'opening-cash'

const step           = ref<Step>('pick-staff')
const selectedStaff  = ref<Staff | null>(null)
const openingCashUsd = ref('')
const pinPadRef      = ref<InstanceType<typeof PinPad> | null>(null)
const loading        = ref(false)
const authError      = ref('')
// WAFI-056: "Forgot PIN?" recovery overlays the PIN entry for the selected staff.
const recovering     = ref(false)
const recoveryDone   = ref(false)

onMounted(() => loadStaff())

function selectStaff(s: Staff) {
  selectedStaff.value = s
  recovering.value = false
  recoveryDone.value = false
  authError.value = lockout.isLockedOut(s.id)
    ? 'الحساب مقفل مؤقتاً بسبب محاولات خاطئة. حاول لاحقاً.'
    : ''
  step.value = 'enter-pin'
}

// A reset both sets a new PIN and clears the lockout, so the employee returns to
// the PIN entry and signs in with the PIN that was just set on this device.
function onRecoveryDone() {
  recovering.value = false
  recoveryDone.value = true
  authError.value = ''
}

async function onPinComplete(pin: string) {
  if (!selectedStaff.value) return
  const s = selectedStaff.value

  // Refuse PIN checks while locked out — the gate must hold offline.
  if (lockout.isLockedOut(s.id)) {
    authError.value = 'الحساب مقفل مؤقتاً بسبب محاولات خاطئة. حاول لاحقاً.'
    pinPadRef.value?.shake()
    return
  }

  const ok = await verifyPin(pin, s.pinHash, s.pinSalt)
  if (!ok) {
    pinPadRef.value?.shake()
    const { locked, minutes } = lockout.recordFailure(s.id)
    // Audit writes for security events surface failures (see useAuditLog); a
    // broken local log must not crash the gate, so report it inline instead.
    try {
      await logLoginFailed(s.id, s.name)
      if (locked) await logLockedOut(s.id, s.name, minutes)
    } catch {
      authError.value = 'تعذّر تسجيل المحاولة. تحقق من الجهاز.'
      return
    }
    authError.value = locked
      ? `تم قفل الحساب ${minutes} دقائق بعد محاولات خاطئة متكررة.`
      : 'الرقم السري غير صحيح.'
    return
  }

  // Correct PIN — clear the failure counter for this operator.
  lockout.reset(s.id)
  authError.value = ''

  // Switch mode: correct PIN changes the active operator and leaves the open
  // shift untouched. Login mode: proceed to the opening-cash count.
  if (props.mode === 'switch') {
    await switchTo(s)
    // If the screen the previous operator was on is no longer permitted for the
    // new operator (e.g. Owner → ungranted Manager on the dashboard), bounce to
    // a permitted landing so financial views vanish immediately (WAFI-058). An
    // already-permitted route is left untouched — no needless yank to the
    // dashboard when switching back to the owner mid-POS.
    const required = router.currentRoute.value.meta.permission as keyof StaffPermissions | undefined
    if (!isRouteAllowed(required, s)) {
      await router.replace(resolveLanding(s))
    }
    emit('done')
    return
  }
  step.value = 'opening-cash'
}

async function confirmOpen() {
  if (!selectedStaff.value) return
  loading.value = true
  try {
    await openShift(selectedStaff.value, parseFloat(openingCashUsd.value) || 0)
    // Land on the right home before first paint: the owner and a reports-granted
    // manager get the dashboard; everyone else gets the POS, so an ungranted
    // operator never flashes the financial dashboard then bounces (WAFI-058).
    await router.replace(resolveLanding(selectedStaff.value))
  } finally {
    loading.value = false
  }
}

function back() {
  // From PIN entry → staff list. From cash entry → also back to staff list (not
  // PIN re-entry), per the requested flow (#21).
  step.value = 'pick-staff'
  selectedStaff.value = null
  authError.value = ''
  recovering.value = false
  recoveryDone.value = false
}
</script>

<template>
  <div class="lock-root" dir="rtl">
    <div class="lock-card">
      <!-- Brand (login) / action title (switch) -->
      <h1 class="brand">{{ mode === 'switch' ? 'تبديل المستخدم' : 'وافي' }}</h1>

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
            <span class="staff-role">{{ roleLabel(s.role) }}</span>
          </button>
        </div>
        <!-- Switch can be abandoned; the previous operator stays active. The
             login gate has no cancel (the app is locked until a shift opens). -->
        <button v-if="mode === 'switch'" type="button" class="back-btn" @click="emit('cancel')">
          إلغاء
        </button>
      </template>

      <!-- Step 2: enter PIN (or, if recovering, the Forgot-PIN flow) -->
      <template v-else-if="step === 'enter-pin'">
        <!-- WAFI-056: in-person recovery for the selected staff member. -->
        <PinRecovery
          v-if="recovering && selectedStaff"
          :target="selectedStaff"
          @done="onRecoveryDone"
          @cancel="recovering = false"
        />
        <template v-else>
          <p class="prompt">مرحباً {{ selectedStaff?.name }}</p>
          <p class="sub">أدخل الرقم السري</p>
          <p v-if="recoveryDone" class="reset-done">{{ t('staff.resetDone') }}</p>
          <p v-if="authError" class="auth-error">{{ authError }}</p>
          <PinPad ref="pinPadRef" @complete="onPinComplete" />
          <button type="button" class="forgot-btn" @click="recovering = true">
            {{ t('staff.forgotPin') }}
          </button>
          <button type="button" class="back-btn" @click="back">رجوع</button>
        </template>
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

.auth-error {
  font-size: 0.8125rem; color: #FCA5A5; text-align: center;
  background: rgba(239, 68, 68, 0.10); border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 0.625rem; padding: 0.5rem 0.875rem; margin-bottom: 0.75rem; width: 100%;
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

.forgot-btn {
  margin-top: 1rem; padding: 0.35rem 0.5rem; border: none; background: transparent;
  color: #93B4F0; font-size: 0.8125rem; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: color 0.15s;
}
.forgot-btn:hover { color: #C8D5E8; text-decoration: underline; }

.reset-done {
  font-size: 0.8125rem; color: #4ADE80; text-align: center;
  background: rgba(34, 197, 94, 0.10); border: 1px solid rgba(34, 197, 94, 0.28);
  border-radius: 0.625rem; padding: 0.5rem 0.875rem; margin-bottom: 0.75rem; width: 100%;
}
</style>
