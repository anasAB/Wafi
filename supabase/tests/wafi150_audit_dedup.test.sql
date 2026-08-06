-- supabase/tests/wafi150_audit_dedup.test.sql
-- WAFI-150: audit_log.source_event_id partial unique index + dedup-on-conflict.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(2);

-- The partial unique index exists (Task 6's migration).
SELECT has_index('public', 'audit_log', 'audit_log_source_event_id_unique',
  'audit_log_source_event_id_unique index exists');

-- Two rows sharing a source_event_id: the second insert's upsert-with-ignoreDuplicates
-- shape (mirrored here as a raw INSERT ... ON CONFLICT DO NOTHING, the SQL-level
-- equivalent of what supabase-js's ignoreDuplicates:true generates) is silently
-- absorbed rather than raising a unique-violation.
INSERT INTO public.audit_log (shop_id, staff_id, staff_name, event, entity_type, entity_id, source_event_id)
VALUES ('e0000000-0000-0000-0000-000000000001', NULL, 'system', 'expense.created', 'expense', 'e1', 'ee000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $$INSERT INTO public.audit_log (shop_id, staff_id, staff_name, event, entity_type, entity_id, source_event_id)
    VALUES ('e0000000-0000-0000-0000-000000000001', NULL, 'system', 'expense.created', 'expense', 'e1', 'ee000000-0000-0000-0000-000000000001')
    ON CONFLICT (source_event_id) DO NOTHING$$,
  'a second insert sharing source_event_id is silently absorbed, not a unique-violation error'
);

SELECT * FROM finish();
ROLLBACK;
