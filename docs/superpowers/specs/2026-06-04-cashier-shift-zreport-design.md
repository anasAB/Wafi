# Cashier Shift + Z-Report — Design Spec

**Date:** 2026-06-04
**Epic:** Staff Management + Cashier Shifts + Z-Report
**Status:** Approved

---

## Overview

Adds staff management (PIN-based employees with permissions), cashier shift open/close, and a Z-report (shift-close summary printable on thermal printer). Covers shops with 1–3 staff (owner + 1–2 employees).

---

## 1. Data Model

### New table: `staff`

| column | type | notes |
|---|---|---|
| `id` | text | UUID |
| `shop_id` | text | |
| `name` | text | Arabic display name |
| `pin_hash` | text | SHA-256 of 4-digit PIN |
| `role` | text | `'owner'` \| `'cashier'` |
| `permissions` | text | JSON blob |
| `is_active` | integer | 0/1 |
| `created_at` | text | ISO timestamp |

### New table: `cashier_shifts`

| column | type | notes |
|---|---|---|
| `id` | text | UUID |
| `shop_id` | text | |
| `device_id` | text | |
| `staff_id` | text | FK → staff.id |
| `opened_at` | text | ISO timestamp |
| `closed_at` | text | nullable — null = shift still open |
| `opening_cash_usd` | real | declared at open |
| `closing_cash_usd` | real | counted at close |
| `closing_cash_syp` | real | counted at close |
| `status` | text | `'open'` \| `'closed'` |

### Modified table: `sales`

Add one nullable column:

```
shift_id   text   -- FK → cashier_shifts.id, nullable for pre-shift sales
```

### Permissions JSON (stored on each `staff` row)

```json
{
  "can_view_reports": true,
  "can_manage_products": false,
  "can_manage_customers": false,
  "can_view_expenses": false,
  "can_manage_settings": false
}
```

- Owner role always gets all permissions regardless of the JSON value.
- Cashier role: navigation items are hidden (not just disabled) for permissions set to false.

---

## 2. New PowerSync Schema Entries

Add to `src/data/powersync/schema.ts`:

```ts
const staff = new Table({
  shop_id:     column.text,
  name:        column.text,
  pin_hash:    column.text,
  role:        column.text,
  permissions: column.text,
  is_active:   column.integer,
  created_at:  column.text,
})

const cashier_shifts = new Table({
  shop_id:           column.text,
  device_id:         column.text,
  staff_id:          column.text,
  opened_at:         column.text,
  closed_at:         column.text,
  opening_cash_usd:  column.real,
  closing_cash_usd:  column.real,
  closing_cash_syp:  column.real,
  status:            column.text,
})
```

Add `shift_id: column.text` to the existing `sales` table entry.

---

## 3. Staff Management

### Location
Settings → "الموظفون" (Staff) — new settings screen. Accessible only to users with owner role or `can_manage_settings: true`.

### Staff list screen
- Lists all active staff, owner first.
- Each row: name, role badge (مالك / كاشير), ••• menu (Edit, Deactivate).
- Owner row: no deactivate option.
- "إضافة موظف" button opens the add form.

### Add/Edit staff form
- **Name** (Arabic text input)
- **Role**: Owner / Cashier (radio — only shown when adding; cannot change owner to cashier)
- **PIN**: 4-digit entry + confirm entry
- **PIN change** (edit mode): "تغيير الرقم السري" button → new 4-digit entry. No old PIN required (owner manages from settings).
- **Permissions checklist** (Cashier role only):
  - عرض التقارير — `can_view_reports`
  - إدارة المنتجات — `can_manage_products`
  - إدارة الزبائن — `can_manage_customers`
  - عرض المصاريف — `can_view_expenses`
  - الإعدادات — `can_manage_settings`

### PIN storage
SHA-256 hash of the 4-digit PIN string. Never stored in plaintext.

### Owner bootstrapping
- During onboarding (existing `/onboarding` route): add a "Set up owner PIN" step — name + 4-digit PIN. Seeds the first `staff` row with `role = 'owner'`.
- Existing installs (no staff rows): on app load, if no `staff` rows exist, redirect to a one-time owner setup screen before showing the shift lock screen.

---

## 4. Shift Open / Close Flow

### `useShiftStore` (Pinia store)

Persists `activeShiftId` in localStorage. On app load:
1. If no `staff` rows → redirect to owner setup.
2. If `activeShiftId` in localStorage → verify shift is still `status = 'open'` in DB → resume (no re-login).
3. If no open shift → show lock screen.

### Lock screen (shift open)
Full-screen, cannot be dismissed. Steps:
1. Staff name cards (active staff only). Tap to select.
2. 4-digit PIN pad. Wrong PIN: shake + clear, try again (no lockout in v1).
3. Correct PIN → "كم في الصندوق؟" — numeric input for opening cash in USD.
4. Confirm → write `cashier_shifts` row with `status = 'open'`, store `shift_id` in `useShiftStore`, navigate to home.

### During shift
- Cashier name shown in sidebar header / top bar (replaces hardcoded "أبو محمد").
- `useSale` reads `activeShiftId` and active staff ID directly from `useShiftStore`.
- Every new sale written by `useSale` includes `shift_id` from `useShiftStore`.
- Navigation items hidden based on active staff's permissions.
- "إغلاق الوردية" button in sidebar footer (and settings menu for mobile).

