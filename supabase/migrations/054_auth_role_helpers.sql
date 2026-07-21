-- WAFI-122: SQL helpers every domain RLS policy uses. auth.jwt() is
-- Supabase's built-in function returning the current request's JWT claims
-- as jsonb (reads the request.jwt.claims GUC PostgREST sets per request).

CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() ->> 'active_role', 'cashier')
$$;

CREATE OR REPLACE FUNCTION public.auth_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'staff_id', '')::uuid
$$;

-- Returns '{}'::jsonb (deny-by-default) when staff_id is null, the staff
-- row is missing, or the staff has been deactivated -- so a stale claim for
-- a deactivated staff member never inherits their last-known permissions.
-- SECURITY DEFINER: policies calling this must not require the caller to
-- have direct SELECT on staff (that would be circular with staff's own
-- RLS); search_path is pinned to keep it injection-safe.
CREATE OR REPLACE FUNCTION public.auth_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT permissions::jsonb FROM public.staff
     WHERE id = public.auth_staff_id() AND is_active = true),
    '{}'::jsonb
  )
$$;

-- Single call site for every permission-flag check in RLS policies. Owner
-- always passes (INV-005). The cast is wrapped in an exception handler --
-- not just COALESCE -- because a malformed non-boolean JSON value at the
-- flag's key (e.g. a stray string) would raise a cast error that COALESCE
-- alone does not catch; this must fail closed (deny), never error (INV-004).
CREATE OR REPLACE FUNCTION public.can(flag text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_raw text;
BEGIN
  IF public.auth_role() = 'owner' THEN
    RETURN true;
  END IF;

  BEGIN
    v_raw := public.auth_permissions() ->> flag;
    RETURN COALESCE(v_raw::boolean, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
END;
$$;
