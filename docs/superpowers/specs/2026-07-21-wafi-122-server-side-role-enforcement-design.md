# WAFI-122: Server-Side Role Enforcement — Design Spec

**Status:** Approved for implementation planning
**Date:** 2026-07-21
**Ticket:** TICKET-001 / WAFI-122 (Phase 1, Security Foundation — epic.md)
**Depends on:** None (foundation)
**Blocks:** WAFI-123 (Real Auth), WAFI-124 (Device Registration), WAFI-125 (Owner Bootstrap), and any ticket in epic.md Phase 5 that assumed role enforcement exists

---

## 1. Problem

All permission checks in the app today are client-side only (`src/router/permissions.ts`, `useCan.ts`). A cashier who extracts the shared Supabase JWT (the whole shop shares one Supabase Auth account per WAFI-119) can call the Supabase REST API directly — curl, Postman, a modified client — and read `staff` (PIN hashes), `audit_log`, other shifts' `sales`, `expenses`, `staff_ledger`, etc. Row Level Security exists for **tenant** isolation (`shop_id`) but has no concept of **role** at all: every authenticated shop member can CRUD every row of every table.

## 2. Scope

**In scope:** Closing the direct-access vulnerability (RLS + RPCs + JWT claims) for any request that goes through PostgREST/Supabase using the caller's own JWT — curl/Postman/modified-client attacks, exactly as named in the ticket's DoD ("Manual penetration test: extract JWT, attempt unauthorized reads via curl/Postman").

**Out of scope:** PowerSync's own bulk-sync replication path does not authenticate as the end-user's JWT and does not go through PostgREST — it uses its own sync-service connection and is governed by `powersync.yaml` sync-rule queries, not Postgres RLS. This project's PowerSync edition/version was already found (via prior ADR-009 work) to not reliably support `subscription.parameter()`-based role branching — it returned zero rows in live testing and was reverted. Making offline-synced SQLite respect role boundaries is a **separate, harder problem** (encrypted local storage, role-aware sync buckets, or a PowerSync version/config change) and is tracked as follow-up ticket **WAFI-201** with its own ADR. This ticket does not silently drop that requirement — it documents it as an explicit, named limitation.

---

## 3. Architectural Principles

### 3.1 RLS Is the Final Authority

```
UI → Composable → RPC → RLS → Database
```

Every layer above RLS may reject early, for UX (fast client-side feedback, no round trip). **Only RLS guarantees.** No layer above it may ever be trusted as a security boundary. This ticket exists precisely because, until now, the only enforcement was above this line.

### 3.2 Data Ownership Principle

Every table has exactly one owning feature/domain (see §5). Other features may **read**, **subscribe**, or **aggregate** across a table they don't own. They must never write to a table they don't own directly.

Example: Inventory reads `sales`/`sale_line_items` to compute stock movement, and writes to `stock_adjustments`/`products.current_stock` — it never writes to `sales` itself. Returns reverses inventory and revenue by writing its own rows (`returns`, `return_line_items`), not by mutating the original `sales` row.

This principle constrains both the RLS design (a table's write policies should map to its owning feature's roles) and future work (WAFI-200 Business Event Layer) — cross-domain effects should flow through events/reads, not direct foreign writes.

---

## 4. JWT Claims & SQL Helpers

### 4.1 Claims (extend existing `custom_access_token_hook`, migrations 047/048)

The hook already stamps `active_role` from `device_sessions.active_role`, keyed by the `session_id` claim, fail-closed to `'cashier'` on any miss. Extend it to also stamp `staff_id` from `device_sessions.active_staff_id` in the same lookup — one query, two claims, so they can never drift relative to each other.

| Claim | Source | Fail-closed value |
|---|---|---|
| `shop_id` | existing, via `auth_shop_id()` | — (already enforced) |
| `active_role` | `device_sessions.active_role` | `'cashier'` |
| `staff_id` | `device_sessions.active_staff_id` | `null` |

### 4.2 SQL Helper Functions

