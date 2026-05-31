# Epic 3 — Business Health Home Screen

**Epic ID:** EPIC-03
**Pack:** Core (basic dashboard); Reporting Pack adds advanced charts in a later epic
**Depends on:** Epic 1 (sales data), Epic 2 (cost prices for profit, product names)
**Blocks:** Epic 4 (adds "customers owe you" card to home)

---

## Epic summary

**Goal:** Owner sees revenue, expenses, profit, top sellers, and cash drawer status at a glance on the home screen, can toggle between Today / Week / Month, and can log expenses in under 30 seconds.

**Value delivered:** The home screen becomes the daily reason to open the app. Owner answers "am I making money?" in 3 seconds.

**In scope:** Home dashboard with revenue/expenses/profit cards, period toggle, expense logging with optional receipt photo, top sellers, cash drawer expected vs actual, offline support with staleness indication.

**Out of scope:** Advanced charts and graphs (Reporting Pack later epic), P&L statement view (Reporting Pack later epic), owner WhatsApp daily digest (later v1), expense approval workflow (v1.5), photo OCR (v2), custom report builder (v1.5), 30/60/90 cash flow forecast (v2), customers owe you card (Epic 4 adds this).

---

## User stories

### Story 3.1 — See today's revenue, expenses, and profit at a glance

**As an** owner
**I want to** see today's money coming in, money going out, and profit on the home screen
**So that** I know in 3 seconds if my shop is making money

**Acceptance criteria:**

- **Given** I open the app to the home screen
  **When** the screen loads
  **Then** I see three cards stacked vertically (phone) or side-by-side (tablet/desktop), in order: "المال الداخل" (Money in), "المصاريف" (Expenses), "الربح" (Profit)

- **Given** the "Money in" card displays
  **When** I view it
  **Then** I see the total revenue for today in USD (primary, large) and SYP (secondary, smaller) — this is the sum of all sale totals from Epic 1 sales rung today

- **Given** the "Expenses" card displays
  **When** I view it
  **Then** I see the total of all expenses logged today in USD (primary, large) and SYP (secondary, smaller)

