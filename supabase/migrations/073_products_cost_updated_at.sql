ALTER TABLE products ADD COLUMN cost_updated_at TIMESTAMPTZ;

-- One-time backfill, run only as part of this migration — not a runtime job,
-- not something any application code re-runs later. Existing products with a
-- real cost are "as fresh as their last edit" rather than flagged stale on
-- day one. Products with no cost stay NULL — already caught by the
-- missing-cost half of the filter. Once this migration has run, every future
-- cost_updated_at value comes exclusively from the application write paths
-- (Tasks 2-4 below), never from this UPDATE again.
UPDATE products SET cost_updated_at = updated_at
WHERE cost_price_usd > 0 AND cost_updated_at IS NULL;
