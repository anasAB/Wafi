import { describe, it, expect } from 'vitest'
import { isCostMissing, isCostStale, isCostImprecise } from '../product.utils'

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('product.utils — WAFI-013 cost freshness predicates', () => {
  describe('isCostMissing', () => {
    it('is true for cost 0', () => {
      expect(isCostMissing({ costPriceUsd: 0 })).toBe(true)
    })

    it('is true for undefined-ish falsy cost', () => {
      expect(isCostMissing({ costPriceUsd: undefined as unknown as number })).toBe(true)
    })

    it('is false for a positive cost', () => {
      expect(isCostMissing({ costPriceUsd: 5 })).toBe(false)
    })
  })

  describe('isCostStale', () => {
    it('is false when cost is missing — missing takes priority over stale', () => {
      expect(isCostStale({ costPriceUsd: 0, costUpdatedAt: daysAgo(200) })).toBe(false)
    })

    it('is false when costUpdatedAt is undefined (no signal yet)', () => {
      expect(isCostStale({ costPriceUsd: 5, costUpdatedAt: undefined })).toBe(false)
    })

    it('is false at just under 90 days old', () => {
      // A few seconds' buffer under the exact 90-day mark: real time elapses
      // between building this fixture and the assertion, so an exact
      // daysAgo(90) timestamp would always drift a hair past 90.0 days by
      // assertion time and flip stale — mirrors the tolerance used in
      // ProductList.test.ts for the equivalent case.
      const costUpdatedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000 + 5000).toISOString()
      expect(isCostStale({ costPriceUsd: 5, costUpdatedAt })).toBe(false)
    })

    it('is true at 91 days old', () => {
      expect(isCostStale({ costPriceUsd: 5, costUpdatedAt: daysAgo(91) })).toBe(true)
    })

    it('is false at 89 days old', () => {
      expect(isCostStale({ costPriceUsd: 5, costUpdatedAt: daysAgo(89) })).toBe(false)
    })
  })

  describe('isCostImprecise', () => {
    it('is true when cost is missing', () => {
      expect(isCostImprecise({ costPriceUsd: 0, costUpdatedAt: undefined })).toBe(true)
    })

    it('is true when cost is stale', () => {
      expect(isCostImprecise({ costPriceUsd: 5, costUpdatedAt: daysAgo(91) })).toBe(true)
    })

    it('is false for a fresh real cost', () => {
      expect(isCostImprecise({ costPriceUsd: 5, costUpdatedAt: daysAgo(1) })).toBe(false)
    })
  })
})
