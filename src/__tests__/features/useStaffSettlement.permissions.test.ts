import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { useSessionStore } from '@/store/session.store'
import { useDeviceStore } from '@/store/device.store'
import { db } from '@/data/powersync/db'
import type { Staff } from '@/features/staff/staff.types'

function staffWith(role: Staff['role'], canViewExpenses: boolean): Staff {
  return {
    id: `staff-${role}`, shopId: 'shop-1', name: role, pinHash: 'x', pinSalt: null, role,
    permissions: { can_view_reports: false, can_manage_products: true, can_manage_customers: true, can_view_expenses: canViewExpenses, can_manage_settings: false },
    isActive: true, createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('staff ledger write permission gating (defense in depth)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('owner can add a ledger entry', async () => {
    useSessionStore().setActiveStaff(staffWith('owner', false)) // owner ignores the flag, always true
    const { addLedgerEntry } = useStaffLedger()
    await expect(addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 10, currency: 'usd' })).resolves.toBeDefined()
  })

  it('manager with can_view_expenses granted can add a ledger entry', async () => {
    useSessionStore().setActiveStaff(staffWith('manager', true))
    const { addLedgerEntry } = useStaffLedger()
    await expect(addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 10, currency: 'usd' })).resolves.toBeDefined()
  })

  it('cashier cannot add a ledger entry, even with a direct composable call bypassing the router', async () => {
    useSessionStore().setActiveStaff(staffWith('cashier', false))
    const { addLedgerEntry } = useStaffLedger()
    await expect(addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 10, currency: 'usd' })).rejects.toThrow(/permission/i)
    expect(db.execute).not.toHaveBeenCalled()
  })
})
