<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useStaff }        from '@/features/staff/composables/useStaff'
import { verifyPin }       from '@/features/staff/composables/usePinAuth'
import { useSessionStore } from '@/store/session.store'
import type { Staff }      from '@/features/staff/staff.types'

const { staff, loadStaff }   = useStaff()
const session                = useSessionStore()

const selected  = ref<Staff | null>(null)
const pin       = ref('')
const error     = ref('')
const verifying = ref(false)

onMounted(loadStaff)

function selectStaff(s: Staff) {
  selected.value = s
  pin.value      = ''
  error.value    = ''
}

function onKey(k: string) {
  if (pin.value.length < 4) pin.value += k
}

function onDelete() {
  pin.value = pin.value.slice(0, -1)
}

async function onConfirm() {
  if (!selected.value || pin.value.length !== 4) return
  verifying.value = true
  error.value     = ''
  try {
    const ok = await verifyPin(pin.value, selected.value.pinHash)
    if (ok) {
      session.setActiveStaff(selected.value)
    } else {
      error.value = 'رمز PIN غير صحيح'
      pin.value   = ''
    }
  } finally {
    verifying.value = false
  }
}
</script>

<template>
  <div class="overlay" dir="rtl">
    <div class="sheet">
      <div class="sheet-handle" />
      <div class="sheet-body">

        <h2 class="title">من أنت؟</h2>

        <!-- Staff list -->
        <div v-if="!selected" class="staff-list">
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

        <!-- PIN entry -->
        <template v-else>
          <p class="pin-label">أدخل رمز PIN لـ {{ selected.name }}</p>

          <!-- Dots -->
          <div class="pin-dots">
            <span
              v-for="i in 4" :key="i"
              class="dot"
              :class="pin.length >= i ? 'dot--filled' : 'dot--empty'"
            />
          </div>

          <p v-if="error" class="pin-error">{{ error }}</p>

          <!-- Keypad -->
          <div class="keypad">
            <button
              v-for="k in ['1','2','3','4','5','6','7','8','9','←','0','✓']"
              :key="k"
              type="button"
              class="key"
              :class="{ 'key--action': k === '✓' || k === '←' }"
              :disabled="verifying"
              @click="k === '←' ? onDelete() : k === '✓' ? onConfirm() : onKey(k)"
            >{{ k }}</button>
          </div>

          <button type="button" class="back-btn" @click="selected = null; pin = ''; error = ''">
            رجوع
          </button>
        </template>

      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(0,0,0,0.85); backdrop-filter: blur(4px);
}
.sheet {
  width: 100%; max-width: 28rem;
  border-radius: 1.25rem 1.25rem 0 0;
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.45);
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}
.sheet-handle {
  width: 2.5rem; height: 0.25rem; border-radius: 9999px;
  background: rgba(255,255,255,0.20); margin: 0.75rem auto 0;
}
.sheet-body { padding: 1.25rem 1.25rem 2rem; font-family: 'Tajawal', system-ui, sans-serif; }
.title { font-size: 1rem; font-weight: 700; color: #E8EDF5; margin-bottom: 1.25rem; }
.staff-list { display: flex; flex-direction: column; gap: 0.5rem; }
.staff-btn {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.875rem 1rem; border-radius: 0.75rem; border: none; cursor: pointer;
  background: rgba(255,255,255,0.06); color: #E8EDF5;
  font-family: 'Tajawal', system-ui, sans-serif; font-size: 0.9375rem; font-weight: 600;
  transition: background 0.15s;
}
.staff-btn:hover { background: rgba(26,86,219,0.16); }
.staff-role { font-size: 0.75rem; color: #637285; font-weight: 400; }
.pin-label { font-size: 0.875rem; color: #C8D5E8; margin-bottom: 1.25rem; text-align: center; }
.pin-dots { display: flex; justify-content: center; gap: 1rem; margin-bottom: 0.75rem; }
.dot { width: 0.875rem; height: 0.875rem; border-radius: 50%; }
.dot--filled { background: #1A56DB; }
.dot--empty  { background: rgba(255,255,255,0.18); }
.pin-error { font-size: 0.75rem; color: #EF4444; text-align: center; margin-bottom: 0.5rem; }
.keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-top: 0.75rem; }
.key {
  height: 3rem; border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.06); color: #E8EDF5;
  font-size: 1.125rem; font-weight: 600; font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer; transition: background 0.12s;
}
.key:hover:not(:disabled) { background: rgba(26,86,219,0.16); }
.key--action { background: rgba(26,86,219,0.20); color: #60A5FA; }
.key:disabled { opacity: 0.5; }
.back-btn {
  display: block; width: 100%; margin-top: 1rem; padding: 0.625rem;
  border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.12);
  background: transparent; color: #637285;
  font-family: 'Tajawal', system-ui, sans-serif; font-size: 0.875rem; cursor: pointer;
}
</style>
