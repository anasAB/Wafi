# WAFI Event-Driven Platform Implementation Plan
## Version: 1.0 | Date: 2026-07-21 | Status: APPROVED FOR EXECUTION

> **Source:** Principal Product Manager / Staff Engineer roadmap feedback
> **Context:** WAFI-122 (Security) and WAFI-138 (Staff Settlement) are complete. Architecture is excellent. Next phase: integrated retail operating system.
> **Philosophy:** Every feature produces events. Nothing depends directly on anything else.

---

## EXECUTIVE SUMMARY

This plan transforms WAFI from a collection of features into an **integrated retail operating system**. It is organized into **11 epics**, prioritized by dependency order.

| Epic | Code | Priority | Goal | Estimated |
|---|---|---|---|---|
| WAFI-140 | Business Event & Automation Platform | P0 | Foundation for everything | 3 sprints |
| WAFI-141 | Security Completion | P0 | Close remaining gaps | 0.5 sprint |
| WAFI-142 | Business Event Registry | P1 | Document all events | 0.5 sprint |
| WAFI-143 | Cross-Feature Automation | P1 | Auto-update everything | 2 sprints |
| WAFI-144 | Automatic Insights | P1 | Conclusions, not numbers | 2 sprints |
| WAFI-145 | Owner Notification Center | P1 | Important events only | 1.5 sprints |
| WAFI-146 | Dashboard 2.0 | P1 | Executive intelligence | 2 sprints |
| WAFI-147 | Automatic Reports | P2 | Generate on schedule | 1.5 sprints |
| WAFI-148 | Internal Health Monitoring | P2 | Support before complain | 1 sprint |
| WAFI-149 | POS Brain | P2 | Explain, don't display | 2 sprints |
| WAFI-150 | Automatic Audit Coverage | P1 | Every action audited | 1 sprint |

**Total Estimated Duration: 17 weeks (4 months)**
**Critical Path: WAFI-141 → WAFI-140 → WAFI-142 → WAFI-143 → WAFI-144 → WAFI-146**

---

## ARCHITECTURE PRINCIPLE

```
               User Action
                    │
                    ▼
             Business Service
                    │
                    ▼
          Business Event Published
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
 Dashboard      Audit Log      Notifications
     ▼              ▼              ▼
 Reports      Employee Stats   Automation
     ▼              ▼              ▼
  Analytics    Insights      Future AI
```

**Golden Rule:** Everything becomes connected. Nothing depends directly on anything else.

---

## WAFI-141: SECURITY COMPLETION
### Priority: P0 | Foundation for all future work

---

### WAFI-141: Finish WAFI-122 (Server-Side Security Remaining Gaps)
**Type:** Epic | **Estimated:** 0.5 sprint | **Assignee:** Backend Lead

**Problem:** WAFI-122 is mostly done but has remaining gaps that block safe building of future features.

**Acceptance Criteria:**
- [ ] Complete RLS policy audit on ALL tables (including new ones from WAFI-138, WAFI-100, etc.)
- [ ] Verify `permissions` JSON blob is validated by RLS, not just read by client
- [ ] Penetration test: extract JWT, attempt unauthorized reads via curl/Postman
- [ ] Verify manager with `can_view_reports: false` is blocked by RLS (not just UI)
- [ ] Verify cashier cannot SELECT aggregate profit/revenue data across shifts
- [ ] Document RLS policy matrix in `SECURITY.md`
- [ ] All future features (Staff Settlement, Financial Dashboard, Audit Explorer, Owner Notifications, Automatic Reports) can be built without reopening security

**Actions:**
1. Run `\dt` + `\d+` on all tables — verify RLS enabled
2. Test each role against each table (automated script)
3. Fix any gaps in new feature tables (WAFI-138, WAFI-100, etc.)
4. Run penetration test
5. Document matrix
6. Sign off: "Security is closed for future features"

**Definition of Done:**
- [ ] All tables have verified RLS policies
- [ ] Automated test: role × table = permission matrix
- [ ] Penetration test passed
- [ ] Security review signed off
- [ ] Zero regression on existing sync behavior

**Dependencies:** None (WAFI-122 mostly done)
**Blocks:** WAFI-140, WAFI-150, and all future features

---

## WAFI-140: BUSINESS EVENT & AUTOMATION PLATFORM
### Priority: P0 | The backbone of the entire product

---

### WAFI-140: Business Event & Automation Platform
**Type:** Foundational Epic | **Estimated:** 3 sprints | **Assignee:** Tech Lead + Backend Lead

**Problem:** Today every feature does something in isolation. There is no unified event system. Features call each other directly, creating tight coupling.

**Vision:** Every feature produces events. Every consumer subscribes to events. Nothing depends directly on anything else.

**Acceptance Criteria:**

**Core Event Bus:**
- [ ] `useEventBus.ts` composable implemented with publish/subscribe API:
  - `publish(eventType: EventType, payload: EventPayload): Promise<void>`
  - `subscribe(eventType: EventType, handler: EventHandler): Unsubscribe`
  - `unsubscribe(eventType: EventType, handler: EventHandler): void`
- [ ] Standard event payload schema:
  ```ts
  interface BusinessEvent {
    id: string;                    // UUID v4
    type: EventType;               // e.g. 'sale.completed'
    version: number;               // Schema version (starts at 1)
    timestamp: string;             // ISO 8601
    shop_id: string;
    staff_id: string;
    staff_name_snapshot: string;
    device_id: string;
    correlation_id: string;        // For tracing related events
    causation_id: string | null;   // ID of event that caused this one
    payload: Record<string, any>;  // Event-specific data
    meta: {
      source: string;              // Which composable/service produced this
      offline: boolean;            // Whether event was produced offline
      replay: boolean;             // Whether this is a replay
    };
  }
  ```
- [ ] Event persistence: all events stored in Dexie (local) + synced via PowerSync
- [ ] Event durability: events survive app kill, device restart, sync interruption
- [ ] Idempotency: every event handler must be idempotent (safe to replay)
- [ ] Offline replay: events queued offline, replayed in order on reconnect
- [ ] Event ordering: events within a shop are totally ordered by timestamp
- [ ] Exactly-once semantics: deduplication by `event.id` prevents double-processing

