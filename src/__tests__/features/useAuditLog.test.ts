import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { eventLabel } from '@/features/audit/audit.format'
import { useSessionStore } from '@/store/session.store'
import { db } from '@/data/powersync/db'
import type { Staff } from '@/features/staff/staff.types'
import type { AuditLog } from '@/features/audit/audit.types'

const mockStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'أحمد', pinHash: 'abc', pinSalt: null,
  role: 'cashier',
  permissions: {
    can_view_reports: false, can_manage_products: false,
    can_manage_customers: false, can_view_expenses: false, can_manage_settings: false,
    can_manage_inventory: false, can_manage_suppliers: false, can_manage_stock_take: false,
    can_view_staff_ledger: false,
  },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useAuditLog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('logSaleCompleted inserts a row with correct event and entity_type', async () => {
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
    const { logSaleCompleted } = useAuditLog()

    await logSaleCompleted('sale-1', 45.00, 3)

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['sale.completed', 'sale', 'sale-1'])
    )
  })

  it('uses activeStaff id and name from session store', async () => {
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
    const { logExpenseCreated } = useAuditLog()

    await logExpenseCreated('exp-1', 'إيجار', 80)

    const call = vi.mocked(db.execute).mock.calls[0]
    expect(call[1]).toContain('staff-1')
    expect(call[1]).toContain('أحمد')
  })

  it('uses null staff_id and "system" staff_name when no active staff', async () => {
    const { logExpenseCreated } = useAuditLog()

    await logExpenseCreated('exp-1', 'إيجار', 80)

    const call = vi.mocked(db.execute).mock.calls[0]
    expect(call[1]).toContain(null)
    expect(call[1]).toContain('system')
  })

  it('swallows db errors silently', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('DB error'))
    const { logExpenseCreated } = useAuditLog()

    await expect(logExpenseCreated('exp-1', 'إيجار', 80)).resolves.toBeUndefined()
  })

  it('logProductPriceChanged includes old and new price in meta JSON', async () => {
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
    const { logProductPriceChanged } = useAuditLog()

    await logProductPriceChanged('prod-1', 'iPhone 14', 500, 450)

    const call = vi.mocked(db.execute).mock.calls[0]
    const metaArg = call[1]!.find((v: unknown) =>
      typeof v === 'string' && v.includes('old_price')
    ) as string
    const meta = JSON.parse(metaArg)
    expect(meta.old_price).toBe(500)
    expect(meta.new_price).toBe(450)
  })

  it('loadEntityHistory queries by entityType and entityId', async () => {
    const { loadEntityHistory } = useAuditLog()
    await loadEntityHistory('sale', 'sale-1')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('entity_type = ?'),
      expect.arrayContaining(['sale', 'sale-1'])
    )
  })

  it('loadLog parses a double-encoded meta (JSONB round-trip, migration 031) back into an object', async () => {
    // Simulates a row synced through the old JSONB column: the client's JSON
    // string got wrapped in an extra layer of JSON encoding.
    const doubleEncoded = JSON.stringify(JSON.stringify({ name: 'أحمد', role: 'cashier' }))
    vi.mocked(db.getAll).mockResolvedValueOnce([
      {
        id: 'a1', shop_id: 'shop-1', staff_id: 's1', staff_name: 'system',
        event: 'staff.created', entity_type: 'staff', entity_id: 's2',
        meta: doubleEncoded, created_at: '2026-01-01T00:00:00Z',
      },
    ] as any)
    const { entries, loadLog } = useAuditLog()
    await loadLog({ startDate: '2026-01-01', endDate: '2026-01-01' })
    expect(entries.value[0].meta).toEqual({ name: 'أحمد', role: 'cashier' })
    expect(eventLabel(entries.value[0])).toBe('أضاف موظف: أحمد (cashier)')
  })
})

describe('useAuditLog — supplier & receiving helpers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('logSupplierCreated writes a supplier.created row', async () => {
    const { logSupplierCreated } = useAuditLog()
    await logSupplierCreated('sup-1', 'مؤسسة النور')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['supplier.created', 'supplier', 'sup-1']),
    )
  })

  it('logReceivingCreated writes a receiving.created row', async () => {
    const { logReceivingCreated } = useAuditLog()
    await logReceivingCreated('rcv-1', 'مؤسسة النور', 1200, 5)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['receiving.created', 'receiving', 'rcv-1']),
    )
  })

  it('logOperatorSwitched writes an operator.switched row carrying both operators', async () => {
    const { logOperatorSwitched } = useAuditLog()
    await logOperatorSwitched('s1', 'سامي', 's2', 'أحمد')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['operator.switched', 'staff', 's2']),
    )
    const metaArg = vi.mocked(db.execute).mock.calls[0]![1]!
      .find((v: unknown) => typeof v === 'string' && v.includes('to_staff_id')) as string
    const meta = JSON.parse(metaArg)
    expect(meta).toMatchObject({
      from_staff_id: 's1', from_name: 'سامي', to_staff_id: 's2', to_name: 'أحمد',
    })
  })
})

