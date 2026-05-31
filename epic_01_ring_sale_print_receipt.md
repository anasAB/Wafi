# Epic 1 — Ring a Sale and Print a Receipt

**Epic ID:** EPIC-01
**Pack:** Core
**Depends on:** None (foundation epic)
**Blocks:** Epic 2, Epic 3, Epic 4, Epic 5

---

## Epic summary

**Goal:** Cashier can ring a sale on a phone in Arabic, accept cash payment in USD or SYP, print a thermal receipt, and complete the sale even when WiFi is down.

**Value delivered:** Replaces paper receipts and Excel logs. Shop can run the register from a phone.

**In scope:** Product browsing, sale building, cash payment (USD/SYP/Card-recorded), thermal receipt printing, exchange rate config, full offline operation with sync.

**Out of scope:** Adding/editing products (Epic 2), inventory deduction (Epic 2), customer credit / on-account / split payment (Epic 4), cashier identity (Epic 5), returns (later epic), WhatsApp receipt (later epic), receipt template editing (later epic).

**Assumption:** Products exist in the database (seeded manually or via direct DB insert for this epic's testing). Epic 2 builds the proper product management.

---

## Cross-cutting decisions (read before implementation)

These decisions affect multiple stories and the data model. Resolved here so they're not left to the developer.

### CD-1 — Receipt sale number format
Receipts cannot show a global auto-incrementing number in an offline-first system (two offline devices would generate duplicates on sync). The decision:

- Every device is assigned a **short device code** at first sign-in.
- For a device that has registered with the server: code is a short alphabetic sequence (1-3 chars: `A`, `B`, `C` … `AA`, `AB`), assigned by the server and guaranteed unique per shop.
- For a device that has NOT yet registered (offline first-boot): code is `T-` followed by the last 4 hex characters of the device's UUID (e.g., `T-a1f3`). This provides ~65k entropy — two offline-first devices in the same shop colliding is statistically negligible.
- On first successful sync, the server reassigns a short permanent code (`A`, `B`, …). All future sales on this device use the new code. **Sales already recorded under the temporary code KEEP their original `display_sale_number`** (immutability per below) — they remain valid because (a) temp-code collisions are statistically near-zero and (b) the underlying `sale_id` (UUID) guarantees server-side uniqueness regardless.
- Each device maintains its own **local sequence counter**, starting at 1, incrementing per sale on that device. The counter persists across the temp→permanent code transition (no restart at 1).
- The **display sale number** is the composite: `{device_code}-{6-digit zero-padded sequence}`. Examples: `A-000247`, `B-001053`, `T-a1f3-000001`.
- The composite is displayed on the receipt as "رقم الفاتورة" (Invoice number) and stored on the sale record as `display_sale_number`.
- The internal `sale_id` is still a UUID — used for sync, foreign keys, conflict resolution, and the authoritative uniqueness guarantee.
- The composite never changes once printed (no "pending → assigned" swap).
- In the extremely rare case where two temp codes do collide post-sync, the server flags both sales for owner review with a notification ("تنبيه: رقمي فاتورة متطابقين بسبب الإعداد دون اتصال"); the records remain intact, but the owner can mark one for reprint with a manual suffix if desired.

### CD-2 — Tenant (shop) scoping on every record
Every persisted record in this epic (and across all epics going forward) carries:
- `shop_id` (UUID) — the tenant this record belongs to
- `device_id` (UUID) — the device that created it

The sync layer routes records by `shop_id` from the device's auth token; the field on the record is the source of truth for routing.

The data model in this epic includes `shop_id` and `device_id` on every record; treat this as a global pattern for all epics.

### CD-3 — In-progress sale draft persistence
To survive screen-locks, phone calls, low-memory app kills on cheap Android phones, the in-progress sale is auto-saved to local storage on every change:

- Every product add, quantity change, removal, or payment method selection writes the current sale draft to IndexedDB (debounced 200ms).
- One draft per device. Drafts older than 24 hours are auto-purged.
- On app resume, if a draft exists, the cashier sees a banner: "بيع غير مكتمل — متابعة؟" (Unfinished sale — continue?) with "متابعة" / "إلغاء" buttons.
- **Tapping "متابعة" restores line items to the POS screen with the sale's locked exchange rate intact.** The cashier must re-tap "دفع" to proceed to payment. The app does NOT automatically open the payment screen, even if `selected_payment_method` or `amount_received_so_far` were saved in the draft — those fields exist in the draft model for future use (e.g., a "resume exactly where I was" feature) but are not consumed by this epic. Restoring to a known, simple state (the POS screen with sale items) is the deliberate UX choice: predictability over completeness.
- Tapping "إلغاء" on the banner discards the draft.
- Confirmed sale = draft cleared. Cleared sale (via "Clear sale" or Cancel) = draft cleared.

### CD-4 — Exchange rate access from POS
The exchange rate widget appears in the **POS screen header** in addition to the home screen, so the owner doesn't need to navigate away mid-shift. Behavior is identical to the home-screen widget (Story 1.5); they share the same data and state. Cashier role (after Epic 5) sees the rate but cannot edit it.

### CD-5 — Payment screen navigation
The payment screen supports going back from amount entry to method selection without losing the sale (see Story 1.3 updates). "إلغاء" (Cancel) at the method-selection level returns to the sale (sale preserved). "رجوع" (Back) at the amount-entry level returns to method selection (amount entry discarded, sale preserved).

### CD-6 — Label table (Arabic)
| Action | Arabic |
|---|---|
| New Sale | بيع جديد |
| Pay | دفع |
| Cash USD | نقدي دولار |
| Cash SYP | نقدي ليرة |
| Card | بطاقة |
| Confirm | تأكيد |
| Cancel | إلغاء |
| Back | رجوع |
| Print receipt | طباعة الفاتورة |
| Reprint | إعادة طباعة |
| Save | حفظ |
| Clear sale | مسح |
| Invoice number | رقم الفاتورة |
| Unfinished sale banner | بيع غير مكتمل — متابعة؟ |
| Continue (resume draft) | متابعة |
| Sale history link | تاريخ المبيعات |
| Recent sales link | آخر المبيعات |
| Pending sync badge | في الانتظار |

All UI labels must use this table. New labels added go here.

---

## User stories

### Story 1.1 — Browse and search products on the POS

**As a** cashier
**I want to** see the shop's products on my phone and search them quickly
**So that** I can add them to a customer's sale

**Acceptance criteria:**

- **Given** I open the POS screen
  **When** the page loads
  **Then** I see a grid of products with: product photo (or placeholder), Arabic name, price in USD (primary, larger), price in SYP (secondary, smaller)

- **Given** the product grid is visible
  **When** I view the layout
  **Then** I see 2 columns on a phone (≤480px wide), 3 columns on a small tablet (481-768px), 4 columns on a large tablet/desktop (>768px)

- **Given** there is a search bar at the top of the screen
  **When** I type "قهوة" (without diacritics)
  **Then** products named "قَهْوَة" or "قهوة" both appear in results

- **Given** I type Latin characters "qahwa"
  **When** the product's English name field matches
  **Then** the product appears in results

- **Given** there are no matching products
  **When** my search returns 0 results
  **Then** I see "لا توجد منتجات" (No products found) with the search term highlighted

- **Given** the layout is RTL
  **When** I view the screen
  **Then** the search bar is at the top, easily reachable with the right thumb, with the keyboard input direction set to RTL

- **Given** product cards are displayed
  **When** I measure tap targets
  **Then** each card is at least 56px tall on phone (WCAG-compliant tap target)

- **Given** a USB barcode scanner is connected (keyboard emulation mode)
  **And** I am on the POS screen with the search bar focused (or any non-input area, which routes scanner input to a hidden capture)
  **When** I scan a barcode
  **Then** the matching product is added to the current sale automatically (skipping the tap), with quantity 1 (or increment if already in sale)

- **Given** a USB scanner emits a barcode that doesn't match any product
  **When** the lookup returns nothing
  **Then** a non-blocking toast shows "الباركود غير معروف" — sale state unchanged; cashier can search manually

- **Given** a non-product input is focused (e.g., the exchange rate editor modal, the amount-received numeric input, the search bar inside an unrelated modal)
  **When** the USB scanner fires keystrokes
  **Then** the scan event is intercepted and routed to product lookup as if no input were focused — the scanned digits are NOT typed into the focused non-product input

- **Given** how the scanner is detected
  **When** keystrokes arrive at ≥30 chars/sec from a numeric burst followed by Enter
  **Then** the app classifies these as a scanner event (not human typing) and routes them through the global scan handler, regardless of which element has focus

- **Given** the global scan handler is active
  **When** the cashier is genuinely typing in an input (e.g., adjusting quantity manually)
  **Then** human-speed keystrokes (<30 chars/sec) pass through to the focused input normally — only fast burst patterns are treated as scans. The 30 chars/sec boundary is a deliberate single threshold (no dead zone): slow USB scanners and very fast typists are rare enough that we accept the trade-off, and the burst-followed-by-Enter pattern is the dominant signal.

- **Given** I am on the POS screen and tap the camera icon in the search bar
  **When** the camera-based scanner opens (using `@zxing/browser`)
  **Then** scanning a barcode adds the matching product to the sale, same behavior as USB scan

- **Given** the app is served over HTTPS and the browser supports `navigator.mediaDevices.getUserMedia`
  **When** I tap the camera icon
  **Then** the camera prompt appears and scanning works

- **Given** the app is served over plain HTTP, OR the browser does not support `MediaDevices` (e.g., some older Samsung Internet versions on cheap Android)
  **When** I tap the camera icon
  **Then** the icon either does not appear OR shows a fallback message: "الكاميرا غير متاحة على هذا المتصفح — استخدم الماسح أو ابحث يدوياً" (Camera unavailable on this browser — use USB scanner or search manually), with no broken-camera state

- **Given** the browser supports camera but the user has previously denied permission
  **When** I tap the camera icon
  **Then** I see: "يجب السماح للكاميرا في إعدادات المتصفح" (You must allow camera access in browser settings) with a "حاول مرة أخرى" (Try again) button that re-prompts

---

### Story 1.2 — Add products to the current sale

**As a** cashier
**I want to** add multiple products to a sale, adjust quantities, and remove mistakes
**So that** I can build the customer's order

**Acceptance criteria:**

- **Given** I see a product card
  **When** I tap it
  **Then** the product is added to the current sale panel with quantity 1, and a brief visual confirmation flashes on the card

- **Given** a product is already in the current sale
  **When** I tap its product card again
  **Then** the quantity in the sale panel increments by 1 (does not add a duplicate line)

- **Given** the current sale has 1+ items
  **When** I view the sale panel
  **Then** each line shows: product name (AR), quantity stepper (− [qty] +), unit price, line subtotal

- **Given** a line item exists
  **When** I tap "+"
  **Then** quantity increments by 1, line subtotal recalculates immediately

- **Given** a line item exists with quantity > 1
  **When** I tap "−"
  **Then** quantity decrements by 1

- **Given** a line item has quantity 1
  **When** I tap "−"
  **Then** the line is removed from the sale

- **Given** a line item exists
  **When** I swipe left on the line
  **Then** a red "حذف" (Delete) button appears; tapping it removes the line

- **Given** the sale has 1+ items
  **When** I view the bottom of the sale panel
  **Then** I see the total in USD (primary, large) and SYP (secondary, smaller)

- **Given** the sale has 1+ items
  **When** I tap "مسح" (Clear sale)
  **Then** a confirmation dialog appears: "متأكد من حذف البيع؟" with "نعم" / "لا" buttons. Only "نعم" clears the sale.

- **Given** the sale is empty
  **When** I view the sale panel
  **Then** I see "لا توجد منتجات في البيع" (No products in sale) and the "دفع" (Pay) button is disabled

---

### Story 1.3 — Complete a cash payment

**As a** cashier
**I want to** take payment in USD cash, SYP cash, or card and complete the sale
**So that** the customer can pay and leave

**Acceptance criteria:**

- **Given** the sale has 1+ items
  **When** I tap "دفع" (Pay)
  **Then** the payment screen opens in **method-selection state** showing: total amount in USD and SYP, three payment method buttons: "نقدي دولار" (Cash USD), "نقدي ليرة" (Cash SYP), "بطاقة" (Card), and an "إلغاء" (Cancel) link at top-start

- **Given** I am in method-selection state
  **When** I tap "إلغاء"
  **Then** the payment screen closes and I return to the sale screen with the sale intact (no items lost)

- **Given** I am in method-selection state
  **When** I tap "نقدي دولار"
  **Then** the screen transitions to **amount-entry state**: numeric keypad opens for me to enter the amount received in USD, with a "رجوع" (Back) button at top-start

- **Given** I am in amount-entry state
  **When** I tap "رجوع"
  **Then** I return to method-selection state with the sale intact and the amount input cleared (selecting a different method starts fresh)

- **Given** I am in amount-entry state
  **When** I entered an amount ≥ the total
  **Then** I see change due calculated and a "تأكيد" (Confirm) button enabled

- **Given** I am in amount-entry state
  **When** I entered an amount < the total
  **Then** I see "المبلغ غير كافٍ" (Amount insufficient) and the Confirm button is disabled

- **Given** I tap "نقدي ليرة" in method-selection state
  **When** amount-entry state opens
  **Then** the displayed total is the SYP-equivalent computed from the **sale's locked exchange rate** (`exchange_rate_at_sale`, set when the first line item was added) — NOT the current rate. The total shown matches what the cashier already quoted in the sale panel.

- **Given** I tap "بطاقة" in method-selection state
  **When** the screen transitions
  **Then** no amount entry is needed; I see a "تأكيد" button immediately, with "رجوع" available to return to method-selection (card payments are recorded for tracking, no integration in this epic)

- **Given** I tap "تأكيد"
  **When** the sale is recorded
  **Then** I see a success confirmation screen with: large green checkmark, **display sale number** (per CD-1, e.g., `A-000247`), total paid, change due (if any), payment method, and two buttons: "طباعة الفاتورة" (Print receipt) and "بيع جديد" (New sale)

- **Given** the success confirmation is showing
  **When** I tap "بيع جديد"
  **Then** the POS resets to an empty sale and returns to the product grid

- **Given** the success confirmation is showing
  **When** I tap "بيع جديد" or navigate away
  **Then** the in-progress sale draft (per CD-3) is cleared

---

### Story 1.4 — Print a thermal receipt

**As a** cashier
**I want to** print a receipt on the shop's thermal printer
**So that** the customer has proof of purchase

**Acceptance criteria:**

- **Given** I am on the success confirmation screen
  **When** I tap "طباعة الفاتورة"
  **Then** the connected thermal printer prints a receipt with:
  - Shop name (from settings, hardcoded for this epic)
  - Date and time (Arabic-formatted: dd/mm/yyyy hh:mm)
  - **رقم الفاتورة (Invoice number):** the composite `display_sale_number` from CD-1, e.g., `A-000247`
  - Tax number placeholder (from settings)
  - Each line item: Arabic name, quantity × unit price USD, line total USD (SYP per line is NOT printed to save thermal paper space — SYP shown at total only; this is a deliberate decision and matches local convention)
  - Subtotal in USD
  - Total in USD (large)
  - Total in SYP (large, derived from `total_usd × exchange_rate_at_sale`)
  - Exchange rate used: "السعر: 14,500"
  - Payment method
  - Amount paid and change (if cash)
  - Footer text (from settings, e.g., "شكراً لزيارتكم")

- **Given** the printer is connected via USB and recognized
  **When** I tap print
  **Then** the receipt prints within 3 seconds

- **Given** the printer is offline or disconnected
  **When** I tap print
  **Then** I see an error: "الطابعة غير متصلة" (Printer not connected) with a "حاول مرة أخرى" (Try again) button — the sale itself is NOT affected (still recorded)

- **Given** I want to skip printing
  **When** I tap "بيع جديد" without printing
  **Then** the sale completes and the receipt can be reprinted later from sale history (sale history view: see Definition of Done — basic list only in this epic)

- **Given** the receipt is printing in Arabic
  **When** the printer outputs the text
  **Then** Arabic text is right-aligned, joins correctly (no broken letterforms), and is legible at 80mm paper width

**Supported printer models in this epic (minimum 2 must work):**
- Epson TM-T20 (USB)
- Star TSP143 (USB)
- Generic Chinese 80mm thermal printer (USB, ESC/POS standard)

---

### Story 1.5 — Configure the exchange rate

**As an** owner
**I want to** update the USD-to-SYP exchange rate quickly
**So that** prices reflect today's market rate

**Acceptance criteria:**

- **Given** I am on the home screen
  **When** I view the top area
  **Then** I see an exchange rate widget: "السعر اليوم: 1 USD = 14,500 SYP" with a small edit pencil icon

- **Given** I tap the edit pencil
  **When** the editor opens
  **Then** I see a numeric input pre-filled with the current rate, with the cursor positioned at the end

- **Given** I enter a new value
  **When** I tap "حفظ" (Save)
  **Then** the rate is saved with a timestamp and the editor closes

- **Given** I changed the rate
  **When** I navigate to the POS screen (with no sale in progress)
  **Then** all SYP prices on product cards reflect the new rate within 1 second of saving

- **Given** I have an in-progress sale (1+ items already added)
  **When** the exchange rate is changed by me or another user
  **Then** the in-progress sale's SYP total does **NOT** change — it continues to use the rate that was active when the sale's first line was added (the "locked sale rate")

- **Given** I have an in-progress sale and the rate changed
  **When** I view the sale panel
  **Then** I see a small notice: "تم تحديث السعر — البيع الحالي يستخدم السعر القديم" (Rate updated — current sale uses previous rate)

- **Given** I have an in-progress sale using a locked rate
  **When** the sale is confirmed
  **Then** `exchange_rate_at_sale` on the record stores the locked rate (not the now-current rate)

- **Given** I clear the sale or confirm it
  **When** I start a new sale
  **Then** the new sale uses the current rate (which becomes its locked rate)

- **Given** I am on the POS screen
  **When** I view the header
  **Then** I see the same exchange rate widget shown on the home screen (per CD-4), positioned at the end of the header row, with identical content and pencil affordance

- **Given** I am on the POS screen and I tap the exchange rate widget in the header
  **When** the editor opens
  **Then** its behavior is identical to the home-screen widget: same form, same validation, same history list, same Save/Cancel actions, same propagation rules (including the "locked sale rate" rule above)

- **Given** I enter a rate of 0 or negative
  **When** I tap Save
  **Then** I see "السعر يجب أن يكون أكبر من صفر" and Save is blocked

- **Given** I enter a rate that is more than 50% different from the previous rate
  **When** I tap Save
  **Then** a confirmation dialog appears: "السعر الجديد يختلف بشكل كبير عن السابق. هل أنت متأكد؟" with Yes/No

- **Given** the exchange rate has a history
  **When** I view the editor
  **Then** I see the last 5 rate changes with timestamps: "أمس 9:30 ص — 14,200", etc.

---

### Story 1.6 — Sell offline and sync when WiFi returns

**As a** cashier
**I want to** keep ringing sales even when the internet drops
**So that** the shop never stops operating

**Acceptance criteria:**

- **Given** the app has been opened at least once online
  **When** I disconnect WiFi/cellular completely
  **Then** the POS screen still loads and all product data is available

- **Given** I am offline
  **When** I ring a complete sale (build → pay → confirm)
  **Then** the sale is recorded locally, the success confirmation displays, and the receipt prints (printer USB connection is independent of network)

- **Given** I am offline with queued sales
  **When** I view any screen
  **Then** the sync indicator at the top of the screen shows: red dot + "غير متصل — 3 معاملات في الانتظار" (Offline — 3 transactions pending)

- **Given** I am online with all data synced
  **When** I view any screen
  **Then** the sync indicator shows: green dot + "متصل — جميع البيانات محفوظة" (Connected — all data saved)

- **Given** I am online with sync in progress
  **When** I view any screen
  **Then** the sync indicator shows: yellow dot + spinning icon + "جاري المزامنة — 2 متبقية" (Syncing — 2 remaining)

- **Given** WiFi reconnects after being offline
  **When** the device detects connectivity
  **Then** queued sales begin syncing automatically within 5 seconds, indicator transitions red → yellow → green

- **Given** sync is in progress
  **When** the user does any other action
  **Then** sync continues in the background without blocking the UI

- **Given** I tap the sync indicator
  **When** the detail panel opens
  **Then** I see: last successful sync timestamp, count of pending items, list of pending items with timestamps, manual "مزامنة الآن" (Sync now) button

- **Given** sync fails for an item (e.g., server error)
  **When** the failure occurs
  **Then** the item stays in the queue, the indicator shows red with an error icon, and tapping shows the error message in Arabic

- **Given** the app has been offline for 24+ hours
  **When** I open the app
  **Then** I see a non-blocking banner: "أنت غير متصل منذ يوم. تأكد من الاتصال للمزامنة." (You've been offline for a day. Check connection to sync.)

---

## Screens and states

### Screen 1: Home screen (POS app entry point)

**Layout (phone, top to bottom):**
1. App header: sync indicator (left), exchange rate widget (right)
2. Greeting line: "أهلاً" + day's date in Arabic
3. Placeholder cards for "Today's Sales" (shows running total only in this epic — full dashboard is Epic 3)
4. Big primary button: "بيع جديد" (New Sale)

**States:**
- **Default:** All elements visible
- **Offline:** Sync indicator red, otherwise unchanged
- **First-time open (no sales yet):** Today's Sales card shows "0 USD" with helper text "ابدأ ببيعك الأول"
- **Exchange rate not set:** Exchange rate widget shows "لم يتم تحديد السعر — اضغط للتعديل" in yellow

### Screen 2: POS sale screen

**Layout (phone):**
- Persistent header (top): sync indicator (start), exchange rate widget (end) — per CD-4
- Search bar with embedded camera icon (Story 1.1 barcode scan)
- Top 60% under header: product grid
- Bottom 40%: current sale panel (collapsed by default to show 2 lines + total; tap to expand to full screen)

**Layout (tablet/desktop):**
- Same header
- Left 60%: search bar + product grid
- Right 40%: current sale panel (always full height)

**States:**
- **Empty sale:** Sale panel shows "لا توجد منتجات في البيع", "دفع" button disabled
- **Sale in progress:** Lines visible, total visible, "دفع" button enabled
- **Search active:** Product grid filters in real time as user types
- **Search no results:** "لا توجد منتجات" message with cleared search button
- **Scanning (camera open):** Camera preview overlays the screen with a "إلغاء" button to dismiss
- **Camera unavailable (HTTP / unsupported browser):** Camera icon either hidden or shown disabled with tooltip "الكاميرا غير متاحة على هذا المتصفح"
- **Camera permission denied:** Tap on camera icon shows a recovery message with "حاول مرة أخرى" button that re-prompts permission
- **Offline:** Same as default, sync indicator shows offline status
- **Draft recovery:** On screen mount, if a saved draft exists (per CD-3), a banner appears at top: "بيع غير مكتمل — متابعة؟" with "متابعة" / "إلغاء" actions

### Screen 3: Payment screen

**Layout:** Modal slide-up covering 100% of screen on phone, 60% on tablet.

**Sections:**
1. Header: "إجمالي البيع" + total in USD (large) and SYP
2. Top-start chrome: "إلغاء" in method-selection state; "رجوع" in amount-entry state
3. Body: changes by state (see below)

**States and transitions (per CD-5):**
- **Method selection (entry state):** Three payment-method buttons visible (cash USD, cash SYP, card). Top-start shows "إلغاء" which returns to sale. Tapping a method transitions to amount-entry.
- **Amount entry — cash USD/SYP:** Numeric keypad + amount display + change due (when amount ≥ total). Top-start shows "رجوع" which returns to method selection (input cleared). "تأكيد" disabled until amount sufficient.
- **Amount entry — card:** Confirm-only screen, no amount input. Top-start shows "رجوع".
- **Confirming:** Confirm button shows spinner; both "رجوع" and "إلغاء" disabled to prevent partial commits.

### Screen 4: Sale confirmation screen

**Layout:** Full-screen success.

**Elements:**
- Large green checkmark icon (center top)
- "تم البيع بنجاح" (Sale completed successfully)
- **Display sale number** (per CD-1, e.g., `A-000247`) — visible prominently for customer/cashier reference
- Total paid, payment method, change due (if any)
- Two large buttons: "طباعة الفاتورة" (Print receipt) and "بيع جديد" (New sale)
- Smaller link: "العودة للرئيسية" (Return to home)

**States:**
- **Default:** As above
- **Print in progress:** Print button shows spinner, disabled
- **Print success:** Brief checkmark animation on print button
- **Print failed:** Error toast appears, print button re-enabled
- **Offline:** No difference (printing is local)

### Screen 5: Exchange rate editor

**Layout:** Modal centered on screen, ~80% width.

**Elements:**
- Title: "تعديل سعر الصرف"
- Current value (large) with numeric input
- Last 5 rate changes (small list below)
- Save and Cancel buttons

**States:**
- **Default:** Pre-filled with current rate
- **Invalid:** Error message + Save disabled
- **Large change:** Warning shown + confirmation step
- **Saving:** Save button shows spinner

### Screen 6: Basic sale history (minimum spec for this epic)

This is the minimum sale history needed to support receipt reprint (Story 1.4) — NOT the full sales reporting view, which is Epic 3.

**Access:** Linked from the home screen (small "تاريخ المبيعات" link below the cards) and from the sale confirmation screen's "بيع جديد" button area (small "آخر المبيعات" link).

**Layout:** Single column list, newest first, scrollable.

**Each row shows:**
- `display_sale_number` (e.g., `A-000247`)
- `total_usd` (primary) and `total_syp` (secondary, smaller)
- `created_at` formatted relatively if today ("قبل 10 دقائق"), absolutely if older ("أمس 14:30" / "12/05/2026")
- `payment_method` icon (cash USD / cash SYP / card)
- Sync status indicator if not yet synced (small "في الانتظار" badge)
- A "إعادة طباعة" (Reprint) button per row

**Scope (this epic):** Shows sales from the **last 7 days** only. Beyond 7 days = Epic 3's full sales reporting.

**Tap a row:** Opens a read-only detail view with line items, totals, payment, and a "إعادة طباعة" button.

**Reprint behavior:** Regenerates the receipt from the stored sale record (NOT a snapshot of the original printout) and sends it to the connected thermal printer. The reprint is functionally identical to the original — same `display_sale_number`, same totals, same locked exchange rate.

**States:**
- **Default:** Populated list
- **Empty (no sales in last 7 days):** "لا توجد مبيعات في آخر 7 أيام"
- **Pending sync items present:** Items appear in the list with the "في الانتظار" badge; reprint works (data is local)
- **Reprint in progress:** Button shows spinner
- **Reprint failed:** Error toast + retry button (same flow as Story 1.4's print failure)

**Out of scope (Epic 3 will add):** Filters by date range, payment method, cashier; export; full search; aggregated totals; revenue summaries; everything beyond 7 days.

---

## Fields and validation

### Sale record (created when sale is confirmed)
| Field | Type | Required | Validation |
|---|---|---|---|
| sale_id | UUID | yes | Generated locally for offline support; used for sync and FKs |
| shop_id | UUID | yes | Tenant scope, per CD-2 |
| device_id | UUID | yes | Device that created the sale, per CD-2 |
| device_sequence | integer | yes | Per-device monotonic counter starting at 1, per CD-1 |
| display_sale_number | string | yes | Composite `{device_code}-{6-digit padded sequence}`, per CD-1; immutable after creation; unique per shop in practice (rare temp-code collisions flagged server-side per CD-1) |
| created_at | timestamp | yes | Local device time at confirmation |
| line_items | array | yes | At least 1 item |
| line_item.product_id | UUID | yes | Must exist in local product cache |
| line_item.quantity | integer | yes | ≥ 1 |
| line_item.unit_price_usd | decimal | yes | ≥ 0, copied from product at sale time |
| line_item.line_total_usd | decimal | yes | quantity × unit_price_usd |
| total_usd | decimal | yes | Sum of line totals |
| total_syp | decimal | yes | total_usd × exchange_rate_at_sale (stored for audit; SYP line totals are derived at print time, not stored) |
| exchange_rate_at_sale | decimal | yes | > 0 |
| payment_method | enum | yes | cash_usd, cash_syp, card |
| amount_received | decimal | yes (if cash) | ≥ total. **Currency = the currency of `payment_method`**: USD if `cash_usd`, SYP if `cash_syp`. Not applicable for `card`. |
| amount_received_currency | enum | yes (if cash) | USD or SYP — explicit denormalization to avoid any ambiguity in reports or reprints |
| change_due | decimal | yes (if cash) | `amount_received − total_in_payment_currency`. **Always in the same currency as `amount_received`.** |
| sync_status | enum | yes | pending, syncing, synced, error |

### Device registration record
| Field | Type | Required | Validation |
|---|---|---|---|
| device_id | UUID | yes | Generated on first app install |
| shop_id | UUID | yes | Set after first sign-in |
| device_code | string | yes | Short alphabetic code (1-3 chars) assigned by server after first sync. Until then, `T-{last 4 hex of device_id}` per CD-1. Code can change once (temp → permanent) on first sync; sales already recorded keep their original `display_sale_number`. |
| registered_at | timestamp | yes | When device first signed in |

### In-progress sale draft (local-only, per CD-3)
| Field | Type | Required | Validation |
|---|---|---|---|
| draft_id | UUID | yes | One active draft per device |
| device_id | UUID | yes | |
| shop_id | UUID | yes | |
| line_items | array | yes | Snapshot of current sale |
| selected_payment_method | enum | no | If user was on payment screen |
| amount_received_so_far | decimal | no | |
| updated_at | timestamp | yes | Updated on every change (debounced 200ms) |

Draft is local-only — NOT synced to server. Auto-purged after 24 hours or on sale confirmation/clear.

### Exchange rate record
| Field | Type | Required | Validation |
|---|---|---|---|
| shop_id | UUID | yes | Tenant scope |
| rate | decimal | yes | > 0 |
| set_at | timestamp | yes | Local device time |
| set_by | string | yes | "owner" placeholder until Epic 5 |
| device_id | UUID | yes | Which device set the rate |

---

## Edge cases

1. **Exchange rate of 0 or missing on first app launch:** App shows the rate widget in yellow and prompts owner to set it before allowing first sale. Block New Sale button with helper text.

2. **Sale with 0-priced item:** Allow (some shops give free items). Receipt prints "0".

3. **Cashier taps Pay twice quickly:** Debounce; only one payment screen opens.

4. **Cashier disconnects USB printer mid-print:** Print fails gracefully, sale remains recorded, error toast shows.

5. **Multiple devices, same shop, both offline, both sell same product:** Both sales record locally. On sync, both succeed (Epic 2 handles inventory negative scenarios). For Epic 1, sales just append. Display sale numbers do not collide in practice; in the rare event of a temp-code collision (two devices set up offline before either has synced), the server flags both sales for owner review per CD-1. The underlying `sale_id` UUID guarantees server-side uniqueness in all cases.

6. **App killed or backgrounded mid-sale on low-memory phone:** In-progress sale draft is auto-saved (CD-3). On app resume, user sees "بيع غير مكتمل — متابعة؟" banner (per CD-6 label table); tapping "متابعة" restores line items to the POS screen (cashier must re-tap "دفع" to proceed). Draft is NOT a replacement for full session restore — once user confirms or clears, draft is gone. Drafts older than 24 hours auto-purge.

7. **Receipt fails to print but sale already recorded:** Add "إعادة الطباعة" (Reprint) option from a basic sale history list (the minimum sale history view in this epic).

8. **Exchange rate changed mid-sale:** The in-progress sale uses the "locked sale rate" — the rate active when its first line item was added (Story 1.5). Subsequent rate edits do NOT alter the in-progress sale's SYP total. A notice appears in the sale panel: "تم تحديث السعر — البيع الحالي يستخدم السعر القديم". The new rate applies only to the next sale started after this one is confirmed or cleared. This prevents the cashier-quoted-one-price-then-it-changed-while-customer-was-paying scenario.

9. **Phone screen rotates during sale:** Layout adapts; current sale data is preserved.

10. **Storage quota exceeded (IndexedDB full):** Block new sales with clear error and instructions. Should never happen with normal usage but must not silently corrupt data.

11. **Time zone changes / device clock changed:** Sales record at local device time. Sync resolves any conflicts on server side.

12. **Very large sale (50+ line items):** Sale panel scrolls. Payment screen handles totals correctly. Receipt prints multiple pages if needed.

13. **Arabic product name with mixed numerals (123 شامبو دوف):** Renders correctly with bidirectional text handling.

---

## Definition of Done

- [ ] All 6 stories pass their acceptance criteria
- [ ] **Speed:** Cashier can ring a 5-item sale in under **30 seconds** on a phone end-to-end (design target). Maximum acceptable ceiling is 60 seconds; anything between 30-60s ships with a polish ticket attached.
- [ ] Receipt prints correctly in Arabic on at least 2 of the 3 supported printer models
- [ ] Receipt's display sale number is unique across the shop (no collisions across devices), per CD-1, and never changes after first print
- [ ] Sale works fully offline; syncs cleanly when network returns
- [ ] **Offline sync test — formal cycle definition:** A "cycle" = (a) device is offline, (b) cashier rings 3 distinct sales each with 2+ line items and a different payment method, (c) connection restored, (d) sync completes, (e) server confirms all 3 sales exist with correct totals, line items, payment method, display sale number, and no duplicates. **50 cycles must complete without any data loss, duplication, or display-sale-number collision.**
- [ ] **Multi-device collision test:** Run 10 cycles **simultaneously across 2 devices**, both offline, both ringing sales independently. After sync, verify zero `display_sale_number` collisions across both devices. This is the only test that exercises CD-1's cross-device guarantee — single-device cycles cannot catch this class of bug.
- [ ] **App-lifecycle test:** Open a sale with 5 line items, lock the phone screen, wait 10 minutes, unlock — sale state restored exactly. Repeat by force-killing the app from recents.
- [ ] Exchange rate edit propagates across the app in <1 second; widget accessible from both home screen AND POS screen header with identical behavior
- [ ] **Locked sale rate verified:** With an in-progress sale, editing the exchange rate does NOT change the in-progress sale's SYP total. New sales started after the edit use the new rate. Tested explicitly.
- [ ] Payment screen "رجوع" returns to method selection without losing the sale
- [ ] In-progress sale draft (CD-3) auto-purges after 24 hours and on confirm/clear
- [ ] All Arabic text renders correctly on phone, tablet, and desktop browsers (Chrome, Safari, Firefox)
- [ ] All UI labels match the label table (CD-6); no inconsistencies between English and Arabic forms in shipped UI
- [ ] Tap targets ≥56px on phone
- [ ] Tested on at least one cheap Android phone (~$100 device, e.g., Samsung A04) — including phone-call interrupt + return-to-app scenario
- [ ] Tested on at least one iPhone (iOS Safari)
- [ ] Tested on at least one Samsung Internet browser session (cheap Android default)
- [ ] Barcode scanning (USB + camera) successfully adds to current sale
- [ ] **USB scanner focus guard:** With the exchange rate editor open and focused, a scanner burst is intercepted and routed to product lookup, NOT typed into the rate field. Verified.
- [ ] **Camera HTTPS fallback:** Camera scan is gracefully unavailable (icon hidden or disabled with message) on HTTP or unsupported browsers, with no broken-camera error state visible to the user.
- [ ] **`amount_received_currency` populated correctly:** All cash sales have an explicit currency on `amount_received` and `change_due`. Verified with one sale of each cash payment method.
- [ ] Brother (customer #0) completes 3 real sales using the system
- [ ] All edge cases above either handled or explicitly documented as known limitations
- [ ] No console errors during normal flows
- [ ] Basic sale history list view exists (so reprint is possible) — full sales history reporting is Epic 3
