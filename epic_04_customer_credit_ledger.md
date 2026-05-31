# Epic 4 — Customer Credit Ledger

**Epic ID:** EPIC-04
**Pack:** Customer Pack (+$5/month)
**Depends on:** Epic 1 (sales and payment flow), Epic 2 (product data), Epic 3 (home screen receives "customers owe you" card)
**Blocks:** None (Epic 5 is independent)

---

## Epic summary

**Goal:** Owner can add customers, ring sales on account, record payments, see who owes what, and send monthly statements via WhatsApp in one tap.

**Value delivered:** Replaces the paper notebook every Syrian shop uses for credit customers. Once the brother's customers' balances are in here, switching back to paper is impossible.

**In scope:** Customer CRUD, "on account" payment method, split payment (cash + on-account), customer running balance, payment recording, WhatsApp statement generation and send, "customers owe you" card on home screen, offline support.

**Out of scope:** Credit limits per customer (v1.5), AR aging breakdown 30/60/90 days (v1.5), payment confirmation link sent to customer after they pay (later v1), customer-side portal (not building — WhatsApp is the portal), email statements (not building — Syrian shops use WhatsApp), loyalty/points (v1.5), customer-specific pricing (year 3-4, wholesale).

---

## User stories

### Story 4.1 — Add a customer

**As an** owner
**I want to** add a customer with their name and phone number
**So that** I can track what they owe me

**Acceptance criteria:**

- **Given** I am in the Customers section (Back Office or phone)
  **When** I tap "إضافة زبون" (Add customer)
  **Then** the add customer form opens

- **Given** the add customer form is open
  **When** I view the fields
  **Then** I see: name (Arabic, required), phone number (optional but flagged as recommended), notes (free text, optional)

- **Given** I enter a phone number
  **When** I save
  **Then** the number is stored in international format (e.g., +963 9XX XXX XXX), with automatic prefix +963 added if I entered a local format (starting with 09)

- **Given** I tap a "+ زبون جديد" button in the POS payment flow (Story 4.2)
  **When** the quick-add modal opens
  **Then** the same form fields appear with a "Save and use" button that creates the customer and selects them immediately

- **Given** I leave the name empty
  **When** I tap Save
  **Then** I see "اسم الزبون مطلوب" and Save is blocked

- **Given** I save without a phone number
  **When** the customer is created
  **Then** a small warning appears: "بدون رقم هاتف، لن تتمكن من إرسال كشف الحساب عبر واتساب" (Without a phone, you cannot send WhatsApp statements) — non-blocking, can save anyway

- **Given** I enter a phone number that already exists on another customer
  **When** I tap Save
  **Then** I see "هذا الرقم مستخدم لزبون آخر: [name]" with a button to view that customer

---

### Story 4.2 — Ring a sale "on account"

**As a** cashier
**I want to** charge a customer's account instead of taking cash
**So that** trusted customers can pay later

**Acceptance criteria:**

- **Given** the sale has 1+ items and I am on the payment screen (Epic 1)
  **When** I view the payment methods
  **Then** I see a new option: "على الحساب" (On account) alongside the existing Cash USD, Cash SYP, Card buttons

- **Given** I tap "On account"
  **When** the customer selector opens
  **Then** I see a search bar at the top, recent customers below (last 5 used), and a "+ زبون جديد" button

- **Given** I search for a customer name
  **When** I type
  **Then** matching customers appear in real time (Arabic diacritic normalization applies, same as products)

- **Given** I also search by phone number
  **When** I type digits
  **Then** matching customers by phone appear

- **Given** I tap a customer
  **When** they are selected
  **Then** I return to the payment screen showing: "البيع على حساب: أبو محمد. الرصيد الحالي: 270,000 ل.س. سيصبح: 320,000 ل.س"

- **Given** I confirm an on-account sale
  **When** the sale completes
  **Then** the customer's balance increases by the sale total, the sale is recorded with payment_method = "on_account", and the customer's name appears on the receipt

- **Given** the receipt prints
  **When** the sale was on account
  **Then** the receipt shows "الدفع: على الحساب" and a new line: "الرصيد الجديد: X" + customer name

---

### Story 4.3 — Split payment (cash + on account)

**As a** cashier
**I want to** accept partial cash and put the rest on account
**So that** I can handle customers paying part now and part later

**Acceptance criteria:**

- **Given** I am on the payment screen with a sale total of 100,000 SYP
  **When** I tap any payment method (e.g., Cash SYP)
  **Then** I see a "+ طريقة دفع أخرى" (Add another method) link below the amount input

