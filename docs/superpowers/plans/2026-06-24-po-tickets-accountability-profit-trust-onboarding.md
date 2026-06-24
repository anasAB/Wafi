# PO Tickets — Profit Trust · Accountability Enforcement · Self-Serve Onboarding

> Date: 2026-06-24 · Owner: PO
> Source: PO critical alignment review (points 2.3, 2.1, 2.4).
> Three tickets the dev can pick up independently. Each is concrete, lists edge
> cases, and states acceptance criteria + a definition of done.
>
> | Ticket | Maps to review point | Relation to existing work |
> |---|---|---|
> | **WAFI-054** | 2.3 Profit headline can be wrong | New |
> | **WAFI-010** | 2.1 Accountability is unenforced | Concretizes existing WAFI-010 (was a deferred stub) |
> | **WAFI-055** | 2.4 No self-serve onboarding | Concretizes `plans/2026-06-20-epic-real-auth-onboarding-device-registration.md` |

---

## WAFI-054 — Dashboard profit headline is shown as truth even when cost data is missing

**Priority:** P1 (flagship-feature trust) · **Pack:** Core · **Area:** dashboard

### Problem
The home dashboard's entire value proposition is "am I making money today." Profit
is computed as `revenue − COGS − expenses` in
`src/features/dashboard/composables/useDashboardMetrics.ts:16`. COGS is the sum of
`sale_line_items.unit_cost_usd` (the cost snapshot taken at sale time, lines 27–33).
When an item was sold with **no cost** (`unit_cost_usd` = 0 / NULL), its COGS
contribution is 0, so **profit is overstated** — the dashboard confidently shows a
number that is wrong.

A `missingCostCount` already exists (line 13, query lines 63–68) **but**:
1. It counts *currently active products* with no `cost_price_usd` — it does **not**
   measure whether the **sales in the selected period** actually had missing cost.
   A shop can have 0 cost-less active products yet a period full of cost-less sales
   (product later fixed, or deleted), and vice-versa. The signal shown must reflect
   the period being displayed.
2. Nothing surfaces it on the **profit number itself** — it returns from the
   composable and may or may not be rendered elsewhere; the headline reads as exact.

### Scope
**In:**
- Compute a period-accurate "cost coverage" signal and attach a caveat to the
  profit figure wherever profit is shown: the home `MetricCard` profit tile and the
  `ProfitSheet` drill-down.
- Plain-language caveat (Arabic-first), e.g. "ربح تقديري — {n} عملية بيع بدون تكلفة"
  / "Estimated — {n} sales are missing a cost price, real profit is lower."
- A tap-through from the caveat to the list of affected products (reuse the existing
  products screen filtered to missing-cost) so the owner can fix it.

**Out:** auto-estimating a cost; changing how cost is captured at sale time;
back-filling historical costs.

### Implementation notes
- Add a query that counts the **period's** affected sales/lines, not active products:
  count distinct `sales` in `[start,end]` having ≥1 `sale_line_items` row with
  `unit_cost_usd = 0 OR unit_cost_usd IS NULL` (shop-scoped, same `DATE(...,'localtime')`
  boundary as the rest of the file — see WAFI-007). Keep the existing
  `missingCostCount` (active products) for the "go fix it" entry point if useful, but
  the caveat **must** be driven by the period query.
- Expose e.g. `costlessSalesInPeriod` + a boolean `profitIsEstimated` from the
  composable; render the caveat only when `profitIsEstimated`.
- Do **not** hide the profit number — degrade it (label + secondary text), never blank.

