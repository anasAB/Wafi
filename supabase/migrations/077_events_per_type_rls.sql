-- supabase/migrations/077_events_per_type_rls.sql
-- WAFI-140 Sprint 3 -- per-event-type RLS (design spec §3). Reuses the existing
-- permission framework (public.can(), migration 054) -- the identical pattern already
-- governing staff_ledger/staff_settlements (migration 060's
-- staff_ledger_select_permission). No new mechanism.
--
-- This CASE's WHEN branches must exactly match the non-'public' keys of
-- EVENT_SENSITIVITY in src/services/events/domainEvent.types.ts (Task 1) -- verified by
-- the pgTAP cross-check test in wafi140_events_rls.test.sql (Task 9), not by anything in
-- this file. If you add a WHEN branch here, add the matching TS registry entry too, and
-- vice versa.

DROP POLICY IF EXISTS events_select_all ON public.events;
DROP POLICY IF EXISTS events_select_scoped ON public.events;
CREATE POLICY events_select_scoped ON public.events
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND CASE type
      WHEN 'staff.ledger_entry_added' THEN public.can('can_view_staff_ledger')
      WHEN 'settlement.paid'          THEN public.can('can_view_staff_ledger')
      WHEN 'expense.recorded'         THEN public.can('can_view_expenses')
      WHEN 'product.cost_updated'     THEN public.can('can_view_reports')
      ELSE true
    END
  );

-- INSERT stays ungated by permission (unchanged from 074_events_bus_core.sql's
-- events_insert_all) -- a writer is already gated by the source table's own RLS (you
-- cannot produce a staff.ledger_entry_added event without first being able to write the
-- underlying staff_ledger row); double-gating the event insert would be redundant, not
-- a real additional boundary.
