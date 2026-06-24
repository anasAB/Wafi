<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStaff } from '../composables/useStaff'
import { verifyPin } from '../composables/usePinAuth'
import { usePinLockout } from '../composables/usePinLockout'
import { canResetPin } from '@/router/permissions'
import { verifyAccountPassword } from '@/data/supabase/auth'
import { useRecoveryCodes } from '../composables/useRecoveryCodes'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import PinPad from './PinPad.vue'
import type { Staff } from '../staff.types'
import { roleLabel } from '../staff.types'

// In-person "Forgot PIN?" recovery (WAFI-056). The employee who forgot their PIN
// is `target`; they hand the device to someone who can authorise a reset. Two
// paths: a supervisor (owner/manager) re-authenticates with their OWN PIN, or —
// only when the target is the owner — the owner re-enters the shop account
// password. Either way the employee then sets/gets a new PIN and signs in.
const props = defineProps<{ target: Staff }>()
const emit  = defineEmits<{ done: []; cancel: [] }>()

const { t, locale } = useI18n()
const { staff, loadStaff, resetStaffPin, updateStaffPin } = useStaff()
const lockout = usePinLockout()

type Step = 'choose' | 'supervisor-pick' | 'supervisor-pin' | 'owner-password' | 'owner-code' | 'set-pin' | 'confirm-pin' | 'done'

const step       = ref<Step>('choose')
const authoriser = ref<Staff | null>(null) // null on the owner-password path (actor === target)
const password   = ref('')
const firstPin   = ref('')
const error      = ref('')
const busy       = ref(false)
const pinPadRef  = ref<InstanceType<typeof PinPad> | null>(null)

const { verifyAndConsume } = useRecoveryCodes()
const { logRecoveryCodeUsed } = useAuditLog()
const code = ref('')

const dir = computed(() => (locale.value === 'ar' ? 'rtl' : 'ltr'))

onMounted(() => loadStaff())

// Supervisors present on this device who may reset THIS target (role rule, the
// same source of truth the action enforces). A forgotten PIN can't authorise
// itself, so the target is excluded by canResetPin.
const supervisors    = computed(() => staff.value.filter((s) => canResetPin(s, props.target)))
const canUseSupervisor = computed(() => supervisors.value.length > 0)
// Owner self-recovery resets the owner's own PIN — offered only when the target
// is the owner (breaks the circular lock when the owner forgot their own PIN).
const showOwnerPath  = computed(() => props.target.role === 'owner')

function fail(msg: string) {
  error.value = msg
  pinPadRef.value?.shake()
}

function chooseSupervisor() {
  error.value = ''
  step.value = 'supervisor-pick'
}

function chooseOwner() {
  error.value = ''
  authoriser.value = null
  step.value = 'owner-password'
}

function chooseCode() {
  error.value = ''
  authoriser.value = null      // owner self-recovery: actor === target
  code.value = ''
  step.value = 'owner-code'
}

async function submitRecoveryCode() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    const ok = await verifyAndConsume(props.target.id, code.value)
    if (!ok) { error.value = t('staff.wrongRecoveryCode'); return }
    await logRecoveryCodeUsed(props.target.id, props.target.name)
    code.value = ''
    step.value = 'set-pin'      // reuses the existing set/confirm + commitReset(authoriser=null) path
  } finally { busy.value = false }
}

function pickSupervisor(s: Staff) {
  authoriser.value = s
  error.value = lockout.isLockedOut(s.id) ? t('staff.supervisorLocked') : ''
  step.value = 'supervisor-pin'
}

async function onSupervisorPin(pin: string) {
  const s = authoriser.value
  if (!s) return
  // The PIN gate holds offline: refuse checks while the authoriser is locked out.
  if (lockout.isLockedOut(s.id)) {
    fail(t('staff.supervisorLocked'))
    return
  }
  const ok = await verifyPin(pin, s.pinHash, s.pinSalt)
  if (!ok) {
    const { locked } = lockout.recordFailure(s.id)
    fail(locked ? t('staff.supervisorLocked') : t('staff.wrongPin'))
    return
  }
  lockout.reset(s.id) // correct PIN — clear the authoriser's own failure counter
  error.value = ''
  step.value = 'set-pin'
}

async function verifyOwnerPassword() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    const res = await verifyAccountPassword(password.value)
    if (res.ok) {
      password.value = ''
      step.value = 'set-pin'
      return
    }
    // Owner recovery is the only path that needs the network; be explicit about it.
    error.value = res.reason === 'offline' ? t('staff.ownerNeedsOnline') : t('staff.wrongPassword')
  } finally {
    busy.value = false
  }
}

