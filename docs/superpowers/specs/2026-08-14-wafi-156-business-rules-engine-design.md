# WAFI-156 — Business Rules Engine (Design Spec)

Date: 2026-08-14
Status: Approved, implementation-ready — 6th review pass: execute_rule_action() corrected from an unimplementable service_role-only design to an authenticated-callable RPC that is itself the authoritative evaluation/security boundary (client-side evaluation is a non-authoritative pre-filter only), verified against WAFI's actual client-only durable-subscriber architecture (no deployed backend exists)
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
execute_rule_action(event_id, rule_id)  ← authenticated-callable Postgres RPC; re-evaluates authoritatively, then atomic claim + notification write
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

A new Postgres table, synced per-shop (same sync-scoping pattern as
`notification_settings`). Deliberately **not** merged into
`notification_settings`:
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
Since RLS alone grants row-level access, not column-level immutability
— an owner `UPDATE` permission on the table would let them write any
column, not just the editable three — the actual authorization model
is:

- **Owner role:** `SELECT` only at the table level, scoped by
  `auth_shop_id()`. **No direct `INSERT`/`UPDATE`/`DELETE` grant on
  `business_rules` at all.** Edits go through a dedicated
  `SECURITY DEFINER` RPC, `update_business_rule(rule_id, name,
  threshold, enabled)`, whose signature structurally accepts only
  those three values — there is no code path, correct or buggy, by
  which an owner-initiated write can touch `event_type`, `field`,
  `transform`, `operator`, or `action`, because those columns are
  never parameters the RPC accepts. `RulesScreen.vue` calls this RPC;
  it never issues a raw `UPDATE business_rules ...`.
- **Migration/system:** the only writer of `INSERT` (seed migration)
  and the only path capable of ever changing a system-controlled
  column (a future migration, not runtime code).

This also closes the gap the event-contract test in §5 would
otherwise only catch after the fact: since owners cannot `INSERT` at
all, an owner can never create a `business_rules` row with an
unsupported `event_type` in the first place — the seed migration is
the only writer of `event_type`, and it is reviewed code, not
owner-facing input. The event-contract test remains as a second,
independent guard against a future migration mistake, not as the
primary defense. Authoring genuinely new rules (new `event_type`/
`field` combinations) is out of scope for this ticket (§6).

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

**Provisioning for existing and new shops.** Unlike
`notification_settings`, `business_rules` cannot rely on a
missing-row-means-default pattern — there is no code-side hardcoded
rule to fall back to; a rule must exist as a real row to be evaluated,
listed in `RulesScreen.vue`, or edited via `update_business_rule()` at
all. Checked against the actual shop-bootstrap code before writing
this: **no existing per-shop config table is bootstrapped this way**
— `notification_settings` itself gets no row at shop creation (it
depends entirely on `getNotificationSettings()`'s code-side default
fallback); the only tables genuinely eagerly-inserted at bootstrap are
`shops` (via the `auth.users` trigger, `021_provision_shop_on_signup.sql`)
and `staff`/`devices`/`device_sessions` (via the
`bootstrap_owner_identity()` RPC, `069_bootstrap_owner_identity.sql`).
So this ticket must add its own provisioning step rather than reuse
one:

- **Existing shops:** this ticket's migration inserts the two proof
  rows (`large_return`, `drawer_variance`) for every row currently in
  `shops`, once, as a backfill.
- **New shops (signed up after this ticket ships):** `bootstrap_owner_identity()`
  (069) is extended with one more insert — the same two canonical
  `business_rules` rows — alongside its existing `devices`/`staff`/
  `device_sessions` inserts, so a freshly-bootstrapped shop has its
  rules present from the same moment its owner/device rows are
  created, not as a separate follow-up step that could be skipped or
  raced.

Both inserts key on `(shop_id, rule_key)` (`ON CONFLICT (shop_id,
rule_key) DO NOTHING`), so the backfill and the bootstrap-time insert
share one idempotent seed statement rather than diverging into two
implementations of "what the canonical rules are."

