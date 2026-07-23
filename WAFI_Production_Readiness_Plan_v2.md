# WAFI Production Readiness & System Architecture Plan
## Version: 2.0 | Date: 2026-07-20 | Status: APPROVED FOR EXECUTION

---

## EXECUTIVE SUMMARY

This plan addresses critical production gaps AND long-term system architecture.
It is organized into **6 phases, 33 tickets**, prioritized by dependency order.

| Phase | Priority | Tickets | Goal | Duration |
|---|---|---|---|---|
| 1: Security Foundation | P0 | 001–003 | Auth, RLS, device identity | 3–4 weeks |
| 2: Auth & Onboarding | P1 | 004 | Multi-tenancy unlock | 1 week |
| 3: Design System | P1 | 005–006 | Stop technical debt | 1.5 weeks |
| 4: Audit & Data Integrity | P1 | 007–008 | Close invariant gaps | 1 week |
| 5: Cross-Feature Hardening | P2 | 009–023 | Production polish | 3 weeks |
| 6: Product System Architecture | P1 | 024–033 | Event-first architecture | 4–6 weeks |

**Total Estimated Duration: 14–16 weeks (3.5–4 months)**
**Critical Path: 001 → 002 → 003 → 004 → 024 (Event Architecture)**

> **Note from Product Lead:** Automation is NOT a future nice-to-have. It should become one of WAFI's biggest differentiators. Phase 6 elevates automation from "anomaly detection" to "systematic event-driven intelligence."

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
**Blocks:** All tickets except 005, 006, 014, 021

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
2. Delete/deprecate competing systems
3. Consolidate `style.css` into unified tokens
4. Update `App.vue` to use unified layout
5. Remove `BackOfficePage.vue` tile launcher
6. Update all navigation components
7. Create `DESIGN_SYSTEM.md`

**Definition of Done:**
- [ ] `npm run build` zero unused CSS warnings
- [ ] Visual regression test on 10 core screens
- [ ] RTL and dark mode pass all screens
- [ ] Team sign-off: no redesigns until v2

**Dependencies:** None (can parallel with Phase 1)
**Blocks:** TICKET-006, TICKET-007, TICKET-008

---

### TICKET-006: Navigation System Cleanup
**Type:** Refactor | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Multiple navigation systems coexist.

**Acceptance Criteria:**
- [ ] Single model: bottom tabs (mobile) + sidebar (desktop)
- [ ] `AppHeader` shows only title + back button + exchange rate
- [ ] `BackOfficePage` redirects to `/products` on desktop
- [ ] All routes use `router.back()` consistently
- [ ] Settings reachable from Manage tab on mobile

**Actions:**
1. Remove nav props from `AppHeader.vue`
2. Update `BackOfficePage.vue` redirect logic
3. Fix all hardcoded back-button routes
4. Verify `AppBottomNav` / `AppSidebar` visibility rules

**Definition of Done:**
- [ ] Every screen has exactly one navigation path
- [ ] Zero navigation console errors

**Dependencies:** TICKET-005
**Blocks:** None

---

## PHASE 4: AUDIT & DATA INTEGRITY
### Priority: P1 | Closes invariant gaps

---

### TICKET-007: Complete Audit Event Wiring
**Type:** Feature | **Estimated:** 1 sprint | **Assignee:** Backend Lead

**Problem:** Audit log defines 20 events; subsequent specs add 12+ more not in original enum.

**Acceptance Criteria:**
- [ ] All 32+ audit event types defined in `audit.types.ts`
- [ ] Every financial mutation calls exactly one audit helper
- [ ] Failed audit writes surface error for financial events
- [ ] Audit log append-only (no UPDATE/DELETE RLS)

**Actions:**
1. Extend `audit.types.ts` with 17 missing events
2. Create `executeFinancialWrite()` wrapper
3. Wire audit into all 17 composables
4. Add RLS: SELECT only by owner/manager
5. Add PowerSync schema for `audit_log`

**Definition of Done:**
- [ ] All financial mutations have audit tests
- [ ] Failed audit write blocks Tier-1 financial operations
- [ ] Performance: <50ms overhead per transaction

**Dependencies:** TICKET-001 (RLS)
**Blocks:** TICKET-008, TICKET-010, TICKET-011, TICKET-015, TICKET-018, TICKET-024

---

### TICKET-008: Data Source Tagging for Imported vs. Live Sales
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Backend Lead

**Problem:** Imported historical sales without per-sale cost/rate silently poison Profit Report.

**Acceptance Criteria:**
- [ ] `sales` and `sale_line_items` have `data_source` enum: `live` | `imported`
- [ ] Default: `live` for new sales
- [ ] Bulk import sets `data_source = 'imported'`
- [ ] Profit Report filters to `live` by default
- [ ] Owner can toggle "Include imported data"

**Actions:**
1. Migration: add `data_source` columns
2. Update `usePayment.ts` to set `live`
3. Update Excel import to set `imported`
4. Update all report queries with filter
5. Add toggle UI in Reports

**Definition of Done:**
- [ ] Unit test: imported sale excluded from profit
- [ ] Toggle works; backward compatible

**Dependencies:** TICKET-007
**Blocks:** None

---

## PHASE 5: CROSS-FEATURE HARDENING
### Priority: P2 | Production polish

---

### TICKET-009: Stock-Take + Active Sales Collision Handling
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Full-Stack Lead

**Problem:** Sales during stock-take create variance misread as theft.

**Acceptance Criteria:**
- [ ] Review screen shows "Sales during count" indicator
- [ ] Variance rows flagged when sales overlap session window
- [ ] Adjusted variance calculation: `variance + sales_qty_during_session`
- [ ] Timeline visualization: count start → sales → count end

