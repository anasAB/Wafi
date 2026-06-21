-- Wafi POS — add the Manager role (WAFI-013).
-- Expand-only on the allowed values: drop and recreate the role CHECK to include
-- 'manager'. Idempotent — safe to re-run. No data is dropped or renamed.
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE public.staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('owner','cashier','manager'));
