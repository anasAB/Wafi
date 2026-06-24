# WAFI-058 — Financial visibility: owner-only by default, owner-grantable to a Manager

> Date: 2026-06-24 · Owner: PO · Priority: P1 (accountability / role correctness) · Pack: Staff · Area: staff / permissions / dashboard / reports
> Source: PO decision — financials are **Owner-only by default**, but the **Owner may grant
> a specific Manager** the right to view them.
> **Supersedes** the "Manager always sees reports/revenue" half of WAFI-013. **Client-side
> gating only**; true server-side enforcement is folded into WAFI-010 (see "Enforcement reality").

---

## Decision
Business **financials are Owner-only by default**. Revenue, profit, expenses (money-out
totals), reports/charts, the aggregate outstanding-credit figure, best-sellers, and the
per-cashier "who sold what" breakdown are **hidden from Managers and Cashiers unless the
Owner explicitly grants access** to that staff member.

- **Default Manager** = runs the floor (products, customers incl. recording payments,
  open/close shifts, count cash) but **sees no financials**.
- **Granted Manager** = same, **plus** whatever financial views the Owner switched on
  (`can_view_reports` and/or `can_view_expenses`).
- **Cashier** unchanged (already per-staff custom permissions; the Owner can likewise grant
  these flags, default off).
- Only the **Owner** can grant/revoke — gated by `can_manage_settings`, which only the Owner
  holds. A Manager can never grant themselves or anyone else financial access.

