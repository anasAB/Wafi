# WAFI Production Readiness Implementation Plan
## Version: 1.0 | Date: 2026-07-20 | Status: APPROVED FOR EXECUTION

---

## EXECUTIVE SUMMARY

This plan addresses the critical gaps identified in the WAFI ecosystem review. 
It is organized into 5 phases, 23 tickets, prioritized by dependency order.

| Phase | Priority | Tickets | Goal |
|---|---|---|---|
| 1: Security Foundation | P0 | 001–003 | Blocks everything — auth, RLS, device identity |
| 2: Auth & Onboarding | P1 | 004 | Unlocks multi-tenancy and customer expansion |
| 3: Design System | P1 | 005–006 | Stops technical debt from 4 competing redesigns |
| 4: Audit & Data Integrity | P1 | 007–008 | Closes invariant gaps, prevents data poisoning |
| 5: Cross-Feature Hardening | P2 | 009–023 | Production polish, automation, documentation |

**Total Estimated Duration: 8 weeks (2 months)**
**Critical Path: TICKET-001 → TICKET-002 → TICKET-003 → TICKET-004**

---

## PHASE 1: SECURITY FOUNDATION
### Priority: P0 | Blocks all other work

---

### TICKET-001: Server-Side Role Enforcement (WAFI-010)
**Type:** Epic | **Estimated:** 2 sprints | **Assignee:** Backend Lead

**Problem:** All permission checks are client-side only. A cashier can extract the shared Supabase JWT and read owner profit data, audit logs, and staff PIN hashes.

**Acceptance Criteria:**
- [ ] Row-Level Security (RLS) policies enforce role-based access on ALL 19 synced tables
- [ ] `staff.role` ('owner' | 'manager' | 'cashier') is enforced at database level
- [ ] `permissions` JSON blob fields are validated by RLS, not just read by client
- [ ] Financial tables (`sales`, `expenses`, `cashier_shifts`, `audit_log`) are owner/manager-only by default
- [ ] Cashier cannot SELECT from `staff` table (PIN hashes protected)
- [ ] Cashier cannot SELECT aggregate profit/revenue data across shifts
- [ ] Manager with `can_view_reports: false` is blocked by RLS (not just UI)
- [ ] Every API call (PowerSync sync, direct Supabase) respects role boundaries

**Actions:**
1. Create `auth_role()` helper function: `SELECT role FROM staff WHERE id = auth_staff_id()`
2. Create `auth_permissions()` helper: returns permissions JSON for authenticated staff
3. Rewrite ALL RLS policies across 19 tables to check role + permissions
4. Add `staff_id` claim to JWT (separate from `shop_id` claim)
5. Update PowerSync connector to include `staff_id` in credentials
6. Add `staff_id` to all sync rules for row-level staff scoping
7. Create migration: `020_rls_role_enforcement.sql`
8. Write cross-tenant isolation test: User A (cashier) cannot read User B (owner) data
9. Write role-escalation test: Cashier JWT cannot access manager/owner endpoints

**Definition of Done:**
- [ ] All 19 tables have role-scoped RLS policies
- [ ] Vitest integration tests: cashier forbidden from financial tables
- [ ] Manual penetration test: extract JWT, attempt unauthorized reads via curl/Postman
- [ ] Security review document signed off
- [ ] Zero regression on existing sync behavior for authorized roles
- [ ] Migration is idempotent and reversible

**Dependencies:** None (foundation)
**Blocks:** TICKET-002, TICKET-003, TICKET-004, TICKET-014, TICKET-015, TICKET-016

---

### TICKET-002: Real Authentication System
**Type:** Epic | **Estimated:** 1.5 sprints | **Assignee:** Full-Stack Lead

**Problem:** No working signup/login. Product supports exactly one hand-provisioned shop with hardcoded credentials.

**Acceptance Criteria:**
- [ ] New shop owner can sign up with email + password
- [ ] Signup creates `shops` row + `staff` row (role='owner') atomically
- [ ] Login returns JWT with `shop_id` + `staff_id` claims
- [ ] Password reset via email (Supabase Auth)
- [ ] Session persists across app restarts (secure storage)
- [ ] Logout clears all local data + session
- [ ] Auth guard on all routes: unauthenticated → /login
- [ ] PIN login screen gates app after auth (staff selection)

**Actions:**
1. Wire Supabase Auth signup/login to existing `/onboarding` route
2. Create `OwnerSetupScreen.vue` — name + email + password + shop name
3. On signup: `INSERT INTO shops` → `INSERT INTO staff` (owner) in transaction
4. Update `deviceStore` to read `shop_id` + `staff_id` from decoded JWT
5. Replace hardcoded `STUB_SHOP_ID` everywhere with dynamic `deviceStore.shopId`
6. Add `auth_guard.ts` router middleware
7. Add `AuthScreen.vue` (login/signup toggle)
8. Update `LockScreen.vue` to use real `staff` table instead of hardcoded owner
9. Add `forgot-password` flow via Supabase

**Definition of Done:**
- [ ] End-to-end signup → login → POS sale flow works on fresh device
- [ ] No hardcoded `shop-001-uuid` remains in codebase
- [ ] JWT contains both `shop_id` and `staff_id`
- [ ] Logout + re-login works without data loss (sync resumes)
- [ ] Unit tests: signup creates shop+staff, login returns valid JWT
- [ ] E2E manual test: complete signup on new device, verify tenant isolation

