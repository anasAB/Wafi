# WAFI Unified Architecture Roadmap V3.0
## Production Readiness + Event-Driven Platform + Enterprise Architecture
### Version: 3.0 | Date: 2026-07-21 | Status: STAFF ENGINEER REVIEWED
### Last implementation update: 2026-07-22

---

## IMPLEMENTATION STATUS (as of 2026-07-22)

Quick-scan status for anyone opening this doc cold. Full narrative for each
ticket lives in its row in the tables below — this section is the summary,
not a replacement for them.

| Item | Status | Note |
|---|---|---|
| WAFI-001 (Server-Side Role Enforcement) | 🟡 Partially shipped | RLS/JWT mechanism live (WAFI-122). WAFI-202 (sales immutability) and WAFI-203 (operator identity) both shipped — see below. Migrations `064_wafi202_sales_immutability.sql` and `066_fill_missing_table_grants.sql` are **applied to the production Supabase project** (2026-07-22). Formal pentest and security sign-off doc still not done. |
| WAFI-202 (Sales/Returns Immutability RLS) | ✅ Shipped, **now executed for real, applied to production** | Migration `064` + 16-case pgTAP suite merged. All 16 assertions pass against a real local Postgres (`npx supabase test db`) — no longer "traced not run". Applied to production 2026-07-22. |
| WAFI-203 (Operator Identity Server-Authoritative) | ✅ Shipped | `establishOperatorIdentity` gates `openShift` (new-shift + resume) and `switchTo`; `usePayment.confirm()` refuses a sale with no active operator. Merged to main. |
| WAFI-122 pgTAP suite, Sections A–C (role×table automated tests) | ✅ Shipped, **now executed for real** | `supabase/tests/wafi122_role_enforcement.test.sql`, 13 assertions, **all passing against a real local Postgres, 2026-07-22**. Section D (live REST pentest) stays manual by design. |
| WAFI-002 (Real Authentication System) | ✅ Gap-closing pass shipped | Investigation found signup/login/PIN/JWT/tenant-isolation already worked (not a from-scratch build). Verified session-refresh handling and `ForgotPasswordPage.vue` need no changes. Removed the `devAuth.ts` production auto-sign-in stub + its dead env vars, and wrote a runbook for migrating the one live customer (brother's shop) who depended on it onto real login — see `docs/superpowers/plans/2026-07-22-wafi-002-customer0-login-migration-runbook.md`. That on-device migration step is still pending (human-executed, not done by this session). |
| WAFI-004 through WAFI-023 (remaining Macro-Phase 1) | ⬜ Not started | No work done beyond WAFI-001/002's items above. |
| Macro-Phase 2 (WAFI-152, WAFI-140, WAFI-150/143/144/145/146/142) | ⬜ Not started | |
| Macro-Phase 3 (WAFI-151/153/154/155/156/157/147/148/149/026/032/033) | ⬜ Not started | |

**Resolved 2026-07-22 — local Supabase stack now starts and the pgTAP suites actually execute.**
Fixing this required four separate, previously-undiscovered bugs, found only
because the suites finally ran against a real Postgres instead of being
manually traced:
1. `037_devices.sql` created a `UNIQUE INDEX` on a `code` column that didn't
   exist (`public.devices` was created with `device_code` by
   `001_initial_schema.sql`) — this alone blocked `supabase start`/`db reset`
   for any local stack. Fixed by renaming the column to `code` (matching what
   `useDeviceRegistration.ts` already reads/writes) and adding the
   `is_temporary`/`sync_status` columns 037 was trying to introduce.
   `seed.sql` had the same stale `device_code` reference — fixed too.
2. Two migrations were both numbered `038` (`038_customers_last_reminded.sql`
   and `038_stock_take_scope_ids.sql`), which crashes `db reset` on a
   duplicate `schema_migrations` primary key. Renamed the later one to
   `065_customers_last_reminded.sql`.
3. Both pgTAP fixture files inserted into `auth.users` then explicitly
   inserted a `shops` row with a hardcoded id — but migration `021`'s
   `provision_shop_for_new_user()` trigger already auto-creates a shop for
   that user first, so the explicit insert collided on `owner_user_id`.
   Fixed by deleting the trigger-created row before the fixture's own insert
   in both test files.
4. **Core tables had RLS policies but no base `GRANT` to `authenticated`/`anon`
   in any migration** — `sales`, `products`, `shops`, `sale_line_items`,
   `devices`, `categories`, `subcategories`, `exchange_rates`,
   `installment_plans`, `installment_dues`, `stock_take_sessions`,
   `stock_take_lines`, `staff_ledger`, `staff_settlements`,
   `device_sessions`, `cash_movements` were all missing it. Production has
   been masking this because a hosted Supabase project's dashboard applies
   its own default-privilege grants at project-creation time, which
   migration files never capture — a fresh local `supabase start` has no
   such defaults. Fixed with new migration `066_fill_missing_table_grants.sql`
   (deliberately excludes `audit_log`, whose missing UPDATE/DELETE grant is
   an intentional append-only guard from `018_audit_log_append_only.sql`).
5. Also found and fixed a pgTAP authoring gotcha in
   `wafi202_sales_immutability.test.sql`: `throws_ok(sql, '42501', description)`
   — pgtap's 3-arg wrapper treats the third argument as an **expected error
   message** whenever the code string is exactly 5 characters, so the test
   description was silently being compared against the real RLS error text
   and failing. Fixed by using the 4-arg form (`'42501', NULL, description`)
   so only the SQLSTATE is checked.

Verified via `npx supabase db reset` + `npx supabase test db`, both run twice
from a clean reset for reproducibility: **29/29 pgTAP assertions pass.**
Migration 066 is a new, additional migration that also needs a production
deploy step (same status as migration 064).

---

## EXECUTIVE SUMMARY

This document unifies three streams of work into a single, coherent architecture roadmap:

| Stream | Source | Focus |
|---|---|---|
| **Production Foundation** | V2.0 Plan (Phases 1–5) | Security, auth, data integrity, hardening |
| **Event-Driven Platform** | Your 11-ticket plan | Event bus, automation, insights, intelligence |
| **Enterprise Architecture** | Staff Engineer Review | Business services, CQRS, read models, workers |

**Total: 25 tickets across 3 macro-phases | 6 months estimated**

---

## MACRO-PHASE 1: FOUNDATION (Weeks 1–8)
### Without this, nothing else stands.

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-001 | Server-Side Role Enforcement (RLS) | P0 | 2 sprints | Auth, RLS, device identity — blocks everything. **Status: IN PROGRESS, not complete.** Delivered under ticket WAFI-122 (migrations 055–062, ADR-010). **WAFI-202 CONFIRMED via live exploit test against production (2026-07-21)**, not merely inferred from policy review: a manager-role session successfully changed `total_usd` on a completed sale it didn't create and forged `staff_id` attribution to the owner via direct PATCH to the REST API (`sales_update_all`/`sales_delete_all`, inherited unmodified from migration 015, check only `shop_id` — no status/immutability/attribution guard). Precise scope (narrower than a first static read suggested, because Postgres requires a row to pass the table's SELECT policy before an UPDATE/DELETE policy is even consulted): owner/manager can tamper with or delete *any* sale/return in the shop; a cashier is limited to sales they can already see (their own), but for those, the same lack of immutability/attribution guard applies. No cross-tenant exposure — tenant isolation held throughout testing. Also open: (2) **RESOLVED** — automated pgTAP suite added for Sections A-C (role access, edge cases, lifecycle) at `supabase/tests/wafi122_role_enforcement.test.sql`; the manual script's Section D (live REST pentest) remains manual by nature and is covered by item (3). Still open: (3) live exploit test above stands in for a full pentest but a formal one is still not performed; (4) no final security sign-off document. Offline-sync confidentiality gap (WAFI-201, ADR-010) is a deliberate, accepted scope exclusion, not a blocker. WAFI-202's fix design (2026-07-22, `docs/superpowers/specs/2026-07-22-wafi-202-sales-immutability-design.md`) surfaced a new blocking dependency: `useOperatorSwitch.ts`'s offline fallback lets the locally-active operator diverge from the JWT `staff_id` claim, and no client-side gate currently requires an operator to be active before checkout — both must be fixed (tracked as **WAFI-203**, "Operator Identity Must Be Server-Authoritative", needs its own brainstorm) before the strict `staff_id = auth_staff_id()` policy can go live in production, even though the migration + pgTAP suite themselves can be built and merged independently. WAFI-202's migration (064_wafi202_sales_immutability.sql) and 16-case pgTAP suite are merged to main. **As of 2026-07-22: the `037_devices.sql`/duplicate-migration-038 blockers are fixed (see IMPLEMENTATION STATUS above), and `npx supabase test db` now runs both the WAFI-202 (16 assertions) and WAFI-122 Sections A-C (13 assertions) suites for real, all 29 passing** — this is genuine execution proof, not tracing. Migration `064` (and the new `066_fill_missing_table_grants.sql` it depended on to even be testable) is still **not yet applied to the production Supabase project**. Do not treat WAFI-001 as fully done until: migrations 064 and 066 are applied to production, a formal pentest is recorded, and a security sign-off document exists. |
| WAFI-203 | Operator Identity Must Be Server-Authoritative | P0 | 0.5 sprint | Blocking prerequisite for WAFI-202's production rollout. `useOperatorSwitch.ts` currently treats operator identity as client-authoritative (switch locally, sync JWT best-effort) — network/RPC failures leave the JWT's `staff_id` claim stale relative to the locally-active operator, which would cause synced sales to be rejected once WAFI-202's strict attribution policy is live. Also: no client-side gate currently requires an active operator before checkout (all sampled production sales have `staff_id = NULL` today). Architectural options on the table: block operator changes while offline vs. make the operator switch itself a signed, locally-queued, PowerSync-synchronized object. Needs its own design session before implementation. **Status: SHIPPED** — see docs/superpowers/plans/2026-07-22-wafi-203-operator-identity.md. `openShift` and `switchTo` now both require server-confirmed identity via a shared `establishOperatorIdentity` helper before adopting a new operator locally; same-identity re-entry stays fully offline via a persisted `lastConfirmedOperatorId`; `usePayment.confirm()` refuses a sale with no active operator. Migration 064 (WAFI-202) is unblocked for production. |
| WAFI-002 | Real Authentication System | P0 | 1.5 sprints (scoped down to a gap-closing pass — see IMPLEMENTATION STATUS above) | Signup, login, JWT, session, PIN, tenant isolation. **Status: shipped as a gap-closing pass, 2026-07-22** — the "1.5 sprint" estimate assumed a from-scratch build that turned out to already exist. |
| WAFI-003 | Self-Serve Device Registration | P0 | 1 sprint | Multi-device, device codes, remote sign-out |
| WAFI-004 | Owner Bootstrap & Onboarding | P1 | 0.5 sprint | Guided setup, <5 minutes, demo data option |
| WAFI-005 | Design System Freeze | P1 | 1 sprint | Single canonical system, zero competing redesigns |
| WAFI-006 | Navigation System Cleanup | P1 | 0.5 sprint | Bottom tabs + sidebar, zero nav errors |
| WAFI-007 | Complete Audit Event Wiring | P1 | 1 sprint | 32+ event types, financial write wrapper, append-only |
| WAFI-008 | Data Source Tagging | P1 | 0.5 sprint | live vs. imported sales, profit report filtering |
| WAFI-009 | Stock-Take + Active Sales Collision | P2 | 0.5 sprint | Variance adjustment, timeline visualization |
| WAFI-010 | Installment Plans + Returns Integration | P2 | 0.5 sprint | Cancel plan before return, audit both events |
| WAFI-011 | Discounts + Returns Net Price Refund | P2 | 0.5 sprint | Refund post-discount price, prorated breakdown |
| WAFI-012 | WhatsApp Messaging Analytics Fix | P2 | 0.25 sprint | Rename to `whatsapp_composed`, document semantics |
| WAFI-013 | Cost Freshness Indicator | P2 | 0.5 sprint | % catalog with fresh cost, filter by missing/stale |
| WAFI-014 | Cross-Epic Edge-Case Review Process | P2 | Ongoing | Mandatory checklist, ripple effect matrix |
| WAFI-015 | Anomaly Detection Automation | P2 | 1 sprint | 5 anomaly types, Home banner, <100ms overhead |
| WAFI-016 | Cash Movement + Profit Report Exclusion | P2 | 0.25 sprint | Footnote, tooltip, navigation link |
| WAFI-017 | Unified "Money Owed" View | P2 | 0.5 sprint | Credit + installments combined, aging buckets |
| WAFI-018 | Staff Performance Dashboard | P2 | 0.5 sprint | Net contribution, period selector, owner-only |
| WAFI-019 | PWA Offline Banner Reconciliation | P2 | 0.5 sprint | 4 unified states, tap for detail, zero conflicts |
| WAFI-020 | Performance & Load Testing | P2 | 0.5 sprint | Benchmarks, Lighthouse CI, cheap Android target |
| WAFI-021 | Documentation & Runbook | P2 | 0.5 sprint | 7 docs: ARCHITECTURE, DATA_MODEL, API_CONTRACTS, etc. |
| WAFI-022 | Production Deployment Checklist | P2 | 0.25 sprint | Staging, monitoring, backup, rollback tested |
| WAFI-023 | Post-Launch Monitoring & Feedback | P2 | Ongoing | Sentry, in-app reporting, weekly review, SLA |