**Canonical Business Events (initial set — 20+ events):**
- [ ] `sale.completed` — Sale finalized, payment received
- [ ] `sale.voided` — Sale cancelled/voided
- [ ] `sale.returned` — Return processed
- [ ] `sale.discount_applied` — Discount approved and applied
- [ ] `inventory.adjusted` — Manual stock adjustment posted
- [ ] `inventory.received` — Supplier receiving posted
- [ ] `inventory.stock_take_completed` — Stock-take session finalized
- [ ] `inventory.low_stock` — Product hit minimum threshold
- [ ] `customer.created` — New customer added
- [ ] `customer.payment_recorded` — Customer made a payment
- [ ] `customer.debt_changed` — Customer balance updated
- [ ] `installment.plan_created` — New installment plan created
- [ ] `installment.due_paid` — Installment payment received
- [ ] `installment.due_overdue` — Installment missed deadline
- [ ] `expense.created` — New expense recorded
- [ ] `expense.voided` — Expense cancelled
- [ ] `shift.opened` — Cashier shift started
- [ ] `shift.closed` — Cashier shift closed with Z-report
- [ ] `cash.movement_recorded` — Pay-in/pay-out/drop recorded
- [ ] `staff.ledger_entry_added` — Staff advance/penalty recorded
- [ ] `staff.settlement_finalized` — Staff settlement calculated
- [ ] `staff.settlement_paid` — Staff settlement paid out
- [ ] `product.price_changed` — Product price updated
- [ ] `product.cost_updated` — Product cost updated via receiving
- [ ] `exchange_rate.changed` — Exchange rate updated
- [ ] `operator.switched` — Active operator changed
- [ ] `device.registered` — New device registered to shop
- [ ] `device.deactivated` — Device remotely deactivated

**Event Publishing from Every Major Feature:**
- [ ] `usePayment.ts` publishes `sale.completed` instead of calling dashboard/audit directly
- [ ] `useReturns.ts` publishes `sale.returned` instead of updating inventory directly
- [ ] `useStockAdjustments.ts` publishes `inventory.adjusted`
- [ ] `useStockTake.ts` publishes `inventory.stock_take_completed`
- [ ] `useReceivingSheet.ts` publishes `inventory.received`
- [ ] `useExpenses.ts` publishes `expense.created`
- [ ] `useCashierShift.ts` publishes `shift.opened` and `shift.closed`
- [ ] `useCashMovements.ts` publishes `cash.movement_recorded`
- [ ] `useCustomerPayments.ts` publishes `customer.payment_recorded`
- [ ] `useInstallmentPlans.ts` publishes `installment.plan_created` and `installment.due_paid`
- [ ] `useStaffLedger.ts` publishes `staff.ledger_entry_added`
- [ ] `useStaffSettlement.ts` publishes `staff.settlement_finalized` and `staff.settlement_paid`
- [ ] `useExchangeRate.ts` publishes `exchange_rate.changed`
- [ ] `useProducts.ts` publishes `product.price_changed` and `product.cost_updated`

**Subscribers (consumers that react to events):**
- [ ] Dashboard subscriber: updates metrics on `sale.completed`, `expense.created`, etc.
- [ ] Audit Log subscriber: writes audit entry on every financial event
- [ ] Inventory subscriber: decrements stock on `sale.completed`
- [ ] Notifications subscriber: generates owner alerts on important events
- [ ] Reports subscriber: invalidates cached reports on data changes
- [ ] Staff Performance subscriber: updates employee stats on `sale.completed`
- [ ] Daily Summary subscriber: accumulates data for end-of-day report
- [ ] Low Stock subscriber: checks thresholds on `sale.completed` and `inventory.adjusted`
- [ ] Customer Stats subscriber: updates customer analytics on `sale.completed`
- [ ] Profit Cache subscriber: recalculates profit on `sale.completed`, `inventory.received`, etc.

**Security:**
- [ ] Event bus respects RLS: cashier cannot publish events for another staff's actions
- [ ] Server-side validation: `staff_id` in payload must match authenticated `staff_id`
- [ ] Subscription authorization: role-based access to event types
- [ ] Event replay: owner-only for full replay, staff-only for their own events
- [ ] Cross-tenant isolation: Shop A events never visible to Shop B
- [ ] Rate limiting: max 100 events/minute per `staff_id`

**Testing:**
- [ ] Every critical action emits exactly one correct event
- [ ] Event replay produces identical state
- [ ] Offline events queue and replay in correct order
- [ ] Deduplication prevents double-processing
- [ ] Subscriber isolation: one failing subscriber doesn't break others

**Actions:**
1. Create `useEventBus.ts` with full API
2. Define `BusinessEvent` interface and `EventType` enum
3. Create `events/` directory with all event type definitions
4. Refactor `usePayment.ts` to publish `sale.completed`
5. Refactor `useAuditLog.ts` to subscribe instead of being called
6. Refactor `useDashboardMetrics.ts` to subscribe to events
7. Refactor `useInventory.ts` to subscribe to `sale.completed`
8. Add event persistence layer in Dexie
9. Add PowerSync sync rules for `business_events` table
10. Create event replay mechanism
11. Add event deduplication logic
12. Create subscriber error isolation (one fails, others continue)
13. Document event catalog in `EVENTS.md`
14. Write comprehensive event bus tests

**Definition of Done:**
- [ ] All 26+ canonical events defined and typed
- [ ] All major features publish events (zero direct composable calls for cross-cutting)
- [ ] All subscribers react correctly to events
- [ ] Event replay works: clear state, replay events, state reconstructs identically
- [ ] Offline queue and replay tested
- [ ] Deduplication tested
- [ ] Security tests: spoofing blocked, cross-tenant isolation, role-based subscription
- [ ] Performance: event publish + all subscribers <200ms total
- [ ] Architecture decision record (ADR) documenting event-first approach

