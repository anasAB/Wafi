BEGIN;
-- Plan: 7 assertions (Task 1 schema validation)
SELECT plan(7);

-- Task 1: health_alert_state_a table and columns
SELECT has_table('public', 'health_alert_state_a', 'health_alert_state_a table exists');
SELECT col_not_null('public', 'health_alert_state_a', 'shop_id', 'health_alert_state_a.shop_id is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'metric_key', 'health_alert_state_a.metric_key is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'period_start', 'health_alert_state_a.period_start is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'threshold_used', 'health_alert_state_a.threshold_used is NOT NULL');
SELECT col_not_null('public', 'health_alert_state_a', 'alerted_at', 'health_alert_state_a.alerted_at is NOT NULL');
SELECT col_is_unique(
  'public', 'health_alert_state_a',
  ARRAY['shop_id', 'metric_key', 'period_start'],
  'health_alert_state_a has a primary key on (shop_id, metric_key, period_start)'
);

SELECT * FROM finish();
ROLLBACK;
