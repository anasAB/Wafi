# WAFI-143 — Cross-Feature Automation Foundation — Design Spec

## Problem statement

WAFI-140 shipped the event bus (a canonical event catalog, 17 currently wired) and
WAFI-150 (in progress) adds the durable-subscriber primitive plus the first durable
consumer (audit). But per the `DOMAIN INTERACTION MATRIX`'s own Events row, there is
still **no user-facing consumer** of the bus — `dailyEventCountsProjection` writes to a
table nothing reads from yet, and every dashboard/staff/profit/notification surface in
the app today is pull-based (query-on-load or poll), not event-driven.

The roadmap's original one-liner for WAFI-143 — "Sale finishes → Dashboard → Staff →
Profit → Notifications → Audit → Daily Summary (all automatic)" — reads as "convert six
systems to event-driven in one ticket." That is too large a bite and duplicates work
across what should be six independently-reviewable tickets. This spec narrows WAFI-143
to what it actually needs to deliver: **the reusable subscriber pattern, proven end-to-end
by exactly two reference consumers with different failure/consistency profiles.**
Everything else (Staff, Profit, full Daily Summary) becomes its own later ticket that
copies this pattern instead of re-deriving it.

## Scope

**In scope:**

1. Publish `sale.discounted` as a new wired domain event — the roadmap's own canonical
   event list already names it (Sale domain: `sale.completed`, `sale.voided`,
   `sale.returned`, `sale.discounted`), but WAFI-140 never actually wired it. Published in
   the existing discount/payment business service, alongside the existing `sale.completed`
   publish.
2. **Dashboard consumer** (lightweight, best-effort): subscribes to `sale.completed`,
   folds `totalUsd` into a live "today's revenue" projection. Losing one event
   under-counts by one sale's revenue until the next full resync — acceptable, because
   this projection is explicitly a disposable, rebuildable read model, never a source of
   truth.
3. **Notification consumer** (durable): subscribes to `sale.discounted`, writes a row to
   a new `notifications` table when `belowCost || pinApproval` — reusing the exact
   significance criterion `useAuditLog.ts`'s `logDiscountApplied()` already uses to decide
   a discount is "sensitive." A missed notification is a real gap (the owner needed to
   know), so this consumer is durable, not best-effort.
4. A convention doc (`docs/architecture/EVENT_SUBSCRIBERS.md`) codifying the
   lightweight-vs-durable decision, the idempotency requirement for durable subscribers,
   the wiring location, and the minimum test bar — so WAFI-144/145/146 copy a pattern
   instead of re-deriving one.
5. Minimal UI: HomePage's revenue tile goes reactive for "today" only (a `db.watch` on the
   new local projection table, replacing its current pull query for that one tile only);
   a small unread-count badge + flat list for notifications. No filtering, categories,
   settings, or delivery channels — those belong to WAFI-145 (Owner Notification Center).

**Explicitly out of scope (deferred to later tickets, per the roadmap's own dependency
note that 144/145/146 follow 143):**

- Staff performance, Profit report, and Z-report/Daily Summary becoming event-driven.
- Any generic subscriber-factory abstraction (`createProjectionSubscriber()` etc.) —
  rejected as premature with only two data points; the codebase already deliberately
  avoided over-generalizing once (`runDurableSubscriber` did not replace
  `processProjectionAtMostOnce`, because best-effort and durable consumers have genuinely
  different needs). Revisit after a third consumer proves what's actually common.
- WhatsApp digest / browser-notification integration with the new `notifications` table —
  those are delivery mechanisms downstream of "a notification exists," not this ticket's
  job.
- ReportsPage's arbitrary date-range dashboard queries staying pull-based is fine — only
  the "today" home-screen tile goes live.

## Architecture

```
Payment/Discount business service
     │
     ├─▶ publishEvent('sale.completed', ...)   (existing)
     └─▶ publishEvent('sale.discounted', ...)   (new)
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
sale.completed              sale.discounted
        │                        │
        ▼                        ▼
dashboardRevenueProjection  notificationSubscriber
 (lightweight, best-effort)  (durable, replay-safe)
        │                        │
        ▼                        ▼
local_today_revenue_       notifications
projection (local-only)    (synced table)
        │                        │
        ▼                        ▼
HomePage revenue tile       HomePage notification badge/list
 (db.watch, reactive)        (db.watch, reactive)
```

**Governing principle (carried into the convention doc): subscribers produce durable
business facts, never deliver them.** `notificationSubscriber` writes exactly one thing —
a row in `notifications` — and stops. It does not call the Browser Notification API, does
not touch WhatsApp, does not know how the fact reaches the owner. Every delivery channel
(in-app badge, browser toast, WhatsApp digest, future email/SMS) is a separate consumer of
the `notifications` table, not of the event bus. This keeps business logic decoupled from
presentation/delivery — otherwise every future delivery channel would need its own event
subscriber duplicating the same trigger logic.