**Foundation Total: 23 tickets | 8 weeks** — **2 of 23 fully shipped (WAFI-203, WAFI-002), 1 partially shipped (WAFI-001, two of its sub-items done), 20 not started.**
**Critical Path: 001 → 002 → 003 → 004 → 007 → 022**

---

## MACRO-PHASE 2: ARCHITECTURE TRANSFORMATION (Weeks 9–14)
### From feature-first to event-first. From composables to business services.

### Phase 2A: Business Services Layer (Week 9)

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-152 | Business Services Layer | P0 | 1 sprint | UI → Business Service → Repository → Event. Reusable across POS, API, Import, Automation |

**Why before the event bus:** Every event must originate from a single, reusable business service — not from UI-facing composables. This makes future APIs, batch imports, barcode scanners, webhooks, and automation trivial to add.

**Services to extract:**
- `SalesService.completeSale()` — replaces `usePayment()`
- `InventoryService.receiveStock()` — replaces direct composable calls
- `CustomerService.updateDebt()` — centralizes credit logic
- `StaffService.recordShift()` — unifies shift management
- `ExpenseService.recordExpense()` — standardizes expense flow

**Acceptance Criteria:**
- [ ] Zero business logic in Vue components
- [ ] All composables are thin wrappers around services
- [ ] Services are pure TypeScript, framework-agnostic
- [ ] Services publish domain events (preparation for WAFI-140)
- [ ] Unit tests for all services (Vitest, >80% coverage)
- [ ] Services work offline (Dexie-backed queue)

