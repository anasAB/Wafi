-- WAFI-148: server-side read models for the 8 locked health metrics.
--
-- Two authority classes land here:
--   health_metrics -- cumulative client-authoritative (1,2,5,6, GREATEST()-merged
--                     by the RPC in migration 108) AND server-authoritative
--                     event-sourced (4,8, overwritten by the apply functions in
--                     migrations 109/110). The (shop_id, device_id, metric_key,
--                     period_start) key is shared by both; device_id is a fixed
--                     sentinel uuid for shop-level (not per-device) metrics 4/8.
--   health_gauges  -- the one client-authoritative current-state exception (3,
--                     dead-letter count): overwritten, never GREATEST()'d, never
--                     deleted, always carries observed_at freshness.
--
-- Metric 7 (stale device count) is NOT stored here at all -- it's a live query
-- over devices.last_seen_at with no historical value (see Task 14).

CREATE TABLE IF NOT EXISTS public.health_metrics (
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  device_id    uuid NOT NULL,
  metric_key   text NOT NULL CHECK (metric_key IN (
                 'sync_failure_terminal', 'sync_terminal_total',
                 'offline_duration_seconds',
                 'deferred_job_failure_terminal', 'deferred_job_terminal_total',
                 'app_error_count', 'active_device_day', 'telemetry_periods_dropped',
                 'drawer_mismatch_count', 'never_closed_shift_count'
               )),
  period_start date NOT NULL,
  value        bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, device_id, metric_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_health_metrics_shop_period
  ON public.health_metrics (shop_id, period_start);

CREATE TABLE IF NOT EXISTS public.health_gauges (
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  device_id    uuid NOT NULL,
  gauge_key    text NOT NULL CHECK (gauge_key IN ('dead_letter_count')),
  value        bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  observed_at  timestamptz NOT NULL,
  PRIMARY KEY (shop_id, device_id, gauge_key)
);

ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_gauges  ENABLE ROW LEVEL SECURITY;

-- Shop-scoped read, mirroring every other synced/read-model table's RLS
-- (auth_shop_id(), migration 015 pattern). No client INSERT/UPDATE/DELETE
-- policy exists on either table -- all writes go through the SECURITY
-- DEFINER RPC (migration 108) and the SECURITY DEFINER apply functions
-- (migrations 109/110), never direct client writes.
CREATE POLICY health_metrics_select_own_shop ON public.health_metrics
  FOR SELECT USING (shop_id = public.auth_shop_id());

CREATE POLICY health_gauges_select_own_shop ON public.health_gauges
  FOR SELECT USING (shop_id = public.auth_shop_id());

GRANT SELECT ON public.health_metrics TO authenticated;
GRANT SELECT ON public.health_gauges TO authenticated;
