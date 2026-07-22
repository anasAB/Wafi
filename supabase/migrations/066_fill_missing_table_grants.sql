-- Wafi POS — fills base table-privilege gaps discovered running the WAFI-122
-- and WAFI-202 pgTAP suites for real for the first time (previously blocked
-- by 037_devices.sql and a duplicate migration 038, both now fixed).
--
-- RLS policies on these tables were never backed by a base GRANT to
-- anon/authenticated in any migration -- every attempted read/write hit
-- "permission denied" before RLS even got a chance to evaluate. Production
-- has been masking this because a hosted Supabase project's dashboard
-- applies its own default-privilege grants at project-creation time, which
-- migration files never capture. A fresh local `supabase start` has no such
-- defaults, so the gap only surfaces there -- which is exactly why it went
-- unnoticed until these suites actually executed against a real Postgres.
--
-- audit_log is deliberately excluded: 018_audit_log_append_only.sql already
-- REVOKEs UPDATE/DELETE there on purpose (append-only ledger), and this
-- migration must not undo that.
GRANT ALL ON TABLE public.cash_movements          TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.categories              TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.device_sessions         TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.devices                 TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.exchange_rates          TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.installment_dues        TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.installment_plans       TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.products                TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.sale_line_items         TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.sales                   TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.shops                   TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.staff_ledger            TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.staff_settlements       TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.stock_take_lines        TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.stock_take_sessions     TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.subcategories           TO anon, authenticated, service_role;