## `sale.discounted` event

```ts
export interface SaleDiscountedPayload {
  discountType: DiscountType        // existing type, from src/features/pos/discounts
  discountValue: number
  discountPercentage?: number       // included when the discount service already
                                     // computes it naturally (percentage-type discounts);
                                     // omitted — never derived/backfilled — for fixed-
                                     // amount discounts where it isn't a natural value.
                                     // Exists so every future consumer doesn't re-derive
                                     // discountValue / originalPrice inconsistently.
  finalPriceUsd: number
  belowCost: boolean
  pinApproval: boolean
}
```

Standard envelope fields (`entityId` = saleId, `staffId`, `shopId`, `occurredAt`,
`payloadVersion`) follow the same convention as every other WAFI-140 event. Added to
`EVENT_SENSITIVITY` in `domainEvent.types.ts` as `'public'` (mirrors `sale.completed`);
revisit if a future review decides discount details are report-sensitive.

## Dashboard consumer — `dashboardRevenueProjection.ts`

Mirrors `dailyEventCountsProjection.ts`'s existing shape exactly (lightweight subscriber +
`processProjectionAtMostOnce` for at-least-once-delivery safety): subscribes to
`sale.completed`, sums `totalUsd`/`totalSyp` into a new **local-only** table
`local_today_revenue_projection` (declared via `schema.ts`'s `Table`/`column` DSL, same as
WAFI-150's `local_event_processing_retries` — no server migration needed, since this table
is never synced).

```
local_today_revenue_projection
-------------------------------
shop_id, date, revenue_usd, revenue_syp, updated_at
```

Like `daily_event_counts` before it, this is a PowerSync `Table`/`column`-DSL table —
it always carries an implicit `id` UUID primary key, and the DSL has no way to declare a
composite `PRIMARY KEY(shop_id, date)` on top of that. `(shop_id, date)` is instead a
**logical** key, enforced the same way `dailyEventCountsProjection.ts` already enforces
`(shop_id, event_type, day)`: read-then-insert-or-update, not a SQL upsert — PowerSync
client tables are SQLite views over CRUD-queue triggers, and SQLite rejects `ON CONFLICT`
against a view. `dashboardRevenueProjection.ts` mirrors that exact query shape (`SELECT`
by `shop_id`+`date`; `UPDATE` the existing row or `INSERT` a new one).

**Documented explicitly, in code and in the convention doc: this projection is a
disposable read model.** It may drift under event loss and is never treated as a
source of truth for anything financial — reconciliation, reporting, and payouts continue
to read `sales`/`sale_payments` directly, exactly as today. If it's ever visibly wrong,
the fix is "rebuild from source," not "audit for a missing event."

HomePage's revenue tile switches from `useDashboardMetrics`'s pull query to a `db.watch`
on this table, filtered to today's date, for that one tile only. Every other tile and
every ReportsPage query keeps using the existing pull composables unchanged.

## Notification consumer — `notificationSubscriber.ts`