- **Given** the "Profit" card displays
  **When** I view it
  **Then** the value is calculated as: today's revenue − today's cost of goods sold (sum of cost_price × quantity for each line item in today's sales) − today's expenses

- **Given** the profit value
  **When** profit is positive
  **Then** the card uses green accent color and shows "+" before the value

- **Given** the profit value
  **When** profit is negative
  **Then** the card uses red accent color and shows "-" before the value

- **Given** the profit value
  **When** profit is exactly 0 (or no activity yet)
  **Then** the card uses gray accent and shows "0"

- **Given** at least 10% of products lack a cost price
  **When** the profit card displays
  **Then** a small warning icon appears with tooltip: "12 منتج بدون سعر تكلفة — قد لا يكون الربح دقيقاً" (12 products missing cost — profit may be inaccurate). Tapping the warning opens the products list filtered to missing-cost.

- **Given** any card is displayed
  **When** I look at the bottom of each card
  **Then** I see the period label: "اليوم" (Today) in small text

- **Given** a sale is rung in Epic 1
  **When** the sale is confirmed
  **Then** the home screen cards update within 1 second if the home screen is open, or on next visit if not

- **Given** an expense is logged
  **When** the expense is saved
  **Then** the home screen cards update within 1 second if open

---

### Story 3.2 — Toggle between Today, This Week, This Month

**As an** owner
**I want to** see the same numbers for the week or month
**So that** I can compare today to my recent trend

**Acceptance criteria:**

- **Given** I am on the home screen
  **When** I view above the three cards
  **Then** I see a segmented control with three options: "اليوم" | "الأسبوع" | "الشهر"

- **Given** I tap "الأسبوع" (Week)
  **When** the toggle activates
  **Then** all three cards update to show totals for the current week (defined as starting Saturday — Syrian week convention; configurable in settings later)

- **Given** I tap "الشهر" (Month)
  **When** the toggle activates
  **Then** all three cards update to show totals for the current month (calendar month: 1st to today)

- **Given** I tap a tab
  **When** the values change
  **Then** the change animates briefly (number rolls up/down over ~400ms)

- **Given** I close and reopen the app
  **When** I return to the home screen before noon
  **Then** the default selection is "اليوم"

- **Given** I close and reopen the app
  **When** I return to the home screen at or after noon
  **Then** the default selection is "اليوم" (always default to Today; "after noon defaults to Week" was reconsidered — keep simple: always Today)

- **Given** the period selection is "Week"
  **When** I view the card labels
  **Then** the small text at the bottom of each card reads "الأسبوع" (Week)

---

### Story 3.3 — Drill into any card for details

**As an** owner
**I want to** tap a card and see what makes up that number
**So that** I can investigate anything suspicious

**Acceptance criteria:**

- **Given** the home screen is displayed
  **When** I tap the "Money in" card
  **Then** a list view opens showing every sale in the current period, sorted newest first

- **Given** I am viewing the sales list
  **When** I look at each row
  **Then** I see: timestamp (relative: "قبل 5 دقائق" or absolute for older), item count, total USD and SYP, payment method icon

- **Given** I tap a sale in the list
  **When** the detail opens
  **Then** I see: all line items, totals, payment method, change due, cashier name (after Epic 5; "غير محدد" before), reprint receipt button

- **Given** I tap the "Expenses" card
  **When** the list opens
  **Then** I see every expense in the period: amount, category, date, optional photo thumbnail, optional notes

- **Given** I tap an expense
  **When** detail opens
  **Then** I see full details with the photo enlarged, and edit/delete buttons (Edit blocked if expense is from a closed shift in Epic 5)

- **Given** I tap the "Profit" card
  **When** the breakdown opens
  **Then** I see a simple plain-language breakdown:
  - "إجمالي البيع: 1,200 USD" (Total sales)
  - "تكلفة البضاعة المباعة: −700 USD" (Cost of goods sold)
  - "ربح إجمالي: 500 USD" (Gross profit)
  - "المصاريف: −150 USD" (Expenses)
  - "صافي الربح: 350 USD" (Net profit)

- **Given** any drill-down list opens
  **When** I view the top
  **Then** I see a back button and the same period toggle (Today / Week / Month) — changing period here changes the parent home screen too

---

### Story 3.4 — Log an expense in under 30 seconds

**As an** owner
**I want to** quickly record an expense with optional receipt photo
**So that** my profit number is accurate

**Acceptance criteria:**

- **Given** I am on the home screen
  **When** I view the screen
  **Then** I see a prominent "إضافة مصروف" (Add expense) button, visible above the fold

- **Given** I tap "Add expense"
  **When** the expense form opens
  **Then** I see fields in this order: amount (numeric input, focused), currency toggle (USD / SYP), category (chip selector + custom), date (defaults today), notes (optional textarea), photo (optional)

- **Given** the amount field is focused
  **When** the form opens
  **Then** a numeric keypad appears immediately (phone) so I can type without an extra tap

- **Given** I select currency SYP
  **When** I enter a value
  **Then** below the amount input I see "≈ X USD" using the current exchange rate

- **Given** I select category
  **When** I view the chip selector
  **Then** I see common categories pre-defined as chips: "إيجار" (Rent), "كهرباء" (Electricity), "رواتب" (Salaries), "بضاعة" (Inventory purchase), "صيانة" (Maintenance), "أخرى" (Other)

- **Given** I tap "Other"
  **When** the input changes
  **Then** a text field appears for custom category — saved categories are remembered and shown as chips on future expenses

- **Given** the date defaults to today
  **When** I tap the date
  **Then** a date picker allows backdating up to 30 days; future dates are blocked

- **Given** I tap "Add photo"
  **When** the picker opens
  **Then** I can choose Camera or Gallery; photo is compressed to max 500KB and stored as proof

- **Given** I complete the form with required fields (amount, category)
  **When** I tap "حفظ" (Save)
  **Then** the expense is saved, the form closes, the home screen cards update within 1 second, and a success toast appears

- **Given** I tap "Save and add another"
  **When** the expense saves
  **Then** the form resets to empty (date stays as today) for fast entry of multiple expenses

- **Given** I leave the amount empty or 0
  **When** I tap Save
  **Then** I see "أدخل المبلغ" and Save is blocked

- **Given** I am offline
  **When** I log an expense
  **Then** it saves locally, queues for sync, and immediately affects local home screen cards

---

### Story 3.5 — See top 5 selling products

**As an** owner
**I want to** see what's selling best
**So that** I know what to restock and feature

**Acceptance criteria:**

- **Given** the home screen is displayed
  **When** I scroll below the three main cards
  **Then** I see a card titled "الأكثر مبيعاً" (Best sellers)

- **Given** the best sellers card displays
  **When** I view it
  **Then** I see up to 5 products with: rank number, product name (AR), units sold in period, revenue contribution in USD

- **Given** the period toggle changes
  **When** "Week" is selected
  **Then** the best sellers list updates to reflect the week's sales

- **Given** there are no sales in the period
  **When** the card displays
  **Then** I see "لا توجد مبيعات في هذه الفترة" (No sales in this period) with a friendly icon

- **Given** there are fewer than 5 distinct products sold
  **When** the card displays
  **Then** I see only the products that sold (e.g., 2 items if only 2 products sold)

- **Given** I tap a product in the best sellers card
  **When** the detail opens
  **Then** I navigate to that product's page in the products section

---

### Story 3.6 — See cash in drawer indicator

**As an** owner
**I want to** know how much cash should be in the drawer right now
**So that** I can spot discrepancies early

**Acceptance criteria:**

- **Given** the home screen is displayed
  **When** I view below the best sellers card
  **Then** I see a small status row: "النقد المتوقع في الدرج: 142,000 ل.س + 35 USD"

- **Given** the cash drawer indicator displays
  **When** the values are calculated
  **Then** they reflect: sum of all cash sales (by currency) − cash payouts (expenses paid in cash) since last shift open (or app start if no shifts in this epic — proper shift handling is Epic 5)

- **Given** there is no shift system yet (this epic ships before Epic 5)
  **When** the indicator displays
  **Then** the "since" point is the start of the current calendar day (resets at the configured day-start, default 6 AM)

- **Given** I tap the indicator
  **When** the detail opens
  **Then** I see a breakdown of cash movements: each cash sale and each cash expense with timestamps, summing to the expected total

- **Given** the day starts (rolls over at the day-start time)
  **When** the indicator resets
  **Then** the previous day's expected cash is stored in history (for reference) and today's starts at 0

---

### Story 3.7 — Dashboard works offline with staleness indication

**As an** owner
**I want to** see my numbers even when offline
**So that** I'm not blocked by network issues

**Acceptance criteria:**

- **Given** I am offline
  **When** I open the home screen
  **Then** all cards display values computed from local cached data

- **Given** I am offline and the last sync was >30 minutes ago
  **When** I view the home screen
  **Then** I see a small banner below the period toggle: "آخر تحديث منذ 35 دقيقة" (Updated 35 minutes ago)

- **Given** I am offline and the last sync was <30 minutes ago
  **When** I view the home screen
  **Then** no staleness banner appears (data is considered fresh enough)

- **Given** I am offline
  **When** I log an expense or a sale completes
  **Then** the home screen cards reflect the new value immediately (optimistic local update)

- **Given** I come back online and sync completes
  **When** the staleness banner is showing
  **Then** the banner disappears with a brief check animation

- **Given** I have a slow phone with many cached sales
  **When** the home screen opens
  **Then** numbers appear within 1 second (use pre-aggregated daily/weekly/monthly totals stored locally, not full recompute)

---

## Screens and states

### Screen 1: Home screen (with full dashboard, this epic's primary deliverable)

**Layout (phone, top to bottom):**
1. App header: sync indicator (left), exchange rate widget (right) — from Epic 1
2. Greeting: "أهلاً" + today's date in Arabic
3. Staleness banner (only if applicable)
4. Period toggle: اليوم | الأسبوع | الشهر
5. Three stacked cards: Money in, Expenses, Profit
6. "Add expense" button (prominent — could be inline button below cards or FAB)
7. Best sellers card
8. Cash drawer indicator (small row)
9. "New Sale" button — always reachable at bottom or FAB

**Layout (tablet/desktop):**
- Cards 5 displayed side-by-side (3 columns)
- Best sellers card below them, full width
- Sidebar nav with links to Products, Sales History, etc.

**States:**
- **Default (data present):** All elements visible with values
- **First-time (no sales):** Cards show "0" with friendly empty-state messaging, best sellers shows "ابدأ ببيعك الأول"
- **Offline fresh (<30 min):** Sync indicator red, no staleness banner
- **Offline stale (>30 min):** Sync indicator red, staleness banner visible
- **Updating (after sync or sale):** Number rolls/animates briefly
- **Missing cost data:** Profit card shows warning icon

### Screen 2: Drill-down list (sales / expenses)

**Layout:** Standard list view with back button.

**Top:** Title (e.g., "مبيعات اليوم"), period toggle (carries over from home), total displayed prominently.

**List:** Cards/rows for each item with key details and tap-to-detail.

**Pull to refresh** for manual sync.

**Empty state:** "لا توجد بيانات في هذه الفترة"

### Screen 3: Sale detail (drilled from Money in)

**Layout:** Sale summary + line items + payment + reprint button.

(Detailed UX defined in Epic 1's reprint flow; this epic just exposes the entry point.)

### Screen 4: Expense detail

**Layout:**
- Amount (large)
- Category
- Date and time
- Notes
- Photo (tappable to fullscreen)
- Edit / Delete buttons

**States:**
- **Default:** All fields populated
- **No photo:** Photo section hidden
- **Locked (shift closed in Epic 5):** Edit/Delete disabled with explanation

### Screen 5: Profit breakdown

**Layout:** Vertical list of line items with values aligned right (left in RTL).

**Each row:** Label + value, with signs (+/−) shown.

**Final row:** "صافي الربح" emphasized.

### Screen 6: Add Expense form

**Layout:** Modal slide-up covering most of screen on phone, side panel on tablet.

**Fields top to bottom:**
1. Amount (large input, focused on open)
2. Currency toggle USD/SYP
3. Approximate conversion display (only if SYP selected)
4. Category chip selector
5. Date picker (defaults today)
6. Notes (optional)
7. Photo button + thumbnail when added

**Buttons:** Save, Save & Add Another, Cancel.

**States:**
- **Default:** Empty form
- **Validation error:** Amount field red border + error message
- **Photo loading:** Thumbnail with spinner
- **Saving:** All disabled, save button spinner

### Screen 7: Cash drawer detail

**Layout:** Chronological list of cash movements today, summed at top.

**Each row:** Time, type (sale / expense), amount, optional note.

**Top summary:** Expected total split by currency.

---

## Fields and validation

### Expense record
| Field | Type | Required | Validation |
|---|---|---|---|
| expense_id | UUID | yes | Generated locally |
| amount | decimal | yes | > 0 |
| currency | enum | yes | USD or SYP |
| amount_usd | decimal | yes | If SYP, computed at exchange rate at time of save |
| category | string | yes | Predefined enum value or custom string |
| custom_category | string | no | Required if category = "other" |
| date | date | yes | Not in future, not >30 days ago |
| notes | string | no | Max 500 chars |
| photo_url | string | no | Local blob or cloud URL |
| paid_in_cash | boolean | yes | True if cash payment (affects cash drawer indicator); default true |
| created_at | timestamp | yes | |
| created_by | string | yes | "owner" placeholder until Epic 5 |
| sync_status | enum | yes | pending/syncing/synced/error |

### Aggregated daily totals (cached locally for performance)
| Field | Type |
|---|---|
| date | date |
| total_revenue_usd | decimal |
| total_cost_of_goods_sold_usd | decimal |
| total_expenses_usd | decimal |
| sale_count | integer |
| last_recalculated_at | timestamp |

---

## Edge cases

1. **Sale after midnight, before configured "business day start" (e.g., 6 AM):** Belongs to previous business day. So "today" cards on home screen show the previous calendar day's data until the day-start time passes.

2. **Owner doesn't set cost prices for some products:** Those products contribute 0 to COGS, inflating gross profit. Mitigate with the warning icon (Story 3.1).

3. **Negative profit displayed:** Use red color but never alarmist. The number itself is enough.

4. **Sale with on-account payment (Epic 4):** Counts as revenue when rung (not when paid). Document this clearly; the home screen "Money in" card is sales revenue, not cash collected.

5. **Receipt photo for expense over 5MB:** Compress before storing; if browser cannot compress, fail with clear error.

6. **Period toggle when there's no data:** All cards show 0 with appropriate currency formatting. Best sellers shows empty state.

7. **Time zone change on device:** All timestamps are UTC at storage, displayed in device local time. Home screen "today" rolls over based on device time.

8. **Daylight saving (rare in Syria but possible regionally):** Use stable local date boundaries, not exact 24-hour windows.

9. **Same expense logged twice by mistake:** No automatic dedup. User can delete the duplicate from the expense detail screen.

10. **Best sellers tie:** Sort by units sold first, revenue second, then product name alphabetically.

11. **5,000 sales in a month, recalculating on every screen open:** Use pre-aggregated daily totals; recompute only the current day's running totals.

12. **User changes a product's cost price after sales were made:** Past sales keep their historical cost (Epic 2 requirement). Past profit numbers remain stable.

13. **User edits an old expense:** Profit recalculates for that day. Show this in audit log (Epic 5).

14. **User deletes an old expense:** Same as edit — recalculate that day. Audit log entry.

15. **Cash drawer indicator with 0 cash activity:** Shows "0" not hidden — owner needs to see "nothing in drawer".

16. **Multiple devices, both contributing sales and expenses:** Numbers reflect all synced data. Local optimistic updates merge correctly via sync layer.

---

## Definition of Done

- [ ] All 7 stories pass their acceptance criteria
- [ ] Owner can see today's profit at a glance in under 3 seconds of opening the app
- [ ] All three cards update in real time (within 1 second) when a sale is rung or expense logged
- [ ] Owner can log a typical expense in under 30 seconds, measured end-to-end
- [ ] Profit calculation matches a hand calculation for a sample day with 20 sales and 5 expenses
- [ ] Home screen loads in <1 second on cheap Android phone with 1,000+ cached sales
- [ ] Best sellers correctly reflects period changes
- [ ] Cash drawer indicator reflects all cash movements accurately for current day
- [ ] Works fully offline with cached data
- [ ] Staleness banner appears/disappears at correct thresholds
- [ ] All Arabic text uses plain language (no "revenue," "expenditures," "AR" — use "المال الداخل", "المصاريف", etc.)
- [ ] Brother checks the home screen at least once daily for 2 weeks before this epic is "done"
- [ ] All edge cases above either handled or explicitly documented as known limitations
- [ ] No console errors during normal flows
- [ ] Tested on phone, tablet, desktop, online and offline
