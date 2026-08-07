# WAFI-145: Owner Notification Center — Design Spec

Status: Approved (design phase) — 2026-08-07
Depends on: WAFI-140 (Business Event Platform), WAFI-143 (Cross-Feature Automation Foundation)
Blocks: none

## Problem

Important events happen but the owner doesn't know: anomalies, threshold breaches, unusual
activity are buried in data. WAFI-143 shipped a minimal `notifications` table and
`NotificationBell.vue` wired to exactly one event type (`sale.discounted`, large/below-cost
discounts only) as a placeholder, explicitly deferring filtering, categorization, per-type
settings, and delivery-channel configuration to this ticket.

## Vision

A notification system surfacing only important events — not spam — covering 11 notification
types, in-app only (no push/WhatsApp this ticket), with per-type owner-configurable
enable/disable and thresholds.

## Scope decisions (from brainstorming)

- **Delivery channel:** in-app only. Push (FCM) and WhatsApp are explicitly out of scope —
  separate follow-up tickets once this ticket's notification *logic* exists to feed them.
- **Settings:** per-type on/off + threshold editing (not just on/off).
- **The roadmap originally listed 12 notification types, but Below-Cost Sale is a severity
  variant of Discount Alert rather than a separate notification type** (see the Discount
  Alert rule below) — **yielding 11 actual notification types, final and unambiguous: the
  list in "Notification rules" below is the complete set to implement.** Several of the 11
  need new, previously-nonexistent subsystems built inline as part of this ticket (see "New
  subsystems required").
- **No generic rate limiting.** Considered and rejected: it's genuinely racy across two
  devices in the same shop (both could pass a "no recent notification" check and insert
  concurrently), and the real spam pressure is removed by threshold-crossing semantics
  (Low Stock, Customer Debt) plus the fact that most other event types are naturally
  one-shot-per-underlying-fact (a shift closes once, a sale is discounted once). Exact-replay
  protection is already solved by the existing `source_event_id` unique index.
- **"Quiet hours" renamed to after-hours suppression**, tied to the shop's own
  `open_time`/`close_time` rather than a separate fixed 10 PM–7 AM window. True
  independently-configurable quiet hours are out of scope for this ticket.
- **"Suggest disabling after 3 dismissals"** smart rule: cut (YAGNI — rate limiting +
  settings on/off already address spam; revisit only if real usage shows it's needed).
- **Settlement Ready dropped**, replaced by **Settlement Paid** (`settlement.paid`) — no
  settlement-generation/period concept exists in the codebase; building one is a separate
  feature, not a notification.

## New subsystems required

These don't exist anywhere in the codebase today and are being built inline as part of this
ticket, not deferred:

1. **`products.min_stock`** column (nullable; `NULL` = check disabled for that product) — Low
   Stock has no threshold field today.
2. **`shops.open_time` / `shops.close_time`** (nullable TIME columns) — no business-hours
   concept exists; needed for After-Hours Expense, Shift Late Close, and after-hours
   suppression. Validation: `open_time < close_time` enforced at save time — **overnight
   schedules (e.g. open 22:00, close 06:00) are unsupported this ticket**, rejected as a
   validation error rather than silently mishandled.
3. **`staff.pin_locked_out` event** — bridges the existing local-only PIN lockout
   (`usePinLockout.ts`, 5-attempt threshold, WAFI-012) into the event system for the first
   time. Reuses the existing 5-attempt threshold as-is (no new/independent 3-attempt
   constant to keep in sync).
4. **Sync-staleness check** — no background timer exists in this offline-first PWA;
   implemented as a foreground-triggered sweep (on app becoming active) comparing each
   `devices.last_seen_at` to now, not a periodic in-app timer. Accepted limitation: staleness
   is only detected while the owner's app is open.
5. **`customer.debt_changed` credit-sale producer** — today this event only fires on returns
   (debt decreases). Extended to also fire from the sales flow (`sales.service.ts`, which
   already computes `creditTotal`) on credit sales, with a positive `deltaUsd` and an
   explicit `reason: 'credit_sale'`.
6. **`notification_settings` table** — per-shop, per-type enable/disable + typed threshold
   storage.

## Data model & migrations

```sql
-- products: low-stock threshold
ALTER TABLE public.products ADD COLUMN min_stock INTEGER;
-- NULL = check disabled. No backfill; existing products don't suddenly alert.

-- shops: business hours
ALTER TABLE public.shops ADD COLUMN open_time TIME;
ALTER TABLE public.shops ADD COLUMN close_time TIME;
ALTER TABLE public.shops ADD CONSTRAINT shops_hours_order
  CHECK (open_time IS NULL OR close_time IS NULL OR open_time < close_time);
-- NULL/NULL = no operating-hours checks for that shop (After-Hours Expense, Shift Late
-- Close, after-hours suppression all skip). Overnight schedules unsupported: the CHECK
-- rejects open_time >= close_time outright.

-- notifications: acknowledgment for CRITICAL rows (distinct from read_at)
ALTER TABLE public.notifications ADD COLUMN acknowledged_at TIMESTAMPTZ;

-- notification_settings: sparse per-type overrides
CREATE TABLE public.notification_settings (
  shop_id        TEXT NOT NULL,
  type           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  threshold_json JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, type)
);
-- Sparse by design: a missing row resolves to the type's hardcoded default (enabled=true,
-- default threshold). A row is written only when the owner overrides something — not
-- pre-seeded for all 11 types × every shop.
```

RLS: `notification_settings` follows the same shop-scoped pattern as other owner-config
tables (`shops`); `notifications.acknowledged_at` updates follow the existing
`notifications_update_scoped` policy (already permits recipient-scoped UPDATE).

`threshold_json` is untyped at the database level but structurally typed in TypeScript.
**11 notification types ≠ 11 shop-level settings** — `inventory.low_stock` is a real
notification type but has no shop-level setting at all (its threshold is `products.min_stock`,
per product); the two are deliberately separate types so that distinction is explicit rather
than papered over with a no-op settings entry:

```ts
// All 11 notification types that can produce a `notifications` row.
type NotificationType =
  | 'discount.large_applied'
  | 'drawer.variance'
  | 'customer.debt_threshold'
  | 'inventory.low_stock'
  | 'shift.late_close'
  | 'expense.after_hours'
  | 'sale.large_return'
  | 'staff.pin_locked_out'
  | 'device.sync_stale'
  | 'device.registered'
  | 'settlement.paid'

// Only the types with shop-level settings (i.e. NOT 'inventory.low_stock', whose threshold
// lives on products.min_stock instead) appear in this union — one row per shop per type in
// notification_settings, keyed by `type`.
type NotificationTypeSettings =
  | { type: 'discount.large_applied'; discountPercentCap: number }
  | { type: 'drawer.variance'; varianceUsdCap: number }
  | { type: 'customer.debt_threshold'; dailyDebtUsdCap: number }
  | { type: 'shift.late_close'; graceMinutes: number }
  | { type: 'sale.large_return'; refundUsdCap: number }
  | { type: 'device.sync_stale'; staleHours: number }
  // after-hours expense, cashier lockout, new device, settlement paid: binary, no threshold
  | { type: 'expense.after_hours' | 'staff.pin_locked_out' | 'device.registered' | 'settlement.paid' }
```

## Notification rules

Architecture: **event-driven notification rules are evaluated at the source event's
subscriber boundary; multiple rules may react to the same source event, each producing at
most one notification per underlying event.** State-derived rules run at a defined trigger
point instead of a subscriber, and are documented separately in `EVENT_SUBSCRIBERS.md` as
derived checks — not added to the domain event registry, since they aren't events.

Uniform evaluation order for every rule: **enabled? → NO: stop (threshold logic never runs)
→ YES: evaluate threshold/crossing logic → after-hours suppression (non-CRITICAL only) →
insert.**

**Durability:** all event-driven notification subscribers (section A below) use
`runDurableSubscriber` (WAFI-150's primitive), **regardless of severity.** A notification is
a durable business side effect, not a disposable projection (`useEventSubscription`'s
best-effort tier is for read-model/projection work, not this); therefore delivery must be
at-least-once and retryable whether the type is INFO, WARNING, or CRITICAL. Severity controls
presentation and acknowledgment requirements (see Notification Center UI), not subscriber
durability — making durability conditional on severity would force a severity debate onto
every future notification type just to decide its infrastructure. Durable handlers remain
replay-safe via the existing `source_event_id` unique index, same as today's
`handleDiscountEvent`. State-derived checks (section B) have no source event to replay from
and are not subscribers; they run at their trigger point on a best-effort basis (a missed
foreground check is caught at the next app open, and Low Stock's crossing logic already
re-evaluates on every subsequent stock-affecting event).

### A. Event-driven

| Type | Source event | Rule | Severity |
|---|---|---|---|
| Discount Alert | `sale.discounted` | `belowCost` OR `discountPercentage > cap` | CRITICAL if `belowCost`, else WARNING |
| Drawer Variance | `shift.closed` | `\|variance\| > varianceUsdCap` (default $15) | CRITICAL |
| Customer Debt | `customer.debt_changed` where `payload.reason === 'credit_sale' && deltaUsd > 0` | daily cumulative credit-sale debt for the shop crosses from `<= cap` to `> cap` (default $500) — one notification per crossing per day, not per sale | CRITICAL |
| Shift Late Close | `shift.closed` | event's `occurredAt` (not device local time) later than `shops.close_time + graceMinutes` (default 15) | WARNING |
| After-Hours Expense | `expense.recorded` | event's `occurredAt` outside `[open_time, close_time]` | WARNING |
| Large Return | `sale.returned` | `refundAmountUsd > refundUsdCap` (default $100) | WARNING |
| Cashier Lockout | `staff.pin_locked_out` (new) | always | CRITICAL |
| New Device | `device.registered` | always | INFO |
| Settlement Paid | `settlement.paid` | always | INFO |

Discount Alert is **one rule, one notification type**, severity-routed by `belowCost` — not
two separate notifications for the same underlying `sale.discounted` occurrence.

### B. State-derived (not event subscribers)

| Type | Trigger point | Rule | Severity |
|---|---|---|---|
| Low Stock | `inventory.adjusted` / `stock.received` handler | resulting current stock crosses from `> min_stock` to `<= min_stock` on this event (boundary inclusive — `min_stock` itself counts as low); disabled entirely if `min_stock IS NULL` | WARNING |
| Sync Failure | app-foreground | any device with `last_seen_at` older than `staleHours` (default 2h) not already notified for this staleness episode | INFO |

Low Stock crossing example (`min_stock = 5`): `6 → 4` fires; `4 → 3` does not (already below);
`3 → 6` resets (crossed back above); `6 → 5` fires again (crossed down through the boundary).

## Notification Center UI

- **`NotificationBell.vue`** (extends WAFI-143's version): unread-count badge (`db.watch`),
  dropdown of most-recent notifications with severity color, links to the full center.
- **`NotificationCenterScreen.vue`**: full list; filter tabs All | Unread | Critical | Today;
  mark-all-read; detail view (title, body, entity link, timestamp); CRITICAL rows show a
  distinct **Acknowledge** action (`acknowledged_at`) separate from read/dismiss; 30-day
  window. No free-text search — the four filters cover the real use cases over 30 days of
  data.
- **`NotificationSettingsScreen.vue`**: one row per type in `NotificationTypeSettings` (10 of
  the 11 — everything except Low Stock), enable/disable toggle + its typed threshold field(s)
  where applicable (After-Hours Expense, Cashier Lockout, New Device, Settlement Paid are
  binary — no threshold UI). Low Stock has no row here at all: it has no shop-level setting,
  since its threshold is per-product `min_stock` on the product edit form.
- Business hours (`open_time`/`close_time`) editable from shop settings, with the
  `open_time < close_time` validation surfaced as a form error.

### Deep-link routing

**Every notification type that references an entity must resolve to a deterministic in-app
destination when selected** — opening the exact underlying record, not just the generic
center. Types with no meaningful entity destination are exempt; the table below is the
complete destination mapping (no type defaults to "just open the list"):

| Type | `entity_type` | Destination |
|---|---|---|
| Discount Alert | `sale` | Sale detail |
| Drawer Variance | `shift` | Shift detail |
| Customer Debt | `customer` | Customer detail |
| Low Stock | `product` | Product detail |
| Shift Late Close | `shift` | Shift detail |
| After-Hours Expense | `expense` | Expense detail |
| Large Return | `return` | Return/sale detail |
| Cashier Lockout | `staff` | Staff detail |
| Sync Failure | `device` | Device detail |
| New Device | `device` | Device detail |
| Settlement Paid | `staff` (settlement's owning staff member) | Staff settlement detail |

The subscriber's only job is populating the existing `entity_type`/`entity_id` columns
correctly (e.g. `{ entity_type: 'shift', entity_id: shiftId }` for Drawer Variance) — it has
no knowledge of Vue routes. Routing is entirely the frontend's concern: a
`entity_type + entity_id → route` lookup owned by the Notification Center UI, kept as one
small mapping table in the frontend layer rather than scattered per-component `if` checks.
This keeps the domain/event layer independent of presentation, matching how `entity_type`/
`entity_id` are already used by `audit_log`.

## Cross-Epic Edge-Case Checklist (design time)

Domains touched: Sales (discounts, returns, credit sales), Staff (shifts, PIN lockout,
settlements), Inventory (stock levels), Expenses, Devices, Customer Credit, Notifications
(this domain), Shops (new business-hours config)

Matrix rows consulted: Notifications row (existing — extends `notificationSubscriber`),
Customer Credit row (extending the `customer.debt_changed` producer), Staff row (new
`pin_locked_out` event, first event sourced from client-local-only state)

Open cross-feature questions:
- `customer.debt_changed` now has two producers (returns-decrease, credit-sale-increase)
  distinguished by `reason`. The Customer Credit domain row needs updating to list both
  producers, and any other consumer of this event type must not assume single-reason
  semantics.
- `staff.pin_locked_out` is the first event sourced from state that isn't synced across
  devices (PIN lockout is deliberately per-device, per WAFI-012). The same staff member
  locking out on two different devices produces two independent notifications — this is
  correct (each is a real occurrence), but is worth flagging so it isn't mistaken for a
  dedup bug later.
- `shops.open_time`/`close_time` is new shop-level config with no other consumer yet.
  Flagged as a new DOMAIN INTERACTION MATRIX row so a later ticket (e.g. WAFI-146 Dashboard)
  doesn't duplicate this concept.

## Explicitly out of scope

- Push notifications (FCM) and WhatsApp delivery — follow-up tickets.
- Generic cross-type rate limiting / "3+ similar → one summary" batching.
- "Suggest disabling after 3 dismissals" smart rule.
- True independently-configurable quiet hours (separate from business hours).
- Overnight business-hour schedules (open time > close time).
- Settlement Ready (period-end trigger) — no settlement-generation concept exists.
- Free-text search over notification history.
