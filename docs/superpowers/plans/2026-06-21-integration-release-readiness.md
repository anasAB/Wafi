# Integration & Release-Readiness Verification

> Type: verify-and-fix. Owner: the freeing dev (after Tier 3).
> Goal: prove the four parallel work streams (Tier 1, Tier 2, Tier 3, switch-operator) hang together and the app actually builds, deploys, and runs on a real device — before the trip.
> Pairs with the golden-path runbook (`2026-06-21-golden-path-verification.md`), which proves sync/offline/isolation. This one proves *integration + release*.

## Why now
Four streams merged in a short window. Even when files are disjoint, behaviours interact — a sale flows through POS → payment → dashboard → Z-report → audit → reprint, and an operator can switch mid-session. No one has exercised the whole chain on one build. Plus there are two **known release gotchas** (project memory) that only surface in a production build, not in dev.

## Checks — each PASS/FAIL; on FAIL, fix then re-run

### A. Build & release (the known gotchas)
- [ ] **A1 — Full test suite green.** Run the whole suite (not per-file). PASS = all green. A failing test here is a cross-track regression.
- [ ] **A2 — Production build succeeds.** `npm run build`. PASS = clean. **Known trap:** the build type-checks tests, so a TS error in any test file blocks the whole build even though `dev` works. Fix any test TS errors — a green `dev` is NOT proof the build passes.
- [ ] **A3 — Preview/deploy runs.** Serve the production build (preview). PASS = app loads and signs in from the built artifact (not just dev server).
- [ ] **A4 — PWA update behaviour.** With the SW in prompt mode, confirm a new build is picked up (known: may need a second online reload for the SW to take control). Confirm the brother won't be stuck on a stale bundle.

### B. End-to-end integration (one build, exercise the whole chain)
- [ ] **B1 — Sale → everywhere.** Ring a multi-item sale (cash + a split + a credit/on-account). Confirm it shows correctly in: dashboard (revenue/profit), Z-report (per-operator), sale history, and audit log. Numbers reconcile by hand.
- [ ] **B2 — Operator switch mid-session.** Open a shift, ring a sale, **switch operator** (PIN), ring another sale. Confirm: shift stayed open, each sale attributed to whoever completed it, Z-report breaks down per operator, `operator.switched` in the audit log, permissions re-scoped (e.g. a cashier loses owner-only nav).
- [ ] **B3 — Returns + dashboard.** Return part of a sale (restock + store_credit). Confirm dashboard revenue/COGS net correctly (Tier-1 fixes), chart matches cards, and a store-credit refund shows as customer credit (Tier-3 fix).
- [ ] **B4 — Search + reprint.** Find a product by an un-diacritized Arabic query (Tier-3). Reprint a past sale and confirm it matches the original (shop name, split lines) and survives a page refresh on the confirmation screen.
- [ ] **B5 — Audit immutability still holds.** Confirm (SQL or UI) that audit rows can't be edited/deleted after all the merges (Tier-2 guarantee not regressed).
- [ ] **B6 — Manager role end-to-end.** Sign in a manager: can reach products/reports, redirected from settings/staff. PIN lockout still triggers after N wrong attempts.

### C. On the brother's actual device
- [ ] **C1 — Install + run** the production build on the real phone/tablet he'll use.
- [ ] **C2 — Offline rehearsal** (overlaps golden-path V4/V7): sell offline, watch it sync back, 5–10 cycles, no data loss.

## Output
- Pass/fail per check; any cross-track regressions found + fixes (file:line); a short "release-ready: yes/no" verdict.
- Any FAIL in section A blocks a deployable build; any FAIL in B is a cross-track regression to fix before the trip.

## Note
This is the consolidation gate before the trip. After this + the golden-path runbook both pass, the PO assembles the trip-readiness go/no-go. Do NOT start the deferred epics (Auth self-serve, Role-Enforcement) — they're post-trip.