**Dependencies:** None (can parallel with TICKET-001)
**Blocks:** TICKET-003, TICKET-004

---

### TICKET-003: Self-Serve Device Registration
**Type:** Feature | **Estimated:** 1 sprint | **Assignee:** Full-Stack Lead

**Problem:** `device_id` and `device_code` are hardcoded stubs. Multi-device shops cannot exist.

**Acceptance Criteria:**
- [ ] Each device generates a unique `device_id` on first app open
- [ ] Device registers itself with shop on first auth
- [ ] `device_code` assigned sequentially (A, B, C...) per shop
- [ ] Device list visible in Settings → Devices
- [ ] Owner can remote-sign-out a device
- [ ] Sale numbers (`display_sale_number`) use real `device_code` + sequence
- [ ] Multi-device sync: sales from Device A appear on Device B within sync window

**Actions:**
1. Generate `device_id` via `crypto.randomUUID()` on first launch
2. Store in `localStorage` + Dexie (survives app kill)
3. Create `devices` registration flow: device pings server with `shop_id` + `user_agent`
4. Server assigns `device_code` (A-Z, then AA-ZZ if needed)
5. Update `useSaleNumber.ts` to use real `device_code` from `deviceStore`
6. Add `DevicesScreen.vue` (list + remote sign-out)
7. Add `remote_signout_requested_at` / `remote_signout_completed_at` handling
8. Update `sale.store.ts` `deviceSequence` to be per-device, persisted

**Definition of Done:**
- [ ] Two devices can register to same shop with different codes (A and B)
- [ ] Sales from Device A show on Device B after sync
- [ ] Sale numbers are unique per device (A-000001, B-000001)
- [ ] Remote sign-out forces device to login screen on next sync
- [ ] Device registration works offline (queues for sync)

**Dependencies:** TICKET-002
**Blocks:** TICKET-004

---

## PHASE 2: AUTH & ONBOARDING EXPERIENCE
### Priority: P1 | Unlocks customer expansion

---

### TICKET-004: Owner Bootstrap & Onboarding Flow
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Existing onboarding is a mockup. Real auth requires a guided first-time setup.

**Acceptance Criteria:**
- [ ] First-time owner sees guided setup: shop name → currency settings → exchange rate → first product
- [ ] Setup completes in <5 minutes
- [ ] Owner can skip optional steps (logo, categories)
- [ ] Setup progress persists across app kills
- [ ] Post-setup: land on Home screen with real data, not empty state
- [ ] "Demo data" option for testing (optional toggle)

**Actions:**
1. Extend `OwnerSetupScreen.vue` with multi-step wizard
2. Add `OnboardingProgress` store (Dexie-backed)
3. Create `ExchangeRateSetupStep.vue` (required)
4. Create `FirstProductStep.vue` (optional but recommended)
5. Add progress indicator (step X of Y)
6. Add "Skip for now" on optional steps
7. Auto-redirect to `/` after completion

**Definition of Done:**
- [ ] New user completes setup in <5 minutes in manual test
- [ ] Progress survives app kill and resume
- [ ] No hardcoded data after setup complete
- [ ] Home screen shows real metrics post-setup

**Dependencies:** TICKET-002, TICKET-003
**Blocks:** None (enables customer acquisition)

---

## PHASE 3: DESIGN SYSTEM CONSOLIDATION
### Priority: P1 | Stops technical debt accumulation

---

### TICKET-005: Design System Freeze & Consolidation
**Type:** Technical Debt | **Estimated:** 1 sprint | **Assignee:** Frontend Lead + Designer

**Problem:** 4 competing visual redesigns (Luxury, Navigation, Homepage, Gradient Glow) create inconsistency, regression risk, and maintenance burden.

**Acceptance Criteria:**
- [ ] Single design system chosen and documented
- [ ] All pages use consistent tokens, colors, typography
- [ ] No dead CSS classes or unused component variants
- [ ] Glassmorphism system unified (one set of blur/border/shadow utilities)
- [ ] Navigation system unified (bottom tabs mobile + sidebar desktop)
- [ ] No visual regressions on core flows (POS, Payment, Sale Confirm)
- [ ] Dark mode works consistently across all screens
- [ ] RTL verified on all screens

**Actions:**
1. **DECISION:** Adopt June 5 "Gradient Glow" as canonical design system
   - Rationale: Most recent, most complete, best documented, blue accent matches brand
2. Delete/deprecate:
   - Luxury redesign gold tokens (move to `theme` config for future v2)
   - Homepage redesign scoped styles (absorb into Gradient Glow tokens)
   - Navigation redesign duplicate components
3. Consolidate `style.css`:
   - One set of glass utilities (`glass-sm`, `glass-md`, `glass-lg`)
   - One color token system (`--color-glow-blue`, `--color-border-glow`, etc.)
   - One card system (`card`, `card-green`, `card-amber`)
4. Update `App.vue` to use unified layout (sidebar + bottom nav)
5. Update all page components to use unified tokens
6. Remove `BackOfficePage.vue` tile launcher (redundant with sidebar)
7. Update `AppHeader.vue` to single simplified design
8. Update `AppBottomNav.vue` to match Gradient Glow
9. Update `AppSidebar.vue` to match Gradient Glow
10. Create `DESIGN_SYSTEM.md` documenting tokens, patterns, and constraints

