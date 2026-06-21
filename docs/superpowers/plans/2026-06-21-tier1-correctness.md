# Tier 1 — Correctness & Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the data/money-correctness bugs that would make the brother distrust the product, so his first real use shows accurate numbers.

**Architecture:** Targeted fixes in existing composables/components — no new subsystems. Each is a bug fix with a regression test.

**Tech Stack:** Vue 3, Pinia, PowerSync (local SQLite), Supabase, Vitest, TypeScript.

## Global Constraints
- Offline-first must hold: product add/edit (incl. photos) must work with no network.
- USD `numeric(10,2)`; SYP integer; exchange rate integer (per WAFI-035).
- Plain-language Arabic for any user-facing string.

## Status note
WAFI-002 (rate lock) and WAFI-003 (double-tap) are **already fixed** in the code
(`POSSaleScreen.vue:71-76` calls `sale.checkRateChanged()`; `usePayment.ts:151`
has the in-flight guard). This plan covers the remaining Tier-1 items: WAFI-004,
005, 006, 007, 008.

---

### Task 1 (WAFI-004): Don't burn a receipt number on a failed sale write

**Files:**
- Modify: `src/features/payment/usePayment.ts` (`confirm()` — `nextNumber()` at line ~158 runs before the `db.writeTransaction` at ~206)
- Test: `src/__tests__/features/usePayment.test.ts`

**Interfaces:**
- Consumes: `nextNumber()` (increments + persists `saleStore.deviceSequence`), `db.writeTransaction`.
- Produces: a failed write leaves `deviceSequence` unchanged.

