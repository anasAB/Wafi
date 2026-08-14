-- supabase/migrations/093_wafi156_rule_action_log.sql
-- WAFI-156: server-only execution ledger. NOT synced via PowerSync, NOT added
-- to schema.ts or powersync.yaml, NO client read/write access at all -- see
-- spec §2.3 "why this table is safe from the offline-dedup trap". The
-- Notification Center stays backed entirely by `notifications`.

CREATE TABLE IF NOT EXISTS public.rule_action_log (
  event_id    uuid NOT NULL REFERENCES public.events(id)         ON DELETE RESTRICT,
  rule_id     uuid NOT NULL REFERENCES public.business_rules(id) ON DELETE RESTRICT,
  action      text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  last_error  text,
  executed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, rule_id, action)
);

-- No RLS enable, no policy, no grant to authenticated/anon: this table has
-- zero client-reachable path. Only execute_rule_action() (SECURITY DEFINER,
-- Task 3) ever reads or writes it, running with the privileges of the
-- function's owner role, not the caller's.
REVOKE ALL ON public.rule_action_log FROM authenticated, anon, PUBLIC;
