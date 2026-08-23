BEGIN;
-- Plan: 7 assertions (Task 1 schema validation) + 14 assertions (Task 2 schema validation)
SELECT plan(20);

-- Task 1: health_alert_state_a table and columns
SELECT has_table('public', 'health_alert_state_a', 'health_alert_state_a table exists');
SELECT col_not_null('public', 'health_alert_state_a', 'shop_id', 'health_alert_state_a.shop_id is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'metric_key', 'health_alert_state_a.metric_key is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'period_start', 'health_alert_state_a.period_start is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'threshold_used', 'health_alert_state_a.threshold_used is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'alerted_at', 'health_alert_state_a.alerted_at is NOT NULL');
-- WAFI-148A test fix: col_is_unique only checks for a plain UNIQUE
-- constraint (contype='u'); this table's uniqueness comes from its PRIMARY
-- KEY (contype='p'), so col_is_pk is the correct pgTAP assertion here.
SELECT col_is_pk(
  'public', 'health_alert_state_a',
  ARRAY['shop_id', 'metric_key', 'period_start'],
  'health_alert_state_a has a primary key on (shop_id, metric_key, period_start)'
);

-- Task 2: health_alert_state_b table and columns
SELECT has_table('public', 'health_alert_state_b', 'health_alert_state_b table exists');
SELECT col_not_null('public', 'health_alert_state_b', 'shop_id', 'health_alert_state_b.shop_id is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_b', 'alert_key', 'health_alert_state_b.alert_key is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_b', 'entity_id', 'health_alert_state_b.entity_id is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_b', 'state', 'health_alert_state_b.state is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_b', 'state_changed_at', 'health_alert_state_b.state_changed_at is NOT NULL');
-- last_notified_at should be nullable
SELECT col_is_null(
  'public', 'health_alert_state_b', 'last_notified_at',
  'health_alert_state_b.last_notified_at is nullable'
);

-- Create a test shop for constraint testing
INSERT INTO public.shops (id, name)
VALUES ('11111111-1111-1111-1111-111111111111'::uuid, 'test-shop')
ON CONFLICT DO NOTHING;

-- Test valid alert_key values can be inserted
SELECT lives_ok(
  'INSERT INTO public.health_alert_state_b (shop_id, alert_key, entity_id, state, state_changed_at)
   VALUES (''11111111-1111-1111-1111-111111111111''::uuid, ''dead_letter_count'', ''22222222-2222-2222-2222-222222222222''::uuid, ''HEALTHY'', now())',
  'valid alert_key value ''dead_letter_count'' can be inserted'
);

-- Test invalid alert_key value is rejected
SELECT throws_ok(
  'INSERT INTO public.health_alert_state_b (shop_id, alert_key, entity_id, state, state_changed_at)
   VALUES (''11111111-1111-1111-1111-111111111111''::uuid, ''invalid_key'', ''44444444-4444-4444-4444-444444444444''::uuid, ''HEALTHY'', now())',
  '23514',
  NULL,
  'invalid alert_key value is rejected with CHECK constraint violation'
);

-- Test valid state values can be inserted
SELECT lives_ok(
  'INSERT INTO public.health_alert_state_b (shop_id, alert_key, entity_id, state, state_changed_at)
   VALUES (''11111111-1111-1111-1111-111111111111''::uuid, ''stale_device'', ''66666666-6666-6666-6666-666666666666''::uuid, ''ALERTING'', now())',
  'valid state value ''ALERTING'' can be inserted'
);

-- Test invalid state value is rejected
SELECT throws_ok(
  'INSERT INTO public.health_alert_state_b (shop_id, alert_key, entity_id, state, state_changed_at)
   VALUES (''11111111-1111-1111-1111-111111111111''::uuid, ''overdue_shift'', ''88888888-8888-8888-8888-888888888888''::uuid, ''INVALID'', now())',
  '23514',
  NULL,
  'invalid state value is rejected with CHECK constraint violation'
);

-- Test primary key constraint. WAFI-148A test fix: col_is_unique only checks
-- for a plain UNIQUE constraint (contype='u'); this table's uniqueness comes
-- from its PRIMARY KEY (contype='p'), so col_is_pk is correct here.
SELECT col_is_pk(
  'public', 'health_alert_state_b',
  ARRAY['shop_id', 'alert_key', 'entity_id'],
  'health_alert_state_b has a primary key on (shop_id, alert_key, entity_id)'
);

-- Test entity_id has NO foreign key constraint (critical requirement)
-- Query information_schema to verify no FK exists on entity_id column
SELECT is(
  (SELECT COUNT(*)::int
     FROM information_schema.key_column_usage kcu
     JOIN information_schema.table_constraints tc
       ON tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
    WHERE kcu.table_schema = 'public'
      AND kcu.table_name = 'health_alert_state_b'
      AND kcu.column_name = 'entity_id'
      AND tc.constraint_type = 'FOREIGN KEY'),
  0,
  'entity_id column has NO foreign key constraint'
);

SELECT * FROM finish();
ROLLBACK;
