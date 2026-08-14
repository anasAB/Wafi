# WAFI-156 — Business Rules Engine (Design Spec)

Date: 2026-08-14
Status: Approved (design), not yet implemented
Ticket: WAFI-156, Macro-Phase 3 (Enterprise Scale), P2, roadmap estimate 2 sprints

## 1. Scope

WAFI-156 generalizes WAFI-145's nine hardcoded notification rules into a
constrained, **data-driven business-rule evaluation layer** for
asynchronous notification policies. An authorized owner can change a
rule's condition, threshold, and enabled state through configuration —
no code deployment — for rules that fit the engine's fixed vocabulary.

Rules are expressed as:

```
field → transform → operator → threshold → action
```

`action` has exactly one supported value at ship time: `notify_owner`.
The vocabulary is **closed by design** — `field`, `transform`, and
`operator` are each a small fixed enum, not a parseable expression
string. There is no arbitrary business-logic language here, and none
is planned; expanding the vocabulary later is an explicit per-field
architectural decision, not a schema escape hatch.

### 1.1 The offline-first boundary (why enforcement is out of scope)

The roadmap line for this ticket includes an enforcement-shaped
example — `WHEN customer_debt > 500 THEN block_credit`. This is
**deliberately excluded from WAFI-156**, and the reason is
architectural, not a scheduling deferral:

- **Notification rules are eventually consistent.** A domain event
  fires after a transaction has already committed; the rule engine
  evaluates asynchronously, off a durable subscriber, against
  after-the-fact data. If the evaluation is late, retried, or
  evaluated against a slightly stale local read model, the worst case
  is a delayed or duplicate notification — never a wrong financial
  outcome.
- **A blocking rule changes the question being asked.** "Should this
  transaction be *allowed*" must have a single authoritative answer at
  the moment the transaction is accepted client-side — before it ever
  reaches an event. That requires: an authoritative (not merely
  locally-cached) value for whatever is being checked, a synchronous
  hook inside the write path (like `checkLowStockCrossing` today, not
  `runDurableSubscriber`), a defined behavior for two concurrent
  offline devices each independently evaluating the same rule against
  their own local state, and a defined behavior for what happens when
  the rule's configuration changes while a transaction is in flight
  offline. None of that is a "small addition" to an async notification
  engine — it is a separate consistency and transaction-architecture
  problem.
