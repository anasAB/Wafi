-- supabase/migrations/061_audit_domain_rls.sql
-- WAFI-122: audit_log SELECT restricted to owner, or manager with
-- can_view_reports (reuses the existing reports flag rather than inventing
-- a new one -- audit log is a reporting-adjacent surface per design spec
-- §5.7). INSERT stays open to every shop role (every domain's mutations
-- write their own audit entries, system-generated). UPDATE/DELETE remain
-- absent -- already enforced append-only by migration 018, unchanged here.

DROP POLICY IF EXISTS audit_log_select_all ON public.audit_log;

CREATE POLICY audit_log_select_owner_or_permission ON public.audit_log
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = ((SELECT public.auth_shop_id()))::text
    AND (public.auth_role() = 'owner' OR public.can('can_view_reports'))
  );
