import { describe, it, expect } from 'vitest'
import { validateCustomRange, isLargeExport } from '../export.validation'
import { LARGE_EXPORT_ROWS } from '../export.types'

describe('validateCustomRange', () => {
  it('rejects a missing start date', () => {
    expect(validateCustomRange('', '2026-06-23')).toBe('الرجاء تحديد تاريخ البداية والنهاية')
  })

  it('rejects a missing end date', () => {
    expect(validateCustomRange('2026-06-01', '')).toBe('الرجاء تحديد تاريخ البداية والنهاية')
  })

  it('rejects a start after the end', () => {
    expect(validateCustomRange('2026-06-23', '2026-06-01'))
      .toBe('تاريخ النهاية يجب أن يكون بعد تاريخ البداية')
  })

  it('accepts a valid range (start before end)', () => {
    expect(validateCustomRange('2026-06-01', '2026-06-23')).toBeNull()
  })

  it('accepts an equal start and end (single day)', () => {
    expect(validateCustomRange('2026-06-23', '2026-06-23')).toBeNull()
  })
})

describe('isLargeExport', () => {
  it('is false at the threshold', () => {
    expect(isLargeExport(LARGE_EXPORT_ROWS)).toBe(false)
  })

  it('is true above the threshold', () => {
    expect(isLargeExport(LARGE_EXPORT_ROWS + 1)).toBe(true)
  })

  it('is false for an empty result', () => {
    expect(isLargeExport(0)).toBe(false)
  })
})
