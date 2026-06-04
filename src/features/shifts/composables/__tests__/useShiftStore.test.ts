import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia }       from 'pinia'
import { useShiftStore }                     from '../../shift.store'
import type { Staff }                        from '@/features/staff/staff.types'

const mockStaff: Staff = {
  id:          'staff-1',
  shopId:      'shop-1',
  name:        'محمد',
  pinHash:     'abc123',
  role:        'cashier',
  permissions: {
    can_view_reports:     false,
    can_manage_products:  true,
    can_manage_customers: false,
    can_view_expenses:    false,
    can_manage_settings:  false,
  },
  isActive:  true,
  createdAt: '2026-01-01T00:00:00Z',
}

describe('useShiftStore', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('starts with no active shift', () => {
    const store = useShiftStore()
    expect(store.isShiftOpen).toBe(false)
    expect(store.activeShiftId).toBeNull()
    expect(store.activeStaff).toBeNull()
  })

  it('openShift sets active shift and staff', () => {
    const store = useShiftStore()
    store.openShift('shift-123', mockStaff)
    expect(store.isShiftOpen).toBe(true)
    expect(store.activeShiftId).toBe('shift-123')
    expect(store.activeStaff).toEqual(mockStaff)
  })

  it('closeShift clears all state', () => {
    const store = useShiftStore()
    store.openShift('shift-123', mockStaff)
    store.closeShift()
    expect(store.isShiftOpen).toBe(false)
    expect(store.activeShiftId).toBeNull()
    expect(store.activeStaff).toBeNull()
  })

  it('permissions returns active staff permissions', () => {
    const store = useShiftStore()
    store.openShift('shift-123', mockStaff)
    expect(store.permissions?.can_manage_products).toBe(true)
    expect(store.permissions?.can_view_reports).toBe(false)
  })

  it('permissions returns null when no shift open', () => {
    const store = useShiftStore()
    expect(store.permissions).toBeNull()
  })
})
