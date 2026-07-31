import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { addLedgerEntry, paySettlement, openShift, closeShift } from '@/services/staff.service'
import { useSessionStore } from '@/store/session.store'
import type { NewStaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'
import type { Staff } from '@/features/staff/staff.types'

const mockOwner: Staff = {
  id: 'owner1', shopId: 'shop1', name: 'المالك', pinHash: 'x', pinSalt: null,
  role: 'owner', permissions: {} as any, isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('StaffService.addLedgerEntry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().setActiveStaff(mockOwner)
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  const baseEntry: NewStaffLedgerEntry = {
    staffId: 'staff1', entryType: 'advance', amount: 50, currency: 'usd',
  }
  const fakeAudit = { logStaffLedgerEntryCreated: vi.fn().mockResolvedValue(undefined) }

  it('rejects a zero or negative amount', async () => {
    await expect(addLedgerEntry('shop1', 'creator1', { ...baseEntry, amount: 0 }, fakeAudit)).rejects.toThrow()
    await expect(addLedgerEntry('shop1', 'creator1', { ...baseEntry, amount: -10 }, fakeAudit)).rejects.toThrow()
  })

  it('rejects a missing lockedRate when currency is syp', async () => {
    await expect(
      addLedgerEntry('shop1', 'creator1', { ...baseEntry, currency: 'syp' }, fakeAudit),
    ).rejects.toThrow()
  })

  it('rejects a negative lockedRate', async () => {
    await expect(
      addLedgerEntry('shop1', 'creator1', { ...baseEntry, currency: 'syp', lockedRate: -1 }, fakeAudit),
    ).rejects.toThrow()
  })

  it('inserts a ledger entry when validation passes', async () => {
    await addLedgerEntry('shop1', 'creator1', baseEntry, fakeAudit)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO staff_ledger'),
      expect.any(Array),
    )
  })

  it('converts a SYP entry to USD using lockedRate', async () => {
    const result = await addLedgerEntry('shop1', 'creator1', { ...baseEntry, currency: 'syp', amount: 150000, lockedRate: 15000 }, fakeAudit)
    expect(result.amountUsd).toBe(10)
  })

  it('calls the injected audit port with the created entry id/staffId/type/amount', async () => {
    const result = await addLedgerEntry('shop1', 'creator1', baseEntry, fakeAudit)
    expect(fakeAudit.logStaffLedgerEntryCreated).toHaveBeenCalledWith(
      result.id, result.staffId, result.entryType, result.amountUsd,
    )
  })
})

describe('StaffService.paySettlement', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().setActiveStaff(mockOwner)
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  const fakeSettlementAudit = { logStaffSettlementPaid: vi.fn().mockResolvedValue(undefined) }

  it('marks the settlement paid with the given payment method', async () => {
    await paySettlement('settle1', 'staff1', 'owner1', 'cash', fakeSettlementAudit)
    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain(`SET status = 'paid'`)
    expect(params).toContain('owner1')
    expect(params).toContain('cash')
    expect(params).toContain('settle1')
  })

  it('calls the injected audit port', async () => {
    await paySettlement('settle1', 'staff1', 'owner1', 'bank', fakeSettlementAudit)
    expect(fakeSettlementAudit.logStaffSettlementPaid).toHaveBeenCalledWith('settle1', 'staff1', 'bank')
  })
})

describe('StaffService.openShift', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  const fakeOpenAudit = { logShiftOpened: vi.fn().mockResolvedValue(undefined) }

  it('inserts a new open shift row', async () => {
    const result = await openShift('shop1', 'device1', 'staff1', {
      openingCashUsd: 100, openingCashSyp: 0, openingBreakdown: null,
    }, fakeOpenAudit)

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cashier_shifts'),
      expect.any(Array),
    )
    expect(result.id).toBeTruthy()
  })

  it('calls the injected audit port with the new shift id', async () => {
    const result = await openShift('shop1', 'device1', 'staff1', {
      openingCashUsd: 100, openingCashSyp: 0, openingBreakdown: null,
    }, fakeOpenAudit)
    expect(fakeOpenAudit.logShiftOpened).toHaveBeenCalledWith(result.id)
  })
})

describe('StaffService.closeShift', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  const fakeCloseAudit = { logShiftClosed: vi.fn().mockResolvedValue(undefined) }

  it('updates the shift to closed with variance and always force_closed_by = null', async () => {
    await closeShift('shop1', 'shift1', 'staff1', {
      closingCashUsd: 230, closingCashSyp: 0, varianceUsd: -20, varianceSyp: 0,
      closeNote: null, zReport: null, closingBreakdown: null,
    }, fakeCloseAudit)

    const [sql, params] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).toContain(`status = 'closed'`)
    expect(params).toContain(-20)
    expect(params[6]).toBeNull()  // force_closed_by always null on the normal-close path
  })

  it('calls the injected audit port with the shift id', async () => {
    await closeShift('shop1', 'shift1', 'staff1', {
      closingCashUsd: 230, closingCashSyp: 0, varianceUsd: 0, varianceSyp: 0,
      closeNote: null, zReport: null, closingBreakdown: null,
    }, fakeCloseAudit)
    expect(fakeCloseAudit.logShiftClosed).toHaveBeenCalledWith('shift1')
  })
})
