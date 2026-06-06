# Audit Log — Design Spec
_Date: 2026-06-06_

## Overview

A tamper-visible audit trail that answers "are my employees (or anyone) making unauthorized changes?" Every sensitive action in the app is logged with who did it, what changed, and when. The owner can review the full log or drill into the history of any individual entity.

This feature is part of the **Staff Pack** (+$5/month add-on).

---

## 1. Session Store

New Pinia store: `useSessionStore` (`src/store/session.store.ts`)

**State:**
- `activeStaff: Staff | null` — the currently logged-in staff member

**Actions:**
- `setActiveStaff(staff: Staff)` — called after successful PIN verification
- `clearSession()` — called on logout or user switch

**Behaviour:**
- Persisted to `localStorage` via pinia-plugin-persistedstate (already in use) so a page refresh does not require re-login
- At app launch, if `activeStaff` is `null`, a PIN prompt sheet (`StaffPinPrompt.vue`) is shown before the app is usable
- Owner can switch user from the top nav (clears session, shows PIN prompt)
- `activeStaff.id` is the value written as `staff_id` on every audit row

---

## 2. Database Schema

New PowerSync table: `audit_log`

| Column | Type | Notes |
|---|---|---|
| `id` | text | UUID |
| `shop_id` | text | FK → shops |
| `staff_id` | text | FK → staff.id — nullable (system actions) |
| `staff_name` | text | Snapshot of name at event time — survives staff deletion |
| `event` | text | Enum string, e.g. `'sale.completed'` |
| `entity_type` | text | `'sale'` \| `'product'` \| `'expense'` \| `'customer'` \| `'stock'` \| `'shift'` \| `'exchange_rate'` \| `'settings'` \| `'staff'` \| `'return'` |
| `entity_id` | text | UUID of affected record — nullable for settings/rate changes |
| `meta` | text | JSON blob with event-specific context (old/new values, amounts, names) |
| `created_at` | text | ISO timestamp |

No `sync_status` column — audit rows are append-only and never edited; PowerSync handles them without a pending/synced distinction.

`staff_name` is intentionally denormalized so the log remains readable after a staff member is deleted.

---

## 3. Event Enum

File: `src/features/audit/audit.types.ts`

```
sale.completed
sale.deleted
return.processed
product.created
product.updated
product.deleted
product.price_changed
expense.created
expense.deleted
customer.created
customer.updated
customer.deleted
customer.payment_recorded
stock.adjusted
shift.opened
shift.closed
exchange_rate.changed
settings.receipt_updated
staff.created
staff.deactivated
staff.permissions_changed
```

---

## 4. `useAuditLog` Composable

File: `src/features/audit/composables/useAuditLog.ts`

One typed helper per event. Each helper:
1. Reads `activeStaff` from `useSessionStore`
2. Builds a typed `meta` object for the event
3. Inserts one row into `audit_log` via `db.execute`
4. Never throws — errors are swallowed with `console.warn` so audit failures never block the primary action

If `activeStaff` is `null` when called, `staff_id` is written as `null` and `staff_name` as `'system'`.

**Example signatures:**
```ts
logSaleCompleted(saleId: string, totalUsd: number, itemCount: number): Promise<void>
logSaleDeleted(saleId: string, totalUsd: number): Promise<void>
logReturnProcessed(returnId: string, saleId: string, refundUsd: number): Promise<void>
logProductCreated(productId: string, name: string): Promise<void>
logProductUpdated(productId: string, name: string): Promise<void>
logProductDeleted(productId: string, name: string): Promise<void>
logProductPriceChanged(productId: string, name: string, oldPrice: number, newPrice: number): Promise<void>
logExpenseCreated(expenseId: string, category: string, amountUsd: number): Promise<void>
logExpenseDeleted(expenseId: string, category: string, amountUsd: number): Promise<void>
logCustomerCreated(customerId: string, name: string): Promise<void>
logCustomerUpdated(customerId: string, name: string): Promise<void>
logCustomerDeleted(customerId: string, name: string): Promise<void>
logCustomerPaymentRecorded(customerId: string, amountUsd: number): Promise<void>
logStockAdjusted(productId: string, name: string, oldQty: number, newQty: number): Promise<void>
logShiftOpened(shiftId: string): Promise<void>
logShiftClosed(shiftId: string): Promise<void>
logExchangeRateChanged(oldRate: number, newRate: number): Promise<void>
logReceiptSettingsUpdated(): Promise<void>
logStaffCreated(staffId: string, name: string, role: string): Promise<void>
logStaffDeactivated(staffId: string, name: string): Promise<void>
logStaffPermissionsChanged(staffId: string, name: string): Promise<void>
```

