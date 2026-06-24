-- Wafi POS — Manager financials default OFF (WAFI-058).
--
-- Under WAFI-013 the manager role carried a FIXED permission set that included
-- can_view_reports = true and can_view_expenses = true, and createStaff/
-- updateStaff persisted that whole set into staff.permissions. WAFI-058 makes
-- those two financial flags OWNER-GRANTED per staff member, defaulting OFF — so
-- any legacy manager row still carries a stale `true` that would silently grant
-- financial visibility after the upgrade.
--
-- Reset both financial flags to false on every manager row to establish the
-- explicit default-off baseline. The owner then re-grants intentionally per
-- manager from staff management. Structural manager flags (products/customers/
-- settings) are derived from the role at read time and are untouched here.
--
-- Idempotent: re-running re-applies the same false values. Cashiers and owners
-- are not matched, so their permissions are unaffected.
UPDATE public.staff
SET permissions = permissions
      || jsonb_build_object('can_view_reports', false, 'can_view_expenses', false)
WHERE role = 'manager';
