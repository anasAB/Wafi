-- supabase/migrations/118_wafi148a_claim_functions.sql
-- WAFI-148A: shared claim/notify contract. Every alert evaluator built in
-- later tasks (metrics 1-8) calls one of these three functions instead of
-- writing to health_alert_state_a/health_alert_state_b or public.notifications
-- directly. Keeping the claim-then-notify sequence inside a single SECURITY
-- DEFINER function per shape is what makes the "at most one notification per
-- claimed period/transition" guarantee hold under concurrency: the INSERT ...
-- ON CONFLICT statement takes a row lock as part of evaluating the conflict,
-- so a genuinely-concurrent second caller blocks on that lock and, once the
-- first transaction commits, evaluates its own DO NOTHING/DO UPDATE ... WHERE
-- against the now-committed row and correctly finds nothing to claim.
--
-- Recipient resolution: NOT a staff-table lookup. Mirrors the exact pattern
-- execute_rule_action() uses (migration 094, lines 99-101) -- insert with
-- recipient_staff_id = NULL, recipient_role = 'owner' directly. RLS and the
-- client-side notification UI resolve "owner" role membership themselves.
--
-- Type note: public.notifications.shop_id and entity_id are TEXT (migration
-- 079), NOT uuid like health_alert_state_a/health_alert_state_b. Every insert
-- below casts explicitly.
--
-- Authorization: none of these three functions are directly EXECUTE-able by
-- `authenticated` (or `anon`) -- they are internal building blocks called only
-- by other SECURITY DEFINER code (a trigger, cron functions, or the
-- foreground RPC -- none built yet; later tasks). Locked down the same way
-- execute_rule_action() is locked down in migration 094, except that
-- execute_rule_action() *is* granted to `authenticated` because it is itself
-- the public entry point; these three are not entry points, so no GRANT to
-- authenticated is issued at all.

-- ============================================================================
-- claim_health_alert_period: Shape A (metrics 1, 2, 5, 6 -- foreground-
-- triggered, period-bounded). Metric 4 (drawer mismatches) is event-derived
-- and passes its own p_source_event_id.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_health_alert_period(
  p_shop_id          uuid,
  p_metric_key        text,
  p_period_start      date,
  p_threshold_used    numeric,
  p_type              text,
  p_title             text,
  p_message           text,
  p_severity          text DEFAULT 'WARNING',
  p_source_event_id   uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed public.health_alert_state_a;
BEGIN
  INSERT INTO public.health_alert_state_a (shop_id, metric_key, period_start, threshold_used, alerted_at)
  VALUES (p_shop_id, p_metric_key, p_period_start, p_threshold_used, now())
  ON CONFLICT (shop_id, metric_key, period_start) DO NOTHING
  RETURNING * INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.notifications
    (id, shop_id, recipient_staff_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
  VALUES (
    gen_random_uuid(), p_shop_id::text, NULL, 'owner',
    p_type, p_title, p_message,
    NULL, NULL,
    p_severity, p_source_event_id, now()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_health_alert_period(uuid, text, date, numeric, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_health_alert_period(uuid, text, date, numeric, text, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_health_alert_period(uuid, text, date, numeric, text, text, text, text, uuid) FROM authenticated;

-- ============================================================================
-- claim_health_alert_transition: Shape B (metrics 3, 7, 8 -- reversible
-- HEALTHY/ALERTING conditions). Single statement handles both the "no row
-- yet" (bootstrap/INSERT path) and "existing row is HEALTHY" (DO UPDATE path)
-- cases identically -- both are eligible to claim. An existing ALERTING row
-- is not re-claimable: the WHERE clause on the DO UPDATE means no row comes
-- back, so v_claimed IS NULL and we return false without touching anything.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_health_alert_transition(
  p_shop_id      uuid,
  p_alert_key    text,
  p_entity_id    uuid,
  p_type         text,
  p_title        text,
  p_message      text,
  p_severity     text DEFAULT 'WARNING',
  p_entity_type  text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed public.health_alert_state_b;
BEGIN
  INSERT INTO public.health_alert_state_b (shop_id, alert_key, entity_id, state, state_changed_at)
  VALUES (p_shop_id, p_alert_key, p_entity_id, 'ALERTING', now())
  ON CONFLICT (shop_id, alert_key, entity_id) DO UPDATE
    SET state = 'ALERTING', state_changed_at = now()
    WHERE public.health_alert_state_b.state = 'HEALTHY'
  RETURNING * INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.notifications
    (id, shop_id, recipient_staff_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
  VALUES (
    gen_random_uuid(), p_shop_id::text, NULL, 'owner',
    p_type, p_title, p_message,
    p_entity_type, p_entity_id::text,
    p_severity, NULL, now()
  );

  UPDATE public.health_alert_state_b
    SET last_notified_at = now()
    WHERE (shop_id, alert_key, entity_id) = (p_shop_id, p_alert_key, p_entity_id);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_health_alert_transition(uuid, text, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_health_alert_transition(uuid, text, uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_health_alert_transition(uuid, text, uuid, text, text, text, text, text) FROM authenticated;

-- ============================================================================
-- resolve_health_alert_transition: Shape B recovery. Recovery is SILENT --
-- this function must NEVER insert a notification. A plain unconditional
-- UPDATE already satisfies "no-op, not an error" when no row matches, so no
-- special-casing is needed for the missing-row case.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_health_alert_transition(
  p_shop_id    uuid,
  p_alert_key  text,
  p_entity_id  uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.health_alert_state_b
    SET state = 'HEALTHY'
    WHERE (shop_id, alert_key, entity_id) = (p_shop_id, p_alert_key, p_entity_id);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_health_alert_transition(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_health_alert_transition(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_health_alert_transition(uuid, text, uuid) FROM authenticated;