- Because WAFI is offline-first end to end, conflating these two
  models in one ticket would either quietly make notification rules
  block (unacceptable latency/availability regression) or quietly make
  a "blocking" rule merely advisory (defeats its purpose, and misleads
  whoever configures it into believing it's enforced).

**Decision:** WAFI-156 ships the advisory/asynchronous rule engine
only. Any future enforcement/synchronous rule capability
(`block_credit` and similar) is a **separate ticket** with its own
design — it needs a credit-limit config source (doesn't exist today),
a synchronous hook in `sales.service.ts`, and an explicit answer to
the concurrency questions above before it can be built safely.

### 1.2 Migration scope for the existing 9 WAFI-145 rules

Two of the nine existing rules migrate onto the new engine as the
end-to-end proof; the other seven remain exactly as they are today.
This is not a partial migration in progress — it is the intended
steady state until/unless a future ticket makes a deliberate case for
migrating an individual rule:

- **Migrate:** Large Return, Drawer Variance (see §3 for why these
  two).
- **Remain native, unchanged:** Low Stock, Cashier Lockout, New
  Device, Settlement Paid, After-Hours Expense, Customer Debt
  Threshold, Shift Late Close. Several of these have logic that does
  not fit the closed field/transform/operator/threshold vocabulary at
  all — Low Stock runs synchronously inside a write transaction (not
  event-driven), Customer Debt Threshold recomputes a shop-wide daily
  aggregate with same-day dedup semantics, and Shift Late Close has a
  past-midnight re-anchoring special case. Forcing these into the
  generic vocabulary would either fail to express them correctly or
  pressure the vocabulary to grow arbitrary escape hatches — both
  worse than leaving them as native code.
- A rule remaining native is not a gap to be closed later by default.
  Migrating any of the remaining seven requires its own evaluation
  against the vocabulary, the same way Large Return and Drawer
  Variance were evaluated here.

## 2. Architecture

```
Domain Event (e.g. sale.returned)
        ↓
runDurableSubscriber(event_type)          ← fixed, one per event_type
        ↓
load enabled business_rules WHERE event_type = $event_type
        ↓
evaluate each rule independently           ← no rule blocks another
        ↓
matched rule
        ↓
atomic: rule_action_log claim + notification write
```

Coexistence with the native WAFI-145 rules that don't migrate:

```
event
 ├─ data-driven rules  ──→ shared rule-engine subscriber (this ticket)
 └─ native rules       ──→ existing per-rule .rule.ts + NotificationRuleEvaluator
```

Both paths write to the same `notifications` table and are visible
identically in `NotificationCenterScreen.vue` — an owner never sees a
difference between a data-driven and a native-code notification.

### 2.1 `business_rules` — policy data, not runtime infrastructure

A new Postgres table, synced per-shop (same pattern as
`notification_settings`), seeded via migration with the two proof
rows. Deliberately **not** merged into `notification_settings`:
`notification_settings` answers "how should this shop receive
notifications" (delivery/preference); `business_rules` answers "under
what business condition should the system act" (policy). Coupling
them would tie the policy model to the `notify_owner` action
specifically, making a future second action harder to add cleanly.

```sql
business_rules
  id            uuid PK
  shop_id       uuid                 -- RLS scope
  rule_key      text                 -- stable machine identity, e.g. 'large_return'
  name          text                 -- human-readable, owner-editable
  event_type    text                 -- DomainEventType, e.g. 'sale.returned'
  field         text                 -- e.g. 'refundAmountUsd', 'variance'
  transform     text                 -- 'none' | 'abs'  (closed enum)
  operator      text                 -- 'gt' | 'gte' | 'lt' | 'lte' | 'eq'  (closed enum)
  threshold     numeric              -- generic, not USD-specific
  action        text                 -- 'notify_owner' (only value today)
  enabled       boolean not null default true
  updated_at    timestamptz not null default now()
```

`rule_key` is a stable identifier independent of the human-readable
`name`, so an owner renaming a rule doesn't break its identity (used
by `rule_action_log`, by seed-migration upserts, and by any future
code that needs to reference a specific rule by identity rather than
by current display name).

`event_type` is stored per-row, not inferred from which subscriber
loaded it — the subscriber topology stays fixed at the event-type
level (§2.2) while the set of rules per event type is pure data that
can grow without any code or infrastructure change.

**Authorization:** RLS scopes rows by `auth_shop_id()`. Write access
(`INSERT`/`UPDATE`/`DELETE`) is owner-only, enforced at the database
level — matching WAFI-018's precedent of a structurally owner-only
capability that cannot be widened by a stale or tampered permission
grant. `RulesScreen.vue` is presentation only; the authorization
boundary is the RLS policy, not a hidden UI route.

### 2.2 Shared subscriber per event_type

One `runDurableSubscriber` instance per **event type** that has any
enabled data-driven rules — not one per rule. For the two proof rules
this means one subscriber for `sale.returned` and one for
`shift.closed`.

```ts
runDurableSubscriber({
  subscriberName: 'business-rules:sale.returned',
  eventType: 'sale.returned',
  handler: async (event) => {
    const rules = await loadEnabledRules(event.shopId, 'sale.returned')
    for (const rule of rules) {
      await evaluateAndExecute(rule, event)   // independent per rule, see §2.3
    }
  },
})
```

This keeps infrastructure topology (subscriber count) fixed regardless
of how many rules exist per event type — adding a tenth rule to
`sale.returned` is a data change, not a new subscriber. This is an
explicit, deliberate change from the current 1-subscriber-per-rule
shape (nine `.rule.ts` files today, including Drawer Variance and
Shift Late Close both independently subscribing to `shift.closed`) —
the old shape only made sense when each rule was its own hardcoded
implementation.

### 2.3 `rule_action_log` — the execution ledger

The outer `runDurableSubscriber` is the **event redelivery** boundary
(its existing retry/dead-letter semantics per WAFI-150 are unchanged
and still apply at the event level). It is explicitly **not** the
mechanism providing per-rule idempotency — that is a separate concern,
because one subscriber invocation now evaluates and executes multiple
independent rules, and one rule's failure must never cause a sibling
rule's already-succeeded action to be treated as failed or re-run.

```sql
rule_action_log
  event_id     uuid          -- FK to events.id
  rule_id      uuid          -- FK to business_rules.id
  action       text          -- 'notify_owner'
  status       text          -- 'pending' | 'succeeded' | 'failed'
  attempts     int not null default 0
  last_error   text
  executed_at  timestamptz
  updated_at   timestamptz not null default now()
  PRIMARY KEY (event_id, rule_id, action)
```

Per matched rule, execution is atomic and independent:

1. Claim/upsert the `(event_id, rule_id, action)` row (`status =
   'pending'`, `attempts += 1`).
2. Write the `notifications` row.
3. On success, same transaction, set `status = 'succeeded'`,
   `executed_at = now()`.
4. On failure, `status = 'failed'`, `last_error` recorded; the claim
   is rolled back to a retryable state, not left silently
   `'succeeded'`.

A rule whose row is already `'succeeded'` for a given event is skipped
on redelivery (the idempotency guarantee). A rule whose row is
`'pending'`/`'failed'` is retried independently of any sibling rule's
outcome for the same event. The subscriber handler must not wrap all
matched rules' executions in one outer transaction — each rule's
claim+notification pair is its own transaction, so rule B failing
never rolls back rule A's or rule C's already-committed success.

Composite key `(event_id, rule_id, action)` rather than just
`(event_id, rule_id)` deliberately leaves room for a rule to support a
second action later (e.g. `notify_owner` and a future
`create_task`) without an identity redesign.

## 3. Proof rules

| Rule | `rule_key` | `event_type` | `field` | `transform` | `operator` | `threshold` (seeded) | `action` |
|---|---|---|---|---|---|---|---|
| Large Return | `large_return` | `sale.returned` | `refundAmountUsd` | `none` | `gt` | 100 (matches existing `refundUsdCap` default) | `notify_owner` |
| Drawer Variance | `drawer_variance` | `shift.closed` | `variance` | `abs` | `gt` | 15 (matches existing `varianceUsdCap` default) | `notify_owner` |

These two were chosen specifically because they exercise two different
vocabulary dimensions with the smallest possible engine:

- **Large Return** proves the baseline shape: one field, no
  transform, one operator, one threshold, one action.
- **Drawer Variance** proves a value **transform** (`abs`) applied
  before the comparison — a genuinely different vocabulary dimension,
  not just a second instance of the same shape. `abs` is a named,
  closed transform (`transform = 'abs'`), never a stored expression
  string like `"abs(variance) > 15"`.

Both existing `.rule.ts` files (`largeReturn.rule.ts`,
`drawerVariance.rule.ts`) and their dedicated `runDurableSubscriber`
registrations are deleted; their behavior is fully reproduced by the
shared engine, with parity tests (see §5) confirming no observable
behavior change to an owner.

Deliberately **not** chosen as proof rules:

- **Customer Debt Threshold** — its shop-wide daily aggregate and
  same-day dedup semantics don't fit the flat field/threshold shape;
  forcing it in would pressure the vocabulary to grow beyond what
  Large Return/Drawer Variance need to prove.
- **Cashier Lockout** (no-condition, enabled-only) — proving a
  "no condition" rule shape isn't a priority before the condition
  model itself is proven, and its name is enforcement-flavored
  ("lockout"), which risks blurring the notify-only boundary this spec
  establishes in §1.1 even though its actual implementation is
  notify-only today.

## 4. Domain Interaction Matrix update

Per `AI_PRINCIPAL_ENGINEER_REVIEW.md`'s living matrix, adding a new row
for this feature's domain (Business Rules is a new domain distinct
from Notifications — policy definition vs. delivery, per §2.1):

