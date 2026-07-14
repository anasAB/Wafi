# PARTIAL Items Completion — Implementation Plan

> **For the developer:** Each task below is self-contained. Follow the existing patterns cited by exact file path. Every task ends with Acceptance Criteria (AC) and Definition of Done (DoD). Check the box when the AC is met AND the DoD passes.

**Goal:** Finish every user story currently scored PARTIAL in the v1 audit so each meets its `v1_epics.md` acceptance criteria.

**Architecture:** Vue 3 + TypeScript PWA, PrimeVue (Aura), Tailwind, offline-first via PowerSync (local SQLite → Supabase). No new backend services are introduced by this plan. Photos and generated documents are stored as base64 data URIs and synced as text (existing pattern).

**Tech Stack:** Vue 3 `<script setup>`, Pinia stores, PowerSync `db`, PrimeVue components, `wa.me` deep links for WhatsApp.

## Global Constraints (apply to every task)

- **Offline-first.** Every feature works with WiFi off. All writes set `sync_status = 'pending'` and sync via PowerSync. Never block the user on the network.
- **Arabic RTL, plain-language.** All new UI is `dir="rtl"`, shop-owner language ("مخزون سالب" not "negative inventory"). Add strings to `src/i18n/ar.ts` and `src/i18n/en.ts`.
- **Dual currency.** USD primary, SYP secondary, computed from the shared exchange rate (`src/features/exchange-rate/useExchangeRate.ts`).
- **Phone-first.** Design the phone layout first; tap targets ≥ 56px.
- **Permissions via `canUserDo`.** Never read a permission flag inline. Gate through `src/router/permissions.ts` `canUserDo(staff, action)`.
- **Photo pattern.** Reuse `src/features/products/components/ProductPhotoUpload.vue` + `blobToDataUrl` (compressed WebP ≤ 60 KB, stored as data URI text). Do not add a binary/storage-bucket path.
- **Build gate.** `npm run build` type-checks test files too — a TS error in any test blocks the whole build. Run `npm run build` before considering any task done, not just `npm run dev`.
- **Tests.** Add/extend Vitest tests next to the code (`__tests__/` folders). Match the existing test style.
- **DoD norm (per `v1_epics.md`).** A story is not "done" until it has been used in a real session by customer #0 (brother's shop) where the epic requires it.

---

## Priority & sequencing

| # | Item | Epic | Effort | Priority |
|---|---|---|---|---|
| 1 | Shift-open guard for POS | 5.3 | S | **P0 — accountability hole** |
| 2 | Exchange rate on home screen | 1.5 | S | **P0 — Sacred Rule #2** |
| 3 | Expense receipt photo | 3.4 | S | P1 — named differentiator |
| 4 | Allow-negative stock + flag | 2.4 | M | P1 — documented business rule |
| 5 | Customer statement as PNG image | 4.6 | M | P1 |
| 6 | Low-stock "mark as reordered" | 2.5 | M | P1 |
| 7 | Staff photos (form + PIN screen) | 5.1 / 5.2 | M | P2 |
| 8 | Max-5 staff limit | 5.1 | S | P2 |
| 9 | "Last changed by" on product | 2.6 | S | P2 |
| 10 | Today/Week/Month time-of-day default | 3.2 | S | P2 |
| 11 | Pending-sync badge on credit | 4.8 | S | P2 |
| 12 | Swipe-to-remove sale line | 1.2 | S | P3 — polish |
| 13 | One-tap prepared daily digest | 9 | M | P2 |
| 14 | WhatsApp receipt discoverability | 6 | S | P3 — verify only |
| 15 | Onboarding checklist wiring | 12 | M | P2 |
| — | Offline shift/audit merge | 5.9 | — | Verify only — no work |

---

## Task 1 — Shift-open guard for POS (5.3)

**Files:**
- Modify: `src/router/index.ts` (the `beforeEach` guard, ~line 55)
- Modify: `src/features/pos/PosPage.vue` (or `POSSaleScreen.vue`) — inline guard fallback
- Reference: `src/features/shifts/shift.store.ts` (`isShiftOpen` computed already exists, line 9)
- Test: `src/router/__tests__/` (new case)

