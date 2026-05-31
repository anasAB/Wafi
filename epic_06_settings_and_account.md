# Epic 6 — Settings and Account Control

**Epic ID:** EPIC-06
**Pack:** Core (personal preferences and shop settings) — some sections gated by other packs (see Cross-cutting decisions)
**Depends on:** Epic 1 (exchange rate, receipt template fields, device codes), Epic 2 (low-stock threshold default), Epic 3 (business day start), Epic 5 (employees, roles, permission framework — when Staff Pack is active)
**Blocks:** None — but several other epics reference settings stored here (receipt header on Epic 1, business day start on Epic 3, default low-stock threshold on Epic 2). Those epics must read from this epic's data model, not from hardcoded constants.

---

## Epic summary

**Goal:** A single, predictable place where the owner controls the shop (shop name, tax number, receipt template, exchange rate history, hardware, business day, billing, devices, data export) and where every user — owner, manager, cashier — controls their own experience (language, light/dark mode, notifications, sign-out).

**Value delivered:** Three things at once.
1. **Brother can localize his shop to his preferences in one session** — name, tax number, receipt footer, business day start, default printer — without asking us. This is the difference between a demo and a real install.
2. **Every owner who installs the PWA in a different city or vertical can self-configure without our help.** Self-serve onboarding (a v1 commitment) is impossible without this epic.
3. **Every cashier can pick their language and theme on shared devices** — a phone passed between two cashiers should not force one of them into the wrong language.

**In scope:**
- Personal preferences (per-user, per-device): language (Arabic/English), theme (light/dark/auto), text size, notification preferences, biometric unlock toggle, sign out.
- Shop profile (owner only): shop name (Arabic + optional English), address, phone, tax number, logo upload, default currency display preference, business day start time, default low-stock threshold.
- Receipt template editor (owner only): logo, header text, footer text, what to show/hide (cashier name, tax number, exchange rate line, SYP totals, sale number, customer name on credit sales).
- Exchange rate management (owner/manager only): viewing full history, the editor itself lives in Epic 1 — this epic adds the history view and "rollback" affordance.
- Hardware setup (owner only): registered printers (manage list, set default, test print), barcode scanner mode (USB vs camera fallback), cash drawer trigger toggle.
- Devices (owner only): list of devices that have signed into the shop, device codes (per Epic 1 CD-1), last sync, remote sign-out.
- Plan & billing (owner only): current pack list, billing contact, invoices link, upgrade/downgrade entry point (the full billing flow is later — this is the entry point).
- Data & sync (owner only): manual sync, last sync timestamp, queued-writes count, Excel/CSV export-all, clear local cache.
- About: app version, last update, link to terms, link to privacy, support WhatsApp number, app diagnostic info copy-button (for support tickets).
- Full offline operation: every screen renders offline; changes queue for sync; the few settings that require server-side acknowledgement (e.g., upgrading a pack) clearly say so.