**Dependencies:** WAFI-141 (Security)
**Blocks:** WAFI-142, WAFI-143, WAFI-144, WAFI-145, WAFI-146, WAFI-147, WAFI-148, WAFI-149, WAFI-150

---

## WAFI-142: BUSINESS EVENT REGISTRY
### Priority: P1 | Living documentation

---

### WAFI-142: Business Event Registry
**Type:** Epic | **Estimated:** 0.5 sprint | **Assignee:** Tech Lead + Product Manager

**Problem:** Events exist (WAFI-140) but are not documented. New team members don't know what events are available or who consumes them.

**Vision:** A living registry documenting every business event. Eventually 50–80 events. This document becomes priceless.

**Acceptance Criteria:**
- [ ] `EVENT_REGISTRY.md` living document with table format:
  ```
  | Event | Producer | Consumers | Payload Schema | Version | Status |
  |-------|----------|-----------|----------------|---------|--------|
  | sale.completed | Sales (usePayment.ts) | Dashboard, Audit, Inventory, Staff Performance, Daily Summary, Profit Cache, Low Stock, Customer Stats | { sale_id, amount_usd, amount_syp, items[], customer_id, staff_id } | v1 | Active |
  | inventory.adjusted | Inventory (useStockAdjustments.ts) | Audit, Dashboard | { product_id, old_qty, new_qty, reason, staff_id } | v1 | Active |
  | ... | ... | ... | ... | ... | ... |
  ```
- [ ] Auto-generation: build script parses event definitions and updates registry
- [ ] CI check: new event without registry entry fails build
- [ ] Registry includes: event type, producer composable, all consumers, payload schema, version, status (active/deprecated/planned)
- [ ] Event schema versioning: v1, v2, etc. with migration notes
- [ ] Deprecated events marked with replacement
- [ ] Planned events listed (future roadmap)
- [ ] Registry linked from README and onboarding docs

**Actions:**
1. Create `EVENT_REGISTRY.md` template
2. Document all 26+ canonical events from WAFI-140
3. Create `scripts/generate-event-registry.js`
4. Add CI check: registry completeness
5. Add schema versioning convention
6. Link from README

**Definition of Done:**
- [ ] All active events documented
- [ ] Auto-generation works
- [ ] CI blocks PRs with missing registry entries
- [ ] Team uses registry for onboarding
- [ ] Registry reviewed and accurate

**Dependencies:** WAFI-140 (Event Platform)
**Blocks:** None

---

## WAFI-143: CROSS-FEATURE AUTOMATION
### Priority: P1 | The app feels alive

---

### WAFI-143: Cross-Feature Automation
**Type:** Epic | **Estimated:** 2 sprints | **Assignee:** Full-Stack Lead

**Problem:** Today the owner must open the dashboard to see updated numbers. Reports are generated on demand. Nothing happens automatically.

**Vision:** When a sale finishes, everything updates automatically. The owner feels like the app is alive.

**Acceptance Criteria:**

**Automatic Cascade on Sale Completion:**
```
sale.completed event published
    ↓
    ├── Dashboard cache updates (revenue, transactions, basket size)
    ├── Employee stats update (sales count, revenue for active staff)
    ├── Profit cache recalculates (COGS, margin, net profit)
    ├── Notifications generated (if anomaly detected)
    ├── Audit log written (financial action recorded)
    ├── Daily summary accumulates (running totals for day)
    ├── Low stock check (if any item hit minimum)
    ├── Customer stats update (visit count, lifetime value)
    └── Future loyalty points calculated
```

**Automatic Cascade on Shift Close:**
```
shift.closed event published
    ↓
    ├── Z-report generated and cached
    ├── Staff performance snapshot saved
    ├── Cash reconciliation verified
    ├── Daily summary finalized
    ├── Notifications sent (variance alerts, etc.)
    └── Audit log written
```

**Automatic Cascade on Inventory Receiving:**
```
inventory.received event published
    ↓
    ├── Product cost updated (if new cost provided)
    ├── Profit cache invalidated (cost changed)
    ├── Low stock check (new stock may resolve alerts)
    ├── Dashboard metrics update
    └── Audit log written
```

**Caching Strategy:**
- [ ] Dashboard metrics cached in Dexie with TTL (5 minutes)
- [ ] Profit report cached with invalidation on `sale.completed`, `inventory.received`, `expense.created`
- [ ] Staff performance cached per shift, invalidated on `shift.closed`
- [ ] Customer stats cached, invalidated on `sale.completed`, `customer.payment_recorded`
- [ ] Cache invalidation is event-driven, not time-based
- [ ] Cache warming: pre-compute common reports during idle time

**Automation Rules (configurable):**
- [ ] Owner can enable/disable automatic updates per feature
- [ ] Owner can set update frequency (real-time, hourly, daily)
- [ ] Owner can configure notification thresholds

**Actions:**
1. Create `useAutoDashboard.ts` subscriber: updates cache on events
2. Create `useAutoProfitCache.ts` subscriber: recalculates profit on events
3. Create `useAutoStaffStats.ts` subscriber: updates employee performance
4. Create `useAutoDailySummary.ts` subscriber: accumulates daily totals
5. Create `useAutoLowStockCheck.ts` subscriber: checks thresholds
6. Create `useAutoCustomerStats.ts` subscriber: updates customer analytics
7. Add caching layer with TTL and event-based invalidation
8. Add automation settings screen
9. Test cascade: single sale → all subscribers update correctly

**Definition of Done:**
- [ ] Sale completion triggers all 9 automatic updates
- [ ] Shift close triggers all 6 automatic updates
- [ ] Inventory receiving triggers all 5 automatic updates
- [ ] Cache invalidation is event-driven (not polling)
- [ ] Owner can configure automation settings
- [ ] Performance: full cascade completes <500ms after event
- [ ] Manual test: complete sale → verify all updates within 1 second

**Dependencies:** WAFI-140 (Event Platform)
**Blocks:** WAFI-144, WAFI-146

---

## WAFI-144: AUTOMATIC INSIGHTS
### Priority: P1 | Conclusions, not numbers

---