| Domain | Writes to (tables) | Reads from (other domains) | Key composables | Reports/Dashboards affected |
|---|---|---|---|---|
| Business Rules (WAFI-156) | `business_rules`, `rule_action_log` | Events (subscribes to `sale.returned`, `shift.closed`, extensible to any `DomainEventType`), Notifications (writes `notifications` rows via the same path native rules use) | `businessRuleSubscriber.ts`, `ruleEvaluator.ts`, `loadEnabledRules.ts`, `RulesScreen.vue` composables | Notification Center (rows created by data-driven rules are indistinguishable from native-rule rows); Settings (new `RulesScreen.vue`, owner-only) |

The existing **Notifications** row's "Key composables" column should
be understood as now covering two coexisting rule mechanisms
(`NotificationRuleEvaluator`-implementing native `.rule.ts` files, and
this ticket's data-driven engine) — both converge on the same
`notifications` table and UI, so the Notifications row's "Writes to"
and "Reports/Dashboards affected" columns are unchanged.

## 5. Testing

- **Parity tests** for Large Return and Drawer Variance: same
  fixtures the current `.rule.ts` tests use, run through the new
  evaluator, asserting identical `notifications` row output (type,
  severity, payload) to lock in zero behavior change for an owner.
- **Evaluator unit tests**: each `operator`/`transform` combination
  used by the proof rules, plus boundary conditions (`gt` is strict,
  matching today's crossing semantics where relevant).
- **Idempotency tests**: redelivering the same event after one rule
  succeeded and a sibling rule failed — confirm the succeeded rule is
  not re-executed and the failed rule is retried.
- **RLS tests** (pgTAP): non-owner roles cannot `INSERT`/`UPDATE`/
  `DELETE` `business_rules`; cross-shop isolation on both new tables.
- **Event contract test** (WAFI-157 convention): `business-rules:*`
  subscribers registered in `eventContractFixtures.ts`'s consumer-
  completeness check alongside the existing audit/notification
  consumers.

## 6. Explicitly out of scope

- Enforcement/blocking actions (`block_credit` and similar) — separate
  future ticket, per §1.1.
- Any action other than `notify_owner`.
- Migrating any of the remaining 7 native WAFI-145 rules — each is an
  independent future decision, not a commitment made by this ticket.
- An owner-facing "create a brand-new rule from scratch" UI beyond
  editing the seeded rules' threshold/enabled state — `RulesScreen.vue`
  in this ticket covers view/edit/enable-disable of existing rows;
  whether owners can author entirely new rules (new `event_type`/
  `field` combinations) through the UI is left to a future pass once
  the vocabulary has more real usage to generalize from.
- Any expansion of the `field`/`transform`/`operator` vocabulary beyond
  what Large Return and Drawer Variance require.

## Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Business Rules (new), Notifications, Events, Sales (source of sale.returned), Cash/Shifts (source of shift.closed)
Matrix rows consulted: Notifications, Events (both existing rows in AI_PRINCIPAL_ENGINEER_REVIEW.md); Business Rules row added above
Open cross-feature questions: none identified — enforcement/blocking (the one genuine cross-feature risk, touching Customer Credit and Sales write-path) is explicitly deferred to a future ticket rather than left as an open question here (see §1.1)
```
