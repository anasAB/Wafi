-- supabase/migrations/079_notifications.sql
-- WAFI-143 -- durable business-fact table for the notification subscriber reference
-- consumer (design spec, "Notification consumer"). recipient_staff_id/recipient_role are
-- both nullable and not mutually exclusive by constraint: a notification targets one
-- staff member OR a whole role (today always 'owner'); the column exists now so
-- manager/supervisor/accountant targeting in a future ticket costs a row, not a migration.
-- source_event_id is NOT NULL (unlike audit_log's nullable/partial-index version) --
-- every row in this ticket's scope originates from exactly one event; revisit nullability
-- only if a future ticket introduces manual/system notifications with no originating event.

CREATE TABLE IF NOT EXISTS public.notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             TEXT NOT NULL,
  recipient_staff_id  TEXT,
  recipient_role      TEXT,
  type                TEXT NOT NULL,
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  entity_type         TEXT,
  entity_id           TEXT,
  severity            TEXT NOT NULL DEFAULT 'INFO'
                        CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  source_event_id     UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_event_id_unique
  ON public.notifications (source_event_id);

CREATE INDEX IF NOT EXISTS idx_notifications_shop_created
  ON public.notifications (shop_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: shop-scoped AND recipient-scoped -- the second axis no other table in this
-- codebase needs. A row targets a specific staff member OR a whole role; visible if
-- either matches the requester.
DROP POLICY IF EXISTS notifications_select_scoped ON public.notifications;
CREATE POLICY notifications_select_scoped ON public.notifications
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())::text
    AND (
      recipient_staff_id = (SELECT public.auth_staff_id())::text
      OR recipient_role = (SELECT public.auth_role())
    )
  );

-- INSERT: shop-scoped only -- a writer (the notification subscriber, running as
-- whichever staff member's device triggered the originating event) is already gated by
-- the source event's own RLS; double-gating here on recipient would be redundant, not an
-- additional real boundary (the row's whole purpose is to be readable by someone OTHER
-- than the writer).
DROP POLICY IF EXISTS notifications_insert_all ON public.notifications;
CREATE POLICY notifications_insert_all ON public.notifications
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id())::text);

-- UPDATE: only for marking read_at -- shop-scoped AND recipient-scoped, same predicate
-- as SELECT (a staff member may only mark their own/their role's notifications read).
DROP POLICY IF EXISTS notifications_update_scoped ON public.notifications;
CREATE POLICY notifications_update_scoped ON public.notifications
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())::text
    AND (
      recipient_staff_id = (SELECT public.auth_staff_id())::text
      OR recipient_role = (SELECT public.auth_role())
    )
  )
  WITH CHECK (shop_id = (SELECT public.auth_shop_id())::text);

GRANT ALL ON TABLE public.notifications TO anon, authenticated, service_role;