---

### Phase 2B: Event Platform Core (Weeks 10–12)

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-140 | Business Event & Automation Platform | P0 | 3 sprints | Event bus, 26+ canonical events, subscribers, idempotency, offline replay, security |

**Architecture Principle:**
```
User Action
     │
     ▼
Business Service (WAFI-152)
     │
     ▼
Domain Event Published
     │
┌────┼────┬────────┬──────────┐
▼    ▼    ▼        ▼          ▼
Read  Audit  Notify   Reports   Analytics
Model Log
▼     ▼      ▼        ▼          ▼
Dash  Staff  Owner    Auto      Insights
board Stats  Alert    Reports   (POS Brain)
```

**Golden Rules (from Staff Engineer review):**
1. **Events NEVER mutate business data** — Subscribers only update caches, analytics, notifications, reports, indexes, read models. Inventory, customer balance, ledger entries happen in the transaction itself.
2. **Domain Events vs. Integration Events** — `sale.completed` = Domain Event. `owner_notification.requested` = Integration Event. Separate streams, separate storage, separate retention.
3. **Event Naming Convention** — Past tense, lowercase, dot notation: `sale.completed`, `inventory.received`, `shift.closed`. No abbreviations, no UI terminology, no "clicked" or "saved".
4. **Event Versioning Policy** — Never modify payload. Create v2. Support both. Deprecate after migration. Documented in WAFI-142.
5. **Telemetry Events are separate** — Printer errors, Bluetooth status, sync retries belong to Telemetry Events, not Business Events.