**Current state:** `shiftStore.isShiftOpen` exists but nothing enforces it. A cashier can navigate to `/pos` and ring sales with no open shift, so those sales fall outside the shift/variance envelope (breaks 5.5 reconciliation integrity).

**What's missing:** Enforcement that a cashier cannot reach the ring-a-sale flow without an open shift.

**Approach:**
1. In `router/index.ts`, add a route `meta.requiresOpenShift: true` to `/pos` and `/pos/confirmation`.
2. In `beforeEach`, after the permission check, if `to.meta.requiresOpenShift` and `!useShiftStore().isShiftOpen` → redirect to the shift-open screen (the `CashCountSheet`/`LockScreen` open-shift path). Owners/managers are subject to the same rule (they must open a shift to ring sales) — the plan attributes every sale to a shift.
3. Keep it fail-closed: no active operator → already denied by existing `canUserDo`.

**Acceptance Criteria:**
- [ ] Navigating to `/pos` with no open shift redirects to the open-shift flow, not the POS.
- [ ] After opening a shift, `/pos` is reachable and sales ring normally.
- [ ] Closing the shift makes `/pos` redirect again.
- [ ] The redirect works offline.

**Definition of Done:** Router test proves redirect when `isShiftOpen === false` and pass-through when `true`. `npm run build` passes. Brother's cashier cannot ring a sale without opening a shift in a real session.

---

## Task 2 — Exchange rate on the home screen (1.5)

**Files:**
- Modify: `src/pages/HomePage.vue`
- Reuse: `src/features/exchange-rate/ExchangeRateWidget.vue`, `ExchangeRateEditor.vue`
- Reference: `src/components/AppHeader.vue:51` (how the widget is mounted on POS)

**Current state:** The rate widget + numpad editor exist and propagate instantly (`useExchangeRate.ts` module state), but the widget renders only in the POS header. The plan is explicit: the rate must be a prominent action **on the home screen** ("If this is buried, we're another desktop product").

**What's missing:** The `ExchangeRateWidget` at the top of the home dashboard.

**Approach:** Mount `<ExchangeRateWidget />` at the top-start of `HomePage.vue`'s header row (before the KPI cards), opening the existing `ExchangeRateEditor`. Do not duplicate state — the shared `useExchangeRate` ref already updates every screen.

**Acceptance Criteria:**
- [ ] The current rate ("اليوم: 14,500 ل.س = 1$") with an edit pencil is visible above the fold on the home screen.
- [ ] Editing it updates SYP figures on the home cards and POS in < 1 second, no reload.
- [ ] Works offline.

**Definition of Done:** Editing the rate on the home screen changes the SYP secondary values on the KPI cards live. `npm run build` passes.

---

## Task 3 — Expense receipt photo (3.4)

**Files:**
- Modify: `src/features/expenses/components/ExpenseForm.vue`
- Reuse: `src/features/products/components/ProductPhotoUpload.vue`
- Reference: data layer is ALREADY done — `expenses.photo_url` column (migration `009_expand_domain_tables_for_sync.sql:34`), `expense.types.ts` `photoUrl`, `useExpenses.ts` reads/writes `photo_url` (lines 130-134, 232-241).

**Current state:** Everything except the form UI exists. `ExpenseForm.vue` has amount/currency/category/date/notes but no photo field.

**What's missing:** A photo-capture widget bound to `photoUrl`, so "photo-first expense capture" (a named v1 differentiator) actually works.

**Approach:** Add `<ProductPhotoUpload :modelValue="form.photoUrl" @change="v => form.photoUrl = v" @error="showError" />` to `ExpenseForm.vue`, labelled "صورة الإيصال (اختياري)". The component already compresses to WebP ≤ 60 KB and emits a data URI; `useExpenses` already persists it. No migration needed.

**Acceptance Criteria:**
- [ ] Owner can attach a photo of a receipt when logging an expense (camera or file).
- [ ] The photo persists after reload and appears in the expense breakdown (tap Expenses card → 3.3).
- [ ] Expense without a photo still saves (photo is optional).
- [ ] Full flow logs an expense in < 30 seconds on a phone.

**Definition of Done:** A logged expense with a photo shows its thumbnail in the expense list after a reload and syncs to a second device. `npm run build` passes.

