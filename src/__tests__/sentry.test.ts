import { describe, it, expect } from 'vitest'
import { scrubPiiBeforeSend } from '@/sentry'
import type { ErrorEvent as SentryEvent, EventHint } from '@sentry/vue'

const noHint: EventHint = {}

describe('scrubPiiBeforeSend', () => {
  it('redacts known PII field names from event extra data', () => {
    const event: SentryEvent = {
      extra: {
        customerName: 'أحمد محمد',
        phone: '+963944123456',
        nameAr: 'محل الأخ',
        totalUsd: 42, // not PII, must survive untouched
      },
    }
    const result = scrubPiiBeforeSend(event, noHint)
    expect(result.extra?.customerName).toBe('[redacted]')
    expect(result.extra?.phone).toBe('[redacted]')
    expect(result.extra?.nameAr).toBe('[redacted]')
    expect(result.extra?.totalUsd).toBe(42)
  })

  it('redacts phone-number-shaped strings anywhere in extra data, even under an unrelated key', () => {
    const event: SentryEvent = {
      extra: { note: 'called +963944123456 about the issue' },
    }
    const result = scrubPiiBeforeSend(event, noHint)
    expect(result.extra?.note).not.toContain('963944123456')
  })

  it('passes through an event with no extra data unchanged', () => {
    const event: SentryEvent = { message: 'a generic error' }
    const result = scrubPiiBeforeSend(event, noHint)
    expect(result).toEqual(event)
  })
})
