# v1 Epics — Retail Operations Platform

> Target milestone: **v1 production core (months 4-9)** — what brother's shop uses daily and what we demo on the Syria trip.
> Scoping principle: **vertical slices** — each epic ships an end-to-end usable thing.
> Sequencing principle: each epic should be usable standalone, AND make the next epic more valuable. By Epic 5, the customer can't go back to their old system even if they wanted to.

---

## Sequencing logic in one paragraph

Epic 1 makes the product exist. Epic 2 makes it the system of record for inventory. Epic 3 makes the owner *want* to open it. Epic 4 locks him in (his credit data is now here, not on paper). Epic 5 makes it sellable to anyone with employees. After these five, we have a product the brother depends on daily and that can be demoed to 10-15 shops on the Syria trip with confidence.

---

## Litmus Test reminder

> "If this were the only thing we shipped, would a Syrian retail shop owner pay $25/month for it?"

Applied to every story below. Anything failing the test is in a later epic.

---

# Epic 1 — Ring a Sale and Print a Receipt

**The thesis:** Until you can ring a sale offline, in Arabic, on a phone, and print a thermal receipt — you don't have a product. Everything else (inventory, reports, credit) assumes this works. This is the foundation slice.

**Pack assignment:** Core ($12/month)

**Sacred Rules touched:** Offline-first (1), Arabic+SYP+exchange rate (2), Hardware support (3) — *all three*. Epic 1 is the entry-ticket epic.

**Demo moments touched:** "Runs on whatever device you have" (1), "Works without internet" (2).

## User stories

### 1.1 — As a cashier, I can open the POS on my phone and see a list of products
- Product list shows: Arabic name, price in USD (primary), price in SYP (computed from exchange rate).
- Search bar at top, RTL-first.
- Search works with and without Arabic diacritics (تشكيل): typing `قهوة` finds `قَهْوَة`.
- Tap a product → it goes into the current sale.
- One-handed phone use: search bar reachable with thumb, product cards minimum 56px tall.

### 1.2 — As a cashier, I can build a sale by adding multiple items
- Current sale panel shows: line items, quantity stepper (+/−), line subtotal.
- Running total at bottom in both USD and SYP.
- Swipe-left on a line to remove.
- "Clear sale" button requires confirmation (one tap = mistake territory).

### 1.3 — As a cashier, I can choose a payment method and complete the sale
- Payment options on this epic: **Cash USD**, **Cash SYP**, **Card** (just records it, no integration).
- "On account" deferred to Epic 4 (Customer Credit).
- "Split payment" deferred to Epic 4.
- After tapping the payment method: enter amount received → see change due → confirm.
- Confirmation screen: large green checkmark, total, "Print receipt" button.

