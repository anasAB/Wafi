import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '@/store/session.store'
import { executeFinancialWrite } from '@/features/staff-ledger/composables/executeFinancialWrite'
import type { Staff } from '@/features/staff/staff.types'

const grantedStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'Ahmed', pinHash: 'x', pinSalt: null,
  role: 'manager',
  permissions: { can_view_reports: false, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: false },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

const cashierStaff: Staff = {
  ...grantedStaff, id: 'staff-2', role: 'cashier',
  permissions: { ...grantedStaff.permissions, can_view_expenses: false },
}

describe('executeFinancialWrite', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('runs the write and audit callback when the active staff has can_view_expenses', async () => {
    useSessionStore().setActiveStaff(grantedStaff)
    const write = vi.fn().mockResolvedValue('result')
    const audit = vi.fn().mockResolvedValue(undefined)

    const result = await executeFinancialWrite(write, audit)

    expect(result).toBe('result')
    expect(write).toHaveBeenCalledOnce()
    expect(audit).toHaveBeenCalledWith('result')
  })

  it('throws and never calls write when the active staff lacks can_view_expenses', async () => {
    useSessionStore().setActiveStaff(cashierStaff)
    const write = vi.fn()
    const audit = vi.fn()

    await expect(executeFinancialWrite(write, audit)).rejects.toThrow(/permission/i)
    expect(write).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('throws when there is no active staff (fail closed)', async () => {
    const write = vi.fn()
    const audit = vi.fn()
    await expect(executeFinancialWrite(write, audit)).rejects.toThrow(/permission/i)
    expect(write).not.toHaveBeenCalled()
  })
})
