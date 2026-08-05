import { describe, it, expect } from 'vitest'
import { isTransientPublishFailure } from '@/services/events/isTransientPublishFailure'

describe('isTransientPublishFailure', () => {
  it('classifies busy/locked/IO errors as transient', () => {
    expect(isTransientPublishFailure(new Error('SQLITE_BUSY: database is locked'))).toBe(true)
    expect(isTransientPublishFailure(new Error('database is locked'))).toBe(true)
    expect(isTransientPublishFailure(new Error('I/O error'))).toBe(true)
  })

  it('classifies constraint/syntax errors as permanent', () => {
    expect(isTransientPublishFailure(new Error('UNIQUE constraint failed: events.id'))).toBe(false)
    expect(isTransientPublishFailure(new Error('syntax error near "insert"'))).toBe(false)
    expect(isTransientPublishFailure(new Error('no such column: payload_version'))).toBe(false)
  })

  it('defaults unrecognized errors to permanent (never retry forever on an unknown shape)', () => {
    expect(isTransientPublishFailure(new Error('something entirely unexpected'))).toBe(false)
    expect(isTransientPublishFailure('not even an Error instance')).toBe(false)
  })

  it('classifies both client-side and server-side rate-limit rejections as transient', () => {
    // 'client_rate_limit_exceeded' is no longer produced by publishEvent (final review: a
    // token-bucket rejection drops the event instead of enqueueing it). Kept as a
    // classifier-level assertion -- the rule is still correct, just unreachable from there.
    expect(isTransientPublishFailure(new Error('client_rate_limit_exceeded'))).toBe(true)
    expect(isTransientPublishFailure(new Error('events_rate_limit_exceeded'))).toBe(true)
  })
})
