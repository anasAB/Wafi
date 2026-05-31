# Epic 5 — Cashier Shifts and Identity

**Epic ID:** EPIC-05
**Pack:** Staff Pack (+$5/month)
**Depends on:** Epic 1 (sales attribution), Epic 2 (product edits to attribute), Epic 3 (expenses to attribute), Epic 4 (payments and customer edits to attribute)
**Blocks:** None within v1

---

## Epic summary

**Goal:** Owner can add employees with roles, cashiers sign in with PINs and open/close shifts, every sale is attributed, shift close shows cash variance, owner can see a full audit log of who changed what.

**Value delivered:** Owner can leave the shop and know who did what. Detects theft and errors. Makes the product sellable to anyone with employees (most reference customers beyond brother's shop).

**In scope:** Employee CRUD with hardcoded roles (Owner / Manager / Cashier), PIN authentication, shift open with cash count, sale attribution to cashier and shift, shift close with cash variance calculation, Z-report printing, shift history, append-only audit log for important changes.

**Out of scope:** Cashier commission tracking (v1.5), custom permissions framework — beyond the 3 hardcoded roles (v1.5), cryptographically tamper-evident audit log (v2), time-clock / attendance (later — not on roadmap), manager approval workflow for big changes (v1.5), multiple concurrent shifts on same device (defer — one shift per device at a time).

---

## User stories

### Story 5.1 — Add employees and assign roles

**As an** owner
**I want to** add my employees with their role and a PIN
**So that** they can sign into the POS

**Acceptance criteria:**

- **Given** I am the owner (signed in)
  **When** I navigate to "الموظفون" (Employees) in Back Office or phone
  **Then** I see a list of all employees, including myself

- **Given** I tap "إضافة موظف" (Add employee)
  **When** the form opens
  **Then** I see fields: name (required), 4-digit PIN (required), confirm PIN (required, must match), role (radio: مدير / كاشير — Owner cannot be assigned to another user), photo (optional), active toggle (default on)

- **Given** I enter a PIN
  **When** the PIN is "0000", "1234", "1111", or any obvious sequence
  **Then** a warning appears: "هذا الرمز ضعيف — أنصح بتغييره" (Weak PIN — recommend changing) — non-blocking

- **Given** PIN and confirm PIN don't match
  **When** I tap Save
  **Then** I see "الرموز غير متطابقة" and Save is blocked

- **Given** the new PIN matches an existing employee's PIN
  **When** I tap Save
  **Then** I see "هذا الرمز مستخدم لموظف آخر" — PIN must be unique among active employees

- **Given** the Staff Pack limit is 5 employees
  **When** I try to add a 6th
  **Then** I see "وصلت إلى الحد الأقصى للموظفين — قم بترقية الباقة" (You've reached the limit — upgrade pack) with a link to billing

- **Given** I save a new employee
  **When** the record commits
  **Then** the new employee appears in the list and can immediately sign in

- **Given** I view an employee in the list
  **When** I tap them
  **Then** I see their detail with: name, role, photo, active status, total shifts worked, last shift date, edit and delete buttons

- **Given** I want to deactivate an employee (e.g., they left)
  **When** I toggle Active off
  **Then** they can no longer sign in, but all their past shifts and sale attribution remain in history

- **Given** I want to delete an employee
  **When** I tap Delete
  **Then** I see: "هذا سيخفي الموظف فقط. لا يمكن حذف الموظفين بسبب سجل المبيعات." (This will only hide them — cannot fully delete due to sales history.) With Confirm/Cancel.

- **Given** I edit an employee's PIN
  **When** I save
  **Then** the change appears in the audit log (Story 5.8) but the old PIN is NOT shown anywhere (PIN values are hashed at rest, never displayed)

**Role permissions table (hardcoded in this epic):**

| Action | Owner | Manager | Cashier |
|---|---|---|---|
| Ring sales | ✓ | ✓ | ✓ |
| Open / close own shift | ✓ | ✓ | ✓ |
| View today's revenue/profit (home screen) | ✓ | ✓ | ✗ (sees only sales count, not money) |
| View other shifts | ✓ | ✓ | ✗ |
| Edit products | ✓ | ✓ | ✗ |
| Edit customers | ✓ | ✓ | ✗ |
| Record customer payments | ✓ | ✓ | ✗ |
| Log expenses | ✓ | ✓ | ✗ |
| Manage employees | ✓ | ✗ | ✗ |
| Change exchange rate | ✓ | ✓ | ✗ |
| Change shop settings | ✓ | ✗ | ✗ |
| View audit log | ✓ | ✗ | ✗ |
| Export data | ✓ | ✓ | ✗ |
| Close other people's shifts | ✓ | ✗ | ✗ |

**Permission check requirement:** All permission checks must go through a single function `canUserDo(user, action)` so the framework can be replaced in v1.5 without touching UI code. Hidden controls (vs. disabled controls) are preferred for clarity.

---

### Story 5.2 — Sign in with a 4-digit PIN

**As a** cashier
**I want to** sign in fast with a PIN
**So that** I can start working without slowing down customer flow

**Acceptance criteria:**

- **Given** the app is open and no one is signed in
  **When** I view the sign-in screen
  **Then** I see the shop name at top, then a grid of active employees as cards (photo or initials in colored circle, name underneath)

- **Given** I tap my employee card
  **When** the PIN entry opens
  **Then** I see a numeric keypad and 4 PIN dots (filling as I type)

- **Given** I enter my correct PIN
  **When** all 4 digits entered
  **Then** I am signed in and routed to: Shift Open screen if no shift active, else POS screen

- **Given** I enter an incorrect PIN
  **When** the 4th digit is entered
  **Then** the PIN dots shake briefly, an error toast shows "رمز غير صحيح", and the input clears for retry

- **Given** I enter incorrect PIN 5 times in a row
  **When** the 5th wrong attempt registers
  **Then** my account locks for 5 minutes, the screen shows a countdown timer "محاولة جديدة بعد 5:00", and a notification is sent to the owner (in-app — see Story 5.8 audit log entry)

- **Given** I am the only employee
  **When** the sign-in screen opens
  **Then** the PIN keypad appears directly without an employee card grid (skip the selection step)

- **Given** I am signed in
  **When** I tap "تسجيل خروج" (Sign out) in settings
  **Then** I am signed out and returned to the sign-in screen — any open shift is NOT auto-closed (must be closed via Story 5.5)

- **Given** I am signed in and the device is idle for 15 minutes
  **When** the timeout fires
  **Then** the app dims and requires PIN re-entry to continue (does NOT close my shift); configurable in settings (5 / 15 / 30 / 60 min / never)

---

### Story 5.3 — Open a shift with cash count

**As a** cashier
**I want to** record how much cash is in the drawer when I start
**So that** end-of-shift variance is accurate

**Acceptance criteria:**

- **Given** I have signed in and have no active shift
  **When** the Shift Open screen appears
  **Then** I see title "ابدأ وردية", two amount inputs: "نقدي ليرة" (Cash SYP) and "نقدي دولار" (Cash USD), and an "ابدأ الوردية" button

- **Given** the device shows "Last shift closed with: 142,000 SYP + 35 USD"
  **When** I view the Shift Open screen
  **Then** the previous closing amounts are shown as a hint above the inputs (helps cashier verify starting balance matches)

- **Given** I enter the cash counts
  **When** I tap "ابدأ الوردية"
  **Then** a shift record is created with: timestamp, my employee_id, opening cash SYP, opening cash USD, status = "open"

- **Given** the shift opens
  **When** I am routed forward
  **Then** I go to the POS screen with a small chip at the top: "وردية: محمد — 0 د:0 س" (Shift: Mohamed — 0h 0m) that updates over time

- **Given** I leave one or both cash fields empty
  **When** I tap Start
  **Then** I see a warning: "لم تدخل العد — هل تريد الاستمرار بـ 0؟" with Confirm/Cancel (allows skipping but flags it)

- **Given** I am offline
  **When** I open a shift
  **Then** it works locally, queues for sync, the chip shows offline status

- **Given** there is already an open shift on this device by another cashier
  **When** I try to sign in and open
  **Then** I see "وردية مفتوحة لـ[name] — يجب إغلاقها أولاً" (Shift open for [name] — must close first), with options: "أعلم لإغلاقها" (Notify them) or "إغلاق إجبارياً" (Force close — owner only) — owners can force-close; others see only "Cannot open"

---

### Story 5.4 — Sales attribute to the active cashier

**As an** owner
**I want** every sale automatically tagged with who rang it
**So that** I can attribute revenue and detect issues

**Acceptance criteria:**

- **Given** a cashier is signed in with an active shift
  **When** any sale is rung (Epic 1)
  **Then** the sale record stores: employee_id (cashier), shift_id (current shift)

- **Given** a sale is recorded
  **When** the receipt prints
  **Then** the receipt optionally shows "الكاشير: [name]" (toggleable in receipt template settings — that editor is a later epic; for this epic, the field is included by default)

- **Given** a sale is recorded with on-account or split payment
  **When** the customer's transaction history is viewed
  **Then** the cashier name appears on each transaction entry

- **Given** I view sales history (drilled from home screen, Epic 3)
  **When** I look at the list
  **Then** each sale shows the cashier name and shift identifier

- **Given** Manager or Owner role
  **When** they ring sales
  **Then** sales still attribute to them by the same employee_id field (any signed-in user attributes)

---

### Story 5.5 — Close shift with cash variance

**As a** cashier
**I want to** close my shift and see if cash matches expectations
**So that** discrepancies are caught immediately

**Acceptance criteria:**

- **Given** I am signed in with an active shift
  **When** I tap "إنهاء الوردية" (End shift) accessible from the shift chip at top or from menu
  **Then** the Close Shift screen opens

- **Given** the Close Shift screen is open
  **When** the calculations run
  **Then** I see expected cash:
  - Opening cash SYP + cash sales SYP + customer payments received in SYP - cash expenses paid in SYP - cash refunds in SYP = Expected SYP
  - Same for USD
  - All values shown clearly: "بدأت بـ 50,000 + بعت بـ 95,000 - مصاريف 3,000 = متوقع 142,000 ل.س"

- **Given** I see the expected amounts
  **When** I view the input section
  **Then** I see two number inputs: "النقد الموجود — ليرة" and "النقد الموجود — دولار" for me to enter my actual count

- **Given** I enter the counted amounts
  **When** the variance calculates
  **Then** I see for each currency:
  - If counted = expected: green "مطابق" (Match)
  - If counted < expected: red "عجز: X" (Short: X)
  - If counted > expected: yellow "زيادة: X" (Over: X)

- **Given** the variance is more than 5% of expected
  **When** I try to confirm
  **Then** I see a confirmation: "العجز أكبر من 5%. هل أنت متأكد؟" with optional note field for explanation

- **Given** I tap "تأكيد إغلاق الوردية" (Confirm close)
  **When** the action completes
  **Then** the shift record is updated with: close timestamp, closing cash counts, variance, optional note, status = "closed"

- **Given** the shift closes
  **When** the Z-report is generated (Story 5.6)
  **Then** I am offered to print it; whether printed or not, the shift is closed

- **Given** the shift is closed
  **When** I view the app
  **Then** I am signed out automatically, returned to the sign-in screen

- **Given** I am offline
  **When** I close a shift
  **Then** it works locally; Z-report prints from local data; shift closure queues for sync

- **Given** I am a cashier
  **When** I try to view another cashier's open shift
  **Then** I cannot — only my own

- **Given** I am the owner
  **When** I want to force-close someone else's shift (e.g., they forgot)
  **Then** I can from the Shifts section (Story 5.7) — the force-close is recorded in audit log

---

### Story 5.6 — Print Z-report at shift close

**As a** cashier or owner
**I want** a printed summary of my shift
**So that** I have paper proof of the day's totals

**Acceptance criteria:**

- **Given** I just closed a shift
  **When** the Z-report screen appears
  **Then** I see a preview of the report with a "طباعة" (Print) button and a "تخطي" (Skip) button

- **Given** I tap Print
  **When** the thermal printer fires
  **Then** the Z-report prints with:
  - Shop name and tax number
  - "تقرير الوردية" header
  - Cashier name
  - Shift open / close times and duration
  - Opening cash (SYP, USD)
  - Closing cash counted (SYP, USD)
  - Variance (SYP, USD)
  - Total sales count
  - Revenue breakdown by payment method (cash USD, cash SYP, card, on account, split)
  - Cash payouts during shift (expense count + total)
  - Refund count + total (Epic 7 will add returns; for now, refunds count is 0)
  - Top 5 selling products in shift
  - Customer payments received during shift (count + total)
  - Sales count by hour (mini chart in ASCII or simple table)
  - Signature line: "_________________________" for cashier signature

- **Given** the report has printed
  **When** I tap "تم" (Done)
  **Then** I am signed out and returned to sign-in

- **Given** the printer fails
  **When** I retry
  **Then** the report regenerates and prints — the report data is stored, so I can reprint later from Shifts history

- **Given** Z-reports are stored
  **When** I view a past shift
  **Then** the Z-report data is intact and can be reprinted, but the report record CANNOT be edited or deleted

---

### Story 5.7 — View shift history

**As an** owner or manager
**I want to** see all past shifts with their variances
**So that** I can spot patterns of theft or error

**Acceptance criteria:**

- **Given** I am owner or manager (signed in)
  **When** I navigate to "الورديات" (Shifts)
  **Then** I see a list of all shifts (open and closed), default sorted by most recent first

- **Given** I view the shifts list
  **When** I look at each row
  **Then** I see: cashier name, date (or "مفتوحة" if open), duration, total revenue, variance (color-coded)

- **Given** a shift has variance
  **When** I view its row
  **Then** the variance is highlighted: green (match), yellow (small <5%), red (large ≥5%)

- **Given** I can filter the list
  **When** I tap filter
  **Then** I can filter by: cashier, date range, variance status (any / match only / variance only)

- **Given** I tap a shift
  **When** the detail opens
  **Then** I see all data from the Z-report + a list of every sale during the shift (links to each sale's detail) + every expense + every customer payment + the cashier's note (if any)

- **Given** I am the owner and the shift is still open
  **When** I view its detail
  **Then** I see a "إغلاق إجبارياً" (Force close) button — using it requires entering the expected cash amounts (since the cashier never counted) and records this fact in audit log

- **Given** the shift is closed
  **When** I view its detail
  **Then** there are no edit or delete options — closed shifts are immutable

- **Given** I want to reprint a Z-report
  **When** I tap "طباعة" on a closed shift
  **Then** the same Z-report regenerates and prints

---

### Story 5.8 — Audit log of important changes

**As an** owner
**I want to** see who changed what and when, for sensitive operations
**So that** I can investigate any irregularity

**Acceptance criteria:**

- **Given** I am the owner
  **When** I navigate to "سجل التدقيق" (Audit log)
  **Then** I see a feed of all important actions, newest first

- **Given** the audit log records these actions:
  | Action | Who | Before | After |
  |---|---|---|---|
  | Product price changed | yes | old price | new price |
  | Product cost changed | yes | old cost | new cost |
  | Product deleted | yes | product name | - |
  | Manual stock adjustment | yes | old stock + reason | new stock |
  | Customer balance manually adjusted | yes | old balance | new balance + reason |
  | Expense edited | yes | old expense | new expense |
  | Expense deleted | yes | expense details | - |
  | Customer payment edited or deleted | yes | old data | new data or "deleted" |
  | Employee added / edited / deactivated | yes | old data | new data |
  | Exchange rate changed | yes | old rate | new rate |
  | Shift force-closed | yes | shift id | who forced |
  | PIN lockout occurred | yes | employee | timestamp |
  | Shop setting changed | yes | old setting | new setting |
  | Sale cancelled/voided (when this exists) | yes | sale id | reason |

- **Given** I view an entry
  **When** it shows
  **Then** I see: time (relative + exact), who, action description in Arabic, before/after values, optional reason note

- **Given** I want to search the log
  **When** I use filters
  **Then** I can filter by: user, date range, action type, entity (e.g., specific product)

- **Given** I find a specific entry
  **When** I tap it
  **Then** the linked entity opens (the product, the customer, the expense, etc.) so I can see the current state

- **Given** an audit log entry exists
  **When** anyone (including owner) tries to edit or delete it
  **Then** there is no UI to do so — entries are append-only

- **Given** I am offline
  **When** I take an auditable action
  **Then** the audit entry is created locally and queues for sync — entries cannot be deleted from the queue

- **Given** two devices both create audit entries offline
  **When** they sync
  **Then** all entries are preserved (no conflicts — each has a unique device_id + timestamp + nonce)

- **Given** the audit log has 50,000+ entries (over time)
  **When** I view or search
  **Then** results appear within 2 seconds (use indexes on user, date, entity)

**Audit entry display examples:**

- "محمد عدّل سعر منتج: شامبو دوف من 25,000 إلى 27,000 ل.س — قبل 3 ساعات"
- "أبو خالد ألغى مصروف 50,000 ل.س — اليوم 14:30"
- "تم إغلاق وردية محمد إجبارياً بواسطة العامل — أمس 22:00 — السبب: نسي الإغلاق"
- "تم قفل حساب أحمد بعد 5 محاولات خاطئة — قبل ساعتين"

---

### Story 5.9 — All shift features work offline

**As a** cashier or owner
**I want** PIN sign-in, shift open/close, Z-report, and audit log all to work offline
**So that** internet downtime doesn't stop operations or hide accountability

**Acceptance criteria:**

- **Given** the app has been opened at least once online with employees set up
  **When** I disconnect
  **Then** PIN sign-in works using locally cached employee records (PIN hashes stored locally)

- **Given** I am offline
  **When** I open a shift
  **Then** the shift starts locally, queues for sync

- **Given** I am offline
  **When** I close a shift
  **Then** the Z-report generates and prints from local data; close event queues for sync

- **Given** I am offline
  **When** any auditable action happens
  **Then** the audit entry is created and queued — guaranteed delivery on sync

- **Given** the audit log queue is large after long offline period
  **When** sync resumes
  **Then** all entries upload in order; no entry is dropped or merged

- **Given** PIN hashes are stored locally
  **When** at rest
  **Then** they are hashed (not plaintext) — best-effort security; physical device security is the primary defense (documented)

---

## Screens and states

### Screen 1: Sign-in screen (app entry point when not signed in)

**Layout (multiple employees):**
- Shop name at top
- Grid of employee cards: photo or initials circle, name underneath
- Tap to advance to PIN entry

**Layout (single employee or after card tap):**
- "أهلاً [name]" greeting
- 4 PIN dots
- Numeric keypad (full screen on phone)
- "← رجوع" to go back to card grid

**States:**
- **Default:** All active employees shown
- **PIN entry:** Selected employee at top, keypad below
- **Wrong PIN:** Dots shake, toast appears, input clears
- **Locked out:** Card grayed with countdown timer
- **No employees yet:** Owner can sign in (must exist by setup) — bootstrap state where owner adds themselves first

### Screen 2: Shift Open screen

**Layout:**
- Title: "ابدأ الوردية"
- Hint banner: "آخر إغلاق: 142,000 ل.س + 35 USD"
- Two number inputs: SYP, USD (large, focused first one)
- Big "ابدأ الوردية" button
- Cancel link (signs out)

**States:**
- **Default:** Empty inputs
- **Filled:** Start enabled
- **Confirming skip (empty inputs):** Warning dialog
- **Starting:** Button spinner
- **Other cashier's shift open:** Error message with options

### Screen 3: Active shift chip (persistent on all screens)

**Position:** Top of screen, below sync indicator.

**Layout:** Small horizontal chip with: cashier name, duration counter (updates every minute), tap to open shift detail.

**States:**
- **Active:** Visible always
- **Inactive (no shift):** Hidden
- **Approaching idle timeout:** Chip pulses or shows a warning indicator

### Screen 4: Close Shift screen

**Layout:**
- Title: "إغلاق الوردية"
- Expected cash section: SYP and USD with breakdown
- Counted cash inputs: SYP and USD
- Variance display: color-coded for each currency
- Note field (optional, required if variance > 5%)
- "تأكيد إغلاق" button

**States:**
- **Default:** Expected shown, inputs empty
- **Filled:** Variance shows
- **Large variance:** Confirmation dialog before close
- **Closing:** Button spinner
- **Closed:** Routes to Z-report screen

### Screen 5: Z-report preview / print

**Layout:**
- Preview of the printout (vertical scrollable)
- "طباعة" and "تخطي" buttons
- After print: "تم" button

**States:**
- **Preview:** Static
- **Printing:** Spinner
- **Print failed:** Error toast + retry
- **Done:** Routes to sign-in

### Screen 6: Employees list

**Layout (Back Office):**
- Table: photo | name | role | active toggle | last shift | actions
- "+ إضافة موظف" button top right

**Layout (phone):**
- Card list, FAB for add

**States:**
- **Default:** Populated
- **Empty (just owner):** Helpful message + add button
- **At limit:** Add button shows lock icon, tap shows upgrade prompt

### Screen 7: Add / Edit Employee form

**Layout:** Modal or page.

**Fields:** name, PIN, confirm PIN, role, photo, active.

**States:**
- **Default:** Empty (add) or pre-filled (edit)
- **PIN mismatch:** Inline error
- **Weak PIN warning:** Non-blocking banner
- **Duplicate PIN:** Blocking error

### Screen 8: Shifts list

**Layout:**
- Filter bar: cashier, date range, variance status
- Table or card list with: cashier, date, duration, revenue, variance (color-coded)

**Empty state:** "لا توجد ورديات بعد"

### Screen 9: Shift detail

**Layout:**
- Top: cashier, dates, duration, totals summary
- Z-report data section (collapsible)
- Sales during shift (collapsible list with link to each sale detail)
- Expenses during shift (collapsible)
- Customer payments during shift (collapsible)
- Cashier's note (if any)
- Action: Reprint Z-report; for open shift by owner: Force close

### Screen 10: Audit log

**Layout:**
- Filter bar: user, date range, action type, entity search
- Feed of entries (newest first)
- Each entry: time, who, action description, before/after summary, tap for full detail

**States:**
- **Default:** Populated
- **Filtered:** Shows filter chips, clear-filter button
- **No results:** "لا توجد سجلات تطابق البحث"

### Screen 11: PIN re-entry (idle timeout)

**Layout:**
- Dimmed background with the previous screen visible
- Centered card: photo, name, PIN keypad
- "تسجيل خروج" link to fully sign out

---

## Fields and validation

### Employee record
| Field | Type | Required | Validation |
|---|---|---|---|
| employee_id | UUID | yes | Generated locally |
| name | string | yes | Min 1, max 100 |
| pin_hash | string | yes | Bcrypt or argon2 hash of 4-digit PIN; never store plaintext |
| role | enum | yes | owner / manager / cashier |
| photo_url | string | no | Local blob or cloud URL |
| active | boolean | yes | Default true |
| created_at | timestamp | yes | |
| created_by | UUID | yes | Owner's employee_id |
| sync_status | enum | yes | |

### Shift record
| Field | Type | Required | Validation |
|---|---|---|---|
| shift_id | UUID | yes | |
| employee_id | UUID | yes | Must exist |
| device_id | UUID | yes | |
| opened_at | timestamp | yes | |
| closed_at | timestamp | no | Set on close |
| opening_cash_syp | decimal | yes | ≥ 0 |
| opening_cash_usd | decimal | yes | ≥ 0 |
| closing_cash_syp | decimal | no | Set on close |
| closing_cash_usd | decimal | no | Set on close |
| variance_syp | decimal | no | Computed at close |
| variance_usd | decimal | no | Computed at close |
| close_note | string | no | Required if variance >5% |
| force_closed_by | UUID | no | Owner's employee_id if force-closed |
| status | enum | yes | open / closed |
| z_report_data | json | no | Captured at close for reprint |
| sync_status | enum | yes | |

### Audit log entry
| Field | Type | Required | Validation |
|---|---|---|---|
| entry_id | UUID | yes | |
| device_id | UUID | yes | |
| nonce | int | yes | Local counter to prevent duplicates on retry |
| performed_at | timestamp | yes | Local device time |
| performed_by | UUID | yes | Employee ID |
| action_type | enum | yes | product_price_changed, expense_edited, etc. |
| entity_type | string | yes | "product" / "expense" / etc. |
| entity_id | UUID | yes | The thing that was changed |
| before_value | json | no | Snapshot of relevant fields |
| after_value | json | no | Snapshot after change |
| reason | string | no | Optional, captured when relevant |
| sync_status | enum | yes | |

**Append-only constraint:** Database schema should reject UPDATE or DELETE on audit log entries. UI must have no edit/delete affordances.

---

## Edge cases

1. **Owner forgets their own PIN:** No reset flow in v1. Document as known limitation; owner can be restored by direct database access (advanced support). Recommend setting up a Manager backup.

2. **Cashier signs in, takes phone home, forgets to close shift:** Owner can force-close from the Shifts section. Audit log records who forced and why. Cash variance prompts entry of expected vs counted (counted defaults to expected with a note "force-closed without count").

3. **Multiple devices, same cashier signed into both, opens shift on each:** Second device shows "you already have an active shift on another device" with options: "View on this device" (loads existing shift) or "Force-close other and start new" (closes the other, audit logged).

4. **Sale rung while cashier shift is technically expired (e.g., idle timeout fired mid-sale):** Sale completes (don't lose customer data), but next action requires PIN re-entry.

5. **Cashier's PIN is changed by owner while cashier is signed in:** Cashier stays signed in (token-based). Next sign-in uses new PIN. Audit log entry.

6. **Cash count entered as 0 at close when sales clearly happened:** Treated as 100% variance. Warning before confirming. Owner sees in shift history.

7. **Cashier deactivated mid-shift:** Their current shift remains open until they close it normally (don't kick them mid-transaction). After close, they cannot sign in.

8. **Two cashiers, same device, hand-off without closing:** Encouraged workflow: cashier A closes shift, cashier B opens. If they don't: only one shift active per device; second cashier cannot open until first closes.

9. **PIN lockout while cashier needs to work:** Owner can manually unlock from employee detail screen (audit logged). 5-minute auto-unlock also fires.

10. **Audit log entry created for an action that's then rolled back (e.g., sync conflict resolution):** Audit log records the action attempted; sync conflict resolution is a separate audit entry. Don't retroactively delete audit entries.

11. **Z-report data references a product or customer that was later deleted:** Display the captured snapshot (z_report_data is stored as JSON at close, so it's independent of current state).

12. **Manager tries to do an owner-only action (e.g., add employee):** UI hides the option entirely. If they navigate via URL or other means, they hit the canUserDo check and see a graceful "ليس لديك صلاحية" message.

13. **Concurrent shift open on same device by two cashiers in quick succession:** Lock acquisition at shift creation; second attempt sees "shift just opened by [name]".

14. **Audit log entry attempted while quota exceeded:** Block the action being audited rather than skip the audit (audit integrity > convenience). Show clear error.

15. **Cashier's phone clock is wrong:** All timestamps stored as device-local; sync layer reconciles. Variance in display only; data integrity preserved via device_id + nonce.

---

## Definition of Done

- [ ] All 9 stories pass their acceptance criteria
- [ ] Cashier can sign in and open a shift in under 30 seconds end-to-end
- [ ] Z-report prints correctly with all required sections on at least 2 printer models
- [ ] Variance calculation matches hand-check on 10 test shifts with mixed sales, refunds, expenses, customer payments
- [ ] Owner can find a specific product price change in audit log in under 1 minute (with 1,000+ log entries)
- [ ] No way through the UI to edit or delete a closed shift or any audit log entry
- [ ] All permission checks go through `canUserDo(user, action)` — no hardcoded role checks in UI components
- [ ] PIN hashes stored using bcrypt or argon2; never plaintext in storage or logs
- [ ] PIN lockout after 5 failed attempts works correctly
- [ ] Idle timeout requires PIN re-entry without closing shift
- [ ] Force-close works for owner and creates correct audit entry
- [ ] All features work fully offline; audit entries never lost during offline → online sync
- [ ] Tested with at least 2 cashiers in real use (brother's shop + one CEO contact) for 1 full week before this epic is "done"
- [ ] All edge cases handled or explicitly documented as known limitations
- [ ] Audit log queries return in <2s with 10,000+ entries
- [ ] All Arabic text uses plain language ("وردية", "عجز", "سجل التدقيق" — not technical jargon)
