import { ref, computed } from 'vue'
import { defineStore }   from 'pinia'
import type { Staff, StaffPermissions } from '@/features/staff/staff.types'

export const useShiftStore = defineStore('shift', () => {
  const activeShiftId = ref<string | null>(null)
  const activeStaff   = ref<Staff | null>(null)

  const isShiftOpen = computed(() => activeShiftId.value !== null)
  const permissions = computed<StaffPermissions | null>(() => activeStaff.value?.permissions ?? null)

  function openShift(shiftId: string, staff: Staff) {
    activeShiftId.value = shiftId
    activeStaff.value   = staff
  }

  function closeShift() {
    activeShiftId.value = null
    activeStaff.value   = null
  }

  return { activeShiftId, activeStaff, isShiftOpen, permissions, openShift, closeShift }
}, {
  persist: true,
})
