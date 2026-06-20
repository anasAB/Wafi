-- Wafi POS — RLS policies for products
-- Prevents 42501 insert/update failures when syncing products via anon/authenticated tokens.

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'products_select_all'
  ) THEN
    CREATE POLICY products_select_all
      ON public.products
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'products_insert_all'
  ) THEN
    CREATE POLICY products_insert_all
      ON public.products
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'products_update_all'
  ) THEN
    CREATE POLICY products_update_all
      ON public.products
      FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'products_delete_all'
  ) THEN
    CREATE POLICY products_delete_all
      ON public.products
      FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;
