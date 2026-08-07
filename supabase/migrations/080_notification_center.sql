-- supabase/migrations/080_notification_center.sql
-- WAFI-145 -- Owner Notification Center: business hours, per-type settings, and
-- making notifications.source_event_id nullable for state-derived rows (Low Stock,
-- Sync Failure) that have no originating domain event to key on. This is the same
-- nullable/partial-index pattern audit_log already uses (079_notifications.sql's
-- header comment calls this out as the alternative "if a future ticket introduces
-- manual/system notifications with no originating event" -- this is that ticket).

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS open_time TIME;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS close_time TIME;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS is_24_7 BOOLEAN NOT NULL DEFAULT false;

-- open_time = close_time is rejected as ambiguous (use is_24_7 for "always open"
-- instead). open_time > close_time is a VALID overnight window (e.g. 08:00-02:00)
-- -- not rejected. NULL/NULL (including the is_24_7=true case, which the app
-- enforces by setting both to NULL) means "no operating-hours checks for this shop".
ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_hours_not_equal;
ALTER TABLE public.shops ADD CONSTRAINT shops_hours_not_equal
  CHECK (open_time IS NULL OR close_time IS NULL OR open_time <> close_time);

-- Distinct from read_at: a CRITICAL notification requires explicit acknowledgment,
-- not just having been viewed.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- State-derived rules (Low Stock, Sync Failure) have no source event, so
-- source_event_id must become nullable. The old NOT NULL unique index is replaced
-- with a partial index that only enforces uniqueness (exact-replay dedup) for
-- event-driven rows; state-derived rows insert with source_event_id = NULL and rely
-- on their own crossing/dedup logic instead (see the notification rule code).
ALTER TABLE public.notifications ALTER COLUMN source_event_id DROP NOT NULL;
DROP INDEX IF EXISTS public.notifications_source_event_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_event_id_unique
  ON public.notifications (source_event_id) WHERE source_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_settings (
  shop_id        UUID NOT NULL REFERENCES public.shops(id),
  type           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  threshold_json JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, type)
);
-- Sparse by design: a missing row resolves to the type's hardcoded default
-- (enabled=true, default threshold). A row is written only when the owner
-- overrides something -- not pre-seeded for all 10 settings-bearing types x shop.
-- inventory.low_stock deliberately never gets a row here (its threshold is
-- products.low_stock_threshold, per product).
--
-- NOTE: notification_settings.shop_id is UUID (references shops.id directly), unlike
-- notifications.shop_id which is TEXT -- a known pre-existing inconsistency in
-- 079_notifications.sql, not something this migration "fixes".

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_settings_select_scoped ON public.notification_settings;
CREATE POLICY notification_settings_select_scoped ON public.notification_settings
  FOR SELECT TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id())::uuid);

DROP POLICY IF EXISTS notification_settings_upsert_scoped ON public.notification_settings;
CREATE POLICY notification_settings_upsert_scoped ON public.notification_settings
  FOR INSERT TO authenticated, anon
  WITH CHECK (shop_id = (SELECT public.auth_shop_id())::uuid);

DROP POLICY IF EXISTS notification_settings_update_scoped ON public.notification_settings;
CREATE POLICY notification_settings_update_scoped ON public.notification_settings
  FOR UPDATE TO authenticated, anon
  USING (shop_id = (SELECT public.auth_shop_id())::uuid)
  WITH CHECK (shop_id = (SELECT public.auth_shop_id())::uuid);

GRANT ALL ON TABLE public.notification_settings TO anon, authenticated, service_role;