### Edge cases
- Period with **zero sales** → no caveat (not "estimated"), profit shows 0/empty state.
- All sales have full cost → **no caveat** shown (don't nag a clean shop).
- A sale that is fully returned/refunded but had missing cost → don't count it toward
  the caveat if it no longer contributes to revenue/COGS for the period.
- Mixed: some lines on a sale have cost, some don't → the sale still counts as
  "missing cost" (its profit is partially wrong). Count at sale granularity, message
  in terms the owner understands ("sales", not "line items").
- Localtime day boundary must match the other metrics exactly (UTC+3 shop) — reuse
  `getDateRange`; do not introduce a second boundary.
- Multi-currency: cost is in USD by convention; SYP-priced sales still snapshot a
  USD cost — the query is currency-agnostic (checks the USD cost column only).

### Acceptance Criteria
- [ ] Selecting a period where ≥1 sale had a missing/zero unit cost shows an
      "estimated profit" caveat on **both** the profit tile and the ProfitSheet.
- [ ] The caveat count reflects sales **in the selected period**, not the global
      active-product count; switching period updates it.
- [ ] A clean period (all costs present, or zero sales) shows **no** caveat.
- [ ] Tapping the caveat opens the products list filtered to products missing a cost.
- [ ] Caveat text exists in `ar` and `en` i18n and renders RTL correctly.
- [ ] Day-boundary identical to revenue/COGS (UTC+3 test: a 2 AM sale lands in the
      same day for profit and caveat).

### Definition of Done
Unit test on the composable: seed a period with one full-cost sale and one
zero-cost sale → `profitIsEstimated === true` and the count === 1; remove the
zero-cost sale → `profitIsEstimated === false`. Caveat verified visible on device in
both languages. Merged, build green (`npm run build`), no regression in existing
dashboard tests.

---

## WAFI-010 — Make the "see who's stealing" promise enforceable (server-side roles)

**Priority:** P1 epic (post-trip) · **Pack:** Core · **Area:** permissions / RLS / sync
**Status:** Concretizes the previously-deferred WAFI-010. Depends on WAFI-055 (staff
identity needs the real-auth layer). Does **not** block the trip.

### Problem
We sell accountability ("see who's stealing"), but enforcement today is a
client-side honor system. `isRouteAllowed` (`src/router/permissions.ts`) gates the
**UI** only; RLS scopes data by **shop**, not by **role/staff**. Anyone with the
shop's anon key (i.e. any cashier on the device, or anyone who extracts the key) can
read/write everything — including other staff's PIN hashes, the audit log, and
profit-bearing data — by calling the API directly, bypassing the UI entirely.

Per our own note (roadmap index, "see who's stealing"): the cluster — immutable
audit log (WAFI-009 ✅), PIN hardening (WAFI-012 ✅), and **server-side role
enforcement (this ticket)** — must all be real, or the promise is theater. The first
two shipped; this is the missing third. **Until this ships, do not market
role-based "see who did what" as a security guarantee to shops that don't trust
their staff** — describe it as attribution/visibility, not enforcement.

### Resolve first (blocking design decisions — owned by PO + dev)
- **KD-2:** role gating at **sync time** vs **online-only via Edge Function**.
- **KD-3:** shared-device offline downgrade — what a cashier can do offline when the
  role-gated data can't be synced to that device.
  Both are flagged open in the roadmap. **This ticket cannot start until both are
  decided**, because they determine whether gated data is offline-available at all
  (Sacred Rule #1 trade-off).

### Scope
**In:**
- A per-staff server identity distinct from the shop's Supabase account: a short-lived
  staff token carrying `staff_id` + `role`, minted after a successful PIN entry
  (Edge Function), so the server can tell *which staff* is acting, not just *which shop*.
- Server-side enforcement on the sensitive surfaces: **staff PIN hashes**, **audit
  log reads**, and **profit/reports reads**. A cashier-role session must not be able
  to read these via the API/anon key.
- Sync rules (`powersync.yaml`) updated so role-gated tables do **not** sync to
  under-privileged devices (per the KD-2 decision).
- An explicit, written per-surface decision: "online-only role-gated" vs "synced
  offline" for each sensitive table.

**Out:** new roles (Manager already exists, WAFI-013); the audit log itself
(WAFI-009 done); PIN hashing (WAFI-012 done); UI permission gating (already present —
this is the server half).

### Edge cases
- **Offline cashier** on a role-gated surface → must fail closed in a defined,
  non-data-losing way (per KD-3); never silently expose gated data, never stall the
  sale queue.
- **Token expiry mid-shift / mid-offline** → graceful: the operator re-enters PIN;
  no lost sales, no queue stall.
- **Owner/Manager vs cashier** boundaries enforced server-side match the client
  matrix exactly (no surface where UI says "no" but API says "yes", or vice-versa).
- **Operator switch within a shift** (WAFI-053) → the staff token must re-mint for the
  new operator; the prior operator's elevated reads must stop working immediately.
- **Anon-key extraction** (the threat we're closing) → a raw anon-key call for a
  gated table returns nothing/403 without a valid staff token.
- **Sync reconciliation** → a device that gains/loses a role must converge (gated
  rows appear/disappear) without duplicating or orphaning local data.

### Acceptance Criteria
- [ ] KD-2 and KD-3 are decided and recorded (ADR or in this ticket) before code.
- [ ] A cashier-role session **cannot** read another staff's PIN hash, the audit log,
      or profit/reports through **any direct API/anon-key call** (not just the UI).
- [ ] Owner and Manager can read their permitted surfaces server-side; the server
      matrix is identical to `permissions.ts`.
- [ ] Role-gated tables are excluded from sync to under-privileged devices per the
      KD-2 decision; the per-surface online/offline decision is documented.
- [ ] Operator switch re-mints identity; revoked role loses access immediately.
- [ ] No regression to Sacred Rule #1 for **non-gated** data: a cashier still rings
      sales fully offline; the upload queue never stalls due to a 403 on a gated read
      (coordinate with WAFI-015).

### Definition of Done
Adversarial test passes: using only the shop anon key + a cashier staff token, every
sensitive read is rejected; with an owner token, allowed. Offline cashier flow
verified (sales work, gated data behaves per KD-3, no queue stall). ADR for KD-2/KD-3
merged. Build green; golden-path + integration suites still pass.

---

## WAFI-055 — Self-serve onboarding so pilot #2 can sign up without us

**Priority:** P0 for growth (post-trip, first epic) · **Pack:** Core · **Area:** auth / onboarding / device
**Status:** Concretizes `plans/2026-06-20-epic-real-auth-onboarding-device-registration.md`.
This ticket is the pickup-ready checklist; that epic holds the full design + KDs.

### Problem
The product can hold exactly **one** shop, hand-provisioned. Signup/login pages are
**unrouted mockups** (`SignupPage.vue`, `LoginPage.vue`, `OnboardingPage.vue`);
tenancy runs on the `VITE_STUB_SHOP_ID` stub; device identity is a hardcoded env
stub shared by every install (`device.store.ts`). The entire year-1 plan is
*trip → 3–5 pilots → referrals*, but **we cannot onboard pilot #2 without doing it by
hand**. This violates Working Principle #9 ("if a feature requires calling the
customer, it's broken") and the v1 commitment to 30-minute self-serve onboarding.
This is the single thing standing between us and a second customer.

### Locked decisions (from the epic — confirm feasibility, don't re-litigate)
- Auth identifier = **phone + password, no SMS OTP** for v1; email optional for recovery.
- Provisioning is **server-side and atomic**: an account must never exist without a
  linked shop + default Owner staff record (a half-created account silently locks the
  owner out — this is the #1 failure to prevent).
- Device codes: server-allocated permanent (A, B, C…), temporary offline (T-xxxx),
  reconciled on sync — so two devices never share a code (which would collide sale
  numbers).
- Password recovery = assisted reset for v1 (acceptable at 5–15 pilots).

### Scope
**In:**
- Wire the existing signup mockup to real Supabase auth (account → business → goal),
  capturing identifier + password + shop name + business type + country.
- Server-side atomic provisioning (trigger/function): create `shops`, set
  `owner_user_id`, create default Owner `staff`; roll back fully on any failure.
- Real login wired to the same path; `devAuth.ts` auto-sign-in demoted to a
  single-device convenience only.
- Auth route guard in `router/index.ts` (today it only checks staff PIN): an
  unauthenticated user is sent to login; an authenticated one with no shop is a
  **forbidden state** that must not occur (see AC).
- Real per-install device registration replacing the env stubs in `device.store.ts`;
  permanent + temporary codes, reconciled on sync.
- Remove dependence on `VITE_STUB_SHOP_ID` for the self-serve path (keep the stub
  only as the brother's documented single-device convenience).

**Out:** self-serve **password reset** UI (assisted reset is fine for v1); SMS OTP;
multi-shop-per-account; the server-side **role** enforcement (that's WAFI-010).

### Edge cases
- **Provisioning fails after account create** → no orphaned account; clear error;
  user can retry; never stranded with account-but-no-shop.
- **Duplicate phone number** at signup → clear "account exists, sign in" path, no
  partial create.
- **Two devices, same shop, offline simultaneously** → temporary codes (T-xxxx) don't
  collide; sale numbers don't collide; both reconcile on reconnect with no dup/lost
  sales.
- **Offline-first signup** → signup/provisioning inherently needs connectivity; the
  app must state this clearly and not appear broken offline (the brother's device,
  already provisioned, must still launch and ring sales offline — don't regress him).
- **Returning login on a fresh install** → resolves the real shop id from the synced
  `shops` row (not a stub) and registers the device.
- **Country/business type** captured at signup must not hardcode Syria (international
  cold signups are accepted by design).
- **Migration of the brother's existing stub shop** → must keep working; document the
  path from stub → real `owner_user_id` link.

### Acceptance Criteria
- [ ] A brand-new owner completes signup (phone + password + shop name + type +
      country) and lands signed-in, in an empty-but-usable shop, with **no** founder
      involvement.
- [ ] Shop + `owner_user_id` + default Owner staff are created server-side atomically;
      a forced provisioning failure leaves **no** orphaned account and reports a clear error.
- [ ] Login works on a fresh install (prod build, no stub) → resolves the real shop id
      → device registers → sync read/write succeed.
- [ ] Two accounts are fully isolated (account B sees none of account A's data) —
      re-run golden-path V6 with **self-provisioned** shops, not the stub.
- [ ] Two devices on one shop ring sales offline simultaneously → no colliding sale
      numbers, no dup/lost sales after reconnect.
- [ ] The brother's existing single-device setup still launches and rings sales
      offline (no regression).
- [ ] No path produces an account-without-shop state.

### Definition of Done
Two clean self-serve signups from scratch on a prod build, isolated, each ringing
sales and syncing; the two-device offline collision test passes; golden-path +
integration suites pass with self-provisioned (non-stub) shops; the brother's device
verified non-regressed. Atomic-provisioning failure path tested. Merged, build green.

---

## Suggested order
1. **WAFI-054** (small, high trust impact, no dependencies) — do now.
2. **WAFI-055** (the growth gate) — first post-trip epic.
3. **WAFI-010** (depends on WAFI-055's staff identity; resolve KD-2/KD-3 first) — second post-trip epic.
