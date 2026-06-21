# Wafi POS — Audit Findings Tickets

> Date: 2026-06-20
> Source: full implementation audit (5 parallel reviewers + verified C1/C2).
> Severity: **P0** trip/data/money correctness · **P1** foundational integrity · **P2** correctness edge cases · **P3** minor/polish.
> Every audit point is represented. Duplicates reported by multiple reviewers are merged into one ticket (noted).

---

## P0 — Trip blockers / data & money correctness

### WAFI-001 — Tenant scoping is broken in production
**Area:** data/powersync, migrations · **Evidence:** `schema.ts:230-250`, `010_*`, `powersync.yaml:38-39`, `device.store.ts:42`
`shops`/`devices` are NOT in the client `AppSchema`, NOT in the publication (010), and have NO RLS — yet sync rules select them and the client queries a local `shops` table. In prod (`FALLBACK_SHOP_ID=''`) `shopId` stays empty → reads return nothing, writes are RLS-rejected, queue stalls. Works in dev only via `VITE_STUB_SHOP_ID`.
**Acceptance Criteria:**
- `shops` + `devices` added to `AppSchema` with needed columns (incl. `owner_user_id`, `device_code`).
- Both added to the PowerSync publication; RLS added: shops `owner_user_id = auth.uid()`, devices `shop_id = auth_shop_id()`.
- `refreshShopId()` resolves a real shop id from the synced `shops` row in a prod build.
- `AppSchema` / publication / `powersync.yaml` table lists reconciled to one identical set.
- Verified: prod build (no stub) signs in → resolves shopId → syncs → read/write succeed; a second account sees none of the first's shops/devices rows.
- Trip workaround documented: set `VITE_STUB_SHOP_ID` to the brother's real shop id (single-shop only).

### WAFI-002 — Exchange rate not locked mid-sale
**Area:** pos/exchange-rate · **Evidence:** `POSSaleScreen.vue:71-79`
A rate edit re-prices the open cart, violating the lock invariant and the screen's own "next sale only" banner.
**Acceptance Criteria:**
- Editing the rate while the cart has lines does not change the cart's locked rate or SYP total.
- A "applies to next sale only" notice shows instead.
- `updateLockedRate` removed/guarded so the locked rate is immutable once set.
- Test: add line at rate R → change to R2 → cart SYP still uses R.

### WAFI-003 — Double-tap pay creates a duplicate sale + double sequence
**Area:** payment · **Evidence:** `usePayment.ts:146-151`, `PaymentModal.vue:117`
**Acceptance Criteria:**
- `confirm()` is idempotent: a call while `state==='confirming'` is a no-op; confirm buttons disabled during confirmation.
- Test: rapid double-tap and Enter-held each produce exactly one sale row and one sequence increment.

### WAFI-004 — Receipt number burned on failed transaction
**Area:** payment · **Evidence:** `usePayment.ts:150-151` (increment before the write)
**Acceptance Criteria:**
- Sequence increment happens inside the sale write transaction, or rolls back on failure.
- Test: forced write failure → device sequence unchanged; next sale uses the expected number.

### WAFI-005 — Dashboard COGS reversal over-counts
**Area:** dashboard · **Evidence:** `useDashboardMetrics.ts:47-53`
The reversal join multiplies when a product appears on >1 sale line.
**Acceptance Criteria:**
- COGS reversed against the specific returned line/qty (or a cost snapshot on `return_line_items`), once per returned unit.
- Test: same product on two lines, partial return → profit matches a hand calc.

### WAFI-006 — Dashboard cards and chart disagree (chart ignores returns)
**Area:** dashboard · **Evidence:** `useSalesChart.ts:51-82`
**Acceptance Criteria:**
- Chart subtracts refunds and reverses COGS consistently with `useDashboardMetrics`.
- Test: a heavy-return day shows identical net sales/profit on chart and cards.