---

## Task 4 — Allow-negative stock + flag (2.4) — DECISION: allow negative
//TODO i don't agree with being able to sell when there is nevative number NOT BEING IMPLMENTED  
**Files:**
- Modify: `src/features/pos/useSale.ts` (lines 45-48 — remove the blocking throws)
- Modify: `src/features/pos/SalePanel.vue` (render a warning icon per line)
- Modify: `src/features/payment/usePayment.ts` (stock decrement must not clamp at 0)
- Reference: `src/store/payment_accounting_invariants` behaviour — COGS uses the product's `cost_price_usd` snapshot at sale time; negative stock does not change how COGS is recorded.
- Test: `src/__tests__/features/useSale.test.ts`, `src/__tests__/features/usePayment.test.ts`

**Current state:** `useSale.ts:45` throws `نفد المخزون` when stock < 1, and `:47-48` throws when cart qty ≥ available. Stock is clamped, blocking overselling. The plan requires the opposite: **never block the cashier**; allow negative stock and flag the line.

**What's missing:** Non-blocking sale of out-of-stock items + a visible per-line warning + a stock decrement that can go negative.

**Approach:**
1. In `useSale.ts`, delete the two `throw` guards (lines 45, 47-48). Keep adding the line. The line already carries `availableStock` (line 59) — keep it for the flag.
2. In `SalePanel.vue`, when a line's `quantity > availableStock`, render a small warning icon + text (e.g. "⚠ مخزون سالب: {availableStock - quantity}"). Never disable Confirm.
3. In `usePayment.ts`, ensure the stock-deduction `UPDATE` sets `current_stock = current_stock - qty` with **no `MAX(0, …)` clamp**, so it can go negative.
4. Add a subtle warning on the confirmation screen if any line oversold.

**Acceptance Criteria:**
- [ ] A product at 0 (or below) stock can still be added and sold; the sale completes.
- [ ] Oversold lines show a warning icon in the sale panel and on the receipt/confirmation.
- [ ] After the sale, `current_stock` is negative by the oversold amount (not clamped to 0).
- [ ] Two devices offline both selling the last unit → on sync, stock goes negative and is flagged (per plan 2.7 edge case), no crash.
- [ ] COGS/profit for the sale is unchanged from the clamped behaviour (uses cost snapshot, not stock level).

**Definition of Done:** Unit tests cover: oversell adds the line, decrement goes negative, warning flag is set. `npm run build` passes. Confirm with brother that overselling "from the back" now works.

---

## Task 5 — Customer statement as a PNG image (4.6) — DECISION: styled PNG

**Files:**
- Modify: `src/features/messaging/useSendStatement.ts`
- Create: `src/features/messaging/renderStatementImage.ts` (DOM/canvas → PNG data URI)
- Reference: `statementText.ts` (already builds the statement content), `ProductPhotoUpload.vue` (canvas → WebP pattern to mirror), `whatsapp.ts` (`buildWaMeUrl`)
- Test: `src/features/messaging/__tests__/` (new render test)

**Current state:** `useSendStatement` builds a well-formatted **text** statement and opens `wa.me` with it. No document is produced. The plan asked for a letterhead PDF; decision is to ship a **styled PNG image** instead (RTL-safe, WhatsApp-native, no heavy PDF dependency).

**What's missing:** A rendered branded statement image the owner can attach, plus the shop letterhead (logo + name from receipt settings).

**Approach:**
1. Build the statement DOM off-screen (shop logo from `receipt_settings`, shop name, customer name, period, each sale/payment row with running balance, ending balance), styled RTL.
2. Rasterise it to a PNG data URI using a canvas. Prefer a small, self-contained approach; if a helper is needed, `html-to-image` (~small, no network) is acceptable — otherwise draw to `<canvas>` directly like `ProductPhotoUpload`'s `compressToWebP`. Cap output ~150 KB.
3. Keep the existing text message as the WhatsApp caption. The owner attaches the generated PNG (WhatsApp attaches images cleanly on Android/iOS/desktop). Show the image in the existing `WhatsAppPreviewSheet` before sending.
4. Do NOT add a PDF library.

