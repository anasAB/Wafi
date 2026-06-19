import { describe, it, expect } from 'vitest'
import { decodeJwtPayload, shopIdFromToken } from '@/data/supabase/jwt'

// header.payload.signature — payload is base64url of {"shop_id":"shop-123"}
function tokenWith(payload: object): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `h.${b64}.s`
}

describe('decodeJwtPayload', () => {
  it('decodes a base64url payload', () => {
    expect(decodeJwtPayload(tokenWith({ shop_id: 'shop-123' }))).toEqual({ shop_id: 'shop-123' })
  })
  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
  })
})

describe('shopIdFromToken', () => {
  it('returns the top-level shop_id claim', () => {
    expect(shopIdFromToken(tokenWith({ shop_id: 'shop-123' }))).toBe('shop-123')
  })
  it('falls back to app_metadata.shop_id when no top-level claim', () => {
    expect(shopIdFromToken(tokenWith({ app_metadata: { shop_id: 'shop-meta' } }))).toBe('shop-meta')
  })
  it('prefers the top-level claim over app_metadata', () => {
    expect(shopIdFromToken(tokenWith({ shop_id: 'top', app_metadata: { shop_id: 'meta' } }))).toBe('top')
  })
  it('returns null when claim is missing in both places', () => {
    expect(shopIdFromToken(tokenWith({ sub: 'u1', app_metadata: { role: 'x' } }))).toBeNull()
  })
  it('returns null for null/empty token', () => {
    expect(shopIdFromToken(null)).toBeNull()
    expect(shopIdFromToken(undefined)).toBeNull()
  })
})
