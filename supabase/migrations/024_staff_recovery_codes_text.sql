-- Wafi POS — store recovery_codes as TEXT, not JSONB (WAFI-057 fix).
--
-- The client persists recovery_codes as a JSON *string* — JSON.stringify of the
-- code records — written through a PowerSync TEXT column. Into a JSONB column
-- that string is stored as a JSON string *scalar* (double-encoded). On sync-back
-- PowerSync hands the client a quoted string, so JSON.parse yields a String (not
-- an array), the verify loop iterates characters, and every code reads as
-- "wrong or already used". The failure is online-only: offline there is no sync
-- round-trip, so the local TEXT stays a clean array and verification works.
--
-- Storing the column as TEXT makes the client's JSON blob round-trip verbatim,
-- removing the JSON-in-JSONB coercion entirely. The client already declares this
-- column as text in its PowerSync schema, so this aligns the two ends.
--
-- USING recovery_codes #>> '{}' unwraps each existing value to plain text with no
-- data loss: a JSON string scalar (the corrupted owner row) yields its inner
-- array text, and a JSONB array (the '[]' default rows) yields '[]'. Both become
-- clean, parseable TEXT.
ALTER TABLE public.staff ALTER COLUMN recovery_codes DROP DEFAULT;
ALTER TABLE public.staff
  ALTER COLUMN recovery_codes TYPE text USING recovery_codes #>> '{}';
ALTER TABLE public.staff ALTER COLUMN recovery_codes SET DEFAULT '[]';

-- A table rewrite via ALTER TYPE is DDL and may not emit per-row logical-
-- replication events, so existing devices could keep the old (double-encoded)
-- value until the row next changes. Touch every non-empty row so PowerSync
-- re-streams the now-clean text to all synced devices.
UPDATE public.staff SET recovery_codes = recovery_codes WHERE recovery_codes <> '[]';

COMMENT ON COLUMN public.staff.recovery_codes IS
  'Single-use owner recovery codes as TEXT holding a JSON array [{hash,salt,usedAt}]. SHA-256(salt+code); plaintext shown once at generation and never stored. TEXT (not JSONB) so the client JSON blob round-trips through PowerSync without double-encoding (migration 024).';
