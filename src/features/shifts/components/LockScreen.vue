<script setup lang="ts">
import { ref, computed, onMounted }  from 'vue'
import { useRouter }       from 'vue-router'
import { useI18n }         from 'vue-i18n'
import { useStaff }        from '@/features/staff/composables/useStaff'
import { verifyPin }       from '@/features/staff/composables/usePinAuth'
import { usePinLockout }   from '@/features/staff/composables/usePinLockout'
import { useShift }        from '@/features/shifts/composables/useShift'
import { useOperatorSwitch, OperatorSwitchBlockedError } from '@/features/staff/composables/useOperatorSwitch'
import { useAuditLog }     from '@/features/audit/composables/useAuditLog'
import PinPad              from '@/features/staff/components/PinPad.vue'
import PinRecovery         from '@/features/staff/components/PinRecovery.vue'
import ForceCloseSheet     from '@/features/shifts/components/ForceCloseSheet.vue'
import type { Staff, StaffPermissions } from '@/features/staff/staff.types'
import type { CashierShift } from '@/features/shifts/shift.types'
import { roleLabel }       from '@/features/staff/staff.types'
import { resolveLanding, isRouteAllowed } from '@/router/permissions'
import { computeOpeningDefaults } from '@/features/shifts/composables/openingDefaults'
import DenominationTally from '@/features/shifts/components/DenominationTally.vue'
import { useDenominationConfig } from '@/features/shifts/composables/useDenominationConfig'
import type { DenominationBreakdown } from '@/features/shifts/shift.types'

// `login` (default): the app gate — pick staff, PIN, then open a shift with a
// cash count. `switch`: re-auth as another operator inside an open shift — no
// cash count, no shift change (see switch-operator design).
const props = withDefaults(defineProps<{ mode?: 'login' | 'switch' }>(), { mode: 'login' })
const emit  = defineEmits<{ done: []; cancel: [] }>()

const { t } = useI18n()
const router = useRouter()
const { staff, loadStaff } = useStaff()
const { openShift, loadLastClosedShift, findOpenShiftForDevice } = useShift()
const { switchTo }         = useOperatorSwitch()
const lockout              = usePinLockout()
const { logLoginFailed, logLockedOut } = useAuditLog()

type Step = 'pick-staff' | 'enter-pin' | 'opening-cash' | 'conflict'

const step           = ref<Step>('pick-staff')
const selectedStaff  = ref<Staff | null>(null)
const enteredPin      = ref('')
// WAFI-059: opening cash is dual-currency. SYP is the primary field (focused first
// for Syrian shops); both persist on the shift.
const { usd: usdDenoms, syp: sypDenoms, load: loadDenoms } = useDenominationConfig()
// WAFI-103: tally mode is opt-in per opening; the pre-filled manual fields
// (WAFI-129) stay the default fast path.
const openingUseTally = ref(false)
const openingUsdBreakdown = ref<DenominationBreakdown | null>(null)
const openingSypBreakdown = ref<DenominationBreakdown | null>(null)
function onOpeningUsdTally(payload: { total: number; breakdown: DenominationBreakdown | null }) {
  openingCashUsd.value = String(payload.total)
  openingUsdBreakdown.value = payload.breakdown
}
function onOpeningSypTally(payload: { total: number; breakdown: DenominationBreakdown | null }) {
  openingCashSyp.value = String(payload.total)
  openingSypBreakdown.value = payload.breakdown
}
const openingCashSyp = ref('')
const openingCashUsd = ref('')
// Previous shift's closing cash, shown as a hint above the inputs (epic Story 5.3).
const lastClosed     = ref<CashierShift | null>(null)
// Empty-input guard: an empty count is allowed but must be a deliberate "continue
// with 0?", never a silent zero (epic Story 5.3 AC). Holds the pending open.
const confirmZero    = ref(false)
const pinPadRef      = ref<InstanceType<typeof PinPad> | null>(null)
const loading        = ref(false)
const authError      = ref('')
// WAFI-056: "Forgot PIN?" recovery overlays the PIN entry for the selected staff.
const recovering     = ref(false)
const recoveryDone   = ref(false)
// WAFI-065: a different operator's shift is already open on this device (Story 5.3).
const conflictShift  = ref<CashierShift | null>(null)
const showForceClose = ref(false)