**Call sites** — each helper is called in the relevant existing composable right after the DB mutation succeeds:

| Composable | Helpers to add |
|---|---|
| `useSales` | `logSaleCompleted`, `logSaleDeleted` |
| `useReturns` (inside `useReturnSheet`) | `logReturnProcessed` |
| `useProducts` | `logProductCreated`, `logProductUpdated`, `logProductDeleted`, `logProductPriceChanged` — when `price_usd` changes, call `logProductPriceChanged` instead of `logProductUpdated` (price change is more specific; don't emit both) |
| `useExpenses` | `logExpenseCreated`, `logExpenseDeleted` |
| `useCustomers` | `logCustomerCreated`, `logCustomerUpdated`, `logCustomerDeleted` |
| `useCustomerPayments` | `logCustomerPaymentRecorded` |
| `useStockAdjustments` | `logStockAdjusted` |
| `useCashierShift` | `logShiftOpened`, `logShiftClosed` |
| `useExchangeRate` | `logExchangeRateChanged` |
| `useReceiptSettings` | `logReceiptSettingsUpdated` |
| `useStaff` | `logStaffCreated`, `logStaffDeactivated`, `logStaffPermissionsChanged` |

---

## 5. UI

### Central Log Page

Route: `/settings/audit-log`
File: `src/features/audit/AuditLogPage.vue`
Access: owner role only — cashiers see an "غير مصرح" unauthorized message

**Layout:**
- `AppHeader` with back button, title "سجل النشاط"
- Filter bar: `PeriodToggle` (today/week/month) + staff member dropdown + event category chips
- List of audit rows, newest first
- Each row: timestamp · staff name + role badge · human-readable Arabic description · entity type chip
- Tapping a row expands inline to show raw `meta` details
- Empty state when no events in the selected period

**Arabic event descriptions** (examples):
- `sale.completed` → "أكمل بيع بقيمة $45.00"
- `product.price_changed` → "غيّر سعر iPhone 14 من $500 إلى $450"
- `exchange_rate.changed` → "غيّر سعر الصرف من 13,000 إلى 13,500"
- `staff.deactivated` → "عطّل حساب موظف: أحمد"

### Per-Entity History Component

File: `src/features/audit/components/AuditHistory.vue`

Props: `entityType: string`, `entityId: string`

- Queries `audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 10`
- Renders a compact timeline (no pagination)
- Hidden entirely for cashier role
- Placed at the bottom of: sale detail sheet, product edit sheet, expense edit sheet, customer detail sheet, return detail view

---

## 6. Error Handling

- All `useAuditLog` helpers wrap their `db.execute` in `try/catch` — failures are `console.warn`'d and silently swallowed
- A failing audit write never blocks, rolls back, or surfaces an error to the user
- If `activeStaff` is null: `staff_id = null`, `staff_name = 'system'`

---

## 7. Testing

- **`useAuditLog` unit tests** — mock `db.execute`, assert correct row shape (event, entity_type, entity_id, meta fields) for each helper
- **`useSessionStore` unit tests** — set/clear staff, verify persistence flag
- **Existing composable tests** — add one assertion per mutating function: after the action, verify the correct `logXxx` helper was called with the right args (mock `useAuditLog`)
- **No UI tests** for `AuditLogPage` or `AuditHistory` — correctness is covered at the composable layer

---

## 8. Out of Scope (deferred)

| Feature | Version |
|---|---|
| Cryptographic chaining (tamper-evident) | v2 |
| Log export (Excel/CSV) | v1.5 |
| Log retention / pruning policy | deferred |
| Cashier-visible partial log | deferred |