**Actions:**
1. Query `sales` for overlapping timestamps
2. Add warning banner on review screen
3. Add adjusted variance calculation
4. Add timeline visualization

**Definition of Done:**
- [ ] Manual test: count → sale → count → review shows warning
- [ ] Adjusted variance matches physical expectation

**Dependencies:** TICKET-005, TICKET-007
**Blocks:** None

---

### TICKET-010: Installment Plans + Returns Integration
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Full-Stack Lead

**Problem:** Partial returns on installment sales are "out of scope" but system must handle gracefully.

**Acceptance Criteria:**
- [ ] Return sheet detects active installment plan
- [ ] Blocks partial return with "Cancel plan first" message
- [ ] Owner can cancel plan from return flow
- [ ] Plan cancellation voids remaining dues
- [ ] Audit log records both events

**Actions:**
1. Check for `installment_plan` by `sale_id`
2. Add cancel-and-proceed button (owner-only)
3. Create `cancelInstallmentPlan()`
4. Update customer balance
5. Wire audit events

**Definition of Done:**
- [ ] Manual test: installment sale → return → cancel → complete
- [ ] No data corruption in `installment_due`

**Dependencies:** TICKET-007
**Blocks:** None

---

### TICKET-011: Discounts (WAFI-100) + Returns Net Price Refund
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Full-Stack Lead

**Problem:** Returns must refund net price (post-discount), not list price.

**Acceptance Criteria:**
- [ ] `useReturnSheet.ts` refunds `unitPriceUsd` (net price)
- [ ] Return receipt shows: "Original: $X | Discount: -$Y | Refund: $Z"
- [ ] Sale-level discounts prorated per line
- [ ] Audit log records net refund

**Actions:**
1. Verify `unitPriceUsd` used in return calculation
2. Add `originalListPriceUsd` to schema
3. Add discount breakdown to receipt
4. Add tests for net price refund

**Definition of Done:**
- [ ] Unit test: $100 item, 10% discount → refunds $90
- [ ] Unit test: sale-level discount → prorated refund

**Dependencies:** TICKET-007
**Blocks:** None

---

### TICKET-012: WhatsApp Messaging Analytics Fix
**Type:** Bug Fix | **Estimated:** 0.25 sprint | **Assignee:** Frontend Lead

**Problem:** "Sent" events logged optimistically when WhatsApp opens — no confirmation of actual send.

**Acceptance Criteria:**
- [ ] Event renamed: `whatsapp_sent` → `whatsapp_composed`
- [ ] All dashboards updated
- [ ] Documentation: "Composed = drafted, not confirmed delivered"
- [ ] No KPI claims "delivery rate"

**Actions:**
1. Rename event in `whatsapp.ts`
2. Update all call sites
3. Update analytics docs
4. Add code comments

**Definition of Done:**
- [ ] Zero `whatsapp_sent` references in codebase
- [ ] Team briefed on metric semantics

**Dependencies:** None
**Blocks:** None

---

### TICKET-013: Cost Freshness Indicator
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Profit Report warns about missing cost but has no actionable freshness signal.

**Acceptance Criteria:**
- [ ] Metric: `% catalog with cost from receiving vs. manual/default`
- [ ] Shown on Profit Report: "Cost basis: X% fresh"
- [ ] Tooltip: "Fresh = cost updated via supplier receiving"
- [ ] Product list filter: "Missing cost" / "Stale cost"

**Actions:**
1. Add `cost_source` column to `products`
2. Update receiving and product form to set source
3. Create `useCostFreshness.ts`
4. Update Profit Report and Product List

**Definition of Done:**
- [ ] Freshness metric accurate to ±1%
- [ ] Filter works; no performance regression

**Dependencies:** TICKET-005
**Blocks:** None

---

### TICKET-014: Cross-Epic Edge-Case Review Process
**Type:** Process | **Estimated:** Ongoing | **Assignee:** Product Manager + Tech Lead

**Problem:** Feature interactions only surface during synthesis, not individual spec review.

**Acceptance Criteria:**
- [ ] Mandatory checklist for every new feature spec
- [ ] Cross-epic review meeting before implementation
- [ ] Documented decisions on each edge case
- [ ] Ripple effect matrix updated per feature

**Actions:**
1. Create `FEATURE_REVIEW_CHECKLIST.md` (15 items)
2. Schedule 30-min review before each kickoff
3. Create `RIPPLE_EFFECT_MATRIX.md` (living doc)
4. Assign integration owner per epic pair

**Definition of Done:**
- [ ] Checklist used for last 3 features
- [ ] Zero unhandled edge cases in last 2 sprints

**Dependencies:** None
**Blocks:** None

---

### TICKET-015: Anomaly Detection Automation
**Type:** Feature | **Estimated:** 1 sprint | **Assignee:** Full-Stack Lead

**Problem:** Owner must manually review all data.

**Acceptance Criteria:**
- [ ] Cash variance: 2+ shifts with |variance| > 5%
- [ ] Discount abuse: >3 discounts above cap per shift
- [ ] Below-cost sale: net price < unit_cost_usd
- [ ] Chronic shrinkage: same SKU negative in 2+ stock-takes
- [ ] Large refund: >$500 or >50% daily revenue
- [ ] Banner on Home screen per anomaly
- [ ] Tap navigates to relevant detail

**Actions:**
1. Create `useAnomalyDetection.ts`
2. Define rules with configurable thresholds
3. Add `anomalies` table
4. Run detection on: shift close, stock-take, sale, return
5. Add `AnomalyBanner.vue` to Home
6. Wire audit events

**Definition of Done:**
- [ ] All 5 types trigger in manual test
- [ ] No false positives in normal operation
- [ ] Performance: <100ms overhead

