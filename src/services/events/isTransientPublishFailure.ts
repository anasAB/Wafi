/** Single decision point for retry classification (WAFI-140 Sprint 2 design spec §4) --
 *  every call site asks this function, none invents its own ad hoc rule. This is a
 *  deliberately small, illustrative list (design spec §4), not the exhaustive
 *  production classifier -- extending it with real error samples is Sprint 3 scope. */
export function isTransientPublishFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  // Rate-limit rejections from both client-side token bucket (client_rate_limit_exceeded)
  // and server-side quota enforcement (events_rate_limit_exceeded) are transient and
  // retry on the standard exponential backoff schedule. Both share this single pattern
  // so no dedicated rate-limit policy is required.
  const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i, /rate_limit_exceeded/i]
  return transientPatterns.some((p) => p.test(message))
}
