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

**Multiple consumers of the same domain event are intentional and
pre-existing** (Drawer Variance and Shift Late Close already
independently subscribe to `shift.closed` today). WAFI-156 does not
consolidate native notification subscribers down to one per event
type — it introduces one *additional* shared consumer for the
data-driven rule set alongside whatever native consumers already exist
for that event type. Only the two migrated native consumers
(`largeReturn.rule.ts`, `drawerVariance.rule.ts`) are removed; Shift
Late Close's native subscriber on `shift.closed` is untouched and
continues running alongside the new `business-rules:shift.closed`
subscriber.

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
  rule_key      text                 -- stable machine identity, e.g. 'large_return'; immutable
  name          text                 -- human-readable, owner-editable
  event_type    text                 -- DomainEventType, e.g. 'sale.returned'; system-controlled
  field         text                 -- e.g. 'refundAmountUsd', 'variance'; system-controlled
  transform     text  CHECK (transform IN ('none', 'abs'))                  -- system-controlled
  operator      text  CHECK (operator IN ('gt', 'gte', 'lt', 'lte', 'eq'))  -- system-controlled
  threshold     numeric              -- generic, not USD-specific; owner-editable
  action        text  CHECK (action = 'notify_owner')                      -- system-controlled
  enabled       boolean not null default true                              -- owner-editable
  updated_at    timestamptz not null default now()

  UNIQUE (shop_id, rule_key)
```

The closed-vocabulary claim in §1 is enforced by the database, not
just by convention — the `CHECK` constraints above are the actual
guarantee that `transform`/`operator`/`action` can never silently
drift into an unsupported value via a direct write, a bad migration,
or a future bug in `RulesScreen.vue`.

**Owner-editable vs. system-controlled columns.** The scope in §1 says
an owner can change "a rule's condition, threshold, and enabled
state" — that must not be read as every column being editable.
`RulesScreen.vue` exposes exactly:

- **Owner-editable:** `name`, `threshold`, `enabled`.
- **System-controlled / immutable after seed:** `rule_key`,
  `event_type`, `field`, `transform`, `operator`, `action`.

An owner can retune *when* a rule fires (its threshold) and *whether*
it fires (enabled), and rename it for their own reference — they
cannot repoint a rule at a different field, event type, or operator.
This is enforced both in the UI (those fields aren't rendered as
inputs) and, more importantly, at the RLS/RPC layer: the owner-facing
update path only ever writes `name`/`threshold`/`enabled`, never the
system-controlled columns, so `RulesScreen.vue` cannot become an
accidental rule-authoring system regardless of future UI changes.
Authoring genuinely new rules (new `event_type`/`field` combinations)
is out of scope for this ticket (§6).

`rule_key` is a stable identifier independent of the human-readable
`name`, so an owner renaming a rule doesn't break its identity — it is
what `rule_action_log.rule_id` ultimately traces back to (via
`business_rules.id`, see §2.3) and what seed-migration upserts key on.
`business_rules.id` (surrogate PK) is the FK target used everywhere at
runtime; `rule_key` is the human/ops-facing stable name for that same
row, unique per shop (`UNIQUE (shop_id, rule_key)`) so "large_return"
always identifies the same logical rule within a shop even if `id`
values differ across environments (e.g. a disposable test project vs.
production).

`event_type` is stored per-row, not inferred from which subscriber
loaded it — the subscriber topology stays fixed at the event-type
level (§2.2) while the set of rules per event type is pure data that
can grow without any code or infrastructure change. A row's
`event_type` must be one of the finite set of event types the engine
actually has a registered subscriber for (`DataDrivenRuleEventType`,
a subset of `DomainEventType` — see §8's event-contract test), not
any arbitrary `DomainEventType` string; this is enforced by the seed
migration being the only writer of `event_type` and by the event
contract test in §5, not by a DB-level enum (Postgres `CHECK IN
(...)` here would need updating every time a new event type adopts
the engine, which is an acceptable manual step given `event_type` is
already system-controlled and not owner-facing).

**Authorization:** RLS scopes rows by `auth_shop_id()`. Write access
(`INSERT`/`UPDATE`/`DELETE`) is owner-only, enforced at the database
level — matching WAFI-018's precedent of a structurally owner-only
capability that cannot be widened by a stale or tampered permission
grant. `RulesScreen.vue` is presentation only; the authorization
boundary is the RLS policy, not a hidden UI route.

### 2.2 Shared subscriber per event_type

One `runDurableSubscriber` instance per **supported event type** — not
one per rule, and not one per *currently-enabled* rule. Subscriber
registration is **fixed at deploy time**, independent of whether any
rule targeting that event type is presently enabled:

```
Supported event types (this ticket: sale.returned, shift.closed)
        ↓
fixed subscriber registrations  ← registered unconditionally at app start,
        ↓                          same as every other durable subscriber
load currently-enabled business_rules for this event_type
        ↓
zero or more matches
```

Concretely, `startBusinessRuleSubscribers` registers
`business-rules:sale.returned` and `business-rules:shift.closed`
unconditionally, the same way `startNotificationSubscribers` registers
its nine subscribers unconditionally regardless of each rule's
`notification_settings.enabled` flag today. If an owner disables every
rule targeting `sale.returned`, the subscriber keeps running (loading
zero rules, doing nothing) — it does not stop and does not need to be
re-registered when a rule is re-enabled. This is what makes the
"infrastructure topology stays fixed while policy data changes" claim
in §2 actually true, including through a disable/enable cycle, not
just through a threshold edit.

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
  event_id     uuid references events(id)         on delete restrict
  rule_id      uuid references business_rules(id) on delete restrict
  action       text          -- 'notify_owner'
  attempts     int not null default 0
  last_error   text
  executed_at  timestamptz   -- NULL until the action has actually succeeded
  updated_at   timestamptz not null default now()
  PRIMARY KEY (event_id, rule_id, action)
```