### Shift close flow
1. Tap "إغلاق الوردية".
2. Cash count screen: enter actual cash in drawer — USD field + SYP field.
3. Navigate to Z-report preview screen (computed in real time).
4. Two actions:
   - **"طباعة وإغلاق"** — prints Z-report, updates shift row (`status = 'closed'`, `closed_at`, cash counts), clears `useShiftStore`, returns to lock screen.
   - **"إغلاق بدون طباعة"** — skips print, same DB update and navigation.

### Mid-shift device refresh
`useShiftStore` reads `activeShiftId` from localStorage on mount and re-validates against DB. If shift is still open, resumes without re-login.

---

## 5. Z-Report

### Computed metrics (from DB, scoped to `shift_id`)

| metric | query |
|---|---|
| Invoice count | `COUNT(*) FROM sales WHERE shift_id = ?` |
| Total revenue USD | `SUM(total_usd) FROM sales WHERE shift_id = ?` |
| Cash USD sales | `SUM(sp.amount_usd) FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id WHERE s.shift_id = ? AND sp.method = 'cash_usd'` |
| Cash SYP sales (raw) | `SUM(sp.amount_raw) FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id WHERE s.shift_id = ? AND sp.method = 'cash_syp'` |
| Card sales | `SUM(sp.amount_usd) ... WHERE sp.method = 'card'` |
| Credit sales | `SUM(total_usd) FROM sales WHERE shift_id = ? AND is_credit = 1` |
| Cash expenses (USD) | `SUM(amount_usd) FROM expenses WHERE paid_in_cash = 1 AND created_at BETWEEN opened_at AND closed_at` |

### Cash reconciliation

**USD drawer:**
```
expected_usd = opening_cash_usd + cash_usd_sales_usd - cash_expenses_usd
variance_usd = closing_cash_usd - expected_usd
```

**SYP drawer** (shown separately, no formula — owner counts physically):
```
expected_syp = cash_syp_sales_raw   (sum of SYP amounts as entered)
actual_syp   = closing_cash_syp
variance_syp = actual_syp - expected_syp
```

Both variances shown on Z-report. USD variance drives the ⚠️ alert (primary currency).

### On-screen layout
```
─────────────────────────────
         تقرير الوردية
─────────────────────────────
الكاشير:        [name]
الجهاز:         [device_code]
فتح:            [opened_at formatted]
إغلاق:          [closed_at formatted]
المدة:          [duration]
─────────────────────────────
          المبيعات
─────────────────────────────
عدد الفواتير:       [count]
إجمالي المبيعات:    $[total]
─────────────────────────────
       تفصيل طريقة الدفع
─────────────────────────────
نقد دولار:          $[amount]
نقد ليرة:           [amount] ل.س
بطاقة:              $[amount]
آجل (دين):          $[amount]
─────────────────────────────
          المصاريف
─────────────────────────────
مصاريف الوردية:     $[amount]
─────────────────────────────
        حساب الصندوق
─────────────────────────────
رصيد الفتح:         $[opening]
+ نقد مبيعات:       $[cash_sales]
- مصاريف نقدية:     $[cash_expenses]
= متوقع في الصندوق: $[expected]
عند العد الفعلي:    $[actual]
الفرق:              [variance] ⚠️ or ✓
─────────────────────────────
```

Variance: green if ≥ 0, red + ⚠️ if negative.

### Thermal print
New `printZReport(shift, metrics)` function in `useZReport` composable (alongside, not inside, `usePrinter`). Uses the existing printer abstraction. Same ESC/POS format as above.

### Shift history screen
Route: `/shifts` — "سجل الورديات" under Reports section.
- Lists closed shifts: date, cashier name, duration, total sales, variance badge.
- Tap a row → read-only Z-report view for that shift.
- No reprint of historical Z-reports in v1.

---

## 6. New Feature Directory

```
src/features/shifts/
  shift.types.ts
  shift.store.ts          ← useShiftStore (Pinia)
  composables/
    useShift.ts           ← open/close shift DB operations
    useZReport.ts         ← Z-report metric computation + print
  components/
    LockScreen.vue        ← full-screen shift-open gate
    CashCountSheet.vue    ← bottom sheet for closing cash entry
    ZReportScreen.vue     ← preview before close
    ShiftHistoryScreen.vue
  index.ts

src/features/staff/
  staff.types.ts
  composables/
    useStaff.ts
    usePinAuth.ts         ← PIN hash + verify
  components/
    StaffList.vue
    StaffForm.vue
    PinPad.vue
  index.ts
```

---

## 7. Navigation / Permission Guards

`AppSidebar.vue` and `AppBottomNav.vue`: filter nav items by checking `useShiftStore().activeStaffPermissions`.

Example:
```ts
const navItems = computed(() =>
  allNavItems.filter(item => !item.permission || permissions.value[item.permission])
)
```

Route-level guard (optional for v1, required for v1.5): `router.beforeEach` checks shift state — if no open shift, redirect to lock screen.

---

## 8. Out of Scope (v1)

- PIN brute-force lockout (v1.5)
- Cashier commission tracking (v1.5)
- Re-printing historical Z-reports (v1.5)
- Role editing after creation (can add new role, deactivate old)
- Multi-device shift coordination (each device has its own shift)
- Shift hand-off between cashiers mid-day (close + reopen)