describe('eventLabel — missing/legacy meta never renders literal "undefined"', () => {
  it('staff.created falls back to em-dash when name/role are missing', () => {
    const entry = { event: 'staff.created', meta: {} } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).not.toContain('undefined')
    expect(label).toContain('أضاف موظف')
  })

  it('exchange_rate.changed falls back to em-dash when old_rate/new_rate are missing', () => {
    const entry = { event: 'exchange_rate.changed', meta: {} } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).not.toContain('undefined')
    expect(label).toContain('غيّر سعر الصرف')
  })
})

describe('eventLabel — operator.switched', () => {
  it('renders an Arabic sentence naming both operators', () => {
    const entry = {
      event: 'operator.switched',
      meta: { from_staff_id: 's1', from_name: 'سامي', to_staff_id: 's2', to_name: 'أحمد' },
    } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).toContain('تبديل المستخدم')
    expect(label).toContain('سامي')
    expect(label).toContain('أحمد')
  })
})

describe('eventLabel — shift/cash movement events', () => {
  it('renders shift.force_closed in Arabic with actor name', () => {
    const entry = {
      event: 'shift.force_closed',
      meta: { actor_name: 'مالك المحل' },
    } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).toContain('إغلاق وردية إجبارياً')
    expect(label).toContain('مالك المحل')
  })

  it('renders cash_movement.recorded with direction/category/amount', () => {
    const entry = {
      event: 'cash_movement.recorded',
      meta: { direction: 'out', category: 'مصروف عاجل', currency: 'USD', amount: 12.5 },
    } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).toContain('سجّل حركة نقدية')
    expect(label).toContain('إخراج')
    expect(label).toContain('مصروف عاجل')
    expect(label).toContain('$12.50')
  })
})

describe('eventLabel — security events (WAFI-014)', () => {
  it('renders staff.pin_changed in Arabic naming the staff', () => {
    const entry = { event: 'staff.pin_changed', meta: { name: 'أحمد' } } as unknown as AuditLog
    expect(eventLabel(entry)).toContain('الرقم السري')
    expect(eventLabel(entry)).toContain('أحمد')
  })

  it('renders auth.login_failed in Arabic naming the staff', () => {
    const entry = { event: 'auth.login_failed', meta: { name: 'أحمد' } } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).toContain('محاولة دخول فاشلة')
    expect(label).toContain('أحمد')
  })

  it('renders auth.locked_out in Arabic naming the staff', () => {
    const entry = { event: 'auth.locked_out', meta: { name: 'أحمد', minutes: 5 } } as unknown as AuditLog
    expect(eventLabel(entry)).toContain('قفل')
    expect(eventLabel(entry)).toContain('أحمد')
  })
})

describe('useAuditLog — installment events', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('logInstallmentPlanCreated writes an installment_plan.created row', async () => {
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
    const { logInstallmentPlanCreated } = useAuditLog()

    await logInstallmentPlanCreated('plan-1', 'cust-1', 300, 60, 3)

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.created', 'installment_plan', 'plan-1']),
    )
  })

  it('logInstallmentPaymentRecorded writes an installment_payment.recorded row', async () => {
    const { logInstallmentPaymentRecorded } = useAuditLog()
    await logInstallmentPaymentRecorded('due-1', 'plan-1', 100)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_payment.recorded', 'installment_plan', 'plan-1']),
    )
  })

  it('logInstallmentPlanCancelled writes an installment_plan.cancelled row', async () => {
    const { logInstallmentPlanCancelled } = useAuditLog()
    await logInstallmentPlanCancelled('plan-1')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.cancelled', 'installment_plan', 'plan-1']),
    )
  })
})

describe('useAuditLog — sensitive events surface write failures (WAFI-014)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('logPinChanged writes a staff.pin_changed row', async () => {
    const { logPinChanged } = useAuditLog()
    await logPinChanged('staff-2', 'أحمد')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['staff.pin_changed', 'staff', 'staff-2']),
    )
  })

  it('a failed sensitive-action audit write rejects (does NOT silently resolve)', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('DB error'))
    const { logPinChanged } = useAuditLog()
    await expect(logPinChanged('staff-2', 'أحمد')).rejects.toThrow()
  })

  it('logLoginFailed and logLockedOut also surface failures', async () => {
    const { logLoginFailed, logLockedOut } = useAuditLog()
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('DB error'))
    await expect(logLoginFailed('staff-2', 'أحمد')).rejects.toThrow()
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('DB error'))
    await expect(logLockedOut('staff-2', 'أحمد', 5)).rejects.toThrow()
  })
})

describe('eventLabel — installment events', () => {
  it('renders installment_plan.created with amounts and term count', () => {
    const entry = {
      event: 'installment_plan.created',
      meta: { customerId: 'cust-1', totalUsd: 300, downPaymentUsd: 60, termCount: 3 },
    } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).toContain('$300.00')
    expect(label).toContain('$60.00')
    expect(label).toContain('3')
  })

  it('renders installment_payment.recorded with the amount', () => {
    const entry = { event: 'installment_payment.recorded', meta: { dueId: 'due-1', amountUsd: 100 } } as unknown as AuditLog
    expect(eventLabel(entry)).toContain('$100.00')
  })

  it('renders installment_plan.cancelled', () => {
    const entry = { event: 'installment_plan.cancelled', meta: {} } as unknown as AuditLog
    expect(eventLabel(entry)).toContain('ألغى خطة تقسيط')
  })
})
