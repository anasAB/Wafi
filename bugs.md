QA Report: Sales History Page (/history)

Full exploratory + adversarial pass completed. This page turned out to be the most consequential one tested so far — one finding below is almost certainly the most severe bug found in this entire session.

BUG-H01 — Core business writes are silently rejected by backend RLS policies (data never persists)

STATUS: NOT FIXED — root cause still unconfirmed. Ruled out: JWT hook not registered, shop row missing/mismatched. Live-debugging session got diverted into a device-registration/stub-env/orphaned-shift investigation (see BUG-N01) before the original write-rejection could be re-tested against a clean device. Needs a fresh session: restart dev server with stub env vars disabled, log in, perform one write action, and check the sync panel again.

Severity: Critical | Priority: P0
Environment: Chrome, Windows, Vercel preview deployment, /history
Preconditions: Logged in as Owner ("Anas"); any action that writes data (sale, payment, return, stock adjustment)
Steps to Reproduce:

Perform any write action on this page (e.g., process a return via the "إرجاع" button, or a cash movement).
Open the sync panel ("فتح لوحة المزامنة" / click the "N معاملة متوقفة" banner).
Inspect the stalled-transaction list.

Expected Result: The action either succeeds and syncs to the server, or the user is clearly warned before/at the moment of action that it did not save.
Actual Result: The UI shows success (toast messages, closed modals, updated local state), but the sync panel reveals every write is being rejected with new row violates row-level security policy for tables sales, sale_payments, sale_line_items, stock_adjustments, audit_log, returns, and return_line_items. Clicking "إعادة المحاولة" (retry) fails again with the identical error, confirming this is a permanent server-side misconfiguration, not a transient network issue. The stalled-transaction counter climbed from 13 → 16 during this session purely from normal UI interaction.
Frequency: Always (every write action)
Regression: Unknown (no prior baseline)
Evidence Needed: Screenshot of sync panel error list (captured); this needs urgent backend/RLS policy review — no sale, payment, return, or stock change made through the UI is actually being saved to the database.

BUG-H02 — Internal database UUID leaks into customer-facing WhatsApp message

STATUS: FIXED — src/features/sale-history/useSaleHistory.ts (buildReceiptData) and src/features/pos/SaleConfirmationScreen.vue no longer fall back to the raw shop_id UUID when receipt_settings has no configured shop name; falls back to a generic "المتجر" label instead.

Severity: Critical | Priority: P0
Preconditions: Sale with no customer attached (walk-in); click "واتساب" on a sale row
Steps to Reproduce: Click "واتساب" for any invoice → observe the message body preview.
Expected Result: Message starts with the invoice header/customer name (or is blank for walk-in customers).
Actual Result: The very first line of the pre-filled, editable, and ultimately sendable message is a raw internal ID, e.g. d8483aaf-e4cb-45e6-8be4-15527d930058. This was confirmed to actually get sent through the generated wa.me/api.whatsapp.com link if the cashier doesn't notice and delete it manually.
Frequency: Always for walk-in (no customer) sales
Regression: Unknown
Evidence Needed: Screenshot of modal + captured outgoing WhatsApp URL (both captured).

BUG-H03 — Refunded invoice status/total never update in the UI

STATUS: NOT FIXED — not independently investigated this session; flagged from the start as likely a downstream symptom of BUG-H01, so blocked on that being resolved first.

Severity: High | Priority: P1
Steps to Reproduce: Process a full return on invoice D-000005 → close modal → reload page.
Expected Result: Status column reflects "مرتجع"/refunded (or similar), and the period total reduces to account for the refund.
Actual Result: Status remains "مدفوع" (Paid) and the total ("إجمالي: $155.00") is unchanged before and after the refund, even though the return modal correctly recognized the item as already returned on reopening (items list became empty). This is very likely a downstream symptom of BUG-H01, but the UI gives zero indication anything failed.
Frequency: Always
Regression: Unknown

BUG-M01 — Invoice number styled as a link but not clickable

