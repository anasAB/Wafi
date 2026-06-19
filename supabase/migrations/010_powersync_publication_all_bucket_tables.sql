-- Wafi POS — Ensure all PowerSync bucket tables are in replication publication.
-- Safe migration: only adds missing table entries when publication exists.

DO $$
DECLARE
  pub_name text;
  table_name text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH table_name IN ARRAY ARRAY[
        'products',
        'stock_adjustments',
        'sales',
        'sale_line_items',
        'exchange_rates',
        'expenses',
        'customers',
        'customer_payments',
        'receipt_settings',
        'sale_payments',
        'staff',
        'cashier_shifts',
        'returns',
        'return_line_items',
        'return_reasons',
        'audit_log',
        'suppliers',
        'stock_receivings',
        'stock_receiving_line_items'
      ]
      LOOP
        IF EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = table_name
            AND c.relkind = 'r'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = pub_name
            AND schemaname = 'public'
            AND tablename = table_name
        ) THEN
          EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', pub_name, table_name);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
