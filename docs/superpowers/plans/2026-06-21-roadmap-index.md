# Wafi — Planning Roadmap & Index

> Date: 2026-06-21 · Maintained by: PO
> One map for all current planning artifacts: what each is, its status, and the order to do them.
> Anchor goal: get customer #0 (the brother) ringing real sales daily on the Syria trip, then make the product able to hold more than one shop.

---

## Time horizon 1 — Before the trip (the golden path)

Goal: the brother opens Wafi, is already signed in, his real inventory is loaded, he rings sales offline, numbers are correct. **No new features — harden one shop.**

| Item | Artifact | Status |
|---|---|---|
| Single-device auth session | `plans/2026-06-20-task1-single-device-auth-session.md` | Speced; dev reports code complete, blocked on Task 2 to verify |
| Provision brother's account + shop | `plans/2026-06-20-task2-provision-brother-account-shop.md` | Speced; ready to execute (unblocks Task 1) |
| Verify `powersync.yaml` deploys | (co-dependency in Task 2) | Pending — load-bearing infra risk |
| Tenant-scoping trip workaround | Audit ticket WAFI-001 (stub) | Set `VITE_STUB_SHOP_ID` to his shop id |
| Rate-lock fix | Ticket WAFI-002 | Pre-trip fix |
| Double-tap pay fix | Ticket WAFI-003 | Pre-trip fix |
| Dashboard day-boundary | Ticket WAFI-007 | If time |
| Load his real inventory | (white-glove script) | **Blocked: need his spreadsheet** |
| Offline rehearsal on his phone | (test task) | Before flying |

**Dev order:** Task 2 → verify powersync deploy → Task 1 verify → WAFI-001 stub → WAFI-002 + WAFI-003 → inventory load → offline rehearsal.

## Time horizon 2 — Post-trip epics (make it hold >1 shop)

| Epic | Artifact | Why it's next |
|---|---|---|
| Real Auth & Self-Serve Onboarding + Device Registration | `plans/2026-06-20-epic-real-auth-onboarding-device-registration.md` | The gate between one hand-provisioned shop and self-onboarding pilots. Absorbs WAFI-001 (full), WAFI-016. |
| Server-Side Role Enforcement | `plans/2026-06-20-epic-server-side-role-enforcement.md` | Makes roles real (the "see who's stealing" security half). Depends on the Auth epic. Two open design decisions (KD-2, KD-3) deferred. Absorbs server side of WAFI-009, WAFI-012. |

**Parked (post-trip, inside the Auth epic):** self-serve signup/login — deliberately not built for the trip.

## Time horizon 3 — Backlog

| Item | Artifact | Status |
|---|---|---|
| Full audit findings (52 tickets, WAFI-001…052) | `plans/2026-06-20-audit-findings-tickets.md` | Tiered P0–P3; 4 PO decisions locked |
| Switch operator (no shift change) | spec `specs/2026-06-21-switch-operator-design.md` · plan `plans/2026-06-21-switch-operator.md` · ticket WAFI-053 | ✅ DONE + verified (9/9 AC pass, 62/62 tests). Closed WAFI-011 too. |

---

## Post-pivot build order (decided 2026-06-21)

**Strategy change:** real inventory loads *after* the trip (CEO provides the catalog on return). The trip is now a **demo + buy-in** moment (shown with sample data); the brother's real daily use begins post-trip. So we invest now in making the *single shop* correct, trustworthy, and complete — not in scaling features. The brother **has 1+ employees**, so the accountability cluster is day-one valuable to him.

**Build now, in order:**
- **Tier 1 — Correctness & trust:** ✅ **DONE + verified** (5/5, regression tests): WAFI-002 · 003 · 004 · 005 · 006 · 007 · 008. Plan: `plans/2026-06-21-tier1-correctness.md`.
- **Tier 2 — Accountability (has staff):** WAFI-009 (immutable audit) ✅done (client/DB trigger; server-side gating still in the Role-Enforcement epic) · WAFI-012 (PIN hardening) ✅done (salted hash + per-device offline lockout; server-coordinated lockout deferred to WAFI-010) · WAFI-014 (attribution/events) ✅done · WAFI-013 (Manager role) ✅done · switch-operator ✅done. Plan: `plans/2026-06-21-tier2-accountability.md`.
- **Tier 3 — Usability polish:** ✅ **6/7 done + verified** (WAFI-018 · 030 · 031 · 032 · 025 · 026/027 · 022). **Open: WAFI-021 void/reverse-receiving path** (zero-cost guard done; no undo for a mis-keyed receiving). Plan: `plans/2026-06-21-tier3-usability.md`.

