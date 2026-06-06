import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

const mockStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'أحمد', pinHash: 'abc',
  role: 'cashier',
  permissions: {
    can_view_reports: false, can_manage_products: false,
    can_manage_customers: false, can_view_expenses: false, can_manage_settings: false,
  },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useSessionStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts with activeStaff as null', () => {
    const store = useSessionStore()
    expect(store.activeStaff).toBeNull()
  })

  it('setActiveStaff sets the staff member', () => {
    const store = useSessionStore()
    store.setActiveStaff(mockStaff)
    expect(store.activeStaff?.id).toBe('staff-1')
    expect(store.activeStaff?.name).toBe('أحمد')
  })

  it('clearSession resets activeStaff to null', () => {
    const store = useSessionStore()
    store.setActiveStaff(mockStaff)
    store.clearSession()
    expect(store.activeStaff).toBeNull()
  })
})
