-- WAFI-155: engineering rollout flags, distinct from WAFI-131's pricing-pack
-- flags. See docs/superpowers/specs/2026-08-13-wafi155-feature-flag-framework-design.md
-- for full design and the NULL-grandfathering / trigger-interaction findings
-- this migration's set_rollout_flag (Task 2) exists to handle correctly.

CREATE TABLE public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_admins IS
  'Platform-level operators, orthogonal to any shop''s staff/role model.
   Membership is managed only through the trusted Supabase dashboard SQL
   path; there is no authenticated/anon client write policy for this table.';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_admins_self_select ON public.platform_admins
  FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON public.platform_admins TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM authenticated;
REVOKE ALL ON public.platform_admins FROM anon;

CREATE OR REPLACE FUNCTION public.set_rollout_flag(
  p_shop_id  uuid,
  p_flag_key text,
  p_enabled  boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base jsonb;
BEGIN
  -- Authorization first, before any parameter is validated -- an
  -- unauthorized caller must not learn whether p_shop_id/p_flag_key are
  -- even well-formed.
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_shop_id IS NULL THEN
    RAISE EXCEPTION 'shop id is required' USING ERRCODE = 'P0002';
  END IF;
  IF p_flag_key IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'flag key and enabled value are required' USING ERRCODE = 'P0003';
  END IF;

  IF p_flag_key NOT IN ('dashboard_v2', 'pos_brain', 'insights') THEN
    RAISE EXCEPTION 'unknown rollout flag: %', p_flag_key USING ERRCODE = 'P0003';
  END IF;

  -- FOR UPDATE locks the row for the rest of this transaction and lets us
  -- read `features` before deciding how to mutate it -- a single UPDATE
  -- expression can't do this in two jsonb_set passes (below) without
  -- reading the column's pre-mutation value first.
  SELECT features INTO v_base FROM shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop not found: %', p_shop_id USING ERRCODE = 'P0002';
  END IF;

  -- A NULL (or otherwise non-object) features blob means resolveFlag()
  -- (flagRegistry.ts) currently grants this shop every pack. Materialize
  -- that same all-on state before applying the rollout path -- not
  -- migration 041's one-time backfill literal, which used different values
  -- for a different, already-known set of shops at a different time.
  IF v_base IS NULL OR jsonb_typeof(v_base) IS DISTINCT FROM 'object' THEN
    v_base := '{"staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb;
  END IF;

  -- protect_shop_server_only_columns (075) reverts `features` on ANY
  -- request carrying a JWT, with no exception for a trusted SECURITY
  -- DEFINER RPC's own write -- SECURITY DEFINER changes privilege-checking
  -- identity, not this custom GUC, which stays set for the whole request
  -- regardless of which function runs inside it. Authorization has already
  -- been verified above; this is a narrowly scoped, single-statement
  -- override, transaction-local (is_local=true) so it cannot leak into any
  -- other request. Do not copy this pattern elsewhere without the same
  -- preceding authorization guarantee.
  PERFORM set_config('request.jwt.claims', '', true);

  -- jsonb_set requires every path segment except the LAST to already
  -- exist, or it silently no-ops (Postgres docs: "if any step of the path
  -- other than the last is missing ... no change is made" -- create_missing
  -- only ever creates the final segment). No shop's features starts with a
  -- `rollout` key, so a single jsonb_set(v_base, '{rollout,<key>}', ...)
  -- would silently do nothing on every real first write. Two sequential
  -- calls: first ensure `rollout` exists as an object (creating it from
  -- '{}' if v_base has none), then set the nested key on a base that is
  -- now guaranteed to already contain it.
  UPDATE shops
     SET features = jsonb_set(
           jsonb_set(v_base, ARRAY['rollout'], coalesce(v_base -> 'rollout', '{}'::jsonb), true),
           ARRAY['rollout', p_flag_key],
           to_jsonb(p_enabled),
           true)
   WHERE id = p_shop_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_rollout_flag(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_shops_for_rollout_admin(p_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id      uuid,
  shop_name    text,
  dashboard_v2 boolean,
  pos_brain    boolean,
  insights     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  -- Fail-closed flag parsing, matching the TypeScript resolver's contract:
  -- only the JSON literal `true` reads as enabled. `= 'true'::jsonb` on a
  -- non-boolean value evaluates to NULL rather than throwing, so
  -- coalesce(..., false) safely reduces every malformed case to "off".
  RETURN QUERY
  SELECT s.id, s.name,
         coalesce(s.features -> 'rollout' -> 'dashboard_v2' = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'pos_brain'    = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'insights'     = 'true'::jsonb, false)
    FROM shops s
   WHERE NULLIF(trim(p_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_query) || '%'
   ORDER BY s.name, s.id
   LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_shops_for_rollout_admin(text) TO authenticated;
