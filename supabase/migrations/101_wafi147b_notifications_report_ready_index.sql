-- supabase/migrations/101_wafi147b_notifications_report_ready_index.sql
-- WAFI-147B. The existing notifications table's only unique index
-- (notifications_source_event_id_unique, 091) provides no duplicate
-- protection for source_event_id = NULL rows (every NULL is distinct under
-- a plain unique index) -- the correct value for our rows, since a
-- scheduled report snapshot has no originating events-bus event (same
-- established pattern as Low Stock notifications). This partial index,
-- scoped to type = 'report_ready' only, is what generate_report_snapshot()
-- (Task 4) conflicts against for its per-recipient no-op-on-conflict
-- insert -- mirrors this codebase's own existing partial-index precedent
-- (091's comment referencing the prior audit_log fix).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_report_ready_unique
  ON public.notifications (entity_id, recipient_staff_id)
  WHERE type = 'report_ready';
