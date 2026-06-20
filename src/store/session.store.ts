import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Staff, StaffPermissions } from '@/features/staff/staff.types'

export const useSessionStore = defineStore('session', () => {
  const activeStaff = ref<Staff | null>(null)

  // Permissions of the active operator. Route guards and nav read this — the
  // single active-operator source (WAFI-011) — so a "switch operator" re-scopes
  // the UI without touching the shift. Null when nobody is logged in.
  const permissions = computed<StaffPermissions | null>(
    () => activeStaff.value?.permissions ?? null,
  )

  function setActiveStaff(staff: Staff) {
    activeStaff.value = staff
  }

  function clearSession() {
    activeStaff.value = null
  }

  return { activeStaff, permissions, setActiveStaff, clearSession }
// Persists full Staff object so staff don't re-enter PIN after page refresh (trusted device assumption).
}, { persist: true })
