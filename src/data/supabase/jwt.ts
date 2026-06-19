/**
 * Minimal JWT payload decoding — no dependency, no network.
 * We only ever read the locally-stored Supabase access token to learn the
 * shop_id claim, so this must work offline (Sacred Rule #1).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Extract the shop_id claim, or null when absent/blank/unparsable.
 * Prefers a top-level `shop_id` claim (custom access token hook) and falls back
 * to `app_metadata.shop_id` (set directly on the user — no hook required, always
 * present in the Supabase JWT). Supporting both keeps either delivery path working.
 */
export function shopIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  const payload = decodeJwtPayload(token)
  if (!payload) return null

  const direct = asNonEmptyString(payload.shop_id)
  if (direct) return direct

  const appMeta = payload.app_metadata
  if (appMeta && typeof appMeta === 'object') {
    return asNonEmptyString((appMeta as Record<string, unknown>).shop_id)
  }
  return null
}
