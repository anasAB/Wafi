-- Wafi POS — per-staff PIN salt (WAFI-012).
-- Expand-only: a nullable column. Existing rows keep pin_salt = NULL and their
-- unsalted hash still verifies (verify-until-reset in usePinAuth); a salt is
-- minted the next time each staff member's PIN is set.
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS pin_salt TEXT;

COMMENT ON COLUMN public.staff.pin_salt IS
  'Per-staff random salt (hex) prepended to the PIN before SHA-256. NULL = legacy unsalted hash.';
