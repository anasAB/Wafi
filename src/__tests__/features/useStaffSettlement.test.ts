import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

describe('useStaffSettlement.createDraft', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
  })

  it('creates a new draft and returns resumed: false when none exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { createDraft } = useStaffSettlement()
    const { settlement, resumed } = await createDraft('emp-1', '2026-03-01')

    expect(resumed).toBe(false)
    expect(settlement.status).toBe('draft')
    expect(settlement.periodMonth).toBe('2026-03-01')
  })

  it('returns the existing draft and resumed: true when one already exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null,
      settlement_currency: null, locked_rate: null, applied_amount_usd: null,
      final_amount_usd: null, notes: null, staff_name_snapshot: null, staff_role_snapshot: null,
      finalized_at: null, paid_at: null, paid_by_staff_id: null, payment_method: null,
      client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { createDraft } = useStaffSettlement()
    const { settlement, resumed } = await createDraft('emp-1', '2026-03-01')

    expect(resumed).toBe(true)
    expect(settlement.id).toBe('settle-1')
    expect(db.execute).not.toHaveBeenCalled()
  })
})

describe('useStaffSettlement.applyLedgerEntry', () => {
  it('rejects an apply amount greater than the entry remaining amount', async () => {
    const { applyLedgerEntry } = useStaffSettlement()
    const entry = { id: 'l-1', amountUsd: 100 } as any
    expect(() => applyLedgerEntry(entry, 150)).toThrow(/exceeds/i)
  })

  it('returns the applied portion and the carry-forward remainder for a partial apply', () => {
    const { applyLedgerEntry } = useStaffSettlement()
    const entry = { id: 'l-1', amountUsd: 100 } as any
    const result = applyLedgerEntry(entry, 70)
    expect(result.appliedAmountUsd).toBe(70)
    expect(result.carryForwardAmountUsd).toBe(30)
  })

  it('produces zero carry-forward for a full apply', () => {
    const { applyLedgerEntry } = useStaffSettlement()
    const entry = { id: 'l-1', amountUsd: 100 } as any
    const result = applyLedgerEntry(entry, 100)
    expect(result.carryForwardAmountUsd).toBe(0)
  })
})
