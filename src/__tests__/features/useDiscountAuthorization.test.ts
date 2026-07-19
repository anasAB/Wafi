import { describe, it, expect } from 'vitest'
import { requiresPinApproval, type DiscountCaps } from '@/features/pos/useDiscountAuthorization'

const caps: DiscountCaps = { cashierPct: 5, managerPct: 15 }

describe('requiresPinApproval', () => {
  it('never requires PIN for the owner, at any discount, above cost', () => {
    expect(requiresPinApproval({
      role: 'owner', discountPct: 90, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(false)
  })

  it('requires PIN for the owner when the sale would go below cost', () => {
    expect(requiresPinApproval({
      role: 'owner', discountPct: 10, finalPriceUsd: 4, unitCostUsd: 5, caps,
    })).toBe(true)
  })

  it('cashier within cap does not require PIN', () => {
    expect(requiresPinApproval({
      role: 'cashier', discountPct: 5, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(false)
  })

  it('cashier over cap requires PIN', () => {
    expect(requiresPinApproval({
      role: 'cashier', discountPct: 5.01, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(true)
  })

  it('manager within cap does not require PIN', () => {
    expect(requiresPinApproval({
      role: 'manager', discountPct: 15, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(false)
  })

  it('manager over cap requires PIN', () => {
    expect(requiresPinApproval({
      role: 'manager', discountPct: 15.01, finalPriceUsd: 10, unitCostUsd: 1, caps,
    })).toBe(true)
  })

  it('below-cost overrides an in-cap discount for any role', () => {
    expect(requiresPinApproval({
      role: 'cashier', discountPct: 1, finalPriceUsd: 0.5, unitCostUsd: 1, caps,
    })).toBe(true)
  })
})
