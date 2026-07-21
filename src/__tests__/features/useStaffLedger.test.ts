import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { db } from '@/data/powersync/db'
import { useSessionStore } from '@/store/session.store'
import { useDeviceStore } from '@/store/device.store'
import type { Staff } from '@/features/staff/staff.types'

const ownerStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'المالك', pinHash: 'x', pinSalt: null, role: 'owner',
  permissions: { can_view_reports: true, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: true, can_manage_inventory: true, can_manage_suppliers: true, can_manage_stock_take: true, can_view_staff_ledger: true },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useStaffLedger.addLedgerEntry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().setActiveStaff(ownerStaff)
    useDeviceStore().shopId = 'shop-1'
  })

  it('inserts a positive-amount USD advance row with no locked_rate', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { addLedgerEntry } = useStaffLedger()
    await addLedgerEntry({ staffId: 'emp-1', entryType: 'advance', amount: 100, currency: 'usd' })

    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain('INSERT INTO staff_ledger')
    expect(params).toContain(100)         // amount_usd stored positive
    expect(params).toContain('advance')
    expect(params).toContain('usd')
  })

  it('rejects a negative or zero amount before hitting the DB', async () => {
    const { addLedgerEntry } = useStaffLedger()
    await expect(
      addLedgerEntry({ staffId: 'emp-1', entryType: 'advance', amount: -10, currency: 'usd' }),
    ).rejects.toThrow(/positive/i)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('requires lockedRate when currency is syp', async () => {
    const { addLedgerEntry } = useStaffLedger()
    await expect(
      addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 50000, currency: 'syp' }),
    ).rejects.toThrow(/rate/i)
  })

  it('converts SYP amount to amount_usd using the provided locked rate', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    const { addLedgerEntry } = useStaffLedger()
    await addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 145000, currency: 'syp', lockedRate: 14500 })

    const [, params] = vi.mocked(db.execute).mock.calls[0]
    expect(params).toContain(10) // 145000 / 14500
  })

  it('rejects a SYP amount that rounds to zero amount_usd after conversion', async () => {
    const { addLedgerEntry } = useStaffLedger()
    await expect(
      addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 1, currency: 'syp', lockedRate: 14500 }),
    ).rejects.toThrow(/positive/i)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('rejects a negative lockedRate', async () => {
    const { addLedgerEntry } = useStaffLedger()
    await expect(
      addLedgerEntry({ staffId: 'emp-1', entryType: 'bonus', amount: 50000, currency: 'syp', lockedRate: -14500 }),
    ).rejects.toThrow(/rate/i)
    expect(db.execute).not.toHaveBeenCalled()
  })
})

describe('useStaffLedger.getOutstandingEntries', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('groups outstanding entries by currency_entered', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: '1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
      { id: '2', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'bonus', amount_usd: 10, currency_entered: 'syp', locked_rate: 14500, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'b', settlement_id: null, created_at: '2026-03-02T00:00:00Z' },
    ] as any)

    const { getOutstandingEntries } = useStaffLedger()
    const result = await getOutstandingEntries('emp-1')

    expect(result.usd).toHaveLength(1)
    expect(result.syp).toHaveLength(1)
    expect(result.usd[0].amountUsd).toBe(100)
  })
})
