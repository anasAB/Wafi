import type { PriceCurrency } from '../import.types'

/** Convert a price in the given currency to USD (base). */
export function toUsd(raw: number, currency: PriceCurrency, rate: number): number {
  if (currency === 'USD') return raw
  if (rate <= 0) throw new Error('exchange rate required to convert SYP prices')
  return Math.round((raw / rate) * 100) / 100
}
