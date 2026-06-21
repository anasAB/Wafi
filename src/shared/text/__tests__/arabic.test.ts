import { describe, it, expect } from 'vitest'
import { normalizeArabic, matchesArabicQuery } from '@/shared/text/arabic'

describe('normalizeArabic', () => {
  it('strips harakat (tashkeel)', () => {
    expect(normalizeArabic('سَمَّاعة')).toBe(normalizeArabic('سماعة'))
  })
  it('strips tatweel', () => {
    expect(normalizeArabic('سـمـاعة')).toBe(normalizeArabic('سماعة'))
  })
  it('folds alef variants (آ أ إ → ا)', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'))
    expect(normalizeArabic('إبراهيم')).toBe(normalizeArabic('ابراهيم'))
  })
  it('folds alef-maksura and taa-marbuta', () => {
    expect(normalizeArabic('علي')).toBe(normalizeArabic('على'))
    expect(normalizeArabic('قهوة')).toBe(normalizeArabic('قهوه'))
  })
  it('lowercases and trims so Latin/codes match too', () => {
    expect(normalizeArabic('  iPhone  ')).toBe('iphone')
  })
  it('handles null/undefined safely', () => {
    expect(normalizeArabic(undefined as unknown as string)).toBe('')
  })
})

describe('matchesArabicQuery', () => {
  it('matches across harakat and taa-marbuta differences', () => {
    expect(matchesArabicQuery('سَمَّاعة', 'سماعه')).toBe(true)
  })
  it('matches across alef variants and as a substring', () => {
    expect(matchesArabicQuery('سماعة أحمد', 'احمد')).toBe(true)
  })
  it('matches Latin/codes case-insensitively', () => {
    expect(matchesArabicQuery('iPhone 12', 'iphone')).toBe(true)
  })
  it('returns false on a genuine mismatch', () => {
    expect(matchesArabicQuery('سماعة', 'تلفون')).toBe(false)
  })
  it('an empty query matches everything', () => {
    expect(matchesArabicQuery('سماعة', '   ')).toBe(true)
  })
})