function onPin(pin: string) {
  if (step.value === 'set-pin') {
    firstPin.value = pin
    error.value = ''
    step.value = 'confirm-pin'
    return
  }
  if (step.value === 'confirm-pin') {
    if (pin !== firstPin.value) {
      firstPin.value = ''
      step.value = 'set-pin'
      fail(t('staff.pinsDontMatch'))
      return
    }
    void commitReset(pin)
  }
}

async function commitReset(pin: string) {
  if (busy.value) return
  busy.value = true
  try {
    if (authoriser.value) {
      // Supervisor path — actor is the authoriser, distinct from the target.
      await resetStaffPin(authoriser.value, props.target, pin)
    } else {
      // Owner self-recovery — actor is the owner themselves (== target).
      await updateStaffPin(props.target.id, pin, { id: props.target.id, name: props.target.name })
    }
    step.value = 'done'
  } catch {
    // Defence in depth: the role rule also lives in resetStaffPin.
    firstPin.value = ''
    step.value = 'set-pin'
    fail(t('staff.notAllowed'))
  } finally {
    busy.value = false
  }
}

function back() {
  error.value = ''
  firstPin.value = ''
  if (step.value === 'choose') { emit('cancel'); return }
  if (step.value === 'supervisor-pin') { step.value = 'supervisor-pick'; return }
  // supervisor-pick, owner-password, set-pin, confirm-pin → back to the method choice
  step.value = 'choose'
}
</script>

<template>
  <div class="recovery" :dir="dir">
    <h2 class="title">{{ t('staff.recoveryTitle') }}</h2>
    <p class="subtitle">{{ t('staff.recoveryFor', { name: target.name }) }}</p>

    <p v-if="error" class="auth-error">{{ error }}</p>

    <!-- Choose a recovery method -->
    <template v-if="step === 'choose'">
      <p class="prompt">{{ t('staff.chooseMethod') }}</p>
      <div class="method-list">
        <button v-if="canUseSupervisor" type="button" class="method-btn" @click="chooseSupervisor">
          <span class="method-label">{{ t('staff.bySupervisor') }}</span>
          <span class="method-hint">{{ t('staff.bySupervisorHint') }}</span>
        </button>
        <button v-if="showOwnerPath" type="button" class="method-btn" @click="chooseOwner">
          <span class="method-label">{{ t('staff.byOwner') }}</span>
          <span class="method-hint">{{ t('staff.byOwnerHint') }}</span>
        </button>
        <button v-if="showOwnerPath" type="button" class="method-btn" data-test="path-code" @click="chooseCode">
          <span class="method-label">{{ t('staff.byRecoveryCode') }}</span>
          <span class="method-hint">{{ t('staff.byRecoveryCodeHint') }}</span>
        </button>
        <p v-if="!canUseSupervisor && !showOwnerPath" class="note">{{ t('staff.noSupervisor') }}</p>
      </div>
      <button type="button" class="back-btn" @click="back">{{ t('common.cancel') }}</button>
    </template>

    <!-- Supervisor path: pick the authoriser -->
    <template v-else-if="step === 'supervisor-pick'">
      <p class="prompt">{{ t('staff.pickSupervisor') }}</p>
      <div class="staff-list">
        <button
          v-for="s in supervisors"
          :key="s.id"
          type="button"
          class="staff-btn"
          @click="pickSupervisor(s)"
        >
          <span class="staff-name">{{ s.name }}</span>
          <span class="staff-role">{{ roleLabel(s.role) }}</span>
        </button>
      </div>
      <button type="button" class="back-btn" @click="back">{{ t('common.back') }}</button>
    </template>

    <!-- Supervisor path: authoriser enters their own PIN -->
    <template v-else-if="step === 'supervisor-pin'">
      <p class="prompt">{{ t('staff.enterYourPin', { name: authoriser?.name }) }}</p>
      <PinPad ref="pinPadRef" @complete="onSupervisorPin" />
      <button type="button" class="back-btn" @click="back">{{ t('common.back') }}</button>
    </template>

    <!-- Owner path: re-enter the shop account password -->
    <template v-else-if="step === 'owner-password'">
      <p class="prompt">{{ t('staff.ownerPassword') }}</p>
      <div class="pw-card">
        <input
          v-model="password"
          type="password"
          class="pw-input"
          :placeholder="t('staff.passwordPlaceholder')"
          dir="ltr"
          autocomplete="current-password"
          @keydown.enter="verifyOwnerPassword"
        />
      </div>
      <button type="button" class="btn-primary" :disabled="busy || !password" @click="verifyOwnerPassword">
        {{ busy ? t('staff.saving') : t('staff.verify') }}
      </button>
      <button type="button" class="back-btn" @click="back">{{ t('common.back') }}</button>
    </template>

    <!-- Owner path: enter a saved recovery code (works offline) -->
    <template v-else-if="step === 'owner-code'">
      <p class="prompt">{{ t('staff.enterRecoveryCode') }}</p>
      <div class="pw-card">
        <input
          v-model="code"
          type="text"
          class="pw-input"
          data-test="code-input"
          :placeholder="t('staff.recoveryCodePlaceholder')"
          dir="ltr"
          autocomplete="one-time-code"
          @keydown.enter="submitRecoveryCode"
        />
      </div>
      <button type="button" class="btn-primary" data-test="code-submit" :disabled="busy || !code" @click="submitRecoveryCode">
        {{ busy ? t('staff.saving') : t('staff.verify') }}
      </button>
      <button type="button" class="back-btn" @click="back">{{ t('common.back') }}</button>
    </template>

    <!-- Set + confirm the new PIN -->
    <template v-else-if="step === 'set-pin' || step === 'confirm-pin'">
      <p class="prompt">
        {{ step === 'set-pin' ? t('staff.newPinFor', { name: target.name }) : t('staff.confirmNewPin') }}
      </p>
      <PinPad ref="pinPadRef" @complete="onPin" />
      <button type="button" class="back-btn" @click="back">{{ t('common.back') }}</button>
    </template>

    <!-- Done -->
    <template v-else-if="step === 'done'">
      <p class="success">{{ t('staff.resetDone') }}</p>
      <p class="note">{{ t('staff.multiDeviceNote') }}</p>
      <button type="button" class="btn-primary" @click="emit('done')">{{ t('common.confirm') }}</button>
    </template>
  </div>
