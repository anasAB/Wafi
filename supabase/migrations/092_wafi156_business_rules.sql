-- supabase/migrations/092_wafi156_business_rules.sql
-- WAFI-156: data-driven business rule definitions. Policy data, not runtime
-- infrastructure -- see docs/superpowers/specs/2026-08-14-wafi-156-business-rules-engine-design.md §2.1.
-- Deliberately NOT merged into notification_settings (delivery/preference vs.
-- policy definition -- see spec §2.1).

CREATE TABLE IF NOT EXISTS public.business_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id),
  rule_key    text NOT NULL,
  name        text NOT NULL,
  event_type  text NOT NULL,
  field       text NOT NULL,
  transform   text NOT NULL CHECK (transform IN ('none', 'abs')),
  operator    text NOT NULL CHECK (operator IN ('gt', 'gte', 'lt', 'lte', 'eq')),
  threshold   numeric NOT NULL,
  action      text NOT NULL CHECK (action = 'notify_owner'),
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, rule_key)
);

CREATE INDEX IF NOT EXISTS business_rules_shop_event_type_idx
  ON public.business_rules (shop_id, event_type) WHERE enabled = true;

ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_rules_select_own_shop ON public.business_rules;
CREATE POLICY business_rules_select_own_shop ON public.business_rules
  FOR SELECT
  USING (shop_id = (SELECT public.auth_shop_id()));

-- Deliberately no INSERT/UPDATE/DELETE policy for authenticated -- per spec §2.1,
-- all writes go through update_business_rule() (Task 4) or this migration's own
-- seed statement below. No grant, no policy, means no path at all.
REVOKE ALL ON public.business_rules FROM authenticated, anon;
GRANT SELECT ON public.business_rules TO authenticated;

-- Idempotent seed shared by (a) this migration's one-time backfill for shops
-- that already exist, and (b) bootstrap_owner_identity()'s per-new-shop
-- provisioning (Task 5) -- both call the same INSERT shape so "what the
-- canonical rules are" has exactly one definition (spec §2.1).
CREATE OR REPLACE FUNCTION public.seed_business_rules_for_shop(p_shop_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.business_rules (shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled)
  VALUES
    (p_shop_id, 'large_return',    'إرجاع كبير',        'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', true),
    (p_shop_id, 'drawer_variance', 'فرق في الصندوق',    'shift.closed',  'variance',        'abs',  'gt', 15,  'notify_owner', true)
  ON CONFLICT (shop_id, rule_key) DO NOTHING;
$$;

-- Backfill: every shop that exists right now gets both proof rules.
DO $$
DECLARE v_shop record;
BEGIN
  FOR v_shop IN SELECT id FROM public.shops LOOP
    PERFORM public.seed_business_rules_for_shop(v_shop.id);
  END LOOP;
END;
$$;
