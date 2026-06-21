// Per-staff random salt (128-bit) as lowercase hex. A salt stored alongside the
// hash defeats precomputed/rainbow-table attacks across staff who picked the
// same 4-digit PIN; the brute-force *rate* is bounded by the lockout
// (usePinLockout), since a 4-digit space is small. The salt syncs in the staff
// row, so offline verification needs no extra round-trip.
export function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * SHA-256 of `salt + pin`. Called with no salt (legacy) it hashes the bare PIN,
 * which keeps pre-WAFI-012 unsalted hashes verifiable (verify-until-reset): a
 * staff row with no pin_salt validates against the old hash, and the salt is
 * minted the next time the PIN is set.
 */
export async function hashPin(pin: string, salt?: string | null): Promise<string> {
  const data = new TextEncoder().encode((salt ?? '') + pin)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifyPin(
  pin: string,
  storedHash: string,
  salt?: string | null,
): Promise<boolean> {
  return (await hashPin(pin, salt)) === storedHash
}