### WAFI-144: Automatic Insights
**Type:** Epic | **Estimated:** 2 sprints | **Assignee:** Full-Stack Lead + Product Manager

**Problem:** Dashboards show raw numbers. Owners must interpret them. This is where WAFI stops being "another POS" and becomes a business partner.

**Vision:** Produce conclusions, not reports. Tell the owner what the numbers MEAN.

**Acceptance Criteria:**

**Sales Insights:**
- [ ] "Sales are 18% lower than last Tuesday" (vs. same day last week)
- [ ] "Sales are 12% higher than your 30-day average" (vs. rolling average)
- [ ] "This is your best Tuesday in 3 months" (vs. historical same-day)
- [ ] "Sales peaked at 2 PM today" (hourly distribution insight)
- [ ] "Weekend sales are 40% higher than weekdays" (pattern detection)

**Return Insights:**
- [ ] "Ahmed processed 8 of today's 12 returns" (staff attribution)
- [ ] "Return rate is 5.2%, above your 3% average" (trend detection)
- [ ] "Returns increased 40% this week" (week-over-week)
- [ ] "Most returns are for Product X" (product-level insight)

**Inventory Insights:**
- [ ] "Rice will run out in approximately 4 days" (demand forecast)
- [ ] "5 products haven't sold in 60 days" (dead stock detection)
- [ ] "Stock turnover is 2.3× this month, up from 1.8×" (efficiency trend)
- [ ] "Product Y sales increased 35% after price drop" (causal insight)

**Staff Insights:**
- [ ] "Ahmed's average sale is $45, team average is $38" (performance comparison)
- [ ] "Fatima has zero returns this week, team average is 3" (quality metric)
- [ ] "Omar gave 12 discounts today, his average is 4" (anomaly detection)

**Customer Insights:**
- [ ] "Customer debt increased $340 this week" (trend)
- [ ] "3 customers haven't purchased in 60 days" (churn risk)
- [ ] "Average collection time is 8 days, target is 7" (KPI tracking)

**Profit Insights:**
- [ ] "Profit margin is 18%, down from 22% last month" (margin trend)
- [ ] "Discounts reduced profit by $120 today" (impact quantification)
- [ ] "Supplier X's price increase reduced margin by 3%" (causal insight)

**Insight Format:**
- [ ] Every insight has: metric, comparison, trend arrow (↗ ↘ →), explanation, action link
- [ ] Insights are contextual (time of day, day of week, seasonality)
- [ ] Insights respect role (cashier sees none, manager sees team, owner sees all)
- [ ] Insights are computed from existing data (no new tables)
- [ ] Insights update automatically via event subscribers (WAFI-143)

**Actions:**
1. Create `useInsights.ts` composable
2. Define insight calculation rules with statistical baselines
3. Create `InsightCard.vue` component
4. Add insight section to Home dashboard
5. Add insight detail view (drill down)
6. Add insight configuration (enable/disable types)
7. Add insight history (last 30 days)
8. Compute baselines: 7-day, 30-day, 90-day rolling averages
9. Add seasonality detection (same day last week, not just yesterday)

**Definition of Done:**
- [ ] All 6 insight categories (sales, returns, inventory, staff, customer, profit) produce insights
- [ ] Each category has ≥3 insight types
- [ ] Baselines update automatically
- [ ] Insights are contextual and actionable
- [ ] Owner can configure which insights to see
- [ ] Performance: insights compute <500ms after event
- [ ] RTL and dark mode verified

**Dependencies:** WAFI-140 (Event Platform), WAFI-143 (Automation)
**Blocks:** WAFI-146 (Dashboard 2.0)

---

## WAFI-145: OWNER NOTIFICATION CENTER
### Priority: P1 | Important events only, not spam

---

### WAFI-145: Owner Notification Center
**Type:** Epic | **Estimated:** 1.5 sprints | **Assignee:** Frontend Lead

**Problem:** Important events happen but the owner doesn't know. Anomalies, threshold breaches, unusual activity — all buried in data.

**Vision:** A notification system that surfaces only important events. Not spam. Contextual, actionable, timely.

**Acceptance Criteria:**

**Notification Types (initial set):**
- [ ] **Discount Alert:** "Ahmed applied a 30% discount on Product X" (when discount > cap)
- [ ] **Drawer Variance:** "Drawer variance exceeded $15 in Shift #45" (when |variance| > threshold)
- [ ] **Customer Debt:** "New customer debt exceeded $500 today" (when daily new debt > threshold)
- [ ] **Low Stock:** "Product 'Rice 5kg' reached minimum stock (3 remaining)" (when stock ≤ min)
- [ ] **Shift Late Close:** "Shift closed 45 minutes late (closed at 9:45 PM, expected 9:00 PM)"
- [ ] **After-Hours Expense:** "Expense of $50 recorded outside business hours (11:30 PM)"
- [ ] **Large Return:** "Return of $120 processed (largest today)"
- [ ] **Below-Cost Sale:** "Sale below cost: Product Y sold at $8, cost is $10"
- [ ] **Cashier Lockout:** "Ahmed was locked out after 3 failed PIN attempts"
- [ ] **Sync Failure:** "Device 'B' hasn't synced in 2 hours"
- [ ] **New Device:** "New device 'C' registered to your shop"
- [ ] **Settlement Ready:** "Staff settlement for June is ready for review"

**Notification Properties:**
- [ ] Each notification has: title, body, severity (info/warning/critical), timestamp, action link, dismiss
- [ ] Critical notifications require acknowledgment (cannot just dismiss)
- [ ] Notifications are batched: max 1 per 5 minutes for same type
- [ ] Quiet hours: no non-critical notifications 10 PM – 7 AM
- [ ] Notification settings: owner can enable/disable per type, set thresholds
- [ ] Notification channels: in-app banner, push notification, WhatsApp (future)
- [ ] Notification history: 30-day log, searchable, filterable

**Notification Center UI:**
- [ ] Bell icon in header with unread count badge
- [ ] Dropdown panel showing recent notifications
- [ ] Full-screen notification center (accessible from header or Settings)
- [ ] Filter: All | Unread | Critical | Today
- [ ] Mark all as read
- [ ] Notification detail view with context and action

