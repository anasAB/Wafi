import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ErrorEvent as SentryEvent, EventHint } from '@sentry/vue'
import type { App } from 'vue'

const noHint: EventHint = {}

const sentryInitMock = vi.fn()
vi.mock('@sentry/vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/vue')>()
  return { ...actual, init: (...args: unknown[]) => sentryInitMock(...args) }
})

const { scrubPiiBeforeSend, initSentry } = await import('@/sentry')

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

  it('redacts PII fields and phone-shaped strings in event.contexts.vue.propsData', () => {
    const event: SentryEvent = {
      contexts: {
        vue: {
          componentName: 'CustomerCard',
          propsData: {
            customer: 'أحمد محمد',
            phone: '+963944123456',
            note: 'call +963944123456 to confirm',
            totalUsd: 42,
          },
        },
      },
    }
    const result = scrubPiiBeforeSend(event, noHint)
    const propsData = result.contexts?.vue?.propsData as Record<string, unknown>
    expect(propsData.phone).toBe('[redacted]')
    expect(propsData.note).not.toContain('963944123456')
    expect(propsData.totalUsd).toBe(42)
    // non-props vue context fields survive untouched
    expect(result.contexts?.vue?.componentName).toBe('CustomerCard')
  })

  it('redacts phone numbers in breadcrumb message and data fields', () => {
    const event: SentryEvent = {
      breadcrumbs: [
        {
          message: 'sent WhatsApp to +963944123456',
          data: { phone: '+963944123456', note: 'ok' },
        },
      ],
    }
    const result = scrubPiiBeforeSend(event, noHint)
    const breadcrumb = result.breadcrumbs?.[0]
    expect(breadcrumb?.message).not.toContain('963944123456')
    expect(breadcrumb?.data?.phone).toBe('[redacted]')
    expect(breadcrumb?.data?.note).toBe('ok')
  })
})

describe('initSentry', () => {
  beforeEach(() => {
    sentryInitMock.mockClear()
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example@sentry.io/1')
    vi.stubEnv('PROD', true)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('disables attachProps and tags the event with environment (defaulting to "production")', () => {
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', '')
    initSentry({} as App)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
    const options = sentryInitMock.mock.calls[0][0] as Record<string, unknown>
    expect(options.attachProps).toBe(false)
    expect(options.environment).toBe('production')
  })

  it('uses VITE_SENTRY_ENVIRONMENT when set, so staging builds are tagged distinctly', () => {
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'staging')
    initSentry({} as App)
    const options = sentryInitMock.mock.calls[0][0] as Record<string, unknown>
    expect(options.environment).toBe('staging')
  })
})
