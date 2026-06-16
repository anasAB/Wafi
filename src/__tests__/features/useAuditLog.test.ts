import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { useSessionStore } from '@/store/session.store'
import { db } from '@/data/powersync/db'
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
    const metaArg = call[1].find((v: unknown) =>
      typeof v === 'string' && v.includes('old_price')
    ) as string
    const meta = JSON.parse(metaArg)
    expect(meta.old_price).toBe(500)
    expect(meta.new_price).toBe(450)
  })

  it('loadLog filters by LOCAL day (matches dashboard/history), not raw UTC strings', async () => {
    const { loadLog } = useAuditLog()
    await loadLog({ startDate: '2026-06-15', endDate: '2026-06-15' })
    const call = vi.mocked(db.getAll).mock.calls[0]
    expect(call[0]).toContain("DATE(created_at, 'localtime') BETWEEN")
    // End bound is the plain local date — no manual 'T23:59:59Z' hack.
    expect(call[1]).toEqual(expect.arrayContaining(['2026-06-15']))
    expect((call[1] as unknown[]).some(v => typeof v === 'string' && v.includes('T23:59:59'))).toBe(false)
  })

  it('loadEntityHistory queries by entityType and entityId', async () => {
    const { loadEntityHistory } = useAuditLog()
    await loadEntityHistory('sale', 'sale-1')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('entity_type = ?'),
      expect.arrayContaining(['sale', 'sale-1'])
    )
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
})
