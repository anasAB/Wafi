import { describe, it, expect } from 'vitest'
import { toUsd } from '../convert'

describe('toUsd', () => {
  it('USD passes through', () => expect(toUsd(12.5, 'USD', 13500)).toBe(12.5))
  it('SYP divides by rate, rounds to 2dp', () => expect(toUsd(135000, 'SYP', 13500)).toBe(10))
  it('SYP rounds correctly', () => expect(toUsd(20000, 'SYP', 13500)).toBe(1.48))
  it('throws on SYP with non-positive rate', () => {
    expect(() => toUsd(1000, 'SYP', 0)).toThrow()
  })
})