Durable (`runDurableSubscriber`, WAFI-150's primitive), following `auditSubscriber.ts`'s
exact shape:

```ts
export function mapEventToNotification(event: DomainEvent): NotificationInsert | null {
  if (event.type !== 'sale.discounted') return null
  const { belowCost, pinApproval, discountType, discountValue, finalPriceUsd } =
    event.payload as SaleDiscountedPayload
  if (!belowCost && !pinApproval) return null   // not "large" by the existing criterion

  return {
    type: 'discount.large_applied',
    title: 'خصم كبير مُطبَّق',   // Arabic-first per Sacred Rule #2
    message: /* localized summary using discountType/discountValue/finalPriceUsd */,
    entity_type: 'sale',
    entity_id: event.entityId,
    severity: belowCost ? 'CRITICAL' : 'WARNING',
    recipient_role: 'owner',
    recipient_staff_id: null,
  }
}
```

**Idempotency (explicit requirement, not deferred):** durable subscribers must be
replay-safe — redelivery of the same event must not duplicate side effects. Enforced here
identically to `auditSubscriber.ts`'s existing guard: check-then-insert against
`notifications.source_event_id` before writing, with the real backstop at sync-upload
time via a full (non-partial) unique index and `ON CONFLICT (source_event_id) DO NOTHING`
in `ops.ts`'s upload-path dedup extension.

`source_event_id` is `NOT NULL` here — unlike `audit_log`'s nullable/partial-index
version, every `notifications` row in this ticket's scope originates from exactly one
event; there is no legacy/manual-row case to accommodate yet. If WAFI-145 later
introduces manual or system-generated notifications with no originating event, that's the
point to revisit nullability — not before, since a premature `NULL` allowance here would
just be unused optionality.

## Data model & migrations

**New synced table `notifications`** (new Postgres migration, next unused number after
WAFI-150's — confirm at implementation time):

```sql
CREATE TABLE public.notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           TEXT NOT NULL,
  recipient_staff_id TEXT,
  recipient_role    TEXT,
  type              TEXT NOT NULL,
  title             TEXT NOT NULL,
  message           TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         TEXT,
  severity          TEXT NOT NULL DEFAULT 'INFO'
                      CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  source_event_id   UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX notifications_source_event_id_unique
  ON public.notifications (source_event_id);

CREATE INDEX idx_notifications_shop_created
  ON public.notifications (shop_id, created_at DESC);
```

`recipient_staff_id`/`recipient_role` are both nullable and not mutually exclusive by
constraint — a notification targets one specific staff member OR a whole role (today
always `'owner'`; the column exists now so manager/supervisor/accountant targeting in a
future ticket costs a row, not a migration).

**RLS**: shop-scoped like every other tenant table, but — unlike most tables in this
codebase — ALSO needs a second isolation axis: a policy restricting `SELECT` to rows
where `recipient_staff_id = auth_staff_id()` OR `recipient_role` matches the requesting
staff's role. This is new; no existing table needs per-recipient filtering within a shop.

**Open item flagged for implementation, not resolved here:** PowerSync's sync rules must
independently enforce this same per-recipient scoping. Server-side RLS alone is not
sufficient — a device's local PowerSync database downloads whatever its sync rule permits,
and a notification addressed to a different staff member arriving on-device (even if the
UI never renders it) is a confidentiality gap, the same class of issue the
`DOMAIN INTERACTION MATRIX`'s Identity/RLS notes already call out elsewhere.

**Acceptance criterion (see Testing below), not merely a note to check later**:
notifications addressed to another staff member must never appear in that device's local
database — sync rules need to scope `notifications` by recipient, not just by `shop_id`,
and this needs a real test against that behavior, not just a Postgres RLS policy review.

**New local-only table** (schema.ts only): `local_today_revenue_projection`, as described
above — disposable, never synced, no migration.

## UI wiring

- `HomePage.vue`: revenue tile's data source switches from `useDashboardMetrics.run()`'s
  pull query to a `db.watch` on `local_today_revenue_projection` for today's date. No
  other tile changes.
- New small notification affordance on `HomePage.vue` (or wherever the app's persistent
  header/nav lives): unread-count badge (`db.watch` count where `read_at IS NULL`) + a
  simple flat list (title, entity link, relative timestamp) in a lightweight
  drawer/popover. Marking read is a single `UPDATE notifications SET read_at = now()`.
  Explicitly no filtering, categorization, per-type settings, or delivery-channel
  configuration — WAFI-145's job.

## Wiring at app init

Both `start*()` functions follow the existing `App.vue` sweeper-registration pattern
(alongside `startRetryQueueSweeper`, `startDailyEventCountsProjection`,
`startEventTableCleanupSweeper`, and WAFI-150's `startAuditSubscribers`):

```ts
startDashboardRevenueProjection(shopId)
startNotificationSubscribers(shopId)
```

## Testing

- `sale.discounted` publish: unit test at the discount/payment service call site
  (payload shape correct, published alongside the existing `sale.completed` call).
- Dashboard projection: unit test mirroring `dailyEventCountsProjection.test.ts` (mocked
  `db`, feed a `sale.completed` row, assert the running total folds correctly). No
  crash-recovery test — lightweight/best-effort is the point of this category.
- Notification subscriber: unit test mirroring `auditSubscriber.test.ts` —
  `mapEventToNotification()` as a pure-function test (`belowCost`/`pinApproval` → a
  notification; neither → `null`) plus a `startNotificationSubscribers()` delivery test,
  plus an explicit redelivery/dedup test (same `source_event_id` delivered twice → exactly
  one row) — required because idempotency is an explicit design requirement here, not
  incidental.
- pgTAP: `notifications.source_event_id` unique-index + dedup test, mirroring WAFI-150's
  `wafi150_audit_dedup.test.sql` (unqualified, not partial, since the column is `NOT
  NULL` here); plus an RLS cross-check — staff A cannot see a notification targeted at
  staff B, and a role-targeted notification is visible to every staff member in that role
  within the same shop, and invisible cross-shop.
- **Acceptance criterion, not just an implementation note**: notifications addressed to
  another staff member never appear in that device's local (PowerSync/SQLite) database —
  verified against a real sync-rule test, not only the server-side pgTAP RLS check above.
  This is the concrete, checkable form of the "open cross-feature question" flagged below;
  the ticket is not done until this passes.
- Notification subscriber: an explicit unrelated-event test — feeding
  `mapEventToNotification()` a `sale.completed` event (or any type other than
  `sale.discounted`) must return `null`. Small, but protects the mapping boundary: a
  future refactor that widens the `switch`/`if` accidentally could otherwise generate
  notifications for events it was never meant to react to.

## `EVENT_SUBSCRIBERS.md` (new convention doc)

1. **Two subscriber categories**, each with a "use when / characteristics / example"
   block:
   - **Lightweight** (`useEventSubscription` + `processProjectionAtMostOnce`) — use for
     read models, dashboard metrics, analytics, temporary projections. No guaranteed
     delivery; the projection can be silently rebuilt from source data; losing an event is
     acceptable. Examples: `dailyEventCountsProjection`, `dashboardRevenueProjection`.
   - **Durable** (`runDurableSubscriber`) — use when a user action requires follow-up,
     compliance/audit trail, or an operational workflow depends on delivery. Persistent
     retry queue, idempotency required. Examples: `auditSubscriber`, `notificationSubscriber`.
2. **Decision rule**: "can this be silently rebuilt from source data with nobody worse
   off?" → lightweight. "would losing this delivery matter to the business?" → durable.
3. **Idempotency requirement** (durable only): a handler must be safe to invoke more than
   once for the same event. Standard mechanism: a `source_event_id` column + unique index
   on the target table (partial — `WHERE source_event_id IS NOT NULL` — if the table also
   has legacy/manual rows with no originating event, as `audit_log` does; unqualified if
   every row always originates from an event, as `notifications` does in this ticket),
   checked before insert in the handler and enforced again at sync-upload time in
   `ops.ts` — not a per-subscriber reinvention.
4. **Wiring convention**: every subscriber is a `start*()` function, called once in
   `App.vue`'s startup sequence after shop/device context resolves, alongside the
   existing sweepers.
5. **File location convention**: flat under `src/services/events/`, one file per
   subscriber, named for what it does, not which ticket added it.
6. **Minimum test bar**: a pure mapping-function test plus a delivery test for every
   subscriber; durable subscribers additionally require a redelivery/dedup test.

## Cross-Epic Edge-Case Checklist (design time)
```
Domains touched: Sales (publish site for sale.discounted, in the existing discount/payment
  flow — no schema change to sales/sale_line_items/sale_payments), Events (new wired event
  type; first two real consumers of the bus — closes the "none yet" gap on the Events row),
  Staff (recipient_role targeting + RLS on the new notifications table), Notifications (new
  domain — row added to DOMAIN INTERACTION MATRIX below).
Matrix rows consulted: Sales, Events, Staff.
Open cross-feature questions:
  - Returns interaction: a later return of a discounted sale does NOT retroactively change
    or remove its notification -- the notification is a point-in-time fact about the discount
    action, same immutable-history posture as audit_log. No coupling needed; confirmed, not
    open.
  - Customer Credit interaction: a discounted sale paid on credit already computes debt from
    the sale's final total via the existing Sales flow -- publishing sale.discounted is purely
    informational to the bus and does not change how debt is derived. No coupling; confirmed,
    not open.
  - Genuinely open: notifications need a second isolation axis beyond shop_id (per-staff /
    per-role visibility) that no other synced table in this codebase currently has. Server-side
    RLS can enforce this, but PowerSync's sync rules must ALSO scope which notification rows
    even reach a given device -- otherwise a staff member's local database downloads
    notifications addressed to someone else (readable at rest on-device even if the UI hides
    them). Needs explicit verification during implementation, not just a Postgres RLS policy.
```

## DOMAIN INTERACTION MATRIX updates (to apply to `AI_PRINCIPAL_ENGINEER_REVIEW.md`)

New row:

| Notifications | `notifications` | Sales (via `sale.discounted`), Staff (recipient targeting) | `notificationSubscriber`, (future) notification-center composable | HomePage badge (this ticket); full center is WAFI-145 |

Events row's "Reports/Dashboards affected" column updates from
`none yet (still no user-facing consumer — WAFI-143/144/145/146)` to:
`Dashboard (today's revenue tile), Notifications (this ticket's two consumers)`.

## Non-goals recap

Staff performance / Profit report / Z-report-Daily-Summary event-wiring, a generic
subscriber factory, WhatsApp/browser-notification delivery integration, and
ReportsPage's date-range queries going reactive are all explicitly deferred — see Scope
above.