- **Given** I tap "Add another method"
  **When** the next method selector opens
  **Then** I see the same method options minus the one already selected (or with already-allocated amounts marked)

- **Given** I have allocated 60,000 SYP cash
  **When** I add "On account" and select a customer
  **Then** the on-account amount auto-fills with the remaining 40,000 SYP (editable)

- **Given** I have allocated multiple methods
  **When** I view the payment screen
  **Then** I see a list of allocations: "Cash SYP: 60,000 | On account (أبو محمد): 40,000 | Total: 100,000"

- **Given** my allocations don't sum to the total
  **When** I try to confirm
  **Then** I see "المبلغ المخصص لا يساوي الإجمالي" with the shortfall/overflow shown

- **Given** I confirm a split payment
  **When** the sale completes
  **Then** each method records correctly: cash drawer increases by 60,000, customer's balance increases by 40,000, sale record stores both allocations

- **Given** the receipt prints for a split payment
  **When** I view the receipt
  **Then** the payment section shows each allocation on its own line, then total paid

---

### Story 4.4 — See all customers and their balances

**As an** owner
**I want to** see every customer and how much they owe me
**So that** I know who to call about overdue payments

**Acceptance criteria:**

- **Given** I navigate to the Customers section
  **When** the list loads
  **Then** I see all customers, default sorted by balance descending (who owes most first)

- **Given** I view the customers list
  **When** I look at each row (phone) or column (desktop)
  **Then** I see: name, phone number with WhatsApp icon, current balance (in USD primary, SYP secondary), last activity date (relative or absolute)

- **Given** a customer has a positive balance (owes the shop)
  **When** I view their row
  **Then** the balance is shown in red

- **Given** a customer has a zero balance
  **When** I view their row
  **Then** the balance is shown in gray

- **Given** a customer has a negative balance (overpaid / credit)
  **When** I view their row
  **Then** the balance is shown in green with a "+" prefix

- **Given** I tap the sort dropdown
  **When** I select an alternative sort
  **Then** I can sort by: name (A-Z), balance (high to low), last activity (recent first)

- **Given** I have many customers
  **When** I search
  **Then** name and phone number both match (real-time filter)

- **Given** I tap a customer's WhatsApp icon directly from the list
  **When** WhatsApp opens
  **Then** it pre-fills a chat with that customer's phone (does not auto-send anything)

---

### Story 4.5 — View a customer's full history

**As an** owner
**I want to** see every sale and payment for one customer chronologically
**So that** I can answer questions about their account

**Acceptance criteria:**

- **Given** I tap a customer in the list
  **When** their detail screen opens
  **Then** I see at the top: name (large), phone (tappable to call/WhatsApp), current balance (large, color-coded), notes (if any)

- **Given** the customer detail is open
  **When** I scroll
  **Then** I see a chronological history (newest first) of every transaction: on-account sales and payments

- **Given** I view a transaction row
  **When** it is a sale
  **Then** I see: date/time, sale icon, item summary ("3 منتجات"), amount, running balance after this transaction

- **Given** I view a transaction row
  **When** it is a payment
  **Then** I see: date/time, payment icon, amount, payment method, running balance after this transaction, optional note

- **Given** I tap a sale row
  **When** detail opens
  **Then** I see full sale details (line items, receipt reprint button)

- **Given** I tap a payment row
  **When** detail opens
  **Then** I see full payment details (amount, currency, method, note, who recorded it) with an "تعديل" (Edit) button — edits go to audit log (Epic 5)

- **Given** the customer detail is open
  **When** I view the action buttons
  **Then** I see two prominent buttons side-by-side: "تسجيل دفعة" (Record payment) and "إرسال كشف الحساب" (Send statement)

---

### Story 4.6 — Record a customer payment

**As an** owner
**I want to** record when a customer pays me toward their balance
**So that** their balance updates and I have a record

**Acceptance criteria:**

- **Given** I am on a customer's detail screen
  **When** I tap "تسجيل دفعة" (Record payment)
  **Then** the payment form opens

- **Given** the payment form is open
  **When** I view the fields
  **Then** I see: amount (numeric input, focused), currency toggle (USD / SYP), method (radio: Cash USD, Cash SYP, Bank wire, USDT, Hawala), date (defaults to today), optional note

- **Given** I enter an amount in SYP
  **When** I save
  **Then** the amount is converted to USD at the current exchange rate for balance accounting (balance is always tracked in USD internally; displayed in both)

- **Given** I select method "USDT" or "Bank wire" or "Hawala"
  **When** I save
  **Then** the payment is recorded but does NOT affect the cash drawer indicator (only Cash USD / Cash SYP do)

