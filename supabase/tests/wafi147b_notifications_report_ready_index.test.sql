-- supabase/tests/wafi147b_notifications_report_ready_index.test.sql
BEGIN;
SELECT plan(2);

SELECT has_index('public', 'notifications', 'notifications_report_ready_unique',
  'partial unique index for report_ready notifications exists');

INSERT INTO public.notifications (shop_id, recipient_staff_id, type, title, message, entity_type, entity_id, source_event_id)
VALUES ('shop-1', 'staff-1', 'report_ready', 'x', 'x', 'generated_report', 'report-1', NULL);

SELECT throws_ok(
  $$ INSERT INTO public.notifications (shop_id, recipient_staff_id, type, title, message, entity_type, entity_id, source_event_id)
     VALUES ('shop-1', 'staff-1', 'report_ready', 'x', 'x', 'generated_report', 'report-1', NULL) $$,
  '23505',
  NULL,
  'duplicate (entity_id, recipient_staff_id) for type=report_ready is rejected'
);

SELECT * FROM finish();
ROLLBACK;