// Only the owner may resolve a conflict inline by force-closing the other shift.
// At the gate there is no session yet, so we read the just-authenticated staff.
const isOwnerSelected = computed(() => selectedStaff.value?.role === 'owner')
const conflictCashierName = computed(() => {
  const id = conflictShift.value?.staffId
  return staff.value.find(s => s.id === id)?.name ?? 'كاشير آخر'
})

onMounted(() => { loadStaff(); loadDenoms() })

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
  enteredPin.value = pin

  // Switch mode: correct PIN changes the active operator and leaves the open
  // shift untouched. Login mode: proceed to the opening-cash count.
  if (props.mode === 'switch') {
    try {
      await switchTo(s, pin)
    } catch (e) {
      if (e instanceof OperatorSwitchBlockedError) {
        authError.value = e.message
        return
      }
      throw e
    }
    // If the screen the previous operator was on is no longer permitted for the
    // new operator (e.g. Owner → ungranted Manager on the dashboard), bounce to
    // a permitted landing so financial views vanish immediately (WAFI-058). An
    // already-permitted route is left untouched — no needless yank to the
    // dashboard when switching back to the owner mid-POS.
    const required = router.currentRoute.value.meta.permission as keyof StaffPermissions | undefined
    if (!isRouteAllowed(required, s)) {
      await router.replace(resolveLanding(s))
    }
    enteredPin.value = ''
    emit('done')
    return
  }
  // One open shift per device (WAFI-065 Part 1). Resolve any existing open shift on
  // this device BEFORE asking for an opening count, so nobody enters cash only to be
  // blocked:
  //   • same operator  → resume their shift (no second row, no recount)
  //   • other operator → Story 5.3 conflict (block / owner force-close)
  //   • none            → normal opening-cash step
  const existing = await findOpenShiftForDevice().catch(() => null)
  if (existing) {
    if (existing.staffId === s.id) {
      // Resume own open shift. openShift takes the resume branch, ignoring the
      // unused cash args — but the pin IS used there (WAFI-203): it re-confirms
      // identity with the server in case a different operator switched in on
      // this device since the shift was opened, so identity + store are
      // re-established there rather than blindly reattached.
      await openShift(s, 0, 0, enteredPin.value)
      await router.replace(resolveLanding(s))
      return
    }
    conflictShift.value = existing
    step.value = 'conflict'
    return
  }

  // Moving to the cash count — surface the previous shift's closing cash as a hint.
  // Best-effort: a missing/failed read just hides the hint, never blocks opening.
  lastClosed.value = await loadLastClosedShift().catch(() => null)
  applyOpeningDefaults()
  confirmZero.value = false
  step.value = 'opening-cash'
}

// WAFI-129: pre-fill opening cash from the previous close (editable defaults,
// one tap when the float is unchanged). Derivation rules live in
// computeOpeningDefaults — see that helper for the no-baseline cases.
const defaultsFromLastClose = ref(false)
// WAFI-130: shift-open blocked (deactivated device) message for the cash step.
const openError = ref('')
function applyOpeningDefaults() {
  const defaults = computeOpeningDefaults(lastClosed.value)
  defaultsFromLastClose.value = defaults !== null
  openingCashSyp.value = defaults?.syp ?? ''
  openingCashUsd.value = defaults?.usd ?? ''
}

const lastCloseDate = computed(() => {
  const iso = lastClosed.value?.closedAt
  if (!iso) return ''
  return new Intl.DateTimeFormat('ar-SY', { day: 'numeric', month: 'short' }).format(new Date(iso))
})

// Owner force-closed the conflicting shift → the device is now free; continue to the
// owner's own opening-cash count.
async function onConflictResolved() {
  showForceClose.value = false
  conflictShift.value = null
  lastClosed.value = await loadLastClosedShift().catch(() => null)
  applyOpeningDefaults()
  confirmZero.value = false
  step.value = 'opening-cash'
}

// An empty count is allowed but must be deliberate: a blank SYP and/or USD field
// raises the confirm-with-zero prompt instead of silently opening at 0.
function confirmOpen() {
  if (!selectedStaff.value) return
  const sypBlank = openingCashSyp.value.trim() === ''
  const usdBlank = openingCashUsd.value.trim() === ''
  if (sypBlank || usdBlank) {
    confirmZero.value = true
    return
  }
  void doOpen()
}

