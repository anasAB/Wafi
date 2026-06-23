import { describe, it, expect } from 'vitest'
import { resolvePhone, buildWaMeUrl } from '../whatsapp'

describe('resolvePhone', () => {
  it('keeps an already-international number', () => expect(resolvePhone('+963944123456')).toBe('963944123456'))
  it('converts a local leading-zero number', () => expect(resolvePhone('0944123456')).toBe('963944123456'))
  it('prepends country code to a bare local number', () => expect(resolvePhone('944123456')).toBe('963944123456'))
  it('strips spaces/dashes', () => expect(resolvePhone('0944 123-456')).toBe('963944123456'))
  it('returns null for empty/too-short/null', () => {
    expect(resolvePhone('')).toBeNull()
    expect(resolvePhone('12')).toBeNull()
    expect(resolvePhone(null)).toBeNull()
  })
})

describe('buildWaMeUrl', () => {
  it('builds an encoded link', () =>
    expect(buildWaMeUrl('963944123456', 'مرحبا 1$')).toBe('https://wa.me/963944123456?text=' + encodeURIComponent('مرحبا 1$')))
})
