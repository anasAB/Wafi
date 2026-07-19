# Integration: `suggested-features` + WAFI-100 discounts → `main`

Branch: `integration/wafi-100-and-suggested-features` (based on local `main` @ `afd9bca`, not yet pushed).
Not merged into `main` yet — this branch is ready for review first.

## What's in it

**From `suggested-features` (merged whole):**
- WAFI-103 — denomination-based cash counting at shift open/close
- WAFI-108 — dead-stock report
- WAFI-101 — unknown-barcode quick-add + open-item sale line
- fix: nullable `CashierShift` per-currency breakdown fields
- chore: migration renumber (WAFI-101's own collision, pre-existing)

**From `worktree-wafi-100-discounts` (cherry-picked, WAFI-100 only):**
- Discount math helpers, PIN-authorization rule, shop discount-cap composable, discount columns migration, cart-store discount/markup mutations
- **Left out on purpose:** that branch's WAFI-138 commits (staff_ledger migration, domain types, audit events, `executeFinancialWrite`) — those were an earlier, superseded slice of the same WAFI-138 work you've since built out much further on `wafi-138-staff-ledger-settlement` (43 commits, already in `main`). Pulling them in would have reintroduced stale code.
- 2 doc commits (WAFI-100 design spec, implementation plan) were skipped as empty cherry-picks — `main` already carries identical content for both files from earlier work.

## Conflicts resolved during merge

1. **`powersync.yaml`** — both `main` (WAFI-138 ledger sync) and `suggested-features` (WAFI-103's `denomination_configs`) added a stream line in the same spot. Resolved by keeping both lines.
2. **`src/store/sale.store.ts`** — `main`/WAFI-101 (`isOpenItem` field) and WAFI-100 (`discountType`/`discountValue`/etc. fields + `SaleDiscount` interface) both extended `SaleLine` at the same spot. Resolved by keeping both — no semantic overlap.
3. **Migration number collision** — `044_products_created_via.sql` and `045_sale_discounts.sql` (from these two branches) collided with `044_device_sessions.sql` / `045_switch_active_operator.sql` already merged to `main`. **Renamed to `051_products_created_via.sql` and `052_sale_discounts.sql`** (next free slots after `main`'s `050_hook_security_definer.sql`).

## Verified

- `npx vue-tsc --noEmit` — 0 errors
- `npx vitest run` — 167 test files / 1007 tests, all passing

## ⚠️ MUST FIX before this branch ships — real regression, untested

`worktree-wafi-100-discounts` **removed `sale.store.ts`'s `updateUnitPrice()`** and replaced it with `applyLineDiscount` / `applyMarkup` / `applySaleDiscount`, but **never updated the caller**:

- `src/features/pos/SalePanel.vue:259` still calls `store.updateUnitPrice(...)` in the free-form price input's `@change` handler. That method no longer exists on the store.
- No type error catches this (Pinia store return type isn't narrow enough here) and no test exercises this specific input, so `vue-tsc` and the full test suite both pass clean despite this — **it will throw at runtime** the moment a cashier edits a line's price by hand.
- This isn't a mechanical merge fix — it's a product decision: should manual price edits in `SalePanel.vue` now route through `applyMarkup` (price ≥ list) or `applyLineDiscount` (price < list, PIN-gated per WAFI-100's caps), or should the free-form editor be removed entirely in favor of the new discount/markup UI? The WAFI-100 design spec itself calls the old free-form editor "an unaudited discount bypass this ticket must close" — so the intent was to close it, just not finished on this branch.
- **Do not merge to `main` until this is wired**, or the POS price-edit flow breaks in production.

## Tomorrow — things to actually run/apply

1. **Run the two new/renumbered migrations** against Supabase (in order): `039_denomination_counting.sql`, `051_products_created_via.sql`, `052_sale_discounts.sql`.
2. **Deploy the updated `powersync.yaml`** to the PowerSync dashboard's Sync Streams editor (per its own header comment — the repo file is source of record, but the dashboard is what actually runs). The new `denomination_configs` line needs to be live there.
3. **Fix the `SalePanel.vue` → `updateUnitPrice` break** described above before this branch is usable.
4. Optional/lower priority: `v1_epics.md` still has zero entries for WAFI-100/101/103/108/138 — update it once you're happy with the merge so ticket status tracking doesn't silently drift.

## Not yet done

- This branch has not been pushed or merged into `main` — review it first (`git log main..integration/wafi-100-and-suggested-features`), fix item #3 above, then merge/push yourself.