async function doOpen() {
  if (!selectedStaff.value) return
  loading.value = true
  try {
    const result = await openShift(
      selectedStaff.value,
      parseFloat(openingCashUsd.value) || 0,
      parseFloat(openingCashSyp.value) || 0,
      enteredPin.value,
      openingUseTally.value ? { usd: openingUsdBreakdown.value, syp: openingSypBreakdown.value } : null,
    )
    // A shift opened on this device between the PIN step and here (race) → surface
    // the same conflict flow rather than silently doing nothing.
    if (result.status === 'conflict') {
      conflictShift.value = result.shift
      step.value = 'conflict'
      return
    }
    // WAFI-130: the owner deactivated this device — no new shifts here.
    if (result.status === 'device-deactivated') {
      openError.value = 'هذا الجهاز موقوف من قبل المالك — لا يمكن فتح وردية جديدة عليه'
      return
    }
    // WAFI-203: this is a NEW identity for this device and the server could
    // not confirm it (offline). No shift was opened — stay on this step so
    // the cashier can retry once online.
    if (result.status === 'identity-unconfirmed') {
      openError.value = result.reason
      return
    }
    // Land on the right home before first paint: the owner and a reports-granted
    // manager get the dashboard; everyone else gets the POS, so an ungranted
    // operator never flashes the financial dashboard then bounces (WAFI-058).
    await router.replace(resolveLanding(selectedStaff.value))
    enteredPin.value = ''
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
  enteredPin.value = ''
  recovering.value = false
  recoveryDone.value = false
  openingCashSyp.value = ''
  openingCashUsd.value = ''
  openingUseTally.value = false
  openingUsdBreakdown.value = null
  openingSypBreakdown.value = null
  confirmZero.value = false
  conflictShift.value = null
  showForceClose.value = false
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

      <!-- Step 3: opening cash (dual currency — SYP first, WAFI-059) -->
      <template v-else-if="step === 'opening-cash'">
        <p class="prompt">كم في الصندوق؟</p>
        <p class="sub">أدخل رصيد الفتح بالليرة والدولار</p>

        <!-- WAFI-129: defaults come from the previous close (editable). When no
             reliable baseline exists (force-close / no previous shift) the hint
             explains, and the fields stay blank as before. -->
        <p v-if="defaultsFromLastClose" class="last-closed-hint">
          من إغلاق الوردية السابقة<template v-if="lastCloseDate"> ({{ lastCloseDate }})</template> —
          عدّل الأرقام إن تغيّر الصندوق
        </p>
        <p v-else-if="lastClosed && lastClosed.forceClosedBy" class="last-closed-hint">
          الوردية السابقة أُغلقت إجبارياً — أدخل العد يدوياً
        </p>

        <!-- Confirm-with-zero prompt: an empty count must be deliberate -->
        <template v-if="confirmZero">
          <p class="zero-warning">لم تُدخل العد — هل تريد الاستمرار بـ 0؟</p>
          <button type="button" class="btn-primary" :disabled="loading" @click="doOpen">
            {{ loading ? 'جاري الفتح...' : 'نعم، افتح بـ 0' }}
          </button>
          <button type="button" class="back-btn" @click="confirmZero = false">إلغاء — تعديل العد</button>
        </template>

        <template v-else>
          <button type="button" class="tally-toggle-link" @click="openingUseTally = !openingUseTally">
            {{ openingUseTally ? 'إدخال المبلغ مباشرة' : 'عدّ الفئات بدلاً من ذلك' }}
          </button>

          <template v-if="openingUseTally">
            <DenominationTally
              label="ليرة سورية ل.س"
              :denominations="sypDenoms.map(d => d.value)"
              :is-syp="true"
              @change="onOpeningSypTally"
            />
            <DenominationTally
              label="دولار أمريكي $"
              :denominations="usdDenoms.map(d => d.value)"
              :is-syp="false"
              @change="onOpeningUsdTally"
            />
          </template>

          <template v-else>
            <div class="cash-input-card">
              <span class="cash-currency">ل.س</span>
              <input
                v-model="openingCashSyp"
                type="number" min="0" step="1"
                class="cash-input"
                placeholder="0" dir="ltr" autofocus
              />
            </div>
            <div class="cash-input-card cash-input-card--spaced">
              <span class="cash-currency">$</span>
              <input
                v-model="openingCashUsd"
                type="number" min="0" step="0.01"
                class="cash-input"
                placeholder="0.00" dir="ltr"
              />
            </div>
          </template>

          <p v-if="openError" class="zero-warning" role="alert">{{ openError }}</p>
          <button type="button" class="btn-primary" :disabled="loading" @click="confirmOpen">
            {{ loading ? 'جاري الفتح...' : 'فتح الوردية' }}
          </button>
          <button type="button" class="back-btn" @click="back">رجوع</button>
        </template>
      </template>

      <!-- Step 4: an open shift by another cashier blocks this device (Story 5.3) -->
      <template v-else-if="step === 'conflict'">
        <p class="prompt">الوردية مفتوحة</p>
        <p class="conflict-msg">
          توجد وردية مفتوحة لـ<span class="conflict-name">{{ conflictCashierName }}</span>
          على هذا الجهاز. يجب إغلاقها أولاً قبل فتح وردية جديدة.
        </p>

        <!-- Owner can resolve it here (the gate has no other entry to the shift). -->
        <button
          v-if="isOwnerSelected"
          type="button"
          class="btn-danger"
          @click="showForceClose = true"
        >
          إغلاق الوردية المفتوحة إجبارياً
        </button>
        <!-- Non-owner: cannot force-close; must ask the owner. -->
        <p v-else class="conflict-hint">اطلب من المالك إغلاق الوردية المفتوحة.</p>

        <button type="button" class="back-btn" @click="back">رجوع</button>
      </template>
    </div>

    <!-- Owner force-close overlay (reused from the detail screen) -->
    <ForceCloseSheet
      v-if="showForceClose && conflictShift && selectedStaff"
      :shift="conflictShift"
      :forced-by="selectedStaff"
      @done="onConflictResolved"
      @cancel="showForceClose = false"
    />
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
.cash-input-card--spaced { margin-top: 0.75rem; }
.cash-currency { color: #637285; font-size: 1.25rem; min-width: 2.25rem; text-align: center; }

.tally-toggle-link {
  display: block; margin: 0 auto 0.75rem; padding: 0.35rem 0.75rem; border-radius: 0.6rem;
  background: rgba(26, 86, 219, 0.10); border: 1px solid rgba(26, 86, 219, 0.28);
  color: #60A5FA; font-size: 0.75rem; font-weight: 600; font-family: inherit; cursor: pointer;
}

.last-closed-hint {
  font-size: 0.8125rem; color: #93B4F0; text-align: center; width: 100%;
  background: rgba(26, 86, 219, 0.10); border: 1px solid rgba(26, 86, 219, 0.25);
  border-radius: 0.625rem; padding: 0.5rem 0.75rem; margin-bottom: 1rem; line-height: 1.5;
}

.zero-warning {
  font-size: 0.875rem; color: #FCD34D; text-align: center; width: 100%;
  background: rgba(234, 179, 8, 0.10); border: 1px solid rgba(234, 179, 8, 0.30);
  border-radius: 0.625rem; padding: 0.625rem 0.875rem; margin-bottom: 0.5rem; line-height: 1.5;
}
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

/* ── Conflict (Story 5.3 / WAFI-065) ── */
.conflict-msg {
  font-size: 0.9375rem; color: #E8EDF5; text-align: center; line-height: 1.6;
  margin-bottom: 1.25rem; width: 100%;
}
.conflict-name { font-weight: 800; color: #FCD34D; margin: 0 0.25rem; }
.conflict-hint {
  font-size: 0.8125rem; color: #93A3B8; text-align: center; width: 100%;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);
  border-radius: 0.625rem; padding: 0.625rem 0.875rem;
}
.btn-danger {
  width: 100%; height: 52px; border-radius: 0.875rem; cursor: pointer; font-family: inherit;
  font-size: 1rem; font-weight: 700; color: #fff; border: none;
  background: linear-gradient(135deg, #DC2626, #B91C1C);
  box-shadow: 0 4px 20px rgba(220,38,38,0.35); transition: opacity 0.15s, transform 0.1s;
}
.btn-danger:hover { opacity: 0.92; }
.btn-danger:active { transform: scale(0.98); }

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
