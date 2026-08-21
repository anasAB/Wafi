BEGIN;
SELECT plan(3);

SELECT has_column('public', 'shops', 'timezone', 'shops.timezone exists');
SELECT col_type_is('public', 'shops', 'timezone', 'text', 'shops.timezone is text');
SELECT col_is_null('public', 'shops', 'timezone', 'shops.timezone has no default (nullable)');

SELECT * FROM finish();
ROLLBACK;