### WAFI-007 — Business-day boundary mismatch (drawer vs revenue)
**Area:** dashboard · **Evidence:** `useCashDrawer.getDayStart` (6 AM UTC ISO) vs `DATE(...,'localtime')` elsewhere
**Acceptance Criteria:**
- All period computations (drawer, revenue, best-sellers, chart, expenses) use one consistent local-time day boundary.
- A configurable business-day start (default 6 AM local) applied uniformly, or all use the local calendar day — one decision, everywhere.
- Test in UTC+3: a 2 AM sale lands in the same day for both drawer and revenue card.

### WAFI-008 — Photos lost (blob: URLs never uploaded)
**Area:** products/suppliers/expenses · **Evidence:** `ProductPhotoUpload.vue:52`, `useProducts.ts:70`
**Acceptance Criteria:**
- Photos persist across reload and sync (uploaded to Supabase Storage with the URL stored, or inlined as a data URI).
- Same fix applied to receiving invoice photos and expense receipt photos.
- Test: add a product photo → reload + open on a second device → photo displays.

---

## P1 — Foundational integrity (before pilots / "see who's stealing")

### WAFI-009 — Audit log is editable/deletable (not append-only)
**Area:** audit/migrations · **Evidence:** `005_audit_log_rls.sql:40-73`, `015:74-79`
**Acceptance Criteria:**
- No UPDATE/DELETE RLS policy on `audit_log`; UPDATE/DELETE revoked from `anon`,`authenticated`.
- `BEFORE UPDATE/DELETE` trigger raises on any modification.
- PowerSync upload path stays insert-only for audit_log.
- Test: UPDATE and DELETE on audit_log via anon key → both rejected.

