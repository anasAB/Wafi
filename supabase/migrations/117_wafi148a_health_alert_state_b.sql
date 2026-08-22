-- WAFI-148A: Shape B alert state for reversible health conditions.
--
-- Metrics 3 (dead-letter count), 7 (stale devices), 8 (overdue shifts) track
-- state transitions from HEALTHY to ALERTING and back. Unlike Shape A's
-- period-bounded alerts, Shape B persists the current state and logs when
-- transitions occur, enabling stateful recovery signals (e.g., shift.closed
-- event clearing an overdue-shift alert).
--
-- The entity_id column is deliberately NOT a foreign key. Historical alert state
-- must survive the referenced device/shift being deleted or deactivated, to
-- support recovery-state reconciliation without orphaned rows. See design spec
-- section "Alert-State Model / Shape B" for detailed rationale.

CREATE TABLE IF NOT EXISTS public.health_alert_state_b (
  shop_id          uuid NOT NULL REFERENCES public.shops(id),
  -- alert_key: which metric this row tracks. Closed set to prevent typos.
  -- 'dead_letter_count': shop-level, entity_id is nil UUID
  -- 'stale_device': per-device, entity_id is device_id
  -- 'overdue_shift': per-shift, entity_id is shift_id
  alert_key        text NOT NULL CHECK (alert_key IN
                     ('dead_letter_count','stale_device','overdue_shift')),
  -- entity_id: the entity this alert is about (device, shift, or nil UUID for shop-level).
  -- NOT a foreign key by design — state must outlive the referenced entity.
  entity_id        uuid NOT NULL,
  -- state: current alert state. HEALTHY means no ongoing condition; ALERTING
  -- means the metric has transitioned from HEALTHY → ALERTING and not yet recovered.
  state            text NOT NULL CHECK (state IN ('HEALTHY','ALERTING')),
  -- state_changed_at: timestamp of the most recent state transition (HEALTHY→ALERTING
  -- or ALERTING→HEALTHY). Used to compute elapsed time for conditions like
  -- overdue shifts, and to track transition history.
  state_changed_at timestamptz NOT NULL,
  -- last_notified_at: timestamp of the most recent notification created for a
  -- HEALTHY→ALERTING transition on this row. Nullable (no notification has ever
  -- fired for this row yet, or it never fired one after a recovery→re-alert cycle).
  -- Used only for operational inspection/audit; no decision logic depends on it.
  last_notified_at timestamptz,
  PRIMARY KEY (shop_id, alert_key, entity_id)
);

-- Index to support efficient queries over alert state by shop and key.
CREATE INDEX IF NOT EXISTS idx_health_alert_state_b_shop_key
  ON public.health_alert_state_b (shop_id, alert_key);

-- Partial index to support #7's existing-state reconciliation query:
-- "which ALERTING device-stale alerts exist for this shop?"
CREATE INDEX IF NOT EXISTS idx_health_alert_state_b_stale_device_alerting
  ON public.health_alert_state_b (shop_id, entity_id)
  WHERE alert_key = 'stale_device' AND state = 'ALERTING';

-- Partial index to support #8's existing-state reconciliation query:
-- "which ALERTING overdue-shift alerts exist for this shop?"
CREATE INDEX IF NOT EXISTS idx_health_alert_state_b_overdue_shift_alerting
  ON public.health_alert_state_b (shop_id, entity_id)
  WHERE alert_key = 'overdue_shift' AND state = 'ALERTING';

ALTER TABLE public.health_alert_state_b ENABLE ROW LEVEL SECURITY;

-- Shop-scoped read, mirroring health_metrics/health_gauges RLS (migration 107).
-- No client INSERT/UPDATE/DELETE policy — all writes go through SECURITY DEFINER
-- RPC and claim functions, never direct client writes.
CREATE POLICY health_alert_state_b_select_own_shop ON public.health_alert_state_b
  FOR SELECT USING (shop_id = public.auth_shop_id());

GRANT SELECT ON public.health_alert_state_b TO authenticated;