**Dependencies:** TICKET-001, TICKET-007
**Blocks:** None

---

### TICKET-016: Cash Movement + Profit Report Exclusion Callout
**Type:** Bug Fix | **Estimated:** 0.25 sprint | **Assignee:** Frontend Lead

**Acceptance Criteria:**
- [ ] Profit Report footnote: "Excludes cash drawer movements"
- [ ] Link from CashDrawerSheet to CashMovementsList
- [ ] Tooltip explaining expenses vs. cash movements

**Actions:**
1. Add footnote to Profit Report
2. Add navigation link
3. Add info tooltip

**Definition of Done:**
- [ ] Footnote visible; navigation works
- [ ] User test: owner understands difference

**Dependencies:** TICKET-005
**Blocks:** None

---

### TICKET-017: Unified "Money Owed" View (Credit + Installments)
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Acceptance Criteria:**
- [ ] Customer detail: "Total Owed" = credit balance + installment remaining
- [ ] Breakdown: "On account: $X | Installments: $Y"
- [ ] Dashboard card includes both
- [ ] Aging buckets: 0-30, 30-60, 60-90, 90+ days

**Actions:**
1. Update `useCustomerBalance.ts` with installments
2. Update `CustomerDetailPage.vue`
3. Update dashboard query
4. Add aging calculation and visualization

**Definition of Done:**
- [ ] Combined total matches components
- [ ] Works offline; RTL verified

**Dependencies:** TICKET-005
**Blocks:** None

---

### TICKET-018: Staff Performance Dashboard
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Acceptance Criteria:**
- [ ] Screen: `/staff/:id/performance`
- [ ] Metrics: sales count, revenue, discounts, returns
- [ ] Costs: advances, penalties, settlements
- [ ] Net: "Revenue generated - Cost to employ"
- [ ] Period selector: Week / Month / Quarter
- [ ] Owner-only access

**Actions:**
1. Create `StaffPerformanceScreen.vue`
2. Create `useStaffPerformance.ts`
3. Query shifts + ledger + line items
4. Calculate net contribution
5. Add route and link from Staff List

**Definition of Done:**
- [ ] Numbers match Z-report + staff ledger
- [ ] Owner-only access enforced (client + server)

**Dependencies:** TICKET-001, TICKET-007
**Blocks:** None

---

### TICKET-019: PWA Offline Banner Reconciliation
**Type:** Bug Fix | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** Two competing "offline" signals confuse users.

**Acceptance Criteria:**
- [ ] Single unified indicator
- [ ] States: "No internet" (red) | "Sync pending" (amber) | "Synced" (green) | "Local mode" (blue)
- [ ] Tap for detail: pending count, last sync, manual trigger
- [ ] Never shows "offline" in normal local-only mode

**Actions:**
1. Create `useConnectionStatus.ts` composable
2. Replace all sync indicators with unified component
3. Remove `StalenessBar.vue`

**Definition of Done:**
- [ ] All 4 states tested manually
- [ ] Zero duplicate/conflicting messages

**Dependencies:** None
**Blocks:** None

---

### TICKET-020: Performance & Load Testing
**Type:** Technical Debt | **Estimated:** 0.5 sprint | **Assignee:** QA Lead

**Acceptance Criteria:**
- [ ] POS loads <2s on mid-range Android
- [ ] 1000 products load <500ms
- [ ] Sale confirm <1s (local write)
- [ ] 100-sale sync <30s on 3G
- [ ] Bundle <200KB JS
- [ ] Memory <100MB

**Actions:**
1. Set up Lighthouse CI
2. Create performance test suite
3. Test on cheap Android device
4. Profile and optimize bundle
5. Document performance budget

**Definition of Done:**
- [ ] All benchmarks pass
- [ ] Bundle size tracked in CI
- [ ] Performance regression test on every PR

**Dependencies:** TICKET-005
**Blocks:** None

---

### TICKET-021: Documentation & Runbook
**Type:** Process | **Estimated:** 0.5 sprint | **Assignee:** Tech Lead

**Acceptance Criteria:**
- [ ] `ARCHITECTURE.md`: system overview, data flow
- [ ] `DATA_MODEL.md`: tables, columns, relationships
- [ ] `API_CONTRACTS.md`: composable interfaces
- [ ] `DEPLOYMENT.md`: build, release, rollback
- [ ] `SECURITY.md`: RLS, permission matrix, threat model
- [ ] `OFFLINE_BEHAVIOR.md`: sync rules, conflict resolution
- [ ] `TROUBLESHOOTING.md`: common issues, debug
- [ ] All docs in `/docs/`, versioned with code

**Actions:**
1. Consolidate specs into structured docs
2. Create architecture diagrams
3. Document every composable interface
4. Create permission matrix
5. Document offline behavior with flow diagrams

**Definition of Done:**
- [ ] New developer sets up in <1 day using docs
- [ ] All docs reviewed by 2+ team members

**Dependencies:** None
**Blocks:** None

---

### TICKET-022: Production Deployment Checklist
**Type:** Process | **Estimated:** 0.25 sprint | **Assignee:** Tech Lead + DevOps

**Acceptance Criteria:**
- [ ] Security audit completed
- [ ] Migrations tested on staging clone
- [ ] RLS penetration test passed
- [ ] Backup/recovery documented and tested
- [ ] Monitoring and alerting configured
- [ ] Rollback plan documented and tested
- [ ] Customer data isolation verified
- [ ] Performance benchmarks pass

**Actions:**
1. Create `DEPLOYMENT_CHECKLIST.md`
2. Set up staging environment
3. Configure Sentry + Supabase monitoring
4. Set up alerting
5. Test backup/restore
6. Document rollback steps