**Authorization:** RLS scopes the `SELECT` grant by `auth_shop_id()`;
see the authorization model above for why write access is via RPC
rather than a table-level grant. Restricting real editing power to a
narrow RPC signature — not merely gating a UI route — matches WAFI-018's
precedent of a structurally owner-only capability that cannot be
widened by a stale or tampered permission grant. `RulesScreen.vue` is
presentation only; the authorization boundary is the RPC's own
signature and its owner-only execute grant, not the UI route.

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
      // Client-side evaluation here is a pre-filter/optimization only — it
      // decides whether to *call* the RPC at all, so an obviously-non-matching
      // rule doesn't cost a round-trip. It has zero authority: the RPC
      // in §2.3 re-evaluates the same condition against the authoritative
      // event row itself and will refuse to act if this pre-filter was wrong
      // (stale local data, a bug, or a bypass calling the RPC directly).
      if (evaluateLocally(rule, event)) {
        await executeRuleAction(event.eventId, rule.id)   // see §2.3
      }
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
NULL`** is the entire success state.

**This must be a server-side atomic operation, not a client-side
PowerSync write.** WAFI is offline-first with multiple devices per
shop; a claim implemented as an ordinary optimistic local-table write
(the generic PowerSync upload path) would let two devices each pass
their own local "not yet executed" check before either write
round-trips to Postgres — exactly the double-execution risk this
ledger exists to prevent. This is the same class of problem WAFI-151
already solved for `daily_event_counts` (`apply_daily_event_count`,
a `SECURITY DEFINER` RPC with an advisory lock, deriving state from
the authoritative event row rather than trusting client-supplied
data) — WAFI-156 reuses that precedent rather than inventing a new
one: **the claim, the `notifications` write, and the `executed_at`
stamp all happen inside one Postgres transaction in a single
`SECURITY DEFINER` RPC, `execute_rule_action(event_id, rule_id,
action)`**, never assembled client-side across separate statements.

**Corrected architectural decision (this section previously assumed a
backend execution context that does not exist in WAFI today, and has
been revised):** WAFI has no deployed backend/worker service — every
existing durable subscriber, including all nine WAFI-145 notification
rules, runs client-side in the browser (`runDurableSubscriber` wraps
`useEventSubscription`, which watches the PowerSync-synced local
`events` table and calls its handler in-page; `largeReturn.rule.ts`/
`drawerVariance.rule.ts` write `notifications` rows via plain
`db.execute(...)` against the local SQLite DB as the signed-in
device's own `authenticated` session). A `service_role`-only RPC
cannot be called from this architecture at all — the `service_role`
key is never shipped to a client, and building a real backend worker
to hold it would be new infrastructure far beyond this ticket's scope
(and the roadmap's 2-sprint estimate). **`execute_rule_action` is
therefore `authenticated`-callable, matching how every other WAFI RPC
and subscriber actually works — but it is the RPC itself, not the
calling client, that decides whether the rule fires.** The browser
subscriber's role shrinks to *discovery and triggering*; Postgres
remains the sole authority on *evaluation, idempotency, and
correctness*:

```
Client (untrusted for authority, trusted only to trigger):
  runDurableSubscriber(event_type)
        ↓
  evaluateLocally(rule, event)     ← optimization/pre-filter only, zero authority
        ↓ (candidate match)
  execute_rule_action(event_id, rule_id)   ← authenticated RPC call

Postgres (the actual trust boundary):
  execute_rule_action(event_id, rule_id):
        ↓
    load event_id row (404 if missing)
        ↓
    load rule_id row (404 if missing)
        ↓
    auth_shop_id() = event.shop_id                    -- caller must belong to this shop
        ↓
    event.shop_id    = rule.shop_id                   -- same invariant as before
    event.type       = rule.event_type                -- same invariant as before (events.type ↔ business_rules.event_type)
        ↓
    rule.enabled = true                               -- a disabled rule can never fire,
        ↓                                                even via direct RPC call
    evaluate rule.field/transform/operator/threshold
    against event.payload — AUTHORITATIVELY, ignoring
    whatever the client's evaluateLocally() concluded
        ↓ no match → return 'not_matched', nothing written
        ↓ match
    claim + notification + executed_at (§2.3 below, unchanged)