</template>

<style scoped>
.recovery {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.title  { font-size: 1.125rem; font-weight: 800; color: #E8EDF5; text-align: center; }
.subtitle { font-size: 0.8125rem; color: #637285; margin-bottom: 0.75rem; text-align: center; }
.prompt { font-size: 0.9375rem; font-weight: 700; color: #C8D5E8; margin: 0.25rem 0 0.75rem; text-align: center; }
.note   { font-size: 0.78rem; color: #8EA3BF; line-height: 1.5; text-align: center; }
.success { font-size: 0.95rem; font-weight: 700; color: #4ADE80; text-align: center; }

.auth-error {
  font-size: 0.8125rem; color: #FCA5A5; text-align: center;
  background: rgba(239, 68, 68, 0.10); border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 0.625rem; padding: 0.5rem 0.875rem; margin-bottom: 0.5rem; width: 100%;
}

.method-list, .staff-list {
  display: flex; flex-direction: column; gap: 0.625rem; width: 100%;
}

.method-btn {
  display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem;
  width: 100%; padding: 0.85rem 1rem; border-radius: 0.875rem;
  border: 1px solid rgba(26, 86, 219, 0.30); background: rgba(26, 86, 219, 0.10);
  color: #E8EDF5; cursor: pointer; text-align: start;
  font-family: inherit; transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.method-btn:hover { background: rgba(26, 86, 219, 0.18); border-color: rgba(26, 86, 219, 0.45); }
.method-btn:active { transform: scale(0.98); }
.method-label { font-size: 0.9rem; font-weight: 700; }
.method-hint  { font-size: 0.74rem; color: #8EA3BF; line-height: 1.4; }

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

.pw-card {
  display: flex; align-items: center; width: 100%;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.875rem; padding: 0.875rem 1rem; transition: border-color 0.15s, box-shadow 0.15s;
}
.pw-card:focus-within { border-color: rgba(26, 86, 219, 0.8); box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25); }
.pw-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: #E8EDF5; font-size: 1.1rem; font-weight: 600; font-family: inherit;
}
.pw-input::placeholder { color: #3D4F6B; }

.btn-primary {
  width: 100%; height: 50px; margin-top: 0.75rem; border-radius: 0.875rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff;
  font-size: 1rem; font-weight: 700; font-family: inherit; border: none; cursor: pointer;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.40); transition: opacity 0.15s, transform 0.1s;
}
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-primary:active:not(:disabled) { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.back-btn {
  margin-top: 1rem; padding: 0.5rem 1rem; border-radius: 0.75rem;
  background: transparent; border: 1px solid rgba(255, 255, 255, 0.14);
  color: #637285; font-size: 0.875rem; font-family: inherit; cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.back-btn:hover { color: #C8D5E8; background: rgba(255, 255, 255, 0.05); }
</style>
