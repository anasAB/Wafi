-- WAFI-008: Data Source Tagging (schema preparation only — see
-- docs/superpowers/specs/2026-07-28-wafi-008-data-source-tagging-design.md).
--
-- No sales-import feature exists in this codebase today; every sale in
-- production was rung live through the POS. This column exists so a future
-- bulk-import (or demo-seed-sales) feature doesn't require a second
-- migration + backfill to add provenance tagging after the fact — the same
-- "costs nothing now, saves months of migration later" reasoning CLAUDE.md
-- already applies to wholesale-aware schema, applied here to sales
-- provenance instead.
--
-- 'pos'    — a sale rung live through the POS (the only value any code path
--            produces today; every existing row becomes this via the
--            column default, which is correct — no backfill needed beyond it).
-- 'import' — reserved for a future bulk sales-import feature. Unused today.
-- 'seed'   — reserved for a future demo/seed-sales feature. WAFI-004's demo
--            data does not write sales today, so this is unused too.

ALTER TABLE public.sales
  ADD COLUMN source TEXT NOT NULL DEFAULT 'pos'
    CHECK (source IN ('pos', 'import', 'seed'));