```

The one thing removed from the signature: **`action` is no longer a
client-supplied argument.** The RPC looks up `rule.action` itself
(there is exactly one supported value, `'notify_owner'`, but the
principle holds regardless) — accepting it from the caller would be
an input that adds no legitimate authority (the caller cannot pick a
different action than the rule's own) while adding another value the
RPC would otherwise have to validate. Signature: `execute_rule_action(event_id
uuid, rule_id uuid)`.

**Why this is still safe against a malicious `authenticated` caller.**
Consider a signed-in staff member calling `execute_rule_action(some_sale_returned_event_id,
large_return_rule_id)` directly, bypassing `RulesScreen.vue` and
`evaluateLocally()` entirely, for a return that was well under the
`large_return` threshold. The RPC still independently re-derives
`refundAmountUsd` from `event.payload` (the authoritative, already-committed
event row — not anything the caller asserts), applies `large_return`'s
`transform`/`operator`/`threshold`, and finds no match — it returns
`'not_matched'` and writes nothing. The caller can trigger evaluation
of any event/rule pair they're allowed to see (their own shop's), but
they can never make a non-matching rule fire, make a disabled rule
fire, or fabricate a `notifications` row for an event/rule pair that
wasn't real. This is why the RPC's internal condition evaluation is
load-bearing security, not merely business logic — see the "evaluation
logic" step added below.

This gives WAFI-156 two RPCs with a related but distinct model — both
`authenticated`-callable, both `SECURITY DEFINER`, both self-defending
rather than trusting the caller's own claims:

```
Owner path:
  RulesScreen.vue → update_business_rule(rule_id, name, threshold, enabled)
                     authorized via auth_shop_id() = rule's own shop_id,
                     PLUS an owner-role check in the function body
                     (any authenticated staff member could call it;
                      only an owner-role caller's call has any effect)

Execution path:
  durable subscriber → execute_rule_action(event_id, rule_id)
                        authorized via auth_shop_id() = event.shop_id (coarse
                        shop-membership eligibility gate — any staff member
                        of the shop may trigger evaluation, same as any
                        staff member's device already runs every other
                        durable subscriber today),
                        PLUS full authoritative condition re-evaluation
                        inside the function body (the actual correctness
                        boundary — see above)
```

`update_business_rule`'s owner-role check and `execute_rule_action`'s
condition re-evaluation play the same structural role: each RPC
performs its *own* authorization/correctness check in its body rather
than trusting `auth_shop_id()` alone to be sufficient, because
`auth_shop_id()` only ever proves shop membership, never proves "this
caller is allowed to do this specific thing" or "this specific
business condition actually holds."

`rule_action_log` itself is an ordinary server-only Postgres table:
**not** PowerSync-synced, and clients have **no direct read or write
access** to it in WAFI-156 — there is no product requirement today for
surfacing "this rule fired N times" to any client, so no sync surface
is introduced for it. The Notification Center continues to be backed
entirely by `notifications` (which *is* synced, exactly as it is
today for the native rules); `rule_action_log` is purely the
server-side execution ledger behind `execute_rule_action` and is
invisible to every client.

Inside `execute_rule_action(p_event_id uuid, p_rule_id uuid)`:

1. `BEGIN` (implicit, function body).
2. Load `v_event := events WHERE id = p_event_id` (raise `event not
   found` if missing) and `v_rule := business_rules WHERE id =
   p_rule_id` (raise `rule not found` if missing).
3. Authorization/invariant checks, in order, each raising and aborting
   the whole function on failure — **all of this runs before the
   claim in step 5, so a failing check never touches
   `rule_action_log`**:
   - `auth_shop_id() = v_event.shop_id` — the calling session must
     belong to the event's own shop (coarse eligibility gate).
   - `v_event.shop_id = v_rule.shop_id` — cross-shop pairing rejected.
   - `v_event.type = v_rule.event_type` — mismatched pairing rejected
     (e.g. a `sale.returned` event against the `drawer_variance` rule,
     which targets `shift.closed`). Note the column name: `events.type`
     is the actual column (matching `DomainEvent.type` in
     `domainEvent.types.ts`), compared against `business_rules`'s
     `event_type` column — the two tables simply name the same concept
     differently; this RPC is the one place that bridges them.
   - `v_rule.enabled = true` — a disabled rule can never fire, even
     via a direct RPC call bypassing `evaluateLocally()`.
4. **Authoritative condition evaluation** — re-derive the rule's
   `field` from `v_event.payload` (a `jsonb` column), apply its
   `transform`, and compare against its `threshold` using its
   `operator`, entirely inside the function, ignoring whatever the
   client's `evaluateLocally()` concluded:
   `events.payload` is `text` holding a JSON-encoded object (not
   `jsonb` — see `074_events_bus_core.sql`'s explicit comment on why:
   avoiding a client/server JSON-parse-shape mismatch bug class), so
   the RPC casts it once (`v_payload := v_event.payload::jsonb`) before
   extracting fields:
   ```sql
   v_payload := v_event.payload::jsonb;
   v_field_value := CASE v_rule.field
     WHEN 'refundAmountUsd' THEN (v_payload->>'refundAmountUsd')::numeric
     WHEN 'variance'        THEN (v_payload->>'variance')::numeric
     -- extended only when a future rule's field is added to the vocabulary
   END;
   v_transformed := CASE v_rule.transform
     WHEN 'none' THEN v_field_value
     WHEN 'abs'  THEN abs(v_field_value)
   END;
   v_matched := CASE v_rule.operator
     WHEN 'gt'  THEN v_transformed >  v_rule.threshold
     WHEN 'gte' THEN v_transformed >= v_rule.threshold
     WHEN 'lt'  THEN v_transformed <  v_rule.threshold
     WHEN 'lte' THEN v_transformed <= v_rule.threshold
     WHEN 'eq'  THEN v_transformed =  v_rule.threshold
   END;
   IF NOT v_matched THEN
     RETURN 'not_matched';  -- no row written to rule_action_log or notifications
   END IF;
   ```
   This `CASE v_rule.field` mapping is the one place the closed
   vocabulary (§1) must be kept in lockstep with the RPC body — adding
   a new supported `field` to `business_rules`'s vocabulary means
   adding a branch here, in the same migration, not a runtime-data-only
   change; this is deliberate (§1's "expanding the vocabulary later is
   an explicit... architectural decision, not a schema escape hatch"
   made concrete).
5. Atomic conditional claim (unchanged from the original design,
   `action` column still exists on `rule_action_log`, its value now
   read from `v_rule.action` rather than a parameter):
   ```sql
   INSERT INTO rule_action_log (event_id, rule_id, action, attempts, updated_at)
   VALUES (p_event_id, p_rule_id, v_rule.action, 1, now())
   ON CONFLICT (event_id, rule_id, action) DO UPDATE
     SET attempts = rule_action_log.attempts + 1, updated_at = now()
     WHERE rule_action_log.executed_at IS NULL
   RETURNING *;
   ```
   Postgres's `ON CONFLICT ... DO UPDATE` takes a row-level lock on
   the conflicting row before evaluating its `WHERE` clause, so a
   second, truly-concurrent call for the same `(event_id, rule_id,
   action)` blocks on that lock rather than racing it — it proceeds
   only after the first call's transaction commits or rolls back, at
   which point it re-evaluates `executed_at IS NULL` against the
   now-final state. If the first call committed with `executed_at`
   set, the `WHERE` clause excludes the row, the `UPDATE` affects zero
   rows, and `RETURNING` yields nothing.
6. **If no row was returned in step 5, stop and return "already
   executed" — do not write a notification.** This is the fix for
   concurrent redelivery: at most one caller ever proceeds past this
   point for a given `(event_id, rule_id, action)`.
7. Write the `notifications` row.
8. `UPDATE rule_action_log SET executed_at = now() WHERE (event_id,
   rule_id, action) = (p_event_id, p_rule_id, v_rule.action)`.
9. `COMMIT` (implicit, function return), return `'executed'`.

On failure at step 7 or 8, the function raises and the whole
transaction (including the step 5 claim) rolls back — the row is left
exactly as it was before this attempt (absent, on the very first
attempt; or present with `executed_at IS NULL` and its previous
`attempts` count, on a retry). This means `attempts` only reliably
counts *committed* attempts, an accepted, deliberate trade-off (an
undercount on transient failures) in exchange for never having a row
silently claim more than it can prove.

**Invariant (the one this whole section exists to guarantee): at most
one *concurrent* execution attempt for a given `(event_id, rule_id,
action)` may proceed to the `notifications` write.** Concurrent
callers (e.g. two subscriber-invocations racing at the same instant,
possibly from different devices' redelivery) serialize on the
`rule_action_log` row lock inside `execute_rule_action`, and the loser
skips once it observes a committed `executed_at`. This is distinct
from the sequential-retry case: after a failed attempt rolls back
(no row, or row with `executed_at IS NULL`), a *later, non-concurrent*
retry is expected and allowed to proceed; only after a successful
commit do all subsequent attempts — concurrent or sequential — skip.

`last_error` is **diagnostic metadata only** — it is not consulted for
claiming, idempotency, retry eligibility, or correctness, and a
concurrent or later retry may overwrite or supersede it. Because a
failed transaction rolls back the row entirely (per above), there is
no in-transaction moment where `last_error` can be durably set
alongside the failure it describes; a best-effort separate statement
(outside the failed transaction, e.g. logged from the calling code
after the RPC raises) may record it for operator visibility, but no
part of the engine's correctness depends on `last_error` existing,
being current, or being consistent with `attempts`.

A rule whose row has `executed_at IS NOT NULL` for a given event has
already fully executed (the idempotency guarantee). A rule with no
row, or a row with `executed_at IS NULL`, is eligible for another
attempt, independent of any sibling rule's outcome for the same
event — the subscriber handler calls `execute_rule_action` once per
matched rule, and each call is its own independent transaction, so
rule B failing (and rolling back) never touches rule A's or rule C's
already-committed, already-`executed_at`-stamped success.

Composite key `(event_id, rule_id, action)` rather than just
`(event_id, rule_id)` deliberately leaves room for a rule to support a
second action later (e.g. `notify_owner` and a future
`create_task`) without an identity redesign.

**Shop isolation and FK behavior.** `events.shop_id = (SELECT shop_id
FROM business_rules WHERE id = rule_id)` is a guaranteed invariant for
every valid `rule_action_log` row — `execute_rule_action` checks
`v_event.shop_id = v_rule.shop_id` itself (step 3 above) before doing
anything else, in addition to `loadEnabledRules` already filtering by
`event.shopId` client-side as an optimization — so a cross-shop row is
not reachable through the intended write path (nor through a direct,
bypassing RPC call, since the RPC re-checks regardless of caller
intent); this is asserted directly by a pgTAP test rather than left as
an implicit consequence of RLS alone (see §5). Both FKs are `ON DELETE
RESTRICT`: deleting a `business_rules` row (not exposed to owners at
all — see the authorization model above) or an `events` row must not
silently destroy historical action-execution identity; a rule
intended to be retired is disabled (`enabled = false`), never deleted,
while any rows exist in `rule_action_log`.

**Why this table is safe from the offline-dedup trap that
`local_event_processed_ledger`/`local_subscriber_processed_events`
deliberately accept elsewhere in this codebase.** Those two ledgers
are correctly per-device/local — they exist only to stop one device
from redundantly reprocessing an event it has already handled
locally, and their design explicitly accepts that they "cannot see
across devices" (this is fine for their purpose: rebuildable,
best-effort local projections and at-least-once subscriber dedup,
where the actual source of truth is elsewhere). `rule_action_log` is
different in kind, not degree: it is the *sole* mechanism guaranteeing
a `notify_owner` action fires once, and if it were local-only, Device
A and Device B could each independently see "not yet executed" and
each write a `notifications` row for the same event/rule — an owner
would see a duplicate notification. That is why §2.3 requires
`rule_action_log` to be an authoritative, non-synced, server-only
Postgres table written to exclusively through `execute_rule_action`,
never a `local_`-prefixed PowerSync table populated by independent
per-device logic.

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
| Business Rules (WAFI-156) | `business_rules` (synced config), `rule_action_log` (server-only, not synced) via `execute_rule_action()`/`update_business_rule()` RPCs | Events (subscribes to `sale.returned`, `shift.closed`, extensible to any `DomainEventType`), Notifications (writes `notifications` rows via the same path native rules use) | `businessRuleSubscriber.ts`, `ruleEvaluator.ts`, `loadEnabledRules.ts`, `RulesScreen.vue` composables | Notification Center (rows created by data-driven rules are indistinguishable from native-rule rows); Settings (new `RulesScreen.vue`, owner-only) |

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
- **Sequential idempotency tests**: redelivering the same event after
  one rule succeeded (`executed_at` set) and a sibling rule failed (no
  row, or row present with `executed_at IS NULL`) — confirm the
  succeeded rule is not re-executed and the failed rule is retried,
  and confirm a failed transaction leaves no `attempts`-incremented
  row behind (per §2.3's rollback semantics).
- **Concurrent idempotency test (the critical one)**: call
  `execute_rule_action` for the same `(event_id, rule_id, action)`
  twice concurrently (two overlapping Postgres sessions/transactions,
  not two sequential calls) — assert exactly one `notifications` row
  is created, the loser's call returns "already executed" with no
  notification write, and exactly one `rule_action_log` row exists
  with `executed_at IS NOT NULL` afterward. This is the pgTAP-level
  proof of §2.3's core invariant and must exercise real transaction
  overlap (e.g. via two concurrent connections holding open
  transactions against the same claim), not merely two sequential
  calls that happen to be fast.
- **RLS/authorization tests** (pgTAP): the owner role has no direct
  `INSERT`/`UPDATE`/`DELETE` grant on `business_rules` (attempting a
  raw `UPDATE`/`INSERT` as the owner role fails on privilege, not
  merely on data validation); `update_business_rule()`'s signature is
  confirmed to accept only `name`/`threshold`/`enabled` (no test can
  pass an `event_type`/`field`/`transform`/`operator`/`action`
  argument to it, because the parameter doesn't exist); cross-shop
  isolation on both new tables, explicitly including a test that
  asserts `rule_action_log` can never contain a row where the
  referenced event's `shop_id` differs from the referenced rule's
  `shop_id` (§2.3's invariant).
- **`execute_rule_action` anon-rejection test**: as the `anon` role
  (unauthenticated), attempt to call `execute_rule_action(event_id,
  rule_id)` and assert it fails (no `auth_shop_id()` for an
  unauthenticated caller to satisfy) — this is the one privilege-level
  check that still applies given the RPC is `authenticated`-callable,
  not `anon`-callable.
- **`execute_rule_action` mismatch-rejection tests**: as an
  `authenticated` caller belonging to the relevant shop(s), call the
  RPC with (a) an `event`/`rule` pair from two different shops (caller
  belongs to neither, or belongs to one), (b) a caller from a
  *different* shop than the event's own shop (the `auth_shop_id() =
  event.shop_id` eligibility gate), (c) a same-shop `event`/`rule`
  pair whose `event_type` doesn't match the rule's `event_type` (e.g.
  a `sale.returned` event against the `drawer_variance` rule), and (d)
  a same-shop, matching-event-type pair where the rule is `enabled =
  false` — asserting each is rejected before any `rule_action_log` row
  or `notifications` row is created (per §2.3's authorization/invariant
  checks in step 3).
- **`execute_rule_action` malicious-caller / authoritative-re-evaluation
  test (the critical one for this RPC's security model)**: as a valid
  `authenticated` caller belonging to the correct shop, call
  `execute_rule_action` directly for a real `sale.returned` event whose
  `refundAmountUsd` is *below* `large_return`'s threshold, bypassing
  `evaluateLocally()` entirely (as if a compromised or hand-crafted
  client tried to force the rule to fire) — assert the RPC returns
  `'not_matched'` and writes neither a `rule_action_log` row nor a
  `notifications` row. This is the proof that the client's local
  evaluation has no authority and the RPC's own re-evaluation (§2.3
  step 4) is the actual security boundary, not merely business logic.
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