**Canonical Events (26+):**

| Domain | Events |
|---|---|
| Sale | `sale.completed`, `sale.voided`, `sale.returned`, `sale.discounted` |
| Inventory | `inventory.adjusted`, `stock.received`, `stock.taken` |
| Customer | `customer.debt_changed`, `installment.due_paid`, `credit.limit_changed` |
| Cash | `cash.movement_recorded`, `shift.opened`, `shift.closed`, `drawer.varianced` |
| Staff | `settlement.paid`, `staff.ledger_entry_added`, `staff.performance_updated` |
| Product | `product.price_changed`, `product.cost_updated`, `product.created` |
| Supplier | `supplier.order_placed`, `supplier.receiving_posted` |
| System | `user.authenticated`, `device.registered`, `sync.completed` |

**Security Layer (critical):**
- `staff_id` in event payload validated against authenticated JWT
- Cashier cannot publish `sale.completed` for another cashier's sale
- Cashier cannot subscribe to `staff.ledger_entry_added` (owner-only)
- Cross-tenant isolation enforced by PowerSync sync rules + RLS
- Rate limiting: max 100 events/minute per `staff_id`
- Event bus RLS policies on `events` and `event_subscriptions` tables

**Phased Delivery:**
- **Sprint 1:** Core bus + 10 critical events + basic subscribers
- **Sprint 2:** Remaining 16 events + idempotency + offline replay
- **Sprint 3:** Security hardening + event contract tests + performance validation

