import { describe, it, expect } from 'vitest'
import { validateDiscountCaps, isValidCapPct } from '../discountCapsValidation'

describe('isValidCapPct', () => {
  it('accepts values within 0-100', () => {
    expect(isValidCapPct(0)).toBe(true)
    expect(isValidCapPct(100)).toBe(true)
    expect(isValidCapPct(45.5)).toBe(true)
  })

  it('rejects negative values', () => {
    expect(isValidCapPct(-10)).toBe(false)
  })

  it('rejects values above 100', () => {
    expect(isValidCapPct(150)).toBe(false)
  })

  it('rejects non-finite values', () => {
    expect(isValidCapPct(Infinity)).toBe(false)
    expect(isValidCapPct(NaN)).toBe(false)
  })
})

describe('validateDiscountCaps', () => {
  it('accepts valid caps and returns parsed numbers', () => {
    const result = validateDiscountCaps({ cashier: '10', manager: '25' })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual({})
    expect(result.parsed).toEqual({ cashierPct: 10, managerPct: 25 })
  })

  it('rejects empty cashier field as required', () => {
    const result = validateDiscountCaps({ cashier: '', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('الرجاء إدخال قيمة')
  })

  it('rejects whitespace-only field as required', () => {
    const result = validateDiscountCaps({ cashier: '   ', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('الرجاء إدخال قيمة')
  })

  it('rejects negative values (BUG-01)', () => {
    const result = validateDiscountCaps({ cashier: '-10', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يجب أن تكون النسبة بين 0 و100')
  })

  it('rejects values above 100 (BUG-02)', () => {
    const result = validateDiscountCaps({ cashier: '150', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يجب أن تكون النسبة بين 0 و100')
  })

  it('rejects a 20-digit number via range check (BUG-03)', () => {
    const result = validateDiscountCaps({ cashier: '99999999999999999999', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يجب أن تكون النسبة بين 0 و100')
  })

  it('rejects more than 2 decimal places', () => {
    const result = validateDiscountCaps({ cashier: '10.555', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يُسمح بمنزلتين عشريتين كحد أقصى')
  })

  it('accepts exactly 2 decimal places', () => {
    const result = validateDiscountCaps({ cashier: '12.35', manager: '15' })
    expect(result.valid).toBe(true)
    expect(result.parsed?.cashierPct).toBeCloseTo(12.35)
  })

  it('rejects cashier cap exceeding manager cap (BUG-04)', () => {
    const result = validateDiscountCaps({ cashier: '90', manager: '10' })
    expect(result.valid).toBe(false)
    expect(result.errors.cross).toBe('لا يمكن أن يتجاوز حد الكاشير حد المدير')
  })

  it('does not run the cross-field check when either field already has an error', () => {
    const result = validateDiscountCaps({ cashier: '-5', manager: '10' })
    expect(result.errors.cross).toBeUndefined()
  })

  it('accepts cashier equal to manager', () => {
    const result = validateDiscountCaps({ cashier: '15', manager: '15' })
    expect(result.valid).toBe(true)
  })
})