**Definition of Done:**
- [ ] Checklist complete; staging operational
- [ ] Team briefed on rollback

**Dependencies:** All previous tickets
**Blocks:** None

---

### TICKET-023: Post-Launch Monitoring & Feedback Loop
**Type:** Process | **Estimated:** Ongoing | **Assignee:** Product Manager

**Acceptance Criteria:**
- [ ] Sentry configured with release tagging
- [ ] In-app "Report issue" button
- [ ] Weekly review: errors, sync failures, feedback
- [ ] Monthly review: feature usage, retention, NPS
- [ ] Rapid response: <24h critical, <1 week P1

**Actions:**
1. Configure Sentry
2. Add `reportIssue()` composable
3. Create `#wafi-alerts` channel
4. Set up weekly metrics review
5. Create bug triage process
6. Define severity levels and SLAs

**Definition of Done:**
- [ ] Sentry receiving staging errors
- [ ] Alert channel active
- [ ] First weekly review completed

**Dependencies:** TICKET-022
**Blocks:** None

---

## PHASE 6: PRODUCT SYSTEM ARCHITECTURE
### Priority: P1 | Event-first architecture for scale

> **Product Lead Note:** This phase transforms WAFI from "feature-first" to "event-first." Every feature becomes a producer and consumer of business events. This is how ERPs become maintainable at scale. Automation is NOT a future nice-to-have — it is a core differentiator.

---

### TICKET-024: Product Event Architecture
**Type:** Epic | **Estimated:** 2 sprints | **Assignee:** Tech Lead + Backend Lead

**Problem:** Features update each other directly (`usePayment.ts` calls `useAuditLog.ts`). This creates tight coupling and makes new features hard to add.

**Vision:** Instead of `Sale → Inventory → Dashboard → Audit → Profit`, think:
```
SaleCompleted (domain event)
    ↓
    ├── Inventory reacts (decrement stock)
    ├── Dashboard reacts (update metrics)
    ├── Reports react (recalculate profit)
    ├── Audit reacts (log event)
    ├── Notifications react (send receipt)
    ├── Staff metrics react (update performance)
    ├── Loyalty reacts (update points)
    └── Analytics reacts (track conversion)
```

**Acceptance Criteria:**

**Core Event Bus:**
- [ ] Event bus implemented: `useEventBus.ts` composable
- [ ] Core domain events defined:
  - `SaleCompleted`, `SaleVoided`, `SaleReturned`
  - `InventoryAdjusted`, `StockReceived`
  - `CustomerDebtChanged`, `InstallmentDuePaid`
  - `CashMovementRecorded`, `ShiftOpened`, `ShiftClosed`
  - `SettlementPaid`, `StaffLedgerEntryAdded`
  - `ReceivingPosted`, `StockTakeCompleted`
  - `DiscountApplied`, `ProductPriceChanged`
- [ ] Every existing composable publishes events instead of calling downstream directly
- [ ] Every consumer subscribes to events instead of being called directly
- [ ] Event payload includes: `eventType`, `payload`, `timestamp`, `staff_id`, `shop_id`, `meta`
- [ ] Events are durable (persisted to Dexie, survive app kill)
- [ ] Events sync to server via PowerSync (for multi-device consistency)
- [ ] Event handlers are idempotent (safe to replay)
- [ ] New feature can be added by subscribing to events — zero changes to producers

**🔒 SECURITY & AUTH (Critical for Event Bus):**
- [ ] **Event bus respects RLS:** Cashier cannot publish `SaleCompleted` for another cashier's sale
- [ ] **Event payload validation:** Server-side validation that `staff_id` in event matches authenticated `staff_id`
- [ ] **Event subscription authorization:** Cashier cannot subscribe to `StaffLedgerEntryAdded` (manager/owner only)
- [ ] **Event replay security:** Only owner can trigger full event replay; cashiers replay only their own events
- [ ] **Cross-tenant isolation:** Events from Shop A never visible to Shop B (enforced by PowerSync sync rules + RLS)
- [ ] **Sensitive event filtering:** Financial events (`SaleCompleted`, `SettlementPaid`) encrypted in transit
- [ ] **Event audit trail:** Every publish/subscribe logged in `audit_log` with `event_type` and `handler_name`
- [ ] **Rate limiting:** Event publish throttled per `staff_id` to prevent spam (max 100 events/minute)
- [ ] **Event bus RLS policies:**
  - `events` table: SELECT only by `shop_id` + role-based filtering
  - `event_subscriptions` table: INSERT/UPDATE only by owner (who configures which events trigger what)
  - `event_handlers` table: READ by all roles, WRITE only by owner

**Actions:**
1. Create `useEventBus.ts` with publish/subscribe API:
   - `publish(eventType, payload)` — validates `staff_id` against current auth
   - `subscribe(eventType, handler)` — checks role permission for event type
   - `unsubscribe(eventType, handler)`
2. Create `events/` directory with domain event definitions
3. **SECURITY: Add `can_publish` and `can_subscribe` metadata to each event type:**
   ```ts
   // Event authorization matrix
   const EVENT_AUTH: Record<EventType, { publish: Role[]; subscribe: Role[] }> = {
     SaleCompleted: { publish: ['cashier', 'manager', 'owner'], subscribe: ['manager', 'owner'] },
     StaffLedgerEntryAdded: { publish: ['owner'], subscribe: ['owner'] },
     // ... etc
   }
   ```
