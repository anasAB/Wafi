import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Staff } from '@/features/staff/staff.types'

export const useSessionStore = defineStore('session', () => {
  const activeStaff = ref<Staff | null>(null)

  function setActiveStaff(staff: Staff) {
    activeStaff.value = staff
  }

  function clearSession() {
    activeStaff.value = null
  }

  return { activeStaff, setActiveStaff, clearSession }
}, { persist: true })
