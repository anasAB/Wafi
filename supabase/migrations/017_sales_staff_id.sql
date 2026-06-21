-- Wafi POS — Record which operator completed each sale, so one shift can be
-- broken down per operator (operator switching, no shift change). Nullable +
-- expand-only: existing rows stay valid; shift_id remains the cash-period link.
--
-- Attribution rule (see switch-operator design): staff_id is the operator who
-- was active at sale confirmation (the one who took payment), which may differ
-- from the staff who opened the shift. The Z-report groups a shift's sales by
-- staff_id for a per-operator breakdown; cash variance stays shift-level.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff(id);

COMMENT ON COLUMN public.sales.staff_id IS
  'Operator who completed (confirmed) the sale. Nullable for rows predating operator attribution; shift_id remains the cash-period link.';
