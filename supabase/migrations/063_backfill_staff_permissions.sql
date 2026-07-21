-- Wafi POS — WAFI-122 follow-up: backfill the 4 permission flags added by
-- this branch (can_manage_inventory, can_manage_suppliers,
-- can_manage_stock_take, can_view_staff_ledger) into existing staff rows.
--
-- Migration 054's `can(flag)` helper reads the raw stored `staff.permissions`
-- column via auth_permissions(). For any staff row written BEFORE this
-- branch shipped, these 4 keys are entirely absent from the stored JSON, so
-- `(auth_permissions() ->> flag)::boolean` evaluates to NULL and `can()`
-- returns false — even for an existing manager, whose MANAGER_PERMISSIONS
-- constant (src/features/staff/staff.types.ts) says can_manage_inventory /
-- can_manage_suppliers / can_manage_stock_take should always be true. The
-- client recomputes effective permissions on read via permissionsForRole(),
-- so the UI would still show these actions as available while the server
-- silently rejects the writes — a functional regression for every
-- pre-existing manager, invisible until the row happens to be re-saved.
--
-- This migration fills in ONLY the keys that are currently missing from the
-- stored JSON, per role, matching exactly what permissionsForRole() would
-- compute for a staff member who never had a custom value set for these new
-- flags:
--   - owner:   all 4 new flags -> true  (OWNER_PERMISSIONS: every flag true)
--   - manager: can_manage_inventory / can_manage_suppliers / can_manage_stock_take
--              -> true (fixed structural flags in the manager branch of
--              permissionsForRole); can_view_staff_ledger -> false (financial
--              flag, owner-grantable per-manager, defaults to
--              Boolean(custom?.can_view_staff_ledger) = false when unset)
--   - cashier: all 4 new flags -> false (DEFAULT_CASHIER_PERMISSIONS)
--
-- Existing per-staff values for these flags (if any were somehow already
-- set) are preserved untouched: `(permissions::jsonb ->> flag)::boolean` is
-- NULL only when the key is absent; when the key is present (true or false),
-- COALESCE keeps that existing value instead of the backfill default. This
-- makes the migration idempotent and safe to re-run.
--
-- staff.permissions is TEXT holding a JSON string (migration 032, not
-- JSONB — avoids PowerSync double-encoding), so every read/write here goes
-- through explicit ::jsonb / ::text casts, matching migration 032's pattern.

UPDATE public.staff
SET permissions = (
  permissions::jsonb
  || jsonb_build_object(
       'can_manage_inventory',  COALESCE((permissions::jsonb ->> 'can_manage_inventory')::boolean, true),
       'can_manage_suppliers',  COALESCE((permissions::jsonb ->> 'can_manage_suppliers')::boolean, true),
       'can_manage_stock_take', COALESCE((permissions::jsonb ->> 'can_manage_stock_take')::boolean, true),
       'can_view_staff_ledger', COALESCE((permissions::jsonb ->> 'can_view_staff_ledger')::boolean, true)
     )
)::text
WHERE role = 'owner';

UPDATE public.staff
SET permissions = (
  permissions::jsonb
  || jsonb_build_object(
       'can_manage_inventory',  COALESCE((permissions::jsonb ->> 'can_manage_inventory')::boolean, true),
       'can_manage_suppliers',  COALESCE((permissions::jsonb ->> 'can_manage_suppliers')::boolean, true),
       'can_manage_stock_take', COALESCE((permissions::jsonb ->> 'can_manage_stock_take')::boolean, true),
       'can_view_staff_ledger', COALESCE((permissions::jsonb ->> 'can_view_staff_ledger')::boolean, false)
     )
)::text
WHERE role = 'manager';

UPDATE public.staff
SET permissions = (
  permissions::jsonb
  || jsonb_build_object(
       'can_manage_inventory',  COALESCE((permissions::jsonb ->> 'can_manage_inventory')::boolean, false),
       'can_manage_suppliers',  COALESCE((permissions::jsonb ->> 'can_manage_suppliers')::boolean, false),
       'can_manage_stock_take', COALESCE((permissions::jsonb ->> 'can_manage_stock_take')::boolean, false),
       'can_view_staff_ledger', COALESCE((permissions::jsonb ->> 'can_view_staff_ledger')::boolean, false)
     )
)::text
WHERE role = 'cashier';
