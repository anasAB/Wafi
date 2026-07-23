import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecute = vi.fn().mockResolvedValue(undefined)
vi.mock('@/data/powersync/db', () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop-1' }) }))
vi.mock('@/store/session.store', () => ({
  useSessionStore: () => ({ activeStaff: { id: 'staff-1', name: 'Owner' } }),
}))

import { useAuditLog } from '@/features/audit/composables/useAuditLog'

beforeEach(() => mockExecute.mockClear())

describe('logDiscountApplied', () => {
  it('writes a sale.discount_applied audit row with the required meta fields', async () => {
    const { logDiscountApplied } = useAuditLog()
    await logDiscountApplied('sale-1', {
      operatorId: 'staff-1', tierApplied: 'retail', basePriceUsd: 10,
      discountType: 'percent', discountValue: 20, finalPriceUsd: 8,
      pinApproval: true, belowCost: false,
    })
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toContain('INSERT INTO audit_log')
    expect(params[4]).toBe('sale.discount_applied') // event column
    expect(params[5]).toBe('sale')                  // entity_type column
    expect(JSON.parse(params[7])).toMatchObject({
      operatorId: 'staff-1', discountType: 'percent', pinApproval: true, belowCost: false,
    })
  })
})
