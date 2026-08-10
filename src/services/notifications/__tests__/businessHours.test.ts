import { describe, it, expect } from 'vitest'
import { isWithinBusinessHours } from '../businessHours'

describe('isWithinBusinessHours', () => {
  it('returns true always when is_24_7 is set', () => {
    const shop = { open_time: null, close_time: null, is_24_7: 1 }
    expect(isWithinBusinessHours(shop, '2026-01-01T02:00:00.000Z')).toBe(true)
  })

  it('returns true always when open/close are both NULL and not 24/7 (checks disabled)', () => {
    const shop = { open_time: null, close_time: null, is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T02:00:00.000Z')).toBe(true)
  })

  it('normal day: within hours', () => {
    const shop = { open_time: '09:00', close_time: '21:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T12:00:00.000Z')).toBe(true)
  })

  it('normal day: outside hours', () => {
    const shop = { open_time: '09:00', close_time: '21:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T23:00:00.000Z')).toBe(false)
  })

  it('overnight window: within hours after midnight', () => {
    // open 08:00, close 02:00 -- 01:00 is within the overnight window
    const shop = { open_time: '08:00', close_time: '02:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T01:00:00.000Z')).toBe(true)
  })

  it('overnight window: within hours before midnight', () => {
    const shop = { open_time: '08:00', close_time: '02:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T20:00:00.000Z')).toBe(true)
  })

  it('overnight window: outside hours (mid-morning gap)', () => {
    const shop = { open_time: '08:00', close_time: '02:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T05:00:00.000Z')).toBe(false)
  })

  it('normal day: t === close_time is OUTSIDE hours (exclusive boundary)', () => {
    const shop = { open_time: '09:00', close_time: '21:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T21:00:00.000Z')).toBe(false)
  })

  it('normal day: t === open_time is WITHIN hours (inclusive boundary)', () => {
    const shop = { open_time: '09:00', close_time: '21:00', is_24_7: 0 }
    expect(isWithinBusinessHours(shop, '2026-01-01T09:00:00.000Z')).toBe(true)
  })
})