- **Given** I select method "Cash USD" or "Cash SYP"
  **When** I save
  **Then** the cash drawer indicator (Epic 3) reflects this incoming cash

- **Given** I save the payment
  **When** the record commits
  **Then** the customer's balance decreases by the payment amount, a transaction entry appears in their history, a success toast shows

- **Given** I enter an amount larger than the customer's current balance
  **When** I try to save
  **Then** I see a warning: "المبلغ أكبر من الرصيد. سيصبح للزبون رصيد دائن 30,000. هل أنت متأكد؟" with Yes/No (allows overpayment but confirms)

- **Given** I leave the amount empty
  **When** I tap Save
  **Then** I see "أدخل المبلغ" and Save is blocked

- **Given** I am offline
  **When** I record a payment
  **Then** it saves locally, queues for sync, balance updates immediately in the UI with a small "pending sync" badge on this transaction

---

### Story 4.7 — Send monthly statement via WhatsApp

**As an** owner
**I want to** send a customer their statement with one tap
**So that** they can see what they owe without me having to write it out

**Acceptance criteria:**

- **Given** I am on a customer's detail screen
  **When** I tap "إرسال كشف الحساب" (Send statement)
  **Then** the statement preview modal opens

- **Given** the statement preview is showing
  **When** I view it
  **Then** I see:
  - Period selector (default: current month; options: current month, previous month, custom date range)
  - PDF preview thumbnail of the statement
  - The WhatsApp message text that will be sent (editable)
  - "إرسال" (Send) button

- **Given** the customer has no phone number
  **When** I view the preview
  **Then** the Send button is disabled with helper text: "أضف رقم الهاتف أولاً" (Add phone first) and a link to edit the customer

- **Given** the PDF is being generated
  **When** I view the modal
  **Then** I see a loading state with "جاري إنشاء الكشف…"

- **Given** the PDF is generated
  **When** I view it
  **Then** the PDF includes:
  - Shop letterhead from settings (shop name, address, phone, tax number, logo)
  - "كشف حساب" title
  - Customer name and phone
  - Statement period dates
  - Table of transactions in period: date, description, amount, running balance
  - Total owing at end of statement (large, prominent)
  - Footer: "للاستفسار: [shop phone]"

- **Given** the default WhatsApp message is pre-filled
  **When** I view it
  **Then** it reads: "السلام عليكم [name]، هذا كشف حسابكم لـ[month/year]. الرصيد الحالي: [balance]. شكراً لتعاملكم معنا — [shop name]"

- **Given** I tap "إرسال"
  **When** the integration triggers
  **Then** WhatsApp opens (web or app, whichever is installed) with the customer's number, the message pre-filled, AND the PDF attached (where platform supports it)

- **Given** the platform doesn't support pre-attached PDFs (some iOS variants)
  **When** WhatsApp opens
  **Then** the PDF is offered as a Share-Sheet handoff so user can attach it manually in one tap; the modal shows brief instructions

- **Given** I edit the WhatsApp message before sending
  **When** I tap Send
  **Then** my edited message is what's pre-filled in WhatsApp

- **Given** I send the statement
  **When** WhatsApp launches successfully
  **Then** in the customer's history a new entry appears: "تم إرسال كشف الحساب — [date]" (this is informational; we don't know if customer actually received it)

- **Given** I select "Custom date range"
  **When** the date pickers appear
  **Then** I can pick any start and end date; the PDF reflects only transactions in that range

---

### Story 4.8 — Home screen shows "customers owe you" card

**As an** owner
**I want to** see total outstanding credit on my home screen
**So that** I know how much money is "out there" daily

**Acceptance criteria:**

- **Given** the home screen is displayed (Epic 3)
  **When** I view it
  **Then** I see a card: "يدين لك الزبائن" (Customers owe you) with the total amount across all customers in USD (primary) and SYP (secondary)

- **Given** the card displays
  **When** I tap it
  **Then** I navigate to the Customers list (sorted by balance high-to-low by default)

- **Given** all balances are zero
  **When** the card displays
  **Then** I see "0" with helper text: "لا يوجد ديون حالياً"

- **Given** there are net credits (some customers overpaid)
  **When** the card displays
  **Then** the value shown is the net positive owing (negative balances subtract from the total). Tooltip explains.

- **Given** a sale is rung on account or a payment is recorded
  **When** the action completes
  **Then** the home screen card updates within 1 second if open

---

### Story 4.9 — Customer credit works fully offline

**As a** cashier or owner
**I want** all customer features to work without internet
**So that** sales and payments don't depend on connectivity

**Acceptance criteria:**

- **Given** I have opened the app at least once online
  **When** I disconnect from network
  **Then** the full customer list and balances are available

