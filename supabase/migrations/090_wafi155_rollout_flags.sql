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

  -- A NULL (or otherwise non-object) features blob means resolveFlag()
  -- (flagRegistry.ts) currently grants this shop every pack. Materialize
  -- that same all-on state before applying the rollout path -- not
  -- migration 041's one-time backfill literal, which used different values
  -- for a different, already-known set of shops at a different time.
  UPDATE shops
     SET features = jsonb_set(
           CASE
             WHEN features IS NULL OR jsonb_typeof(features) IS DISTINCT FROM 'object' THEN
               '{"staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb
             ELSE features
           END,
           ARRAY['rollout', p_flag_key],
           to_jsonb(p_enabled),
           true)
   WHERE id = p_shop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop not found: %', p_shop_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_rollout_flag(uuid, text, boolean) TO authenticated;
