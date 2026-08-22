# KPI Ownership Per Feature (WAFI-032)

Canonical, versioned register of "is this feature actually working?" —
one Primary KPI per qualifying feature, with a target, a measurement
source, and a named review cadence. This replaces "we shipped it, we
hope it helps" with an explicit, reviewable claim.

**Rule (see `CLAUDE.md`'s Mandatory Review Lens):** every new or
materially modified user-facing/product-significant feature must
define a KPI here before the work is considered complete. Purely
technical/infrastructure changes are `Not applicable` — don't invent a
KPI to satisfy the checklist. Existing features without a KPI carry
**KPI debt**, tracked explicitly below rather than left invisible;
backfill happens opportunistically (a feature gets a KPI the next time
it's materially touched) or when it's flagged high-value enough to do
proactively.

**KPI Owner** is a role, not an individual — this is a founder-run,
part-time project with no dedicated PM. Every KPI here is currently
owned by **Founder/Product** unless stated otherwise.

**Review cadence:** monthly, alongside the existing operational review
described in `docs/OPERATIONS.md`. If a KPI is below target for two
consecutive months, its "If below target" action is what gets
actioned — not a fresh investigation from scratch each time.

---

## Register

| Feature | KPI Owner | KPI Status | Primary KPI | Target | Review |
|---|---|---|---|---|---|
| Dashboard 2.0 (WAFI-146) | Founder/Product | Defined | See below | See below | Monthly |
| Notifications (WAFI-145) | Founder/Product | Defined | See below | See below | Monthly |
| Reports v1 (WAFI-147A) | Founder/Product | Defined | See below | See below | Monthly |
| Anomaly Detection (WAFI-015) | Founder/Product | Defined | See below | See below | Monthly |
| Business Rules Engine (WAFI-156) | Founder/Product | Defined | See below | See below | Monthly |
| POS core sale flow | — | Backfill needed | — | — | — |
| Returns & refunds (incl. WAFI-010/011) | — | Backfill needed | — | — | — |
| Customer credit ledger + Money Owed (WAFI-017) | — | Backfill needed | — | — | — |
| Installment plans | — | Backfill needed | — | — | — |
| Collections worklist | — | Backfill needed | — | — | — |
| Cashier shifts / Z-report / cash movements | — | Backfill needed | — | — | — |
| Staff performance dashboard (WAFI-018) | — | Backfill needed | — | — | — |
| Stock-take + timeline visualization (WAFI-009) | — | Backfill needed | — | — | — |
| Receiving / cost freshness (WAFI-013) | — | Backfill needed | — | — | — |
| Product import / Excel import | — | Backfill needed | — | — | — |
| WhatsApp receipts / statements / reminders | — | Backfill needed | — | — | — |
| Owner bootstrap & onboarding (WAFI-004) | — | Backfill needed | — | — | — |
| Device registration / multi-device (WAFI-003) | — | Backfill needed | — | — | — |
| Offline sync indicator (WAFI-019) | — | Backfill needed | — | — | — |
| Automatic Insights banner (WAFI-144) | — | Backfill needed — small enough to likely fold into Dashboard 2.0's KPI on next touch | — | — | — |
| Audit log page (WAFI-007) | — | Not applicable | operational/compliance tooling, not a product-success surface | — | — |
| Server-side auth/RLS hardening (WAFI-001/002/122/202/203) | — | Not applicable | security infrastructure | — | — |
| Event bus / durable subscribers (WAFI-140/150) | — | Not applicable | infrastructure, no direct owner-facing surface | — | — |
| Projection rebuild & recovery (WAFI-151) | — | Not applicable | infrastructure | — | — |
| Read models / `profit_cache` (WAFI-153) | — | Not applicable | infrastructure — success is measured via the features it feeds (Dashboard 2.0, Reports) | — | — |
| Background job framework (WAFI-154) | — | Not applicable | unused framework, no adopters yet | — | — |
| Feature flag framework (WAFI-155) | — | Not applicable | unused framework, no adopters yet | — | — |
| Event contract testing (WAFI-157) | — | Not applicable | engineering quality gate | — | — |
| Sentry monitoring + in-app "report a problem" (WAFI-023) | — | Not applicable | operational tooling; already has its own weekly-review process in `docs/OPERATIONS.md` | — | — |
| Deployment/backup/runbook docs (WAFI-021/022) | — | Not applicable | operational process, not a product feature | — | — |

Rows above are the current best-effort inventory of shipped
product-facing surfaces as of 2026-08-19 — not exhaustive. If a
shipped feature is missing, add it as `Backfill needed` rather than
assume it's covered.

---

## Dashboard 2.0 (WAFI-146)

**Primary KPI:** % of shop-days with at least one owner session that
opens the Home dashboard and expands/interacts with at least one card
beyond the default collapsed view (mobile accordion).

**Target:** ≥70% of active shop-days.

**Measurement:** not yet instrumented. No audit/analytics event
currently fires on Home mount or card expand. Requires a new
lightweight `dashboard.card_expanded` (or similar) event, following
the existing `messaging.whatsapp_composed`-style "records the action
happened" pattern from WAFI-012 — routine/best-effort, not
transactional.

**If below target:** investigate which card(s) get no engagement — a
consistently-ignored card is a signal to simplify, reposition, or cut
it, not to add more detail to it.

**Owner:** Founder/Product.

---

## Notifications (WAFI-145)

**Primary KPI:** % of CRITICAL/WARNING notifications acknowledged
within 24 hours of firing.

**Target:** ≥60%.

**Measurement:** already available — `notifications` table has
`acknowledged_at`/read state; `NotificationCenterScreen.vue` already
surfaces acknowledgment. A simple monthly query (`acknowledged_at -
created_at < 24h`, grouped by severity) covers this with no new
instrumentation.

**If below target:** either the notification rules are too noisy
(check per-rule ack rate — a specific rule dragging the average down
is a stronger signal than the aggregate), or the business-hours/timing
config is misconfigured for that shop.

**Owner:** Founder/Product.

---

## Reports v1 (WAFI-147A)

**Primary KPI:** number of distinct reports opened per active shop per
week.

**Target:** ≥3 distinct reports/week per shop with reporting-pack
access.

**Measurement:** not yet instrumented. No audit event exists for
report views today. Requires a new `reports.viewed` event (report
type + shop), same best-effort pattern as WAFI-012's WhatsApp-compose
logging — cheap to add, and directly informs the 147A build-order
priority already recorded in the roadmap (which reports are actually
used tells you what to build first for 147B/147C).

**If below target:** low adoption of a specific report is a stronger
signal to deprioritize its 147B/147C scheduling+delivery work than
theoretical usefulness.

**Owner:** Founder/Product.

---

## Anomaly Detection (WAFI-015)

**Primary KPI:** % of flagged anomalies investigated (owner taps
through to the underlying data), not just dismissed, within 24 hours.

**Target:** ≥40%.

**Measurement:** partially available. `useAnomalyDismissal.ts`
already logs dismissals. The "investigated" half doesn't exist yet —
requires a new signal (e.g., tapping an anomaly banner navigates to
the relevant report/screen; log that navigation as
`anomaly.investigated` with the rule id).

**If below target:** a low investigate-rate against a specific one of
the 7 rules means that rule is noisy or not actionable — candidate for
tuning its threshold or removing it, not for building more rules.

**Owner:** Founder/Product.

---

## Health Alerting — Evaluation Freshness (WAFI-148A)

**Primary KPI:** alert evaluation freshness — how often each evaluator
type actually runs, per shop where applicable. Concretely: median/p95/max
time between consecutive `evaluation_source='scheduled'` log rows (one
value across all shops, since scheduled evaluators run shop-agnostic cron
ticks); median/p95 time between eligible foreground-check opportunities
and the next `evaluation_source='foreground'` log row, per shop.
`evaluation_source='event'` (the drawer-mismatch evaluator) is expected to
be near-instant, bounded by shift-close transaction latency — it is not
really a "freshness" concern and is not part of this KPI's target-setting.

**Target:** Pending — depends on the chosen `pg_cron` interval and typical
shop foreground-check cadence, neither of which product has weighed in on
yet. This is Gate 3 of the WAFI-148A design spec, still open. Do not
invent a number here; this section stays "instrumented, target pending
product sign-off" until product supplies one.

**Measurement:** now available via `health_alert_evaluation_log`
(migration 124, WAFI-148A Task 14) — one row per evaluator invocation
(`evaluation_source` in `event`/`scheduled`/`foreground`, `shop_id`
populated for `event`/`foreground`, NULL for `scheduled`, `started_at`/
`completed_at` per invocation). Median/p95/max are derivable via a
straightforward query grouping by `evaluation_source` (and `shop_id`
where populated) over consecutive `started_at` gaps.

**If below target:** n/a yet — no target exists to be below.

**Owner:** Founder/Product.

---

## Business Rules Engine (WAFI-156)

**Primary KPI:** % of shops that have modified at least one rule's
threshold/config away from its shipped default within 30 days of
first exposure.

**Target:** ≥20% in the first month after a shop gains access.

**Measurement:** already available — `business_rules` table holds
per-shop config; a default-vs-current diff is a straightforward
monthly query, no new instrumentation needed.

**If below target:** owners aren't discovering or don't understand the
Rules screen (`RulesScreen.vue`) — a discoverability/UX problem, not a
rules-engine problem, since the engine itself already proved out via
the retired native Large Return/Drawer Variance rules it replaced.

**Owner:** Founder/Product.