**Acceptance Criteria:**
- [ ] "إرسال كشف الحساب" produces a branded PNG (logo, shop name, customer, transactions, running balance, total owing) in < 3 seconds.
- [ ] Arabic text renders correctly (proper RTL shaping) — verify on a real device, not just desktop Chrome.
- [ ] The preview sheet shows the image before sending; owner can still edit the caption text.
- [ ] `wa.me` opens with the customer's phone + caption prefilled; the image is attachable.
- [ ] Works offline (image generated locally; send queues until WhatsApp is reachable).

**Definition of Done:** Render test asserts a non-empty PNG data URI for a sample statement. Manual check on Android Chrome + iOS Safari confirms Arabic renders. Brother sends one real statement image. `npm run build` passes.

---

## Task 6 — Low-stock "mark as reordered" (2.5)

**Files:**
- Create: `supabase/migrations/028_products_reordered_until.sql`
- Modify: `src/data/powersync/schema.ts` (add `reordered_until` to products)
- Modify: `src/features/products/composables/useLowStockAlerts.ts`
- Modify: the home-screen low-stock card + full list UI (where `useLowStockAlerts` is consumed)
- Modify: `powersync.yaml` only if a new column needs republishing (column add on an existing table usually does not).
- Test: `src/__tests__/features/useLowStockAlerts.test.ts` (or create)

**Current state:** `useLowStockAlerts.ts` is a pure query (`current_stock <= low_stock_threshold`). No way to dismiss an item. The plan wants a "Mark as reordered" action that hides an item for 7 days.

**What's missing:** Persisted per-product "reordered" state + query exclusion + the button.

**Approach:**
1. Migration `028`: `ALTER TABLE public.products ADD COLUMN reordered_until TIMESTAMPTZ;`
2. Add `reordered_until` to the PowerSync client schema (`schema.ts`).
3. In `useLowStockAlerts.load()`, extend the WHERE with `AND (reordered_until IS NULL OR reordered_until < ?)` passing `now`.
4. Add `markReordered(productId)` that sets `reordered_until = now + 7 days`, `sync_status = 'pending'`.
5. In the low-stock list, add a "تم إعادة الطلب" button per item that calls it and removes the row.

**Acceptance Criteria:**
- [ ] Tapping "تم إعادة الطلب" removes the item from the low-stock card and list.
- [ ] The item stays hidden for 7 days, then reappears if still below threshold. //TODO need to be checked!, if we reordered item and we got the item form the supplier after 2 days what happend ? will it get updated automaticlaly ? or we should do that manyally 
- [ ] The dismissal syncs across devices (offline-safe).
- [ ] Low-stock count on the home screen updates immediately.

**Definition of Done:** Migration `028` applied to hosted Supabase. Unit test proves reordered items are excluded until the deadline. `npm run build` passes.

---

## Task 7 — Staff photos: form + PIN sign-in screen (5.1 / 5.2)

**Files:**
- Create: `supabase/migrations/029_staff_photo_url.sql`
- Modify: `src/data/powersync/schema.ts` (add `photo_url` to staff)
- Modify: `src/features/staff/staff.types.ts` (`Staff.photoUrl?: string`, `NewStaff.photoUrl?`)
- Modify: `src/features/staff/composables/useStaff.ts` (read/write `photo_url`)
- Modify: `src/features/staff/components/StaffForm.vue` (add `ProductPhotoUpload`)
- Modify: `LockScreen.vue` (render avatars)
- Test: `src/features/staff/composables/__tests__/useStaff.test.ts`

**Current state:** `Staff` has no photo field. `StaffForm` has no photo input. `LockScreen` shows names only. The plan wants photos in both the staff form and the PIN sign-in screen ("tap your face, enter PIN").

**What's missing:** `photo_url` end to end + avatar rendering.

**Approach:**
1. Migration `029`: `ALTER TABLE public.staff ADD COLUMN photo_url TEXT;`
2. Add `photoUrl` to schema + `Staff`/`NewStaff` types; map it in `rowToStaff`/`createStaff`/`updateStaff`.
3. `StaffForm.vue`: add `<ProductPhotoUpload>` bound to `form.photoUrl`.
4. `LockScreen.vue`: render a round avatar (photo if present, else colored initials circle) above each name; keep tap → keypad.

