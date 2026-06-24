-- Wafi POS — owner offline recovery codes (WAFI-057).
-- Expand-only: NOT NULL JSONB defaulting to '[]' — an array of single-use code
-- records, each { "hash": text, "salt": text, "usedAt": iso8601 | null }. Hashes only —
-- never plaintext. Rides the existing PowerSync publication (004) so it syncs
-- to the shop's devices and verifies OFFLINE with no extra round-trip.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.staff.recovery_codes IS
  'Single-use owner recovery codes as [{hash,salt,usedAt}]. SHA-256(salt+code); plaintext shown once at generation and never stored.';
