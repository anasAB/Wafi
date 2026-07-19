import { describe, it, expect } from 'vitest'
import { computeDiscountedPrice, computeDiscountAmount, isBelowCost } from '@/features/pos/discounts'

describe('computeDiscountedPrice', () => {
  it('returns base price when discount is null', () => {
    expect(computeDiscountedPrice(10, null)).toBe(10)
  })

  it('applies a percent discount', () => {
    expect(computeDiscountedPrice(10, { type: 'percent', value: 20 })).toBeCloseTo(8, 2)
  })

  it('applies a fixed-amount discount (already in USD)', () => {
    expect(computeDiscountedPrice(10, { type: 'fixed', value: 2.5 })).toBeCloseTo(7.5, 2)
  })

  it('clamps a fixed discount larger than the base price to zero, never negative', () => {
    expect(computeDiscountedPrice(10, { type: 'fixed', value: 50 })).toBe(0)
  })

  it('clamps a percent discount over 100 to zero', () => {
    expect(computeDiscountedPrice(10, { type: 'percent', value: 150 })).toBe(0)
  })
})

describe('computeDiscountAmount', () => {
  it('is the difference between base and final, rounded to cents', () => {
    expect(computeDiscountAmount(10, 7.999)).toBeCloseTo(2, 2)
  })
})

describe('isBelowCost', () => {
  it('is true when final price is under unit cost', () => {
    expect(isBelowCost(4, 5)).toBe(true)
  })

  it('is false when final price equals unit cost', () => {
    expect(isBelowCost(5, 5)).toBe(false)
  })

  it('is false when final price is above unit cost', () => {
    expect(isBelowCost(6, 5)).toBe(false)
  })
})