```sql
-- existing, unchanged
auth_shop_id()   returns uuid  -- SELECT id FROM shops WHERE owner_user_id = auth.uid()

-- new
auth_staff_id()  returns uuid  -- reads staff_id claim from JWT
auth_role()      returns text  -- reads active_role claim from JWT, defaults 'cashier' on null/missing
auth_permissions() returns jsonb
  -- SELECT permissions::jsonb FROM staff WHERE id = auth_staff_id() AND is_active = true
  -- returns '{}'::jsonb if staff_id is null, staff row missing, or staff is inactive

can(flag text) returns boolean
  -- SELECT auth_role() = 'owner' OR COALESCE((auth_permissions()->>flag)::boolean, false)
```

`can()` (not `has_permission()`) is the only way policies reference permission flags. Owner always bypasses (INV-005, §9). Adding a new flag (`can_issue_refunds`, `can_manage_staff`, ...) never touches policy SQL — only the flag's call sites and the `StaffPermissions` type/defaults in `staff.types.ts`.

**No generic `can_manage_*` catch-all.** Each mutable domain gets its own explicit flag:
`can_manage_products`, `can_manage_inventory`, `can_manage_stock_take`, `can_manage_suppliers`, `can_manage_customers`, `can_view_reports`, `can_view_staff_ledger`. A flag governs exactly one domain's writes; it is never reused to gate an unrelated domain.

---

## 5. Domains, Tables, and Per-Table CRUD Ownership

For every domain: owning feature, tables, immutability, lifecycle (created/updated/archived/deleted/consumed by), and event contracts (documented now for WAFI-200, not implemented yet).

### 5.1 Identity & Access
**Tables:** `staff`, `device_sessions`, `devices`
**Immutable:** No (but `staff` rows are never hard-deleted, only deactivated)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `staff` | Owner: all rows/columns. Manager: all rows, all columns except `pin_hash`/`pin_salt`/`recovery_codes`. Cashier: own row only, safe columns only (`id`,`name`,`role`,`is_active`) | Owner only | Owner only (role/permissions/is_active). PIN changes go through a dedicated RPC, never direct UPDATE | Nobody — deactivate via `is_active=false` |
| `device_sessions` | Owner/Manager: all. Cashier: own device's row | System only, via `switch_active_operator()` RPC (SECURITY DEFINER) | Same RPC only | Nobody (session rows expire/are superseded, not deleted) |
| `devices` | All shop roles (device list needs shop-wide visibility for troubleshooting) | Owner (registration flow) | Owner (remote sign-out) | Owner |

**Lifecycle:** Created by Owner (staff)/system (sessions, devices auto-register). Updated by Owner (staff), system RPC (sessions). Archived: `is_active=false` (staff), device remote-signout. Deleted: never. Consumed by: Sales (staff_id attribution), Audit (staff_name_snapshot), Cash & Shifts (shift attribution).
**Produces events (future):** `StaffCreated`, `StaffDeactivated`, `StaffPermissionsChanged`, `OperatorSwitched`, `DeviceRegistered`, `DeviceSignedOut`.
**Consumes events (future):** none.

### 5.2 Sales
**Tables:** `sales`, `sale_line_items`, `sale_payments`, `sale_discounts`, `returns`, `return_line_items`, `return_reasons`
**Immutable:** `sales`/`sale_line_items` partial (draft editable, `status='completed'` locked). `sale_payments` immutable — refund creates a reversal row via `returns`, never edits a payment row.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `sales`, `sale_line_items`, `sale_payments`, `sale_discounts` | Owner/Manager: all. Cashier: `staff_id = auth_staff_id()` OR belongs to the currently-open shift on this device | Owner, Manager, Cashier | Nobody once `status='completed'`. Draft: creator only | Nobody |
| `returns`, `return_line_items` | Owner/Manager: all. Cashier: own-processed returns | Owner, Manager, Cashier (subject to WAFI-100/WAFI-011 net-price invariants) | Nobody once processed | Nobody |
| `return_reasons` | All shop roles | `can_manage_products` (shares config surface) | `can_manage_products` | `can_manage_products` |

