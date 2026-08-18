-- supabase/migrations/097_wafi156_execute_rule_action_shop_scoped_lookup.sql
-- WAFI-156: whole-branch review fix (Task 12). The original execute_rule_action
-- (094) fetched v_event/v_rule by id alone, then raised a DIFFERENT exception
-- for "id doesn't exist" vs "id exists but belongs to another shop" -- a
-- SECURITY DEFINER function bypasses RLS on those SELECTs, so this let an
-- authenticated caller distinguish "this event_id/rule_id exists in some
-- OTHER shop" from "this id doesn't exist at all" (a narrow UUID-enumeration
-- oracle; low practical severity since UUIDs aren't guessable, but a real gap
-- in an otherwise-closed authorization boundary). Fix: scope both lookups to
-- the caller's own shop directly in the SELECT, so a foreign-shop id and a
-- nonexistent id both fall through the same NOT FOUND branch with the same
-- exception text.

CREATE OR REPLACE FUNCTION public.execute_rule_action(
  p_event_id uuid,
  p_rule_id  uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_shop          uuid;
  v_event         public.events;
  v_rule          public.business_rules;
  v_payload       jsonb;
  v_field_value   numeric;
  v_transformed   numeric;
  v_matched       boolean;
  v_claim         public.rule_action_log;
BEGIN
  v_shop := public.auth_shop_id();
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'caller has no resolvable shop';
  END IF;

  -- Scoped to the caller's own shop directly in the lookup (not a separate
  -- check after an unscoped fetch) -- a foreign-shop event_id/rule_id and a
  -- nonexistent one are now indistinguishable to the caller, closing the
  -- enumeration oracle described above.
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND shop_id = v_shop;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found: %', p_event_id;
  END IF;

  SELECT * INTO v_rule FROM public.business_rules WHERE id = p_rule_id AND shop_id = v_shop;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rule not found: %', p_rule_id;
  END IF;

  -- Remaining invariant checks, still BEFORE any claim/write below (spec
  -- §2.3 step 3). event.shop_id/rule.shop_id are now both already known to
  -- equal v_shop (guaranteed by the scoped lookups above), so the former
  -- separate "event and rule belong to different shops" check is now
  -- structurally unreachable and has been removed rather than kept as dead
  -- code that could misleadingly suggest it still does something.
  IF v_event.type != v_rule.event_type THEN
    RAISE EXCEPTION 'event type % does not match rule event_type %', v_event.type, v_rule.event_type;
  END IF;
  IF NOT v_rule.enabled THEN
    RAISE EXCEPTION 'rule % is disabled', v_rule.rule_key;
  END IF;

  -- Authoritative condition re-evaluation (spec §2.3 step 4) -- ignores
  -- whatever the client's evaluateLocally() concluded. events.payload is
  -- TEXT holding JSON (see 074_events_bus_core.sql), cast once here.
  v_payload := v_event.payload::jsonb;
  v_field_value := CASE v_rule.field
    WHEN 'refundAmountUsd' THEN (v_payload ->> 'refundAmountUsd')::numeric
    WHEN 'variance'        THEN (v_payload ->> 'variance')::numeric
    ELSE NULL
  END;
  IF v_field_value IS NULL THEN
    RAISE EXCEPTION 'unsupported or missing field % for event %', v_rule.field, p_event_id;
  END IF;

  v_transformed := CASE v_rule.transform
    WHEN 'none' THEN v_field_value
    WHEN 'abs'  THEN abs(v_field_value)
  END;

  v_matched := CASE v_rule.operator
    WHEN 'gt'  THEN v_transformed >  v_rule.threshold
    WHEN 'gte' THEN v_transformed >= v_rule.threshold
    WHEN 'lt'  THEN v_transformed <  v_rule.threshold
    WHEN 'lte' THEN v_transformed <= v_rule.threshold
    WHEN 'eq'  THEN v_transformed =  v_rule.threshold
  END;

  IF NOT v_matched THEN
    RETURN 'not_matched';
  END IF;

  -- Atomic conditional claim (spec §2.3 step 5). ON CONFLICT ... DO UPDATE
  -- takes a row lock on the conflicting row before evaluating WHERE, so a
  -- truly-concurrent second call blocks here rather than racing.
  INSERT INTO public.rule_action_log (event_id, rule_id, action, attempts, updated_at)
  VALUES (p_event_id, p_rule_id, v_rule.action, 1, now())
  ON CONFLICT (event_id, rule_id, action) DO UPDATE
    SET attempts = public.rule_action_log.attempts + 1, updated_at = now()
    WHERE public.rule_action_log.executed_at IS NULL
  RETURNING * INTO v_claim;

  IF v_claim IS NULL THEN
    RETURN 'already_executed';
  END IF;

  -- Same notifications shape as the native rules being replaced (largeReturn.rule.ts /
  -- drawerVariance.rule.ts) -- title/message text is rule-specific, kept in `name`/a
  -- small CASE here rather than a third vocabulary column, since only 2 rules exist.
  INSERT INTO public.notifications
    (id, shop_id, recipient_staff_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
  VALUES (
    gen_random_uuid(), v_event.shop_id::text, NULL, 'owner',
    v_rule.rule_key,
    v_rule.name,
    CASE v_rule.rule_key
      WHEN 'large_return'    THEN format('تم إرجاع مبلغ $%s', to_char(v_field_value, 'FM999999990.00'))
      WHEN 'drawer_variance' THEN format('تم رصد فرق %s$ في الوردية', to_char(v_transformed, 'FM999999990.00'))
      ELSE format('%s: %s', v_rule.name, v_transformed)
    END,
    CASE v_rule.event_type WHEN 'sale.returned' THEN 'return' WHEN 'shift.closed' THEN 'shift' END,
    v_event.entity_id,
    CASE v_rule.rule_key WHEN 'drawer_variance' THEN 'CRITICAL' ELSE 'WARNING' END,
    p_event_id, now()
  );

  UPDATE public.rule_action_log
    SET executed_at = now()
    WHERE (event_id, rule_id, action) = (p_event_id, p_rule_id, v_rule.action);

  RETURN 'executed';
END;
$$;

REVOKE ALL ON FUNCTION public.execute_rule_action(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_rule_action(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_rule_action(uuid, uuid) TO authenticated;
