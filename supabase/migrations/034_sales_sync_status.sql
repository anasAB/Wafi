-- sales never got the sync_status column that customers/customer_payments/etc.
-- all received in 009_expand_domain_tables_for_sync.sql. useCustomerBalance and
-- useCustomers both query sales.sync_status for the pending-sync-count feature.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sync_status TEXT;