---

### Phase 2C: Automation & Intelligence (Weeks 13–14)

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-150 | Automatic Audit Coverage | P1 | 1 sprint | Every business event → automatic audit entry, 100% coverage |
| WAFI-143 | Cross-Feature Automation | P1 | 2 sprints | Sale finishes → Dashboard → Staff → Profit → Notifications → Audit → Daily Summary (all automatic) |
| WAFI-144 | Automatic Insights | P1 | 2 sprints | "Sales are 18% lower than last Tuesday" — conclusions, not numbers |
| WAFI-145 | Owner Notification Center | P1 | 1.5 sprints | Important only: "Ahmed applied 30% discount", "Drawer variance $15". Deduplication + matrix configuration |
| WAFI-146 | Dashboard 2.0 | P1 | 2 sprints | "Why is revenue lower?" → 18 fewer transactions, Returns +7, Ahmed offline 45min |
| WAFI-142 | Business Event Registry | P1 | 0.5 sprint | Living documentation: Event | Producer | Consumers | Version | Schema. Includes auto-generated dependency graph (Phase 2) |

**Key Dependencies:**
- WAFI-150 depends on WAFI-140 (event bus must exist)
- WAFI-143 depends on WAFI-140 + WAFI-150
- WAFI-144/145/146 can parallel after WAFI-143

---

## MACRO-PHASE 3: ENTERPRISE SCALE (Weeks 15–24)
### From working system to platform. Read models, workers, rules engine, recovery.

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-151 | Projection Rebuild & Event Recovery | P1 | 1 sprint | `Rebuild Dashboard` → Replay Events → Recreate Read Models. Corruption recovery command |
| WAFI-153 | Read Models / CQRS Optimization | P1 | 1.5 sprints | `dashboard_metrics`, `profit_cache`, `inventory_summary`, `customer_summary`, `staff_summary`. Maintained by subscribers, not queried ad-hoc |
| WAFI-154 | Background Job & Worker Framework | P2 | 1.5 sprints | Immediate → Queue → Worker. PDF generation, daily summaries, batch reports don't block checkout |
| WAFI-155 | Feature Flag Framework | P2 | 0.5 sprint | `feature.dashboard_v2`, `feature.pos_brain`, `feature.insights`. Gradual rollout, not hard replace |
| WAFI-156 | Business Rules Engine | P2 | 2 sprints | `WHEN discount > 30% THEN owner_notification`. `WHEN customer_debt > 500 THEN block_credit`. Configurable, not hardcoded |
| WAFI-157 | Event Contract Testing | P2 | 0.5 sprint | Changing `sale.completed` payload → auto-verify all subscribers still deserialize correctly |
| WAFI-147 | Automatic Reports | P2 | 1.5 sprints | 13 reports on schedule: Daily Closing, Weekly Summary, Monthly Health, etc. |
| WAFI-148 | Internal Health Monitoring | P2 | 1 sprint | 10 metrics: sync failures, offline duration, printer errors, drawer mismatches. Owner-facing + team-facing |
| WAFI-149 | POS Brain | P2 | 2 sprints | "Revenue up 14% because drinks grew 32%" — causal explanations, not just correlational. Good product design, not AI |
| WAFI-026 | Sale Lifecycle State Machine | P1 | 1.5 sprints | `draft → items_added → discounted → payment_started → completed → printed → returned → voided → archived`. Explicit transitions, event per transition |
| WAFI-032 | KPI Ownership Per Feature | P1 | 0.5 sprint | Every feature → Primary KPI → Target → Measurement. Monthly review process |
| WAFI-033 | Product Constitution | P1 | 0.5 sprint | 12 Laws of WAFI. Immutable financial history, append-only ledgers, offline-first, no duplicated calculations |

