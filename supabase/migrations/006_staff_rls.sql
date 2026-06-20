-- Wafi POS — RLS policies for staff
-- Fixes: 42501 new row violates row-level security policy on public.staff

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- Read policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff'
      AND policyname = 'staff_select_all'
  ) THEN
    CREATE POLICY staff_select_all
      ON public.staff
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
      AND tablename = 'staff'
      AND policyname = 'staff_insert_all'
  ) THEN
    CREATE POLICY staff_insert_all
      ON public.staff
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- Update policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff'
      AND policyname = 'staff_update_all'
  ) THEN
    CREATE POLICY staff_update_all
      ON public.staff
      FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Delete policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff'
      AND policyname = 'staff_delete_all'
  ) THEN
    CREATE POLICY staff_delete_all
      ON public.staff
      FOR DELETE
      TO anon, authenticated
      USING (true);
  END IF;
END $$;
