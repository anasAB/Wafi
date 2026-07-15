# Guided Stock-Take / Inventory Reconciliation (الجرد) — Design Spec

**Status:** Approved design, ready for planning
**Pack:** Staff Pack (+$5/month)
**Depends on:** Epic 2 (Manage Products & Track Stock) — existing `current_stock` field and `stock_adjustment` record (which already has a "جرد" / Stocktake reason today).
**Build order:** Second of the two 2026-07-14 candidate features (after Installment Plans).

---

## Epic summary

**Goal:** Owner/manager can run a guided physical count session against the system's recorded stock, see per-item and total variance (shrinkage), confirm the count, and have the resulting adjustments applied to `current_stock` — plus review a history of past sessions to see shrinkage trend over time.

**Value delivered:** Completes the "see who's stealing" thesis the Staff Pack is sold on. The existing audit log (WAFI-009) catches transaction-side fraud (voids, discounts); this catches inventory-side shrinkage — goods that go missing between counts, which the audit log cannot see. It also protects the accuracy of the Profit Report / dashboard, since profit figures are built on `current_stock`/COGS that silently drift without periodic reconciliation.

**In scope:** Guided count session (full catalog or scoped subset), frozen expected-stock snapshot at session start, barcode-scan-to-jump during counting (with input auto-focus after a scan), an uncounted-items confirmation on Finish, review screen with per-item variance + total shrinkage value (with extreme-variance highlighting and a high-value-only default filter), confirm-to-apply (writes `stock_adjustment` records), resumable in-progress sessions, stock-take history list with per-session detail and a simple shrinkage trend indicator.

**Out of scope:** Multi-user concurrent counting sessions on the same shop (not a realistic scenario at current shop scale), automatic WhatsApp shrinkage alerts (deferred — variance is shown in-app on session review, not pushed), charted shrinkage trend beyond a simple last-3-sessions indicator (defer a real chart until session volume justifies it), **adding a new (not-yet-in-catalog) product mid-count** (a scanned barcode with no match surfaces a "not found" message directing the counter to add it via the existing Epic 2 Add Product flow afterward, rather than an inline add-and-return — cashiers should note it on paper for now), **unit-of-measure conversion** (Epic 2's product model has no unit-of-measure field at all — every count is in whatever base unit the product's `current_stock` already represents; see Edge Cases for the resulting caveat).

---

## Data model

### `stock_take_session`

| Field | Type | Required | Notes |
|---|---|---|---|
| session_id | UUID | yes | |
| started_at | timestamp | yes | |
| completed_at | timestamp | no | Null while in progress |
| status | enum | yes | `in_progress` \| `completed` \| `cancelled` |
| created_by | string | yes | Who ran the count |
| scope | string | no | Category/search filter applied, or null for "all products" |

### `stock_take_line`

| Field | Type | Required | Notes |
|---|---|---|---|
| line_id | UUID | yes | |
| session_id | UUID | yes | FK |
| product_id | UUID | yes | FK |
| expected_stock | integer | yes | Snapshot of `current_stock` at session start — frozen, does not shift if sales occur mid-session |
| counted_stock | integer | no | Null until the counter enters a value; a null value at Finish time means "not yet counted" and is what drives the uncounted-items confirmation (Guided count flow, step 6). Once entered, cannot be negative (physical count). |
| variance | integer | yes | `counted_stock - expected_stock` (signed) |
| variance_value | decimal | no | `variance * unit_cost`; null/"—" if the product has no unit cost entered |

Existing `stock_adjustment` record (Epic 2) is reused as the write target: each non-zero variance line, on confirm, writes one `stock_adjustment` row with `reason = "جرد"` and a reference to `session_id`, and updates `current_stock` accordingly — the same mechanism as today's manual adjustment path, just batched.

---

## Guided count flow