**Out of scope:**
- The exchange rate editor itself — already in Epic 1, Story 1.5. This epic only adds the **history view** and **rollback** action.
- Employees CRUD, PIN management, role assignment — Epic 5.
- Sync layer internals — chosen at the architecture spike, not here.
- Receipt language switching per receipt (each receipt prints in the shop's chosen receipt language; per-customer language is v1.5).
- OAuth/SSO, multi-shop switcher (one user, multiple shops) — v1.5.
- Password reset flows for owner forgotten PIN — Epic 5 documents this as a known limitation; this epic does not add a recovery flow.
- Custom receipt template designer with arbitrary layout — v1.5. This epic supports a fixed template with toggles and text fields only.
- Subscription payment processing — the billing screen is read-only in this epic; payment collection is handled out-of-band (per CLAUDE.md collection strategy: cash by helper, USD wire, USDT, hawala). This epic shows current state, not "pay now".
- **OS-level push notifications** — v1.5. v1 ships in-app notifications only per CD-11.
- **Concurrent-edit merge UI** ("Device A says X, Device B says Y, which do you want?") — v1.5. v1 uses last-write-wins with a conflict-surfacing toast for the three CD-12 high-sensitivity fields.
- **Cross-device sync of personal preferences** — v1.5. v1 keeps language/theme/text-size per-device-per-user.
- **Background export with notification when ready** — not in roadmap; PWA lifecycle on iOS Safari is too unreliable to commit to. v1 keeps the user on the export screen with clear messaging (per CD-9).

---

## Cross-cutting decisions (read before implementation)

### CD-1 — Personal preferences vs. shop settings (the central distinction)

Settings split into two scopes. The distinction must be visible everywhere — in navigation, in data model, in sync behavior. Developers must never store a personal preference in shop scope or vice versa.

- **Personal preferences** = belong to **one user on one device**. Examples: language, theme, text size, notification toggles, biometric unlock. Stored per `(employee_id, device_id)`. Do NOT sync across devices in v1. Persist locally. If the cashier signs in on a new device, they get device defaults; they re-pick. (Cross-device personal sync is a v1.5 nice-to-have, not v1.)
- **Shop settings** = belong to **the shop**. Examples: shop name, tax number, receipt template, business day start. Stored at shop scope. Sync to every device. Edit requires the "change shop settings" permission (Owner only per Epic 5's table).

This means the same physical screen ("Settings") presents two different scopes side by side. The screen organisation (see Screens section) groups them into clearly labelled sections so the user never confuses "this affects my phone" with "this affects everyone's phones".

### CD-2 — Language switching is global to the app and immediate

Language toggle (Arabic / English) takes effect immediately, without an app restart. RTL/LTR direction flips, all UI strings re-render, the keyboard input direction follows. Receipt template language is **separate** — switching app language does NOT auto-switch receipt language (the cashier may speak English but receipts must remain Arabic for customers).

Arabic is the **default** for first-time install. English is opt-in. The detection rule on first install: check device locale; if Arabic-family, default to Arabic; otherwise default to Arabic anyway (because our market is Arabic-speaking shops, and overshooting English-default would be wrong for the 95% case). User can switch at any time.

### CD-3 — Theme: light, dark, follow-system

Three options: Light, Dark, Auto (follow device system). Default = Auto. Theme applies to every screen including POS, Back Office, and printed receipt preview (printing itself is always black-on-white — theme does not affect physical printer output).

Both themes must pass WCAG AA contrast on the cheap Android tablets in our test pool. No "high contrast" mode beyond this in v1.

### CD-4 — Settings access path and role-gated visibility

There is **one** Settings entry point in the app: a gear icon in the global header (top-end), visible on every screen except the PIN sign-in screen and the active-shift Close screen (don't tempt cashiers into settings during a cash count).

Inside Settings, sections are **hidden** (not disabled) for users without permission, per Epic 5's `canUserDo(user, action)` framework. A Cashier signed in sees only the "Personal" and "About" sections. A Manager sees those plus a read-only view of shop profile and a partial read-only billing summary, plus the exchange rate history. An Owner sees everything.

The hidden-vs-disabled choice matches Epic 5's preference for hidden controls over disabled ones. The exception: the gear icon itself is always visible — even a cashier opens Settings to change their own language.

### CD-5 — All settings changes are audited

Every shop-settings change writes an audit log entry (per Epic 5 Story 5.8). The audit log is the source of truth for "who changed the tax number last Tuesday". Personal preferences are NOT audited (no one cares which theme the cashier picked). The list of audited settings:

- Shop profile (any field)
- Tax number (separate entry — high-sensitivity field)
- Receipt template (any change — store before/after snapshot of the full template object)
- Business day start
- Default low-stock threshold
- Default currency display
- Default printer
- Cash drawer trigger toggle
- Barcode scanner mode

If Epic 5 (Staff Pack) is not active for this shop, the audit log is not displayed in the UI, but entries are still written locally so they're available when/if the pack is activated later. This matches the wholesale-aware schema principle: collect once, use later.

### CD-6 — Logo upload constraints

Logo is uploaded by the owner for two uses: receipt header (thermal print) and customer statement PDF header (Epic 4). One image serves both. Constraints:
- Formats accepted: PNG, JPG, WebP, SVG.
- Max file size: 2 MB (we compress to 500 KB on save).
- Square or wide rectangle works; we display at fixed 200×80 px on receipt and 400×160 px on statement.
- Black ink only on thermal print — if logo has color, we auto-convert to high-contrast black-and-white for printing, but keep the color version for the PDF statement and for on-screen display.
- **Logo history is capped at 3 logos per shop, FIFO eviction.** When the owner removes a logo or uploads a 4th, the oldest is permanently deleted. Why: a shop changing logos rarely will benefit from a "switch back" affordance without unbounded storage growth. The cap is intentionally small — this is not a logo gallery feature; it's a safety net for "I removed it by accident". Time-based retention (e.g., "90 days then delete") is deliberately avoided because it causes silent surprise failures ("why did my receipt logo disappear?").

### CD-7 — Tax number is a soft field, not enforced

Some Syrian shops have a tax number (الرقم الضريبي), most don't. The product does not gate any functionality on tax number presence. If empty, the receipt simply omits that line. If present, it prints. No validation beyond "max 50 characters, any string" — formats vary too much across the region to enforce.

### CD-8 — Device list and remote sign-out

Per Epic 1's CD-1, every device that signs in gets a code (`A`, `B`, `C`...). This epic surfaces that list to the owner. The owner sees each device with: code, friendly name (defaults to "Phone — Samsung A14" inferred from user agent; editable), last sign-in, last sync, currently-signed-in cashier (if any), shifts opened on this device.

The owner can **remote sign-out** a device. This:
1. Writes a sync record marking that device's session as terminated.
2. Next time the device syncs, it forcibly signs out and returns to the PIN screen.
3. If the device is offline at the time of remote sign-out, the termination applies as soon as the device comes back online.

**Open shift handling on remote sign-out:** the confirmation dialog offers a peer-level checkbox *"إغلاق الوردية المفتوحة أيضاً"* (Also close the open shift). Default is **unchecked** because closing a shift without a real cash count creates a phantom variance the owner has to explain later. If the owner checks it, the shift is force-closed by the same mechanism Epic 5 uses (force-close by owner), with `closing_cash_*` set equal to `expected_cash_*` (zero computed variance) and the close-note set to *"إغلاق عن بُعد — لم يتم عد النقد"* (Remote close — cash not counted). The audit log records both the remote sign-out and the force-close as separate entries.

If the checkbox stays unchecked, the shift remains open until the cashier signs back in and closes it normally, or until the owner force-closes it from the Shifts UI (Epic 5). The dialog explains this consequence in plain text so the owner makes an informed choice.

Remote sign-out (and the optional force-close) is audit-logged.

### CD-9 — Data export

"Export all data" produces a ZIP containing CSV files (one per entity: products, customers, sales, sale_lines, expenses, customer_transactions, shifts, stock_adjustments, audit_log). UTF-8 encoded, BOM included so Excel opens Arabic correctly. Filenames in English (e.g., `products.csv`) for cross-platform safety. The ZIP includes a small `README.txt` with column descriptions in Arabic and English.

Export is generated client-side from local data — works offline. We do not commit to a specific export duration because the device pool we serve ranges from cheap Android phones to desktop browsers, and shop data ranges from a few hundred to hundreds of thousands of rows. Instead:

- **Estimate before starting.** When the user taps Export, we count entities and show an estimate based on row count: small (<5k rows total) → "بضع ثوانٍ"; medium (5k–50k) → "أقل من دقيقة"; large (>50k) → "قد تستغرق عدة دقائق — اترك التطبيق مفتوحاً".
- **Progress is visible and granular.** Show entity-by-entity progress ("جاري تصدير المبيعات... 3,200 / 12,400") and total ZIP-assembly status. The user sees forward motion at all times.
- **Cancel is always available** during export. Cancelling discards the partial file.
- **Streaming write.** For large datasets, write entities to disk (browser File System API where available) one at a time and append to the ZIP incrementally rather than holding everything in memory. On browsers without File System API, fall back to in-memory generation with a clear pre-export warning if the estimated size exceeds 100 MB.
- **No "background export with notification."** Tried-and-true on native, fragile on PWA across iOS Safari, Android Chrome, and desktop browsers. Promising it and not delivering is worse than asking the user to keep the app open.

We do NOT publish minimum device requirements. Syrian shops use whatever device they have; the product adapts. If a shop's data set genuinely cannot export on their device, that's a support case, not a customer-facing limitation.

This export satisfies the v1 commitment "One-click Excel export anytime. Your data is yours" (CLAUDE.md objection responses).

### CD-10 — Settings affect other epics — propagation rules

Settings touched here are read by other epics. The rule: **other epics must read settings through a versioned API**, not by hardcoded reference. Specifically:

- Receipt template (Epic 1's print job) reads from a `getReceiptTemplate()` function exposed by this epic.
- Business day start (Epic 3's "today" boundary) reads from `getBusinessDayStart()`.
- Default low-stock threshold (Epic 2's new product default) reads from `getDefaultLowStockThreshold()`.
- Exchange rate widget (Epic 1, Epic 3) writes to the same store this epic reads from for the history view.

When a setting changes, all open screens must reflect the change within 2 seconds without manual refresh (use a simple reactive store — Vue 3's reactivity is sufficient; no extra pub-sub needed).

### CD-11 — Notifications are in-app only in v1; push is v1.5

PWA push notifications behave inconsistently across browsers: iOS Safari requires the PWA to be installed to home screen and iOS 16.4+, Android Chrome works reliably, desktop Safari is partial, Firefox has its own quirks. Building a notification feature that silently fails on a third of our users is worse than not building one.

For v1:
- **In-app toasts and indicators only.** Low-stock count is already visible on the home screen card (Epic 3); sync failure shows as a banner; shift variance shows on close. These are notifications in the useful sense — visible when the user is in the app.
- **No service-worker push, no system-level notifications.** Deferred to v1.5 along with the daily WhatsApp digest, which covers the "owner is away from the shop" use case better than push anyway (WhatsApp is universal and reliable; PWA push is not).
- **The Notifications preferences screen still exists** in v1 — it lets the user toggle which in-app indicators fire and at what threshold. The toggles control existing in-app surfaces, not OS-level notifications.

This means Story 6.14 in v1 is about controlling the **noisiness of the app's own UI**, not about pushing to the device OS. The wording across the screen reflects this — no "allow notifications" prompts to the browser, no permission dance.

When v1.5 adds push, the same preference toggles extend to control push delivery; we don't have to rebuild the preferences UI.

### CD-12 — Conflict resolution for concurrent settings edits

The sync layer uses last-write-wins by timestamp as the baseline for all settings (matches Epic 5's audit log model and Epic 4's customer record model). This is correct for most settings — two owners editing the shop phone number concurrently is rare, and either value is acceptable.

For three specific settings, last-write-wins is not safe enough because a wrong value silently appears on every receipt the shop prints from that moment forward:
1. **Tax number** (الرقم الضريبي)
2. **Receipt template** (any field within it)
3. **Shop Arabic name** (printed on every receipt)

For these three, v1 adds a **save-time confirmation step** before the change is committed locally: a dialog summarizing the change ("سيظهر هذا الرقم على جميع الفواتير الجديدة. هل أنت متأكد؟"). This catches the common case — a human typing the wrong number — which is far more frequent than the concurrent-edit case.

Concurrent-edit detection with a merge-prompt UI ("Device A changed this to X, Device B changed it to Y, which do you want?") requires conflict-detection plumbing we don't have in v1 and shouldn't build speculatively. It moves to **v1.5**. In v1, concurrent edits on these three fields resolve last-write-wins but are flagged in the audit log with both the winning and losing values stored, plus a short-lived **toast on the losing device** the next time the owner opens Settings: "تم تغيير [الرقم الضريبي] من جهاز آخر — تأكد من القيمة الحالية". This costs almost nothing to build and surfaces the conflict to a human who can decide.

---

## User stories

### Story 6.1 — Switch language between Arabic and English

**As any** user
**I want to** switch the app between Arabic and English
**So that** I can use it in the language I'm comfortable with

**Acceptance criteria:**

- **Given** I tap the gear icon in the global header
  **When** Settings opens
  **Then** I see a "Personal" section at the top with a "Language" row showing my current language

- **Given** I tap the Language row
  **When** the selector opens
  **Then** I see two options: "العربية" and "English", with a radio next to the active one

- **Given** I pick the other language
  **When** I tap it
  **Then** the selector closes immediately and the entire UI re-renders in that language within 1 second, including layout direction (RTL ↔ LTR)

- **Given** I changed the language
  **When** I navigate to any other screen (POS, Back Office, home)
  **Then** that screen is also in the new language — no app restart, no logout

- **Given** I switch from Arabic to English
  **When** I view a screen that has product names
  **Then** product Arabic names still display in Arabic (they are data, not UI strings); English names display where available; if only Arabic name exists, it shows in Arabic regardless of UI language

- **Given** I am on the POS screen with a sale in progress
  **When** I switch language
  **Then** the sale state is preserved (line items, payment in progress) — only the surrounding UI re-labels

- **Given** I am offline
  **When** I switch language
  **Then** the change applies immediately (language packs are bundled, not fetched)

- **Given** another user signs in on this same device
  **When** they sign in
  **Then** the language preference is theirs, not mine (per-user personal preference per CD-1)

- **Given** I am a first-time user opening the app
  **When** the app loads before any sign-in
  **Then** the UI is in Arabic (default per CD-2)

---

### Story 6.2 — Switch theme: light, dark, follow system

**As any** user
**I want to** pick light mode, dark mode, or "follow my device"
**So that** the screen is comfortable for my eyes in the shop's lighting

**Acceptance criteria:**

- **Given** I am in Settings → Personal
  **When** I view the "Theme" row
  **Then** I see three options: "فاتح" (Light), "داكن" (Dark), "تلقائي" (Auto — follow device)

- **Given** Auto is the default for a new install
  **When** my device is in dark mode
  **Then** the app uses the dark theme

- **Given** Auto is selected
  **When** my device switches between light and dark (e.g., night mode at sunset)
  **Then** the app theme follows the change within 2 seconds

- **Given** I explicitly pick Light or Dark
  **When** my device theme later changes
  **Then** the app stays on the theme I picked (explicit choice overrides Auto)

- **Given** I switch theme
  **When** the change applies
  **Then** every screen including modals, dialogs, the global header, and the POS screen updates immediately — no flicker, no remount

- **Given** the dark theme is active
  **When** I view all screens
  **Then** all text passes WCAG AA contrast, no element is invisible (e.g., low-contrast borders), and color-coded indicators (red for low stock, green for positive variance) still read correctly

- **Given** I print a thermal receipt
  **When** the printer outputs
  **Then** output is the same regardless of theme (CD-3 — print is always black-on-white)

- **Given** I view the receipt preview before printing
  **When** the preview shows
  **Then** the preview shows the printed appearance (black-on-white paper) regardless of app theme

- **Given** another user signs in on this device
  **When** they sign in
  **Then** their theme preference applies (per-user per CD-1)

---

### Story 6.3 — Adjust text size

**As an** older shop owner with weaker eyesight
**I want to** make the text bigger
**So that** I can read the POS without squinting

**Acceptance criteria:**

- **Given** I am in Settings → Personal
  **When** I view the "Text size" row
  **Then** I see four options: "صغير" (Small), "عادي" (Default), "كبير" (Large), "كبير جداً" (Extra large)

- **Given** I pick Large or Extra large
  **When** the change applies
  **Then** all text scales proportionally on every screen, with layout adjusting so nothing clips or overflows

- **Given** I picked Extra large
  **When** I view the POS product grid
  **Then** product cards become larger (fewer per row) but the tap target on each card never shrinks below 56px (Epic 1's WCAG-compliant minimum still holds)

- **Given** I am viewing the home screen cards (Epic 3)
  **When** text size is Extra large
  **Then** the cards remain readable — numbers are still the visual anchor; labels wrap to a second line if needed; no overflow

- **Given** I switch text size while in a modal
  **When** the change applies
  **Then** the modal re-flows correctly without closing

- **Given** I print a thermal receipt
  **When** the printer outputs
  **Then** print font size is independent of app text size (thermal printer has its own fixed sizes per ESC/POS)

---

### Story 6.4 — Edit shop profile (name, address, tax number, logo)

**As an** owner
**I want to** set my shop's name, address, contact info, tax number, and logo
**So that** receipts and statements look professional and identify my shop correctly

**Acceptance criteria:**

- **Given** I am the owner
  **When** I open Settings
  **Then** I see a "Shop profile" section

- **Given** I tap "Shop profile"
  **When** the editor opens
  **Then** I see fields: Arabic name (required), English name (optional), address (optional, multi-line), phone (optional), tax number (optional), logo (upload area, optional)

- **Given** I am a Manager (per Epic 5 permissions)
  **When** I open Shop profile
  **Then** the section opens in **read-only** view — I can see all values, no Save button visible

- **Given** I am a Cashier
  **When** I open Settings
  **Then** the "Shop profile" section is hidden entirely (per CD-4)

- **Given** I edit a field as Owner
  **When** I tap "حفظ" (Save)
  **Then** the change saves locally, an audit log entry is created (per CD-5), a toast confirms "تم الحفظ"

- **Given** I am editing the **tax number**, the **shop Arabic name**, or any **receipt template** field (Story 6.5)
  **When** I tap Save
  **Then** before the change commits, a confirmation dialog appears: "سيظهر هذا على جميع الفواتير الجديدة. هل القيمة الجديدة صحيحة؟ [new value]" with "تأكيد" / "تعديل" — this is the CD-12 save-confirmation guard, applied only to these three high-sensitivity fields

- **Given** I confirm the change in the dialog
  **When** the commit completes
  **Then** the audit log entry is written, the toast confirms, and the new value propagates per CD-10

- **Given** I tap "تعديل" in the confirmation dialog
  **When** the dialog closes
  **Then** focus returns to the field so I can correct the typo without losing other unsaved changes on the form

- **Given** another device changed the tax number, shop Arabic name, or receipt template while I was offline
  **When** I sync and open Settings
  **Then** a non-blocking toast appears: "تم تغيير [field name] من جهاز آخر — تأكد من القيمة الحالية" with a link that scrolls to and highlights the changed field (per CD-12 conflict-surfacing rule)

- **Given** I leave the Arabic name empty
  **When** I tap Save
  **Then** I see "اسم المتجر مطلوب" and Save is blocked

- **Given** I enter a tax number
  **When** I save
  **Then** any value up to 50 characters is accepted, any format (per CD-7)

- **Given** I upload a logo
  **When** the file is selected
  **Then** the image is compressed to <500KB and stored locally; preview shows immediately

- **Given** I upload a logo larger than 2 MB
  **When** the upload completes
  **Then** I see "حجم الصورة كبير جداً — الحد الأقصى 2 ميجا"

- **Given** I have a color logo
  **When** I save
  **Then** both color and high-contrast B&W versions are generated and stored (per CD-6)

- **Given** I already have 3 historical logos and I upload a 4th
  **When** the upload commits
  **Then** the oldest logo is permanently deleted (FIFO eviction per CD-6); a small note in the upload area shows "تم استبدال الشعار الأقدم"

- **Given** I tap "إزالة الشعار" (Remove logo)
  **When** I confirm
  **Then** the receipt and statement no longer show a logo, but the file is retained in the 3-logo history per CD-6 so I can re-enable from a "الشعارات السابقة" sub-section without re-uploading

- **Given** I open "الشعارات السابقة"
  **When** I view the history
  **Then** I see up to 3 past logos as thumbnails with "استخدم هذا" buttons; tapping promotes that logo to active

- **Given** I change any field
  **When** the next receipt prints (Epic 1) or the next statement generates (Epic 4)
  **Then** the new values appear immediately (per CD-10 propagation rule)

- **Given** I am offline
  **When** I save changes
  **Then** changes queue for sync, the UI updates immediately, an audit log entry is created locally

---

### Story 6.5 — Customize the receipt template

**As an** owner
**I want to** control what appears on my printed receipts
**So that** they match my shop's brand and avoid printing details I don't want shown

**Acceptance criteria:**

- **Given** I am the owner in Settings
  **When** I open "Receipt template"
  **Then** I see two columns on desktop (single column scroll on phone): on the left, a **live preview** of a sample 80mm receipt; on the right, the toggles and text fields

- **Given** I view the right-side controls
  **When** I look at the available options
  **Then** I see:
  - **Header text** (free text, max 200 chars, multi-line, default empty — useful for slogan or extra contact info)
  - **Footer text** (free text, max 200 chars, multi-line, default "شكراً لزيارتكم")
  - **Receipt language** (Arabic / English) — independent of app language per CD-2
  - **Show logo** (toggle, default on if logo uploaded)
  - **Show tax number** (toggle, default on if tax number set)
  - **Show sale number** (toggle, default on — recommended for reprint/lookup)
  - **Show cashier name** (toggle, default on — only meaningful when Staff Pack active per Epic 5)
  - **Show customer name on credit sales** (toggle, default on — only meaningful when Customer Pack active per Epic 4)
  - **Show SYP totals** (toggle, default on — turn off if shop wants USD-only receipts)
  - **Show exchange rate line** (toggle, default on — turn off if not showing SYP)
  - **Show shop address** (toggle, default off — many shops omit address from receipt for privacy/space)
  - **Show shop phone** (toggle, default off)

- **Given** I change any toggle or text field
  **When** the change applies
  **Then** the left-side preview updates within 500ms to reflect the new template

- **Given** I tap "طباعة عينة" (Print sample)
  **When** I tap
  **Then** a real sample receipt with placeholder data prints to the default printer so I can see physical appearance

- **Given** I have the Staff Pack disabled
  **When** I view the toggles
  **Then** the "Show cashier name" toggle is grayed out with a small note "متاح مع باقة الموظفين"

- **Given** I have the Customer Pack disabled
  **When** I view the toggles
  **Then** the "Show customer name on credit sales" toggle is grayed out similarly

- **Given** I turn off "Show SYP totals" and "Show exchange rate line"
  **When** the next receipt prints
  **Then** the receipt is USD-only — no SYP line, no rate line

- **Given** I set receipt language to English while app language is Arabic
  **When** the next receipt prints
  **Then** receipt labels (Total, Subtotal, Cashier, Invoice number, etc.) print in English; product names print as stored (so if a product has only Arabic name, that's what prints)

- **Given** I tap "إعادة الإعدادات الافتراضية" (Reset to defaults)
  **When** I confirm
  **Then** all toggles return to defaults; an audit entry records the reset (before/after snapshot)

- **Given** I save changes
  **When** I tap Save
  **Then** before commit, the CD-12 save-confirmation dialog appears summarizing what changed: "سيتم تطبيق هذا على جميع الفواتير الجديدة:\n- [list of changed toggles and text fields]" with "تأكيد" / "تعديل" — receipt template is one of the three high-sensitivity fields under CD-12

- **Given** I confirm
  **When** the change commits
  **Then** the next receipt printed anywhere (any device in the shop) uses the new template within the propagation window

- **Given** another device changed the receipt template while I was viewing the editor
  **When** I tap Save and the sync detects the conflict at commit time
  **Then** I see a non-blocking toast: "تم تعديل قالب الفاتورة من جهاز آخر — التغيير الأحدث محفوظ"; the audit log retains both versions per CD-12

---

### Story 6.6 — Set the business day start time

**As an** owner who keeps the shop open past midnight
**I want to** define when my business day starts
**So that** late-night sales count toward the right day on the home screen

**Acceptance criteria:**

- **Given** I am the owner in Settings → Shop profile (or a dedicated "Operations" sub-section)
  **When** I view the "بداية يوم العمل" (Business day start) row
  **Then** I see a time picker, defaulting to 06:00

- **Given** I change it to 04:00
  **When** I save
  **Then** the home screen's "اليوم" (Today) cards (Epic 3) treat sales between 04:00 and 03:59:59 the next morning as one business day

- **Given** the current time is 02:30 and business day starts at 06:00
  **When** I view the home screen
  **Then** "Today" shows yesterday's calendar date's data (since 02:30 < 06:00, today's business day hasn't started)

- **Given** business day start is changed mid-day
  **When** the change is saved
  **Then** an audit log entry records old time → new time, and the home screen recalculates within the propagation window

- **Given** business day start is 06:00 and a sale happens at 05:55
  **When** the sale is recorded
  **Then** the sale's `created_at` is exact UTC; the home screen attributes it to the previous business day's "Today"; the receipt prints the actual time (not the business-day-adjusted time)

- **Given** I want shifts (Epic 5) to align with the business day
  **When** I save business day start
  **Then** the Z-report for a shift uses the same business-day boundary — a shift that opens at 18:00 and closes at 02:00 belongs to one business day

---

### Story 6.7 — View exchange rate history and rollback

**As an** owner
**I want to** see the full history of exchange rate changes and undo a mistake
**So that** an accidental wrong rate doesn't propagate

**Acceptance criteria:**

- **Given** I am in Settings
  **When** I open the "Exchange rate" section
  **Then** I see the current rate (large), and below it a chronological list of all past changes with: timestamp, who changed it (Epic 5 attribution), old value, new value

- **Given** Epic 1 Story 1.5's editor shows only the last 5 changes
  **When** I view this Settings history
  **Then** I see the **full** history — paginated or virtually scrolled; supports filtering by date range

- **Given** I want to undo a rate change I made 30 minutes ago
  **When** I tap "تراجع" (Rollback) next to that entry
  **Then** I see a confirmation: "سيتم إعادة السعر إلى [old value]. السعر الحالي [current value] سيُسجل كتغيير جديد. هل تريد المتابعة؟"

- **Given** I confirm the rollback
  **When** the rollback commits
  **Then** a new history entry is created (rollback is forward-only — we never delete history entries), the current rate becomes the old value, and the audit log records the rollback specifically

- **Given** sales were recorded between the original change and the rollback
  **When** the rollback completes
  **Then** those sales **retain** their `exchange_rate_at_sale` (Epic 1 immutability) — past sales are never re-priced

- **Given** I am a Manager (per Epic 5 — managers CAN change rate but CAN'T change shop settings)
  **When** I view the exchange rate section in Settings
  **Then** I see the history read-only AND can use Rollback (since rollback is a rate change, which managers are permitted to do)

- **Given** I am offline
  **When** I rollback
  **Then** the rollback queues like any other rate change, with the same conflict semantics as Epic 1

---

### Story 6.8 — Manage printers and hardware

**As an** owner
**I want to** see which printers and scanners are connected, set a default printer, and test print
**So that** I know my hardware is working before a customer is at the counter

**Acceptance criteria:**

- **Given** I am the owner in Settings
  **When** I open "Hardware"
  **Then** I see three subsections: Printers, Barcode scanners, Cash drawer

- **Given** the Printers subsection
  **When** I view it
  **Then** I see a list of detected printers (USB), each row showing: friendly name, model (Epson TM-T20 / Star TSP143 / Generic 80mm), connection status (متصل / غير متصل), and a "Set as default" radio

- **Given** no printer is connected
  **When** I view Printers
  **Then** I see an empty state: "لا توجد طابعة متصلة — وصل الطابعة عبر USB" with a link to the public Tested Hardware list (CLAUDE.md sacred rule 3)

- **Given** at least one printer is connected
  **When** I tap "طباعة تجريبية" (Test print)
  **Then** a small one-line test receipt prints: shop name + "اختبار طباعة" + date/time

- **Given** the test print fails
  **When** the error returns
  **Then** I see a clear error with the printer-specific reason and a "تعليمات استكشاف الأخطاء" link (later epic, but the link is there as a placeholder)

- **Given** I set a different default printer
  **When** I save
  **Then** subsequent sale receipts (Epic 1) print to the new default; audit log records the change

- **Given** Barcode scanners subsection
  **When** I view it
  **Then** I see a toggle for "Scanner mode": "USB (لوحة مفاتيح)" / "كاميرا الهاتف" / "كلاهما"

- **Given** scanner mode is "USB only"
  **When** I am on the POS and try the camera scan icon (Epic 1)
  **Then** the camera icon is hidden

- **Given** scanner mode is "Camera only"
  **When** a USB scanner fires keystrokes
  **Then** they are NOT intercepted as scans (the global scan handler from Epic 1 is disabled)

- **Given** Cash drawer subsection
  **When** I view it
  **Then** I see a toggle "فتح الدرج تلقائياً عند البيع النقدي" (Auto-open drawer on cash sale) — default off

- **Given** the toggle is on
  **When** a cash sale completes
  **Then** the ESC/POS open-drawer pulse is sent to the default printer (the standard way drawers work in this product per Sacred Rule 3)

- **Given** all hardware changes
  **When** any change saves
  **Then** the audit log records before/after

---

### Story 6.9 — View devices and remote sign-out

**As an** owner
**I want to** see every device that has signed into my shop, and sign out any of them remotely
**So that** I can revoke access to a lost or stolen phone

**Acceptance criteria:**

- **Given** I am the owner in Settings
  **When** I open "Devices"
  **Then** I see a list of devices, each row showing: device code (per Epic 1 CD-1, e.g., `A`), friendly name (editable, default inferred from user agent), last sign-in (relative), last sync (relative + status icon), currently signed-in cashier (or "no one"), shifts opened on this device count

- **Given** a device is currently online and synced
  **When** I view its row
  **Then** the sync indicator is green

- **Given** a device hasn't synced in >24 hours
  **When** I view its row
  **Then** the sync indicator is yellow with "آخر مزامنة قبل يومين" type text

- **Given** I tap "تعديل الاسم" on a device
  **When** I rename it
  **Then** the name is stored and shown across all devices via sync; audit log records the change

- **Given** I tap "تسجيل خروج عن بُعد" (Remote sign-out) on a device that has **no open shift**
  **When** the confirmation dialog appears
  **Then** I see: "سيتم تسجيل خروج جميع المستخدمين من هذا الجهاز عند اتصاله بالإنترنت. هل تريد المتابعة؟" with "تأكيد" / "إلغاء"

- **Given** I tap "تسجيل خروج عن بُعد" on a device that **has an open shift**
  **When** the confirmation dialog appears
  **Then** I see: "سيتم تسجيل خروج جميع المستخدمين من هذا الجهاز عند اتصاله بالإنترنت."
  **And** below that, an unchecked checkbox: "إغلاق الوردية المفتوحة أيضاً (سيتم الإغلاق دون عد النقد — قد يظهر فرق في التقرير)"
  **And** explanatory text under the checkbox: "إذا تُركت الوردية مفتوحة، يمكن للكاشير إغلاقها عند العودة، أو يمكنك إغلاقها يدوياً من شاشة الورديات"
  **And** confirm/cancel buttons

- **Given** I confirm remote sign-out **without** checking the close-shift box
  **When** the operation commits
  **Then** a remote-sign-out marker is written; the shift stays open; audit log records the sign-out only

- **Given** I confirm remote sign-out **with** the close-shift box checked
  **When** the operation commits
  **Then** two markers are written — the remote sign-out, AND a force-close for the open shift; on next sync to the target device, the shift is closed with `closing_cash_*` = `expected_cash_*` and close-note "إغلاق عن بُعد — لم يتم عد النقد" per CD-8; the audit log records both actions as separate entries

- **Given** I confirmed with close-shift checked
  **When** I later view the shift in Shifts (Epic 5)
  **Then** the shift shows variance of zero and a clear marker: "أُغلقت عن بُعد دون عد النقد" — the owner knows the variance number is computed, not measured

- **Given** the target device is online when I trigger remote sign-out
  **When** the sync completes
  **Then** the device returns to the PIN screen within 60 seconds

- **Given** the target device is offline when I trigger remote sign-out
  **When** the device comes back online later
  **Then** the sign-out applies on the next sync; if a sale was in progress, the sale is preserved as a draft (per Epic 1 CD-3) and the cashier must sign in to resume

- **Given** I am a Manager
  **When** I open Settings
  **Then** the Devices section is hidden (owner-only)

- **Given** the device list grows beyond 20 devices (multi-device shops)
  **When** I view the list
  **Then** I can filter by "active in last 30 days" / "all" and sort by last sync

---

### Story 6.10 — View current plan and billing summary

**As an** owner
**I want to** see what packs I'm paying for and what's coming up
**So that** I know what I owe and can plan upgrades

**Acceptance criteria:**

- **Given** I am the owner in Settings
  **When** I open "الاشتراك" (Plan & billing)
  **Then** I see: current packs list (Core + any add-ons per CLAUDE.md pricing), monthly total, next billing date, payment method on file (text, since collection is out-of-band per CD-summary), founding-customer discount banner if applicable

- **Given** the Plan & billing screen loads
  **When** I view the top of the screen
  **Then** I see a small persistent info row: "💬 التفعيل والدفع يتم بالتواصل معنا — الدفع نقداً، حوالة بنكية، أو USDT" — this microcopy sets expectations immediately so the owner doesn't tap Upgrade expecting an in-app card form

- **Given** I have the Core only
  **When** I view the packs list
  **Then** I see "الأساسي" (Core) — $12/month — active, and four greyed-out rows for the other packs ("Staff", "Customer", "Reporting", "Electronics Pro") each showing the +$X/month price and a "ترقية" (Upgrade) button

- **Given** I tap "Upgrade" on a pack
  **When** the upgrade confirmation opens
  **Then** I see a summary of what unlocks (mirroring the CLAUDE.md pack contents), the new monthly total, the prorated charge for the rest of this billing period, and a "تواصل معنا لتفعيل الباقة" (Contact us to activate) button with a WhatsApp link (per CLAUDE.md sacred rule 9 — activation is human-touch in year 1; self-serve full billing is later)

- **Given** I tap the WhatsApp link
  **When** WhatsApp opens
  **Then** a pre-filled message says: "أريد تفعيل باقة [pack name] لمتجري [shop name]. طريقة الدفع المفضّلة: ___" — the blank line invites the owner to indicate cash / wire / USDT, which speeds up the support conversation

- **Given** I currently have a pack active
  **When** I view that pack row
  **Then** I see "نشط" status and a "Downgrade" link styled subtly (downgrade is also human-touch in v1, same WhatsApp flow)

- **Given** I am offline
  **When** I open Plan & billing
  **Then** I see cached plan info with a banner "آخر تحديث قبل [time]" — actions that require contact (upgrade WhatsApp) are still available because they're just deep links

- **Given** I am a Manager or Cashier
  **When** I open Settings
  **Then** Plan & billing is hidden (owner-only)

- **Given** the founding-customer discount applies (per CLAUDE.md — 50% off for 12 months for first 10-15 pilots)
  **When** I view Plan & billing
  **Then** I see the discount line item clearly: "خصم العميل المؤسس — 50%" with the discount value subtracted and the months remaining

---

### Story 6.11 — Trigger manual sync and view sync status

**As any** user
**I want to** force a sync and see what's pending
**So that** I know my data is safe

**Acceptance criteria:**

- **Given** I am any user in Settings
  **When** I open "البيانات والمزامنة" (Data & sync)
  **Then** I see: connection status (online/offline), last sync timestamp, queued-writes count (e.g., "12 عملية في الانتظار"), a "مزامنة الآن" (Sync now) button

- **Given** I am online with pending writes
  **When** I tap "Sync now"
  **Then** the sync runs immediately; the button shows a spinner; on completion I see "تمت المزامنة" and the queued count becomes 0

- **Given** I am offline
  **When** I tap "Sync now"
  **Then** I see "غير متصل بالإنترنت — ستتم المزامنة تلقائياً عند الاتصال" — button disabled briefly

- **Given** sync fails (e.g., server error)
  **When** the error returns
  **Then** I see an error message with the specific reason; queued writes remain queued; "حاول مرة أخرى" button

- **Given** I want a detailed view
  **When** I tap "تفاصيل" next to the queued count
  **Then** a list shows each pending write with: entity type ("sale", "expense", etc.), entity short identifier, attempted-since timestamp; cashiers see only their own pending writes, owner sees all

- **Given** a write has been failing repeatedly for >24 hours
  **When** I view detail
  **Then** that row is flagged red with the error reason; an option to "تجاهل" (Discard) appears for the owner (with strong confirmation — discarding an unsynced sale loses data)

- **Given** I am offline for a long time and queued count grows
  **When** queued count exceeds 1,000
  **Then** a passive banner appears on the home screen (Epic 3) warning that local storage is filling up — actionable when back online

---

### Story 6.12 — Export all my data

**As an** owner
**I want to** export all my shop's data as Excel-compatible files
**So that** I have my own copy and could leave if I needed to

**Acceptance criteria:**

- **Given** I am the owner in Settings → Data & sync
  **When** I view the section
  **Then** I see an "تصدير جميع البيانات" (Export all data) button with a small subtitle showing the approximate total row count: "حوالي 12,400 سجل"

- **Given** I tap Export
  **When** the pre-export estimate completes
  **Then** I see a confirmation dialog with the estimate per CD-9: small (<5k rows) → "بضع ثوانٍ", medium (5k–50k) → "أقل من دقيقة", large (>50k) → "قد تستغرق عدة دقائق — اترك التطبيق مفتوحاً" — with "ابدأ" / "إلغاء" buttons

- **Given** I tap "ابدأ"
  **When** the export runs
  **Then** I see a progress dialog showing entity-by-entity progress: "جاري تصدير المبيعات... 3,200 / 12,400" with the current entity name and an overall progress bar; a "إلغاء" button is always present

- **Given** the browser supports the File System API
  **When** the export runs on a large dataset
  **Then** entities are written to disk and appended to the ZIP incrementally (per CD-9 streaming) — memory footprint stays low

- **Given** the browser does NOT support the File System API
  **When** I tap Export on a dataset estimated to exceed 100 MB compressed
  **Then** a pre-export warning appears: "متصفحك لا يدعم التصدير المباشر للملفات الكبيرة. قد يبطئ التطبيق. هل تريد المتابعة؟" with Continue/Cancel

- **Given** the export completes
  **When** the file is ready
  **Then** a download begins automatically (or the share sheet opens on mobile) with filename `shop-export-[shop-name]-[YYYY-MM-DD].zip`

- **Given** I unzip the file
  **When** I open it
  **Then** I see CSV files: `products.csv`, `customers.csv`, `sales.csv`, `sale_lines.csv`, `expenses.csv`, `customer_transactions.csv`, `shifts.csv`, `stock_adjustments.csv`, `audit_log.csv`, plus a `README.txt` with field descriptions in Arabic and English

- **Given** I open `products.csv` in Excel
  **When** Excel loads it
  **Then** Arabic text renders correctly (UTF-8 BOM per CD-9), prices have correct decimal places, no garbled characters

- **Given** I am offline
  **When** I export
  **Then** export works fully from local data — no server roundtrip required (CLAUDE.md "your data is yours" — works without internet)

- **Given** I cancel mid-export
  **When** I tap Cancel
  **Then** the in-progress generation halts, the partial file is discarded, no orphan downloads remain, and a brief toast confirms "تم إلغاء التصدير"

- **Given** the export fails partway (memory pressure, disk full, etc.)
  **When** the error returns
  **Then** I see the specific reason in plain Arabic ("ذاكرة الجهاز ممتلئة", "مساحة التخزين غير كافية") with practical next steps ("أغلق التطبيقات الأخرى وأعد المحاولة" or "تواصل مع الدعم"); no partial ZIP is delivered

- **Given** I am a Manager
  **When** I open Data & sync
  **Then** I see the section, but the Export button is visible (per Epic 5 — managers CAN export); however, Clear Local Cache is hidden (owner-only)

---

### Story 6.13 — Clear local cache (advanced)

**As an** owner
**I want to** wipe the device's local cache and re-download from server
**So that** I can recover from a corrupted local state without losing data

**Acceptance criteria:**

- **Given** I am the owner in Settings → Data & sync
  **When** I scroll to the bottom
  **Then** I see a collapsed "Advanced" section

- **Given** I expand Advanced
  **When** I view it
  **Then** I see "مسح الذاكرة المحلية" (Clear local cache) with a clear warning

- **Given** I tap Clear local cache
  **When** the confirmation dialog appears
  **Then** I see a two-step confirmation: first dialog explains "هذا سيمسح جميع البيانات على هذا الجهاز ويعيد تنزيلها من الخادم. أي عمليات لم تتم مزامنتها ستضيع. هل تريد المتابعة؟" — must tap "متابعة"; second dialog requires typing the shop name to confirm

- **Given** there are pending unsynced writes
  **When** I attempt to clear cache
  **Then** the first dialog shows a strong warning: "لديك [n] عملية لم تتم مزامنتها. سيتم فقدها نهائياً" — owner must explicitly acknowledge this

- **Given** I confirm and shop name matches
  **When** the cache clears
  **Then** the app shows a loading state, deletes all local data, re-fetches from server, signs me out, and routes to PIN screen

- **Given** the device is offline
  **When** I attempt Clear local cache
  **Then** I see "يجب أن تكون متصلاً بالإنترنت لمسح الذاكرة المحلية" — button disabled

- **Given** the clear-and-refetch completes
  **When** I sign back in
  **Then** all products, customers, etc. are restored from server

- **Given** the action is audit-logged
  **When** an entry is written
  **Then** it records device_id, employee_id (the owner who triggered), and unsynced-writes-count-lost (if any)

---

### Story 6.14 — Notification preferences (in-app, v1)

**As any** user
**I want to** control which in-app alerts appear and when
**So that** the app shows me what I care about and stays quiet about the rest

**Acceptance criteria:**

- **Given** I am in Settings → Personal
  **When** I view the "إشعارات" (Notifications) row
  **Then** I see a list of in-app notification types, each with an on/off toggle

- **Given** the screen explains itself
  **When** I look at the top of the Notifications screen
  **Then** I see a short note: "هذه إشعارات داخل التطبيق فقط — تظهر عند فتحك التطبيق. إشعارات الهاتف عبر النظام ستصل لاحقاً" — this is the CD-11 expectation-setting; no browser permission prompt is triggered

- **Given** I view the notification types for an Owner
  **When** I look at the list
  **Then** I see:
  - Low-stock alerts (in-app banner on home screen + toast on first detection per session) — default on
  - Large variance on shift close (in-app banner after Z-report) — default on, only if Staff Pack active
  - PIN lockout occurred (in-app banner next time owner opens app) — default on, only if Staff Pack active
  - Sync failure after 1 hour (in-app banner on relevant screens) — default on
  - Daily summary reminder (in-app prompt the first time owner opens app each day) — default off

- **Given** I view notification types for a Cashier
  **When** I look at the list
  **Then** I see: Low-stock alerts (default on), Sync failure after 1 hour (default on) — no Staff Pack items, no digest, no business-sensitive alerts

- **Given** I turn off Low-stock alerts
  **When** stock falls below threshold
  **Then** the home screen low-stock card (Epic 3) still shows the count (it's a visible indicator, not a notification), but no banner or toast fires

- **Given** these are in-app notifications, not OS-level pushes
  **When** I close the app entirely
  **Then** no notifications fire on the device; alerts surface next time I open the app — this is the v1 scope per CD-11

- **Given** the daily WhatsApp digest is later in the roadmap
  **When** I view the daily summary toggle
  **Then** a small note explains "ستتلقى الملخص اليومي على الواتساب عند تفعيل هذه الميزة قريباً" — preference is captured forward-compat

- **Given** v1.5 adds OS-level push
  **When** that capability ships
  **Then** the same toggles extend to control push delivery — no preferences UI rebuild needed (per CD-11)

---

### Story 6.15 — Sign out

**As any** user
**I want to** sign out of my session
**So that** the next person on this device must enter their PIN

**Acceptance criteria:**

- **Given** I am in Settings → Personal
  **When** I scroll to the bottom
  **Then** I see a "تسجيل خروج" (Sign out) button in red text

- **Given** I tap Sign out
  **When** the confirmation appears
  **Then** I see: "هل تريد تسجيل الخروج؟" with Yes/No

- **Given** I have an open shift
  **When** I attempt sign out
  **Then** the dialog adds: "لديك وردية مفتوحة. سجل خروجك سيُبقيها مفتوحة — تذكّر إغلاقها لاحقاً." with options "متابعة" / "إغلاق الوردية" (routes to Close Shift flow per Epic 5)

- **Given** I confirm sign out
  **When** the sign-out commits
  **Then** my session ends, I am routed to the PIN sign-in screen, audit log records the sign-out

- **Given** I had pending unsynced writes
  **When** I sign out
  **Then** the writes remain queued under my employee_id; they sync when next online; signing out does NOT lose data

- **Given** sign-out propagates per Epic 5
  **When** I am the last active session on this device
  **Then** the device idles to the PIN selection screen

---

### Story 6.16 — About, version, support contact, diagnostics

**As any** user
**I want to** see the app version, contact support, and grab diagnostic info
**So that** when something goes wrong, I can report it usefully

**Acceptance criteria:**

- **Given** I am in Settings
  **When** I scroll to the bottom
  **Then** I see an "About" section, always visible to every user

- **Given** I view About
  **When** I see the content
  **Then** I see: app version (e.g., `1.0.4`), build hash (small), last update timestamp, link "شروط الاستخدام" (Terms), link "الخصوصية" (Privacy), support WhatsApp number with tap-to-open

- **Given** I tap the support WhatsApp number
  **When** WhatsApp opens
  **Then** a pre-filled message contains: shop name, app version, device code, last sync timestamp, signed-in user name, and a blank "Describe your issue:" line for the user to fill

- **Given** I tap "نسخ معلومات التشخيص" (Copy diagnostic info)
  **When** the action completes
  **Then** the clipboard contains a JSON blob with: version, build, device code, user agent, last sync, queued-writes count, employee_id (hashed), shop_id (hashed) — no PII beyond what's needed for support; a toast confirms "تم النسخ"

- **Given** a PWA update is available
  **When** I open About
  **Then** I see a "تحديث متوفر" banner with "تحديث الآن" button — tapping reloads the PWA with the new version

- **Given** I am offline
  **When** I open About
  **Then** all info is available from local cache; the update check shows "لا يمكن التحقق من التحديثات (غير متصل)"

---

### Story 6.17 — Settings works fully offline

**As any** user
**I want** every settings screen to work offline
**So that** the shop's daily operation isn't blocked by a missing connection

**Acceptance criteria:**

- **Given** I am offline
  **When** I open Settings
  **Then** every section renders with cached values

- **Given** I am offline
  **When** I change a personal preference (language, theme, text size, notifications)
  **Then** the change applies immediately with no network call

- **Given** I am offline
  **When** I change a shop setting (shop name, receipt template, business day, hardware)
  **Then** the change applies locally, queues for sync, the audit log entry is created locally (per CD-5); UI shows a small "في الانتظار للمزامنة" indicator next to recently-changed values

- **Given** I am offline
  **When** I attempt actions that require server acknowledgement
  **Then** they are clearly marked: Clear local cache (blocked offline), Remote sign-out (queued — applies when device comes online), Plan & billing upgrade (button still works, opens WhatsApp deep link which doesn't need our server)

- **Given** I edit a shop setting on Device A while Device B is offline
  **When** Device B comes back online and syncs
  **Then** Device B receives the change, the audit log entries merge cleanly (per Epic 5 CD on concurrent audit entries — each has unique device_id + nonce), and any conflicting concurrent edits resolve last-write-wins by timestamp with a notice on both devices

- **Given** all settings changes work offline
  **When** sync resolves
  **Then** no settings change is ever lost — even after extended (weeks-long) offline periods, queued settings changes apply when the device returns

---

## Screens and states

### Screen 1: Settings root

**Access:** Gear icon in global header (top-end), every screen except PIN sign-in and Close Shift (per CD-4).

**Layout:**
- Top: page title "الإعدادات" (Settings), back button (top-start), small status chip showing "متصل / غير متصل" (online / offline)
- Below: a vertically scrollable list of section groups
- For Owner: Personal → Shop profile → Receipt template → Hardware → Devices → Plan & billing → Data & sync → About
- For Manager: Personal → Shop profile (read-only) → Exchange rate history → Data & sync (limited) → About
- For Cashier: Personal → About

**States:**
- **Default:** All applicable sections listed
- **Offline:** Status chip shows offline; sections still tappable
- **Recently changed:** Sections with pending sync show a small dot indicator
- **Loading personal pref:** Skeleton rows briefly on first load

### Screen 2: Personal preferences

**Layout:** Single column, vertically scrollable.

**Rows:**
1. Language (current value shown, tap to change)
2. Theme (current value shown, tap to change)
3. Text size (current value, tap to change)
4. Notifications (link, opens detail)
5. Biometric unlock (toggle — visible only if device supports it; defers PIN entry to fingerprint/face)
6. Sign out (red button at bottom)

**States:**
- **Default:** All rows enabled
- **First-time install:** Subtle hint badges on Language and Theme (dismissible)

### Screen 3: Shop profile editor

**Layout:** Form, single column on phone, two-column on desktop (fields left, logo preview right).

**Sections:**
- **Identity:** Arabic name (required), English name, address, phone
- **Tax:** Tax number, with helper text "(اختياري)"
- **Operations:** Business day start time picker, default low-stock threshold (numeric, default 5), default currency display (USD/SYP/Both, default Both)
- **Logo:** Upload area + preview thumbnail + Remove button

**Footer:** Save / Cancel.

**States:**
- **Read-only (Manager):** All inputs disabled, no Save button
- **Default (Owner):** All editable
- **Validation error:** Inline red message under field
- **Saving:** Save button spinner, fields disabled
- **Saved:** Brief success toast

### Screen 4: Receipt template editor

**Layout:**
- Desktop: 2-column. Left = live preview pane (80mm-width simulated receipt), Right = controls.
- Phone: stacked, controls on top, preview button reveals preview modal.

**Controls (right pane):**
- Header text (textarea, max 200 chars)
- Footer text (textarea, max 200 chars)
- Receipt language (segmented: Arabic / English)
- Toggle group for each show/hide option (per Story 6.5)
- "Reset to defaults" link
- "Print sample" button

**Preview pane:**
- Simulated 80mm receipt rendered at 1:1 scale
- Updates live on any control change
- Shows placeholder sample data (Sample Shop, sample items)

**States:**
- **Default:** Template as currently saved
- **Unsaved changes:** Save button highlighted, "تم التعديل" indicator
- **Pack-gated rows:** Greyed with upgrade hint
- **Printing sample:** Print button spinner
- **Print failed:** Toast with error reason

### Screen 5: Hardware management

**Layout:** Three collapsible subsections.

**Printers subsection:**
- List of detected printers, each with friendly name, model, status, default radio, test-print button
- "إضافة طابعة يدوياً" (Add printer manually) link for cases auto-detect misses
- Empty state with link to Tested Hardware list

**Scanners subsection:**
- Mode toggle (USB / Camera / Both)
- For USB: list of detected scanners (HID devices); for Camera: a "Test scan" affordance opening the camera

**Cash drawer subsection:**
- Auto-open toggle
- Trigger source (which printer to send open-pulse via)
- "Test open" button (sends pulse)

**States:**
- **Loading:** Skeletons during device detection
- **No hardware:** Empty states with helpful guidance
- **Test in progress:** Inline spinners on specific actions
- **Test failed:** Specific error text per failure mode

### Screen 6: Devices list

**Layout:** Table on desktop, card list on phone.

**Each row/card:** device code (visual emphasis — `A`, `B`...), friendly name (with edit pencil), last sign-in, last sync (with color indicator), currently signed-in cashier, shifts count, actions menu (Rename / Remote sign-out)

**Top bar:** Filter (All / Active 30d / Inactive), Search by code or name

**States:**
- **Default:** Full list
- **Empty (single device):** Single card shown alone with a friendly hint
- **Action in progress:** Inline spinner on the row being acted on
- **Confirmation modal (no open shift):** Simple confirm dialog
- **Confirmation modal (open shift):** Includes the "إغلاق الوردية المفتوحة أيضاً" checkbox with explanatory text per Story 6.9 / CD-8

### Screen 7: Plan & billing

**Layout:** Single column. Top = current plan summary, below = pack list.

**Top microcopy row (always visible, sticky if user scrolls):** small info-styled row reading "💬 التفعيل والدفع يتم بالتواصل معنا — الدفع نقداً، حوالة بنكية، أو USDT" — sets expectation that this screen is informational; activation is human-touch per CLAUDE.md collection strategy.

**Pack list rows:**
- Each pack: name (Arabic), monthly price, status (active / inactive), what it includes (collapsed accordion), Upgrade/Downgrade button
- Active packs styled with checkmark; inactive packs styled subtly

**Bottom:** "تواصل مع الدعم" WhatsApp link, founding-customer discount banner if applicable, next billing date

**States:**
- **All Core:** Most rows inactive, Core highlighted
- **Multiple packs active:** Multiple rows with active styling
- **Offline:** Cached values with last-update timestamp
- **Action:** Upgrade taps open WhatsApp deep link with the pre-filled message including the payment-method prompt

### Screen 8: Data & sync

**Layout:** Single column.

**Sections:**
- **Connection:** Online/offline indicator (large), last sync timestamp, queued-writes count, Sync now button
- **Export:** Export all data button + last export timestamp
- **Advanced (collapsed):** Clear local cache button (with strong warnings)

**States:**
- **Online, no pending:** Calm green state
- **Online, syncing:** Spinner with current operation label
- **Offline, pending writes:** Warm yellow indicator with count
- **Sync failure:** Red indicator with retry button
- **Exporting:** Progress modal per Story 6.12

### Screen 9: Notification preferences

**Layout:** Top informational note ("إشعارات داخل التطبيق فقط — الإشعارات على مستوى النظام ستصل لاحقاً"), then a list of toggles grouped by category.

**Categories:**
- **Stock & operations:** Low-stock alerts, sync failure (visible to all roles)
- **Staff (visible only if Staff Pack active):** Shift variance, PIN lockout, force-close events (owner only)
- **Customer (visible only if Customer Pack active):** Balance overdue threshold — forward-compat v1.5 placeholder
- **Digest:** Daily summary reminder (forward-compat for v1.5 WhatsApp digest)

**States:**
- **Default:** Toggles reflect current preferences
- **Pack inactive:** Category is hidden entirely (per CD-4 hidden-not-disabled rule)
- **Toggling:** Brief checkmark animation; change persists locally immediately
- **First-time view:** Subtle "?" tooltip on the top note explaining what "in-app" means

### Screen 10: About

**Layout:** Centered, simple.

**Sections:**
- App logo (small) + product name
- Version, build hash, last update
- Links: Terms, Privacy, Tested Hardware list
- Support WhatsApp number (large, tap-friendly)
- "نسخ معلومات التشخيص" button
- "تحديث متوفر" banner (only if update available)

**States:**
- **Default:** As above
- **Update available:** Banner shown
- **Copying diagnostics:** Brief success toast

### Screen 11: Exchange rate history (Settings → Exchange rate)

**Layout:** Top shows current rate (large), below is the full history table.

**Columns:** Timestamp, Changed by, Old value, New value, Source (manual edit / rollback / sync from device X), Actions (Rollback)

**Filters:** Date range, changed-by user, change type

**States:**
- **Default:** Full history
- **Filtered:** Filter chips visible with clear option
- **Rollback confirmation:** Per Story 6.7
- **Empty (new shop):** Only the current value shown with a helpful note

---

## Fields and validation

### User preference record (one per user-device)

| Field | Type | Required | Validation |
|---|---|---|---|
| preference_id | UUID | yes | Generated locally |
| employee_id | UUID | yes | FK to employees (per Epic 5); for unsigned-in state, special "device_default" UUID |
| device_id | UUID | yes | |
| language | enum | yes | `ar` / `en`; default `ar` |
| theme | enum | yes | `light` / `dark` / `auto`; default `auto` |
| text_size | enum | yes | `small` / `default` / `large` / `xlarge`; default `default` |
| biometric_unlock_enabled | boolean | yes | Default false |
| notification_low_stock | boolean | yes | Default true |
| notification_sync_failure | boolean | yes | Default true |
| notification_shift_variance | boolean | yes | Default true (ignored unless Staff Pack active) |
| notification_pin_lockout | boolean | yes | Default true (ignored unless Staff Pack active) |
| notification_digest_reminder | boolean | yes | Default false |
| updated_at | timestamp | yes | |

### Shop settings record (one per shop)

| Field | Type | Required | Validation |
|---|---|---|---|
| shop_id | UUID | yes | |
| name_ar | string | yes | Min 1, max 200 |
| name_en | string | no | Max 200 |
| address | string | no | Max 500, multi-line |
| phone | string | no | E.164 best-effort, max 20 |
| tax_number | string | no | Max 50, any format (per CD-7) |
| active_logo_id | UUID | no | FK to a shop_logo record; null if no logo currently displayed |
| business_day_start_hour | integer | yes | 0–23, default 6 |
| business_day_start_minute | integer | yes | 0–59, default 0 |
| default_low_stock_threshold | integer | yes | ≥ 0, default 5 |
| default_currency_display | enum | yes | `usd_only` / `syp_only` / `both`; default `both` |
| default_printer_id | UUID | no | FK to hardware_printer records |
| scanner_mode | enum | yes | `usb` / `camera` / `both`; default `both` |
| cash_drawer_auto_open | boolean | yes | Default false |
| updated_at | timestamp | yes | |
| sync_status | enum | yes | |

### Shop logo record (max 3 per shop, FIFO eviction per CD-6)

| Field | Type | Required | Validation |
|---|---|---|---|
| logo_id | UUID | yes | |
| shop_id | UUID | yes | |
| color_url | string | yes | Local blob URL; original compressed to <500 KB |
| bw_url | string | yes | Auto-generated B&W version for thermal print |
| uploaded_at | timestamp | yes | Used to determine FIFO eviction order |
| uploaded_by | UUID | yes | employee_id (the owner who uploaded) |
| sync_status | enum | yes | |

**Eviction rule:** when a 4th logo is uploaded, the oldest by `uploaded_at` is hard-deleted (blob and record). When the active logo is removed, it stays in history; only counted toward the cap of 3.

### Receipt template record (one per shop)

| Field | Type | Required | Validation |
|---|---|---|---|
| template_id | UUID | yes | |
| shop_id | UUID | yes | |
| receipt_language | enum | yes | `ar` / `en`; default `ar` |
| header_text | string | no | Max 200 |
| footer_text | string | no | Max 200; default "شكراً لزيارتكم" |
| show_logo | boolean | yes | Default true |
| show_tax_number | boolean | yes | Default true |
| show_sale_number | boolean | yes | Default true |
| show_cashier_name | boolean | yes | Default true (ignored if Staff Pack inactive) |
| show_customer_name_on_credit | boolean | yes | Default true (ignored if Customer Pack inactive) |
| show_syp_totals | boolean | yes | Default true |
| show_exchange_rate_line | boolean | yes | Default true |
| show_shop_address | boolean | yes | Default false |
| show_shop_phone | boolean | yes | Default false |
| updated_at | timestamp | yes | |
| sync_status | enum | yes | |

### Hardware printer record

| Field | Type | Required | Validation |
|---|---|---|---|
| printer_id | UUID | yes | |
| shop_id | UUID | yes | |
| device_id | UUID | yes | Printer is registered per device (USB-attached) |
| friendly_name | string | yes | Default "Printer 1", editable |
| model | enum | yes | `epson_tm_t20` / `star_tsp143` / `generic_escpos_80mm` / `other` |
| connection_status | enum | yes | `connected` / `disconnected` |
| is_default | boolean | yes | Only one per shop |
| last_connected_at | timestamp | no | |

### Device record (extended for this epic; base device exists from Epic 1 CD-1)

| Field | Type | Required | Validation |
|---|---|---|---|
| device_id | UUID | yes | |
| device_code | string | yes | Per Epic 1 CD-1 (A, B, T-xxxx) |
| friendly_name | string | yes | Default from user agent; editable |
| shop_id | UUID | yes | |
| user_agent | string | yes | Captured at first sign-in |
| first_signed_in_at | timestamp | yes | |
| last_signed_in_at | timestamp | yes | |
| last_synced_at | timestamp | yes | |
| remote_signout_requested_at | timestamp | no | When set, device signs out on next sync |
| remote_signout_completed_at | timestamp | no | |

### Exchange rate history entry (extends Epic 1's rate record)

| Field | Type | Required | Validation |
|---|---|---|---|
| rate_change_id | UUID | yes | |
| old_value | decimal | yes | |
| new_value | decimal | yes | |
| changed_by | UUID | yes | employee_id |
| changed_at | timestamp | yes | |
| change_type | enum | yes | `manual_edit` / `rollback` / `initial` |
| rollback_of_change_id | UUID | no | Set if this is a rollback; references the entry being undone |
| source_device_id | UUID | yes | |

---

## Edge cases

1. **Language change mid-sale:** The sale is preserved; only UI labels swap. Product names (which are data) don't translate. Receipt language is independent and unaffected.

2. **Theme set to Auto but device doesn't expose preferred color scheme (very old browsers):** Fall back to Light. Show no error.

3. **Logo upload on a phone with no file picker (PWA on iOS):** Use the device camera or photo library directly; both must work.

4. **Logo file is corrupt or unreadable:** Reject gracefully with "تعذر قراءة الصورة" — do not overwrite existing logo.

5. **Owner changes shop name while a sale is in progress on another device:** The in-progress sale uses the old name on its receipt (locked at sale-start, per Epic 1's locked-rate pattern). New sales use the new name.

6. **Receipt template change while a receipt is being formatted for print:** The print job in flight uses the template version captured at print-start; subsequent prints use the new template.

7. **Business day start changed while shifts are open:** Open shifts keep their `opened_at`; the home screen recalculation applies to display only. Z-report at close uses the new business day boundary.

8. **Two owners edit shop profile concurrently on two devices, both offline:** Each device queues its change. On sync, last-write-wins by timestamp; the audit log records both changes with their device IDs. For the three CD-12 high-sensitivity fields (tax number, shop Arabic name, receipt template), the losing device shows a non-blocking toast next time the owner opens Settings, surfacing the conflict for a human to review.

9. **Manager attempts to access an owner-only setting via deep-link URL:** The `canUserDo` check (Epic 5) returns false; the user sees "ليس لديك صلاحية" and is routed back to Settings root.

10. **Remote sign-out triggered for a device that's currently in the middle of a sync:** The sign-out marker is part of the sync payload itself; once the current sync completes, the next pull applies the sign-out.

11. **Multiple remote sign-outs queued for the same device:** Deduplicate — the most recent timestamp wins; one sign-out applies; audit log has one entry per request.

12. **Remote sign-out with close-shift checkbox triggered, then the cashier reconnects before the force-close syncs:** The force-close marker takes precedence — the cashier is signed out and the shift is force-closed by the queued operation. If the cashier had a sale in progress, the sale draft (Epic 1 CD-3) is preserved.

13. **Export triggered with a 200 MB local DB on a browser without File System API:** The pre-export warning fires (per Story 6.12); if user proceeds and the browser runs out of memory mid-export, a clear error appears with the reason and suggested next steps. We do not silently retry — surfacing the limit is more useful than masking it.

14. **Clear local cache while a sale is being rung:** Block with "أنت في منتصف عملية بيع — أكمل أو ألغِ أولاً". Same applies for open shifts unless the shift has been closed.

15. **App update available but device is offline:** Banner says "تحديث متوفر — اتصل بالإنترنت لتثبيته". Tapping does nothing offline.

16. **App update applied while in the middle of a sale:** Service worker waits — update is staged but doesn't activate until app fully reloads. Show "تحديث جاهز — أعد التشغيل لتفعيله" banner, never force-reload during an active sale.

17. **Tax number contains right-to-left digits mixed with English:** Store as-is (per CD-7); render with Unicode bidi correctly; print with explicit LTR markers around the number so it doesn't get reversed on receipt.

18. **Owner sets `default_currency_display` to USD-only but a customer pays in SYP:** Display and receipt still show SYP for that specific transaction — defaults are defaults, not enforcement.

19. **First-time install on a brand-new device:** Default settings apply (Arabic, Auto theme, Default text size, defaults from above). Owner must complete Shop profile before first sale — a soft prompt nudges them on first home-screen view, but does not block.

20. **PWA reinstalled (user cleared browser data):** Local preferences reset to defaults; on next sign-in, shop settings re-sync from server; personal prefs are per-device so they start fresh — by design per CD-1.

21. **Cashier with the Auto theme on a tablet that doesn't have a system-level dark mode:** Defaults to Light. No error.

22. **Notifications scope clarification on first visit to Notifications screen:** The informational note (per Story 6.14) explains that these are in-app only — no browser permission prompt fires anywhere in v1. If a user previously had push permission granted from an unrelated PWA install attempt, we ignore it; v1 doesn't use it.

23. **Owner edits receipt footer to include an emoji:** Allowed in UI and PDF statement; for thermal print, emojis may render as boxes — show a soft warning "بعض الرموز قد لا تظهر بشكل صحيح على الطابعة الحرارية".

24. **Diagnostic JSON includes audit log activity (potentially sensitive):** Only counts and recent error summaries are included; no full audit entries — privacy by default.

25. **Setting changed offline, then conflicts with a setting changed by the owner online elsewhere (non-CD-12 fields):** Last-write-wins by timestamp; the device that loses sees a non-blocking toast "تم تحديث [setting] من جهاز آخر — تم استخدام التغيير الأحدث"; both changes are in the audit log. For the three CD-12 high-sensitivity fields, the toast is more prominent and the field highlights when Settings opens (per Story 6.4).

26. **Exchange rate rollback when newer rate changes exist after the target:** Rollback creates a new entry; subsequent changes remain in history; we never delete history. The current rate becomes the rolled-back value; the next manual edit overrides as normal.

27. **Logo history reaches the cap of 3 and owner uploads a 4th:** Oldest by `uploaded_at` is hard-deleted (per CD-6 FIFO); upload UI shows "تم استبدال الشعار الأقدم". No undo affordance — the displaced logo cannot be recovered. This is intentional; if owners want long-term archival they should keep originals outside the app.

28. **Owner removes the active logo, then re-enables one from history, then removes that one — does count toward the cap?** Logos in history count toward the cap regardless of whether they're currently active. Cap = 3 stored logos total, period. Removing the active logo doesn't free a slot.

29. **Tax number save-confirmation dismissed via back gesture (mobile):** Treated as "تعديل" — focus returns to the field, change is NOT committed. Same for the Arabic name and receipt template confirmations.

30. **CD-12 conflict surfacing toast: owner sees it on a device they didn't change anything on:** Expected behavior — the toast surfaces conflicts whether or not the current device was involved. Tapping the toast routes to the changed field with both versions shown side by side (read-only view).

---

## Definition of Done

- [ ] All 17 stories pass their acceptance criteria
- [ ] Brother completes a self-serve setup of his shop profile (name, tax number, logo, receipt template, business day start, default printer) without any help from us in under 15 minutes
- [ ] A cashier can change language and theme on a shared tablet without affecting the owner's preferences when the owner signs in
- [ ] Language switch (Arabic ↔ English) takes effect on every screen within 1 second, no app restart, with correct RTL/LTR flip
- [ ] Dark theme passes WCAG AA contrast on all screens on the cheap Android tablets in our test pool
- [ ] Receipt template changes propagate to the next printed receipt anywhere in the shop within 2 seconds (per CD-10)
- [ ] Business day start change correctly recalculates the home screen "Today" cards (Epic 3) within the propagation window
- [ ] Exchange rate rollback works correctly without altering past sales' `exchange_rate_at_sale` values
- [ ] Remote sign-out applies within 60 seconds when the target device is online, and on next connection if offline
- [ ] Remote sign-out with the close-shift checkbox checked correctly force-closes the open shift with zero computed variance and the "إغلاق عن بُعد — لم يتم عد النقد" marker; the Shifts UI (Epic 5) shows this distinctly from a normally-closed shift
- [ ] Plan & billing screen shows the payment-method microcopy on every visit; the WhatsApp deep-link includes the payment-method prompt
- [ ] CD-12 save-confirmation appears for tax number, shop Arabic name, and receipt template changes — and ONLY those three fields (not for other shop-profile fields)
- [ ] CD-12 conflict-surfacing toast appears on the losing device after concurrent edits to the three high-sensitivity fields
- [ ] Data export validated end-to-end on the brother's actual device with his actual data volume: the pre-export estimate is accurate within ±50%, progress is granular, Cancel works at any point, and the final ZIP opens in Excel with Arabic text intact
- [ ] Export streaming write (File System API path) tested on Android Chrome; in-memory fallback path tested on iOS Safari with the 100 MB warning firing correctly
- [ ] Notification preferences screen does NOT trigger any browser permission prompts in v1 — verified across Android Chrome, iOS Safari (installed PWA), desktop Chrome, desktop Safari, Firefox
- [ ] In-app notification surfaces (low-stock banner, sync-failure banner, variance banner) fire correctly on every supported browser when their respective toggles are on
- [ ] Logo history cap of 3 enforced: 4th upload evicts oldest; UI shows the eviction message; eviction is hard-delete (storage actually reclaimed)
- [ ] No time-based logo deletion exists anywhere in the code — logos are removed only by FIFO eviction or explicit user action on the history list
- [ ] Every shop-settings change creates a correct audit log entry (per Epic 5 Story 5.8); personal preferences do NOT create audit entries
- [ ] All sections render and function offline; pending changes show a "في الانتظار للمزامنة" indicator and resolve on reconnect
- [ ] Permission gating: Cashier sees only Personal + About; Manager sees the read-only sections per CD-4; Owner sees all
- [ ] Hidden vs disabled: missing-permission sections are hidden, not disabled (matches Epic 5 convention)
- [ ] All Arabic text uses plain language ("بداية يوم العمل" not "حد التقويم", "رقم الجهاز" not "معرف الجهاز")
- [ ] All settings read by other epics flow through versioned getter functions (CD-10) so future schema changes don't break Epic 1/2/3/4/5
- [ ] Clear local cache reliably recovers from a corrupted local DB, restores all data from server, and never executes when there are unsynced writes the owner hasn't explicitly acknowledged losing
- [ ] PIN sign-in screen does NOT show the gear icon (per CD-4)
- [ ] Performance: Settings root opens in <500ms on a cheap Android phone with full data set
- [ ] Tested on phone, tablet, desktop, online and offline
- [ ] Brother uses every section of Settings at least once during the 2-week soak test before this epic is "done"
- [ ] All edge cases above either handled or explicitly documented as known limitations
- [ ] No console errors during normal flows

---

## Pre-development checklist (owner: Tech Lead / PO)

These are the open items to resolve before the dev team picks up Story 6.1. Each should be closed before sprint planning, not during.

- [ ] **Export performance baseline measured** on the brother's device with his actual data volume — informs whether the 100 MB warning threshold needs adjustment
- [ ] **Align with Epic 5 on `canUserDo()` signature** — the permission framework is owned by Epic 5; this epic consumes it. Confirm function shape, supported actions enum, and async-vs-sync before story 6.4 kickoff
- [ ] **Confirm audit log schema** in Epic 5 supports JSON snapshots of full receipt template objects (not just simple before/after strings) — receipt template changes are stored as nested JSON
- [ ] **WhatsApp deep-link payload format** agreed with support team — the pre-filled message must be parseable on the support side so tickets aren't manually retyped
- [ ] **Arabic copy review pass** — every visible string in this epic walked through with a native speaker, focusing on edge-case error messages (sync failures, export errors, conflict toasts) where machine translation often produces formal-but-wrong phrasing
- [ ] **Decide tested-browser matrix for in-app notifications** — confirms which browsers we commit to in v1's DoD; informs CI test coverage
- [ ] **Storage quota strategy** — IndexedDB quotas vary by browser; agree on graceful behavior when shops approach quota limits (warning thresholds, what to evict first)