**Smart Notification Rules:**
- [ ] "Don't notify about the same issue twice in 1 hour"
- [ ] "If owner hasn't opened app in 4 hours, send push for critical events"
- [ ] "If 3+ similar events happen, batch into one summary notification"
- [ ] "If owner dismisses same type 3×, suggest disabling that notification"

**Actions:**
1. Create `useNotifications.ts` composable
2. Create `notifications` table: id, type, title, body, severity, read, acknowledged, created_at, action_url
3. Create `NotificationCenter.vue` component
4. Create `NotificationBell.vue` header component
5. Create `NotificationSettingsScreen.vue`
6. Define notification rules with thresholds
7. Wire to event bus subscribers (WAFI-140)
8. Add push notification support (Firebase Cloud Messaging)
9. Add batching and deduplication logic
10. Add quiet hours and smart rules

**Definition of Done:**
- [ ] All 12 notification types trigger correctly
- [ ] Notification center UI complete
- [ ] Settings screen allows configuration
- [ ] Batching and deduplication work
- [ ] Quiet hours respected
- [ ] Push notifications work on Android
- [ ] No notification spam in normal operation
- [ ] Performance: notification generated <100ms after event

**Dependencies:** WAFI-140 (Event Platform), WAFI-144 (Insights)
**Blocks:** None

---

## WAFI-146: DASHBOARD 2.0
### Priority: P1 | Executive intelligence, not metrics

---

### WAFI-146: Dashboard 2.0
**Type:** Epic | **Estimated:** 2 sprints | **Assignee:** Frontend Lead

**Problem:** Today's dashboard shows numbers. Tomorrow it should answer questions.

**Vision:** Executive intelligence. The dashboard explains WHY, not just WHAT.

**Acceptance Criteria:**

**Revenue Intelligence Card:**
- [ ] Instead of: "Revenue: $2,540"
- [ ] Show: "Revenue ↓12% vs. yesterday"
- [ ] Expand to: "Main reasons:
  • 18 fewer transactions (↓22%)
  • Returns increased by 7 (↑40%)
  • Average basket size: $28 (↓9%)
  • Ahmed's register was offline 45 minutes"
- [ ] Action links: "View transactions" | "View returns" | "View Ahmed's shift"

**Profit Intelligence Card:**
- [ ] Instead of: "Profit: $480"
- [ ] Show: "Profit margin: 18% (↓4pp vs. last week)"
- [ ] Expand to: "Main reasons:
  • Discounts increased: $120 today (↑60%)
  • Basket size flat: $28 (no change)
  • Supplier X raised prices: +15% on 3 products"
- [ ] Action links: "View discounts" | "View supplier costs"

**Inventory Intelligence Card:**
- [ ] Instead of: "Inventory value: $12,000"
- [ ] Show: "5 products haven't sold in 60 days"
- [ ] Expand to: List of dead stock with capital tied up
- [ ] Action links: "View dead stock" | "Create promotion"

**Staff Intelligence Card:**
- [ ] Instead of: "Staff sales: $2,540"
- [ ] Show: "Ahmed: highest sales ($980) but also highest discounts ($45)"
- [ ] Expand to: Per-staff breakdown with rankings
- [ ] Action links: "View Ahmed's performance" | "View discount report"

**Customer Intelligence Card:**
- [ ] Instead of: "Customer debt: $3,400"
- [ ] Show: "3 customers at churn risk (no purchase in 60 days)"
- [ ] Expand to: List with last purchase date and suggested action
- [ ] Action links: "Send reminder" | "View customer detail"

**Dashboard Layout:**
- [ ] Top row: 4 intelligence cards (revenue, profit, inventory, staff)
- [ ] Middle row: Quick actions (ring sale, add expense, record payment, open shift)
- [ ] Bottom row: Recent notifications + upcoming tasks
- [ ] All cards expandable (tap to see detail)
- [ ] All cards refresh automatically via events (WAFI-143)
- [ ] Pull-to-refresh for manual update
- [ ] Period selector: Today | This Week | This Month

**Comparison Mode:**
- [ ] "Compare to: Yesterday | Last Week | Last Month | Same Day Last Year"
- [ ] Visual indicators: green (better), red (worse), gray (same)
- [ ] Trend sparklines on each card

**Actions:**
1. Create `Dashboard2Screen.vue`
2. Create `RevenueIntelligenceCard.vue`
3. Create `ProfitIntelligenceCard.vue`
4. Create `InventoryIntelligenceCard.vue`
5. Create `StaffIntelligenceCard.vue`
6. Create `CustomerIntelligenceCard.vue`
7. Wire to insight composable (WAFI-144)
8. Wire to automation subscribers (WAFI-143)
9. Add expand/collapse animation
10. Add period selector
11. Add comparison mode
12. A/B test with old dashboard (owner feedback)

**Definition of Done:**
- [ ] All 5 intelligence cards implemented
- [ ] Each card shows insight + explanation + action links
- [ ] Cards expand to show detail
- [ ] Automatic refresh via events
- [ ] Period selector works
- [ ] Comparison mode works
- [ ] Owner test: 5 owners prefer new dashboard to old
- [ ] Performance: dashboard loads <2s on mid-range Android

**Dependencies:** WAFI-140 (Event Platform), WAFI-143 (Automation), WAFI-144 (Insights)
**Blocks:** None

---

## WAFI-147: AUTOMATIC REPORTS
### Priority: P2 | Generate on schedule

---

### WAFI-147: Automatic Reports
**Type:** Epic | **Estimated:** 1.5 sprints | **Assignee:** Backend Lead

**Problem:** Reports exist but must be generated manually. Owners forget. Data is available but not delivered.

**Vision:** Reports generated automatically and delivered to the owner on schedule. No new tables needed — only queries.

**Acceptance Criteria:**

**Report Types (13 reports):**
1. **Daily Closing Report** — generated at shift close or midnight
   - Total sales, transactions, average basket
   - Cash reconciliation: expected vs. actual
   - Top 5 products
   - Staff performance summary
   - Expenses summary
   - Customer payments received