- **Given** I am offline
  **When** I ring a sale on account
  **Then** the customer's balance updates locally; sale and balance change queue for sync

- **Given** I am offline
  **When** I record a payment
  **Then** balance updates locally; payment queues for sync

- **Given** I am offline
  **When** I generate a statement PDF
  **Then** the PDF generates locally from cached data — no server roundtrip needed

- **Given** I am offline
  **When** I tap "Send statement via WhatsApp"
  **Then** WhatsApp opens with message and PDF; the PDF transfer happens via local OS share, not internet (works offline)

- **Given** two devices are both offline and both record payments for the same customer
  **When** they sync
  **Then** both payments apply (additive); balance reflects both correctly

- **Given** two devices are offline, one rings a sale on account, the other records a payment for the same customer
  **When** they sync
  **Then** both apply correctly to the balance; no conflict

---

## Screens and states

### Screen 1: Customers list

**Layout (phone):**
- Top: search bar, sort dropdown, "+ زبون جديد" button (or FAB)
- List of customer cards (one per row)
- Each card: name (large), phone (with WhatsApp icon, tappable), balance (right-aligned, color-coded), last activity (small, gray)
- Pull to refresh

**Layout (desktop):** Table with columns: Name | Phone | Balance | Last Activity | Actions (View / WhatsApp icons)

**States:**
- **Default:** Populated list
- **Empty:** "لم تضف زبائن بعد" with big "+ زبون جديد" button
- **Search active:** Real-time filter
- **All zero balances:** Show all customers but balances are gray
- **Loading:** Skeleton rows

### Screen 2: Customer detail

**Layout:**
- Top section: name (large), phone (with call and WhatsApp icons), balance (huge, color-coded), notes
- Action buttons row: "تسجيل دفعة" | "إرسال كشف الحساب"
- Transaction history below (chronological, newest first)

**States:**
- **Default:** All info visible
- **No phone:** WhatsApp icon disabled, statement button disabled with helper text
- **Zero balance:** Balance shown in gray, "أرصدة سابقة" available to expand
- **Has pending sync items:** Small "pending sync" indicators on those transactions

### Screen 3: Add/Edit Customer form

**Layout:** Modal or full screen.

**Fields:** Name (focused on open), phone, notes.

**Footer:** Save / Save & Use (if from POS flow) / Cancel.

**States:**
- **Default:** Empty form
- **Validation error:** Inline messages
- **Duplicate phone:** Warning with link to existing customer

### Screen 4: Payment flow with "On account"

**Reuses** Epic 1's payment screen with the new "On account" option added.

**Customer selector modal:**
- Search bar at top
- Recent customers (last 5 used in any sale)
- All customers list (alphabetical)
- "+ زبون جديد" button at bottom

**States:**
- **No customers yet:** Just shows the "+ زبون جديد" button with helpful message

### Screen 5: Split payment view

**Reuses** Epic 1's payment screen, augmented:
- After first method selected, "+ Add another method" link
- Allocation list grows
- Total shows total allocated vs sale total
- Confirm enables only when allocations sum to total

### Screen 6: Record payment form

**Layout:** Modal slide-up.

**Fields:** Amount (focused), currency toggle, method (radio buttons), date picker, optional note.

**Footer:** Save / Cancel.

**States:**
- **Default:** Empty form
- **Overpayment warning:** Banner above Save when amount > balance
- **Saving:** Disabled, spinner

### Screen 7: Statement preview modal

**Layout:**
- Title: "كشف حساب — [customer name]"
- Period selector (segmented control + custom range option)
- PDF preview thumbnail (tap to fullscreen)
- Editable message box (textarea, pre-filled with template)
- Send and Cancel buttons

**States:**
- **Generating PDF:** Loading spinner
- **PDF ready:** Preview thumbnail tappable, Send enabled
- **No phone:** Send disabled with helper
- **Sending:** Brief loading state while WhatsApp launch happens

### Screen 8: Customers Owe You card (on home screen)

Already covered in Epic 3's screens. Adds:
- Card with total amount, color-coded red if > 0
- Tap navigates to customers list

---

## Fields and validation

### Customer record
| Field | Type | Required | Validation |
|---|---|---|---|
| customer_id | UUID | yes | Generated locally |
| name | string | yes | Min 1, max 200 |
| phone | string | no | International format if present; max 20 |
| notes | string | no | Max 1000 |
| created_at | timestamp | yes | |
| updated_at | timestamp | yes | |
| deleted | boolean | yes | Soft delete |
| sync_status | enum | yes | |