### WAFI-010 — Permissions have no server backing (client-only honor system)
**Area:** permissions/RLS · **Evidence:** `permissions.ts`, `015` (shop-scoped only), `powersync.yaml:42-60`
RLS scopes by shop, not role; any cashier with the anon key reads/writes everything.
**PO DECISION (2026-06-20): Build server-side enforcement. Becomes its own post-trip epic (depends on the Auth epic's staff-identity layer). Does NOT block the trip.**
**Acceptance Criteria:**
- A per-staff identity reaches the server (e.g. a staff token carrying `staff_id` + role minted after PIN entry), distinct from the shop's Supabase account.
- Sensitive data (staff PINs, audit log, profit-bearing reads) is enforced server-side: a cashier-role session cannot read it via the API/anon key.
- **Explicit offline decision documented per sensitive surface:** which data is "online-only, role-gated via Edge Function" vs "synced offline." (Server-side gating removes offline availability for gated data — Sacred Rule #1 trade-off must be made deliberately.)
- Sync streams updated so role-gated tables are not synced to under-privileged devices.
- Test: a cashier session cannot read another staff's PIN hash or the audit log through any direct API call.

### WAFI-011 — Route guard fails open (wrong store + null-staff allow)
**Area:** router · **Evidence:** `index.ts:49` (reads `shiftStore`) vs `StaffPinPrompt.vue:39` (writes `sessionStore`), `permissions.ts:16`
**Acceptance Criteria:**
- Guard reads the same store the PIN login writes.
- Null/absent staff on a permission-gated route → redirect (fail closed).
- `/setup-owner` guarded; reports/profit routes gated by `can_view_reports`.
- Test: as cashier, direct-navigate to `/settings/staff`, `/settings/audit-log`, `/setup-owner` → all redirected.

### WAFI-012 — PIN brute-force + weak hashing
**Area:** staff · **Evidence:** `usePinAuth.ts`, `StaffPinPrompt.vue:32`
**Acceptance Criteria:**
- PIN entry rate-limited: N wrong attempts → timed lockout, persisted across reload; owner notified (audit event).
- PIN hashes per-staff salted (or slow KDF); a bare SHA-256 of the 4-digit PIN no longer syncs.
- Reject trivial PINs; warn on duplicate PINs across staff.
- Test: 5 wrong PINs → lockout; two staff cannot silently share a PIN.

### WAFI-013 — No Manager role
**Area:** staff · **Evidence:** `staff.types.ts:1`, `003_staff.sql:9`
**PO DECISION (2026-06-20): Build Manager now — it IS in v1.**
**Acceptance Criteria:**
- `manager` role added across: `staff.types.ts`, the DB CHECK constraint (`003_staff.sql` → new migration, expand-only), and the permission matrix.
- Manager matrix: cashier permissions **+** edit products **+** view revenue/profit/reports; **cannot** manage other staff or change settings.
- Permission checks (`permissions.ts`, sidebar, route guards) handle all three roles; depends on the WAFI-011 guard fix so role gating is actually enforced.
- Test: a Manager can open products + reports, and is redirected from `/settings/staff` and `/settings` (settings mgmt).

### WAFI-014 — Security events unaudited; audit writes swallowed; attribution gaps
**Area:** audit/staff · **Evidence:** `useStaff.ts:127`, `useAuditLog.ts:43,52`
**Acceptance Criteria:**
- `updateStaffPin` writes a `staff.pin_changed` row; owner-overwrite labeled correctly (not `permissions_changed`).
- `auth.login_failed` / `auth.locked_out` events recorded.
- A failed audit write surfaces (toast/log) and retries — not silently swallowed.
- Every audited action has a real `staff_id` (depends on WAFI-011).

### WAFI-015 — Sync queue visibility dead + poison-op stalls queue
**Area:** sync · **Evidence:** `sync.store.ts:8` (pendingCount never set), `connector.ts:50`
**Acceptance Criteria:**
- `pendingCount` reflects the real CRUD upload-queue depth; the "N waiting" indicator updates on each status change.
- Download errors surfaced distinctly from offline ("sync rules rejected" vs "offline").
- A non-transient rejected op is quarantined after N retries so it can't block later sales; the stuck op is visible.
- `isStale` is time-reactive and warns a never-synced device with pending writes.

### WAFI-016 — Multi-device identity stub → collisions + misattribution
**Area:** device/shifts · **Evidence:** `device.store.ts:22-23`, `useSaleNumber.ts:6-7`, `useZReport.ts:64-102`, `useShift.ts:29`
**Acceptance Criteria:** (folds into the post-trip Auth epic)
- Real per-install `device_id`/`device_code`; no two devices share a code in a shop.
- `expenses` and `customer_payments` carry `device_id`/`shift_id` so multi-device cash variance is correct.
- Only one open shift per device (guard or unique partial index `WHERE status='open'`).
- Test: two devices → distinct codes, no sale-number collision, correct per-device Z-report cash.

### WAFI-017 — Printer is a stub but UI claims success
**Area:** printing · **Evidence:** `usePrinter.ts:32-41`, `SaleConfirmationScreen.vue:50`
**Acceptance Criteria:**
- Trip (no printer): print action no longer claims "sent to printer"; button hidden/relabeled when no driver is configured.
- A real ESC/POS driver (WebUSB/Web Serial) implemented behind `IPrinterDriver` before any printer-using customer.

---

## P2 — Correctness edge cases

### WAFI-018 — Arabic search not diacritic-insensitive
**Evidence:** `ProductList.vue:62`, `ReceivingProductPicker.vue:37`, `ProductGrid.vue:38`, `useSuppliers.ts:63`
**Acceptance Criteria:**
- Shared Arabic normalization (strip harakat/tatweel; fold alef variants, yaa, taa-marbuta) applied to stored value and query across products, suppliers, customers, POS.
- Test: "سماعة" matches "سَمَّاعة"; "احمد" matches "أحمد".

### WAFI-019 — Negative-stock policy contradiction
**Evidence:** `useProducts.ts:42,120`, `useSale.ts:45,47`, dead UI `ProductList.vue:304`
**PO DECISION (2026-06-20): Forbid — keep the block (overrides Epic 2.4/2.7).**
**Acceptance Criteria:**
- Keep the POS zero-stock block and the `Math.max(0,…)` clamps; stock can never go negative.
- Remove the dead negative-stock UI (`ProductList.vue:304,388` `stock-neg` styling) since it can never trigger.
- **Update Epic 2.4/2.7 spec** to state "forbid overselling" so there is one source of truth.
- Test: selling beyond on-hand is blocked with a clear Arabic message.
- WATCH (revisit at device registration): an offline device with a stale count can block a legitimate sale.

### WAFI-020 — Excel import incomplete + missing currency conversion
**Evidence:** `src/features/imports/*` (no parser/transform/insert/UI)
**Acceptance Criteria:**
- Removed from the build until complete, OR full pipeline: parse XLSX/CSV → map (reuse `autoDetectMapping`) → convert price/cost to USD via a rate → validate (required `nameAr`, numeric coercion incl. Arabic-Indic digits/separators/symbols, skip empty rows) → within-file + against-DB duplicate-barcode handling → preview → batched insert reusing `useProducts.save` guards → populate `ImportResult`.
- Test: a messy real spreadsheet (Arabic/English/mixed headers, SYP prices) imports with correct USD prices — no 14,500× error.

### WAFI-021 — Receiving: zero-cost wipes margin; no void/edit
**Evidence:** `useReceivingSheet.ts:28,101-104`; `useReceivings` read-only
**Acceptance Criteria:**
- `updateCost` blocked (or explicitly confirmed) when `unitCostUsd <= 0`.
- A void/reverse-receiving path reverses stock and cost with an audit trail.
- Test: receiving at cost 0 with updateCost does not zero standing cost; a voided receiving restores prior stock.

### WAFI-022 — Receiving quick-add creates zero-cost/zero-price products
**Evidence:** `ReceivingProductPicker.vue:53-66`
**Acceptance Criteria:**
- Quick-add validates cost/sale price (or flags needs-pricing).
- Product match on add uses `id`, not `nameAr` substring (no wrong-product on duplicate names).

### WAFI-023 — Receiving picker barcode affordance non-functional
**Evidence:** `ReceivingProductPicker.vue:84`
**Acceptance Criteria:** scanner wired into the picker, or the placeholder removed.

### WAFI-024 — Supplier delete leaves orphan receivings
**Evidence:** `useReceivings.ts:31`
**Acceptance Criteria:** deleting a supplier with receivings is blocked or warns; stats/filter don't silently drop those purchases.

### WAFI-025 — Expenses: stale USD on duplicate/recurring SYP rows
**Evidence:** `useExpenses.ts:155-163`, `save:110-129`, `ExpenseForm.vue:96`
**Acceptance Criteria:**
- `duplicateLastMonth` recomputes `amount_usd` for SYP expenses at duplication-time rate.
- Materialized recurring occurrences book `amount_usd` at an appropriate rate, not all at creation-time rate.
- Recurring meta tag not copied into a plain duplicate.
- Test: duplicate an SYP rent after the rate moves → USD reflects the new rate.

### WAFI-026 — Customer negative balance / floating credit not handled
**Evidence:** `useCustomerBalance.ts`, `CustomerDetailPage.vue:35`
**Acceptance Criteria:**
- A negative balance (shop owes the customer) shows in plain language, not "settled".
- Behaviour of a general/over-payment (floating credit) defined and implemented.
- Per-currency AR view considered (today USD-only) per the per-currency invariant.
- Test: payment + return exceeding sales shows a customer-credit balance.

### WAFI-027 — store_credit refund on a cash sale is lost
**Evidence:** `useReturnSheet.ts`, `returns.types.ts:1`
**Acceptance Criteria:**
- A `store_credit` refund creates a customer credit balance (ties to WAFI-026); a cash sale's store-credit refund is a recorded liability, not dropped revenue.
- Test: cash sale returned as store_credit → customer has store credit equal to the refund.

### WAFI-028 — Returns restock not atomic across devices
**Evidence:** `useReturnSheet.ts:152-167`
**Acceptance Criteria:** restock uses an atomic `current_stock = current_stock + ?` update.

### WAFI-029 — Return after product deletion drops lines
**Evidence:** `useReturnSheet.load` inner join `products:62`
**Acceptance Criteria:** a sale's lines stay returnable even if the product was later deleted (LEFT join / snapshot).

### WAFI-030 — Confirmation screen breaks on refresh/app-kill
**Evidence:** `SaleConfirmationScreen.vue:16,27`
**Acceptance Criteria:** if `history.state.sale` is absent, load the sale by id (route param) so confirmation + reprint work after refresh.

### WAFI-031 — Reprint diverges from original
**Evidence:** `useSaleHistory.ts:96-126,109`
**Acceptance Criteria:** reprint loads real receipt settings + `sale_payments` (split breakdown), uses the real shop name (not the UUID), and marks fully-returned sales.

### WAFI-032 — Barcode listener leak + input handling
**Evidence:** `useBarcodeScan.ts:53,63`; consumers lack `onUnmounted`
**Acceptance Criteria:**
- Every consumer calls `scanner.destroy()` on unmount (no accumulating listeners / double-fire).
- Scanned input trimmed/normalized on all lookups; Tab-terminated scanners supported; first char not leaking into a focused input.

### WAFI-033 — Exports: empty in prod, no validation, OOM, mislabels, RTL
**Evidence:** `useExportData.ts:5-11,42,49`, `useExportFile.ts:9,24`
**Acceptance Criteria:**
- Custom range validated (start ≤ end); large exports chunked/row-capped (cheap-device OOM).
- Sales export LEFT-joins products (deleted-product sales kept).
- Payment-method column derived truthfully from `is_split`/`is_credit` + `sale_payments`.
- Arabic/RTL renders correctly in the produced file; date formatting consistent.
- Depends on WAFI-001 for non-empty prod output.

### WAFI-034 — Receipt settings: shop_id as PK, no logo
**Evidence:** `useReceiptSettings.ts:30-42`, `ReceiptSettingsScreen.vue`
**Acceptance Criteria:**
- `receipt_settings` uses a real uuid `id` with a unique index on `shop_id`.
- Logo upload field added (v1 requirement), persisted per WAFI-008.
- Header/footer length limited/guided for 80mm (32/48 col) widths.

### WAFI-035 — Exchange rate sanity guard + precision
**Evidence:** `useExchangeRate.ts:39-41`, editor input
**PO DECISION (2026-06-20): Integer-only exchange rate.**
**Acceptance Criteria:**
- Rate input enforces whole numbers (`step=1`, parsed/stored as integer); decimals rejected.
- First-of-day rate (currentRate null) also gets a plausibility check/confirm.
- History shows device/source attribution for a change.
- Test: a decimal entry is rejected; SYP totals show no fractional rounding artifacts.

### WAFI-036 — Migration hygiene
**Evidence:** `010/012/015/016` numbering; `audit_log.shop_id` TEXT; `powersync.yaml:13-29`
**Acceptance Criteria:**
- Runner ordering confirmed by filename, not mtime.
- `012` (USING true) neutralized/removed/renumbered so scoped RLS (015) can't be reverted by replay order.
- `014` gap documented; AppSchema/publication/sync-rule lists reconciled (with WAFI-001).
- `audit_log.shop_id` type inconsistency documented; `powersync.yaml` subquery form verified accepted by the validator (or switched to the parameter form).

### WAFI-037 — Data-layer footguns
**Evidence:** `client.ts:3-4`, `devAuth.ts:46-49`, `db.ts` triple connect, `connector.ts:14-15`
**Acceptance Criteria:**
- Prod boot refuses/loudly warns on placeholder Supabase env vars (no silent localhost fallback).
- `VITE_DEV_AUTO_SIGNUP` cannot create accounts in a prod build.
- A single owner of `db.connect()` (no triple-connect race).
- PUT upserts include all NOT NULL columns (or the queue-pause risk handled/documented).

---

## P3 — Minor / polish

### WAFI-038 — POS profit preview + reactivity
`SalePanel.vue:17-22` profit uses stale cost after a price edit; `useSale.ts:82` returns a raw array.
**AC:** profit preview uses current cost; `lines` exposed via computed/`storeToRefs`.

### WAFI-039 — Payment rounding edges
**AC:** `scalePricesToTotal` distributes the remainder cent so line-sum equals the entered total; SYP change-due computed without double-rounding; split card leg guarded when remaining ≤ 0 (`PaymentModal.vue:112-115`).

### WAFI-040 — Sale-history date semantics unified
`useSaleHistory.ts:25` vs `:30` mix `DATE(...,'localtime')` and UTC `>=`.
**AC:** both query branches use the same day semantics.

### WAFI-041 — Sale draft recovery
**AC:** `restoreDraft` wired into POS mount with a "resume previous sale?" prompt; restores `listPriceUsd`; 200ms debounce data-loss window documented.

### WAFI-042 — Sequence reset on shop change/sign-out
**AC:** the per-device sale sequence resets when the shop/account changes.

### WAFI-043 — missingCostCount scope + consistency
**AC:** `missingCostCount` scoped to products sold in the selected period and unified with `ProfitSheet`'s cost-warning heuristic.

### WAFI-044 — Dashboard widgets
**AC:** `StalenessBar` re-evaluates over time (interval tick); `CashDrawerSheet` labels reflect the actual period, not hardcoded "today".

### WAFI-045 — Configurable week start
**AC:** week start configurable (default Saturday) for Syrian retail (`periodUtils.ts:16-22`).

### WAFI-046 — Expense list clarity
**AC:** list shows cash/non-cash; sort/label uses the same field as the period filter (`expense_date` vs `createdAt`).

### WAFI-047 — Customer detail + perf
**AC:** `useInvoiceDetail` shows returns so totals reconcile; `RecordPaymentSheet` shows inline overpay validation; balance-list correlated subqueries indexed/optimized for many customers.

### WAFI-048 — Returns guards
**AC:** warn when refund currency has no available tender in the drawer; validate reason/notes.

### WAFI-049 — Settings persistence
**AC:** persist key namespaced per account (kiosk safety); storage-unavailable handled; `ReturnReasons` writes use a uuid id + valid shop_id.

### WAFI-050 — Product photo + stock-adjust edges
**AC:** non-decodable images (e.g. HEIC) handled with a clear message; `adjustStock` logs the user-entered (pre-clamp) value.

### WAFI-051 — Shift edges
**AC:** support an opening SYP float; require a generated Z-report before `closeShift` writes; Z-report print has a fallback when `window.open`/print is blocked (PWA standalone) and records that it printed.

### WAFI-052 — Audit/sync minor
**AC:** `staff_name` rename consistency considered (snapshot vs live); audit search works beyond the `LIMIT 200` window; `waitForConnected` clears its timeout on all paths (`useSync.ts:12-37`).

---

---

## Feature tickets

### WAFI-053 — Switch operator without changing the shift
**Area:** staff/shifts · **Type:** feature (not an audit defect)
**Spec:** `docs/superpowers/specs/2026-06-21-switch-operator-design.md`
**Plan:** `docs/superpowers/plans/2026-06-21-switch-operator.md`
Owner/staff swap at the register via quick PIN re-auth without closing/opening the cash shift; per-operator sale attribution within one shift.
**Acceptance Criteria:** as per the plan's Definition of Done (5 tasks).
**Note:** its Task 2 **resolves WAFI-011** (single active-operator store + fail-closed guard), and its Task 1 adds `sales.staff_id`. So scheduling WAFI-053 also closes WAFI-011 — do not double-schedule WAFI-011 separately.

---

## Suggested sequencing
1. **Before the trip:** WAFI-002, WAFI-003, WAFI-007 (+ WAFI-001 via the stub workaround). WAFI-008 if time.
2. **Post-trip Auth epic (already drafted):** WAFI-001 (full), WAFI-009, WAFI-010 (now its own epic), WAFI-012, WAFI-016.
3. **WAFI-053 (switch operator)** — carries WAFI-011; schedule when operator-switching is wanted.
4. **Then:** remaining P1, then P2 by customer impact, then P3.
