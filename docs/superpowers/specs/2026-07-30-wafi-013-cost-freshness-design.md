# WAFI-013: Cost Freshness Indicator — Design

**Date:** 2026-07-30
**Status:** Approved direction, ready for spec self-review

## Problem

`products.cost_price_usd` drives every profit/margin number in the app (profit reports,
staff performance), but the catalog has no way to tell "this cost is accurate" from
"this cost is missing or has been wrong for months." Confirmed via code audit
2026-07-30 — no `cost_updated_at` or equivalent freshness metadata exists anywhere.

## What already exists — verified, not assumed

**"Missing cost" filtering is already fully built, just not visibly reachable.**
`ProductList.vue:76-77` already filters `!p.costPriceUsd || p.costPriceUsd <= 0`, wired
end-to-end from `HomePage.vue:187-190` (WAFI-054, "tap-through from the profit caveat")
via `router.push('/products?filter=missing-cost')`. There is **no visible chip/button on
`ProductsPage.vue` itself** to trigger this filter — it's a deep-link-only query param
today (`filterLowStock`/`filterMissingCost` follow the same pattern, both only settable
via `route.query.filter`, confirmed at `ProductsPage.vue:20-21`).

**"Stale cost" has no foundation at all.** `cost_price_usd` is a plain
`column.real` with no freshness timestamp (`schema.ts`). `products.updated_at` is
rewritten on *every* edit (name, stock, photo — anything, confirmed in
`useProducts.ts::save()`'s single `UPDATE` statement), so it cannot distinguish "the
cost was just corrected" from "someone renamed the product." A genuine staleness signal
needs its own column.

**So the real scope of this ticket is narrower than the roadmap line first suggests:**
expose the existing missing-cost filter as a visible chip, and build staleness from
scratch alongside it — not "build a cost-freshness feature from nothing."

## Decisions

**Combined chip, not two.** One chip — "بدون سعر دقيق" (imprecise cost) — covers both
missing and stale. From an owner's point of view both mean the same thing: "don't fully
trust this product's margin number." Each row's own label still distinguishes which
case it is.

**Staleness threshold: 90 days**, simple and time-based (not tied to sale count/
frequency, which would be more precise but harder to explain and compute). A product
whose cost hasn't been updated in over 90 days is "قديم" (old).

**Backfill decision — the load-bearing choice in this design.** `cost_updated_at` is a
brand-new column; on ship day every existing product has it `NULL`. If `NULL` counted as
"stale," the entire existing catalog would flood the new chip on day one — a
false-positive avalanche that would make the feature useless from the moment it ships.
**Migration 073 backfills `cost_updated_at = updated_at` for every product with a real
cost (`cost_price_usd > 0`) at migration time.** This is an approximation — `updated_at`
may reflect a name or stock edit rather than the cost itself — but it's a fair one-time
starting signal: "as fresh as the last time anyone touched this record," rather than
declaring every pre-existing product stale on day one. Products with no cost at all
(`cost_price_usd <= 0`) are left `NULL` — they're already caught by the "missing" half of
the filter, so their `cost_updated_at` value is moot until they get a real cost.

## Schema change

New migration `supabase/migrations/073_products_cost_updated_at.sql`:

```sql
ALTER TABLE products ADD COLUMN cost_updated_at TIMESTAMPTZ;

-- One-time backfill, run only as part of this migration — not a runtime job,
-- not something any application code re-runs later. Existing products with a
-- real cost are "as fresh as their last edit" rather than flagged stale on
-- day one (see design doc's "Backfill decision"). Products with no cost stay
-- NULL — already caught by the missing-cost half of the filter. Once this
-- migration has run, every future cost_updated_at value comes exclusively
-- from the application write paths below (manual edit, receiving, creation),
-- never from this UPDATE again.
UPDATE products SET cost_updated_at = updated_at
WHERE cost_price_usd > 0 AND cost_updated_at IS NULL;
```

Also add `cost_updated_at: column.text` to the `products` table definition in
`src/data/powersync/schema.ts` (PowerSync's local schema mirrors the server's column set;
confirmed the existing convention there is `column.text` for every other timestamp
column on this table, e.g. `created_at`/`updated_at`, not a dedicated date type).

## Stamping `cost_updated_at` — two write paths, two different rules

**`useProducts.ts::save()` (manual product edit)** — must stamp `cost_updated_at` **only
when the cost value itself actually changes**, not on every save (the existing `UPDATE`
touches `cost_price_usd` unconditionally on every edit, including ones that don't touch
cost at all — e.g. renaming a product). Follow the exact pattern already used for price-
change detection in the same function (`old.price_usd !== data.salePriceUsd` at line 81):
fetch `old.cost_price_usd` alongside `old.price_usd` in the existing `SELECT`, and only
include `cost_updated_at` in the `SET` clause (or conditionally bind `now` vs. the
existing stored value) when `old.cost_price_usd !== data.costPriceUsd`.

**`useReceivingSheet.ts` (receiving flow)** — stamp `cost_updated_at = now`
**unconditionally** inside the existing cost-update branch (`useReceivingSheet.ts:107-
119`, gated on `line.updateCost && line.unitCostUsd > 0`). No before/after comparison
needed here — reaching this branch at all already means the owner explicitly confirmed
this cost during a receiving, which is itself the freshness signal, regardless of
whether the confirmed number happens to numerically match the old one.

**`useProducts.ts::save()`'s creation branch (new product)** — stamp `cost_updated_at =
now` whenever `data.costPriceUsd > 0` at creation time. Entering a cost for a brand-new
product is itself an act of confirming it — there is no earlier value to compare
against, so this is unconditional, the same way the receiving-flow stamp is. Without
this, every newly-created product would start with `cost_updated_at = NULL`, silently
depending on a future edit to ever become "fresh" even though its cost was accurate the
moment it was entered. A product created with no cost (`costPriceUsd <= 0`, e.g. a
quick-add from an unknown barcode scan) stays `NULL` — nothing to confirm yet, caught by
the missing-cost half of the filter until someone sets a real cost.

**The missing → fresh transition (the most important one to get right):** a product
created with cost `0`, later edited to set cost `5.00`, must end up with `cost_updated_at
= now` — the "manual edit" rule above already covers this correctly (`old.cost_price_usd
!== data.costPriceUsd` is true for `0 → 5`), but it's called out explicitly here because
this exact transition is the primary real-world workflow this whole feature exists to
support: an owner sees "no cost" in the list, taps through, fixes it, and it should
immediately stop showing up as a problem.

## Filter logic

`ProductList.vue`'s `displayed` computed gains a staleness check alongside the existing
missing-cost one:

```ts
const COST_STALE_AFTER_DAYS = 90

function isCostStale(p: Product): boolean {
  if (!p.costPriceUsd || p.costPriceUsd <= 0) return false  // "missing", not "stale" — don't double-flag
  if (!p.costUpdatedAt) return false  // no signal yet (pre-migration product never touched since) — not flagged either way
  const ageDays = (Date.now() - new Date(p.costUpdatedAt).getTime()) / (1000 * 60 * 60 * 24)
  return ageDays > COST_STALE_AFTER_DAYS
}
```

The combined filter (replacing the current single `filterMissingCost` predicate) becomes:

```ts
if (props.filterImpreciseCost) {
  list = list.filter(p => (!p.costPriceUsd || p.costPriceUsd <= 0) || isCostStale(p))
}
```

**Naming migration:** `filterMissingCost` (prop, query param `missing-cost`) is renamed
to `filterImpreciseCost` (query param `imprecise-cost`) throughout — `ProductsPage.vue`,
`ProductList.vue`, and `HomePage.vue`'s existing deep link — since the filter now covers
both missing and stale, and keeping the old narrower name would be misleading about what
the chip actually does. This is a rename of an existing prop/query-param, not a new
parallel one — there is exactly one "imprecise cost" concept end to end, not two filters
layered on each other.

**Every navigation entry point that constructs this query param must be updated in the
same change, not just `ProductsPage.vue`'s own reading of it.** Today that's exactly one
call site (`HomePage.vue:189`'s `router.push('/products?filter=missing-cost')`) — but the
implementer must grep for `filter=missing-cost` and `filterMissingCost` across the whole
codebase before considering this rename done, not just edit the three files named above
by assumption. A future feature adding a second entry point (e.g. a future report page
linking here) would otherwise silently break if it copied the old string before the
rename shipped, or continue pointing at a filter that no longer exists if added after.

**Backward compatibility for the old query-param value:** `ProductsPage.vue`'s read of
`route.query.filter` accepts EITHER `'missing-cost'` (old) OR `'imprecise-cost'` (new) as
truthy for `filterImpreciseCost`:

```ts
const filterImpreciseCost = computed(() =>
  route.query.filter === 'imprecise-cost' || route.query.filter === 'missing-cost'
)
```

This protects anyone who bookmarked or shared the old URL — a real possibility since
this exact link is generated from the dashboard's profit-caveat sheet, something an
owner might screenshot or a support conversation might reference. The internal prop/
variable names are still renamed fully (per the naming migration above) — only the old
*query-param string value* is kept as a permanently-accepted alias, not a temporary
deprecation with an expiry date, since there's no mechanism in this app to notify a
bookmark-holder that a URL changed.

## `Product` type / row mapping

Add `costUpdatedAt?: string` to the `Product` interface (`src/features/pos/pos.types.ts`)
and to `rowToProduct()`'s mapping in `product.utils.ts`:

```ts
costUpdatedAt: r.cost_updated_at ?? undefined,
```

`ProductRow` (`product.utils.ts`) gains `cost_updated_at: string | null`.

## UI

**Chip** (new, on `ProductsPage.vue`, alongside wherever the existing low-stock
affordance lives — confirmed there is currently no visible chip/button for either
existing filter, so this establishes the pattern for both, not just this one):

```
[الكل] [مخزون منخفض] [بدون سعر دقيق ●12]
```

The count badge (`●12`) is a Vue `computed()` over the already-loaded product list
(`products.filter(p => (!p.costPriceUsd || p.costPriceUsd <= 0) || isCostStale(p)).length`)
— computed once and cached by Vue's reactivity, not recomputed on every render or
keystroke; no new query. Worth stating explicitly since the underlying filter predicate
iterates the full product array — on a catalog in the thousands, an accidental non-
memoized recompute on every re-render (e.g. inlined directly in the template instead of
a `computed`) would be a real, avoidable cost.

**Per-row label: always visible, not conditional on the chip being active.** A row with
an imprecise cost shows its label ("لا يوجد سعر" / "قديم (…)") regardless of whether the
imprecise-cost chip is currently selected. Chosen over "only show when filtered" because
the alternative is worse discoverability: an owner opens Products, sees the chip's count
badge say "12" with no visible explanation anywhere in the unfiltered list, and has to
already understand and tap the chip before any row tells them what's wrong. An
always-visible badge means the *unfiltered* list is itself the first signal — the chip
is then a tool for narrowing down to just those rows, not the only way to discover them
at all.

- Missing: "لا يوجد سعر"
- Stale: "قديم ({{ageDays}} يوماً)" — e.g. "قديم (120 يوماً)"

## Testing

1. `useProducts.save()`: editing a product's name only (cost unchanged) does NOT update
   `cost_updated_at`.
2. `useProducts.save()`: editing a product's **sale price** only (cost unchanged) does
   NOT update `cost_updated_at` — arguably the most common real-world edit (a price
   change with no corresponding cost change), and the case most likely to accidentally
   slip through if the comparison is ever implemented against the wrong field.
3. `useProducts.save()`: editing a product's cost value DOES update `cost_updated_at` to
   now.
4. `useProducts.save()`'s creation branch: creating a new product with `costPriceUsd >
   0` stamps `cost_updated_at = now` immediately, with no prior edit needed. Creating one
   with `costPriceUsd <= 0` (e.g. a quick-add from an unknown barcode) leaves it `NULL`.
5. The missing → fresh transition: a product created with cost `0`, later edited to a
   real cost, ends up with `cost_updated_at = now` and no longer matches the
   imprecise-cost filter — this is the primary real-world workflow the feature exists to
   support, worth its own explicit test rather than only being incidentally covered by
   test 3's general "cost changed" case.
6. `useReceivingSheet.ts`: confirming a cost during receiving stamps `cost_updated_at`
   even when the confirmed value equals the product's existing cost.
7. `isCostStale()`: a product with `cost_price_usd <= 0` returns `false` regardless of
   `cost_updated_at` (missing takes priority, never double-counted as stale).
8. `isCostStale()` boundary: with the predicate as written (`ageDays > COST_STALE_AFTER_DAYS`),
   exactly 90.0 days old returns `false` (not yet stale), 91 days old returns `true`, 89
   days old returns `false`. Assert all three explicitly — the exact-90 case is the one
   most likely to silently flip if the comparison operator is ever changed from `>` to
   `>=` without anyone noticing.
9. `isCostStale()`: a product with a real cost and `cost_updated_at` NULL returns
   `false` (not flagged — no signal yet, per the "unknown, not stale" rule for
   never-backfilled/never-touched rows).
10. Combined filter: a list with one missing-cost product, one stale product, one fresh
    product, and one low-stock-but-fine-cost product — the imprecise-cost filter returns
    exactly the first two.
11. Migration 073's backfill: a product with `cost_price_usd > 0` and pre-existing
    `updated_at` gets `cost_updated_at` set to that same value; a product with
    `cost_price_usd <= 0` stays `NULL`.
12. Count badge reflects the combined filter's count, not just the missing-cost count.
13. `route.query.filter === 'missing-cost'` (the old value) still activates
    `filterImpreciseCost`, exactly the same as `'imprecise-cost'` — proves the backward-
    compatibility alias actually works, not just that the new value does.

## Explicitly out of scope

- Any change to how cost is used in profit calculations — this ticket only surfaces
  *which* products have bad cost data, it doesn't change how existing reports compute
  with whatever cost value is present today.
- A "batch fix" flow (e.g. bulk-editing multiple flagged products at once) — tapping
  through to each product's existing edit form individually is Phase 1's interaction
  model.
- Any change to the 90-day threshold being configurable per-shop — a single hard-coded
  constant for now; revisit only if real usage shows it's wrong for this market.
