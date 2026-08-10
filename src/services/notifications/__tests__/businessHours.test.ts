import { describe, it, expect, afterEach, vi } from 'vitest'
import { isWithinBusinessHours } from '../businessHours'

describe('isWithinBusinessHours', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Regression test for the I1 fix: isWithinBusinessHours must use LOCAL time
  // (getHours/getMinutes), not UTC (getUTCHours/getUTCMinutes). Every other test
  // in this file runs under TZ=UTC (pinned in src/__tests__/setup.ts), so local
  // time == UTC time by construction -- none of them would fail if the code were
  // reverted to getUTCHours()/getUTCMinutes(). This test pins TZ to a concrete
  // non-UTC, non-DST offset (Asia/Damascus, UTC+3) and picks a UTC instant that
  // is within business hours under LOCAL (Damascus) interpretation but outside
  // business hours under a raw UTC interpretation, so it fails if the local-time
  // fix regresses back to UTC methods.
  it('uses LOCAL time, not UTC, to determine business hours (non-UTC timezone)', () => {
    vi.stubEnv('TZ', 'Asia/Damascus')
    const shop = { open_time: '09:00', close_time: '21:00', is_24_7: 0 }
    // 2026-01-01T22:30:00.000Z is 22:30 UTC -- outside 09:00-21:00 if read as UTC.
    // In Asia/Damascus (UTC+3, no DST), the same instant is 2026-01-02T01:30 local
    // -- also outside hours. Use an instant where UTC-hour is within 09-21 but
    // local (UTC+3) hour is not, to prove which one the implementation actually
    // uses: 2026-01-01T19:30:00.000Z -> 19:30 UTC (within 09:00-21:00 if read as
    // UTC) but 22:30 local Damascus time (outside 09:00-21:00 if read as LOCAL).
    const isoTimestamp = '2026-01-01T19:30:00.000Z'
    // Empirically verify TZ stubbing actually shifts Date's local-time methods in
    // this runtime before relying on it for the real assertion below.
    const probe = new Date(isoTimestamp)
    expect(probe.getHours()).toBe(22) // 19:30 UTC -> 22:30 in Asia/Damascus (UTC+3)

    expect(isWithinBusinessHours(shop, isoTimestamp)).toBe(false) // 22:30 local -> outside 09:00-21:00
  })
})

describe('isWithinBusinessHours (base cases)', () => {
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