### 1.4 — As a cashier, I can print a thermal receipt
- ESC/POS via WebUSB or browser printing bridge (CTO's call after the hardware spike).
- Receipt content: shop name, date/time, line items in Arabic, totals in USD+SYP, tax number placeholder, footer text.
- Default template is hardcoded for now — receipt template editor is a later epic.
- Tested on at least 2 of: Epson TM-T20, Star TSP143, generic Chinese 80mm.

### 1.5 — As an owner, I can configure the exchange rate, and it updates the displayed SYP everywhere immediately
- Exchange rate is a **prominent action on the home screen**, NOT buried in settings.
- "Today's rate: 14,500 SYP = 1 USD" with an edit pencil right next to it.
- Tap → numpad → save → every price across the app reflects it instantly.
- Why this matters: Sacred Rule #2. If this is buried, we're another desktop product.

### 1.6 — As a cashier, I can complete sales when WiFi is off
- Service worker caches the app shell, product list, and exchange rate.
- Sales queued locally in IndexedDB.
- Sync indicator at top of screen, always visible:
  - 🟢 "All synced" (green dot)
  - 🟡 "3 sales waiting" (yellow with count)
  - 🔴 "Offline" (red with last-sync timestamp)
- When WiFi returns: sync runs automatically, indicator goes yellow→green with a brief animation.
- **This is Demo Moment #2.** It must work flawlessly or we have no demo.

## What this epic does NOT include
- Adding/editing products (Epic 2)
- Inventory deduction (Epic 2)
- Returns/refunds (later v1)
- Cashier identity / who rang the sale (Epic 5)
- Customer credit / on-account / split payments (Epic 4)
- Reports beyond "today's sales total" on home screen
- WhatsApp receipt option (later v1)

## How it should look

The home screen is the **business health dashboard** even at this stage — but in this epic, most of it is placeholder cards. The one live card is "Today's sales" with a running total. The exchange-rate widget sits at the top start (right in RTL). One big button: **"بيع جديد"** (New Sale).

The POS screen is two stacked panels on phone:
- Top 60%: searchable product grid (2 columns on phone, 4 on tablet)
- Bottom 40%: current sale, slides up to full-screen when tapped to review before payment

**Visual discipline:**
- White background, one accent color (suggest a deep green or terracotta — *not* blue; every Syrian incumbent uses blue)
- Large Arabic typography (test on actual phones at arm's length)
- Generous spacing
- No icons-only buttons — every action has an Arabic label
- Plain-language UI: "بيع جديد" not "معاملة جديدة"

## Definition of Done
- [ ] Cashier can ring a 5-item sale in under 60 seconds on a phone
- [ ] Receipt prints correctly in Arabic on 2+ printer models
- [ ] Sale works with WiFi off, syncs cleanly when it returns
- [ ] Exchange rate edit propagates across the app in <1 second
- [ ] Brother (customer #0) tested it on 3 real sales in his shop
- [ ] No crash, no data loss, in 50 consecutive offline→online cycles

## Risks
- **Sync layer choice** — do the 3-5 day spike *before* starting Epic 1. PowerSync vs ElectricSQL vs RxDB. Picking wrong here costs months.
- **Thermal printer integration on phones** — browser-to-USB on Android is finicky. May need a small native bridge or a Bluetooth printer fallback. Budget a week for this alone.
- **Arabic search with diacritics** — Postgres `unaccent` extension doesn't handle Arabic; needs a custom normalization function or `pg_trgm` with normalization.

---

# Epic 2 — Manage Products and Track Stock

**The thesis:** Epic 1 sells products that magically exist. Epic 2 makes them real — added by the owner, with quantities that go down when sold and trigger alerts when low. After this epic, the brother stops using whatever he uses now.

**Pack assignment:** Core ($12/month)

**Sacred Rules touched:** Offline-first (1), Arabic (2).

**Demo moments touched:** "Fits any retail shop" (3) — the Excel importer is what proves this.

## User stories

### 2.1 — As an owner, I can add a product manually
- Fields: Arabic name, English name (optional), barcode (optional), cost price USD, sale price USD, current stock quantity, low-stock threshold, category (free text v1, dropdown later).
- "Save and add another" button stays on the form for fast bulk entry.
- Photo of product optional — phone camera or upload.

### 2.2 — As an owner, I can scan a barcode with a USB scanner or phone camera to add or find a product
- USB scanner = keyboard emulation, works out of the box, just focus the input.
- Phone camera = `@zxing/browser` for fallback.
- If barcode exists → opens that product.
- If barcode doesn't exist → opens "Add product" form with barcode pre-filled.

### 2.3 — As an owner, I can import products from Excel
- Drag-and-drop or "Choose file".
- Auto-detect columns: handles Arabic headers (الاسم، السعر، الكمية), English (name, price, qty), and mixed.
- Preview screen: shows first 10 rows mapped to fields; owner can correct any mapping.
- Currency inference: values 14,000-2,000,000 → suggest SYP; values 1-5,000 → suggest USD.
- "Import 247 products" button → progress bar → success summary.
- **The killer onboarding feature** per the plan. Spend the time.

### 2.4 — When a sale is rung (Epic 1), stock deducts automatically
- After payment confirmation, stock for each line item decrements.
- If stock would go negative: **allow it** (Syrian shops sometimes sell what's "in the back"), but flag the line with a small warning icon.
- The sale still completes — never block the cashier.

### 2.5 — As an owner, I see low-stock alerts on the home screen
- Home screen "Low stock" card: count and top 3 items.
- Tap → full list, sorted by how-far-below-threshold.
- Each item has a "Mark as reordered" button — hides it from the list for 7 days. (Actual PO workflow is later.)

### 2.6 — As an owner, I can edit a product anytime, including changing prices
- Edit screen mirrors the add screen.
- Price changes do NOT retroactively affect past sales (audit trail principle, even before there's an audit log UI).
- "Last changed: 2 hours ago by owner" line at bottom — sets up Epic 5.

### 2.7 — Offline works for product browsing and stock deduction
- Product catalog cached locally.
- Stock deductions queued.
- Edge case: two devices offline, both sell the last unit → on sync, one will go negative. Acceptable for v1; flag for owner. Don't try to solve with locks.

## What this epic does NOT include
- Multi-location stock (Warehouse module, v1.5)
- Composite items / bundles (v1.5)
- Supplier records and PO workflow (later v1)
- Barcode label printing (v1.5)
- Stock receiving workflow (later v1 — "supplier name + photo of invoice")

## How it should look

**Back Office (desktop-led):** Product list is a table. Searchable, filterable by category, sortable by stock-low-to-high. Columns: photo, name (AR), barcode, cost, sale price, stock, low-stock threshold, last sold. Edit inline where possible.

**Phone:** Same data, card-based list. Tap a card to edit. Add button is a floating action button (FAB) bottom-start.

**Excel import wizard:** Full-screen 3-step flow. Upload → Map columns (with auto-suggestions highlighted) → Confirm. Each step has a "Back" button. The mapping step shows a live preview of the first 5 products as they'll be created.

**Low stock card on home screen:** Yellow accent (not red — red is for "offline"). Shows count: "3 items low" with the three names in small text.

## Definition of Done
- [ ] Owner can add 50 products manually in under 30 minutes
- [ ] Owner can import 200 products from a messy Excel in under 5 minutes
- [ ] Barcode scan finds existing product in <500ms
- [ ] Stock deducts correctly across 100 consecutive sales, including 20 offline ones
- [ ] Low-stock alerts appear on home screen within 1 minute of crossing threshold
- [ ] Brother's full real inventory imported and in daily use

## Risks
- **Excel parsing is messier than it looks.** Real shop spreadsheets have merged cells, header rows in row 3, currency formatting like `10,000 ل.س`, mixed RTL/LTR text, empty rows. Test against 5 real spreadsheets from the CEO's network before declaring this done.
- **Photo storage cost.** If every product has a photo, 200 products × multiple shops × backup = real S3/R2 bills. Compress aggressively (max 200KB, WebP), keep photos optional.

---

# Epic 3 — Business Health Home Screen

**The thesis:** After Epic 2, the brother is using the product daily for sales and inventory. Epic 3 is what makes him *enthusiastic* — for the first time he can see, on his phone, whether he made money today. This is the daily reason to open the app.

**Pack assignment:** Core ($12/month) — basic version. Reporting Pack (+$5/month) adds advanced charts and P&L view in a later epic.

**Sacred Rules touched:** Arabic + dual currency (2).

**Inspiration source:** QuickBooks/Xero home dashboard, localized for Syrian retail. Plain-language UI per Wave: "المال الداخل" (money coming in) not "الإيرادات" (revenue).

## User stories

### 3.1 — As an owner, I see today's revenue, expenses, and profit on the home screen
- Three large cards, always visible above the fold on phone:
  - **"اليوم" (Today)** — money coming in (USD primary, SYP secondary)
  - **"المصاريف" (Expenses)** — money going out today
  - **"الربح" (Profit)** — calculated as revenue minus expenses minus cost-of-goods-sold for today's sales
- Cards refresh in real time as sales are rung and expenses logged.
- Profit card uses color: green if positive, gray if zero, red if negative.

### 3.2 — As an owner, I can toggle the view between Today, This Week, and This Month
- Segmented control above the cards: `اليوم | الأسبوع | الشهر`
- Tapping a tab updates all three cards together.
- Default view is "Today" when app opens before noon, "This Week" after.

### 3.3 — As an owner, I can tap any card to see a breakdown
- Tap "Today" revenue → list of every sale today (timestamp, items count, total, payment method).
- Tap "Expenses" → list of expenses with amount, category, optional receipt photo.
- Tap "Profit" → split into: gross revenue, minus cost of goods sold, minus expenses = profit. Plain language.

### 3.4 — As an owner, I can log an expense in under 30 seconds
- "إضافة مصروف" (Add expense) button on the home screen, always visible.
- Form: amount (USD or SYP toggle), category (rent, utilities, salary, supplies, other — free text editable), date (defaults to today), optional photo of receipt.
- Photo stored as proof (per plan: photo-first expense capture, OCR comes in v2).
- Save → immediately appears in today's expense card.

### 3.5 — As an owner, I see top 5 selling products this period
- Card below the three main cards: "الأكثر مبيعاً" (Best sellers).
- Lists 5 products with sale count and revenue contribution.
- Updates with the same Today/Week/Month toggle.

### 3.6 — As an owner, I see a "cash in drawer vs system expected" indicator
- Small status row at the bottom of the home screen.
- "النقد في الدرج: 142,000 ل.س متوقع — قم بالعد عند إغلاق الوردية" (Cash in drawer: 142,000 SYP expected — count at shift close).
- Full reconciliation is in Epic 5 (shifts). This is the preview.

### 3.7 — Offline works for the dashboard
- All numbers computed locally from cached data.
- Stale-data indicator if sync is more than 30 minutes behind: small "Updated 35 minutes ago" text under the cards.

## What this epic does NOT include
- Advanced charts (Reporting Pack, later epic)
- P&L statement view (Reporting Pack, later epic)
- Owner WhatsApp daily digest (later v1)
- Expense approval workflow (v1.5)
- Photo OCR for expenses (v2)
- Custom report builder (v1.5)
- 30/60/90 cash flow forecast (v2)

## How it should look

**The home screen is now the heart of the product.** A Syrian shop owner opening this app should feel: "I know how my business is doing right now."

Layout (phone, top to bottom):
1. App header with exchange rate widget (from Epic 1) and sync indicator
2. Segmented toggle: Today | Week | Month
3. Three large cards stacked — Revenue, Expenses, Profit — each big enough to read across a room
4. "إضافة مصروف" floating action button (or prominent button below the cards)
5. Top sellers card
6. Cash drawer indicator at the bottom
7. New Sale button — always reachable

**Typography discipline:** Numbers are the heroes. Use a tabular numeric font, large weights for the headline numbers. Currency symbols smaller than the amount.

**Color discipline:**
- Profit positive = green (same green as accent color)
- Profit negative = red (same red as offline indicator — be consistent across the app)
- Expenses = neutral dark gray, not red (red is reserved for problems)
- Best sellers = accent color highlights

**Empty state:** First-time user with no sales yet — show a friendly Arabic message: "ابدأ ببيعك الأول لرؤية أرقامك هنا" (Make your first sale to see your numbers here) with a big "New Sale" button.

## Definition of Done
- [ ] Owner can see today's profit at a glance in under 3 seconds of opening the app
- [ ] All three cards update in real time when a sale is rung
- [ ] Owner can log a typical expense in under 30 seconds
- [ ] Numbers match a hand calculation on a sample day with 20 sales and 5 expenses
- [ ] Brother checks the dashboard at least once daily for 2 weeks before this epic is "done"
- [ ] Works fully offline with cached data, shows staleness honestly

## Risks
- **Profit calculation correctness.** Cost of goods sold needs each product's cost price (Epic 2 field). If owner doesn't enter cost prices reliably, profit number lies. Mitigation: show a small "12 products missing cost — profit may be inaccurate" warning when relevant.
- **Performance on cheap Android phones.** Computing dashboard numbers from thousands of cached sales on a $100 phone can be slow. Pre-aggregate at write time (running totals per day/week/month in a local table) rather than recomputing on every screen open.
- **Definition of "today".** Sales after midnight at a late-closing shop are awkward. Use a configurable "business day start" — default 6 AM — so a 1 AM sale belongs to yesterday's numbers if shop owner prefers.

---

# Epic 4 — Customer Credit Ledger

**The thesis:** Every Syrian shop runs on credit. This is a non-negotiable v1 feature per the plan — and once the brother has it, he literally cannot switch back to paper. Combined with Epic 3, this is what locks customer #0 in.

**Pack assignment:** Customer Pack (+$5/month). But for the brother and the first 10-15 founding customers, all packs are bundled at 50% off, so this still ships in v1 timeline.

**Sacred Rules touched:** Arabic (2), Offline (1).

**Inspiration source:** ZipBooks/FreshBooks customer statements — but delivered via WhatsApp, not email, because customers don't open portals.

## User stories

### 4.1 — As an owner, I can add a customer with name and optional phone number
- Fields: name (Arabic, required), phone (optional but recommended — needed for WhatsApp features), notes (free text, e.g. "Brother of Abu Khaled, gets 5% off").
- Quick-add from the POS: during a sale, tap "Choose customer" → search or add new inline.
- Search by name (with Arabic diacritic normalization, same as products).

### 4.2 — As a cashier, I can assign a sale to a customer and choose "On account" as payment
- During payment step in Epic 1's POS flow, add a new payment option: **"على الحساب" (On account)**.
- Selecting this requires choosing a customer first.
- The sale completes immediately. The amount adds to the customer's running balance.
- Receipt prints with "على الحساب" instead of "نقداً" and shows new total balance: "الرصيد الجديد: 320,000 ل.س".

### 4.3 — As a cashier, I can do a split payment (cash + credit)
- After selecting payment method, an "أضف طريقة دفع أخرى" (Add another method) link appears.
- Owner can stack: e.g., 50,000 SYP cash + 30,000 SYP on account.
- All methods sum to the sale total before "Confirm" enables.
- Each method's amount goes to its respective ledger.

### 4.4 — As an owner, I see every customer's running balance
- New section in Back Office and on phone: **"الزبائن" (Customers)**.
- List sorted by who-owes-most by default. Toggle for alphabetical.
- Each row: name, phone, current balance (USD primary, SYP secondary), last activity date.
- Tap a customer → full history: every sale on account, every payment received, chronological.

### 4.5 — As an owner, I can record a payment from a customer
- From customer detail: **"تسجيل دفعة" (Record payment)** button.
- Form: amount, currency (USD or SYP), date (defaults to today), payment method (cash USD, cash SYP, bank transfer, USDT, hawala — same payment methods used elsewhere), optional note.
- Save → balance reduces immediately. Appears in customer history. Counts toward today's revenue card on the home screen (it doesn't, actually — see risks).

### 4.6 — As an owner, I can send a customer their monthly statement via WhatsApp in one tap
- From customer detail: **"إرسال كشف الحساب" (Send statement)** button.
- Generates a PDF: shop letterhead (from Epic 1's receipt template), customer name, statement period (defaults to current month), every sale and payment with running balance, total owing at end.
- Tap → opens WhatsApp with the customer's phone number pre-filled and the PDF attached, plus a polite Arabic message template: "السلام عليكم أبو [الاسم]، هذا كشف حسابكم للشهر. الرصيد الحالي: [المبلغ]. شكراً."
- Owner edits message if they want, then sends.
- Customer receives PDF in WhatsApp, no portal login required.

### 4.7 — As an owner, I see "outstanding credit" on the home screen
- New card on home dashboard (Epic 3): **"يدين لك الزبائن: 4,200 USD"** (Customers owe you: 4,200 USD).
- Tap → goes to Customers list sorted by who-owes-most.
- This is what makes Epic 3's home screen feel complete.

### 4.8 — Offline works for adding sales on account and recording payments
- Customer list cached locally.
- New sales on account and recorded payments queue and sync.
- Balance shown on phone reflects local pending operations immediately (optimistic UI) with a small "pending sync" badge until confirmed.

## What this epic does NOT include
- Customer credit limits (v1.5 — "if customer is over their limit, warn the cashier")
- AR aging breakdown — 30/60/90 days overdue (v1.5)
- Payment confirmation link sent to customer when they pay (later v1)
- Customer-side portal (not building — WhatsApp is the portal)
- Email statements (Syrian customers don't use email; WhatsApp only)
- Customer loyalty/points (v1.5)
- Customer-specific pricing (year 3-4, wholesale)

## How it should look

**Customers list (phone):** Card per customer. Customer name large. Balance in red if owing, gray if zero. Phone icon next to name → tap to call. WhatsApp icon → tap for quick statement send.

**Customer detail screen:** Top section is the balance — huge, can't miss it. Below: two big buttons side-by-side: "تسجيل دفعة" (Record payment) and "إرسال كشف الحساب" (Send statement). Below those: full transaction history, newest first, with running balance on each row.

**POS payment step with "On account":** When cashier picks "On account", a customer search modal slides up. Empty state has a big "Add new customer" button. After selecting, returns to payment confirmation showing: "Sale: 150,000 SYP. Charging to: أبو محمد. New balance: 320,000 SYP."

**WhatsApp statement message preview:** Before opening WhatsApp, show the owner a preview of the message they're about to send, with the option to edit. Don't trust auto-send.

## Definition of Done
- [ ] Owner can add a customer in under 20 seconds
- [ ] Cashier can ring a sale on account in the same time as a cash sale
- [ ] Customer's balance is always correct after 50+ mixed sales and payments, including 10+ offline
- [ ] Statement PDF generates in under 3 seconds and looks professional
- [ ] WhatsApp send works on Android Chrome, iOS Safari, and desktop browsers
- [ ] Brother sends a real statement to a real customer via WhatsApp at least once
- [ ] No customer ever sees the wrong balance, even with concurrent multi-device offline edits

## Risks
- **Revenue accounting clarity.** When a sale is rung "on account", is that revenue today, or is it revenue when the customer pays? Decision per plan: **sale is revenue when rung**, payment received reduces the receivable but does not double-count as revenue. The home screen "Today's revenue" includes on-account sales. The "Customers owe you" card shows the receivable. Document this clearly so reports stay consistent.
- **WhatsApp integration mechanics.** Using `wa.me` deep links is simple but requires the user to manually attach the PDF on some platforms. WhatsApp Business API is overkill at this stage. Test the actual flow on real Syrian phones before declaring done.
- **Balance reconciliation across devices.** Two devices offline, one records a payment, the other rings a sale on account, both sync. Order of operations matters. Sync layer must handle this (per Sacred Rule 1) — another reason the sync spike is critical.
- **Arabic name search.** Customer names have heavy variation in transliteration (محمد vs محمّد vs Mohamed). Allow fuzzy match on phone number as a fallback search.

---

# Epic 5 — Cashier Shifts and Identity

**The thesis:** The brother might run his shop solo, but most of the CEO's reference customers won't. This epic is where the product starts genuinely beating Al-Ameen — because Al-Ameen has shifts but they're a 2010-era nightmare. Shipping this makes the Syria trip demo include the "you can see who's stealing from you" moment.

**Pack assignment:** Staff Pack (+$5/month). Bundled into founding customer rate.

**Sacred Rules touched:** Arabic (2), Offline (1).

**Demo moments touched:** None of the three primary demo moments, but creates a fourth informal one: "You can see what every employee is doing."

## User stories

### 5.1 — As an owner, I can add employees and assign them roles
- Roles in v1: **Owner**, **Manager**, **Cashier**. Hardcoded for now; flexible permissions framework (per plan) ships in v1.5.
- Fields per employee: name, 4-digit PIN, role, optional photo, active/inactive toggle.
- Owner can add up to 5 employees (Staff Pack limit).
- Permissions matrix:
  - Cashier: can ring sales, can open/close their own shift, cannot edit products, cannot see profit, cannot edit other people's shifts.
  - Manager: cashier permissions + can edit products, see today's revenue/profit, but cannot manage other employees or change settings.
  - Owner: everything.

### 5.2 — As a cashier, I sign in with a 4-digit PIN at the start of my shift
- App startup: PIN entry screen with employee photos (tap your face, enter PIN).
- Fast: should take under 5 seconds.
- PIN entry rate-limited: 5 wrong attempts = lock for 5 minutes, owner notified.

### 5.3 — As a cashier, I open my shift by counting cash in the drawer
- After PIN, prompted: "ابدأ الوردية — اعد النقد" (Start shift — count cash).
- Enter amounts: cash USD, cash SYP.
- "Start shift" → recorded with timestamp, starting amounts.
- Until shift is open, cashier cannot ring sales.

### 5.4 — Every sale records who rang it
- The POS flow from Epic 1 is unchanged for the cashier — they don't re-authenticate per sale.
- Every sale silently records: cashier ID, shift ID, timestamp.
- Receipts can optionally print cashier name (configurable in receipt template — that editor is a later epic, but the data field is captured now).

### 5.5 — As a cashier, I close my shift and see my cash variance
- "إنهاء الوردية" (End shift) button accessible from any screen.
- App shows expected cash in drawer based on shift activity:
  - Starting cash + cash sales − cash returns − cash payouts (expenses paid in cash) = expected
- Cashier counts actual cash and enters it.
- App shows variance: "متوقع: 145,000 ل.س. مُعد: 142,000. عجز: 3,000 ل.س" (Expected: 145,000. Counted: 142,000. Short: 3,000).
- Cashier confirms → shift closes. They sign out.

### 5.6 — As a cashier or owner, I can print a Z-report at shift close
- Z-report shows: cashier name, shift open/close time, sales count, total revenue (cash USD, cash SYP, on-account, split), top items sold, returns, expenses paid during shift, cash variance.
- Prints to thermal printer.
- Saved to history — cannot be edited or deleted.

### 5.7 — As an owner, I see all shift history and variances
- New Back Office section: **"الورديات" (Shifts)**.
- List of all closed shifts: cashier, date, duration, total revenue, variance.
- Variance highlighted in red if non-zero.
- Tap a shift → full breakdown with link to every sale rung during that shift.

### 5.8 — As an owner, I see an audit log of important changes
- Audit log records: product price changes, product cost changes, product deletion, customer balance adjustments, expense edits, manual stock adjustments, employee changes, settings changes.
- Each entry: who, when, what changed, before/after values.
- Searchable and filterable by user and date range.
- **Cannot be edited or deleted, ever.** This is the "I can see who's stealing" feature; if it's editable, it's worthless.

### 5.9 — Offline works for shifts and audit log
- Cashier can open/close shifts offline. Z-report prints from local data.
- All actions queue for sync.
- Audit log is append-only on each device and merges on sync — no conflicts possible because every entry has a unique device+timestamp ID.

## What this epic does NOT include
- Cashier commission tracking (v1.5)
- Custom permissions framework (v1.5)
- Tamper-evident cryptographic audit log (v2 — current audit log is "soft" tamper-evident: you'd have to edit the database directly to fudge it)
- Time-clock / attendance (later — not in scope)
- Manager approval workflows for big changes (v1.5)
- Multi-shift overlap on the same register (defer; one shift at a time per device in v1)

## How it should look

**PIN screen:** Black background, employee photos as large round avatars (or initials in colored circles if no photo), name underneath each. Tap → numeric keypad fills screen. Big, fast, no decoration.

**Shift open screen:** Two number inputs — Cash USD, Cash SYP. Big "ابدأ الوردية" button. Below: small "أمس: 142,000 ل.س" hint showing yesterday's closing balance to speed up counting.

**Active shift indicator:** Once shift is open, a small chip at the top of every screen shows "وردية: محمد — 3:42 ساعة" (Shift: Mohamed — 3h 42m). Always visible so cashier knows they're on the clock.

**Shift close screen:** Three sections stacked:
1. Expected cash (large, computed)
2. Counted cash (cashier inputs)
3. Variance (auto-calculates, color-coded: green if zero, yellow if minor, red if >5%)

Below: "Print Z-report" toggle (default on), "Confirm and close shift" button.

**Audit log:** Like a feed. Reverse chronological. Each entry is a one-line summary expandable to show before/after. Examples:
- "محمد عدّل سعر منتج: شامبو دوف من 25,000 إلى 27,000 ل.س — قبل 3 ساعات"
- "أبو خالد ألغى بيعاً: 150,000 ل.س — قبل ساعة"

## Definition of Done
- [ ] Cashier can sign in and open a shift in under 30 seconds
- [ ] Z-report prints correctly with all required totals
- [ ] Variance calculation matches a hand-check on 10 test shifts with mixed sales
- [ ] Owner can identify, from the audit log, who changed a specific product price 3 weeks ago in under 1 minute
- [ ] No way to edit or delete a closed shift or audit entry through the UI
- [ ] Brother tests this with at least one helper for 1 full week before this epic is "done"

## Risks
- **Cashiers will hate the shift-close count if it's slow.** If counting cash takes 15 minutes every day, they'll find ways to skip it. Make the input UX fast (recent denominations as quick-add buttons: "10x 5000 SYP = +50,000"). Watch the brother's cashier do it; iterate.
- **Audit log volume.** A busy shop with 200 product edits, 100 sales, 20 expenses a day generates thousands of entries per month. Storage is cheap but search must stay fast. Index by user, date, entity type.
- **PIN security.** 4 digits is weak. Acceptable because the physical security model is "cashier is at the register and trusted enough to be there." Don't pretend this is bank-grade. If a customer asks: 4-digit PIN is for speed; the audit log is the real defense.
- **Permissions in code from day one.** Even with hardcoded roles, the permission check should be a single function call (`canUserDo(user, action)`) so swapping in the flexible framework in v1.5 doesn't require rewriting every screen.

---

# What comes after these five (Epics 6+, brief)

Once Epics 1-5 ship, the product is genuinely usable for the brother and demoable on the Syria trip. The remaining v1 features (per the plan) get sequenced into Epics 6-12 in roughly this order — to be detailed when Epics 1-5 are nearing done:

| Epic | Title | Pack | Why this order |
|---|---|---|---|
| 6 | Receipt template editor + WhatsApp receipt | Core | Customer-facing polish; needed before Syria trip |
| 7 | Returns and refunds workflow | Core | Every shop has returns; can't demo without it |
| 8 | Supplier records + stock receiving (photo of invoice) | Core | Closes the inventory loop |
| 9 | Owner Dashboard mobile app (read-only) + daily WhatsApp digest | Reporting | Sells the "see your shop from anywhere" pitch |
| 10 | Repair tickets + warranty + repair profitability | Electronics Pro | Brother's shop needs this; Electronics Pro pack pricing validation |
| 11 | Excel/CSV exports for accountant handoff | Core | Closes the "what about my accountant?" objection |
| 12 | Self-serve onboarding flow + Tested Hardware page | Core | Required for cold international signups and Syria trip scaling |

---

# Architecture decisions that must happen before Epic 1

Per the CLAUDE.md plan, these are week-1 decisions that cannot be deferred. They affect every epic.

1. **Sync layer spike (3-5 days).** PowerSync vs ElectricSQL vs RxDB. Highest-leverage technical decision in the plan.
2. **Hardware abstraction layer.** Driver pattern. One file per printer model. No direct hardware calls in POS code.
3. **Feature flag infrastructure.** Customer-level flags. LaunchDarkly, GrowthBook, or Postgres flag table. Required before Epic 1 ships because modular pricing depends on it.
4. **Wholesale-aware schema.** Items support unit conversions, customers support price-list assignments, invoices/payments linked. Costs nothing now, saves months later.
5. **Flexible permissions framework foundation.** Even if Epic 5 uses hardcoded roles, the *check* is a single function so the framework swaps in cleanly in v1.5.

---

# Working principles for the team building these epics

1. **Apply the Litmus Test on every story.** Would a Syrian retail shop owner pay $25/month for just this story? If not, defer it within the epic or move it to a later epic.
2. **Phone-first means designing on phone first.** Build the phone layout, then scale up. Don't design on desktop and shrink.
3. **Plain-language Arabic UI throughout.** "المال الداخل" not "الإيرادات". "ما يدين به الزبائن" not "الذمم المدينة".
4. **If a feature requires calling the customer to use it, that feature is broken.** Self-explanatory.
5. **Offline is not a feature, it's a default.** Every story above must work offline unless explicitly stated otherwise.
6. **Brother's shop is the test.** No epic is "done" until brother has used the new feature in real operation for at least a week.
7. **No accounting jargon.** This is a retail operations platform, not an accounting platform. Profit, money in, money out, what customers owe — not revenue, AR, COGS, equity.

---

*Last updated: based on confirmed strategy in CLAUDE.md and Strategy & Product Plan v4.*
*Next revision: after CTO sync spike completes and Epic 1 implementation begins.*
