-- WAFI-134: stock-take sessions scoped by the REAL categories system.
--
-- The original scoping filtered products on the deprecated free-text
-- products.category column (no longer written to), so category-scoped counting
-- silently matched zero products for anything categorized through the new
-- categories tables. Sessions now store the scope as ids plus a human-readable
-- name snapshot in the existing `scope` column (history display survives later
-- category renames).
--
-- Expand-only: nullable columns, historical rows stay null (their free-text
-- scope value in `scope` continues to display as-is).

ALTER TABLE public.stock_take_sessions
  ADD COLUMN IF NOT EXISTS scope_category_id    uuid,
  ADD COLUMN IF NOT EXISTS scope_subcategory_id uuid;

-- No FK on purpose: sessions are historical records — a merged/deleted category
-- (WAFI-133) must never invalidate a past session. Overlap checks and history
-- display read the snapshot, not the live category row.

-- Existing RLS policies on stock_take_sessions already scope by shop_id and
-- cover the new columns (row-level, not column-level) — no policy changes.
