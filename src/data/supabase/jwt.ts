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

/** Extract the shop_id claim, or null when absent/blank/unparsable. */
export function shopIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  const shopId = decodeJwtPayload(token)?.shop_id
  return typeof shopId === 'string' && shopId.length > 0 ? shopId : null
}
