# Product Categories & Subcategories (الفئات) — Design Spec

**Status:** Approved design, ready for planning
**Pack:** Core (management/sorting/filtering) + Reporting Pack (category breakdown in Profit Report)
**Depends on:** Epic 2 (Manage Products & Track Stock) — replaces the existing free-text `category` field on products; Profit Report screen (`specs/2026-06-23-profit-report-design.md`) for the reporting extension.

---

## Epic summary

**Goal:** Owner can create and manage a structured, two-level category list (category + optional subcategory), assign products to it, filter/sort/sell by category in the product list and POS, and see a category-level breakdown of the Profit Report.

**Value delivered:** Today `category` is a free-text field with no management, filtering-by-category is unreliable (typos/casing fragment the same category into multiple values), and reports have no category cut. This turns category into a real, ownable organizing structure — useful for sorting/finding products fast in a large catalog, selling faster in POS, and understanding which parts of the catalog actually drive profit.

**In scope:** Category and subcategory CRUD (lightweight inline management screen), quick-add from the product-add flow, product assignment (category required, subcategory optional), filter/sort by category+subcategory in the product list, category chip filter (with subcategory drill-down) in the POS product picker, automatic migration of existing free-text category values into structured records, "By category" breakdown view in the Profit Report with subcategory drill-down, "غير مصنف" (Uncategorized) as a real fallback category.

