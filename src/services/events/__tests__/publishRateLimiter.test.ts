import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tryConsumeToken } from '@/services/events/publishRateLimiter'

describe('tryConsumeToken', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-08-05T00:00:00.000Z')))
  afterEach(() => vi.useRealTimers())

  it('allows up to the burst capacity (50) before rejecting', () => {
    const results = Array.from({ length: 51 }, () => tryConsumeToken())
    expect(results.slice(0, 50).every(Boolean)).toBe(true)
    expect(results[50]).toBe(false)
  })

  it('refills over time (10/sec) so a token becomes available again after a pause', () => {
    Array.from({ length: 50 }, () => tryConsumeToken()) // exhaust the bucket
    expect(tryConsumeToken()).toBe(false)
    vi.setSystemTime(new Date('2026-08-05T00:00:01.000Z')) // +1s -> +10 tokens
    expect(tryConsumeToken()).toBe(true)
  })
})
