import { describe, it, expect } from 'vitest'
import { isTransientEventFailure } from '@/services/events/isTransientEventFailure'

describe('isTransientEventFailure', () => {
  it('classifies busy/locked/IO errors as transient', () => {
    expect(isTransientEventFailure(new Error('SQLITE_BUSY: database is locked'))).toBe(true)
    expect(isTransientEventFailure(new Error('database is locked'))).toBe(true)
    expect(isTransientEventFailure(new Error('I/O error'))).toBe(true)
  })

  it('classifies constraint/syntax errors as permanent', () => {
    expect(isTransientEventFailure(new Error('UNIQUE constraint failed: events.id'))).toBe(false)
    expect(isTransientEventFailure(new Error('syntax error near "insert"'))).toBe(false)
    expect(isTransientEventFailure(new Error('no such column: payload_version'))).toBe(false)
  })

  it('defaults unrecognized errors to permanent (never retry forever on an unknown shape)', () => {
    expect(isTransientEventFailure(new Error('something entirely unexpected'))).toBe(false)
    expect(isTransientEventFailure('not even an Error instance')).toBe(false)
  })

  it('classifies both client-side and server-side rate-limit rejections as transient', () => {
    // 'client_rate_limit_exceeded' is no longer produced by publishEvent (final review: a
    // token-bucket rejection drops the event instead of enqueueing it). Kept as a
    // classifier-level assertion -- the rule is still correct, just unreachable from there.
    expect(isTransientEventFailure(new Error('client_rate_limit_exceeded'))).toBe(true)
    expect(isTransientEventFailure(new Error('events_rate_limit_exceeded'))).toBe(true)
  })
})
