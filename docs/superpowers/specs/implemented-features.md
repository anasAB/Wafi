# Implemented Features (main branch)

> Living log of what's actually shipped on `main`. Each time a feature lands, add an entry here (or update an existing one) with a short description and the relevant path(s)/ticket ref. This replaces `ALLLL.md` (which was a raw concatenation of design specs, not a build log).
>
> Last full scan: 2026-07-21, tip commit `0291ef3`.

---

## POS / Sales

- **POS Sale Screen** — main cart/checkout screen: product grid, cart panel, quantity/price editing. `src/features/pos/POSSaleScreen.vue`, `useSale.ts`, `SalePanel.vue`, `ProductGrid.vue`.
- **Line/sale discounts & markups** (WAFI-100) — percent/fixed discounts on sale lines with cost-floor check (`isBelowCost`) and a PIN-authorization rule above a configurable cap. Just wired into `SalePanel`'s free-form price editor; newly landed, not yet battle-tested. `discounts.ts`, `useDiscountApproval.ts`, `useDiscountAuthorization.ts`, `useDiscountCaps.ts`, migration `052_sale_discounts.sql`.
- **Open item / unknown-barcode quick add** (WAFI-101) — sell an unrecognized barcode as an ad-hoc line, or quick-create a product mid-sale. `OpenItemSheet.vue`, `QuickAddProductSheet.vue`.
- **Fast-cash payment** (WAFI-124) — one-tap exact-cash buttons (SYP/USD) from the cart, configurable presets. `useFastCash.ts`, `useFastCashSettings.ts`.
- **Payment modal** — cash/credit/installment payment methods, split payments; installment plan can be created at sale time. `PaymentModal.vue`, `usePayment.ts`, `InstallmentPlanForm.vue`.
- **Sale confirmation & receipt** — confirmation screen, thermal/ESC-POS receipt printing, receipt template preview/settings, WhatsApp receipt toggle. `SaleConfirmationScreen.vue`, `usePrinter.ts`, `features/receipt/`.
- **Sale history** (WAFI-127) — searchable list of past sales, unpadded numeric receipt-number lookup. `SaleHistoryScreen.vue`, `useSaleHistory.ts`.
- **Returns** — return sheet + detail view, configurable return reasons, line-item level. `features/returns/`.

## Inventory / Products

- **Product catalog** — full CRUD with photo upload, category link. `ProductsPage.vue`, `AddProductPage.vue`, `EditProductPage.vue`, `useProducts.ts`.
- **Categories** (WAFI-133) — category management with inline bulk reassignment on delete/merge, quick-add. `features/categories/`.
- **Stock adjustments** — manual quantity correction with reason tracking. `StockAdjustmentDialog.vue`, `useStockAdjustment.ts`, `QuickStockSheet.vue`.
- **Low stock alerts & product activity** — per-product movement history. `useLowStockAlerts.ts`, `useProductActivity.ts`.
- **Stock-take** (WAFI-121, WAFI-134) — full Start → Session → Review → History flow, delta commit, idempotent confirm, scope-overlap guard, category-based scoping. `features/stock-take/`, migrations `035`, `038`.
- **Suppliers & receivings** — supplier CRUD + stock receiving workflow (line items, product picker). `features/suppliers/`.
- **Excel/CSV imports (partial)** — column-mapping composable + types + tests exist, but no page/route wired yet — not reachable from the UI. `features/imports/`.

## Customers / Credit

- **Customer management** — CRUD, picker modal. `CustomersPage.vue`, `CustomerDetailPage.vue`, `useCustomers.ts`.
- **Credit/balance tracking** (WAFI-126) — outstanding balance computed and shown at sale time. `useCustomerBalance.ts`.
- **Installments** — installment plan creation/schedule math, due-installments alert screen. `features/installments/`, migration `033`.
- **Collections worklist** (WAFI-104) — dedicated screen for chasing outstanding customer credit. `CollectionsWorklistPage.vue`.
- **Record payment / invoice detail** — customer payment capture against invoices, shift/device attribution (WAFI-120). `RecordPaymentSheet.vue`, `InvoiceDetailSheet.vue`, migrations `016`, `040`.
- **Statements & reminders via WhatsApp** — statement/reminder text + image generation, WhatsApp deep-link compose, preview sheet. `features/messaging/`.

## Staff / Shifts / Auth