**Enterprise Scale Total: 12 tickets | ~10 weeks**
**Critical Path: 151 → 153 → 154 → 156**

---

## UNIFIED IMPLEMENTATION TIMELINE

```
WEEK 1–2:   MACRO-PHASE 1 — Security Foundation
            WAFI-001 (RLS) — LEAD TRACK
            WAFI-002 (Real Auth) — PARALLEL TRACK
            WAFI-005 (Design System Freeze) — PARALLEL TRACK

WEEK 3–4:   MACRO-PHASE 1 — Auth, Devices, Audit
            WAFI-003 (Device Registration)
            WAFI-004 (Owner Bootstrap)
            WAFI-006 (Navigation Cleanup)
            WAFI-007 (Audit Event Wiring)

WEEK 5:     MACRO-PHASE 1 — Data Integrity
            WAFI-008 (Data Source Tagging)
            WAFI-009 (Stock-Take Collision)
            WAFI-010 (Installment + Returns)
            WAFI-011 (Discounts + Returns)

WEEK 6:     MACRO-PHASE 1 — Hardening Batch 1
            WAFI-012 (WhatsApp Analytics)
            WAFI-013 (Cost Freshness)
            WAFI-014 (Cross-Epic Review)
            WAFI-015 (Anomaly Detection)

WEEK 7:     MACRO-PHASE 1 — Hardening Batch 2
            WAFI-016 (Cash Movement Callout)
            WAFI-017 (Unified Money Owed)
            WAFI-018 (Staff Performance)
            WAFI-019 (Offline Banner)

WEEK 8:     MACRO-PHASE 1 — Hardening Batch 3 + Closure
            WAFI-020 (Performance Testing)
            WAFI-021 (Documentation)
            WAFI-022 (Deployment Checklist)
            WAFI-023 (Monitoring Setup)

WEEK 9:     MACRO-PHASE 2A — Business Services Layer
            WAFI-152 (Business Services) — LEAD TRACK
            WAFI-033 (Product Constitution) — PARALLEL

WEEK 10–12: MACRO-PHASE 2B — Event Platform Core
            WAFI-140 (Event Bus) — LEAD TRACK
            WAFI-026 (Sale Lifecycle State Machine) — PARALLEL
            WAFI-032 (KPI Ownership) — PARALLEL

WEEK 13–14: MACRO-PHASE 2C — Automation & Intelligence
            WAFI-150 (Automatic Audit) — LEAD TRACK
            WAFI-143 (Cross-Feature Automation) — PARALLEL
            WAFI-144 (Automatic Insights) — PARALLEL
            WAFI-145 (Owner Notification Center) — PARALLEL
            WAFI-146 (Dashboard 2.0) — PARALLEL
            WAFI-142 (Event Registry) — PARALLEL

WEEK 15:    MACRO-PHASE 3 — Recovery & Read Models
            WAFI-151 (Projection Rebuild) — LEAD TRACK
            WAFI-153 (Read Models / CQRS) — PARALLEL

WEEK 16–17: MACRO-PHASE 3 — Workers & Flags
            WAFI-154 (Background Workers) — LEAD TRACK
            WAFI-155 (Feature Flags) — PARALLEL
            WAFI-157 (Event Contract Tests) — PARALLEL

WEEK 18–19: MACRO-PHASE 3 — Rules Engine
            WAFI-156 (Business Rules Engine) — LEAD TRACK

WEEK 20–21: MACRO-PHASE 3 — Intelligence & Reports
            WAFI-147 (Automatic Reports) — LEAD TRACK
            WAFI-149 (POS Brain) — PARALLEL

WEEK 22–23: MACRO-PHASE 3 — Health & Monitoring
            WAFI-148 (Internal Health Monitoring) — LEAD TRACK
            Buffer for integration, bug fixes, polish

WEEK 24:    FINAL BUFFER — Integration, Performance, Sign-off
            End-to-end testing
            Security audit
            Performance validation
            Team sign-off on constitution
```

