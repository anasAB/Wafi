/** Single decision point for retry classification, shared by both the publish side
 *  (WAFI-140 Sprint 2) and the consumption side (WAFI-150) -- a database lock, timeout,
 *  or I/O error means the same thing regardless of which direction hit it, so there is
 *  exactly one classifier, not one per direction. Deliberately a small, illustrative
 *  list, not an exhaustive production classifier. */
export function isTransientEventFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i, /rate_limit_exceeded/i]
  return transientPatterns.some((p) => p.test(message))
}
