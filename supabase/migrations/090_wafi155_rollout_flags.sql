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
