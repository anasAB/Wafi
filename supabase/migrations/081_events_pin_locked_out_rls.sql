-- supabase/migrations/081_events_pin_locked_out_rls.sql
-- WAFI-145 -- adds the staff.pin_locked_out branch to events_select_scoped
-- (077_events_per_type_rls.sql), matching the new 'can_view_staff_ledger' row added for
-- this event type in EVENT_SENSITIVITY (src/services/events/domainEvent.types.ts, Task 3).
-- 077 is already applied, so its DROP/CREATE POLICY statements are replayed here with the
-- one new WHEN branch added, rather than editing the already-shipped 077 file in place.
--
-- This CASE's WHEN branches must exactly match the non-'public' keys of
-- EVENT_SENSITIVITY in src/services/events/domainEvent.types.ts -- verified by the pgTAP
-- cross-check test in wafi140_events_rls.test.sql. If you add a WHEN branch here, add the
-- matching TS registry entry too, and vice versa.

DROP POLICY IF EXISTS events_select_all ON public.events;
DROP POLICY IF EXISTS events_select_scoped ON public.events;
CREATE POLICY events_select_scoped ON public.events
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND CASE type
      WHEN 'staff.ledger_entry_added' THEN public.can('can_view_staff_ledger')
      WHEN 'settlement.paid'          THEN public.can('can_view_staff_ledger')
      WHEN 'staff.pin_locked_out'     THEN public.can('can_view_staff_ledger')
      WHEN 'expense.recorded'         THEN public.can('can_view_expenses')
      WHEN 'product.cost_updated'     THEN public.can('can_view_reports')
      ELSE true
    END
  );