### The line (read first — prevents over-gating)
Owner-controlled = **aggregate / business-reporting financials**. It is **NOT** the
individual transaction an operator must handle:
- A cashier/manager **always** sees the **current sale total** to take payment.
- A manager **always** sees a **specific customer's balance** to record a payment.
- A cashier/manager **always** processes a **return** (find sale by receipt #, refund).
What is gated is the **roll-up**: "how much the shop made", profit, expense totals, "what
each cashier rang", total owed across all customers, reports/charts.

---

## Permission model (the key change)
Today `permissionsForRole()` returns a **fixed** constant for managers
(`MANAGER_PERMISSIONS`), so a manager's permissions can't be tuned. This ticket makes the
**two financial flags owner-tunable per staff member**, while keeping the role's structural
flags fixed:

- **Owner-grantable, default `false`:** `can_view_reports`, `can_view_expenses`. Read from
  the staff member's **stored** permissions (like cashiers already work), not the role constant.
- **Role-fixed, not tunable:** `can_manage_products: true`, `can_manage_customers: true`,
  `can_manage_settings: false` for managers. (Keeping `can_manage_settings` owner-only is
  what guarantees only the owner can grant — do **not** make it tunable.)
- A new Manager is created with both financial flags `false`.
- `OWNER_PERMISSIONS` stays all-true (owner sees everything, not grantable away).

Net effect: **every financial surface keys off the staff member's actual
`can_view_reports` / `can_view_expenses` value** — the role only sets the default. A
granted manager and the owner take the same code paths.

---

## Per-surface behaviour
"Manager" column = **default** (not granted). Any ❌ tied to `can_view_reports` /
`can_view_expenses` flips to ✅ the moment the Owner grants that flag to that manager.

| Surface | Owner | Manager (default) | Cashier | Gated by |
|---|---|---|---|---|
| Business health dashboard (revenue/profit/expense/AR cards, best-sellers, chart) | ✅ | ❌ | ❌ | `can_view_reports` |
| Reports / Profit Report screen | ✅ | ❌ | ❌ | `can_view_reports` |
| Expenses list & totals | ✅ | ❌ | ❌ | `can_view_expenses` |
| Per-cashier breakdown ("who sold what") | ✅ | ❌ | ❌ | `can_view_reports` |
| Aggregate outstanding credit (all customers) | ✅ | ❌ | ❌ | `can_view_reports` |
| Full sale history (list with totals) | ✅ | ❌ | ❌ | `can_view_reports` (returns lookup exempt) |
| **Z-report at shift close** | full | **cash count + variance only** (money figures masked) | n/a | money lines behind `can_view_reports` |
| Per-customer balance (to record a payment) | ✅ | ✅ | ❌ | `can_manage_customers` (unchanged) |
| Ring a sale / current sale total | ✅ | ✅ | ✅ | none |
| Process a return | ✅ | ✅ | per existing | none |
| Default landing after unlock | dashboard | **POS** (dashboard if granted reports) | **POS** | role + `can_view_reports` |

---

## Scope

### In
1. **Make the two financial flags owner-tunable** (`staff.types.ts`,
   `useStaff.permissionsForRole`): managers read `can_view_reports` /
   `can_view_expenses` from stored per-staff permissions (default `false`); the other
   manager flags stay role-fixed. New managers default both off.
2. **Owner-only grant UI** (`StaffForm.vue`): when editing a Manager (or Cashier), the
   Owner sees toggles for "view reports/financials" and "view expenses". Only reachable
   behind `can_manage_settings` (owner). Changing them writes via
   `updateStaffPermissions` and is audited (`logStaffPermissionsChanged`).
3. **Drive every financial surface off the flag value** (not the role): dashboard widgets,
   reports route, expenses route/list, per-cashier breakdown, aggregate AR, full
   sale-history — all behind `can_view_reports` / `can_view_expenses`. Fail closed.
4. **Role+grant-based default landing:** after unlock, land on dashboard if the staff has
   `can_view_reports`, else POS. (Owner always dashboard; a granted manager → dashboard.)
5. **Z-report masking** (`ZReportScreen.vue`): hide revenue/profit/per-operator money for
   staff lacking `can_view_reports`, but always show cash count + variance so any
   shift-capable staff can **close the shift**.

### Out
- Server-side enforcement — UI gating only; the real lock is WAFI-010 (see below).
- The WhatsApp digest (WAFI-057 — deferred; note its conditional revival below).
- The read-only Owner Dashboard app — deferred (needs WAFI-055 + WAFI-010).
- Making `can_manage_settings` / staff-management grantable to managers (must stay owner-only).

---

## Enforcement reality (state it, don't hide it)
After this ticket, "owner-only" / "granted" is **UI visibility**, not security. Any
staffer with the shop anon key can still read financials via the API (WAFI-010). **Add to
WAFI-010's scope:** financial + per-cashier/reporting reads enforced server-side per the
staff token's `can_view_reports` / `can_view_expenses` — a non-granted staff token cannot
read them. Until WAFI-010 ships, this is a UI restriction, communicated as such.

---

## Edge cases
- **Owner grants, then revokes** a manager's `can_view_reports` → access disappears on the
  next permission load / operator unlock; if currently on a now-denied route, redirect.
- **Granted manager mid-session** (owner toggles it while the manager is active) → define
  when it takes effect (recommended: on next operator unlock / app resume, not necessarily
  live mid-screen) and make it consistent.
- **Manager closing a shift without reports access** → cash count + variance visible, money
  masked, close still succeeds. Never block shift close.
- **Manager recording a payment** → sees that customer's balance, not the all-customers AR total.
- **Return by a cashier/manager** → receipt-number lookup + refund work despite the
  sale-history gate.
- **Switch-operator Owner → ungranted Manager** → financial views vanish immediately;
  switching back restores them (ties to WAFI-053).
- **Default landing race** → an ungranted manager must never momentarily render the
  dashboard then bounce; resolve the landing route before first paint.
- **Stored-permission hygiene** → ensure no legacy manager row carries a stale
  `can_view_reports: true` that silently grants access; migration/default must be explicit.
- **Owner forgets PIN, only a manager present** → ungranted manager runs the floor with no
  financial leak; owner recovers via WAFI-056.

---

## Acceptance Criteria
- [ ] A **default** Manager sees no revenue/profit/expense totals, reports, best-sellers,
      aggregate AR, per-cashier breakdown, or full sale history; lands on POS.
- [ ] The **Owner** can grant a specific Manager `can_view_reports` and/or
      `can_view_expenses` from staff management; the change is audited.
- [ ] A **granted** Manager then sees exactly the granted surfaces (and lands on the
      dashboard if granted reports) — same code paths as the owner.
- [ ] Only the Owner can grant/revoke; a Manager cannot reach the grant UI.
- [ ] Revoking removes access on next unlock; deep-linking to a denied financial route
      redirects (fail closed).
- [ ] A Manager (granted or not) can still manage products/customers, ring sales, and
      open/close a shift (money masked on the Z-report when ungranted).
- [ ] WAFI-010 scope updated to enforce these flags server-side (cross-referenced).

## Definition of Done
Tests: default manager denied every financial route/widget; owner grants → same manager
now allowed; revoke → denied again; manager closes a shift with masked figures; grant UI
unreachable by non-owners; switch-operator toggles visibility. Verified on device in `ar`.
Merged, `npm run build` green, staff/permission/dashboard tests updated to the new
default-off-grantable matrix and passing.

## Touch points (orientation)
`src/features/staff/staff.types.ts` + `useStaff.ts` (`permissionsForRole`,
`updateStaffPermissions`) · `StaffForm.vue` (owner grant toggles) · `router/index.ts` +
`router/permissions.ts` (flag-based gates + landing resolver) ·
`src/features/dashboard/**` · `ZReportScreen.vue` (mask money) · sale-history screen ·
expenses screens · `useAuditLog` (`logStaffPermissionsChanged`) · WAFI-010 plan (server
enforcement scope) · i18n for grant-toggle labels + "no access" copy.