4. Refactor `usePayment.ts`: publish `SaleCompleted` with auth-validated `staff_id`
5. Refactor `useAuditLog.ts`: subscribe to events with role check
6. Refactor `useDashboardMetrics.ts`: subscribe with role check
7. Refactor `useInventory.ts`: subscribe to `SaleCompleted`
8. Add event persistence layer in Dexie (with `shop_id` + `staff_id` indexing)
9. Add PowerSync sync rules for `events` table with `shop_id` + role filtering
10. Create event replay mechanism with owner-only access control
11. Add server-side event validation middleware (Supabase edge function)
12. Document event catalog in `EVENTS.md` with security annotations

**Definition of Done:**
- [ ] Zero direct composable-to-composable calls for cross-cutting concerns
- [ ] New feature added by subscribing to events (demo: add "loyalty points" in <1 day)
- [ ] Event replay works: clear state, replay events, state reconstructs identically
- [ ] **Security test: cashier JWT cannot subscribe to owner-only events (403)**
- [ ] **Security test: cross-tenant event isolation (Shop A events invisible to Shop B)**
- [ ] **Security test: event payload `staff_id` spoofing blocked server-side**
- [ ] Performance: event publish + all handlers <200ms total
- [ ] All existing tests pass with event architecture
- [ ] Architecture decision record (ADR) documenting event-first + security approach

**Dependencies:** TICKET-001 (RLS), TICKET-007 (audit), TICKET-022 (deployment)
**Blocks:** TICKET-025, TICKET-026, TICKET-027, TICKET-028, TICKET-029, TICKET-030, TICKET-031, TICKET-032, TICKET-033

---

### TICKET-025: Feature Dependency Graph (Auto-Generated)
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Tech Lead

**Problem:** No living documentation of which features consume/produce/trigger/depend on which other features.

**Vision:** Automatically generated dependency graph from code annotations.

**Acceptance Criteria:**
- [ ] JSDoc annotations on every composable:
  ```js
  /**
   * @produces SaleCompleted
   * @consumes Product[]
   * @triggers AuditLogEntry
   * @dependsOn useProducts, useCustomers
   * @owns Sale, SaleLineItem
   */
  ```
- [ ] Build script parses annotations and generates `DEPENDENCY_GRAPH.md`
- [ ] Graph includes: nodes (composables), edges (produces/consumes/dependsOn), data flow direction
- [ ] CI fails if new composable lacks annotations
- [ ] Graph visualized (Mermaid or similar) in documentation

**Actions:**
1. Define annotation schema
2. Add annotations to all 17+ composables
3. Create `scripts/generate-dependency-graph.js`
4. Add CI check for missing annotations
5. Add Mermaid visualization
6. Link graph from `ARCHITECTURE.md`

**Definition of Done:**
- [ ] 100% composable coverage
- [ ] Graph auto-generates on every build
- [ ] CI blocks PRs with missing annotations
- [ ] Graph reviewed and accurate

**Dependencies:** TICKET-024 (Event Architecture)
**Blocks:** None

---

### TICKET-026: Sale Lifecycle State Machine
**Type:** Epic | **Estimated:** 1.5 sprints | **Assignee:** Full-Stack Lead

**Problem:** Sales are treated as atomic "created" events. No formal lifecycle means edge cases (discounts mid-sale, payment failures, returns, voids) are handled ad-hoc.

**Vision:** Every sale has explicit states. Every transition emits events.

```
Draft → Items Added → Discount Applied → Payment Started → Completed → Printed → Returned → Voided → Archived
```

**Acceptance Criteria:**
- [ ] `sales` table has `lifecycle_state` enum:
  `draft` | `items_added` | `discounted` | `payment_started` | `completed` | `printed` | `returned` | `voided` | `archived`
- [ ] Every state transition is validated (e.g., cannot go `draft` → `voided` directly)
- [ ] Every transition emits a domain event (via TICKET-024 event bus)
- [ ] `sale_state_transitions` table logs: `from_state`, `to_state`, `timestamp`, `staff_id`, `reason`
- [ ] UI reflects current state (e.g., "Sale in progress — payment pending")
- [ ] Offline: state machine works locally, syncs transitions
- [ ] Recovery: interrupted sale resumes at correct state

**Actions:**
1. Migration: add `lifecycle_state` to `sales`
2. Create `useSaleLifecycle.ts` composable with state machine
3. Define valid transitions as directed graph
4. Wire state transitions to event bus
5. Update POS UI to show current state
6. Add "Resume draft sale" functionality
7. Add state transition audit logging
8. Update all existing sale flows to use state machine

**Definition of Done:**
- [ ] All sale flows use state machine
- [ ] Invalid transitions are blocked (tested)
- [ ] Interrupted sale resumes correctly
- [ ] State transition history visible in sale detail
- [ ] Zero regression on existing sale flows

**Dependencies:** TICKET-024 (Event Architecture)
**Blocks:** TICKET-027, TICKET-028

---

### TICKET-027: Dashboard Intelligence Layer
**Type:** Feature | **Estimated:** 1.5 sprints | **Assignee:** Full-Stack Lead

**Problem:** Dashboards show raw numbers. Owners need insights, not data.

**Vision:** Proactive intelligence — not "more dashboards," but "smarter dashboards."

**Acceptance Criteria:**
- [ ] Intelligence cards on Home screen:
  - "Today is 40% slower than usual" (vs. 30-day average)
  - "Ahmed gave 2× normal discounts today" (vs. his own average)
  - "Inventory shrinkage increased 22% this week" (vs. last week)
  - "Customer debt increased $X since last week"
  - "Sales dropped after supplier cost increase on [date]"
- [ ] Each insight has: severity (info/warning/critical), explanation, action link
- [ ] Insights computed from event stream (TICKET-024), not ad-hoc queries
- [ ] Configurable: owner can mute specific insight types
- [ ] Insights respect role (cashier sees none)