**Deferred (scaling, not the brother's benefit):** WAFI-001 full (run on the stub) · Auth self-serve epic · device registration WAFI-016 (only if a 2nd physical register) · Excel import wizard (white-glove load instead) · **WAFI-010 server-side role epic** (heavy, fights offline — the immutable audit log covers ~90% of the practical "see who's stealing" value for one trusted shop; revisit when scaling to pilots).

**Golden path ✅ PASSED (2026-06-22, 7/7):** V1 deploy · V2 signed-in · V3 ring+sync · V4 offline→online · V5 PWA · V6 cross-account isolation (proven via RLS) · V7 resilience ×10 (no loss/dups). Runbook: `plans/2026-06-21-golden-path-verification.md`.

**Consolidation → trip (features frozen):**
- Integration & release-readiness (four streams hang together + builds/deploys/on-device): `plans/2026-06-21-integration-release-readiness.md` (next for the freeing dev).
- Trip readiness go/no-go + demo runbook (the ship decision): `plans/2026-06-21-trip-readiness-go-no-go.md` — ✅ **GO (2026-06-22)**; only the on-device smoke (A4/C1) remains, done at device setup.

---

## What's left (ground truth 2026-06-21)

Post-pivot build is ~complete (Tier 1 ✅, Tier 2 ✅, Tier 3 6/7, switch-operator ✅). Remaining, in priority order:

1. **Verification gates (in flight, before trip):** golden-path (`golden-path-verification.md`) + integration/release-readiness (`integration-release-readiness.md`). These decide trip readiness.
2. **WAFI-015 — sync reliability (most important UNADDRESSED item).** A rejected ("poison") upload op currently stalls the *entire* queue indefinitely, and `pendingCount` is dead UI so a stuck queue is invisible. For an offline-heavy single shop this is a silent data-trust risk — elevate it. Not in any tier.
3. **WAFI-021 — receiving void/reverse path** (closes Tier 3).
4. **Small cleanups:** WAFI-019 (remove dead negative-stock UI + update Epic 2.4/2.7 spec) · WAFI-035 (rate integer-only) · WAFI-034 (receipt logo, a v1 requirement) · WAFI-033 (exports robustness) · WAFI-036/037 (migration hygiene + data-layer footguns).
5. **Next epic (post-trip):** Real Auth & Self-Serve Onboarding + Device Registration → then Server-Side Role Enforcement.
6. **Remaining P3 polish:** WAFI-038…052.

## Import / Export (plan + trip checklist)

Three workstreams: **export** ✅ built (verify + WAFI-033), **catalog import** = white-glove script on the trip, **historical-sales import** = new post-trip epic that depends on collecting a real old-POS export file on the trip. Plan + the trip data-collection checklist: `plans/2026-06-23-import-export-plan.md`. Decisive trip artifact: **a real export file from his old POS**.

## Planned next feature — WhatsApp messaging (spec + plan ready)

Receipt + statement via free `wa.me` (text-only, review-before-send), plus search-sale-by-receipt-number for returns. The pre-trip dev feature. Spec: `specs/2026-06-23-whatsapp-messaging-design.md` · Plan: `plans/2026-06-23-whatsapp-messaging.md`. Sequencing inside the epic: core → receipt (shippable after plan task 4) → statement.

## Candidate new value features (PO proposals, 2026-06-21)

Competitor-benchmarked, NOT yet on the roadmap, high-value for Syrian retail. Proposed as v1.5 depth.

- **Installment / layaway plans (التقسيط) with WhatsApp due-date reminders.** Structured payment plans (down payment + term + schedule), distinct from the informal credit ledger. *Benchmark:* MENA BNPL (Tabby/Tamara) + regional POS installment modules. *Value:* installments are a cultural staple for MENA electronics/appliances — the brother's exact vertical; reuses customers + payments + WhatsApp-as-portal; drives collection; the installment book is the shop's most critical record → enormous lock-in. Pack: Customer (or its own). Litmus: passes hard for an electronics shop.
- **Guided stock-take / inventory reconciliation (الجرد) with shrinkage detection.** A guided physical count vs system stock → variance → apply adjustments. *Benchmark:* Loyverse "Inventory count", Square "Stock take", Vend/Lightspeed. *Value:* completes the "see who's stealing" thesis — the audit log catches transaction-side fraud; stock-take catches inventory-side shrinkage (the #1 silent loss in a staffed shop); keeps stock accurate → keeps dashboard profit accurate. Pack: Inventory/Staff. v1.5.

- **Profit Report screen — ✅ SPECED (2026-06-23), focused version.** Dedicated `/reports` screen: Week/Month/Quarter **+ custom range**, profit headline + green/red trend chart + plain breakdown, reusing the verified `useDashboardMetrics`. Spec: `specs/2026-06-23-profit-report-design.md`. **Reports v2 (deferred, feedback-driven):** P&L export/PDF · best-sellers here · pre-aggregation · advanced multi-metric charts. (Superseded the quarterly-only idea below.)
- **[superseded] Quarterly profit view + trend chart (CEO/customer-#0 request, 2026-06-23).** "Did I make money over the last 3 months, shown clearly." Extends the existing Today/Week/Month dashboard with a quarter period + a monthly-profit trend chart (3 bars, green/red) + plain-language breakdown (money in − cost of goods − expenses). Pack: **Reporting (+$5/mo)** — also a hook for adopting that pack. *Benchmark:* QuickBooks/Xero P&L + profit-trend charts. **Timing: build POST-trip, not now** — it has nothing to show until ~3 months of real usage accrue (real catalog loads post-trip), and profit accuracy needs cost prices entered. Schedule it so it's ready by the time he has a quarter of data; do **pre-aggregation by month** in that window (computing a quarter live on a cheap Android is slow). **Open questions (ask the brother on the trip):** (1) calendar quarter vs rolling last-3-months; (2) confirm the chart shape; (3) surface a "X products missing cost — profit may be off" caveat.

## PO tickets (2026-06-24) — from the alignment review

New, pickup-ready. Plans dated 2026-06-24. Order: WAFI-054 now → WAFI-058 / WAFI-056 →
WAFI-055 (post-trip epic) → WAFI-010 (post-trip epic). All gated behind landing/verifying
WAFI-015 first.

- **WAFI-054 — Dashboard profit-headline trust.** Profit shown as truth even when sales had
  no cost → attach a period-accurate "estimated" caveat. `plans/2026-06-24-po-tickets-accountability-profit-trust-onboarding.md`. Small; do now.
- **WAFI-055 — Self-serve onboarding + real auth + device registration.** The gate to pilot
  #2; concretizes the 2026-06-20 Auth epic. Same file. First post-trip epic.
- **WAFI-010 — Server-side role enforcement (concretized).** Makes "see who's stealing" real;
  now **also** must enforce owner-only/granted financials (WAFI-058) server-side. Same file.
  Second post-trip epic; resolve KD-2/KD-3 first.
- **WAFI-056 — Forgotten/locked PIN recovery.** Owner+Manager reset a cashier's PIN in
  person; owner self-recovers via account password; reset clears the lockout.
  `plans/2026-06-24-pin-reset-recovery.md`.
- **WAFI-058 — Financial visibility: owner-only by default, owner-grantable to a Manager.**
  Redefines the Manager role; supersedes the "Manager sees reports" half of WAFI-013.
  `plans/2026-06-24-owner-only-financial-visibility.md`.
- **WAFI-057 — Owner WhatsApp digest. ⛔ DEFERRED** — superseded by owner-only financials;
  conditionally revivable if a Manager is granted reports; real fix is the read-only Owner
  Dashboard app / automated push. `plans/2026-06-24-owner-remote-visibility-whatsapp-digest.md`.

## Locked PO decisions (2026-06-20/21)

- **Manager role** — build in v1 (WAFI-013).
- **Negative stock** — forbid/keep the block; update Epic 2.4/2.7 spec to match (WAFI-019).
- **Permissions** — build server-side enforcement; promoted to its own epic (WAFI-010).
- **Exchange rate** — integer-only (WAFI-035).
- **Shift model** — one shift per working session; operators swap inside it (switch-operator spec).
- **Sale attribution** — the operator who *completes* the sale (switch-operator spec).
- **Financial visibility (2026-06-24)** — Owner-only **by default**; the Owner may grant a
  specific Manager `can_view_reports` / `can_view_expenses` (WAFI-058). Manager otherwise
  runs the floor with no financial roll-ups.
- **PIN recovery (2026-06-24)** — no self-service reset; Owner **or** Manager resets a
  cashier's PIN in person (direct-set); Owner self-recovers via account password (WAFI-056).

## Open / pending

- **From CEO:** the brother's inventory spreadsheet (unblocks the pre-trip inventory load).
- **Deferred decisions:** Role-Enforcement KD-2 (sync-time gating vs online-only) and KD-3 (shared-device offline downgrade) — settle with the dev before that epic starts.
- **`devAuth.ts`** — the PO's accidental edit was reverted; the change itself is specified in Task 1 for the dev to make.

## Note on the "see who's stealing" promise

It depends on a cluster that must ship together to be real: immutable audit log (WAFI-009), server-side roles (WAFI-010 epic), and PIN hardening (WAFI-012). Any one alone is theater. Track them as a set.