- [ ] **Step 1: Write the failing test** — in `usePayment.test.ts`, mock `db.writeTransaction` to throw; call `confirm()`; assert it rejects AND `saleStore.deviceSequence` is unchanged from before the call.
- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/__tests__/features/usePayment.test.ts` → FAIL (sequence was incremented before the throw).
- [ ] **Step 3: Fix** — move the `nextNumber()` call (and use of `displayNum`/`deviceSequence`) so the sequence is only committed inside/after a successful `writeTransaction`; on the catch path, ensure the sequence is not advanced. (Simplest: compute the candidate number, perform the insert with it inside the tx, and only call the persisting increment after the tx resolves.)
- [ ] **Step 4: Run it, verify it passes** — same command → PASS; existing confirm tests still green.
- [ ] **Step 5: Commit** — `git commit -m "fix(payment): don't advance receipt sequence on failed sale write (WAFI-004)"`

---

### Task 2 (WAFI-005): Fix COGS-reversal over-count on returns

**Files:**
- Modify: `src/features/dashboard/composables/useDashboardMetrics.ts:47-53` (the `cogsReversalRow` query)
- Test: `src/__tests__/features/` (dashboard metrics test; create if absent)

**Problem:** the reversal joins `sale_line_items sli ON sli.sale_id = r.original_sale_id AND sli.product_id = rli.product_id`. If the original sale has the **same product on two line items**, this matches both `sli` rows, multiplying the reversed COGS.

**Interfaces:** Produces a corrected `cogsReversalRow.cogs` that reverses each returned unit's cost exactly once.

- [ ] **Step 1: Write the failing test** — seed a sale with the same product on two lines (e.g. qty 1 @ cost 3, and qty 1 @ cost 5), a restocked return of qty 1; assert reversed COGS equals one line's unit cost (not the sum of both matched lines). Compare `profitUsd` to a hand calc.
- [ ] **Step 2: Run it, verify it fails** — FAIL (reversal multiplied).
- [ ] **Step 3: Fix** — reverse against a single, well-defined cost. Recommended: average the product's `unit_cost_usd` on the original sale, or pick the min/first deterministically, via a correlated subquery that returns one cost per `(original_sale_id, product_id)` rather than a row-multiplying join. (If `return_line_items` could instead snapshot `unit_cost_usd` at return time, prefer that — but that is a schema change; for this fix, deduplicate the join.)
- [ ] **Step 4: Run it, verify it passes** — PASS; profit matches the hand calc.
- [ ] **Step 5: Commit** — `git commit -m "fix(dashboard): reverse returned COGS once per unit (WAFI-005)"`

---

### Task 3 (WAFI-006): Sales chart must net returns like the cards

**Files:**
- Read first, then modify: `src/features/dashboard/composables/useSalesChart.ts`
- Test: its `__tests__`

**Problem:** the chart computes `profit = total_usd − COGS` per day with **no refund subtraction and no COGS reversal**, so a heavy-return day shows inflated sales/profit on the chart while `useDashboardMetrics` (the cards) shows the netted figure. The two surfaces disagree.

**Interfaces:** Produces per-day sales/profit that match the netting logic in `useDashboardMetrics` (subtract `refund_amount_usd`; reverse restocked COGS).

- [ ] **Step 1: Write the failing test** — a day with one sale and one restocked return; assert the chart's day sales = gross − refund and day profit reverses the restocked COGS, matching what `useDashboardMetrics` produces for that day.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Fix** — apply the same refund subtraction + restocked-COGS reversal (the corrected form from Task 2) per day bucket in `useSalesChart`. Reuse the corrected reversal SQL shape so the two stay consistent.
- [ ] **Step 4: Run it, verify it passes** — chart and cards agree for the test day.
- [ ] **Step 5: Commit** — `git commit -m "fix(dashboard): chart nets refunds + COGS reversal to match cards (WAFI-006)"`

---

### Task 4 (WAFI-007): One consistent business-day boundary

**Files:**
- Read first, then modify: `src/features/dashboard/composables/useCashDrawer.ts` (`getDayStart`, ~lines 28-42)
- Reference (already local-time correct): `useDashboardMetrics.ts:24` uses `DATE(created_at,'localtime')`
- Test: `useCashDrawer` `__tests__`

**Problem:** `getDayStart` returns a UTC ISO at a 6 AM boundary and compares raw `created_at >= ?`, while the metrics/chart use `DATE(created_at,'localtime')` (midnight, local). In UTC+3 the drawer window is off by the offset, so the drawer can't reconcile with the revenue card near midnight–morning.

**Decision (PO):** standardize on a single **local-time** business-day boundary. Recommended: a configurable business-day start (default 6 AM **local**) applied to *all* period queries (drawer, revenue, best-sellers, chart, expenses). For the trip, the minimal fix is to make the drawer use the same local-day semantics as the cards.

- [ ] **Step 1: Write the failing test** — with the device clock in UTC+3, a sale at 02:00 local; assert it falls in the same day bucket for both `useCashDrawer` and `useDashboardMetrics`.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Fix** — compute the day window in local time (mirror `DATE(created_at,'localtime')`), applying the 6 AM-local rule consistently rather than a UTC ISO. Confirm best-sellers/chart use the same boundary.
- [ ] **Step 4: Run it, verify it passes** — drawer and revenue agree across the midnight–6 AM window.
- [ ] **Step 5: Commit** — `git commit -m "fix(dashboard): unify business-day boundary in local time (WAFI-007)"`

---

### Task 5 (WAFI-008): Persist product photos (stop using blob: URLs)

**Files:**
- Modify: `src/features/products/components/ProductPhotoUpload.vue:52` (emits `URL.createObjectURL(blob)`)
- Modify: same for receiving invoice photos and expense receipt photos if they reuse this component.
- Test: component/unit test for the emitted value.

**Problem:** `URL.createObjectURL(blob)` is valid only for the current document; it's stored in `products.photo_url`, so the photo is dead after reload and on every other device, and the bytes never sync.

**Decision (PO) — pick one, documented in the task:**
- **(A) Data-URI inline (recommended for v1):** emit a base64 `data:image/webp;base64,…` string instead of a blob URL. Offline-safe (syncs via PowerSync like any text), simple, no infra. Cost: size — so **lower the compression cap** (e.g. `MAX_BYTES` to ~40-60 KB for product thumbnails) to keep sync light on cheap devices.
- **(B) Supabase Storage upload:** upload the blob, store the returned URL. Cleaner at scale, but the upload needs network at save time → **breaks offline product-add** (Sacred Rule #1) unless you build an offline upload queue. Defer to scale.

Recommended: **(A)** for the brother's catalog size; revisit (B) when scaling.

- [ ] **Step 1: Write the failing test** — assert `ProductPhotoUpload` emits a `data:` URI (not `blob:`) for a sample image, and that the emitted string round-trips (decodes to image bytes).
- [ ] **Step 2: Run it, verify it fails** — currently emits `blob:`.
- [ ] **Step 3: Fix** — replace `URL.createObjectURL(blob)` with a `FileReader.readAsDataURL` (or `blob`→base64) conversion; lower `MAX_BYTES` for the product thumbnail per decision A.
- [ ] **Step 4: Run it, verify it passes** — emits a `data:` URI within the size cap.
- [ ] **Step 5: Manual check** — add a product with a photo, reload, confirm the photo still shows; confirm it appears on a second signed-in device after sync.
- [ ] **Step 6: Commit** — `git commit -m "fix(products): persist photos as data URIs so they survive reload+sync (WAFI-008)"`

---

## Self-Review
- WAFI-004 → Task 1 ✓ · WAFI-005 → Task 2 ✓ · WAFI-006 → Task 3 ✓ · WAFI-007 → Task 4 ✓ · WAFI-008 → Task 5 ✓
- WAFI-002 / WAFI-003 already fixed (status note) — not re-speced.
- Reads-before-edit flagged for Tasks 3 and 4 (`useSalesChart.ts`, `useCashDrawer.ts`) — match existing query shapes.
- One design decision embedded: WAFI-008 photo persistence approach (A data-URI recommended vs B Storage) — resolve in Task 5 before coding.