### Customer transaction (sale or payment)
| Field | Type | Required | Validation |
|---|---|---|---|
| transaction_id | UUID | yes | |
| customer_id | UUID | yes | Must exist |
| type | enum | yes | "sale_on_account" or "payment" |
| sale_id | UUID | yes (if sale) | Links to Epic 1 sale record |
| amount_usd | decimal | yes | > 0 |
| amount_syp | decimal | no | Set if SYP currency |
| currency_at_entry | enum | yes | USD or SYP |
| exchange_rate_at_entry | decimal | yes | > 0 |
| method | enum | yes (payment) | cash_usd / cash_syp / bank_wire / usdt / hawala / on_account (sale type) |
| running_balance_after | decimal | yes | Computed at insertion |
| note | string | no | Max 500 |
| created_at | timestamp | yes | |
| created_by | string | yes | |
| sync_status | enum | yes | |

### Statement record (when sent via WhatsApp)
| Field | Type | Required | Validation |
|---|---|---|---|
| statement_id | UUID | yes | |
| customer_id | UUID | yes | |
| period_start | date | yes | |
| period_end | date | yes | |
| sent_at | timestamp | yes | |
| balance_at_send | decimal | yes | |

---

## Edge cases

1. **Customer with no phone number tries to receive statement:** Send button disabled with clear helper text.

2. **WhatsApp not installed on device:** Use `wa.me` web link as fallback; PDF must be attached manually. Show one-line instruction.

3. **Customer phone in non-standard format:** Normalize aggressively: strip spaces, dashes, parentheses; add +963 if local format; validate to E.164 best-effort.

4. **Duplicate phone numbers across customers:** Warn at create, but allow override (a phone might be shared by family running multiple accounts).

5. **Customer balance goes negative (overpaid):** Show in green with explicit "+ X رصيد دائن" labeling. Owner can either refund or apply to future sales.

6. **Sale on account when product has stock 0:** Inherits Epic 2 behavior — sale completes, stock goes negative.

7. **Mid-sale, customer is removed by another device:** Block confirmation with error "تم حذف هذا الزبون من جهاز آخر"; require selecting another customer.

8. **Recording a payment with date in the past:** Allowed up to 30 days back. Balance recalculates correctly.

9. **Editing a payment from a closed shift (Epic 5):** Block editing; require unlocking shift (which Epic 5 does not allow). Show clear explanation.

10. **Customer with 500+ transactions in history:** Paginate (50 per page); recent always visible without scroll.

11. **Statement period with no transactions:** PDF shows the period with "لا توجد معاملات في هذه الفترة" and the carried-forward balance from before the period.

12. **Statement PDF generation fails (e.g., font missing):** Show error in modal with retry button; do not crash the app.

13. **WhatsApp deep link doesn't accept PDF attachment on this platform:** Detect platform, show appropriate flow (deep link with message only + Share Sheet for PDF).

14. **Two devices, both offline, both delete the same customer:** Both succeed; sync resolves with the customer deleted.

15. **Customer name in mixed Arabic and Latin (e.g., "أبو محمد - Apple shop"):** Renders correctly with bidi handling. Search matches both substrings.

16. **Exchange rate changes between when sale-on-account was rung and when payment is recorded:** Each transaction stores its own exchange rate at entry. Balance accounting in USD remains stable.

17. **Statement covers a period where the customer didn't exist yet:** Shows "0" balance and empty transaction list (don't fail).

18. **WhatsApp opens but user cancels before sending:** No way to detect this; we always log "تم إرسال" optimistically. Document as known limitation.

---

## Definition of Done

- [ ] All 9 stories pass their acceptance criteria
- [ ] Owner can add a customer in under 20 seconds
- [ ] Cashier can ring a sale on account in the same time as a cash sale (measured)
- [ ] Customer's balance is always correct after 50+ mixed sales and payments, including 10+ offline
- [ ] Statement PDF generates in under 3 seconds and renders correctly with Arabic text, RTL layout, and shop logo
- [ ] WhatsApp send flow works on Android Chrome, iOS Safari (with documented manual-attach for some iOS), and desktop browsers
- [ ] Brother sends at least one real statement to a real customer via WhatsApp during testing
- [ ] No customer ever sees the wrong balance, even with concurrent multi-device offline edits
- [ ] "Customers owe you" card on home screen updates in real time
- [ ] Customer search returns results in <200ms with 500+ customers, offline
- [ ] Split payment allocations always sum to sale total before confirm enables
- [ ] All Arabic text uses plain language ("على الحساب", "يدين لك", "كشف الحساب" — never "AR aging" or "ledger")
- [ ] All edge cases handled or documented
- [ ] Tested on phone, tablet, desktop, online and offline