**Actions:**
1. Create `useDashboardIntelligence.ts` composable
2. Define insight rules with statistical baselines
3. Subscribe to event bus for real-time insight generation
4. Create `InsightCard.vue` component
5. Add insight configuration to Settings
6. Add insight history (last 30 days)

**Definition of Done:**
- [ ] All 5 insight types trigger correctly
- [ ] Baselines update automatically (rolling window)
- [ ] Muted insights don't reappear
- [ ] Performance: insights update <500ms after event

**Dependencies:** TICKET-024 (Event Architecture), TICKET-026 (Sale Lifecycle)
**Blocks:** None

---

### TICKET-028: Owner Notification Matrix
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** As automation grows, notification chaos becomes real. Every event could notify — which should?

**Vision:** Explicit specification: Event → Notify? → Priority → Channel.

**Acceptance Criteria:**
- [ ] `notification_matrix` table: `event_type`, `notify_owner`, `notify_manager`, `priority`, `channel`, `enabled`
- [ ] Default matrix covers all domain events
- [ ] Owner can customize: enable/disable per event, change priority, change channel
- [ ] Channels: in-app banner, push notification, WhatsApp (future), email (future)
- [ ] Notification deduplication: same event type within 1 hour → batch
- [ ] Respect offline: queue notifications, deliver on sync

**Actions:**
1. Create `notification_matrix` schema
2. Define default matrix for all events
3. Create `useNotificationMatrix.ts`
4. Create `NotificationSettingsScreen.vue`
5. Add deduplication logic
6. Wire to event bus subscribers

**Definition of Done:**
- [ ] All events have matrix entries
- [ ] Customization persists
- [ ] Deduplication works in manual test
- [ ] No notification spam in normal operation

**Dependencies:** TICKET-024 (Event Architecture)
**Blocks:** None

---

### TICKET-029: Business Signal Inventory
**Type:** Process | **Estimated:** 1 sprint | **Assignee:** Product Manager + Tech Lead

**Problem:** No systematic catalog of what business signals each feature produces.

**Vision:** Every feature documents its signals. Living document.

**Acceptance Criteria:**
- [ ] `SIGNALS.md` living document with table per feature:
  | Feature | Signal | Type | Computation | Consumer |
  |---|---|---|---|---|
  | Customer Credit | Average debt | metric | SUM(balance)/COUNT | Dashboard |
  | Sale | Basket size | metric | SUM(qty)/COUNT(sales) | Reports |
  | Inventory | Turnover | metric | COGS / avg inventory | Intelligence |
  | Receiving | Cost freshness | metric | % from receiving | Profit Report |
- [ ] 50+ signals documented
- [ ] Each signal has: definition, formula, data source, update frequency
- [ ] Signals linked to KPIs (TICKET-032)
- [ ] New feature PR includes signal documentation

**Actions:**
1. Audit all features for signals produced
2. Create `SIGNALS.md` template
3. Document first 20 signals
4. Create signal computation utilities
5. Link signals to dashboard metrics
6. Add PR template: "What signals does this feature produce?"

**Definition of Done:**
- [ ] 50+ signals documented
- [ ] All existing dashboard metrics have signal definitions
- [ ] PR template enforced
- [ ] Team trained on signal discipline

**Dependencies:** TICKET-024 (Event Architecture)
**Blocks:** TICKET-032

---

### TICKET-030: Report Generator Review (15–20 Missing Reports)
**Type:** Feature | **Estimated:** 1 sprint | **Assignee:** Backend Lead

**Problem:** Data exists for 15–20 reports nobody has written.

**Vision:** Systematic audit + implementation of all possible reports from existing data.

**Acceptance Criteria:**
- [ ] Report inventory complete (list all 15–20)
- [ ] Priority ranking: P0 (must have), P1 (should have), P2 (nice to have)
- [ ] P0 reports implemented:
  - Fastest cashier (sales/minute)
  - Most discounted products
  - Fast-moving SKUs (highest turnover)
  - Dead inventory (zero sales in 90 days)
  - Profit by weekday
  - Sales by hour
  - Discount trend (weekly)
  - Margin trend (weekly)
  - Cash movement summary by reason
  - Staff settlement summary
  - Customer payment reliability
  - Supplier purchase history
  - Category profit contribution
  - Stock-take shrinkage trend
  - Receiving cost freshness trend
- [ ] Each report: query, UI, export (CSV), print
- [ ] Reports respect role (cashier sees none)

**Actions:**
1. Create `REPORTS_INVENTORY.md`
2. Prioritize with product lead
3. Implement P0 reports (1 per day)
4. Add report routing and navigation
5. Add export/print functionality
6. Add to Reporting Pack gating

**Definition of Done:**
- [ ] All P0 reports functional
- [ ] Reports tested on real data
- [ ] Performance: <2s load on 1 year of data
- [ ] Documentation complete

**Dependencies:** TICKET-001 (RLS), TICKET-008 (Data Source Tagging)
**Blocks:** None

---

### TICKET-031: Feature Usage Analytics
**Type:** Feature | **Estimated:** 0.5 sprint | **Assignee:** Frontend Lead

**Problem:** No telemetry on which features are used. Roadmap decisions are guesswork.

**Vision:** Know exactly: "Nobody uses Installments. Everyone uses Customer Credit. Nobody opens Supplier."

**Acceptance Criteria:**
- [ ] Anonymous feature usage tracking (privacy-compliant, no PII)
- [ ] Tracked per feature: opens, actions, time spent
- [ ] Dashboard for product team: feature popularity, drop-off rates
- [ ] "Feature health" score: daily active users / total users per feature
- [ ] Alerts: feature usage drops >50% week-over-week
- [ ] Data exportable for roadmap review