**Definition of Done:**
- [ ] `npm run build` produces zero warnings about unused CSS
- [ ] Visual regression test: screenshot compare on 10 core screens
- [ ] All screens pass RTL check (no hardcoded `dir="rtl"`)
- [ ] All screens pass dark mode check
- [ ] Design system documentation complete and reviewed
- [ ] Team sign-off on frozen system (no redesigns until v2)

**Dependencies:** None (can parallel with Phase 1)
**Blocks:** TICKET-006, TICKET-007, TICKET-008

---

### TICKET-006: Navigation System Cleanup
**Type:** Refactor | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Multiple navigation systems coexist (AppHeader icons, AppSidebar, BackOfficePage tiles, AppBottomNav).

**Acceptance Criteria:**
- [ ] Single navigation model: bottom tabs (mobile) + sidebar (desktop)
- [ ] `AppHeader` shows only title + back button + exchange rate (no nav icons)
- [ ] `BackOfficePage` redirects to `/products` on desktop (sidebar handles nav)
- [ ] `BackOfficePage` on mobile shows only active modules + Settings row
- [ ] All routes have consistent back-button behavior (`router.back()`)
- [ ] No page shows >2 header controls simultaneously
- [ ] Settings reachable from Manage tab on mobile (not header gear)

**Actions:**
1. Remove `showBackOffice` and `showSettings` props from `AppHeader.vue`
2. Update `BackOfficePage.vue`: desktop redirect to `/products`
3. Add Settings row to mobile BackOfficePage
4. Fix all back-button hardcoded routes → `router.back()`
5. Update `SaleHistoryScreen.vue`: remove back button (it's a root tab)
6. Update `ProductsPage.vue`: back button → `router.back()`
7. Verify `AppBottomNav` hidden on POS and form screens
8. Verify `AppSidebar` hidden on POS screens

**Definition of Done:**
- [ ] Navigation audit: every screen has exactly one way to navigate
- [ ] No hardcoded `/home` or `/back-office` in back buttons
- [ ] Mobile: 4 bottom tabs work on all non-POS screens
- [ ] Desktop: sidebar active state correct on all pages
- [ ] Zero navigation-related console errors

**Dependencies:** TICKET-005
**Blocks:** None

---

## PHASE 4: AUDIT & DATA INTEGRITY
### Priority: P1 | Closes invariant gaps

---

### TICKET-007: Complete Audit Event Wiring
**Type:** Feature | **Estimated:** 1 sprint | **Assignee:** Backend Lead

**Problem:** Audit log spec defines 20 events, but subsequent specs (WAFI-100, WAFI-138, Installments, Cash Movements, Stock-Take) add new events not in original enum.

**Acceptance Criteria:**
- [ ] All 32+ audit event types defined in `audit.types.ts`
- [ ] Every financial mutation calls exactly one audit helper
- [ ] `useAuditLog.ts` has typed helper for every event type
- [ ] Failed audit writes surface error (not silently swallowed) for financial events
- [ ] Non-financial events (settings changes) can silently fail
- [ ] Audit log includes `staff_id`, `staff_name_snapshot`, `shop_id`, `timestamp`, `meta` JSON
- [ ] Audit log is append-only (no UPDATE/DELETE RLS policies)

**Actions:**
1. Extend `audit.types.ts` with missing events:
   - `sale.discount_applied`
   - `sale.discount_below_cost`
   - `receiving.created`
   - `installment_plan.created`
   - `installment_due.paid`
   - `installment_due.overdue`
   - `installment_plan.rescheduled`
   - `installment_plan.cancelled`
   - `stock_take.session_started`
   - `stock_take.session_completed`
   - `stock_take.session_cancelled`
   - `cash_movement.recorded`
   - `cash_movement.voided`
   - `operator.switched`
   - `staff_ledger.entry_added`
   - `staff_settlement.finalized`
   - `staff_settlement.paid`
2. Create `executeFinancialWrite()` wrapper (per WAFI-138 spec)
3. Wire audit calls into all composables:
   - `usePayment.ts` → `logSaleCompleted`
   - `useProducts.ts` → `logProductCreated/Updated/Deleted/PriceChanged`
   - `useExpenses.ts` → `logExpenseCreated/Deleted`
   - `useCustomers.ts` → `logCustomerCreated/Updated/Deleted`
   - `useCustomerPayments.ts` → `logCustomerPaymentRecorded`
   - `useStockAdjustments.ts` → `logStockAdjusted`
   - `useCashierShift.ts` → `logShiftOpened/Closed`
   - `useExchangeRate.ts` → `logExchangeRateChanged`
   - `useReceiptSettings.ts` → `logReceiptSettingsUpdated`
   - `useStaff.ts` → `logStaffCreated/Deactivated/PermissionsChanged`
   - `useReturns.ts` → `logReturnProcessed`
   - `useDiscounts.ts` (new) → `logDiscountApplied`
   - `useInstallmentPlans.ts` → `logInstallmentPlanCreated`
   - `useCashMovements.ts` → `logCashMovementRecorded`
   - `useStockTake.ts` → `logStockTakeSessionCompleted`
   - `useStaffLedger.ts` → `logStaffLedgerEntryAdded`
   - `useStaffSettlement.ts` → `logStaffSettlementFinalized`
4. Add RLS: audit log SELECT only by owner/manager
5. Add PowerSync schema entry for `audit_log`

**Definition of Done:**
- [ ] Every financial mutation has corresponding audit test
- [ ] `useAuditLog.test.ts` covers all 32+ event types
- [ ] Failed audit write blocks financial operation (for Tier-1 events)
- [ ] Audit log renders correctly in `/settings/audit-log` UI
- [ ] Performance: audit write adds <50ms to transaction

**Dependencies:** TICKET-001 (RLS required for audit security)
**Blocks:** TICKET-008

---

### TICKET-008: Data Source Tagging for Imported vs. Live Sales
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Backend Lead

**Problem:** Imported historical sales without per-sale cost/rate will silently poison Profit Report. No enforcement mechanism exists.

**Acceptance Criteria:**
- [ ] `sales` table has `data_source` enum column: `live` | `imported`
- [ ] `sale_line_items` has `data_source` column (inherits from parent sale)
- [ ] Default value: `live` for all new sales
- [ ] Bulk import sets `data_source = 'imported'`
- [ ] Profit Report queries filter: `WHERE data_source = 'live'` OR show explicit "estimated" warning
- [ ] Dashboard metrics use only `live` data by default
- [ ] Owner can toggle "Include imported data" in Reports (advanced setting)

**Actions:**
1. Migration: `ALTER TABLE sales ADD COLUMN data_source TEXT DEFAULT 'live'`
2. Migration: `ALTER TABLE sale_line_items ADD COLUMN data_source TEXT DEFAULT 'live'`
3. Update `usePayment.ts` `confirm()` to set `data_source = 'live'`
4. Update Excel import wizard to set `data_source = 'imported'`
5. Update `useDashboardMetrics.ts` to filter by `data_source`
6. Update `useProfitTrend.ts` to filter by `data_source`
7. Update `useSalesChart.ts` to filter by `data_source`
8. Add "Include imported data" toggle to Reports screen
9. Add visual indicator in Profit Report when imported data is included

**Definition of Done:**
- [ ] All new sales have `data_source = 'live'`
- [ ] Imported sales have `data_source = 'imported'`
- [ ] Profit Report shows only live data by default
- [ ] Unit test: imported sale excluded from profit calculation
- [ ] Unit test: toggle includes imported data when enabled
- [ ] No regression on existing sales (backward-compatible default)

**Dependencies:** TICKET-007
**Blocks:** None

---

## PHASE 5: CROSS-FEATURE HARDENING
### Priority: P2 | Production polish

---

### TICKET-009: Stock-Take + Active Sales Collision Handling
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Full-Stack Lead

**Problem:** Stock-take session freezes `expected_stock` at start, but sales during the session create variance that could be misread as theft.

**Acceptance Criteria:**
- [ ] Stock-take review screen shows "Sales during count" indicator
- [ ] Variance rows flagged with "⚠ Sale occurred during count" when `sales.created_at` overlaps session window
- [ ] Total shrinkage calculation excludes items with post-start sales (or shows adjusted figure)
- [ ] Owner can drill down to see which sales affected which items
- [ ] Session detail view shows timeline: count start → sales → count end

**Actions:**
1. Update `useStockTake.ts` to query `sales` table for overlapping `created_at` timestamps
2. Add `sales_during_session` computed to review screen
3. Add warning banner on review screen when sales occurred
4. Add "Adjusted variance" calculation: `variance + sales_qty_during_session`
5. Update `StockTakeReviewScreen.vue` with timeline visualization
6. Add filter: "Show only items with sales during count"

**Definition of Done:**
- [ ] Manual test: start count → ring sale → finish count → review shows warning
- [ ] Adjusted variance matches physical count expectation
- [ ] Timeline renders correctly in RTL
- [ ] No performance degradation on large catalogs (>1000 products)

**Dependencies:** TICKET-005 (design system), TICKET-007 (audit)
**Blocks:** None

---

### TICKET-010: Installment Plans + Returns Integration
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Full-Stack Lead

**Problem:** Partial returns on installment sales are out of scope, but the system must handle them gracefully rather than crashing or corrupting data.

**Acceptance Criteria:**
- [ ] Return sheet checks if original sale has active installment plan
- [ ] If plan exists: block partial return, show "Cancel plan first" message
- [ ] Owner can cancel plan from return flow (one-tap action)
- [ ] Plan cancellation: status → `cancelled`, remaining dues voided
- [ ] After cancellation: return proceeds normally
- [ ] Customer ledger balance updated to reflect cancellation
- [ ] Audit log records: `installment_plan.cancelled` + `return.processed`

**Actions:**
1. Update `useReturnSheet.ts` `load()` to check for `installment_plan` by `sale_id`
2. Add `hasActivePlan` computed to return sheet state
3. Add "Cancel plan and proceed" button (owner-only)
4. Create `cancelInstallmentPlan(planId)` in `useInstallmentPlans.ts`
5. Update return flow: if plan cancelled, continue with normal return
6. Update customer balance calculation to exclude cancelled plans
7. Wire audit events

**Definition of Done:**
- [ ] Manual test: create installment sale → attempt return → see block → cancel plan → complete return
- [ ] Customer balance correct after cancellation
- [ ] Audit log has both events
- [ ] No data corruption in `installment_due` table

**Dependencies:** TICKET-007 (audit)
**Blocks:** None

---

### TICKET-011: Discounts (WAFI-100) + Returns Net Price Refund
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Full-Stack Lead

**Problem:** Returns must refund net price (post-discount), not list price. This is flagged as "highest invariant-risk area" in WAFI-100 spec.

**Acceptance Criteria:**
- [ ] `useReturnSheet.ts` refunds `unitPriceUsd` (net price) not `listPriceUsd`
- [ ] Return receipt shows: "Original: $X | Discount: -$Y | Refund: $Z"
- [ ] Restock valuation uses net price (affects inventory value)
- [ ] If original sale had sale-level discount: prorated refund per line
- [ ] Audit log records net refund amount

**Actions:**
1. Audit `useReturnSheet.ts` to verify it reads `unitPriceUsd` (post-discount)
2. Add `originalListPriceUsd` to `return_line_items` schema (for reference)
3. Update return calculation: `refund = qty_returned * unitPriceUsd`
4. Add discount breakdown to return receipt
5. Update restock logic: `products.current_stock` increment only, no price change
6. Add test: return of discounted line refunds net price

**Definition of Done:**
- [ ] Unit test: $100 item with 10% discount → return refunds $90
- [ ] Unit test: sale-level $10 discount on 2 items → return refunds prorated $5
- [ ] Return receipt shows correct breakdown
- [ ] Inventory value unchanged by return (restock at cost, not sale price)

**Dependencies:** TICKET-007 (audit)
**Blocks:** None

---

### TICKET-012: WhatsApp Messaging Analytics Fix
**Type:** Bug Fix | **Estimated:** 0.25 sprint | **Assignee:** Frontend Lead

**Problem:** "Sent" events are logged optimistically when WhatsApp opens — no confirmation of actual send.

**Acceptance Criteria:**
- [ ] Event renamed from `whatsapp_sent` → `whatsapp_composed`
- [ ] All analytics dashboards updated to use `composed` (not `sent`)
- [ ] Documentation updated: "Composed = message drafted, not confirmed delivered"
- [ ] No KPI claims "delivery rate" without caveats
- [ ] Future: add `whatsapp_opened` event (user tapped send in WhatsApp) if technically possible

**Actions:**
1. Rename event in `whatsapp.ts`
2. Update all call sites in `useSendReceipt.ts`, `useSendStatement.ts`
3. Update analytics documentation
4. Update any dashboards using this metric
5. Add code comment explaining limitation

**Definition of Done:**
- [ ] Zero references to `whatsapp_sent` in codebase
- [ ] Analytics documentation reflects limitation
- [ ] Team briefed on metric semantics

**Dependencies:** None
**Blocks:** None

---

### TICKET-013: Cost Freshness Indicator
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Profit Report shows "missing cost" warning but no actionable signal for cost freshness.

**Acceptance Criteria:**
- [ ] New metric: `% of active catalog with cost_price_usd from receiving (vs. manual/default)`
- [ ] Shown on Profit Report as "Cost basis: X% fresh"
- [ ] Tooltip explains: "Fresh = cost updated via supplier receiving"
- [ ] Products with no cost flagged in product list
- [ ] Owner can filter product list by "Missing cost" or "Stale cost"

**Actions:**
1. Add `cost_source` column to `products`: `manual` | `receiving` | `default` | `null`
2. Update `useReceivingSheet.ts` to set `cost_source = 'receiving'` when cost updated
3. Update `useProductForm.ts` to set `cost_source = 'manual'` on edit
4. Add `useCostFreshness.ts` composable
5. Update Profit Report with freshness indicator
6. Update Product List with cost status filter

**Definition of Done:**
- [ ] Freshness metric accurate to ±1%
- [ ] Visual indicator on Profit Report
- [ ] Filter works on product list
- [ ] No performance regression on product list load

**Dependencies:** TICKET-005 (design system)
**Blocks:** None

---

### TICKET-014: Cross-Epic Edge-Case Review Process
**Type:** Process | **Estimated:** Ongoing | **Assignee:** Product Manager + Tech Lead

**Problem:** Feature interactions (Stock-Take+Sales, Installment+Returns, Remote Signout+In-Flight Payments) only surface during synthesis, not individual spec review.

**Acceptance Criteria:**
- [ ] Mandatory checklist for every new feature spec
- [ ] Checklist includes: "Which existing features does this interact with?"
- [ ] Cross-epic review meeting before implementation starts
- [ ] Documented decision on each identified edge case
- [ ] Ripple effect matrix updated for each feature

**Actions:**
1. Create `FEATURE_REVIEW_CHECKLIST.md`:
   - [ ] Tables written (list them)
   - [ ] Tables read (list them)
   - [ ] Composables affected (list them)
   - [ ] Stores affected (list them)
   - [ ] Reports affected (list them)
   - [ ] Dashboard metrics affected (list them)
   - [ ] Audit events needed (list them)
   - [ ] Inventory impact (describe)
   - [ ] Cash drawer impact (describe)
   - [ ] Customer ledger impact (describe)
   - [ ] Shift calculations impact (describe)
   - [ ] Profit calculations impact (describe)
   - [ ] Offline behavior (describe)
   - [ ] Sync behavior (describe)
   - [ ] Cross-feature interactions (list them)
2. Schedule 30-min cross-epic review before each feature kickoff
3. Create `RIPPLE_EFFECT_MATRIX.md` (living document)
4. Assign "integration owner" for each epic pair

**Definition of Done:**
- [ ] Checklist used for last 3 features
- [ ] Cross-epic review minutes documented
- [ ] Zero unhandled edge cases in last 2 sprints
- [ ] Team trained on process

**Dependencies:** None
**Blocks:** None

---

### TICKET-015: Anomaly Detection Automation
**Type:** Feature | **Estimated:** 1 sprint | **Assignee:** Full-Stack Lead

**Problem:** Owner must manually review all data. Automated anomaly detection can surface issues proactively.

**Acceptance Criteria:**
- [ ] Cash variance anomaly: 2+ shifts in row with |variance| > 5%
- [ ] Discount abuse: Cashier discounts > cap frequency > 3 per shift
- [ ] Below-cost sale: Any sale where net price < unit_cost_usd
- [ ] Chronic shrinkage: Same SKU with negative variance in 2+ stock-takes
- [ ] Large refund: Return > $500 or > 50% of daily revenue
- [ ] Each anomaly shows as banner on Home screen
- [ ] Tapping banner navigates to relevant detail

**Actions:**
1. Create `useAnomalyDetection.ts` composable
2. Define anomaly rules with configurable thresholds
3. Add `anomalies` table: `type`, `severity`, `message`, `resolved_at`
4. Run detection on: shift close, stock-take complete, sale confirm, return confirm
5. Add `AnomalyBanner.vue` to Home screen
6. Add "Dismiss" and "Investigate" actions per anomaly
7. Wire audit events for anomaly creation/dismissal

**Definition of Done:**
- [ ] All 5 anomaly types trigger correctly in manual test
- [ ] Banner renders correctly on mobile and desktop
- [ ] Dismissal persists (anomaly marked resolved)
- [ ] No false positives in normal operation
- [ ] Performance: detection adds <100ms to triggering operation

**Dependencies:** TICKET-001 (RLS), TICKET-007 (audit)
**Blocks:** None

---

### TICKET-016: Cash Movement + Profit Report Exclusion Callout
**Type:** Bug Fix | **Estimated:** 0.25 sprint | **Assignee:** Frontend Lead

**Problem:** Cash movements (pay-in/pay-out/drop) affect drawer but not profit. No explicit callout in Profit Report.

**Acceptance Criteria:**
- [ ] Profit Report shows footnote: "Excludes cash drawer movements (pay-ins/pay-outs)"
- [ ] Cash drawer detail screen shows link to "View cash movements"
- [ ] Cash movements list accessible from shift detail
- [ ] No confusion between "expenses" and "cash movements"

**Actions:**
1. Add footnote to Profit Report breakdown section
2. Add link from CashDrawerSheet to CashMovementsList
3. Update CashMovementsList to show in shift context
4. Add info tooltip explaining difference

**Definition of Done:**
- [ ] Footnote visible on Profit Report
- [ ] Navigation works: Profit Report → Cash Movements
- [ ] User test: owner understands difference after seeing UI

**Dependencies:** TICKET-005 (design system)
**Blocks:** None

---

### TICKET-017: Unified "Money Owed" View (Credit + Installments)
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Credit ledger and installment plans both represent money owed. No unified view.

**Acceptance Criteria:**
- [ ] Customer detail screen shows combined "Total Owed" = credit balance + active installment remaining
- [ ] Breakdown: "On account: $X | Installments: $Y"
- [ ] Dashboard "Customers owe you" card includes both
- [ ] Aging buckets: 0-30 days, 30-60 days, 60-90 days, 90+ days
- [ ] Tap through to customer detail from dashboard

**Actions:**
1. Update `useCustomerBalance.ts` to include installment remaining
2. Update `CustomerDetailPage.vue` with combined view
3. Update home dashboard card query
4. Add aging calculation based on `due_date` (installments) and `created_at` (credit sales)
5. Add aging visualization (simple bar or table)

**Definition of Done:**
- [ ] Combined total matches individual components
- [ ] Aging buckets accurate
- [ ] Works offline (local calculation)
- [ ] RTL verified

**Dependencies:** TICKET-005 (design system)
**Blocks:** None

---

### TICKET-018: Staff Performance Dashboard
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Z-report shows per-operator sales, but no unified "what did this person cost me" view.

**Acceptance Criteria:**
- [ ] New screen: `/staff/:id/performance`
- [ ] Shows: sales count, revenue, discounts given, returns processed
- [ ] Shows: advances, penalties, settlements from staff ledger
- [ ] Net: "Revenue generated - Cost to employ"
- [ ] Period selector: This Week / This Month / This Quarter
- [ ] Owner-only access

**Actions:**
1. Create `StaffPerformanceScreen.vue`
2. Create `useStaffPerformance.ts` composable
3. Query: `cashier_shifts` (sales) + `staff_ledger` (costs) + `sale_line_items` (discounts)
4. Calculate net contribution per staff
5. Add route `/staff/:id/performance`
6. Add link from Staff List

**Definition of Done:**
- [ ] Numbers match Z-report + staff ledger
- [ ] Period changes update all metrics
- [ ] Owner-only access enforced (client + server)
- [ ] Works offline

**Dependencies:** TICKET-001 (RLS), TICKET-007 (audit)
**Blocks:** None

---

### TICKET-019: PWA Offline Banner Reconciliation
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Two competing "offline" signals: PowerSync sync status vs. true network status. Confuses users.

**Acceptance Criteria:**
- [ ] Single unified offline indicator
- [ ] Shows: "No internet" (network down) OR "Sync pending" (network up, sync queued)
- [ ] Never shows "offline" when app is working normally in local-only mode
- [ ] Color-coded: red = no internet, amber = sync pending, green = synced
- [ ] Tap for detail: pending count, last sync time, manual sync trigger

**Actions:**
1. Update `useOnlineStatus.ts` + `useSync.ts` to expose unified state
2. Create `useConnectionStatus.ts` composable:
   - `state`: 'online-synced' | 'online-pending' | 'offline'
   - `pendingCount`
   - `lastSyncAt`
3. Replace all existing sync indicators with unified component
4. Update `SyncBadge.vue` to use unified state
5. Remove `StalenessBar.vue` (absorbed into unified indicator)

**Definition of Done:**
- [ ] Manual test: airplane mode → shows "No internet" (red)
- [ ] Manual test: online, pending sales → shows "Sync pending" (amber)
- [ ] Manual test: online, all synced → shows "Synced" (green)
- [ ] Local-only mode (no PowerSync URL) → shows "Local mode" (blue), not "offline"
- [ ] Zero duplicate/conflicting offline messages

**Dependencies:** None
**Blocks:** None

---

### TICKET-020: Performance & Load Testing
**Type:** Technical Debt | **Estimated:** 0.5 sprint | **Assignee:** QA Lead

**Problem:** No performance benchmarks. Product must work on cheap Android tablets.

**Acceptance Criteria:**
- [ ] POS screen loads in <2s on mid-range Android
- [ ] Product list loads 1000 products in <500ms
- [ ] Sale confirmation completes in <1s (local write)
- [ ] Sync of 100 pending sales completes in <30s on 3G
- [ ] App bundle size <200KB JS (per PRINCIPLES.md)
- [ ] Memory usage <100MB on device

**Actions:**
1. Set up Lighthouse CI for bundle size monitoring
2. Create performance test suite:
   - `pos-load-time.test.ts`
   - `product-list-load.test.ts`
   - `sale-confirm-speed.test.ts`
   - `sync-throughput.test.ts`
3. Test on actual cheap Android device (or emulator with throttling)
4. Profile bundle: identify largest dependencies
5. Optimize: code splitting, lazy loading, image compression
6. Document performance budget in `PERFORMANCE.md`

**Definition of Done:**
- [ ] All benchmarks pass on target hardware
- [ ] Bundle size tracked in CI
- [ ] Performance regression test runs on every PR
- [ ] Documented performance budget

**Dependencies:** TICKET-005 (design system freeze)
**Blocks:** None

---

### TICKET-021: Documentation & Runbook
**Type:** Process | **Estimated:** 0.5 sprint | **Assignee:** Tech Lead

**Problem:** 32 specs in 60 days with no central documentation. Onboarding new developers is impossible.

**Acceptance Criteria:**
- [ ] `ARCHITECTURE.md`: system overview, data flow, state ownership
- [ ] `DATA_MODEL.md`: all tables, columns, relationships
- [ ] `API_CONTRACTS.md`: composable interfaces, store contracts
- [ ] `DEPLOYMENT.md`: build, release, rollback procedures
- [ ] `SECURITY.md`: RLS policies, permission matrix, threat model
- [ ] `OFFLINE_BEHAVIOR.md`: sync rules, conflict resolution, recovery
- [ ] `TROUBLESHOOTING.md`: common issues, debug procedures
- [ ] All docs in `/docs/` folder, versioned with code

**Actions:**
1. Consolidate all specs into structured documentation
2. Create architecture diagrams (data flow, component hierarchy)
3. Document every composable interface
4. Create permission matrix spreadsheet
5. Document offline sync behavior with flow diagrams
6. Create runbook for common operations

**Definition of Done:**
- [ ] New developer can set up and understand system in <1 day using docs
- [ ] All docs reviewed by at least 2 team members
- [ ] Docs linked from README

**Dependencies:** None
**Blocks:** None

---

### TICKET-022: Production Deployment Checklist
**Type:** Process | **Estimated:** 0.25 sprint | **Assignee:** Tech Lead + DevOps

**Problem:** No defined path from "code complete" to "live customers."

**Acceptance Criteria:**
- [ ] Pre-deployment security audit completed
- [ ] Database migrations tested on staging clone
- [ ] RLS policies verified with penetration test
- [ ] Backup and recovery procedure documented
- [ ] Monitoring and alerting configured
- [ ] Rollback plan documented and tested
- [ ] Customer data isolation verified
- [ ] Performance benchmarks pass

**Actions:**
1. Create `DEPLOYMENT_CHECKLIST.md`
2. Set up staging environment mirroring production
3. Configure monitoring: Sentry for errors, Supabase for DB metrics
4. Set up alerting: sync failures, RLS violations, performance degradation
5. Test backup/restore procedure
6. Document rollback steps
7. Schedule go/no-go review meeting

**Definition of Done:**
- [ ] Checklist complete and reviewed
- [ ] Staging environment operational
- [ ] Monitoring dashboard live
- [ ] Team briefed on rollback procedure

**Dependencies:** All previous tickets
**Blocks:** None

---

### TICKET-023: Post-Launch Monitoring & Feedback Loop
**Type:** Process | **Estimated:** Ongoing | **Assignee:** Product Manager

**Problem:** No defined process for capturing production issues and iterating.

**Acceptance Criteria:**
- [ ] Error tracking: Sentry configured with release tagging
- [ ] Analytics: Mixpanel/Amplitude for user behavior (optional, privacy-compliant)
- [ ] Feedback channel: In-app "Report issue" button
- [ ] Weekly review: error rates, sync failures, user feedback
- [ ] Monthly review: feature usage, retention, NPS
- [ ] Rapid response: <24h for critical bugs, <1 week for P1

**Actions:**
1. Configure Sentry with environment tagging
2. Add `reportIssue()` composable (sends to support channel)
3. Create `#wafi-alerts` Slack channel
4. Set up weekly metrics review meeting
5. Create bug triage process
6. Define severity levels and SLAs

**Definition of Done:**
- [ ] Sentry receiving errors from staging
- [ ] Alert channel active
- [ ] Team trained on triage process
- [ ] First weekly review completed

**Dependencies:** TICKET-022
**Blocks:** None

---

## IMPLEMENTATION TIMELINE

```
Week 1-2:  TICKET-001 (Server-Side Role Enforcement)
            TICKET-002 (Real Auth) — parallel
            TICKET-005 (Design System Freeze) — parallel

Week 3-4:  TICKET-003 (Device Registration)
            TICKET-004 (Owner Bootstrap)
            TICKET-006 (Navigation Cleanup)
            TICKET-007 (Audit Event Wiring)

Week 5:    TICKET-008 (Data Source Tagging)
            TICKET-009 (Stock-Take Collision)
            TICKET-010 (Installment + Returns)
            TICKET-011 (Discounts + Returns)

Week 6:    TICKET-012 (WhatsApp Analytics Fix)
            TICKET-013 (Cost Freshness)
            TICKET-014 (Cross-Epic Review Process)
            TICKET-015 (Anomaly Detection)

Week 7:    TICKET-016 (Cash Movement Callout)
            TICKET-017 (Unified Money Owed)
            TICKET-018 (Staff Performance)
            TICKET-019 (Offline Banner Reconciliation)

Week 8:    TICKET-020 (Performance Testing)
            TICKET-021 (Documentation)
            TICKET-022 (Deployment Checklist)
            TICKET-023 (Monitoring Setup)
```

**Total Estimated Duration: 8 weeks (2 months)**
**Critical Path: TICKET-001 → TICKET-002 → TICKET-003 → TICKET-004**

---

## RISK REGISTER

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Server-side role enforcement breaks existing sync | High | Critical | Extensive testing on staging; gradual rollout |
| Design system consolidation causes UI regressions | High | Medium | Visual regression tests; component library |
| Real auth migration loses existing customer data | Low | Critical | Backup before migration; idempotent scripts |
| Performance on cheap Android unacceptable | Medium | High | Early testing; performance budget; optimization sprint |
| Team velocity drops during security work | Medium | Medium | Parallel tracks; clear priorities |
| Cross-epic edge cases missed despite process | Medium | High | Mandatory review; integration owner assignment |

---

## GLOBAL DEFINITION OF DONE

For ANY ticket to be considered complete:

- [ ] All acceptance criteria met
- [ ] Unit tests pass (Vitest coverage >80% for new code)
- [ ] Integration tests pass
- [ ] Manual QA on target device (cheap Android phone)
- [ ] RTL verified
- [ ] Dark mode verified
- [ ] Offline behavior verified
- [ ] Sync behavior verified
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Bundle size impact documented
- [ ] Security review (for financial/auth features)
- [ ] Documentation updated
- [ ] PR reviewed by 2+ team members
- [ ] CHANGELOG.md updated

---

## ITEMS I ADDED (NOT IN ORIGINAL SPECS)

Based on my review of all 32 specs, here are items NOT originally ticketed that I added:

| # | Ticket | Why Added |
|---|---|---|
| 1 | TICKET-001: Server-Side Role Enforcement | Specs mention "planned, post-trip" but never ticket it. This is a live security vulnerability. |
| 2 | TICKET-002: Real Authentication | Specs describe the design but never create an implementation ticket. Blocks all scaling. |
| 3 | TICKET-003: Device Registration | Hardcoded device identity is a scaling blocker. Mentioned but not ticketed. |
| 4 | TICKET-005: Design System Freeze | Four competing redesigns = massive technical debt. No spec addresses consolidation. |
| 5 | TICKET-008: Data Source Tagging | Prevents imported data from poisoning Profit Report. Specs identify risk but propose no guard. |
| 6 | TICKET-009: Stock-Take + Sales Collision | Real operational issue found only in synthesis, not individual specs. |
| 7 | TICKET-010: Installment + Returns Integration | Explicitly "out of scope" in Installment spec, but system must handle gracefully. |
| 8 | TICKET-011: Discounts + Returns Net Price | Flagged as "highest invariant-risk area" in WAFI-100 but not fully scoped. |
| 9 | TICKET-012: WhatsApp Analytics Fix | Blind spot acknowledged in spec but never ticketed for remediation. |
| 10 | TICKET-014: Cross-Epic Review Process | No process exists to catch feature interactions before they ship. |
| 11 | TICKET-015: Anomaly Detection | Uses existing data to deliver immediate owner value. Not in any spec. |
| 12 | TICKET-017: Unified Money Owed View | Natural integration of Credit + Installments. Not in any spec. |
| 13 | TICKET-018: Staff Performance Dashboard | Natural integration of Z-report + Staff Ledger. Not in any spec. |
| 14 | TICKET-019: Offline Banner Reconciliation | Acknowledged as "separate topic" in PWA spec but never ticketed. |
| 15 | TICKET-020: Performance Testing | PRINCIPLES.md mentions <200KB bundle but no testing plan exists. |
| 16 | TICKET-021: Documentation | 32 specs with no central architecture documentation. |
| 17 | TICKET-022: Deployment Checklist | No defined path from "code complete" to "live customers." |
| 18 | TICKET-023: Post-Launch Monitoring | No feedback loop defined for production issues. |
