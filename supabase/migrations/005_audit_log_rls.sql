-- Wafi POS — RLS policies for audit_log
-- Fixes: 42501 new row violates row-level security policy

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Read policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_select_all'
  ) THEN
    CREATE POLICY audit_log_select_all
      ON public.audit_log
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- Insert policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_insert_all'
  ) THEN
    CREATE POLICY audit_log_insert_all
      ON public.audit_log
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- Update policy (for compatibility with upsert-based sync)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_update_all'
  ) THEN
    CREATE POLICY audit_log_update_all
      ON public.audit_log
      FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Delete policy (optional, keeps sync tooling from failing on deletes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_delete_all'
  ) THEN
    CREATE POLICY audit_log_delete_all
      ON public.audit_log
      FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;
