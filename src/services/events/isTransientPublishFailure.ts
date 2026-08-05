/** Single decision point for retry classification (WAFI-140 Sprint 2 design spec §4) --
 *  every call site asks this function, none invents its own ad hoc rule. This is a
 *  deliberately small, illustrative list (design spec §4), not the exhaustive
 *  production classifier -- extending it with real error samples is Sprint 3 scope. */
export function isTransientPublishFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  // Rate-limit rejections are transient and retry on the standard exponential backoff
  // schedule; one pattern covers both spellings, so no dedicated rate-limit policy is needed.
  // Note (WAFI-140 Sprint 3 final review): publishEvent.ts no longer enqueues
  // 'client_rate_limit_exceeded' -- a token-bucket rejection now DROPS the event rather than
  // performing another local write. The pattern is kept because the classification itself is
  // still correct for any caller that does surface such a message; it is simply unreachable
  // from that one call site today.
  const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i, /rate_limit_exceeded/i]
  return transientPatterns.some((p) => p.test(message))
}
