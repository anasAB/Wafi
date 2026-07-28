# WAFI Unified Architecture Roadmap V3.0
## Production Readiness + Event-Driven Platform + Enterprise Architecture
### Version: 3.0 | Date: 2026-07-21 | Status: STAFF ENGINEER REVIEWED
### Last implementation update: 2026-07-27

---

## IMPLEMENTATION STATUS (as of 2026-07-27)

Quick-scan status for anyone opening this doc cold. Full narrative for each
ticket lives in its row in the tables below — this section is the summary,
not a replacement for them.

| Item | Status | Note |
|---|---|---|
| WAFI-001 (Server-Side Role Enforcement) | 🟢 Shipped, pending only founder signatures | RLS/JWT mechanism live (WAFI-122). WAFI-202 (sales immutability) and WAFI-203 (operator identity) both shipped — see below. Migrations `064_wafi202_sales_immutability.sql`, `066_fill_missing_table_grants.sql`, and now `068_wafi001_cash_shift_hardening.sql` are **applied to the production Supabase project**. A full-codebase security review on 2026-07-22 (`docs/security-review-2026-07-22.md`) found 2 further RLS gaps (`cashier_shifts` stale permissive UPDATE/DELETE policy; `cashier_shifts`/`cash_movements` INSERT lacked staff-attribution); migration 068 + `supabase/tests/wafi001_cash_shift_hardening.test.sql` (10 assertions) fixed both. **Verified 2026-07-26**: no local Docker was available, so the full migration history (001-068) was applied to a disposable Supabase project and all four pgTAP suites were run via a plain Node/`pg` script (since `supabase test db` needs Docker) — **39/39 assertions pass** (WAFI-122: 13, WAFI-202: 16, WAFI-003: 6, WAFI-001 hardening: 10), no regressions. **Migration 068 applied to production 2026-07-26**, independently confirmed via a `pg_policies` query matching the exact expected policy names and `qual`/`with_check` expressions. The founder sign-off doc `docs/security-signoff-wafi001.md` is otherwise complete; only the CEO/CTO signatures remain outstanding — this is a "no external pentest firm, founder-executed sign-off" per the project's budget constraints, not a placeholder for further engineering work. |
| WAFI-202 (Sales/Returns Immutability RLS) | ✅ Shipped, **now executed for real, applied to production** | Migration `064` + 16-case pgTAP suite merged. All 16 assertions pass against a real local Postgres (`npx supabase test db`) — no longer "traced not run". Applied to production 2026-07-22. |
| WAFI-203 (Operator Identity Server-Authoritative) | ✅ Shipped | `establishOperatorIdentity` gates `openShift` (new-shift + resume) and `switchTo`; `usePayment.confirm()` refuses a sale with no active operator. Merged to main. |
| WAFI-122 pgTAP suite, Sections A–C (role×table automated tests) | ✅ Shipped, **now executed for real** | `supabase/tests/wafi122_role_enforcement.test.sql`, 13 assertions, **all passing against a real local Postgres, 2026-07-22**. Section D (live REST pentest) stays manual by design. |
| WAFI-002 (Real Authentication System) | ✅ Gap-closing pass shipped | Investigation found signup/login/PIN/JWT/tenant-isolation already worked (not a from-scratch build). Verified session-refresh handling and `ForgotPasswordPage.vue` need no changes. Removed the `devAuth.ts` production auto-sign-in stub + its dead env vars, and wrote a runbook for migrating the one live customer (brother's shop) who depended on it onto real login — see `docs/superpowers/plans/2026-07-22-wafi-002-customer0-login-migration-runbook.md`. That on-device migration step is still pending (human-executed, not done by this session). |
| WAFI-003 (Self-Serve Device Registration) | ✅ Gap-closing pass shipped | Investigation found multi-device registration, device codes, and the self-serve device list (`DevicesScreen.vue`) already worked. The one real gap — remote sign-out only flipped a soft `is_active` flag, with no actual session revocation — is now fixed: migration `067_device_session_revocation.sql` adds `record_device_session_id`/`revoke_device_session` RPCs (reusing `device_sessions.session_id` from migration 048), `device.store.ts` records each device's session id on sign-in, and `useDevices.ts::setActive` revokes it on deactivate. All 3 pgTAP suites pass (35/35 assertions). Final whole-branch review caught and fixed a real bug (`sessionIdRecorded` not reset on sign-out, which would have silently defeated revocation across a same-session sign-out/sign-in cycle). Migration 067 applied to production and the manual two-browser-profile live-session revocation check both confirmed 2026-07-23 — **fully done, no longer blocked.** |
| WAFI-004 (Owner Bootstrap & Onboarding) | ✅ Shipped 2026-07-23 | Unlike WAFI-002/003, this ticket's gaps were real: `OwnerSetupScreen.vue` only handled PIN creation then always routed home, `store.startGoal` (captured at signup) was written and never read, `OnboardingPage.vue` was a real hub but orphaned from the actual flow, and no exchange-rate first-run prompt or demo-data option existed. Fixed: new `useDemoDataSeed.ts` composable seeds 5 generic-retail products tagged `created_via: 'demo_seed'` (zero new migrations — reuses the existing plain-text column from migration 051); `OwnerSetupScreen.vue` now shows a skippable exchange-rate prompt (reusing `ExchangeRateEditor.vue` as-is) then routes by `startGoal` — `sell`→`/pos`, `inventory`→`/products/add`, `explore`→seed demo data→`/onboarding`. Final whole-branch review caught and fixed a real concurrency bug (`ExchangeRateEditor` emits both `saved` and `close` on save; binding both to the same handler double-seeded demo products) — fixed and regression-tested. **Still pending before production:** the manual three-goal signup walkthrough (plan Task 3, Step 3) confirming real-browser routing and that demo products render normally — not yet performed. |
| Owner Bootstrap Circular-Lockout Fix (found + fixed 2026-07-26/27, not a pre-existing WAFI-NNN ticket) | ✅ Shipped, merged to main | **Launch-blocking bug discovered via live production reproduction**: self-serve owner signup could never complete first-run setup — the owner's own `staff` row and first `devices` row are created client-side (offline-first), but uploading either to Supabase requires `auth_role()='owner'`, which is only ever set by `switch_active_operator()` succeeding, which itself requires those same rows to already exist server-side. Fully circular; broken since the WAFI-122 RLS hardening shipped, never caught because production had no working shop-provisioning trigger until this session's WAFI-001 work fixed migration `021_provision_shop_on_signup.sql` (see above) — nobody had exercised a real fresh signup against the hardened RLS before. **Fix**: new `SECURITY DEFINER` RPC `bootstrap_owner_identity()` (migration `069_bootstrap_owner_identity.sql`) that atomically creates the owner's devices/staff/device_sessions rows server-side, gated on an explicit `shops.bootstrap_completed_at` marker (not `staff.role='owner'` existence, so it stays meaningful if WAFI later grows ownership transfer/co-owners). Client-side: `src/data/supabase/bootstrap.ts` (RPC wrapper + named constants), `src/features/staff/bootstrap.store.ts` (crash-recovery `PendingBootstrap` record), `src/features/staff/composables/useOwnerBootstrap.ts` (RPC call + session refresh + local-DB poll + timeout/retry UI), `OwnerSetupScreen.vue`/`StaffForm.vue` rewired to call the RPC directly instead of a local-only write, and a boot-time auto-resume hook in `src/router/index.ts` for a bootstrap left incomplete by a crash. Full design at `docs/superpowers/specs/2026-07-26-owner-bootstrap-rpc-design.md`, plan at `docs/superpowers/plans/2026-07-27-owner-bootstrap-rpc-plan.md`. Built via subagent-driven development (9 tasks, each independently task-reviewed). **Final whole-branch review caught a second Critical bug**: a network failure during the very first bootstrap attempt left a `PendingBootstrap` record persisted with no server-side state; the boot-time auto-resume would then replay the RPC with blank name/PIN, and since `bootstrap_completed_at` was still NULL the RPC would proceed to create a real owner with **blank credentials**, permanently bricking the account. Fixed at both layers: server-side guard rejecting blank name/PIN before any INSERT (structurally impossible regardless of caller), and client-side `resumePendingBootstrap()` clearing the stale record on that outcome instead of looping forever. A follow-up grant-narrowing fix (`anon` EXECUTE removed, `authenticated`-only) initially missed that `REVOKE ALL FROM public` doesn't touch a pre-existing explicit `GRANT TO anon` — caught by direct production verification and fixed with an explicit `REVOKE FROM anon`. **Verified**: 12 new + 45 pre-existing pgTAP assertions (57 total across 5 suites) pass against a disposable Supabase project, zero regressions; migration 069 (final, fully-fixed form) applied to and confirmed live on production (`eazyrdnvsiyaaccvjbhb`) via direct `pg_proc`/`information_schema.routine_privileges` queries. Second final whole-branch review verdict: **Ready to merge — Yes**. **Still pending**: a manual, real-browser signup-through-to-`/pos` walkthrough (fresh phone signup → owner PIN setup → confirm no `server-side PIN verification failed` error → try the offline/timeout retry path → try a forced-crash-mid-setup to confirm auto-resume) — not performed by any subagent, requires a human on a running instance. |
| WAFI-007 (Complete Audit Event Wiring) | ✅ Shipped 2026-07-23 | Investigation found the headline bar already exceeded: 48 event types logged (ticket wanted "32+"), and append-only enforced by both grant revocation AND a hard `BEFORE UPDATE OR DELETE` trigger (migration 018), not just RLS. Two real gaps fixed: (1) `executeFinancialWrite` (previously scoped only to the staff-ledger feature, hardcoded `can_view_expenses`) generalized and relocated to `src/composables/`, with an optional `requiredPermission` param — retrofitted into all 6 known financial-write composables (`usePayment`, `useReturnSheet`, `useCashMovements`, `useInstallmentPlan`, plus the 2 pre-existing staff-ledger sites) as pure structural refactors, zero behavior change (1024/1024 tests pass, identical before/after per composable). (2) `AuditLogPage.vue`'s filter dropdown backfilled from 28 to all 48 event types, with a regression test locking coverage. **Deliberately did not** add a hard runtime guarantee (DB trigger/transactional coupling) forcing audit success — this app's audit logging for financial writes is intentionally best-effort/non-blocking (offline-first), and the wrapper only guarantees the audit *call* happens, not that it succeeds. **Follow-up identified, not blocking:** `useExpenses.ts` (createExpense/updateExpense/deleteExpense) and `useCustomerBalance.ts` (recordPayment) have the same inline write+log pattern but were outside this ticket's original scope (design doc undercounted "6 composables" — there are at least 8) — worth its own small ticket later; `createExpense` logs once per row in a loop (recurring expenses), which doesn't fit the wrapper's single-write/single-audit shape as-is and needs a design note if picked up. |
| WAFI-023 (Post-Launch Monitoring & Feedback) | ✅ Core shipped 2026-07-23 | Genuinely unbuilt before this pass (unlike WAFI-002/003/004/007) — confirmed no monitoring SDK, no in-app feedback UI anywhere in the repo. Scoped to the founders' part-time/low-budget constraints: `src/sentry.ts` adds Sentry (free tier), gated to no-op without `VITE_SENTRY_DSN` and outside production builds. A new Settings screen ("الإبلاغ عن مشكلة") and `ForgotPasswordPage.vue`'s previously-inert support prose both now open WhatsApp via the existing `openWhatsApp` helper — no new messaging code. `docs/OPERATIONS.md` covers a weekly review checklist and an honest SLA. **Final whole-branch review caught and fixed a real Critical PII-leak gap**: the scrubber only covered `event.extra`, missing `@sentry/vue`'s default `attachProps` (ships erroring component props — customer names/phones) and its breadcrumbs integration; fixed with `attachProps: false` plus defense-in-depth scrubbing of both channels, independently verified against the installed package's own type definitions. Also added `VITE_SENTRY_ENVIRONMENT` tagging so a misconfigured staging build can't silently commingle with real production data. **Still pending, Ongoing scope not done in this pass**: the "weekly review" and "SLA" are documented processes for the founders to actually practice, not something code can verify as done; WAFI-022's later "monitoring tested" checklist item can now be attempted since monitoring exists. **Manual step still required before production**: create a real Sentry project and a real WhatsApp support number, set `VITE_SENTRY_DSN`/`VITE_SUPPORT_WHATSAPP_PHONE` in the actual deployment environment, and confirm a test error appears in Sentry and the report button opens WhatsApp on a real device — none of this was performed by any subagent. |
| WAFI-022 (renamed: Deployment Readiness & Operational Runbook) | ✅ Shipped 2026-07-23 | Renamed from "Production Deployment Checklist" — what it actually produces (deployment procedure, rollback strategy, backup verification, release logging) is broader than a checklist. Real build-time version identification (`src/version.ts`: version/git SHA/build date/highest-applied-migration-number) replaces a hardcoded `'v0.1.0'` placeholder in `SettingsPage.vue`. `docs/DEPLOYMENT.md` covers a Before/During/After deployment checklist, a mandatory 5-minute smoke test, explicit PWA/service-worker cache verification, and a three-way rollback split (application rollback is possible; **data rollback is impossible** — migrations are additive-only, forward-migration-only; emergency recovery is the backup-restore last resort). `docs/releases/` established as an ongoing release log, `package.json` version bumped from the unmaintained `0.0.0` placeholder to a real `0.1.0`. **Major finding from the guided backup-verification walkthrough with the project owner**: the production Supabase project is on the **Free tier, which has zero backup capability today** — confirmed directly against the dashboard ("Free Plan does not include project backups"), documented honestly in `docs/BACKUP.md` with no fabricated "last verified restore date," and surfaced directly in `docs/DEPLOYMENT.md`'s rollback section per the final whole-branch review (an operator reading the runbook during an incident must see this immediately, not have to click through to a separate doc). Per the owner's explicit choice, no upgrade recommendation was included — the decision on whether/when to add real backups is the founders' to make. |
| WAFI-016 (Cash Movement + Profit Report Exclusion) | ✅ Shipped 2026-07-27 | An audit found this genuinely not started (unlike WAFI-006/019 below). Added an explicit footnote + info tooltip + a `RouterLink` to `/shifts/history` below the profit breakdown on `ReportsPage.vue`, so an owner reconciling cash movements against the profit report isn't left wondering why pay-in/pay-out/drop entries don't appear in it. TDD: `ReportsPage.test.ts` covers the tooltip toggle and the link's `to` target. Merged to main (commit `678ad30`). |
| WAFI-019 (PWA Offline Banner Reconciliation) | ✅ Already done, no code change | An audit expecting to build a "4 unified states, tap for detail" banner instead found `SyncIndicator.vue` already implements it and exceeds the spec: it wraps `ConnectionPill` (online/syncing/offline) in a tappable button that opens a full detail panel — last sync time, pending-op count, error messages, and quarantined/blocked ops with retry-discard actions gated by role. Tests already existed (`SyncIndicator.test.ts`, `ConnectionPill.test.ts`). This status-table row was stale; no code was written. |
| WAFI-021 (Documentation & Runbook) | ✅ Shipped 2026-07-27 (partial — 3 of the 7 docs) | `docs/OPERATIONS.md`, `docs/DEPLOYMENT.md`, `docs/BACKUP.md` already existed from WAFI-022/023. Added the 3 that didn't: `docs/architecture/ARCHITECTURE.md`, `DATA_MODEL.md`, `API_CONTRACTS.md` — grounded in the actual codebase (the 31-table PowerSync-synced schema, the 5 Postgres RPCs the client calls, the ADR-009/010 auth/tenancy trade-offs, the composable-vs-service-layer gap that WAFI-152 will close) rather than generic filler, and cross-referencing the existing PRINCIPLES/PATTERNS/ENFORCEMENT/WAFI-122-rpc-audit docs instead of duplicating them. Merged to main (commit `678ad30`). No DATA_MODEL/ARCHITECTURE.md content on the remaining "etc." docs implied by "7 docs" (e.g. a formal runbook index) — not attempted, scope was the 3 named docs only. |
| WAFI-006 (Navigation System Cleanup) | ✅ Already done, no code change | An audit cross-checked every `AppBottomNav.vue`/`AppSidebar.vue` `href` against `router/index.ts`: all resolve to real routes, permission/feature-flag gating in both nav components matches the router's `beforeEach` guard exactly, no dangling links, no page-internal navbars (respects the "no internal navbars in pages" design rule). This status-table row was stale; no code was written. |
| WAFI-011 (Discounts + Returns Net Price Refund) | ✅ Shipped 2026-07-27 | `useReturnSheet.ts` never read `sales.sale_discount_amount_usd` — a whole-cart (footer-level) discount was silently ignored on return, over-refunding the customer (per-line discounts were already correct, since they're baked into `sale_line_items.unit_price_usd`). Fixed by prorating the sale-level discount across each line's share of the *original* cart total (computed before dropping already-fully-returned lines, so the math matches what was charged at checkout), then scaling by `qtyToReturn` for partial-quantity returns. Covers full-line, proportional multi-line, and partial-quantity scenarios; the persisted `returns.refund_amount_usd` and a new UI breakdown line in `ReturnSheet.vue` (shown only when a sale discount applies) both reflect the same prorated amount. Per-line `unit_price_usd` in `return_line_items` is left untouched (financial history is immutable) — only the header's refund total changes. COGS reversal is unaffected (keyed on `unit_cost_usd`, price-independent). 6 new tests (regression + 4 proration scenarios + persistence check), full suite 1107/1108 (1 pre-existing flaky router-test timeout, confirmed unrelated). Merged to main. |
| WAFI-018 (Staff Performance Dashboard) | ✅ Shipped 2026-07-28 | Genuinely unbuilt before this pass — confirmed via code audit 2026-07-27. Design spec: `docs/superpowers/specs/2026-07-28-wafi-018-staff-performance-design.md`. New `useStaffPerformanceMetrics.ts` groups sales by `sales.staff_id` (the operator who confirmed the sale) and attributes returns via `cashier_shifts.staff_id` (returns carry no direct `staff_id`), matching the existing Z-report attribution convention — a return is counted against whoever's shift it fell under, not necessarily the original salesperson, called out explicitly in the UI. The metric is internally "Contribution Margin" (`marginUsd` = revenue − COGS, no shop-level expense allocation), but the owner-facing column reads plain language ("Sales after product cost") rather than accounting jargon, per CLAUDE.md's plain-language discipline. New `can_view_staff_performance` permission is **structurally owner-only** — unlike `can_view_reports`/`can_view_expenses`, `permissionsForRole` never reads it from a manager's or cashier's custom overrides, so no owner grant (or stale/tampered stored permission) can ever widen it; per-employee performance data is treated as more sensitive than the rest of the Reports surface. New screen at `/reports/staff`, all columns sortable, sort persists across period changes, `avgTicketUsd` renders as an em dash (not `$0.00`/`NaN`) when a staff member has zero sales. Linked from `ReportsPage.vue`, gated the same way as the route so it never appears for a non-owner. Full suite passing, `vue-tsc --noEmit` clean. Merged to main. |
| WAFI-017 (Unified "Money Owed" View) | ✅ Shipped 2026-07-28 | Genuinely unbuilt before this pass — confirmed via code audit 2026-07-27. Design spec: `docs/superpowers/specs/2026-07-28-wafi-017-money-owed-design.md`. New screen at `/customers/money-owed` combines credit + installment amounts per customer into one row, aging-bucketed 0-30/31-60/60+ by whichever component obligation is more overdue (credit has no due date, so its age is always "days since sale"; installments use their real `due_date`). Only pending installment dues at or past their due date count as currently owed — a not-yet-due due is scheduled, not collectible yet, so a customer with only future dues doesn't appear at all. Extracted `fetchCreditDebtors()` (`creditDebtors.ts`) and `fetchPendingInstallmentDues()` (`installmentDues.ts`) as plain, non-reactive data-access helpers out of `useCollectionsWorklist.ts` and `useInstallmentsDueAlert.ts` respectively, so the credit/installment query logic has exactly one implementation each — both existing composables now call their extracted helper (behavior-preserving, their existing tests pass unchanged) and the new `useMoneyOwed.ts` calls the same helpers rather than depending on either UI-oriented composable directly. **Coexists with, does not replace,** `CollectionsWorklistPage.vue` — daily collections workflow (reminders, WhatsApp) vs. periodic risk-triage summary (aging buckets, no workflow state) are different use cases; linked from the Collections screen, same `can_view_reports` permission gate (not owner-only, unlike WAFI-018 — routine financial information a reports-granted manager already sees today). USD only, with an on-screen caveat (neither underlying data source tracks SYP separately). All columns sortable with a fixed tie-break chain (age → total owed → name) applied regardless of the active sort column. Full suite passing, `vue-tsc --noEmit` clean. Merged to main. |
| WAFI-005, WAFI-008 through WAFI-010, WAFI-012 through WAFI-015, WAFI-020 (remaining Macro-Phase 1) | ⬜ Not started | Confirmed via a code audit 2026-07-27 (not just a doc re-read) — no matching implementation found for any of these. |
| Macro-Phase 2 (WAFI-152, WAFI-140, WAFI-150/143/144/145/146/142) | ⬜ Not started | |
| Macro-Phase 3 (WAFI-151/153/154/155/156/157/147/148/149/026/032/033) | ⬜ Not started | |

**Resolved 2026-07-22 — local Supabase stack now starts and the pgTAP suites actually execute.**
Fixing this required four separate, previously-undiscovered bugs, found only
because the suites finally ran against a real Postgres instead of being
manually traced:
1. `037_devices.sql` created a `UNIQUE INDEX` on a `code` column that didn't
   exist (`public.devices` was created with `device_code` by
   `001_initial_schema.sql`) — this alone blocked `supabase start`/`db reset`
   for any local stack. Fixed by renaming the column to `code` (matching what
   `useDeviceRegistration.ts` already reads/writes) and adding the
   `is_temporary`/`sync_status` columns 037 was trying to introduce.
   `seed.sql` had the same stale `device_code` reference — fixed too.
2. Two migrations were both numbered `038` (`038_customers_last_reminded.sql`
   and `038_stock_take_scope_ids.sql`), which crashes `db reset` on a
   duplicate `schema_migrations` primary key. Renamed the later one to
   `065_customers_last_reminded.sql`.
3. Both pgTAP fixture files inserted into `auth.users` then explicitly
   inserted a `shops` row with a hardcoded id — but migration `021`'s
   `provision_shop_for_new_user()` trigger already auto-creates a shop for
   that user first, so the explicit insert collided on `owner_user_id`.
   Fixed by deleting the trigger-created row before the fixture's own insert
   in both test files.
4. **Core tables had RLS policies but no base `GRANT` to `authenticated`/`anon`
   in any migration** — `sales`, `products`, `shops`, `sale_line_items`,
   `devices`, `categories`, `subcategories`, `exchange_rates`,
   `installment_plans`, `installment_dues`, `stock_take_sessions`,
   `stock_take_lines`, `staff_ledger`, `staff_settlements`,
   `device_sessions`, `cash_movements` were all missing it. Production has
   been masking this because a hosted Supabase project's dashboard applies
   its own default-privilege grants at project-creation time, which
   migration files never capture — a fresh local `supabase start` has no
   such defaults. Fixed with new migration `066_fill_missing_table_grants.sql`
   (deliberately excludes `audit_log`, whose missing UPDATE/DELETE grant is
   an intentional append-only guard from `018_audit_log_append_only.sql`).
5. Also found and fixed a pgTAP authoring gotcha in
   `wafi202_sales_immutability.test.sql`: `throws_ok(sql, '42501', description)`
   — pgtap's 3-arg wrapper treats the third argument as an **expected error
   message** whenever the code string is exactly 5 characters, so the test
   description was silently being compared against the real RLS error text
   and failing. Fixed by using the 4-arg form (`'42501', NULL, description`)
   so only the SQLSTATE is checked.

Verified via `npx supabase db reset` + `npx supabase test db`, both run twice
from a clean reset for reproducibility: **29/29 pgTAP assertions pass.**
Migration 066 is a new, additional migration that also needs a production
deploy step (same status as migration 064).

---

## EXECUTIVE SUMMARY

This document unifies three streams of work into a single, coherent architecture roadmap:

| Stream | Source | Focus |
|---|---|---|
| **Production Foundation** | V2.0 Plan (Phases 1–5) | Security, auth, data integrity, hardening |
| **Event-Driven Platform** | Your 11-ticket plan | Event bus, automation, insights, intelligence |
| **Enterprise Architecture** | Staff Engineer Review | Business services, CQRS, read models, workers |

**Total: 25 tickets across 3 macro-phases | 6 months estimated**

---

## MACRO-PHASE 1: FOUNDATION (Weeks 1–8)
### Without this, nothing else stands.

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-001 | Server-Side Role Enforcement (RLS) | P0 | 2 sprints | Auth, RLS, device identity — blocks everything. **Status: IN PROGRESS, not complete.** Delivered under ticket WAFI-122 (migrations 055–062, ADR-010). **WAFI-202 CONFIRMED via live exploit test against production (2026-07-21)**, not merely inferred from policy review: a manager-role session successfully changed `total_usd` on a completed sale it didn't create and forged `staff_id` attribution to the owner via direct PATCH to the REST API (`sales_update_all`/`sales_delete_all`, inherited unmodified from migration 015, check only `shop_id` — no status/immutability/attribution guard). Precise scope (narrower than a first static read suggested, because Postgres requires a row to pass the table's SELECT policy before an UPDATE/DELETE policy is even consulted): owner/manager can tamper with or delete *any* sale/return in the shop; a cashier is limited to sales they can already see (their own), but for those, the same lack of immutability/attribution guard applies. No cross-tenant exposure — tenant isolation held throughout testing. Also open: (2) **RESOLVED** — automated pgTAP suite added for Sections A-C (role access, edge cases, lifecycle) at `supabase/tests/wafi122_role_enforcement.test.sql`; the manual script's Section D (live REST pentest) remains manual by nature and is covered by item (3). Still open: (3) live exploit test above stands in for a full pentest but a formal one is still not performed; (4) no final security sign-off document. Offline-sync confidentiality gap (WAFI-201, ADR-010) is a deliberate, accepted scope exclusion, not a blocker. WAFI-202's fix design (2026-07-22, `docs/superpowers/specs/2026-07-22-wafi-202-sales-immutability-design.md`) surfaced a new blocking dependency: `useOperatorSwitch.ts`'s offline fallback lets the locally-active operator diverge from the JWT `staff_id` claim, and no client-side gate currently requires an operator to be active before checkout — both must be fixed (tracked as **WAFI-203**, "Operator Identity Must Be Server-Authoritative", needs its own brainstorm) before the strict `staff_id = auth_staff_id()` policy can go live in production, even though the migration + pgTAP suite themselves can be built and merged independently. WAFI-202's migration (064_wafi202_sales_immutability.sql) and 16-case pgTAP suite are merged to main. **As of 2026-07-22: the `037_devices.sql`/duplicate-migration-038 blockers are fixed (see IMPLEMENTATION STATUS above), and `npx supabase test db` now runs both the WAFI-202 (16 assertions) and WAFI-122 Sections A-C (13 assertions) suites for real, all 29 passing** — this is genuine execution proof, not tracing. Migrations `064` and `066_fill_missing_table_grants.sql` (which it depended on to even be testable) are **applied to production** (2026-07-22), as is migration `067_device_session_revocation.sql` from WAFI-003 (2026-07-23). **2026-07-22 full-codebase security review** (`docs/security-review-2026-07-22.md`) found 2 more RLS gaps beyond WAFI-202/122's scope — see IMPLEMENTATION STATUS above and that doc for detail — fixed by migration `068_wafi001_cash_shift_hardening.sql`, verified 39/39 pgTAP assertions passing (2026-07-26, against a disposable Supabase project since no local Docker was available) and applied to production (2026-07-26, confirmed via `pg_policies`). The internal, founder-executed security sign-off document now exists at `docs/security-signoff-wafi001.md` (no external pentest firm — a deliberate budget-driven choice per `CLAUDE.md`, not a shortcut). Only the CEO/CTO's actual signatures on that document remain before WAFI-001 is fully done. |
| WAFI-203 | Operator Identity Must Be Server-Authoritative | P0 | 0.5 sprint | Blocking prerequisite for WAFI-202's production rollout. `useOperatorSwitch.ts` currently treats operator identity as client-authoritative (switch locally, sync JWT best-effort) — network/RPC failures leave the JWT's `staff_id` claim stale relative to the locally-active operator, which would cause synced sales to be rejected once WAFI-202's strict attribution policy is live. Also: no client-side gate currently requires an active operator before checkout (all sampled production sales have `staff_id = NULL` today). Architectural options on the table: block operator changes while offline vs. make the operator switch itself a signed, locally-queued, PowerSync-synchronized object. Needs its own design session before implementation. **Status: SHIPPED** — see docs/superpowers/plans/2026-07-22-wafi-203-operator-identity.md. `openShift` and `switchTo` now both require server-confirmed identity via a shared `establishOperatorIdentity` helper before adopting a new operator locally; same-identity re-entry stays fully offline via a persisted `lastConfirmedOperatorId`; `usePayment.confirm()` refuses a sale with no active operator. Migration 064 (WAFI-202) is unblocked for production. |
| WAFI-002 | Real Authentication System | P0 | 1.5 sprints (scoped down to a gap-closing pass — see IMPLEMENTATION STATUS above) | Signup, login, JWT, session, PIN, tenant isolation. **Status: shipped as a gap-closing pass, 2026-07-22** — the "1.5 sprint" estimate assumed a from-scratch build that turned out to already exist. |
| WAFI-003 | Self-Serve Device Registration | P0 | 1 sprint (scoped down to a gap-closing pass — see IMPLEMENTATION STATUS above) | Multi-device, device codes, remote sign-out. **Status: shipped as a gap-closing pass, 2026-07-23** — multi-device/codes/self-serve list already existed; remote sign-out (the real gap) now actually revokes the device's Supabase Auth session, not just a soft flag. Manual live-session verification still pending (see IMPLEMENTATION STATUS). |
| WAFI-004 | Owner Bootstrap & Onboarding | P1 | 0.5 sprint | Guided setup, <5 minutes, demo data option. **Status: shipped, 2026-07-23** — see IMPLEMENTATION STATUS above. |
| WAFI-005 | Design System Freeze | P1 | 1 sprint | Single canonical system, zero competing redesigns |
| WAFI-006 | Navigation System Cleanup | P1 | 0.5 sprint | Bottom tabs + sidebar, zero nav errors. **Status: already satisfied, verified 2026-07-27** — see IMPLEMENTATION STATUS above. No code change. |
| WAFI-007 | Complete Audit Event Wiring | P1 | 1 sprint | 32+ event types, financial write wrapper, append-only. **Status: shipped, 2026-07-23** — see IMPLEMENTATION STATUS above. |
| WAFI-008 | Data Source Tagging | P1 | 0.5 sprint | live vs. imported sales, profit report filtering |
| WAFI-009 | Stock-Take + Active Sales Collision | P2 | 0.5 sprint | Variance adjustment, timeline visualization |
| WAFI-010 | Installment Plans + Returns Integration | P2 | 0.5 sprint | Cancel plan before return, audit both events |
| WAFI-011 | Discounts + Returns Net Price Refund | P2 | 0.5 sprint | Refund post-discount price, prorated breakdown. **Status: shipped, 2026-07-27** — see IMPLEMENTATION STATUS above. |
| WAFI-012 | WhatsApp Messaging Analytics Fix | P2 | 0.25 sprint | Rename to `whatsapp_composed`, document semantics |
| WAFI-013 | Cost Freshness Indicator | P2 | 0.5 sprint | % catalog with fresh cost, filter by missing/stale |
| WAFI-014 | Cross-Epic Edge-Case Review Process | P2 | Ongoing | Mandatory checklist, ripple effect matrix |
| WAFI-015 | Anomaly Detection Automation | P2 | 1 sprint | 5 anomaly types, Home banner, <100ms overhead. Distinct from the Reports-screen anomaly banners (`useReportAnomalies.ts`) shipped under the profit-report v1.0 plan — those live in `/reports`, not the Home dashboard, and don't satisfy this ticket. |
| WAFI-016 | Cash Movement + Profit Report Exclusion | P2 | 0.25 sprint | Footnote, tooltip, navigation link. **Status: shipped, 2026-07-27** — see IMPLEMENTATION STATUS above. |
| WAFI-017 | Unified "Money Owed" View | P2 | 0.5 sprint | Credit + installments combined, aging buckets. **Status: shipped, 2026-07-28** — see IMPLEMENTATION STATUS above. |
| WAFI-018 | Staff Performance Dashboard | P2 | 0.5 sprint | Net contribution, period selector, owner-only. **Status: shipped, 2026-07-28** — see IMPLEMENTATION STATUS above. |
| WAFI-019 | PWA Offline Banner Reconciliation | P2 | 0.5 sprint | 4 unified states, tap for detail, zero conflicts. **Status: already satisfied, verified 2026-07-27** — see IMPLEMENTATION STATUS above. No code change. |
| WAFI-020 | Performance & Load Testing | P2 | 0.5 sprint | Benchmarks, Lighthouse CI, cheap Android target |
| WAFI-021 | Documentation & Runbook | P2 | 0.5 sprint | 7 docs: ARCHITECTURE, DATA_MODEL, API_CONTRACTS, etc. **Status: partially shipped, 2026-07-27** — see IMPLEMENTATION STATUS above (3 of 7 docs added; OPERATIONS/DEPLOYMENT/BACKUP pre-existed from WAFI-022/023). |
| WAFI-022 | Deployment Readiness & Operational Runbook (renamed from "Production Deployment Checklist") | P2 | 0.25 sprint | Staging, monitoring, backup, rollback tested. **Status: shipped, 2026-07-23** — see IMPLEMENTATION STATUS above. Real finding: production DB currently has zero backup capability (Free tier). |
| WAFI-023 | Post-Launch Monitoring & Feedback | P2 | Ongoing | Sentry, in-app reporting, weekly review, SLA. **Status: core (Sentry + in-app reporting + docs) shipped 2026-07-23** — see IMPLEMENTATION STATUS above; weekly review/SLA are ongoing founder practice, not a one-time build. |

**Foundation Total: 23 tickets | 8 weeks** — **11 of 23 fully shipped (WAFI-203, WAFI-002, WAFI-003, WAFI-004, WAFI-007, WAFI-011, WAFI-016, WAFI-017, WAFI-018, WAFI-022, WAFI-023), 2 already satisfied with no code change (WAFI-006, WAFI-019), 1 shipped pending only founder signatures (WAFI-001), 1 partially shipped (WAFI-021, 3 of 7 docs), 9 not started (WAFI-005, WAFI-008 through WAFI-010, WAFI-012 through WAFI-015, WAFI-020).**
**Critical Path: 001 → 002 → 003 → 004 → 007 → 022**

---

## MACRO-PHASE 2: ARCHITECTURE TRANSFORMATION (Weeks 9–14)
### From feature-first to event-first. From composables to business services.

### Phase 2A: Business Services Layer (Week 9)

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-152 | Business Services Layer | P0 | 1 sprint | UI → Business Service → Repository → Event. Reusable across POS, API, Import, Automation |

**Why before the event bus:** Every event must originate from a single, reusable business service — not from UI-facing composables. This makes future APIs, batch imports, barcode scanners, webhooks, and automation trivial to add.

**Services to extract:**
- `SalesService.completeSale()` — replaces `usePayment()`
- `InventoryService.receiveStock()` — replaces direct composable calls
- `CustomerService.updateDebt()` — centralizes credit logic
- `StaffService.recordShift()` — unifies shift management
- `ExpenseService.recordExpense()` — standardizes expense flow

**Acceptance Criteria:**
- [ ] Zero business logic in Vue components
- [ ] All composables are thin wrappers around services
- [ ] Services are pure TypeScript, framework-agnostic
- [ ] Services publish domain events (preparation for WAFI-140)
- [ ] Unit tests for all services (Vitest, >80% coverage)
- [ ] Services work offline (Dexie-backed queue)

---

### Phase 2B: Event Platform Core (Weeks 10–12)

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-140 | Business Event & Automation Platform | P0 | 3 sprints | Event bus, 26+ canonical events, subscribers, idempotency, offline replay, security |

**Architecture Principle:**
```
User Action
     │
     ▼
Business Service (WAFI-152)
     │
     ▼
Domain Event Published
     │
┌────┼────┬────────┬──────────┐
▼    ▼    ▼        ▼          ▼
Read  Audit  Notify   Reports   Analytics
Model Log
▼     ▼      ▼        ▼          ▼
Dash  Staff  Owner    Auto      Insights
board Stats  Alert    Reports   (POS Brain)
```

**Golden Rules (from Staff Engineer review):**
1. **Events NEVER mutate business data** — Subscribers only update caches, analytics, notifications, reports, indexes, read models. Inventory, customer balance, ledger entries happen in the transaction itself.
2. **Domain Events vs. Integration Events** — `sale.completed` = Domain Event. `owner_notification.requested` = Integration Event. Separate streams, separate storage, separate retention.
3. **Event Naming Convention** — Past tense, lowercase, dot notation: `sale.completed`, `inventory.received`, `shift.closed`. No abbreviations, no UI terminology, no "clicked" or "saved".
4. **Event Versioning Policy** — Never modify payload. Create v2. Support both. Deprecate after migration. Documented in WAFI-142.
5. **Telemetry Events are separate** — Printer errors, Bluetooth status, sync retries belong to Telemetry Events, not Business Events.

**Canonical Events (26+):**

| Domain | Events |
|---|---|
| Sale | `sale.completed`, `sale.voided`, `sale.returned`, `sale.discounted` |
| Inventory | `inventory.adjusted`, `stock.received`, `stock.taken` |
| Customer | `customer.debt_changed`, `installment.due_paid`, `credit.limit_changed` |
| Cash | `cash.movement_recorded`, `shift.opened`, `shift.closed`, `drawer.varianced` |
| Staff | `settlement.paid`, `staff.ledger_entry_added`, `staff.performance_updated` |
| Product | `product.price_changed`, `product.cost_updated`, `product.created` |
| Supplier | `supplier.order_placed`, `supplier.receiving_posted` |
| System | `user.authenticated`, `device.registered`, `sync.completed` |

**Security Layer (critical):**
- `staff_id` in event payload validated against authenticated JWT
- Cashier cannot publish `sale.completed` for another cashier's sale
- Cashier cannot subscribe to `staff.ledger_entry_added` (owner-only)
- Cross-tenant isolation enforced by PowerSync sync rules + RLS
- Rate limiting: max 100 events/minute per `staff_id`
- Event bus RLS policies on `events` and `event_subscriptions` tables

**Phased Delivery:**
- **Sprint 1:** Core bus + 10 critical events + basic subscribers
- **Sprint 2:** Remaining 16 events + idempotency + offline replay
- **Sprint 3:** Security hardening + event contract tests + performance validation

---

### Phase 2C: Automation & Intelligence (Weeks 13–14)

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-150 | Automatic Audit Coverage | P1 | 1 sprint | Every business event → automatic audit entry, 100% coverage |
| WAFI-143 | Cross-Feature Automation | P1 | 2 sprints | Sale finishes → Dashboard → Staff → Profit → Notifications → Audit → Daily Summary (all automatic) |
| WAFI-144 | Automatic Insights | P1 | 2 sprints | "Sales are 18% lower than last Tuesday" — conclusions, not numbers |
| WAFI-145 | Owner Notification Center | P1 | 1.5 sprints | Important only: "Ahmed applied 30% discount", "Drawer variance $15". Deduplication + matrix configuration |
| WAFI-146 | Dashboard 2.0 | P1 | 2 sprints | "Why is revenue lower?" → 18 fewer transactions, Returns +7, Ahmed offline 45min |
| WAFI-142 | Business Event Registry | P1 | 0.5 sprint | Living documentation: Event | Producer | Consumers | Version | Schema. Includes auto-generated dependency graph (Phase 2) |

**Key Dependencies:**
- WAFI-150 depends on WAFI-140 (event bus must exist)
- WAFI-143 depends on WAFI-140 + WAFI-150
- WAFI-144/145/146 can parallel after WAFI-143

---

## MACRO-PHASE 3: ENTERPRISE SCALE (Weeks 15–24)
### From working system to platform. Read models, workers, rules engine, recovery.

| Ticket | Title | Priority | Effort | What It Builds |
|---|---|---|---|---|
| WAFI-151 | Projection Rebuild & Event Recovery | P1 | 1 sprint | `Rebuild Dashboard` → Replay Events → Recreate Read Models. Corruption recovery command |
| WAFI-153 | Read Models / CQRS Optimization | P1 | 1.5 sprints | `dashboard_metrics`, `profit_cache`, `inventory_summary`, `customer_summary`, `staff_summary`. Maintained by subscribers, not queried ad-hoc |
| WAFI-154 | Background Job & Worker Framework | P2 | 1.5 sprints | Immediate → Queue → Worker. PDF generation, daily summaries, batch reports don't block checkout |
| WAFI-155 | Feature Flag Framework | P2 | 0.5 sprint | `feature.dashboard_v2`, `feature.pos_brain`, `feature.insights`. Gradual rollout, not hard replace |
| WAFI-156 | Business Rules Engine | P2 | 2 sprints | `WHEN discount > 30% THEN owner_notification`. `WHEN customer_debt > 500 THEN block_credit`. Configurable, not hardcoded |
| WAFI-157 | Event Contract Testing | P2 | 0.5 sprint | Changing `sale.completed` payload → auto-verify all subscribers still deserialize correctly |
| WAFI-147 | Automatic Reports | P2 | 1.5 sprints | 13 reports on schedule: Daily Closing, Weekly Summary, Monthly Health, etc. |
| WAFI-148 | Internal Health Monitoring | P2 | 1 sprint | 10 metrics: sync failures, offline duration, printer errors, drawer mismatches. Owner-facing + team-facing |
| WAFI-149 | POS Brain | P2 | 2 sprints | "Revenue up 14% because drinks grew 32%" — causal explanations, not just correlational. Good product design, not AI |
| WAFI-026 | Sale Lifecycle State Machine | P1 | 1.5 sprints | `draft → items_added → discounted → payment_started → completed → printed → returned → voided → archived`. Explicit transitions, event per transition |
| WAFI-032 | KPI Ownership Per Feature | P1 | 0.5 sprint | Every feature → Primary KPI → Target → Measurement. Monthly review process |
| WAFI-033 | Product Constitution | P1 | 0.5 sprint | 12 Laws of WAFI. Immutable financial history, append-only ledgers, offline-first, no duplicated calculations |

**Enterprise Scale Total: 12 tickets | ~10 weeks**
**Critical Path: 151 → 153 → 154 → 156**

---

## UNIFIED IMPLEMENTATION TIMELINE

```
WEEK 1–2:   MACRO-PHASE 1 — Security Foundation
            WAFI-001 (RLS) — LEAD TRACK
            WAFI-002 (Real Auth) — PARALLEL TRACK
            WAFI-005 (Design System Freeze) — PARALLEL TRACK

WEEK 3–4:   MACRO-PHASE 1 — Auth, Devices, Audit
            WAFI-003 (Device Registration)
            WAFI-004 (Owner Bootstrap)
            WAFI-006 (Navigation Cleanup)
            WAFI-007 (Audit Event Wiring)

WEEK 5:     MACRO-PHASE 1 — Data Integrity
            WAFI-008 (Data Source Tagging)
            WAFI-009 (Stock-Take Collision)
            WAFI-010 (Installment + Returns)
            WAFI-011 (Discounts + Returns)

WEEK 6:     MACRO-PHASE 1 — Hardening Batch 1
            WAFI-012 (WhatsApp Analytics)
            WAFI-013 (Cost Freshness)
            WAFI-014 (Cross-Epic Review)
            WAFI-015 (Anomaly Detection)

WEEK 7:     MACRO-PHASE 1 — Hardening Batch 2
            WAFI-016 (Cash Movement Callout)
            WAFI-017 (Unified Money Owed)
            WAFI-018 (Staff Performance)
            WAFI-019 (Offline Banner)

WEEK 8:     MACRO-PHASE 1 — Hardening Batch 3 + Closure
            WAFI-020 (Performance Testing)
            WAFI-021 (Documentation)
            WAFI-022 (Deployment Checklist)
            WAFI-023 (Monitoring Setup)

WEEK 9:     MACRO-PHASE 2A — Business Services Layer
            WAFI-152 (Business Services) — LEAD TRACK
            WAFI-033 (Product Constitution) — PARALLEL

WEEK 10–12: MACRO-PHASE 2B — Event Platform Core
            WAFI-140 (Event Bus) — LEAD TRACK
            WAFI-026 (Sale Lifecycle State Machine) — PARALLEL
            WAFI-032 (KPI Ownership) — PARALLEL

WEEK 13–14: MACRO-PHASE 2C — Automation & Intelligence
            WAFI-150 (Automatic Audit) — LEAD TRACK
            WAFI-143 (Cross-Feature Automation) — PARALLEL
            WAFI-144 (Automatic Insights) — PARALLEL
            WAFI-145 (Owner Notification Center) — PARALLEL
            WAFI-146 (Dashboard 2.0) — PARALLEL
            WAFI-142 (Event Registry) — PARALLEL

WEEK 15:    MACRO-PHASE 3 — Recovery & Read Models
            WAFI-151 (Projection Rebuild) — LEAD TRACK
            WAFI-153 (Read Models / CQRS) — PARALLEL

WEEK 16–17: MACRO-PHASE 3 — Workers & Flags
            WAFI-154 (Background Workers) — LEAD TRACK
            WAFI-155 (Feature Flags) — PARALLEL
            WAFI-157 (Event Contract Tests) — PARALLEL

WEEK 18–19: MACRO-PHASE 3 — Rules Engine
            WAFI-156 (Business Rules Engine) — LEAD TRACK

WEEK 20–21: MACRO-PHASE 3 — Intelligence & Reports
            WAFI-147 (Automatic Reports) — LEAD TRACK
            WAFI-149 (POS Brain) — PARALLEL

WEEK 22–23: MACRO-PHASE 3 — Health & Monitoring
            WAFI-148 (Internal Health Monitoring) — LEAD TRACK
            Buffer for integration, bug fixes, polish

WEEK 24:    FINAL BUFFER — Integration, Performance, Sign-off
            End-to-end testing
            Security audit
            Performance validation
            Team sign-off on constitution
```

**Total Estimated Duration: 24 weeks (6 months)**
**Critical Path: 001 → 002 → 003 → 004 → 152 → 140 → 150 → 143 → 151 → 153 → 154 → 156**

---

## ARCHITECTURE DECISION RECORD (ADR)

### ADR-001: Business Services Before Event Bus
**Status:** Approved
**Context:** The Staff Engineer review identified that without a business services layer, events would originate from UI composables, making future APIs, imports, and automation difficult.
**Decision:** WAFI-152 (Business Services) executes BEFORE WAFI-140 (Event Bus).
**Consequences:** +1 week to timeline, but enables API, batch import, barcode scanner, webhook, and future automation to reuse the same business logic without duplicating code.

### ADR-002: Events Do Not Mutate Business Data
**Status:** Approved
**Context:** Replaying events to reconstruct state becomes dangerous if subscribers mutate business data (e.g., inventory, customer balance).
**Decision:** Subscribers may ONLY update caches, analytics, notifications, reports, indexes, and read models. All business mutations happen in the transaction BEFORE the event is published.
**Consequences:** Event replay is safe. Read models can be rebuilt at any time. Slightly more complex transaction logic, but dramatically simpler recovery.

### ADR-003: Domain Events vs. Integration Events
**Status:** Approved
**Context:** Mixing business events (`sale.completed`) with system events (`owner_notification.requested`) creates confusion and different retention needs.
**Decision:** Two separate event streams with separate storage and retention policies.
**Consequences:** Domain events retained for 7 years (audit/compliance). Integration events retained for 30 days (transient). Clearer semantics for subscribers.

### ADR-004: CQRS-Lite with Read Models
**Status:** Approved
**Context:** Dashboard querying 6+ tables every refresh is unsustainable at scale.
**Decision:** Explicit read models (`dashboard_metrics`, `profit_cache`, `inventory_summary`) maintained by event subscribers.
**Consequences:** Dashboard loads <200ms regardless of data volume. Read models can be rebuilt via WAFI-151. Slightly higher storage cost, but negligible compared to performance gain.

### ADR-005: Background Workers for Non-Critical Subscribers
**Status:** Approved
**Context:** PDF generation, daily summaries, and batch reports should not block checkout.
**Decision:** Immediate subscribers (inventory, audit) execute synchronously. Deferred subscribers (reports, PDFs, analytics) queue for background workers.
**Consequences:** Checkout remains fast (<1s). Background workers process queue offline. Requires WAFI-154 (Worker Framework).

---

## RISK REGISTER (Updated)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Server-side role enforcement breaks existing sync | High | Critical | Extensive staging testing; gradual rollout; WAFI-001 has 2 sprints |
| Business services extraction breaks existing flows | Medium | High | Comprehensive unit tests; feature flags (WAFI-155); parallel implementation |
| Event bus adds complexity beyond team capacity | Medium | High | Phased delivery (3 sprints); start with 10 events; document patterns |
| Read model corruption without recovery path | Medium | Critical | WAFI-151 (Projection Rebuild) is P1, not P2 |
| Background worker queue grows unbounded offline | Medium | Medium | Queue size limits; priority eviction; sync-on-reconnect flush |
| Feature flag framework delays if built from scratch | Low | Medium | Use existing library (e.g., LaunchDarkly SDK, Unleash, or simple config-based) |
| Business rules engine over-engineering | Medium | Medium | Start with simple IF-THEN registry; expand to DSL later |
| Performance on cheap Android unacceptable | Medium | High | WAFI-020 tests early; performance budget; read models reduce load |
| Team velocity drops during architecture work | Medium | Medium | Parallel tracks; clear priorities; WAFI-033 constitution aligns team |
| Cross-tenant event isolation failure | Low | Critical | Security tests in WAFI-140; penetration testing; RLS validation |
| Local Supabase stack couldn't start (`037_devices.sql` referenced a nonexistent `code` column; table had `device_code`) | **Resolved 2026-07-22** | High | Fixed: renamed `devices.device_code` → `code`, added `is_temporary`/`sync_status`. Also fixed a duplicate migration `038` and missing table `GRANT`s (see IMPLEMENTATION STATUS above) uncovered once the stack could finally start. Both pgTAP suites now execute and pass for real. |

---

## GLOBAL DEFINITION OF DONE (V3.0)

For ANY ticket to be considered complete:

- [ ] All acceptance criteria met
- [ ] Unit tests pass (Vitest coverage >80% for new code)
- [ ] Integration tests pass
- [ ] Manual QA on target device (cheap Android phone)
- [ ] RTL verified
- [ ] Dark mode verified
- [ ] Offline behavior verified
- [ ] Sync behavior verified
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Bundle size impact documented
- [ ] Security review (for financial/auth features)
- [ ] Documentation updated
- [ ] PR reviewed by 2+ team members
- [ ] CHANGELOG.md updated
- [ ] **Event bus integration verified** (if applicable, per WAFI-140)
- [ ] **Signal documented in SIGNALS.md** (if applicable, per WAFI-142)
- [ ] **Constitution compliance verified** (per WAFI-033)
- [ ] **Business service layer used** (if applicable, per WAFI-152)
- [ ] **Read model updated** (if applicable, per WAFI-153)
- [ ] **Event contract tests pass** (if applicable, per WAFI-157)

---

## WHAT CHANGED FROM V2.0 TO V3.0

### New Tickets (from Staff Engineer review)

| Ticket | Title | Source |
|---|---|---|
| WAFI-152 | Business Services Layer | Staff Engineer #1 — "biggest improvement" |
| WAFI-151 | Projection Rebuild & Event Recovery | Staff Engineer #11 — "huge, you'll love having it" |
| WAFI-153 | Read Models / CQRS Optimization | Staff Engineer #6 — "almost nobody thinks about this" |
| WAFI-154 | Background Job & Worker Framework | Staff Engineer #9 — "generating PDF shouldn't block checkout" |
| WAFI-155 | Feature Flag Framework | Staff Engineer #8 — "gradual rollout, not hard replace" |
| WAFI-156 | Business Rules Engine | Staff Engineer #12 — "configurable, not hardcoded" |
| WAFI-157 | Event Contract Testing | Staff Engineer #7 — "someone renames field, five subscribers silently fail" |

### Restored from V2.0 (were missing in 11-ticket plan)

| Ticket | Title | Source |
|---|---|---|
| WAFI-026 | Sale Lifecycle State Machine | V2.0 TICKET-026 — "foundational for event quality" |
| WAFI-032 | KPI Ownership Per Feature | V2.0 TICKET-032 — "every feature has a KPI" |
| WAFI-033 | Product Constitution | V2.0 TICKET-033 — "12 Laws of WAFI" |

### Sequencing Changes

| Change | Rationale |
|---|---|
| WAFI-152 BEFORE WAFI-140 | Business services must exist before events originate from them |
| WAFI-151 as P1 (not P2) | Read model corruption without recovery is a critical risk |
| WAFI-026 parallel with WAFI-140 | Sale states are needed for meaningful domain events |
| WAFI-033 early (Week 9) | Constitution guides all subsequent architecture decisions |

---

## FINAL RECOMMENDATION

**Execute Macro-Phase 1 first (8 weeks).** These are production blockers. Without auth, RLS, and data integrity, there is no business.

**Then execute Macro-Phase 2 (6 weeks).** These transform WAFI from a feature collection into an event-driven platform. The business services layer (WAFI-152) is the most important architectural investment — it enables everything that follows.

**Then execute Macro-Phase 3 (10 weeks).** These are scale enablers. Read models, workers, and rules engines separate a working system from a platform.

**The sequence matters.** You cannot build an event bus on composables. You cannot rebuild read models without event replay. You cannot add automation without business services.

**At the end of 6 months, WAFI's architecture will be at the level expected from a modern, enterprise-grade offline-first retail platform.**