2. **Weekly Summary** — generated every Sunday at 9 AM
   - Week-over-week comparison
   - Total revenue, profit, expenses
   - Best/worst performing days
   - Staff ranking
   - Inventory changes
   - Customer debt trend

3. **Monthly Business Health** — generated 1st of month at 9 AM
   - P&L summary (revenue, COGS, gross profit, expenses, net profit)
   - Margin trend
   - Top 10 products
   - Top 10 customers
   - Staff performance review
   - Inventory valuation
   - Cash flow summary

4. **Employee Summary** — generated per staff at shift close
   - Sales count and revenue
   - Average basket size
   - Discounts given
   - Returns processed
   - Cash variance
   - Hours worked

5. **Inventory Health** — generated weekly
   - Low stock alerts
   - Dead stock (no sales in 60/90/180 days)
   - Fast-moving SKUs
   - Slow-moving SKUs
   - Stock turnover rate
   - Shrinkage summary

6. **Discount Report** — generated weekly
   - Total discounts given
   - Discounts by staff
   - Discounts by product
   - Below-cost sales
   - Discount trend (week-over-week)

7. **Returns Report** — generated weekly
   - Total returns count and value
   - Returns by staff
   - Returns by product
   - Return reasons breakdown
   - Return rate trend

8. **Credit Report** — generated weekly
   - Total outstanding debt
   - New debt this week
   - Payments received
   - Overdue accounts
   - Average collection time
   - Risk score distribution

9. **Cash Flow Report** — generated daily
   - Cash in (sales + customer payments)
   - Cash out (expenses + pay-outs + settlements)
   - Net cash flow
   - Drawer reconciliation
   - Cash movement summary

10. **Profit Trend Report** — generated monthly
    - Daily profit for the month
    - Profit by product category
    - Profit by staff
    - Profit by day of week
    - Profit vs. target

11. **Top Customers Report** — generated monthly
    - Top 20 customers by revenue
    - Top 20 customers by visits
    - Top 20 customers by loyalty
    - At-risk customers (no visit in 60 days)
    - New customers this month

12. **Top Products Report** — generated monthly
    - Top 20 products by revenue
    - Top 20 products by quantity
    - Top 20 products by profit
    - Most discounted products
    - Most returned products

13. **Dead Stock Report** — generated weekly
    - Products with zero sales in 60/90/180 days
    - Capital tied up in dead stock
    - Suggested actions (discount, bundle, discontinue)

**Report Delivery:**
- [ ] Reports generated automatically on schedule
- [ ] Reports delivered via: in-app notification, WhatsApp PDF, email (future)
- [ ] Reports archived and searchable in Settings → Reports
- [ ] Reports exportable to PDF and Excel
- [ ] Report schedule configurable per shop

**Report Generation:**
- [ ] All reports use existing data (no new tables)
- [ ] Reports generated via event subscribers (WAFI-143)
- [ ] Reports cached after generation
- [ ] Report generation is idempotent (safe to re-run)

**Actions:**
1. Create `useAutoReports.ts` composable
2. Create `reports/` directory with one composable per report type
3. Create report generation scheduler
4. Create report delivery system (notification + WhatsApp)
5. Create report archive UI
6. Create report settings screen (schedule, delivery method)
7. Add PDF generation (using existing receipt PDF logic)
8. Add Excel export (using existing export logic)
9. Test each report on real data

**Definition of Done:**
- [ ] All 13 reports generate correctly
- [ ] Reports delivered on schedule
- [ ] Reports archived and searchable
- [ ] Export to PDF and Excel works
- [ ] Schedule is configurable
- [ ] Performance: report generates <3s on 1 year of data
- [ ] Owner test: 3 owners find reports useful

**Dependencies:** WAFI-140 (Event Platform), WAFI-143 (Automation)
**Blocks:** None

---

## WAFI-148: INTERNAL HEALTH MONITORING
### Priority: P2 | Support customers before they complain

---

### WAFI-148: Internal Health Monitoring
**Type:** Epic | **Estimated:** 1 sprint | **Assignee:** Backend Lead + QA Lead

**Problem:** Almost nobody builds this. WAFI should. Support customers before they complain.

**Vision:** Track system health metrics internally. Surface issues proactively. Be the first to know when something is wrong.

**Acceptance Criteria:**

**Health Metrics (10 metrics):**
1. **Sync Failures** — count of failed sync attempts per device per day
   - Alert if >5 failures per day per device
   - Track failure reasons (network, auth, conflict, timeout)

2. **Offline Duration** — average time devices spend offline per day
   - Alert if average >2 hours per day
   - Track by device and by shop

3. **Failed Receipts** — count of receipt generation/print failures
   - Alert if >3 failures per day
   - Track: printer disconnected, Bluetooth error, out of paper

4. **Duplicate Sales Prevented** — count of duplicate sales caught by idempotency
   - Alert if >10 per day (indicates UI bug)
   - Track by device

5. **Printer Errors** — count of printer connection errors
   - Alert if >5 per day
   - Track: Bluetooth not found, connection timeout, print failure

6. **Drawer Mismatches** — count of cash drawer variances
   - Alert if variance >$10 or >2% of sales
   - Track by shift and by cashier

7. **Barcode Failures** — count of unscanned/unrecognized barcodes
   - Alert if >20 per day
   - Track: no product found, scanner timeout, input focus stolen

8. **Average Checkout Time** — time from first item to sale completion
   - Alert if average >3 minutes
   - Track by cashier, by time of day

9. **Average Sale Duration** — time from sale start to payment
   - Alert if average >2 minutes
   - Track by cashier, by payment method

10. **Crash Recovery Count** — count of app crashes and recoveries
    - Alert if >3 per day per device
    - Track: crash type, recovery time, data loss (if any)

**Health Dashboard (internal, not customer-facing):**
- [ ] Internal dashboard at `/admin/health` (protected, owner-only)
- [ ] Real-time metrics for all 10 health indicators
- [ ] Shop-level and device-level breakdown
- [ ] Historical trend (7-day, 30-day)
- [ ] Alert configuration: threshold, notification channel, escalation
- [ ] Export health data for support analysis