- **Real auth** — Supabase email/password login/signup, assisted (non-self-serve) password reset, sign-out with unsynced-writes warning, account-switch data isolation.
- **PIN-based operator model** — PIN pad, lockout after failed attempts, recovery codes for forgotten PIN, staff CRUD with roles (owner/manager/cashier) and granular permissions.
- **Operator switching** — `switch_active_operator` RPC with server-side PIN re-verification and lockout, `device_sessions` table, JWT `active_role` claim via `custom_access_token_hook`. Security-hardened, heavily reviewed.
- **Server-side role enforcement / RLS** (WAFI-122) — closes the direct-API authorization gap: previously any authenticated shop member could read/write any row via a raw Supabase REST call (curl/Postman), since RLS only enforced tenant isolation, never role. Now a `staff_id` JWT claim (alongside `active_role`) plus SQL helpers (`auth_role()`, `auth_staff_id()`, `auth_permissions()`, `can(flag)`) back role/permission-aware RLS policies across all 8 domains (Identity, Sales, Inventory, Cash & Shifts, Accounting, Staff Finance, Audit, Configuration — ~30 tables). Cashiers see only their own sales/shifts; `staff`, `audit_log`, `staff_ledger`/`staff_settlements` are owner/manager-gated; 4 new granular permission flags (`can_manage_inventory`/`suppliers`/`stock_take`, `can_view_staff_ledger`) replace any generic catch-all. Includes a backfill migration for pre-existing staff rows and a hand-run verification script (role/negative/lifecycle/pentest cases — this repo has no automated pgTAP harness). **Explicitly out of scope:** PowerSync's own sync replication doesn't go through RLS (separate sync-service credentials), so a cashier's locally-synced SQLite still contains the full row set regardless of these policies — this is a documented, accepted limitation (`docs/adr/ADR-010-powersync-role-based-sync-gap.md`), not something this work claims to have fixed; a prior doc note here claiming "role-branched sync hides cost fields at the sync layer" was inaccurate and is corrected by this entry. Follow-up tracked as `docs/tickets/WAFI-201.md` (sync gap) and `docs/tickets/WAFI-202.md` (sales/cash_movements write-attribution gap, deliberately deferred). Design: `docs/superpowers/specs/2026-07-21-wafi-122-server-side-role-enforcement-design.md`. migrations `053`-`063`.
- **Shifts** — open/close state, shift detail/history, force-close, idle auto-lock, first-run owner shift setup. Router enforces `requiresOpenShift` on POS routes.
- **Cash drawer / denomination counting** (WAFI-103) — cash-count-based open/close reconciliation, per-currency (SYP/USD) denomination tally.
- **Cash movements** — mid-shift pay-in/pay-out/drop ledger, unified drawer/shift attribution. migration `027`.
- **Z-Report** — end-of-shift reconciliation report.
- **Fast shift-open** (WAFI-129) — pre-fills opening cash from last close.
- **Staff ledger & settlement** (WAFI-138) — ledger entries, settlement drafts, transactional finalize with carry-forward, mark-paid, guards against double-finalize/negative amounts, staff activity view. Shared `executeFinancialWrite.ts` audit+permission wrapper for all financial writes. migration `043`.
- **Devices** (WAFI-130) — device registration/management, deactivation enforcement. migrations `037`, `042`.

## Reporting / Dashboard

- **Dashboard/reports** — metrics cards, best sellers, expense breakdown chart, cumulative profit chart, period toggle (week/month/quarter/custom). Gated behind `reporting_pack` feature flag. `features/dashboard/`.
- **Dead-stock report** (WAFI-108) — capital tied up in unsold stock.
- **Report anomalies / staleness / uncosted-sales notice** — data-quality warnings (e.g. flags sales lacking cost data).
- **Expense tracking** — expense list, form, category chips. `features/expenses/`.
- **Audit log** — append-only audit trail, discard-on-dead-letter also audited (WAFI-135). `features/audit/`, migrations `002`, `005`, `018`, `031`.
- **Exports** — data export to file. `features/exports/`.

## Onboarding

- **Self-serve setup checklist** — `/onboarding` page tracking 4 steps (add first products, open POS and ring a sale, add a staff member, complete shop/receipt profile), each linking straight to the relevant screen. `features/onboarding/useOnboardingProgress.ts`.

## Settings / Config

- **Settings shell** — hub page linking out to all config sub-screens: personal preferences, receipt settings, staff list, return reasons, scanner diagnostics, devices, audit log, recovery codes, exports, denominations.
- **Exchange rate** — lets the owner set/update the SYP/USD conversion rate; each sale locks in the rate active at the time it was rung up, and first run walks the owner through setting it (WAFI-128).
- **Theme** — lets the user pick a color palette for the app's look and feel.
- **Per-shop feature flags** (WAFI-131) — server-synced pack enforcement so a shop only sees the features it's paid for (e.g. `reporting_pack`); distinct from the build-time `featureFlags.ts` (currently only defines an unbuilt, off-by-default `electronicsPro` flag). migration `041`.
- **i18n** — Arabic + English localization throughout the UI, plus helpers for formatting numbers/text in Arabic.

## Offline / Sync

- **PowerSync integration** — the offline-first data layer: local-first reads/writes that sync to Postgres in the background, with a dead-letter queue for writes that fail to sync (retry/discard, role-gated per WAFI-135). `src/data/powersync/`.
- **Sync store/UI** — small indicators showing whether the app is online/offline and whether local changes have synced yet.
- **Draft persistence** — Dexie-backed local cart draft so an in-progress sale survives a page reload before it's synced.
- **Device-scoped auth** — Supabase auth layered under PowerSync; the JWT's `active_role`/`staff_id` claims identify the operator, but PowerSync's sync stream itself is not role-branched (an earlier attempt returned zero rows in live testing and was reverted — see `docs/adr/ADR-010-powersync-role-based-sync-gap.md`). Role enforcement for direct API access is handled by RLS (WAFI-122), not by the sync layer.

## Hardware

- **Barcode scanning** (WAFI-125) — reads USB barcode scanners that act as keyboards ("keyboard-wedge"); configurable detection, a fix for stolen input focus, timeout-based finalization, and a dedicated diagnostics screen for troubleshooting scanner setup.
- **Receipt printing** — prints sale receipts to thermal ESC/POS printers (e.g. Epson TM-T20 class hardware).
- **PWA** — the app installs like a native app from a browser link (no app store) and detects online/offline connection status.

## Known Stubs / Half-Implemented

- **Excel/CSV imports** — logic exists, no UI route yet.
- **Electronics Pro pack** — flagged off, no feature folder — purely planned (v1 roadmap item).
- **Forgot password** — assisted flow only, no self-serve reset.
- **Discounts (WAFI-100)** — just stabilized; treat as newly-landed.
