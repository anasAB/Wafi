<script setup lang="ts">
import { ref } from 'vue'
import { useSessionStore } from '@/store/session.store'
import { verifyPin }     from '@/features/staff/composables/usePinAuth'
import { usePinLockout } from '@/features/staff/composables/usePinLockout'
import { useAuditLog }   from '@/features/audit/composables/useAuditLog'
import { useDeviceStore } from '@/store/device.store'
import PinPad            from '@/features/staff/components/PinPad.vue'
import LockScreen        from '@/features/shifts/components/LockScreen.vue'

// Emitted once the operator re-authenticates — the parent resumes the prior screen
// with the open shift untouched (WAFI-062).
const emit = defineEmits<{ unlock: [] }>()

const session = useSessionStore()
const lockout = usePinLockout()
const { logLoginFailed, logLockedOut } = useAuditLog()

// 'pin': re-enter the CURRENT operator's PIN to resume.
// 'switch': hand the still-open shift to another operator (reuses the switch flow,
// which sets the session without opening a new shift or taking a cash count).
const view      = ref<'pin' | 'switch'>('pin')
const pinPadRef = ref<InstanceType<typeof PinPad> | null>(null)
const authError = ref('')

async function onPinComplete(pin: string) {
  const s = session.activeStaff
  if (!s) { view.value = 'switch'; return }   // no operator → must re-pick

  if (lockout.isLockedOut(s.id)) {
    authError.value = 'الحساب مقفل مؤقتاً بسبب محاولات خاطئة. حاول لاحقاً.'
    pinPadRef.value?.shake()
    return
  }

  const ok = await verifyPin(pin, s.pinHash, s.pinSalt)
  if (!ok) {
    pinPadRef.value?.shake()
    const { locked, minutes } = lockout.recordFailure(s.id, useDeviceStore().shopId)
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

  lockout.reset(s.id)
  authError.value = ''
  emit('unlock')
}
</script>

<template>
  <div class="idle-root" dir="rtl">
    <!-- Operator re-auth: resume the SAME shift, nothing is closed -->
    <div v-if="view === 'pin'" class="idle-card">
      <div class="idle-lock-icon" aria-hidden="true">
        <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>
      <p class="idle-title">القفل التلقائي</p>
      <p class="idle-sub">مرحباً {{ session.activeStaff?.name }} — أدخل رقمك السري للمتابعة</p>
      <p v-if="authError" class="idle-error">{{ authError }}</p>
      <PinPad ref="pinPadRef" @complete="onPinComplete" />
      <button type="button" class="idle-signout" @click="view = 'switch'">تسجيل خروج</button>
    </div>

    <!-- Full sign-out path: another operator re-authenticates into the open shift.
         The shift is NOT closed (Story 5.2) — switch mode never touches it. -->
    <LockScreen
      v-else
      mode="switch"
      @done="emit('unlock')"
      @cancel="view = 'pin'; authError = ''"
    />
  </div>
</template>

<style scoped>
.idle-root {
  position: fixed;
  inset: 0;
  z-index: 60;          /* above the app shell, below nothing else */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  /* Dim the previous screen (Screen 11) rather than hide it */
  background: rgba(6, 9, 15, 0.92);
  backdrop-filter: blur(10px);
  font-family: 'Tajawal', system-ui, sans-serif;
}

.idle-card {
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

.idle-lock-icon {
  width: 56px; height: 56px; border-radius: 16px; margin-bottom: 1rem;
  display: flex; align-items: center; justify-content: center;
  color: #60A5FA; background: rgba(26, 86, 219, 0.14); border: 1px solid rgba(26, 86, 219, 0.30);
}

.idle-title { font-size: 1.25rem; font-weight: 800; color: #E8EDF5; margin: 0 0 0.25rem; }
.idle-sub   { font-size: 0.8125rem; color: #637285; margin: 0 0 1.25rem; text-align: center; }

.idle-error {
  font-size: 0.8125rem; color: #FCA5A5; text-align: center;
  background: rgba(239, 68, 68, 0.10); border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 0.625rem; padding: 0.5rem 0.875rem; margin-bottom: 0.75rem; width: 100%;
}

.idle-signout {
  margin-top: 1.25rem; padding: 0.5rem 1rem; border-radius: 0.75rem;
  background: transparent; border: 1px solid rgba(255, 255, 255, 0.14);
  color: #93B4F0; font-size: 0.875rem; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.idle-signout:hover { color: #C8D5E8; background: rgba(255, 255, 255, 0.05); }
</style>