**Out of scope:** Automated category-merge tooling (manual reassign-then-delete instead), category breakdown on the home-screen dashboard headline (stays in the Reporting Pack's Profit Report screen only), more than two levels of nesting, per-category pricing rules or discounts.

---

## Data model

### `category`

| Field | Type | Required | Notes |
|---|---|---|---|
| category_id | UUID | yes | |
| name | string | yes | Unique, case-insensitive |
| created_at | timestamp | yes | |
| sync_status | enum | yes | |

### `subcategory`

| Field | Type | Required | Notes |
|---|---|---|---|
| subcategory_id | UUID | yes | |
| category_id | UUID | yes | FK |
| name | string | yes | Unique within its parent category |
| created_at | timestamp | yes | |
| sync_status | enum | yes | |

### Product changes

The existing free-text `category` field is replaced by:

| Field | Type | Required | Notes |
|---|---|---|---|
| category_id | UUID | yes | FK → `category` |
| subcategory_id | UUID | no | FK → `subcategory`; optional |

**Dependency rule:** `subcategory_id` may only be set when `category_id` is also set, and must belong to that same category. `useProducts().save()` rejects (or silently clears `subcategory_id`, per implementation task) any attempt to set a subcategory without its parent category. The product form UI enforces this earlier by keeping the subcategory dropdown disabled/empty until a category is selected.

---

## Category management

**Screen:** Back Office → Inventory → Categories. A flat list of categories, each expandable inline to show its subcategories; add/rename/delete at both levels directly in the list — no separate full-page form.

**Quick-add:** reachable inline from the product-add/edit flow (same pattern as Epic 4's "+ زبون جديد" quick-add from the payment screen) so creating a missing category doesn't interrupt adding a product.

**Deletion rule:** deleting a category or subcategory that still has products assigned is blocked, with a message showing how many products are affected. **Bulk reassignment is out of scope for v1** — no in-modal "move products to..." UI is built. The blocked-deletion message directs the owner to the Product List's category filter to find and manually reassign the affected products before deleting the category. (Candidate for a future "move N products" bulk action if this creates real support friction.)

**Duplicate name handling:** `categories.name` and `subcategories.name` (scoped to their parent category) are unique case-insensitively at the database level. Before inserting, `createCategory`/`createSubcategory` first check for an existing case-insensitive match and return a friendly, localized conflict result (e.g. "هذه الفئة موجودة بالفعل" / "This category already exists") instead of attempting the insert — so a raw database unique-violation error never reaches the UI.

**"غير مصنف" (Uncategorized) is a protected fallback**, not an ordinary category: it can be renamed, but `deleteCategory` refuses to delete the row currently serving as the shop's uncategorized fallback (looked up dynamically by its role, not hardcoded to a fixed UUID) as long as it is the active fallback for uncategorized products. This prevents a shop from losing its fallback destination and later ending up with duplicate/fragmented "uncategorized" rows when a new blank-category product is created.

---

## Migration of existing free-text categories

On rollout: every distinct non-empty existing `category` string value (trimmed, case-insensitive) becomes a real `category` record, and every product referencing that value is re-pointed to the new `category_id`. No subcategories are inferred from free text (no signal to split on) — the owner adds subcategories manually afterward if useful. Products with a blank/empty category are assigned to **"غير مصنف" (Uncategorized)**, itself a real category record — not a null state — so every filter, sort, and report always has a home for uncategorized products.

---

## Sorting, filtering & selling by category

- **Product list / Back Office:** the existing "filter by category" dropdown becomes a real two-level filter (category, optionally narrowed to subcategory); the table/cards can be sorted or grouped by category. Existing name/barcode search remains combinable with the category filter.
- **POS product picker:** a category chip strip (horizontally scrollable, starting with "الكل" / All) narrows the visible products before/alongside search or barcode scan; tapping a category chip can reveal its subcategory chips beneath it. Additive to existing search/scan — doesn't replace either.

---

## Profit Report integration (Reporting Pack)

Extends the existing Profit Report screen:

- New **"By category" view** alongside the existing period selector (Week/Month/Quarter/custom range): shows revenue, COGS, and profit per top-level category for the selected period, sorted by profit contribution descending.
- Each category row drills into its subcategories for the same period on tap — subcategory detail stays a drill-down, not a first-class row in the main view.
- **"غير مصنف"** appears as its own row like any other category — nothing silently excluded from totals.
- Reuses the same underlying `useDashboardMetrics`/`useProfitTrend` calculations already powering the existing Profit Report — a regrouping of existing numbers, not a new calculation engine — and inherits the same "estimated" cost-price caveat (WAFI-054) for products missing a cost price.
- Category breakdown does **not** appear on the home-screen dashboard headline; it lives specifically in the Reporting Pack's Profit Report screen.

---

## Edge cases

1. **Deleting a category/subcategory with products assigned** — blocked, with a count shown; no in-app reassignment UI (out of scope for v1 — see Category management above). Owner reassigns manually via the Product List filter, then deletes.
2. **Renaming a category** — free; historical reports aggregate by `category_id`, not by name string, so past periods are unaffected.
3. **Duplicate categories created separately** (e.g. "Phones" and "الهواتف") — no automated merge tool; owner manually reassigns products from one to the other, then deletes the now-empty one. Candidate for a future "merge categories" action if this comes up often.
4. **Subcategory deleted while its parent category remains** — affected products fall back to category-only (`subcategory_id` cleared), not blocked, since subcategory was always optional.
5. **Very small catalogs** — categories are entirely optional to use meaningfully; "غير مصنف" holds everything until the owner organizes, with no forced setup step.
6. **Offline** — category/subcategory CRUD and product reassignment follow the standard offline/sync model (additive updates, standard soft-delete pattern for conflicts).
7. **Creating a category/subcategory with a name that already exists (case-insensitive)** — rejected before the insert is attempted, with a friendly Arabic message ("هذه الفئة موجودة بالفعل") rather than a raw database unique-violation error surfacing in the UI.
8. **Deleting the shop's "غير مصنف" fallback category** — blocked unconditionally while it is the active fallback (regardless of whether it currently has 0 products assigned), since new blank-category products must always have a home. It may still be renamed.
9. **Assigning a subcategory without a parent category** — rejected at both the UI layer (subcategory dropdown disabled until a category is chosen) and the `useProducts().save()` layer (defensive check in case a caller bypasses the form).

---

## Definition of Done

- [ ] Owner can create, rename, and delete categories and subcategories from the management screen
- [ ] Migration correctly converts all existing distinct free-text category values into real category records with products correctly re-pointed; blank values land in "غير مصنف"
- [ ] Deleting a category/subcategory in use is blocked with a clear count; the message directs the owner to the Product List filter to reassign manually (no bulk-reassignment UI in v1)
- [ ] Product list/Back Office filter and sort correctly by category and subcategory
- [ ] POS product picker's category chips correctly narrow visible products, including subcategory drill-down
- [ ] Quick-add category from the product-add flow works without losing in-progress form data
- [ ] Profit Report's "By category" view (Reporting Pack) correctly sums revenue/COGS/profit per category for the selected period, drills into subcategories, and includes "غير مصنف" as its own row, using the same visual "estimated — missing cost" caveat styling as the main Profit Report tab
- [ ] Category renames do not affect historical report aggregation
- [ ] Attempting to create a category/subcategory with a name that already exists (case-insensitive) shows a friendly Arabic error message, not a raw database error
- [ ] The "غير مصنف" (Uncategorized) category cannot be deleted while it is the shop's active fallback for uncategorized products
- [ ] The product form prevents selecting a subcategory unless its parent category is already selected; `useProducts().save()` defensively enforces the same rule
- [ ] Tested on phone, tablet, desktop, online and offline
