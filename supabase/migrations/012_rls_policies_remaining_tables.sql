-- Wafi POS — RLS policies for every remaining PowerSync table.
--
-- products (008), staff (006) and audit_log (005) already have policies, but the
-- other synced tables had RLS enabled with NO policy, so PowerSync uploads were
-- rejected with 42501 ("new row violates row-level security policy"). A single
-- sale writes sales + sale_payments + sale_line_items + stock_adjustments, so it
-- failed on all four at once.
--
-- This grants the same permissive policy set as products_rls (008) to the rest.
-- Safe + re-runnable: enabling RLS is idempotent and each policy is created only
-- if missing.
--
-- SECURITY NOTE: these policies are intentionally wide (anon + authenticated, no
-- row filter) to match the current products pattern. They do NOT provide
-- per-shop tenant isolation. Real isolation (USING shop_id = <jwt claim>) is a
-- separate, deliberate change once shop_id is carried in the auth token.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'stock_adjustments',
    'sales',
    'sale_line_items',
    'exchange_rates',
    'expenses',
    'customers',
    'customer_payments',
    'receipt_settings',
    'sale_payments',
    'cashier_shifts',
    'returns',
    'return_line_items',
    'return_reasons',
    'suppliers',
    'stock_receivings',
    'stock_receiving_line_items'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    -- Only touch tables that actually exist in this database.
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_select_all'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
          t || '_select_all', t);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_insert_all'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)',
          t || '_insert_all', t);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_update_all'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)',
          t || '_update_all', t);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_delete_all'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR DELETE TO anon, authenticated USING (true)',
          t || '_delete_all', t);
      END IF;
    END IF;
  END LOOP;
END $$;
