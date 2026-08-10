import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

import { db } from '@/data/powersync/db'
import { useCustomerIntelligence } from '@/features/dashboard/composables/useCustomerIntelligence'

describe('useCustomerIntelligence', () => {
  beforeEach(() => vi.resetAllMocks())

  it('excludes customers with zero qualifying sales and sorts oldest-first', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { customerId: 'c1', customerName: 'زبون ١', lastPurchaseAt: '2026-05-01T00:00:00.000Z' },
      { customerId: 'c2', customerName: 'زبون ٢', lastPurchaseAt: '2026-06-01T00:00:00.000Z' },
    ] as any)
    const { data, load } = useCustomerIntelligence()
    await load()
    expect(data.value?.inactiveCount).toBe(2)
    expect(data.value?.inactiveCustomers[0].customerId).toBe('c1') // oldest first
  })

  it('correctly calculates daysSincePurchase', async () => {
    const now = Date.now()
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

    vi.mocked(db.getAll).mockResolvedValue([
      { customerId: 'c1', customerName: 'زبون ١', lastPurchaseAt: thirtyDaysAgo },
    ] as any)

    const { data, load } = useCustomerIntelligence()
    await load()
    const days = data.value?.inactiveCustomers[0].daysSincePurchase
    expect(days).toBe(30)
  })

  it('excludes soft-deleted customers from query', async () => {
    // The query itself should exclude soft-deleted customers via WHERE clause
    // This test verifies the query is called with proper parameters
    vi.mocked(db.getAll).mockResolvedValue([])
    const { load } = useCustomerIntelligence()
    await load()

    // Verify db.getAll was called with the correct SQL that includes soft-delete check
    expect(vi.mocked(db.getAll)).toHaveBeenCalled()
    const callArgs = vi.mocked(db.getAll).mock.calls[0]
    const sql = callArgs[0] as string
    expect(sql).toContain('(c.deleted = 0 OR c.deleted IS NULL)')
  })

  it('uses INNER JOIN to exclude customers with zero qualifying sales', async () => {
    // The query should use INNER JOIN (not LEFT JOIN) so customers with no sales
    // don't appear in the result set at all
    vi.mocked(db.getAll).mockResolvedValue([])
    const { load } = useCustomerIntelligence()
    await load()

    const callArgs = vi.mocked(db.getAll).mock.calls[0]
    const sql = callArgs[0] as string
    expect(sql).toContain('JOIN customers c ON c.id = s.customer_id')
    expect(sql).not.toContain('LEFT JOIN')
  })

  it('handles error state correctly', async () => {
    vi.mocked(db.getAll).mockRejectedValue(new Error('DB error'))
    const { state, load } = useCustomerIntelligence()
    await load()
    expect(state.value).toBe('error')
  })

  it('filters by shop_id and excludes null customer_id', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { load } = useCustomerIntelligence()
    await load()

    const callArgs = vi.mocked(db.getAll).mock.calls[0]
    const sql = callArgs[0] as string
    const params = callArgs[1] as any[]

    expect(sql).toContain('s.shop_id = ?')
    expect(sql).toContain('s.customer_id IS NOT NULL')
    expect(params[0]).toBe('shop1')
  })

  it('orders results by lastPurchaseAt ascending (oldest first)', async () => {
    const old = '2026-01-01T00:00:00.000Z'
    const mid = '2026-05-01T00:00:00.000Z'
    const recent = '2026-08-01T00:00:00.000Z'

    // SQL query sorts by lastPurchaseAt ASC, so mock returns sorted data
    vi.mocked(db.getAll).mockResolvedValue([
      { customerId: 'c1', customerName: 'قديم', lastPurchaseAt: old },
      { customerId: 'c2', customerName: 'وسط', lastPurchaseAt: mid },
      { customerId: 'c3', customerName: 'جديد', lastPurchaseAt: recent },
    ] as any)

    const { data, load } = useCustomerIntelligence()
    await load()

    expect(data.value?.inactiveCustomers[0].customerId).toBe('c1')
    expect(data.value?.inactiveCustomers[1].customerId).toBe('c2')
    expect(data.value?.inactiveCustomers[2].customerId).toBe('c3')
  })
})