**Proactive Support:**
- [ ] Automated daily health email to support team
- [ ] Automated alert to support when health metric exceeds threshold
- [ ] Health score per shop (0–100)
- [ ] "At-risk shops" list: shops with >3 health alerts in 7 days
- [ ] "Healthy shops" list: shops with zero alerts in 30 days

**Actions:**
1. Create `useHealthMonitoring.ts` composable
2. Create `health_metrics` table: metric, value, device_id, shop_id, timestamp
3. Create health metric collectors (one per metric)
4. Create internal health dashboard
5. Create alert system for support team
6. Create daily health report email
7. Add health score calculation
8. Test: simulate failures, verify alerts trigger

**Definition of Done:**
- [ ] All 10 health metrics tracked
- [ ] Internal dashboard shows real-time data
- [ ] Alerts trigger when thresholds exceeded
- [ ] Daily health email sent to support
- [ ] Health score calculated per shop
- [ ] At-risk shops identified correctly
- [ ] Support team uses dashboard for proactive outreach

**Dependencies:** WAFI-140 (Event Platform)
**Blocks:** None

---

## WAFI-149: POS BRAIN
### Priority: P2 | Explain, don't display

---

### WAFI-149: POS Brain
**Type:** Epic | **Estimated:** 2 sprints | **Assignee:** Full-Stack Lead + Product Manager

**Problem:** WAFI displays data. It doesn't explain it. This is where WAFI becomes genuinely differentiated.

**Vision:** The POS Brain explains what the data means. Not AI — good product design.

**Acceptance Criteria:**

**Revenue Explanation:**
- [ ] Instead of: "Revenue: $2,540"
- [ ] Show: "Revenue increased 14% because drinks sales grew 32%"
- [ ] Show: "Revenue fell because discounts increased while basket size stayed flat"
- [ ] Show: "Revenue is lower than usual because 2 of your top 5 products are out of stock"

**Profit Explanation:**
- [ ] Instead of: "Profit: $480"
- [ ] Show: "Profit fell because supplier X raised prices 20% on your best-selling product"
- [ ] Show: "Profit margin improved because you sold 40% more high-margin items today"
- [ ] Show: "Profit is flat despite higher sales because returns doubled"

**Inventory Explanation:**
- [ ] Instead of: "Inventory: 450 items"
- [ ] Show: "Five products haven't sold in 60 days. Consider a promotion."
- [ ] Show: "Product Y is selling 3× faster than last month. Consider ordering more."
- [ ] Show: "You have $2,400 tied up in dead stock. Here's what to do about it."

**Staff Explanation:**
- [ ] Instead of: "Ahmed: $980 sales"
- [ ] Show: "Ahmed processed the highest sales but also the highest manual discounts."
- [ ] Show: "Fatima has the fastest checkout time (1.2 min) but the smallest basket ($28)."
- [ ] Show: "Omar's return rate is 8%, 3× the team average. Consider retraining."

**Customer Explanation:**
- [ ] Instead of: "Customer debt: $3,400"
- [ ] Show: "3 customers owe 60% of all debt. Focus collection efforts on them."
- [ ] Show: "Your best customer hasn't visited in 3 weeks. Send them a reminder."

**Explanation Format:**
- [ ] Every explanation has: headline (what), detail (why), action (what to do)
- [ ] Explanations are conversational, not technical
- [ ] Explanations use the owner's language (Arabic/English)
- [ ] Explanations are evidence-based (show the numbers behind the conclusion)
- [ ] Explanations are actionable (always include a suggested next step)
- [ ] Explanations are not AI — they are rule-based causal inference

**Causal Inference Rules:**
- [ ] Revenue change → attribute to: transaction count, basket size, product mix, discounts, returns, staff availability
- [ ] Profit change → attribute to: margin mix, cost changes, discount volume, return volume, expense changes
- [ ] Inventory change → attribute to: sales velocity, receiving volume, stock-take adjustments, shrinkage
- [ ] Staff performance → attribute to: sales volume, discount rate, return rate, speed, accuracy

**Actions:**
1. Create `usePOSBrain.ts` composable
2. Create causal inference engine (rule-based, not ML)
3. Create explanation generators for each metric
4. Create `ExplanationCard.vue` component
5. Integrate into Dashboard 2.0 (WAFI-146)
6. Add "Why?" button to every metric card
7. Add evidence view (show the numbers behind the explanation)
8. Add action suggestion to every explanation
9. Test explanations with real shop owners
10. Iterate based on feedback

**Definition of Done:**
- [ ] All 5 explanation types (revenue, profit, inventory, staff, customer) implemented
- [ ] Each explanation has: headline, detail, evidence, action
- [ ] Explanations are conversational and actionable
- [ ] "Why?" button works on every metric card
- [ ] Owner test: 5 owners say explanations help them make decisions
- [ ] Explanations generate <1s after request
- [ ] RTL and dark mode verified

**Dependencies:** WAFI-140 (Event Platform), WAFI-144 (Insights), WAFI-146 (Dashboard 2.0)
**Blocks:** None

---

## WAFI-150: AUTOMATIC AUDIT COVERAGE
### Priority: P1 | Every action audited

---

### WAFI-150: Automatic Audit Coverage
**Type:** Epic | **Estimated:** 1 sprint | **Assignee:** Backend Lead

**Problem:** Audit log exists but coverage is incomplete. Some actions are not audited. Some audit events are manual, not automatic.

**Vision:** Every business event (WAFI-140) automatically creates an audit entry. No manual audit logging. 100% coverage.

**Acceptance Criteria:**