STATUS: FIXED — no generic invoice detail view exists to wire this to, so went with the simpler safe fix: stripped the link-blue styling (src/features/sale-history/SaleHistoryScreen.vue, .sale-number) so it reads as plain text.

Severity: Medium | Priority: P2
Steps to Reproduce: Click the blue "D-000005" text in the invoice column.
Expected Result: Either it's plain text (no link styling) or it opens an invoice detail view.
Actual Result: It is a plain <span>/generic text node, not a button or link — clicking does nothing. Misleading affordance for users who expect to drill into invoice details.

BUG-M02 — WhatsApp phone validation error doesn't clear despite valid input, then submits anyway

STATUS: FIXED — src/features/messaging/components/WhatsAppPreviewSheet.vue now clears phoneError on input.

Severity: Medium | Priority: P2
Steps to Reproduce: In the WhatsApp modal, enter 0912345678 (the exact format shown in the placeholder example) → observe error persists → click send anyway.
Expected Result: Error clears once a valid number is entered; or, if it doesn't clear, sending should be blocked.
Actual Result: "رقم غير صالح" error stays visible, but clicking send proceeds successfully and opens WhatsApp with the number correctly normalized to 963912345678. The stale error message is simply never re-validated, actively confusing/misleading the user.

BUG-M03 — Silent no-op on invalid/incomplete submissions (no error feedback), recurring pattern

STATUS: FIXED — ReturnSheet.vue's handleConfirm and RecordCashMovementSheet.vue's confirm() now show a specific inline/toast error instead of silently returning.

