-- supabase/migrations/074_events_bus_core.sql
-- WAFI-140 Sprint 1 — event bus core. See design spec
-- docs/superpowers/specs/2026-07-31-wafi-140-event-bus-sprint1-design.md §4.

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_version integer NOT NULL DEFAULT 1,
  staff_id uuid NOT NULL,
  shop_id uuid NOT NULL REFERENCES public.shops(id),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_shop_type_idx ON public.events (shop_id, type, occurred_at DESC);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Append-only (matches audit_log, 018_audit_log_append_only.sql): no UPDATE/DELETE
-- policy is created. SELECT/INSERT stay shop-wide this sprint (per-event-type
-- restriction, e.g. cashier can't see staff.ledger_entry_added, is Sprint 3).
DROP POLICY IF EXISTS events_select_all ON public.events;
CREATE POLICY events_select_all ON public.events
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS events_insert_all ON public.events;
CREATE POLICY events_insert_all ON public.events
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));

CREATE TABLE IF NOT EXISTS public.daily_event_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id),
  event_type text NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  UNIQUE (shop_id, event_type, day)
);

ALTER TABLE public.daily_event_counts ENABLE ROW LEVEL SECURITY;

-- Full CRUD (unlike events): a mutable projection, incremented in place by the
-- reference read-model subscriber (Task 5), not an append-only log.
DROP POLICY IF EXISTS daily_event_counts_select_all ON public.daily_event_counts;
CREATE POLICY daily_event_counts_select_all ON public.daily_event_counts
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS daily_event_counts_insert_all ON public.daily_event_counts;
CREATE POLICY daily_event_counts_insert_all ON public.daily_event_counts
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));
DROP POLICY IF EXISTS daily_event_counts_update_all ON public.daily_event_counts;
CREATE POLICY daily_event_counts_update_all ON public.daily_event_counts
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id()))
  WITH CHECK (shop_id = (SELECT public.auth_shop_id()));

DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['events', 'daily_event_counts']
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = pub_name AND schemaname = 'public' AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', pub_name, tbl);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
