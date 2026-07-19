export type DiscountType = 'percent' | 'fixed'

export interface DiscountInput {
  type:  DiscountType
  value: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Computes the final unit price after a discount. `value` for a 'fixed'
 * discount is always in USD — callers converting a SYP-entered fixed amount
 * must divide by the sale's locked exchange rate BEFORE calling this, since
 * this module has no knowledge of currency (WAFI-002: only the locked rate,
 * never the live rate, may do that conversion).
 */
export function computeDiscountedPrice(basePriceUsd: number, discount: DiscountInput | null): number {
  if (!discount) return basePriceUsd
  if (discount.type === 'percent') {
    const pct = Math.min(Math.max(discount.value, 0), 100)
    return round2(basePriceUsd * (1 - pct / 100))
  }
  return round2(Math.max(0, basePriceUsd - discount.value))
}

export function computeDiscountAmount(basePriceUsd: number, finalPriceUsd: number): number {
  return round2(basePriceUsd - finalPriceUsd)
}

export function isBelowCost(finalPriceUsd: number, unitCostUsd: number): boolean {
  return finalPriceUsd < unitCostUsd
}