1. Owner/manager starts a session, optionally scoped to a category or search filter (supports partial counts for large catalogs).
2. `expected_stock` is snapshotted for every in-scope product at this moment; each line's `counted_stock` starts null.
3. Guided screen presents products one at a time (or a scrollable list), each with a large numeric input for counted quantity. Barcode scan jumps directly to a product (reuses the existing scanner integration from Epic 2), and **the numeric input auto-focuses immediately after a successful scan** so the counter can type the quantity without an extra tap — this is a speed-critical detail, not a nice-to-have, since a count session with hundreds of products lives or dies on how fast each item goes by.
4. **Scanned barcode not found in the current scope:** show "منتج غير موجود" (product not found) and stay on the current line — no inline add-product flow (see Out of scope). The counter notes it separately; it can be added to the catalog afterward via Epic 2's existing Add Product screen.
5. Running progress shown ("42 of 180 counted").
6. Session can be paused and resumed later (state persists as `in_progress`).
7. **On "إنهاء" (Finish):** if any in-scope line still has `counted_stock = null` (never entered), show a blocking confirmation — "X منتجات لم يتم جردها. هل تريد احتسابها كـ 0؟" (X products were not counted — set them to 0?) — with two choices: **نعم، احتسبها كـ 0** (yes, set to 0) writes 0 into every still-null line before proceeding, or **العودة للعد** (back to counting) returns to the guided screen with the uncounted items surfaced first. This prevents an unscanned product from silently reading as "0 variance" (if left null and ignored) or from misleadingly reading as "all missing" — the counter makes an explicit, informed choice either way.
8. The **review screen** lists variance lines, sorted by `variance_value` descending. **Default view shows only lines where `abs(variance_value) > $50`** (or, for products with no cost price, `abs(variance) > 10` units as a fallback threshold) — a toggle labeled "عرض جميع الفروقات" (show all variances) reveals every non-zero line for the detail-oriented owner. A **total shrinkage value** is shown prominently at the top regardless of which view is active (it always sums *all* variance, not just the filtered/visible subset). **Extreme variance highlighting:** any line where `abs(variance_value) > $500` or `abs(variance) > 50` units is visually flagged (e.g., a yellow row background) as a likely data-entry error, and confirming the session while any such flagged line is present requires one extra confirmation tap ("هل أنت متأكد من هذا الفارق الكبير؟" — are you sure about this large variance?) before it's applied — a safeguard against a mistyped count silently injecting phantom inventory.
9. Owner confirms → each non-zero-variance line (including any auto-set-to-0 lines from step 7 that produce a variance) writes a `stock_adjustment` record (reason "جرد", linked to `session_id`) and updates `current_stock` → session status becomes `completed`.

