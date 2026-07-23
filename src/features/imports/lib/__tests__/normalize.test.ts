import { describe, it, expect } from 'vitest'
import { normalizeText, normalizeNumber } from '../normalize'

describe('normalizeText', () => {
  it('trims strings', () => expect(normalizeText('  hi  ')).toBe('hi'))
  it('nullish → empty', () => {
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
  })
  it('coerces numbers to string', () => expect(normalizeText(42)).toBe('42'))
})

describe('normalizeNumber', () => {
  it('plain number passes through', () => expect(normalizeNumber(12.5)).toBe(12.5))
  it('parses numeric string', () => expect(normalizeNumber('1500')).toBe(1500))
  it('strips thousands separators', () => expect(normalizeNumber('1,500,000')).toBe(1500000))
  it('parses Arabic-Indic digits', () => expect(normalizeNumber('١٥٠٠')).toBe(1500))
  it('strips currency glyphs and spaces', () => expect(normalizeNumber(' 2 500 ل.س ')).toBe(2500))
  it('blank → null', () => {
    expect(normalizeNumber('')).toBeNull()
    expect(normalizeNumber('   ')).toBeNull()
    expect(normalizeNumber(null)).toBeNull()
  })
  it('non-numeric → null', () => expect(normalizeNumber('abc')).toBeNull())
})