No `status` column — a transaction cannot both persist `'failed'` and
roll itself back, so a separate status enum implying a durable
"failed" state was internally contradictory with using rollback for
failure handling. Instead, **row existence + `executed_at IS NOT
NULL`** is the entire success state, determined per matched rule as:

1. `BEGIN`.
2. `INSERT ... ON CONFLICT (event_id, rule_id, action) DO UPDATE SET
   attempts = rule_action_log.attempts + 1, updated_at = now()` —
   claims the row and records the attempt regardless of outcome.
3. Write the `notifications` row.
4. On success, same transaction: `UPDATE ... SET executed_at = now()`.
5. `COMMIT`.

On failure at step 3 or 4, the entire transaction is **rolled back** —
including the `attempts` increment from step 2. The row is left
exactly as it was before this attempt (absent, on the very first
attempt; or present with `executed_at IS NULL` and its previous
`attempts` count, on a retry). This means `attempts` only reliably
counts *committed* attempts, which is an accepted, deliberate trade-off
(an undercount on transient failures) in exchange for never having a
row silently claim more than it can prove: there is no state where the
row exists with `executed_at IS NULL` and a `last_error` from a
transaction that itself never committed. `last_error` is best-effort,
written by the calling code (not inside the rolled-back transaction)
immediately after a caught failure, purely for operator visibility —
it is not part of the correctness guarantee.

A rule whose row has `executed_at IS NOT NULL` for a given event is
skipped on redelivery (the idempotency guarantee — this is the only
check the subscriber needs before re-running a rule). A rule with no
row, or a row with `executed_at IS NULL`, is retried independently of
any sibling rule's outcome for the same event. The subscriber handler
must not wrap all matched rules' executions in one outer transaction —
each rule's claim+notification+executed_at update is its own
transaction, so rule B failing (and rolling back) never touches rule
A's or rule C's already-committed, already-`executed_at`-stamped
success.

Composite key `(event_id, rule_id, action)` rather than just
`(event_id, rule_id)` deliberately leaves room for a rule to support a
second action later (e.g. `notify_owner` and a future
`create_task`) without an identity redesign.

**Shop isolation and FK behavior.** `events.shop_id = (SELECT shop_id
FROM business_rules WHERE id = rule_id)` is a guaranteed invariant for
every valid `rule_action_log` row — the subscriber only ever loads
rules scoped to the event's own shop (§2.2's `loadEnabledRules`
already filters by `event.shopId`), so a cross-shop row is not
reachable through the intended write path; this is asserted directly
by a pgTAP test rather than left as an implicit consequence of RLS
alone (see §5). Both FKs are `ON DELETE RESTRICT`: deleting a
`business_rules` row (not currently exposed to owners — see the
owner-editable column list above) or an `events` row must not silently
destroy historical action-execution identity; a rule intended to be
retired is disabled (`enabled = false`), never deleted, while any rows
exist in `rule_action_log`.

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
behavior change to an owner. "Same formula, different representation"
is the bar — the migration must preserve every existing behavior of
these two rules, not just their headline threshold comparison: the
implementation task must first read `largeReturn.rule.ts` and
`drawerVariance.rule.ts` in full to confirm (and the parity fixtures
must lock in) their exact existing operator semantics (`>` vs `>=`),
any currency/rounding/precision normalization applied to
`refundAmountUsd`/`variance` before comparison, the exact
`notifications` payload shape and severity produced today, and their
current dedup behavior — before writing the data-driven equivalent.
Where the current implementation does anything beyond the seeded
`operator`/`threshold` comparison (e.g. rounds `variance` before
`abs()`, or applies it after), the evaluator must replicate that
exactly, not merely "a technically equivalent formula."

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
  Per §3, these fixtures must also cover normalization/rounding
  edge cases already exercised by the existing `.rule.ts` test files
  (not just the headline threshold-crossing case) — the migration
  changes rule *representation*, not business *semantics*.
- **Evaluator unit tests**: each `operator`/`transform` combination
  used by the proof rules, plus boundary conditions (`gt` is strict,
  matching today's crossing semantics where relevant).
- **Idempotency tests**: redelivering the same event after one rule
  succeeded (`executed_at` set) and a sibling rule failed (no row, or
  row present with `executed_at IS NULL`) — confirm the succeeded rule
  is not re-executed and the failed rule is retried, and confirm a
  failed transaction leaves no `attempts`-incremented row behind (per
  §2.3's rollback semantics).
- **RLS tests** (pgTAP): non-owner roles cannot `INSERT`/`UPDATE`/
  `DELETE` `business_rules`; the owner-facing update RPC/path only ever
  writes `name`/`threshold`/`enabled`, never `event_type`/`field`/
  `transform`/`operator`/`action`; cross-shop isolation on both new
  tables, explicitly including a test that asserts `rule_action_log`
  can never contain a row where the referenced event's `shop_id`
  differs from the referenced rule's `shop_id` (§2.3's invariant).
- **Event contract test** (WAFI-157 convention), checked in both
  directions: (a) every event type with a `business-rules:*` subscriber
  registered is present in `eventContractFixtures.ts`'s
  consumer-completeness check, matching the existing audit/notification
  consumer convention; and (b) every `business_rules.event_type` value
  that exists (seeded or otherwise) is a member of the finite
  `DataDrivenRuleEventType` set the engine actually has a subscriber
  for — i.e. `business_rules.event_type ⊆ DataDrivenRuleEventType ⊆
  DomainEventType`, so a row can never reference an event type nothing
  is listening for.

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
