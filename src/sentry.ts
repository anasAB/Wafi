import * as Sentry from '@sentry/vue'
import type { App } from 'vue'

const PII_FIELD_NAMES = new Set(['phone', 'customerName', 'nameAr', 'name'])
const PHONE_LIKE_PATTERN = /\+?\d{9,}/g

/**
 * Strips known-PII field values and any phone-number-shaped substring from
 * a Sentry event's `extra` data before it leaves the browser. This is real
 * Syrian shop customer data (names, phone numbers) going to Sentry's
 * (US-based) servers -- scrub first, not an afterthought.
 */
export function scrubPiiBeforeSend(event: Sentry.Event): Sentry.Event {
  if (!event.extra) return event

  const scrubbed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event.extra)) {
    if (PII_FIELD_NAMES.has(key)) {
      scrubbed[key] = '[redacted]'
    } else if (typeof value === 'string') {
      scrubbed[key] = value.replace(PHONE_LIKE_PATTERN, '[redacted]')
    } else {
      scrubbed[key] = value
    }
  }
  return { ...event, extra: scrubbed }
}

/**
 * No-ops when VITE_SENTRY_DSN is unset (matches src/data/supabase/client.ts's
 * pattern of warning and no-op-ing rather than erroring when unconfigured),
 * and only ever sends in a production build.
 */
export function initSentry(app: App): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) {
    console.warn('[Sentry] VITE_SENTRY_DSN not set — error tracking disabled.')
    return
  }
  if (!import.meta.env.PROD) return

  Sentry.init({
    app,
    dsn,
    beforeSend: scrubPiiBeforeSend,
  })
}