**Actions:**
1. Create `useFeatureAnalytics.ts` composable
2. Define tracking schema (anonymous, aggregated)
3. Add tracking to all major screens/composables
4. Create admin dashboard (separate from owner app)
5. Add privacy notice and opt-out
6. Document data retention policy

**Definition of Done:**
- [ ] All major features tracked
- [ ] Dashboard shows real data
- [ ] Privacy compliant (no PII, aggregated only)
- [ ] Team uses data for roadmap decisions

**Dependencies:** TICKET-022 (Deployment)
**Blocks:** None

---

### TICKET-032: KPI Ownership Per Feature
**Type:** Process | **Estimated:** 0.5 sprint | **Assignee:** Product Manager

**Problem:** Features don't explicitly answer: "Which KPI does this improve?"

**Vision:** Every feature has a KPI. Every KPI has an owner.

**Acceptance Criteria:**
- [ ] KPI matrix: Feature → Primary KPI → Secondary KPI → Target → Measurement
- [ ] Examples:
  | Feature | Primary KPI | Target | Measurement |
  |---|---|---|---|
  | Customer Credit | Avg collection time | <7 days | Days from sale to payment |
  | Installments | Default rate | <5% | Overdue dues / total dues |
  | Stock Take | Shrinkage % | <2% | Variance value / total value |
  | Staff Pack | Cash variance | <1% | |variance| / total sales |
- [ ] KPIs linked to business signals (TICKET-029)
- [ ] KPIs reviewed monthly
- [ ] Underperforming KPIs trigger feature review

**Actions:**
1. Create `KPI_MATRIX.md`
2. Define KPIs for all existing features
3. Link to signals and dashboard metrics
4. Schedule monthly KPI review
5. Add KPI health to product review

**Definition of Done:**
- [ ] All features have ≥1 KPI
- [ ] KPIs measurable with existing data
- [ ] Monthly review process established

**Dependencies:** TICKET-029 (Business Signals)
**Blocks:** None

---

### TICKET-033: Product Constitution
**Type:** Process | **Estimated:** 0.5 sprint | **Assignee:** Tech Lead + Product Lead

**Problem:** No single document stating "the laws of WAFI." New engineers lack product philosophy.

**Vision:** A constitution — not documentation, but product philosophy. Every future engineer reads this first.

**Constitution Draft:**
1. **Financial history is immutable.** Never modify a completed sale, expense, or payment.
2. **One source of truth.** `sales` table is the single source. All reports derive from it.
3. **No feature owns another feature's data.** Features communicate via events (TICKET-024).
4. **Everything offline-first.** Every feature must work without internet. Sync is enhancement, not requirement.
5. **Append-only ledgers.** `audit_log`, `cash_movements`, `staff_ledger` — never delete, only append.
6. **Reports derive from transactions.** No standalone report tables. All reports query transactions.
7. **No duplicated calculations.** Calculate once, store result, reference everywhere.
8. **Every financial action auditable.** Every mutation creates an audit event.
9. **Every feature produces business signals.** Document signals in `SIGNALS.md`.
10. **Every major workflow has explicit states.** Use state machines (TICKET-026).
11. **Every feature documents dependencies.** Use dependency graph (TICKET-025).
12. **Automation is a core differentiator.** Build automation into every feature, not as add-on.

**Acceptance Criteria:**
- [ ] `CONSTITUTION.md` written and reviewed
- [ ] All 12 principles documented with rationale and examples
- [ ] Linked from README and onboarding docs
- [ ] Team sign-off (every engineer reads and acknowledges)
- [ ] PR template references constitution
- [ ] Architecture decisions evaluated against constitution

**Actions:**
1. Draft constitution with product lead
2. Review with engineering team
3. Add to repo root
4. Add to onboarding checklist
5. Add to PR template
6. Schedule quarterly constitution review

**Definition of Done:**
- [ ] Constitution live and linked
- [ ] All team members have read and acknowledged
- [ ] First architecture decision evaluated against constitution
- [ ] Quarterly review scheduled

**Dependencies:** None (can start anytime, but most valuable after TICKET-024)
**Blocks:** None

---

## IMPLEMENTATION TIMELINE

```
WEEK 1–2:   PHASE 1 — Security Foundation
            TICKET-001 (Server-Side RLS) — LEAD TRACK
            TICKET-002 (Real Auth) — PARALLEL TRACK
            TICKET-005 (Design System Freeze) — PARALLEL TRACK

WEEK 3–4:   PHASE 1–2 — Auth & Devices
            TICKET-003 (Device Registration)
            TICKET-004 (Owner Bootstrap)
            TICKET-006 (Navigation Cleanup)
            TICKET-007 (Audit Event Wiring)

WEEK 5:     PHASE 4 — Data Integrity
            TICKET-008 (Data Source Tagging)
            TICKET-009 (Stock-Take Collision)
            TICKET-010 (Installment + Returns)
            TICKET-011 (Discounts + Returns)

WEEK 6:     PHASE 5 — Hardening (Batch 1)
            TICKET-012 (WhatsApp Analytics)
            TICKET-013 (Cost Freshness)
            TICKET-014 (Cross-Epic Review)
            TICKET-015 (Anomaly Detection)

WEEK 7:     PHASE 5 — Hardening (Batch 2)
            TICKET-016 (Cash Movement Callout)
            TICKET-017 (Unified Money Owed)
            TICKET-018 (Staff Performance)
            TICKET-019 (Offline Banner)

WEEK 8:     PHASE 5 — Hardening (Batch 3)
            TICKET-020 (Performance Testing)
            TICKET-021 (Documentation)
            TICKET-022 (Deployment Checklist)
            TICKET-023 (Monitoring Setup)

WEEK 9–10:  PHASE 6 — Event Architecture (Foundation)
            TICKET-024 (Product Event Architecture) — LEAD TRACK
            TICKET-033 (Product Constitution) — PARALLEL

WEEK 11:    PHASE 6 — State Machines & Intelligence
            TICKET-026 (Sale Lifecycle State Machine)
            TICKET-028 (Notification Matrix)
            TICKET-029 (Business Signal Inventory)

WEEK 12:    PHASE 6 — Intelligence & Reports
            TICKET-027 (Dashboard Intelligence)
            TICKET-030 (Report Generator Review)
            TICKET-025 (Feature Dependency Graph)

WEEK 13:    PHASE 6 — Analytics & KPIs
            TICKET-031 (Feature Usage Analytics)
            TICKET-032 (KPI Ownership)
            TICKET-033 (Constitution Finalization)

WEEK 14:    BUFFER — Integration, Bug Fixes, Polish
```