**Acceptance Criteria:**
- [ ] Owner can attach a photo when adding/editing an employee (optional).
- [ ] The PIN sign-in screen shows each active employee's avatar (photo or initials), name below.
- [ ] Sign-in still takes < 5 seconds; tapping an avatar opens the keypad.
- [ ] Works offline; photo syncs across devices.

**Definition of Done:** Migration `029` applied. `useStaff` test covers photo round-trip. `npm run build` passes.

---

## Task 8 — Max-5 staff limit (5.1)

**Files:**
- Modify: `src/features/staff/composables/useStaff.ts` (`createStaff`)
- Modify: `src/features/staff/components/StaffList.vue` (disable "add" at limit + message)
- Test: `useStaff.test.ts`

**Current state:** No limit. Unlimited employees can be created — the Staff Pack's "up to 5 users" boundary is given away.

**What's missing:** Enforcement of 5 active staff (the current pack limit).

**Approach:** In `createStaff`, count `is_active = 1` staff for the shop; if ≥ 5, reject with a plain-language message ("وصلت إلى الحد الأقصى (5 موظفين) لباقتك"). Disable the add button in `StaffList` when at the limit. **Add a `// TODO: drive this limit from the customer's pack entitlement once per-tenant flags exist` comment** — this hardcoded 5 is a stopgap until the entitlement system is built.

**Acceptance Criteria:**
- [ ] Creating a 6th active employee is blocked with a clear Arabic message.
- [ ] Deactivating an employee frees a slot (count is of active staff).
- [ ] The add button is disabled with an explanatory hint at the limit.

**Definition of Done:** Unit test proves the 6th active create is rejected and a deactivation frees a slot. `npm run build` passes.

---

## Task 9 — "Last changed by" on product (2.6)

**Files:**
- Modify: `src/features/products/EditProductPage.vue`
- Reference: audit already records `product.price_changed` / `product.updated` (`useProducts.ts:74`) with staff + timestamp; `products` has `updated_at`.
- Reference: `src/features/audit/composables/useAuditLog.ts` (query by entity)

**Current state:** Price/cost changes are audited, but the edit screen never surfaces "last changed: X ago by Y". The audit data exists; it's just not displayed.

**What's missing:** A one-line "آخر تعديل: قبل ساعتين — محمد" on the edit screen.

