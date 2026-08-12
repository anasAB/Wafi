import * as Sentry from '@sentry/vue'

interface DeadJobRow {
  job_type: string
  shop_id: string
  attempts: number
  last_error: string | null
}

/**
 * WAFI-154 Failure Observability: reuses the existing Sentry integration (WAFI-023),
 * best-effort, never part of the queue's own durability guarantee (that ends at the
 * SQLite state transition -- see design spec). Explicitly never includes `payload` --
 * only job_type/shop_id/attempts, consistent with WAFI-023's PII-scrubbing posture.
 *
 * Sentry calls are wrapped in try/catch to ensure this function never throws, even if
 * the Sentry SDK itself fails (network error, config issue, etc.). This protects the
 * drain loop from being disrupted by Sentry SDK failures.
 */
export async function reportDeferredJobDead(row: DeadJobRow, error?: Error): Promise<void> {
  const extra = { job_type: row.job_type, shop_id: row.shop_id, attempts: row.attempts }
  try {
    if (error) {
      Sentry.captureException(error, { extra })
    } else {
      Sentry.captureMessage(row.last_error ?? 'deferred job reached dead with no error message', { extra })
    }
  } catch {
    // Swallow any error from Sentry SDK itself to protect the drain loop.
    // Sentry reporting is best-effort and must never block deferred job processing.
  }
}
