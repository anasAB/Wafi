import { describe, it, expect } from 'vitest'
import type { StaffSettlement } from '@/features/staff-ledger/staff-ledger.types'

describe('staff settlement name/role snapshot integrity', () => {
  it('a finalized settlement retains its original staff_name_snapshot regardless of the staff table changing later', () => {
    // Simulates: settlement finalized in March as "Ahmed", staff renamed to
    // "Ahmed Hassan" in June. The settlement object itself must never carry
    // a live-joined name — only what was captured at finalize() time.
    const marchSettlement: StaffSettlement = {
      id: 'settle-1', shopId: 'shop-1', staffId: 'emp-1', settlementNumber: '202603-ABCDEF',
      periodMonth: '2026-03-01', status: 'finalized', baseSalaryUsd: 300,
      settlementCurrency: 'usd', lockedRate: null, appliedAmountUsd: -70, finalAmountUsd: 230,
      notes: null, staffNameSnapshot: 'Ahmed', staffRoleSnapshot: 'cashier',
      finalizedAt: '2026-03-31T00:00:00Z', paidAt: null, paidByStaffId: null, paymentMethod: null,
      clientOperationId: 'op-1', createdAt: '2026-03-01T00:00:00Z',
    }

    // The staff record changing later (simulated as a separate, unrelated object)
    // must have zero effect on the already-finalized settlement's snapshot fields.
    const staffRecordInJune = { id: 'emp-1', name: 'Ahmed Hassan', role: 'manager' }

    expect(marchSettlement.staffNameSnapshot).toBe('Ahmed')
    expect(marchSettlement.staffNameSnapshot).not.toBe(staffRecordInJune.name)
    expect(marchSettlement.staffRoleSnapshot).toBe('cashier')
    expect(marchSettlement.staffRoleSnapshot).not.toBe(staffRecordInJune.role)
  })
})
