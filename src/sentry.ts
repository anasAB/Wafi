import * as Sentry from '@sentry/vue'
import type { App } from 'vue'

const PII_FIELD_NAMES = new Set(['phone', 'customerName', 'nameAr', 'name'])
const PHONE_LIKE_PATTERN = /\+?\d{9,}/g

/**
 * Redacts known-PII field names and any phone-number-shaped substring from
 * a plain object, returning a new object. Shared by every scrubbing path
 * below (event.extra, event.contexts.vue.propsData, breadcrumb.data).
 */
function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (PII_FIELD_NAMES.has(key)) {
      scrubbed[key] = '[redacted]'
    } else if (typeof value === 'string') {
      scrubbed[key] = value.replace(PHONE_LIKE_PATTERN, '[redacted]')
    } else {
      scrubbed[key] = value
    }
  }
  return scrubbed
}

/**
 * Strips known-PII field values and any phone-number-shaped substring from
 * a Sentry event before it leaves the browser. This is real Syrian shop
 * customer data (names, phone numbers) going to Sentry's (US-based)
 * servers -- scrub first, not an afterthought.
 *
 * Covers every channel Sentry actually populates:
 * - `event.extra` -- our own explicit `Sentry.setExtra`/`captureException` context.
 * - `event.contexts.vue.propsData` -- @sentry/vue's `attachProps` (default true)
 *   attaches the erroring component's props verbatim. We disable attachProps
 *   at init() as the primary defense (see initSentry), and scrub here too in
 *   case some path still populates it.
 * - `event.breadcrumbs[].message` / `.data` -- the default breadcrumbs
 *   integration captures console/DOM/fetch data that can carry PII.
 */
export function scrubPiiBeforeSend(event: Sentry.ErrorEvent, _hint: Sentry.EventHint): Sentry.ErrorEvent {
  const scrubbedEvent: Sentry.ErrorEvent = { ...event }

  if (event.extra) {
    scrubbedEvent.extra = scrubObject(event.extra)
  }

  const propsData = event.contexts?.vue?.propsData as Record<string, unknown> | undefined
  if (propsData) {
    scrubbedEvent.contexts = {
      ...event.contexts,
      vue: {
        ...event.contexts?.vue,
        propsData: scrubObject(propsData),
      },
    }
  }

  if (event.breadcrumbs) {
    scrubbedEvent.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      const next = { ...breadcrumb }
      if (typeof next.message === 'string') {
        next.message = next.message.replace(PHONE_LIKE_PATTERN, '[redacted]')
      }
      if (next.data) {
        next.data = scrubObject(next.data)
      }
      return next
    })
  }

  return scrubbedEvent
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

  const environment = (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || 'production'

  Sentry.init({
    app,
    dsn,
    environment,
    // Cheapest, most robust fix for PII leaking via Vue component props:
    // disable @sentry/vue's props-attachment channel entirely rather than
    // relying solely on scrubbing after the fact (see scrubPiiBeforeSend
    // doc comment for the defense-in-depth scrubbing that remains).
    attachProps: false,
    beforeSend: scrubPiiBeforeSend,
  })
}