**Total Estimated Duration: 24 weeks (6 months)**
**Critical Path: 001 → 002 → 003 → 004 → 152 → 140 → 150 → 143 → 151 → 153 → 154 → 156**

---

## ARCHITECTURE DECISION RECORD (ADR)

### ADR-001: Business Services Before Event Bus
**Status:** Approved
**Context:** The Staff Engineer review identified that without a business services layer, events would originate from UI composables, making future APIs, imports, and automation difficult.
**Decision:** WAFI-152 (Business Services) executes BEFORE WAFI-140 (Event Bus).
**Consequences:** +1 week to timeline, but enables API, batch import, barcode scanner, webhook, and future automation to reuse the same business logic without duplicating code.

### ADR-002: Events Do Not Mutate Business Data
**Status:** Approved
**Context:** Replaying events to reconstruct state becomes dangerous if subscribers mutate business data (e.g., inventory, customer balance).
**Decision:** Subscribers may ONLY update caches, analytics, notifications, reports, indexes, and read models. All business mutations happen in the transaction BEFORE the event is published.
**Consequences:** Event replay is safe. Read models can be rebuilt at any time. Slightly more complex transaction logic, but dramatically simpler recovery.

### ADR-003: Domain Events vs. Integration Events
**Status:** Approved
**Context:** Mixing business events (`sale.completed`) with system events (`owner_notification.requested`) creates confusion and different retention needs.
**Decision:** Two separate event streams with separate storage and retention policies.
**Consequences:** Domain events retained for 7 years (audit/compliance). Integration events retained for 30 days (transient). Clearer semantics for subscribers.

### ADR-004: CQRS-Lite with Read Models
**Status:** Approved
**Context:** Dashboard querying 6+ tables every refresh is unsustainable at scale.
**Decision:** Explicit read models (`dashboard_metrics`, `profit_cache`, `inventory_summary`) maintained by event subscribers.
**Consequences:** Dashboard loads <200ms regardless of data volume. Read models can be rebuilt via WAFI-151. Slightly higher storage cost, but negligible compared to performance gain.

### ADR-005: Background Workers for Non-Critical Subscribers
**Status:** Approved
**Context:** PDF generation, daily summaries, and batch reports should not block checkout.
**Decision:** Immediate subscribers (inventory, audit) execute synchronously. Deferred subscribers (reports, PDFs, analytics) queue for background workers.
**Consequences:** Checkout remains fast (<1s). Background workers process queue offline. Requires WAFI-154 (Worker Framework).

---