**Approach:** On `EditProductPage.vue`, query the latest audit entry for this product id (reuse `useAuditLog` filtered by entity id) and render a small line at the bottom: relative time (reuse the app's existing relative-time formatter used in the audit feed) + staff name.

**Acceptance Criteria:**
- [ ] The product edit screen shows the most recent change's relative time + who made it.
- [ ] If there is no change history, the line is hidden (no "undefined").
- [ ] Reflects the correct staff name and time after an edit.

**Definition of Done:** Manually editing a product's price updates the line to the current operator + "just now". `npm run build` passes.

---

## Task 10 — Today/Week/Month time-of-day default (3.2)

**Files:**
- Modify: `src/features/dashboard/composables/usePeriodToggle.ts`
- Test: `src/__tests__/features/` (new small test)

**Current state:** `const period = ref<Period>('today')` — hardcoded. The plan wants default "Today" before noon, "This Week" after noon.

**What's missing:** Time-of-day-based initial value.

**Approach:** Initialise the singleton from the current hour: `const period = ref<Period>(new Date().getHours() < 12 ? 'today' : 'week')`. Keep `setPeriod` as-is. (Note: this is a first-load default only; the user's manual toggle wins for the session.)

**Acceptance Criteria:**
- [ ] Opening the app before 12:00 defaults the dashboard to "اليوم".
- [ ] Opening at/after 12:00 defaults to "الأسبوع".
- [ ] Manually toggling still overrides and persists for the session.

**Definition of Done:** A test that injects the hour (or wraps `new Date`) proves both branches. `npm run build` passes.

---

## Task 11 — Pending-sync badge on credit (4.8)

**Files:**
- Modify: `src/features/customers/composables/useCustomerBalance.ts` (add a pending-count query)
- Modify: `src/features/customers/CustomerDetailPage.vue` and/or `CustomersPage.vue` (render badge)
- Reference: `SyncIndicator.vue` for the existing "pending" visual language

**Current state:** Balances are optimistic (include `sync_status='pending'` rows — good), but nothing tells the owner a balance contains unsynced operations. The plan wants an explicit "pending sync" badge.

**What's missing:** A badge when a customer has unsynced sales/payments.

**Approach:** Add a query counting rows where `sync_status = 'pending'` for the customer across `sales` (credit) and `customer_payments`. If > 0, show a small "بانتظار المزامنة" chip next to that customer's balance (list row + detail header). Clear automatically when the count returns to 0 (re-query on sync status change, same pattern as `useSync.refreshCounts`).

**Acceptance Criteria:**
- [ ] Recording a payment/credit sale offline shows a "pending sync" chip on that customer.
- [ ] The chip disappears once the rows sync.
- [ ] The displayed balance already includes the pending operation (unchanged).

**Definition of Done:** Offline-record → chip appears; simulate sync → chip clears. `npm run build` passes.

---

## Task 12 — Swipe-to-remove sale line (1.2)

**Files:**
- Modify: `src/features/pos/SalePanel.vue` (lines ~172-190, the line row + delete button)

**Current state:** Lines are removed via a `×` delete button (`store.removeLine`, line 190). The plan also specified swipe-left to remove.

**What's missing:** A swipe-left gesture on a line that removes it.

**Approach:** Add a lightweight touch/pointer swipe handler on each line row: on left-swipe past a threshold, call `store.removeLine(line.productId)`. Keep the `×` button as the non-gesture fallback. Do not pull in a heavy gesture library — a small pointer-event handler is enough. Guard against accidental removal (require a clear swipe distance).

**Acceptance Criteria:**
- [ ] Swiping a sale line left past the threshold removes it.
- [ ] The `×` button still works.
- [ ] A short/accidental swipe does not remove the line.
- [ ] Works on touch (phone) — verify on a real device.

**Definition of Done:** Manual check on a phone. `npm run build` passes.

---

## Task 13 — One-tap prepared daily digest (9) — DECISION: prepared, not auto-sent

**Files:**
- Create: `src/features/messaging/useDailyDigest.ts` (compose digest text from dashboard metrics)
- Modify: home screen or settings to hold the owner's WhatsApp number + a daily reminder toggle
- Reference: `useDashboardMetrics.ts` (revenue/profit), `useLowStockAlerts.ts` (count), `useCustomerBalance` (owed), `whatsapp.ts` (`openWhatsApp`)
- PWA: use the existing service worker (`vite-plugin-pwa`) for a local scheduled notification if available; otherwise an in-app "your digest is ready" prompt when the app is opened after a set hour.

**Current state:** No digest exists. `wa.me` cannot auto-send (it needs a human to tap Send) and there is no backend scheduler — so true automation is out of scope. Decision: a **prepared one-tap digest**.

**What's missing:** A daily-summary composer + a reminder that opens WhatsApp pre-filled to the owner's own number.

**Approach:**
1. `useDailyDigest.ts`: build a plain-language Arabic summary for the selected day — "مبيعات: $420 | ربح: $95 | منخفض المخزون: 3 | يدين لك الزبائن: $1,200".
2. Add an owner setting: WhatsApp number + "تذكير يومي" toggle + hour.
3. When enabled, at/after the chosen hour (checked on app open; use a local notification via the SW if permission granted), show "ملخص اليوم جاهز" → tapping calls `openWhatsApp(ownerNumber, digestText)` for one-tap send.
4. Clearly label in code that automated push requires WhatsApp Business API (future).

**Acceptance Criteria:**
- [ ] Owner can enable a daily digest and set their WhatsApp number + hour.
- [ ] After the hour, opening the app surfaces a "digest ready" prompt (or a local notification if permitted).
- [ ] Tapping it opens WhatsApp pre-filled with an accurate summary of today's numbers to the owner's number.
- [ ] Numbers in the digest match the home dashboard for the same day.
- [ ] Works offline for composing; send waits for WhatsApp.

**Definition of Done:** Digest text matches a hand-check against the dashboard for a sample day. `npm run build` passes. Brother receives one prepared digest to his own WhatsApp.

---

## Task 14 — WhatsApp receipt discoverability (6) — verify + small polish

**Files:**
- Verify: `src/features/pos/SaleConfirmationScreen.vue:12,77` (`useSendReceipt` is already wired)
- Modify (if needed): `src/features/receipt/ReceiptSettingsScreen.vue` (add a "WhatsApp receipt" default toggle)

**Current state:** The WhatsApp receipt send is already wired into the confirmation screen. The epic's "WhatsApp receipt option" is largely implemented; only a settings toggle / discoverability may be missing.

**What's missing (verify):** Whether the option is discoverable and optionally default-on per receipt settings.

**Approach:** Confirm the send button is visible and labelled on the confirmation screen. If product wants it configurable, add a boolean in `receipt_settings` ("عرض إرسال الإيصال عبر واتساب") and honour it. If already sufficient, mark 6 done and record that no work was needed.

**Acceptance Criteria:**
- [ ] After a sale, the cashier can send the receipt to the customer's WhatsApp in one tap (with customer phone) — confirmed working.
- [ ] (If built) the toggle in receipt settings controls whether the WhatsApp receipt action shows.

**Definition of Done:** Manual confirmation on the confirmation screen. `npm run build` passes.

---

## Task 15 — Onboarding checklist wiring (12)

**Files:**
- Modify: `src/pages/OnboardingPage.vue` (nav items with `to: null`, lines 66-71; `router.push('/dashboard')` line 218 — note `/dashboard` is not a route, the app root is `/`)
- Reference: `src/router/index.ts` for real paths (`/`, `/pos`, `/products`, `/customers`, `/settings/staff`)
- Reference: existing composables for completion signals (product count, first sale, staff count)

**Current state:** `OnboardingPage.vue` is a 772-line skeleton: most nav items are `to: null` and the CTA pushes to a non-existent `/dashboard`. It is not wired to real routes or real completion state, and it isn't in the router.

**What's missing:** Real navigation + real "step complete" detection + a route so the flow is reachable for cold/self-serve signups (required for the Syria trip and international signups).

**Approach:**
1. Replace `to: null` with real paths (`/products/add`, `/pos`, `/settings/staff`, `/`, `/customers`).
2. Fix the CTA to `router.push('/')`.
3. Derive each checklist item's "done" state from real data (e.g. products exist → inventory step done; ≥ 1 sale → POS step done; ≥ 1 staff → team step done; shop profile set → profile step done).
4. Add an `/onboarding` route (or surface it on first run when the shop has no products/sales), permission-free so a new owner reaches it.

**Acceptance Criteria:**
- [ ] Every onboarding card navigates to the correct real screen.
- [ ] Completed steps reflect actual data (adding a product ticks the inventory step, etc.).
- [ ] The "done" CTA lands on the home dashboard.
- [ ] A brand-new owner (no products/sales) can reach and follow the flow with no help ("self-serve").

**Definition of Done:** A fresh account walks the full checklist to the dashboard without a dead link. `npm run build` passes.

---

## Verify-only — Offline shift/audit merge (5.9)

No code change planned. Audit log is DB-level append-only (`migration 018`), and shift writes are atomic (`db.writeTransaction`) syncing via PowerSync. **Action:** run one manual test — two devices offline, each opens/closes a shift and edits a product, then both sync — and confirm no lost audit entries and no shift corruption. If a real conflict surfaces, open a new ticket; do not pre-build merge logic.

---

## Self-review checklist (run before starting)

- [ ] Every PARTIAL item from the audit maps to a task above (1.2, 1.5, 2.4, 2.5, 2.6, 3.2, 3.4, 4.6, 4.8, 5.1, 5.2, 5.3, 5.9, 6, 9, 12). ✅
- [ ] Migrations needed: `028` (products.reordered_until), `029` (staff.photo_url). Apply to hosted Supabase and add to `schema.ts`.
- [ ] No task depends on the (not-yet-built) per-customer entitlement system except Task 8, which is explicitly a hardcoded stopgap with a TODO.
- [ ] The three product decisions are locked: 4.6 = PNG image, 9 = prepared one-tap digest, 2.4 = allow-negative + flag.