**Total Estimated Duration: 14 weeks (3.5 months)**
**Critical Path: 001 → 002 → 003 → 004 → 024 → 026 → 027**

---

## RISK REGISTER

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Server-side role enforcement breaks existing sync | High | Critical | Extensive staging testing; gradual rollout |
| Design system consolidation causes UI regressions | High | Medium | Visual regression tests; component library |
| Real auth migration loses existing customer data | Low | Critical | Backup; idempotent scripts |
| Event architecture adds complexity | Medium | High | Start simple; evolve; document patterns |
| Performance on cheap Android unacceptable | Medium | High | Early testing; performance budget |
| Team velocity drops during security work | Medium | Medium | Parallel tracks; clear priorities |
| Cross-epic edge cases missed despite process | Medium | High | Mandatory review; integration owner |
| Event bus becomes bottleneck | Low | High | Async handlers; debounce; batching |
| State machine over-engineering | Medium | Medium | Start with 5 states; expand as needed |

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
- [ ] **NEW:** Event bus integration (if applicable, per TICKET-024)
- [ ] **NEW:** Signal documented in `SIGNALS.md` (if applicable, per TICKET-029)
- [ ] **NEW:** Constitution compliance verified (per TICKET-033)

---

## CHANGELOG FROM V1.0

### Added in V2.0 (based on Product Lead feedback)

| Ticket | Title | Source |
|---|---|---|
| TICKET-024 | Product Event Architecture | 🔴 New — event bus + domain events |
| TICKET-025 | Feature Dependency Graph (Auto-Generated) | 🟡 Expanded from TICKET-014 |
| TICKET-026 | Sale Lifecycle State Machine | 🔴 New — formal state machine |
| TICKET-027 | Dashboard Intelligence Layer | 🟡 Expanded from TICKET-015 |
| TICKET-028 | Owner Notification Matrix | 🔴 New — prevents notification chaos |
| TICKET-029 | Business Signal Inventory | 🟡 Expanded from scattered metrics |
| TICKET-030 | Report Generator Review (15–20 Reports) | 🟡 Expanded from 7 missing reports |
| TICKET-031 | Feature Usage Analytics | 🔴 New — telemetry for roadmap |
| TICKET-032 | KPI Ownership Per Feature | 🔴 New — every feature has a KPI |
| TICKET-033 | Product Constitution | 🟡 Expanded from TICKET-021 docs |

### Scoring Adjustments (Product Lead feedback)

| Dimension | V1.0 Score | V2.0 Score | Rationale |
|---|---|---|---|
| Product Thinking | 7/10 | 8.5/10 | Execution immature; vision is strong |
| Engineering | 5/10 | 6.5/10 | Architecture coherent; implementation unfinished |
| Production Readiness | 4/10 | 4/10 | No change — still blocked without auth+RLS |

---

## APPENDIX: WHAT WAS COVERED IN V1.0 VS. WHAT FEEDBACK ADDED

### V1.0 Coverage (My Original Review)
- Security (RLS, auth, device registration)
- Design system freeze
- Audit event expansion
- Data source tagging
- Cross-feature edge cases (9 tickets)
- Anomaly detection
- Missing reports (7 identified)
- Documentation, deployment, monitoring

### Feedback Round 1 Added
- Product Thinking score too low (7→8.5)
- Engineering score too low (5→6.5)
- Sale lifecycle thinking
- Event bus architecture
- 50+ business signals
- Owner intelligence (AI-assisted)
- Feature usage analytics
- Explicit state machines
- Feature dependency graph
- KPI ownership
- Delete features discipline

### Feedback Round 2 Added
- Phase 6: Product System Architecture
- Product Event Architecture (event bus)
- Auto-generated Feature Dependency Graph
- Sale Lifecycle State Machine
- Dashboard Intelligence (not just alerts)
- Owner Notification Matrix
- Business Signal Inventory (systematic)
- 15–20 missing reports (systematic review)
- Feature Usage Analytics (telemetry)
- Product Constitution ("laws of WAFI")
- Automation as core differentiator (not P2)

### Total Plan Growth
| Metric | V1.0 | V2.0 | Delta |
|---|---|---|---|
| Tickets | 23 | 33 | +10 (+43%) |
| Phases | 5 | 6 | +1 |
| Duration | 8 weeks | 14 weeks | +6 weeks (+75%) |
| New architectural concepts | 0 | 6 | +6 |

---

## FINAL RECOMMENDATION

**Execute Phase 1–5 first (8 weeks).** These are production blockers. Without them, there is no business.

**Then execute Phase 6 (6 weeks).** These are scale enablers. Without them, WAFI stays a small tool instead of becoming a platform.

**The sequence matters.** You cannot build an event bus on a foundation with no auth and no RLS. Fix the foundation, then build the architecture.

**Automation is not a future nice-to-have.** It is a core differentiator. Phase 6 makes it systematic, not ad-hoc.