## RISK REGISTER (Updated)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Server-side role enforcement breaks existing sync | High | Critical | Extensive staging testing; gradual rollout; WAFI-001 has 2 sprints |
| Business services extraction breaks existing flows | Medium | High | Comprehensive unit tests; feature flags (WAFI-155); parallel implementation |
| Event bus adds complexity beyond team capacity | Medium | High | Phased delivery (3 sprints); start with 10 events; document patterns |
| Read model corruption without recovery path | Medium | Critical | WAFI-151 (Projection Rebuild) is P1, not P2 |
| Background worker queue grows unbounded offline | Medium | Medium | Queue size limits; priority eviction; sync-on-reconnect flush |
| Feature flag framework delays if built from scratch | Low | Medium | Use existing library (e.g., LaunchDarkly SDK, Unleash, or simple config-based) |
| Business rules engine over-engineering | Medium | Medium | Start with simple IF-THEN registry; expand to DSL later |
| Performance on cheap Android unacceptable | Medium | High | WAFI-020 tests early; performance budget; read models reduce load |
| Team velocity drops during architecture work | Medium | Medium | Parallel tracks; clear priorities; WAFI-033 constitution aligns team |
| Cross-tenant event isolation failure | Low | Critical | Security tests in WAFI-140; penetration testing; RLS validation |
| Local Supabase stack couldn't start (`037_devices.sql` referenced a nonexistent `code` column; table had `device_code`) | **Resolved 2026-07-22** | High | Fixed: renamed `devices.device_code` → `code`, added `is_temporary`/`sync_status`. Also fixed a duplicate migration `038` and missing table `GRANT`s (see IMPLEMENTATION STATUS above) uncovered once the stack could finally start. Both pgTAP suites now execute and pass for real. |

---

## GLOBAL DEFINITION OF DONE (V3.0)

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
- [ ] **Event bus integration verified** (if applicable, per WAFI-140)
- [ ] **Signal documented in SIGNALS.md** (if applicable, per WAFI-142)
- [ ] **Constitution compliance verified** (per WAFI-033)
- [ ] **Business service layer used** (if applicable, per WAFI-152)
- [ ] **Read model updated** (if applicable, per WAFI-153)
- [ ] **Event contract tests pass** (if applicable, per WAFI-157)

---

## WHAT CHANGED FROM V2.0 TO V3.0

### New Tickets (from Staff Engineer review)

| Ticket | Title | Source |
|---|---|---|
| WAFI-152 | Business Services Layer | Staff Engineer #1 — "biggest improvement" |
| WAFI-151 | Projection Rebuild & Event Recovery | Staff Engineer #11 — "huge, you'll love having it" |
| WAFI-153 | Read Models / CQRS Optimization | Staff Engineer #6 — "almost nobody thinks about this" |
| WAFI-154 | Background Job & Worker Framework | Staff Engineer #9 — "generating PDF shouldn't block checkout" |
| WAFI-155 | Feature Flag Framework | Staff Engineer #8 — "gradual rollout, not hard replace" |
| WAFI-156 | Business Rules Engine | Staff Engineer #12 — "configurable, not hardcoded" |
| WAFI-157 | Event Contract Testing | Staff Engineer #7 — "someone renames field, five subscribers silently fail" |

### Restored from V2.0 (were missing in 11-ticket plan)

| Ticket | Title | Source |
|---|---|---|
| WAFI-026 | Sale Lifecycle State Machine | V2.0 TICKET-026 — "foundational for event quality" |
| WAFI-032 | KPI Ownership Per Feature | V2.0 TICKET-032 — "every feature has a KPI" |
| WAFI-033 | Product Constitution | V2.0 TICKET-033 — "12 Laws of WAFI" |

### Sequencing Changes

| Change | Rationale |
|---|---|
| WAFI-152 BEFORE WAFI-140 | Business services must exist before events originate from them |
| WAFI-151 as P1 (not P2) | Read model corruption without recovery is a critical risk |
| WAFI-026 parallel with WAFI-140 | Sale states are needed for meaningful domain events |
| WAFI-033 early (Week 9) | Constitution guides all subsequent architecture decisions |

---

## FINAL RECOMMENDATION

**Execute Macro-Phase 1 first (8 weeks).** These are production blockers. Without auth, RLS, and data integrity, there is no business.

**Then execute Macro-Phase 2 (6 weeks).** These transform WAFI from a feature collection into an event-driven platform. The business services layer (WAFI-152) is the most important architectural investment — it enables everything that follows.

**Then execute Macro-Phase 3 (10 weeks).** These are scale enablers. Read models, workers, and rules engines separate a working system from a platform.

**The sequence matters.** You cannot build an event bus on composables. You cannot rebuild read models without event replay. You cannot add automation without business services.

**At the end of 6 months, WAFI's architecture will be at the level expected from a modern, enterprise-grade offline-first retail platform.**
