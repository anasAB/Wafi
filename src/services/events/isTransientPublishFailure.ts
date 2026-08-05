/** Single decision point for retry classification (WAFI-140 Sprint 2 design spec §4) --
 *  every call site asks this function, none invents its own ad hoc rule. This is a
 *  deliberately small, illustrative list (design spec §4), not the exhaustive
 *  production classifier -- extending it with real error samples is Sprint 3 scope. */
export function isTransientPublishFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const transientPatterns = [/busy/i, /locked/i, /i\/o error/i, /timeout/i, /disk.*unavailable/i, /rate_limit_exceeded/i]
  return transientPatterns.some((p) => p.test(message))
}