**Automatic Audit from Events:**
- [ ] `sale.completed` → automatic `audit_log` entry: `sale.completed`
- [ ] `sale.voided` → automatic `audit_log` entry: `sale.voided`
- [ ] `sale.returned` → automatic `audit_log` entry: `return.processed`
- [ ] `sale.discount_applied` → automatic `audit_log` entry: `sale.discount_applied`
- [ ] `inventory.adjusted` → automatic `audit_log` entry: `stock.adjusted`
- [ ] `inventory.received` → automatic `audit_log` entry: `receiving.created`
- [ ] `inventory.stock_take_completed` → automatic `audit_log` entry: `stock_take.completed`
- [ ] `customer.payment_recorded` → automatic `audit_log` entry: `customer.payment_recorded`
- [ ] `expense.created` → automatic `audit_log` entry: `expense.created`
- [ ] `expense.voided` → automatic `audit_log` entry: `expense.voided`
- [ ] `shift.opened` → automatic `audit_log` entry: `shift.opened`
- [ ] `shift.closed` → automatic `audit_log` entry: `shift.closed`
- [ ] `cash.movement_recorded` → automatic `audit_log` entry: `cash_movement.recorded`
- [ ] `staff.ledger_entry_added` → automatic `audit_log` entry: `staff_ledger.entry_added`
- [ ] `staff.settlement_finalized` → automatic `audit_log` entry: `staff_settlement.finalized`
- [ ] `staff.settlement_paid` → automatic `audit_log` entry: `staff_settlement.paid`
- [ ] `product.price_changed` → automatic `audit_log` entry: `product.price_changed`
- [ ] `exchange_rate.changed` → automatic `audit_log` entry: `exchange_rate.changed`
- [ ] `operator.switched` → automatic `audit_log` entry: `operator.switched`
- [ ] `device.registered` → automatic `audit_log` entry: `device.registered`
- [ ] `device.deactivated` → automatic `audit_log` entry: `device.deactivated`

**Audit Entry Format:**
- [ ] Every audit entry includes: event_id, event_type, timestamp, staff_id, staff_name_snapshot, shop_id, device_id, payload_summary
- [ ] Audit entries are immutable (append-only)
- [ ] Audit entries are searchable and filterable
- [ ] Audit entries are exportable

**Audit Coverage Verification:**
- [ ] Automated test: every business event produces exactly one audit entry
- [ ] Automated test: no audit entry is produced without a corresponding business event
- [ ] Coverage report: % of actions audited (target: 100%)
- [ ] Missing audit detection: alert if action occurs without audit

**Actions:**
1. Create `useAutoAudit.ts` subscriber: listens to all business events, writes audit entries
2. Refactor existing manual audit calls to use event subscriber
3. Add audit entry format validation
4. Add audit coverage tests
5. Add audit coverage report
6. Add missing audit detection
7. Verify all 26+ events produce audit entries

**Definition of Done:**
- [ ] All 26+ business events automatically produce audit entries
- [ ] Zero manual audit calls remain in composables
- [ ] Audit coverage: 100% of business actions
- [ ] Coverage tests pass
- [ ] Missing audit detection works
- [ ] Performance: audit write <50ms per event

**Dependencies:** WAFI-140 (Event Platform), WAFI-141 (Security)
**Blocks:** None

---

## IMPLEMENTATION TIMELINE

```
Sprint 1:    WAFI-141 (Security Completion)
             WAFI-150 (Automatic Audit Coverage) — parallel

Sprint 2–4:  WAFI-140 (Business Event & Automation Platform) — LEAD TRACK
             WAFI-142 (Event Registry) — parallel, week 3–4

Sprint 5–6:  WAFI-143 (Cross-Feature Automation)
             WAFI-144 (Automatic Insights) — parallel

Sprint 7–8:  WAFI-145 (Owner Notification Center)
             WAFI-146 (Dashboard 2.0) — parallel

Sprint 9–10: WAFI-147 (Automatic Reports)
             WAFI-148 (Internal Health Monitoring) — parallel

Sprint 11–12: WAFI-149 (POS Brain)
              BUFFER — Integration testing, bug fixes, polish
```

**Total Estimated Duration: 12 sprints (6 months)**
**Critical Path: WAFI-141 → WAFI-140 → WAFI-143 → WAFI-144 → WAFI-146 → WAFI-149**

---

## RISK REGISTER

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Event bus performance degrades with many subscribers | Medium | High | Async handlers, debounce, batching, subscriber isolation |
| Event schema changes break existing subscribers | Medium | Critical | Schema versioning, backward compatibility, migration tests |
| Offline event replay causes state inconsistency | Medium | Critical | Idempotency, ordering, deduplication, extensive testing |
| Dashboard 2.0 confuses owners used to old dashboard | Medium | Medium | A/B test, gradual rollout, feedback loop, revert option |
| Automatic reports generate too much noise | Medium | Medium | Configurable schedule, opt-out, batched delivery |
| Health monitoring creates privacy concerns | Low | Medium | Aggregate only, no individual tracking, opt-in |
| POS Brain explanations are wrong or misleading | Medium | High | Rule-based (not AI), evidence shown, owner feedback, manual override |

---

## GLOBAL DEFINITION OF DONE

For ANY ticket to be considered complete:

- [ ] All acceptance criteria met
- [ ] Unit tests pass (Vitest coverage >80% for new code)
- [ ] Integration tests pass
- [ ] **Event bus tests pass (publish → all subscribers react correctly)**
- [ ] **Audit coverage test passes (every action audited)**
- [ ] Manual QA on target device (cheap Android phone)
- [ ] RTL verified
- [ ] Dark mode verified
- [ ] Offline behavior verified (events queue and replay)
- [ ] Sync behavior verified
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Bundle size impact documented
- [ ] Security review (for financial/auth features)
- [ ] Documentation updated (EVENTS.md, EVENT_REGISTRY.md)
- [ ] PR reviewed by 2+ team members
- [ ] CHANGELOG.md updated

---

## FINAL ARCHITECTURE

```
               User Action
                    │
                    ▼
             Business Service
                    │
                    ▼
          Business Event Published
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
 Dashboard      Audit Log      Notifications
     ▼              ▼              ▼
 Reports      Employee Stats   Automation
     ▼              ▼              ▼
  Analytics    Insights      Future AI
```

**Everything becomes connected. Nothing depends directly on anything else.**
