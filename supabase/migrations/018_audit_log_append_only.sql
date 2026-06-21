-- Wafi POS — audit_log is append-only (WAFI-009).
--
-- The accountability promise ("see who did what") is only credible if the log
-- itself cannot be quietly rewritten. 005/015 left audit_log fully mutable
-- (UPDATE/DELETE policies + GRANT ALL). This migration closes that with TWO
-- independent defenses, so a single re-run of an earlier migration can't reopen
-- the hole:
--   1. Remove the UPDATE/DELETE RLS policies and revoke the grants.
--   2. A BEFORE UPDATE OR DELETE trigger that hard-blocks the operation for
--      every role except a BYPASSRLS superuser (e.g. a deliberate admin in the
--      SQL editor). The trigger fires regardless of whether a policy exists, so
--      even if 015 is re-run and recreates a policy, modification still fails.
--
-- Idempotent + expand-only: drops only the policies we created, never data.

DROP POLICY IF EXISTS audit_log_update_all ON public.audit_log;
DROP POLICY IF EXISTS audit_log_delete_all ON public.audit_log;

REVOKE UPDATE, DELETE ON public.audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_log_block_modify()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON public.audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_modify();
