import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

function makePinia() {
  const pinia = createPinia()
  pinia.use(({ store }) => {
    const orig = store.$subscribe.bind(store)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.$subscribe = (cb: any, opts: any = {}) => orig(cb, { flush: 'sync', ...opts })
  })
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  return pinia
}

const mockStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'أحمد', pinHash: 'abc', pinSalt: null,
  role: 'cashier',
  permissions: {
    can_view_reports: false, can_manage_products: false,
    can_manage_customers: false, can_view_expenses: false, can_manage_settings: false,
    can_manage_inventory: false, can_manage_suppliers: false, can_manage_stock_take: false,
    can_view_staff_ledger: false, can_view_staff_performance: false,
  },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useSessionStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(makePinia())
  })

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

  it('persists activeStaff to localStorage', () => {
    const store = useSessionStore()
    store.setActiveStaff(mockStaff)
    const saved = JSON.parse(localStorage.getItem('session') ?? '{}')
    expect(saved.activeStaff?.id).toBe('staff-1')
  })

  it('restores activeStaff on next mount', () => {
    const store = useSessionStore()
    store.setActiveStaff(mockStaff)

    setActivePinia(makePinia())
    const restored = useSessionStore()
    expect(restored.activeStaff?.id).toBe('staff-1')
    expect(restored.activeStaff?.name).toBe('أحمد')
  })

  // The session store is the single source of truth for the *active operator*
  // (WAFI-011): route guards and nav read permissions from here, not shiftStore.
  it('permissions is null with no active staff', () => {
    expect(useSessionStore().permissions).toBeNull()
  })

  it('permissions reflects the active staff permissions', () => {
    const store = useSessionStore()
    store.setActiveStaff(mockStaff)
    expect(store.permissions?.can_manage_products).toBe(false)
  })
})
