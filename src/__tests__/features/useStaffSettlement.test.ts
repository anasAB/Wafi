import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'

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

describe('useStaffSettlement.finalize', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    const session = useSessionStore()
    session.setActiveStaff({
      id: 'staff-1', shopId: 'shop-1', name: 'المالك', pinHash: 'x', pinSalt: null, role: 'owner',
      permissions: { can_view_reports: true, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: true },
      isActive: true, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('runs all writes inside a single db.writeTransaction', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null, settlement_currency: null,
      locked_rate: null, applied_amount_usd: null, final_amount_usd: null, notes: null,
      staff_name_snapshot: null, staff_role_snapshot: null, finalized_at: null, paid_at: null,
      paid_by_staff_id: null, payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { finalize } = useStaffSettlement()
    await finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: 'Paid early for Eid',
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 70 }],
    })

    expect(db.writeTransaction).toHaveBeenCalledOnce()
    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes("INSERT INTO staff_ledger") && sql.includes('carry_forward'))).toBe(true)
    expect(calls.some(sql => sql.includes('UPDATE staff_ledger') && sql.includes('settlement_id'))).toBe(true)
    expect(calls.some(sql => sql.includes("UPDATE staff_settlements") && sql.includes("'finalized'"))).toBe(true)
  })

  it('allows a negative final_amount_usd when advances exceed base salary', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 450, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null, settlement_currency: null,
      locked_rate: null, applied_amount_usd: null, final_amount_usd: null, notes: null,
      staff_name_snapshot: null, staff_role_snapshot: null, finalized_at: null, paid_at: null,
      paid_by_staff_id: null, payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { finalize } = useStaffSettlement()
    const settlement = await finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: null,
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 450 }],
    })

    expect(settlement.finalAmountUsd).toBe(-150) // 300 - 450
  })

  it('throws and rolls back if a re-read applied amount now exceeds the ledger row\'s remaining amount', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 50, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'draft', base_salary_usd: null, settlement_currency: null,
      locked_rate: null, applied_amount_usd: null, final_amount_usd: null, notes: null,
      staff_name_snapshot: null, staff_role_snapshot: null, finalized_at: null, paid_at: null,
      paid_by_staff_id: null, payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { finalize } = useStaffSettlement()
    await expect(finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: null,
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 100 }], // > 50 remaining
    })).rejects.toThrow(/exceeds/i)
    expect(db.writeTransaction).not.toHaveBeenCalled()
  })

  it('rejects finalize() when the settlement is already finalized/paid', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l-1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'finalized', base_salary_usd: 300, settlement_currency: 'usd',
      locked_rate: null, applied_amount_usd: -70, final_amount_usd: 230, notes: null,
      staff_name_snapshot: null, staff_role_snapshot: null, finalized_at: '2026-03-02T00:00:00Z', paid_at: null,
      paid_by_staff_id: null, payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { finalize } = useStaffSettlement()
    await expect(finalize('settle-1', 'emp-1', {
      settlementCurrency: 'usd', baseSalaryUsd: 300, notes: null,
      applications: [{ ledgerEntryId: 'l-1', applyAmountUsd: 70 }],
    })).rejects.toThrow(/already finalized/i)
    expect(db.writeTransaction).not.toHaveBeenCalled()
  })
})

describe('useStaffSettlement.markPaid', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useDeviceStore().shopId = 'shop-1'
    useSessionStore().setActiveStaff({
      id: 'staff-1', shopId: 'shop-1', name: 'المالك', pinHash: 'x', pinSalt: null, role: 'owner',
      permissions: { can_view_reports: true, can_manage_products: true, can_manage_customers: true, can_view_expenses: true, can_manage_settings: true },
      isActive: true, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('sets paid_at/paid_by/payment_method and status without touching amount columns', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 'settle-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABCDEF',
      period_month: '2026-03-01', status: 'paid', base_salary_usd: 300, settlement_currency: 'usd',
      locked_rate: null, applied_amount_usd: -70, final_amount_usd: 230, notes: null,
      staff_name_snapshot: 'Ahmed', staff_role_snapshot: 'cashier', finalized_at: '2026-03-31T00:00:00Z',
      paid_at: '2026-04-01T00:00:00Z', paid_by_staff_id: 'staff-1', payment_method: 'cash',
      client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00Z',
    } as any)

    const { markPaid } = useStaffSettlement()
    const result = await markPaid('settle-1', 'emp-1', { paymentMethod: 'cash' })

    expect(result.status).toBe('paid')
    expect(result.finalAmountUsd).toBe(230) // unchanged from finalize
    const [sql] = vi.mocked(db.execute).mock.calls[0]
    expect(sql).not.toMatch(/final_amount_usd\s*=/) // never recalculates
  })
})
