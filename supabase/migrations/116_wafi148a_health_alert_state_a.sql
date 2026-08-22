-- WAFI-148A: Shape A alert state for period-bounded health alerts.
--
-- Metrics 1, 2, 4, 5, 6 (sync failures, offline duration, drawer mismatches,
-- deferred-job failures, app errors) track whether an alert has been raised for
-- the current shop-local day (period_start). Once claimed, no further alert fires
-- for that day regardless of subsequent metric changes. Recovery is automatic at
-- day boundary (period_start increments to a new date).

CREATE TABLE IF NOT EXISTS public.health_alert_state_a (
  shop_id        uuid NOT NULL REFERENCES public.shops(id),
  metric_key     text NOT NULL,
  period_start   date NOT NULL,
  threshold_used numeric NOT NULL,
  alerted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, metric_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_health_alert_state_a_shop_period
  ON public.health_alert_state_a (shop_id, period_start);

ALTER TABLE public.health_alert_state_a ENABLE ROW LEVEL SECURITY;

-- Shop-scoped read, mirroring health_metrics/health_gauges RLS (migration 107).
-- No client INSERT/UPDATE/DELETE policy — all writes go through SECURITY DEFINER
-- RPC and claim functions, never direct client writes.
CREATE POLICY health_alert_state_a_select_own_shop ON public.health_alert_state_a
  FOR SELECT USING (shop_id = public.auth_shop_id());

GRANT SELECT ON public.health_alert_state_a TO authenticated;
