-- WAFI-148: can_view_health_metrics permission flag, default off.
--
-- Follows the exact WAFI-058 can_view_reports pattern -- owner-granted per
-- staff member, defaults OFF, read via the existing public.can(flag) helper
-- (migration 054). No schema change needed beyond documentation:
-- staff.permissions is already a free-form jsonb column, and public.can()
-- already reads any key from it. This migration exists to make the new key's
-- existence and default explicit and searchable.
COMMENT ON COLUMN public.staff.permissions IS
  'Owner-granted per-staff permission flags (JSONB), default-off unless explicitly '
  'granted. Existing keys: can_view_reports, can_view_expenses (WAFI-058). '
  'WAFI-148 adds: can_view_health_metrics -- gates the shop-facing health dashboard '
  '(OwnerHealthPage.vue), read via public.can(''can_view_health_metrics''), same as '
  'can_view_reports. Owners always pass (public.can() short-circuits true for '
  'auth_role() = ''owner'').';