**Why `expected_stock` is frozen at session start:** a count can take an hour on a real shop floor, and sales must keep working normally (Sacred Rule #1, offline-first) without corrupting the count target mid-session. Any sales that occur during the session are simply absorbed into the resulting adjustment, exactly as if they'd happened before the count started.

**Unit-of-measure caveat:** Epic 2's product model has no unit-of-measure concept — `current_stock` is a bare integer with no unit attached. A count session inherits this as-is: whatever unit the catalog's stock number already represents (pieces, boxes, cartons — the shop's own convention) is the unit the counter must count in. There is nothing in this feature (or the underlying catalog) to detect a unit mismatch (e.g., counting individual pieces when the system tracks boxes) — this is a training/process concern for the shop, not something the software can catch in v1.

---

## Stock-take history

**New screen** (Back Office, under Inventory): list of past `stock_take_session` records with `status = 'completed'` only, sorted by `completed_at` descending — date, who ran it, products counted, total shrinkage value (red if net loss, green if net positive/found stock), tap-through to that session's line-level detail (read-only reuse of the review screen). Cancelled sessions never appear here (see Edge Cases).

**Trend indicator:** total shrinkage value across the last 3 **completed** sessions (cancelled sessions are excluded from both the list and this trend), shown at the top of the history list — no chart library needed for 3 data points; a real chart can be added later if session volume grows. This is a read of existing session/line data; no new write paths, so it adds minimal build cost.

---

## Edge cases

1. **Sale happens on a product mid-session, before it's counted** — no conflict; `expected_stock` is a frozen snapshot, and any sales during the session are absorbed into the resulting variance/adjustment automatically.
2. **Session abandoned/not completed** (phone died, shift ended) — stays `in_progress`, resumable later; a stale in-progress session older than a few days surfaces a nudge to resume or cancel (mirrors the zombie-shift pattern already built for shifts, WAFI-065).
3. **Two overlapping sessions on the same shop** — out of scope; not a realistic scenario at single-shop, single-counter scale. Flag as a v1.5+ consideration only if it comes up in practice.
4. **Product with no unit cost entered** — variance still shows in units; `variance_value` shows "—" with a caveat, consistent with the existing profit-dashboard "estimated" caveat pattern (WAFI-054). The extreme-variance highlight (Guided count flow, step 8) falls back to the unit-count threshold (>50 units) for these products, since there's no dollar value to compare against $500.
5. **Counted stock legitimately lower than what's already been oversold, resulting in negative `current_stock` after adjustment** — inherits Epic 2's existing negative-stock handling; counted quantity itself can never be negative (it's a physical count).
6. **Product never counted, left uncounted through the Finish confirmation** (counter chose "back to counting" and later abandons the session, or the session is resumed and finished by someone else) — as long as `counted_stock` stays null, that line is excluded from variance/shrinkage entirely (never treated as 0, never treated as fully missing) until either a count is entered or the Finish flow explicitly sets it to 0 with the counter's confirmation.
7. **Session cancelled** — its `stock_take_line` rows are archived (a `cancelled` flag or equivalent, not a hard delete — consistent with the soft-delete convention used elsewhere) so they never surface in the Stock-take History list or the last-3-session trend, and so a cancelled session's lines can never be confused with a real count.
8. **Scanned barcode not found during a session** — see Guided count flow step 4; the counter is told and stays on the current line, no inline add-product flow in v1.

---

## Report / dashboard integration

No new report is needed beyond the session review and history screens above. Because a stock-take writes real `stock_adjustment` records that update `current_stock`, it flows directly into the Profit Report / dashboard exactly like any other stock correction already does — accuracy is restored at the source, not recomputed separately.

---

## Definition of Done

- [ ] Owner/manager can start, pause, resume, and complete a guided count session
- [ ] `expected_stock` correctly freezes at session start and is unaffected by concurrent sales
- [ ] Barcode scan correctly jumps to the right product during counting, and the counting input auto-focuses immediately after a successful scan
- [ ] A barcode scanned with no match in the current scope shows "منتج غير موجود" and does not crash or silently advance
- [ ] Tapping "Finish" with any uncounted in-scope product triggers the confirmation modal, correctly setting uncounted lines to 0 on "yes" or returning to counting on "no" — never silently treating an uncounted item as 0 or as fully missing
- [ ] Review screen correctly sorts variance lines by value, defaults to showing only variances above the $50/10-unit threshold, and offers a working "show all" toggle
- [ ] Review screen visually flags and requires an extra confirmation tap for any line exceeding the $500/50-unit extreme-variance threshold before the session can be confirmed
- [ ] The total shrinkage value always reflects all variance lines, regardless of which filtered view is currently shown
- [ ] Confirming a session writes correct `stock_adjustment` records and updates `current_stock`
- [ ] Products with no unit cost show the "—" / estimated caveat rather than a wrong number, and correctly fall back to the unit-count extreme-variance threshold
- [ ] Cancelling a session archives its line items so they never appear in Stock-take History or the last-3-session trend
- [ ] Stock-take history list shows only completed sessions, sorted by completed_at descending, with accurate per-session totals
- [ ] Last-3-session shrinkage trend indicator computes correctly and excludes cancelled sessions
- [ ] Session state (in progress, lines counted so far) survives app restart/offline
- [ ] Tested on phone, tablet, desktop, online and offline
