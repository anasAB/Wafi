import { describe, it, expect } from 'vitest'
import {
  CASH_MOVEMENT_CATEGORIES,
  categoriesForDirection,
} from '../cashMovement.types'

describe('cash movement categories', () => {
  it('every category has a direction and an Arabic label', () => {
    for (const c of CASH_MOVEMENT_CATEGORIES) {
      expect(c.direction === 'in' || c.direction === 'out').toBe(true)
      expect(c.labelAr.length).toBeGreaterThan(0)
    }
  })

  it('categoriesForDirection returns only matching-direction categories', () => {
    const outs = categoriesForDirection('out')
    expect(outs.length).toBeGreaterThan(0)
    expect(outs.every(c => c.direction === 'out')).toBe(true)
    expect(outs.map(c => c.key)).toContain('paid_supplier')
    expect(outs.map(c => c.key)).toContain('drop_to_safe')

    const ins = categoriesForDirection('in')
    expect(ins.every(c => c.direction === 'in')).toBe(true)
    expect(ins.map(c => c.key)).toContain('float_topup')
  })

  it('category keys are unique', () => {
    const keys = CASH_MOVEMENT_CATEGORIES.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