**Lifecycle:** Created by any role (POS flow). Updated: draft only, by creator. Archived: n/a. Deleted: never. Consumed by: Cash & Shifts (Z-report), Staff Finance (commission — future), Audit, Accounting (customer credit balance), reporting/dashboard.
**Produces events (future):** `SaleStarted`, `SaleCompleted`, `SaleVoided`, `ReturnProcessed`, `DiscountApplied`.
**Consumes events (future):** `PriceChanged`, `ExchangeRateChanged` (rate lock at first cart line, per Core Invariant #1).

### 5.3 Inventory
**Tables:** `products`, `categories`, `subcategories`, `stock_adjustments`, `suppliers`, `stock_receivings`, `stock_receiving_line_items`, `stock_take_sessions`, `stock_take_lines`
**Immutable:** No, except `stock_adjustments` (append-only ledger of stock changes — corrections are new adjustment rows, not edits)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `products`, `categories`, `subcategories` | All shop roles | `can_manage_products` | `can_manage_products` | `can_manage_products` (soft-delete/`is_active` preferred) |
| `stock_adjustments` | All shop roles | `can_manage_inventory` | Nobody (append-only) | Nobody |
| `suppliers` | All shop roles | `can_manage_suppliers` | `can_manage_suppliers` | `can_manage_suppliers` |
| `stock_receivings`, `stock_receiving_line_items` | All shop roles | `can_manage_suppliers` | `can_manage_suppliers`, draft only | Nobody once finalized |
| `stock_take_sessions`, `stock_take_lines` | All shop roles | `can_manage_stock_take` | `can_manage_stock_take`, only while session open | Nobody |

**Lifecycle:** Created/updated by permission-holders. Archived via `is_active`. Deleted: rarely, product soft-delete preferred. Consumed by: Sales (stock check at sale time), Profit Report (cost basis), Stock-Take (variance).
**Produces events (future):** `ProductCreated`, `ProductPriceChanged`, `StockAdjusted`, `LowStockDetected`, `ReceivingCompleted`, `StockTakeCompleted`.
**Consumes events (future):** `SaleCompleted`, `ReturnProcessed` (both decrement/increment stock).

### 5.4 Cash & Shifts
**Tables:** `cashier_shifts`, `cash_movements`, `denomination_configs`
**Immutable:** `cash_movements` append-only after the owning shift closes.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `cashier_shifts` | Owner/Manager: all. Cashier: own shifts | Owner, Manager, Cashier (open own shift) | Creator only, only while `status='open'` (close-shift fields) | Nobody |
| `cash_movements` | Owner/Manager: all. Cashier: movements on own open shift | Owner, Manager, Cashier — must carry `shift_id`+`device_id` (Core Invariant #3) | Nobody (void via new reversing row) | Nobody |
| `denomination_configs` | All shop roles | Owner | Owner | Owner |

**Lifecycle:** Created by cashier (shift open, movements). Updated by creator until shift closes. Archived: n/a. Deleted: never. Consumed by: Z-Report, Audit, Profit Report (excluded — cash movements are drawer, not P&L, per WAFI-016).
**Produces events (future):** `ShiftOpened`, `ShiftClosed`, `CashMovementRecorded`.
**Consumes events (future):** `SaleCompleted` (cash totals).

### 5.5 Accounting (Customer Credit)
**Tables:** `expenses`, `customers`, `customer_payments`, `installment_plans`, `installment_dues`
**Immutable:** `customer_payments` immutable (correction = new row); `installment_dues` status-transition only.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `expenses` | Owner/Manager only | Owner/Manager only | Owner/Manager, same-day only | Nobody |
| `customers` | All shop roles | `can_manage_customers` | `can_manage_customers` | `can_manage_customers` (soft-delete) |
| `customer_payments` | Owner/Manager: all. Cashier: payments they recorded | `can_manage_customers` | Nobody | Nobody |
| `installment_plans`, `installment_dues` | Owner/Manager: all. Cashier: read-only, own-sale-linked | Owner/Manager (`can_manage_customers`) | Owner/Manager: status transitions (paid/overdue/cancelled) | Nobody |

**Lifecycle:** Created by permission-holders. Updated: status transitions only. Archived: plan `cancelled` status. Deleted: never. Consumed by: Dashboard ("customers owe you"), Unified Money-Owed view (WAFI-017), Audit.
**Produces events (future):** `ExpenseRecorded`, `CustomerPaymentRecorded`, `InstallmentPlanCreated`, `InstallmentDuePaid`, `InstallmentPlanCancelled`.
**Consumes events (future):** `SaleCompleted` (credit-sale balance), `ReturnProcessed` (balance reversal, WAFI-010 interaction).

### 5.6 Staff Finance
*(Renamed from "Payroll" — this is not payroll/compliance; it's advances, penalties, and settlement of informal cash arrangements with staff, consistent with "this is not an accounting platform.")*
**Tables:** `staff_ledger`, `staff_settlements`
**Immutable:** `staff_ledger` fully immutable. `staff_settlements` immutable once `finalized` or `paid` (draft only editable).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `staff_ledger` | Owner, or Manager with `can_view_staff_ledger` | Owner, or Manager with `can_view_staff_ledger` | Nobody | Nobody |
| `staff_settlements` | Owner, or Manager with `can_view_staff_ledger` | Owner, or Manager with `can_view_staff_ledger` | Same, draft status only | Nobody |

**Lifecycle:** Created by owner/permitted manager. Updated: never (`staff_ledger`), draft-only (`staff_settlements`). Archived: n/a. Deleted: never. Consumed by: Staff Performance Dashboard (WAFI-018), Audit.
**Produces events (future):** `StaffLedgerEntryAdded`, `StaffSettlementFinalized`, `StaffSettlementPaid`.
**Consumes events (future):** none.

### 5.7 Audit
**Tables:** `audit_log`
**Immutable:** Yes, already enforced (migration 018 — no UPDATE/DELETE policy exists).

| Op | Who |
|---|---|
| SELECT | Owner, or Manager with a reporting-adjacent permission (`can_view_reports`) |
| INSERT | Any authenticated shop role (system-generated on financial mutations) |
| UPDATE | Nobody, never |
| DELETE | Nobody, never |

**Lifecycle:** Created by every domain's mutations (system-triggered, WAFI-123 wires full coverage). Never updated/archived/deleted. Consumed by: Settings → Audit Log UI, anomaly detection (future WAFI-015).
**Produces events (future):** none (audit_log is itself close to an event log).
**Consumes events (future):** all domains' produced events, eventually.

### 5.8 Configuration
**Tables:** `receipt_settings`, `exchange_rates`, `shop_feature_flags`, `shops`
**Immutable:** `exchange_rates` history append-only (each rate change is a new row, not an edit — this is what makes the rate-lock invariant auditable).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `receipt_settings` | All shop roles | Owner only | Owner only | Nobody |
| `exchange_rates` | All shop roles | Owner only | Nobody (append-only) | Nobody |
| `shop_feature_flags` | All shop roles | Owner only (or system/support) | Owner only | Nobody |
| `shops` | Owner only | System (signup flow, WAFI-123) | Owner only | Nobody |

**Lifecycle:** Created/updated by owner. Consumed by: every domain (shop-wide settings), Sales (rate lock at first cart line).
**Produces events (future):** `ExchangeRateChanged`, `ReceiptSettingsUpdated`.
**Consumes events (future):** none.

---

## 6. RPC Audit Requirement

Every `SECURITY DEFINER` RPC (bypasses RLS by definition) must have a documented answer to:

1. Does it bypass RLS? (Always yes for SECURITY DEFINER — the question is really "why is that acceptable here")
2. What inside the function validates authorization? (role check, PIN re-verification, permission flag, etc.)
3. Which tables does it touch?
4. Which audit_log entries does it write?

Applies immediately to `switch_active_operator()` (already PIN-verifies, needs to also stamp `staff_id` per §4.1) and `allocate_device_code()`. Any future financial-write RPC must answer these four questions in its own migration's comment header before merge.

---

## 7. Security Matrix (abridged — full matrix per table lives in §5)

| Resource | Cashier | Manager | Owner |
|---|---|---|---|
| View own sales/shift | ✅ | ✅ | ✅ |
| View all sales/shifts | ❌ | ✅ | ✅ |
| Create sale | ✅ | ✅ | ✅ |
| Delete a sale | ❌ | ❌ | ❌ |
| View audit log | ❌ | permission-gated | ✅ |
| View staff ledger/settlements | ❌ | permission-gated | ✅ |
| View/edit staff PINs | ❌ | ❌ | ✅ |
| Edit exchange rate | ❌ | ❌ | ✅ |
| Record cash movement (own shift) | ✅ | ✅ | ✅ |
| Manage products/inventory | permission-gated | permission-gated | ✅ |

---

## 8. Threat Model

**Prevents:**
- Cashier reading another cashier's or another shift's sales via a direct REST call
- Cashier reading profit/expense/audit/staff-ledger/staff-PIN data via an extracted JWT
- Role-escalation via forged or stale claims (fail-closed to cashier on any claim miss, per INV-004)
- Cross-tenant reads (already covered by existing `auth_shop_id()`, must not regress)

**Does NOT prevent** (tracked separately):
- ⚠ Offline SQLite inspection on a synced device — PowerSync's sync path doesn't evaluate this project's RLS (WAFI-201)
- ⚠ Rooted/jailbroken device inspecting local storage
- ⚠ Physical device theft
- ⚠ Compromised owner account (owner is the trust root in this model)

**Future Mitigations** (not this ticket):
- Role-aware PowerSync sync buckets (WAFI-201 investigation)
- Encrypted local SQLite
- Device attestation
- Remote device revoke (partially exists via `devices` remote sign-out, §5.1)

---

## 9. Security Invariants

These become acceptance criteria for this ticket and every future authorization-touching ticket.

- **INV-001:** No authenticated request may access data outside `auth_shop_id()`.
- **INV-002:** No cashier may read another cashier's financial records.
- **INV-003:** Financial tables are never exposed without RLS evaluation (no `SECURITY DEFINER` shortcut that skips authorization checks).
- **INV-004:** Permission/role claim failures fail closed (missing/invalid claim → least privilege, never most).
- **INV-005:** Owner always bypasses permission flags (never bypasses tenant scoping).
- **INV-006:** Audit entries are append-only.
- **INV-007:** Server-side authorization (RLS) is authoritative; client-side checks are UX only.

---

## 10. Migration Plan

Expand-contract, two migrations:

1. **Additive** — `auth_staff_id()`, `auth_role()`, `auth_permissions()`, `can()` functions; extend `custom_access_token_hook` to stamp `staff_id`. Fully backward-compatible; no existing policy references these yet.
2. **Policy replacement** — domain-by-domain, each inside its own transaction: DROP existing blanket policies from migration 015 (and per-table additions since), CREATE new per-command (SELECT/INSERT/UPDATE/DELETE) policies per §5. Policy replacement is not data-destructive and can run inside a transaction without downtime.

RPC changes (staff_id stamping, RPC audit documentation) can ride in either migration or a small third one.

---

## 11. Testing Requirements

**Role-based (happy path):** owner, manager, cashier — each domain's SELECT/INSERT/UPDATE/DELETE per §5's matrices.

**Negative / edge cases (where auth bugs actually hide):**
- Invalid/malformed JWT
- Expired JWT
- Wrong `shop_id` (cross-tenant — regression guard on existing behavior)
- Missing `active_role` claim (hook lookup miss → must fail closed to cashier, not fail open)
- Missing `staff_id` claim
- Null or malformed `permissions` JSON (must not throw, must deny)
- Archived/deactivated staff (`is_active=false`) attempting any write
- Manager with all permission flags explicitly `false`

**Lifecycle / concurrency:**
- Manager loses a permission flag mid-session — must lose access on next JWT refresh (not necessarily instantly on the still-valid old token, but no later than the next refresh; document actual latency once implemented)
- Device reassigned to a different shop — old JWT/session must never access the new shop's data

**Manual:** Penetration test — extract JWT, attempt unauthorized reads via curl/Postman against each domain in §5, confirm denial.

---

## 12. Definition of Done

- All tables in §5 have per-command RLS policies matching their CRUD matrix
- `auth_staff_id()`, `auth_role()`, `auth_permissions()`, `can()` implemented and used by all new policies
- `custom_access_token_hook` stamps both `active_role` and `staff_id`
- RPC audit answers documented for `switch_active_operator`, `allocate_device_code`
- All tests in §11 passing (role-based + negative/edge + lifecycle + manual pentest)
- Zero regression on existing cross-tenant isolation tests
- ADR written for WAFI-201 (PowerSync role-branching gap) and ticket filed
- Migration idempotent and reversible; zero data loss
