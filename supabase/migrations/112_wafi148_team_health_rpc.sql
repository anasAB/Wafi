-- WAFI-148: cross-shop team health read, gated identically to
-- list_shops_for_rollout_admin (migration 090) -- platform_admins, NOT
-- can_view_health_metrics. These are deliberately different predicates:
-- can_view_health_metrics is an owner-granted per-shop staff flag for that
-- shop's OWN dashboard; this RPC is the founders' cross-shop operational
-- view and must reject an ordinary shop session outright, regardless of
-- any permission flag that shop's owner has granted.
CREATE OR REPLACE FUNCTION public.list_health_for_admin(p_shop_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id                   uuid,
  shop_name                 text,
  device_id                 uuid,
  metric_key                text,
  period_start              date,
  value                     bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT hm.shop_id, s.name, hm.device_id, hm.metric_key, hm.period_start, hm.value
    FROM public.health_metrics hm
    JOIN public.shops s ON s.id = hm.shop_id
   WHERE NULLIF(trim(p_shop_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_shop_query) || '%'
   ORDER BY s.name, hm.period_start DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_health_for_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_health_for_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_health_for_admin(text) TO authenticated;

-- list_health_for_admin only covers health_metrics (the cumulative/event-sourced
-- rows). Metric 3 (the gauge) and metric 7 (a live query, no stored row at all)
-- need their own companion function, gated identically.
CREATE OR REPLACE FUNCTION public.list_health_gauges_and_devices_for_admin(p_shop_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id      uuid,
  shop_name    text,
  device_id    uuid,
  gauge_key    text,
  gauge_value  bigint,
  observed_at  timestamptz,
  device_is_active   boolean,
  device_last_seen_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT s.id, s.name, d.id, hg.gauge_key, hg.value, hg.observed_at, d.is_active, d.last_seen_at
    FROM public.devices d
    JOIN public.shops s ON s.id = d.shop_id
    LEFT JOIN public.health_gauges hg ON hg.shop_id = d.shop_id AND hg.device_id = d.id
   WHERE NULLIF(trim(p_shop_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_shop_query) || '%'
   ORDER BY s.name, d.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_health_gauges_and_devices_for_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_health_gauges_and_devices_for_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_health_gauges_and_devices_for_admin(text) TO authenticated;