Severity: Medium | Priority: P2
Steps to Reproduce: (a) Open return modal, don't select any item, click "تأكيد الإرجاع". (b) Open "حركة نقدية", enter a negative amount (e.g. -50), click "تأكيد".
Expected Result: A validation message explains why the action can't proceed.
Actual Result: Nothing happens in either case — no toast, no inline error, no shake/highlight. Button appears enabled/active the whole time. Users have no way to know why nothing occurred. (Contrast: entering an amount over the till's available cash does show a proper warning message — so the pattern is inconsistent across the same modal.)

BUG-L01 — Sync status panel cannot be dismissed via Escape or outside click

STATUS: FIXED — src/features/sync/SyncIndicator.vue now closes on Escape and has a visible header close (X) button; outside-click already worked.

Severity: Low | Priority: P3
Steps to Reproduce: Open sync panel → press Escape → click outside the panel.
Expected Result: Standard dialog dismissal patterns work.
Actual Result: Neither closes it; only clicking the original toggle button again closes it. No visible close (X) icon inside the panel itself. Accessibility/usability issue.

BUG-L02 — Keyboard tab order forces users through entire sidebar before reaching page content

STATUS: FIXED — src/App.vue: main content now comes first in DOM order (tab order follows DOM), sidebar kept in its original visual position via CSS `order: -1`.

Severity: Low | Priority: P3
Steps to Reproduce: Click into the page body, press Tab.
Actual Result: Focus jumps into the sidebar navigation (10+ links) before ever reaching the date-range tabs, search box, or payment filter, because the sidebar appears earlier in the DOM than the main content. Keyboard-only users face significant friction reaching this page's primary controls.

BUG-L03 — Pagination arrows stay visually enabled with only one page

STATUS: FIXED — src/features/sale-history/SaleHistoryScreen.vue now dims/greys disabled paginator buttons (opacity + not-allowed cursor); previously only hover states were conditioned on :disabled, base style looked identical either way.

Severity: Low | Priority: P3
Clicking next/prev/first/last with a single page does nothing harmful, but the controls aren't disabled/greyed out as would be expected.

BUG-L04 — Cosmetic: test cashier account displays "Casher" instead of "Cashier"

STATUS: NOT FIXED (not a code bug) — confirmed no "Casher" string exists anywhere in the codebase; this is a one-time seed/live data typo on a staff record. Needs a manual data fix in the DB/table editor, not a code change.

Severity: Low | Priority: P3
Seen on the Switch User screen and PIN entry header ("مرحباً Casher"). Likely a seed-data typo rather than a code bug, but worth a data fix if this account name is user-facing anywhere in production.

Blocking questions / ambiguities (not guessed at):

The return-reason dropdown ("سبب الإرجاع") has no configured options and tells the user to add them from settings — is this expected for a fresh install, and where exactly is that settings screen?
The refund methods "حوالة" (transfer) and "رصيد حساب" (account balance) appear disabled for a walk-in sale — intentional (no customer/account to credit) or a bug?

Not tested (flagged, not attempted): Actually completing "إغلاق الوردية" (close shift) or a user PIN login — both were opened to inspect the UI/validation but deliberately not completed, since closing the shift or switching accounts could disrupt your session/other collaborators, and entering a PIN would mean me authenticating as another user. Also skipped: clicking "حذف" (delete) on stalled sync items, since that's a permanent-deletion action. Responsive/mobile layout and cross-browser passes weren't done (same tooling limits noted in earlier pages).

Given BUG-H01, I'd treat this as the headline issue to relay to your dev team immediately — it means every sale, payment, refund, and stock adjustment made through this UI across your whole test session may not actually be saved server-side. Want me to continue on to another page, or would it help to pull the actual Supabase RLS policy definitions for those tables from one of your open Supabase tabs to include in the ticket?

same for this page  /products

79 steps
79 steps
QA Report: Products Page (/products)

This page surfaced a critical, highly disruptive input-handling bug plus several data-integrity and UI issues.

BUG-C01 — Global barcode-scan listener hijacks keyboard input from other focused fields (data entry corruption risk)

STATUS: FIXED — src/composables/useBarcodeScan.ts's handleKeyDown now bails out entirely (no burst detection, no preventDefault) whenever a real editable field is already focused, instead of only stripping the leaked first character after the fact.

Severity: Critical | Priority: P0
Preconditions: Any modal/form with a numeric input open (Edit Quantity, Add Product, etc.)
Steps to Reproduce:

Open "تعديل الكمية" (Edit Quantity) on any product, click into the quantity field, and type a multi-digit number (e.g. 99999).
Alternatively, open "إضافة منتج" (Add Product), click the cost-price field, and type a long number (e.g. 9999999999).
Close the modal.

Expected Result: Digits go only into the focused field.
Actual Result: The digits are intercepted by what appears to be a global "hardware barcode scanner" keystroke listener and get redirected into the page's product search/barcode field instead, triggering a "لم يُعثر على الباركود: [number]" (barcode not found) banner — this happened twice, independently, in two different modals. This is a serious bug for a POS/inventory system: any cashier typing a multi-digit quantity or price quickly (which is normal) risks having that number silently diverted into a barcode lookup instead of the field they're editing, with no way to tell why their entry didn't register.
Frequency: Reproduced twice, appears to depend on typing speed/digit count (looks like a heuristic distinguishing "human typing" from "scanner input" that's too aggressive and not scoped to check current focus).
Regression: Unknown
Evidence Needed: Screenshots captured showing the leaked banner in both scenarios.

BUG-C02 — "Barcode not found" banner cannot be dismissed and persists indefinitely

STATUS: FIXED — src/features/products/ProductsPage.vue now has a dismissMissedBarcode() close (X) button on the banner.

Severity: Medium | Priority: P2
Steps to Reproduce: Trigger a barcode-not-found state (see above) → try clearing the search box, clicking the small QR icon button, or navigating within the SPA.
Actual Result: None of these dismiss the banner; it has no close (X) control at all. Only a hard page reload clears it. Compounds BUG-C01's impact since an accidental barcode trigger becomes a stuck, unremovable banner.

BUG-H01 — Actions dropdown menu renders off-screen/clipped for the first product row

STATUS: FIXED — src/features/products/components/ProductList.vue's kebab dropdown now measures itself after opening and flips to anchor from the other side (kebab-dropdown--flip) whenever it would overflow the viewport.

Severity: Medium-High | Priority: P2
Steps to Reproduce: Click "الإجراءات" (Actions) on the first product row ("Tess cups").
Expected Result: Dropdown appears fully within the viewport.
Actual Result: The menu opens clipped against the left edge, showing only icons and truncated text ("تعد ⊡", "تعد ✏", "حذ 🗑"), forcing an unwanted horizontal scrollbar to appear on the whole table. Only after manually scrolling the table left can the full labels ("تعديل الكمية", "تعديل البيانات", "حذف") be read. A floating menu that overflows its container like this is a classic positioning bug (should flip to open rightward/inward when near an edge).

BUG-H02 — Opening "Merge Category" dialog silently creates a persistent "Uncategorized" category

STATUS: FIXED — src/features/categories/components/CategoriesManagementScreen.vue no longer calls ensureFallbackCategory() on dialog open; the picker shows a synthetic pending-fallback option instead, and it's only materialized in the database if the user actually confirms it as their choice.

Severity: High | Priority: P1
Steps to Reproduce: Go to "إدارة الفئات" (Manage Categories) → click "دمج" (Merge) on any category → observe the merge-target list includes "غير مصنف" (Uncategorized) → click "إلغاء" (Cancel) without selecting anything.
Expected Result: Cancelling should leave category data unchanged.
Actual Result: A new "غير مصنف" category permanently appears in the category list afterward — confirmed to persist across a full page reload. Nothing was submitted or confirmed; simply viewing then cancelling the dialog left a new database record behind.
Frequency: Reproduced once, straightforward to re-test.

BUG-M01 — Edit Quantity input shows blank while focused after select-all + retype, even though the value is tracked correctly underneath

STATUS: FIXED — src/features/products/components/QuickStockSheet.vue's quantity field switched from type="number" + v-model.number to a plain-text input driven by its own display ref, so what's on screen always matches exactly what was typed.

Severity: Medium | Priority: P2
Steps to Reproduce: Open Edit Quantity → triple-click the quantity number to select it → type a replacement digit.
Actual Result: The visible field goes empty while still focused (though the "+/-N" delta hint below it is correct), and only redraws the correct number once you click away/blur. Confusing enough that a user could believe their input was lost and retype, causing an incorrect final quantity.

BUG-M02 — Category management list flashes an incorrect "no categories" empty state before real data loads

STATUS: FIXED — src/features/categories/components/CategoriesManagementScreen.vue now has a distinct loading state shown until the initial load() resolves.

Severity: Medium | Priority: P2
Navigating to "إدارة الفئات" briefly shows "لا توجد فئات بعد. أضف أول فئة أعلاه" (no categories yet) for roughly a second before the real 4 categories render. No loading skeleton/spinner is shown to distinguish "still loading" from "genuinely empty," risking users clicking to add a duplicate category during that window.

BUG-L01 — Inconsistent numeric validation between related fields

STATUS: FIXED — src/features/products/components/ProductForm.vue's validate() now rejects a negative low-stock threshold with a clear message, matching the other numeric fields.

Severity: Low | Priority: P3
In the product edit form, the cost-price field rejects a typed -5 back to empty (silently, no message), while the "حد التنبيه للمخزون" (low-stock alert threshold) field on the same form happily accepted and retained -5 with no validation at all — a negative stock-alert threshold makes no business sense and should be blocked with a clear message like the other numeric fields.

BUG-L02 — Recurring pattern: silent no-op on invalid/empty submissions (same issue as History page)

STATUS: FIXED — src/features/categories/components/CategoriesManagementScreen.vue's addCategory/addSubcategory now show an inline message on an empty name instead of silently returning.

Severity: Low-Medium | Priority: P3
Confirmed again here: clicking "إضافة" (Add) with an empty new-category name field does nothing with zero feedback, consistent with the same silent-failure pattern found on the Sales History page's modals. By contrast, adding a duplicate category name does show a clear message ("هذه الفئة موجودة بالفعل") — so the pattern is inconsistent, not universal.

BUG-L03 — "Deficit trend" stat shown even when there is no inventory-count history

STATUS: FIXED — src/features/stock-take/components/StockTakeHistoryScreen.vue's trend card now only renders when sessions.length > 0.

Severity: Low | Priority: P3
On "سجل الجرد" (Inventory Count Log), a card reading "$0.00 — اتجاه العجز (آخر 3 عمليات)" (deficit trend, last 3 operations) is displayed at the same time as "لا يوجد سجل جرد بعد" (no inventory log yet exists). Showing a "$0.00 trend" stat when there's literally no data is misleading; it should be hidden or show a "not enough data" state instead.

Positive findings worth noting: Add Product's required-field validation is solid (clear red "هذا الحقل مطلوب" messages per field on empty submit), and category-name duplicate detection is correctly case-insensitive ("cups" correctly flagged as duplicate of "CUps").

Not tested / deliberately skipped: Actually completing an Excel import (opened the import screen, didn't select/upload a file since I had no legitimate file and uploads need your explicit go-ahead), starting a real inventory count (would freeze live stock quantities store-wide — too disruptive to trigger without asking first), and deleting/merging any category or product for real (both are permanent/destructive actions I avoid without your explicit confirmation). I also did not download the Excel import template, since downloads need your approval.

Given BUG-H02 created a real stray "Uncategorized" category in your test data, let me know if you'd like me to point you to it so you (not me, since it's a deletion) can remove it. Want me to move on to another page next, or dig deeper into any of these findings first?

BUG-N01 — No warning when signing in on a device with an orphaned open shift elsewhere; owner's zombie-shift list lacks device identity to disambiguate

STATUS: PARTIALLY FIXED — item (2) is fixed: ShiftHistoryScreen.vue's open/zombie shift cards and ForceCloseSheet.vue now both show the device code (e.g. "جهاز A"). Item (1) — warning the cashier at login/open-shift time that an open shift already exists elsewhere — was NOT implemented this session.

Severity: Medium | Priority: P2
Discovered: manual testing session, not the original page-by-page QA pass.
Context: Shifts are scoped per-device (`cashier_shifts.device_id`, see `findOpenShiftForDevice()` in `src/features/shifts/composables/useShift.ts:152-160`). If a device's local storage is cleared (or a cashier logs in on a genuinely new device) while a shift is still open under the old device_id, that shift becomes "orphaned" — invisible to the new device's own open-shift lookup — until an owner sweeps it via the Shift History screen's zombie-shift filter (WAFI-065) and force-closes it. This per-device scoping is correct/by-design, not itself a bug.
Two real gaps in the surrounding UX:
1. Nothing tells the cashier, at login/open-shift time, that an open shift already exists for this shop under a different device. They just see a normal "open a new shift" screen with no hint anything is wrong, and have no way to know to go tell the owner.
2. The owner's zombie-shift card (`src/features/shifts/components/ShiftHistoryScreen.vue:276-333`) shows cashier name, opening cash, and duration/"مفتوحة منذ فترة طويلة" — but no device identifier (device code/letter, e.g. "A"/"B", or any device name). If more than one device ends up with an orphaned shift at the same time, the owner has no way to tell which physical register each card corresponds to, since staff name alone doesn't disambiguate a cashier who worked on two different devices, or two different cashiers whose names aren't visually distinct at a glance.
Expected Result: (1) login/open-shift flow surfaces a clear signal when an open shift already exists for the shop under another device, so the cashier knows to escalate rather than just opening a new one blind. (2) Each open/zombie shift card in Shift History shows which device it belongs to (device code at minimum), so an owner managing multiple registers can confidently force-close the right one.
Also confirmed in `src/features/shifts/components/ForceCloseSheet.vue` — the force-close confirmation sheet itself (expected cash, counted cash, variance, optional reason) never displays a device identifier either, so even the final confirm step gives the owner no way to double check they're about to force-close the right device's shift.
Not yet fixed: flagged for the /history or shifts-domain implementation plan alongside the other page bugs.