# وافي (Wafi) — Product Documentation

## Introduction

Wafi ("وافي") is a cloud-connected, **offline-first point-of-sale and shop-management app** built for retail shop owners. It runs as a **Progressive Web App (PWA)** — installable from a browser link on a phone, tablet, or laptop, with no app store required — and works fully in Arabic, right-to-left, with dual USD/SYP pricing.

### What it's for

Wafi replaces the desktop-only cash-register software that shop owners currently use with something that:
- Works **without internet** — the app runs against a local database on the device and syncs automatically when a connection is available.
- Runs on **whatever device the shop already has** — phone, tablet, laptop, or browser.
- Speaks the shop owner's language — not accounting jargon, but "how much cash do I have," "who owes me money," "what's running low."
- Scales with the business through modular feature packs, instead of forcing every shop to pay for features it doesn't need.

### Why we are building this

Retail shop owners need to know three things at any moment: **am I making money, what do I have in stock, and can I trust my cash and my staff.** Existing local POS software is desktop-bound, has no real offline support, and offers no vertical depth or modern usability. Wafi is built around a business-health view first, and a sales register second — the register is how the numbers get generated, but the dashboard is what the owner actually cares about.

### Who uses it

- **Owner** — full access to everything: financial reports, staff management, settings, permissions.
- **Manager** — day-to-day operational access (products, customers, inventory, suppliers, stock-take) by default; financial visibility (reports, expenses, staff ledger) must be explicitly granted by the owner, and a manager can never grant themselves or others settings access.
- **Cashier** — sells at the register; every other permission is off by default and must be turned on individually by the owner.

---

## How the App Is Organized

When you open Wafi, the app checks three things in order:
1. Are you logged in? If not, you land on the welcome/login screen.
2. Does your role have permission to see this screen? If not, you're redirected to the dashboard (owner/manager) or straight to the register (cashier).
3. Is a shift currently open? The register page requires an open shift/cash drawer before you can sell.
4. Is this feature part of your shop's subscription pack? If not, you see an upgrade screen instead of a broken page.

---

## Features by Screen

### 1. Home / Dashboard (`/`)
**Who can see it:** owner by default; managers if the owner grants "view reports."

**What it does:** This is the business-health screen — the first thing an owner should check each day.

- **Shop name & greeting header** — shows the shop name and a time-of-day Arabic greeting with today's date.
- **Operator switch button** — lets whoever is holding the device swap to their own PIN without fully logging out (useful when a shift changes hands).
- **Connection status pill** — always-visible indicator of whether the app is currently online or working offline.
- **Alerts bell** — a badge appears when something needs attention (low stock, unpaid credit, upcoming installments).
- **Exchange rate widget** — shows the current USD→SYP rate. Tap it to open the rate editor and set a new rate. *Why it matters:* every sale, report, and receipt in SYP depends on this number being current — the "Sell" button is disabled until a rate is set.
- **Period toggle (Today / Week / Month)** — every number on the dashboard (revenue, chart, best sellers, cash) re-calculates for whichever period is selected.
- **KPI cards:**
  - **Revenue** — total sales for the period; tap to jump into Sale History.
  - **Gross Profit** — revenue minus cost of goods; tap to open a detailed Profit Sheet. Shows an "estimated" badge if any sold product is missing a cost price, so you know the number isn't fully trustworthy yet.
  - **Invoice count** — number of sales rung up; tap to jump into Sale History.
  - **Cash in drawer** — live total cash currently in the register; tap to open the Cash Drawer detail sheet.
- **Sales & profit chart** — a visual trend line for the selected period, auto-refreshing every 30 seconds while the screen is open.
- **Best sellers table** — the top 5 products by quantity sold, with units and revenue, so you know what's moving.
- **Health signals:**
  - **Low stock** — how many products are running low, with the top 3 named; tap to jump straight to the filtered product list.
  - **Customers who owe you money** — total count of debtor customers; tap to jump to a pre-filtered customer list.
  - **Installments due** — count and total amount of upcoming/overdue installment payments; tap to see the full list.
  - **Profit margin indicator** — a simple color signal (green/yellow/red) for how healthy your margins are right now.
- **Live activity feed** (desktop) — the last 5 sales as they happen, with amount and "how long ago."
- **Record expense button** — a quick shortcut to log a business expense (amount, category, photo of the receipt) without leaving the dashboard.
- **Unfinished sale recovery** — if the app was closed or crashed mid-sale, you're prompted on next open to resume or discard that cart.
- **Daily WhatsApp digest** — once a day, offers to send a summary of the day's numbers to the owner's WhatsApp (requires a WhatsApp number set in Settings).
- **Sell button** — the big call-to-action that takes you into the register; disabled until an exchange rate exists.

---

### 2. Point of Sale / Register (`/pos`)
**Requires:** an open shift (cash drawer). If none is open, you're sent to Shift History to open one first.

**What it does:** This is where sales happen.

- **Product grid** — browse or search the catalog, with category filter chips to narrow the view quickly.
- **Barcode scanning** — plug in any USB/Bluetooth barcode scanner (works like a keyboard) and scan items straight into the cart; also supports scanning with the device's camera if no scanner is attached. Scanning is protected so scanned characters never accidentally land in a text field you're typing in.
- **Quick-add product** — ring up an item that isn't yet in the catalog, on the fly, mid-sale.
- **Open item / manual price** — charge an ad-hoc amount for something that isn't a catalog product at all (e.g. a custom service).
- **Sale cart / panel** — shows every line item, lets you edit quantities, apply a per-line discount or a whole-sale discount, and shows the running total in both USD and SYP using the current exchange rate.
- **Discount limits** — cashiers and managers each have a maximum discount percentage they're allowed to apply (set by the owner); the register enforces this cap.
- **Payment screen:**
  - Cash in USD, cash in SYP, or card.
  - **Split payment** — combine multiple payment legs in one sale (e.g. part cash USD, part card).
  - **Sell on credit ("on account")** — record the sale against a customer's running balance instead of collecting payment now.
  - **Installment plan** — set up a payment plan right at the point of sale: down payment, number of installments, and weekly or monthly frequency.
- **Customer picker** — search for an existing customer or quick-add a new one when selling on credit or on an installment plan.
- **Draft auto-save** — the cart is saved locally as you build it, so an app crash or accidental close doesn't lose the sale in progress.
- **Sale confirmation screen** — after checkout, a receipt-style summary appears with options to print or share the receipt.

---

### 3. Sale History (`/history`)
**Who can see it:** any logged-in staff.

**What it does:**
- Search and browse past sales by date, payment method, or customer.
- View the full detail of any past sale.
- **Reprint a receipt** — reprints are clearly marked "Duplicate Copy" on the paper, specifically so a customer can't use an original plus a reprint to claim two refunds.
- **Process a return** — choose which line items and quantities are being returned, decide whether each returned item goes back into stock, pick the refund method (cash USD/SYP, store credit, or transfer), and record a reason from a configurable reason list.
- **View a completed return's detail** at any time.

---

### 4. Products & Back Office (`/back-office`, `/products`, `/categories`)
**Who can see it:** owner and managers (or anyone granted "manage products").

**What it does:**
- **Back Office hub** — a menu linking to products, categories, suppliers, stock-take, and receivings.
- **Product list** — search and filter by category/subcategory, plus quick filters for low-stock items and items missing a cost price (this second filter is deep-linked from the dashboard's "estimated profit" warning).
- **Quick stock adjustment** — a fast way to bump a product's stock count up or down.
- **Full stock adjustment** — records the old value, new value, a reason, and which device made the change (for accountability).
- **Product photo upload** — attach a photo to any product.
- **Product activity history** — see the history of stock changes and sales for one specific product.
- **Add/edit product** — bilingual (Arabic/English) name, price in USD, cost price in USD, barcode, category/subcategory, photo, low-stock threshold, and an active/inactive toggle.
- **Categories management** — create and organize categories and subcategories, with a quick-add shortcut.

---

### 5. Suppliers & Receivings (`/suppliers`, `/receivings`)
**Who can see it:** owner and managers (or anyone granted "manage products").

**What it does:**
- **Supplier directory** — add/edit suppliers with name, phone, contact person, address, and notes.
- **Supplier detail** — see a supplier's full receiving history.
- **New stock receiving** — record a shipment coming in: pick the supplier, pick each product received, enter quantity and unit cost per line (the app flags it if the cost differs from what's currently stored on the product), attach a photo of the supplier's invoice, and lock in the exchange rate at the time of receiving.
- **Receiving detail** — view any completed receiving and its line items.

*Why it matters:* this is how stock levels and product costs stay accurate, which is what makes the dashboard's profit numbers trustworthy.

---

### 6. Stock-Take / Inventory Count (`/stock-take`)
**Who can see it:** owner and managers (or anyone granted "manage products").

**What it does:**
- **Start a count** — count everything, or scope the count to just one category/subcategory.
- **Counting screen** — for each product, see the expected quantity next to what you actually counted (barcode-scan friendly), with the variance calculated live as you go.
- **Review screen** — before committing, review every variance (both in quantity and in USD value) so nothing gets adjusted silently.
- **Commit** — once confirmed, stock levels are corrected to match the physical count.
- **History** — a list of every past count session and its status (in progress / completed / cancelled).

---

### 7. Expenses (`/expenses`)
**Who can see it:** owner and managers granted "view expenses."

**What it does:**
- List of all business expenses, filterable by category.
- **Add/edit an expense** — amount in USD or SYP (auto-converted), category, date, notes, and a photo of the receipt as proof.
- **Paid-in-cash toggle** — marks whether the expense came out of the physical cash drawer, so it's correctly reflected in the current shift's cash balance.

---

### 8. Customers & Credit (`/customers`)
**Who can see it:** owner and managers (or anyone granted "manage customers").

**What it does:**
- **Customer directory** — search, add, and edit customers (name, phone, mobile, address).
- **Debtors filter** — jump straight to the list of customers who currently owe money.
- **Customer profile page:**
  - Outstanding balance and full invoice history.
  - Installment plan section, if the customer has one.
  - **Record a payment** — amount, currency, and method (cash, transfer, USDT, or hawala — only cash affects the register's cash balance), optionally applied to a specific installment.
  - Send a payment reminder or a full statement to the customer directly via **WhatsApp**.
- **Collections worklist** (`/customers/collections`, requires "view reports") — a working list of customers with overdue or outstanding balances, meant for actively following up on collections, with tracking of when each customer was last reminded.
- **Installments due** (`/installments`) — a cross-customer list of every upcoming or overdue installment payment, so nothing slips through the cracks. This same alert also appears on the dashboard.

---

### 9. Staff & Staff Ledger
**Who can see it:** owner and managers, scoped by permission (staff list is under Settings; ledger requires "view expenses").

**What it does:**
- **Staff list** — add/edit staff members: name, a 4-digit PIN (securely stored), role (owner/manager/cashier), individual permission toggles for managers and cashiers, and an active/inactive toggle.
- **PIN pad** — the numeric PIN entry used to switch operators or unlock the app.
- **PIN recovery** — one-time recovery codes let a staff member get back in if they forget their PIN. A manager can reset a cashier's PIN, but never a peer's or the owner's — and nobody can reset their own PIN this way (only through account-level recovery).
- **Operator switch** — quickly change who's "currently working" on a shared device without fully logging out.
- **Staff ledger** — a running record per staff member of advances, bonuses, penalties, carry-forward balances, write-offs, and corrections, each entered in USD or SYP at a locked-in exchange rate.
- **Monthly settlement draft** — combine a staff member's base salary with their ledger entries for a given month into a draft settlement.
- **Settlement detail** — the finalized or paid settlement record, with its payment method (cash/bank/other) and status.

---

### 10. Shifts & Cash Drawer
**What it does:** this is how the physical cash register is managed throughout the day.

- **First-time owner setup** — establishes the owner's account and PIN the first time the app is used on a device.
- **Lock screen** — locks the whole app behind a PIN, either after a period of inactivity or on relaunch; this is also where you open a new shift if none is currently open.
- **Opening a shift** — count and enter the opening cash in USD and SYP, either as a single manual total or broken down bill-by-bill and coin-by-coin using configured denominations.
- **Shift history** — a list of every past shift, open or closed; this is where you land if you try to sell without an open shift.
- **Shift detail** — opening/closing cash, variance, and the shift's Z-report.
- **Closing a shift (cash count)** — count the closing cash (manually or by denomination) and see the variance against what the system expected.
- **Force-close** — a manager or owner can force-close a shift that was accidentally left open (e.g. a lost device); if the variance is large, a note is required to explain it.
- **Z-Report** — an end-of-shift snapshot: total sales, breakdown by payment method, cash movements, expected vs. counted cash, and the final variance. Once created, this snapshot doesn't change.
- **Cash movements (pay-in/pay-out)** — record manual cash going in or out of the drawer mid-shift, each with a category and note; movements can be voided (which creates a reversing entry rather than deleting history).
- **Cash Drawer bar/sheet** (on the dashboard) — a live view of cash currently in the drawer plus recent movements, with a shortcut to record a new one.
- **Idle-lock overlay** — warns and then locks the screen automatically after a period of inactivity, to protect an unattended register.

---

### 11. Reports (`/reports`)
**Who can see it:** owner and managers granted "view reports," and only if the shop's subscription includes the Reporting Pack.

**What it does:**
- KPI tiles and a period toggle (same pattern as the dashboard, but with more depth).
- **Cumulative profit chart** — profit trend accumulated over time.
- **Expense breakdown chart** — a donut chart of expenses by category, plus a list of the top expenses.
- **Best sellers** — a deeper version of the dashboard's best-sellers card.
- **Drill-down** — tap into any metric to see the actual transactions behind the number.
- **Data-freshness indicator** — shows how up-to-date the numbers are relative to the last sync.
- **Profit sheet** — full profit/cost-of-goods/expenses breakdown, with the same "estimated" caveat as the dashboard when cost data is incomplete.

---

### 12. Settings (`/settings`)
**Who can see it:** owner and managers granted "manage settings" (managers can never grant this to themselves).

- **Personal Preferences** — the logged-in operator's own display/language preferences.
- **Theme picker** — choose the app's color theme.
- **Receipt settings** — shop name, tax number, header/footer text printed on receipts, a toggle for offering receipts via WhatsApp, and a live preview of what the printed receipt will look like.
- **Staff management** — see Staff & Staff Ledger above.
- **Return reasons** — manage the list of reasons a cashier can pick from when processing a return, including their display order and whether they're currently active.
- **Scanner diagnostics** — a live view of barcode-scanner activity (what keys were read, accepted, or rejected) used to fine-tune scanner timing settings if a particular scanner isn't behaving.
- **Devices** — see every POS device/terminal registered to the shop: rename it, deactivate an old one, and see when it was last active.
- **Audit log** — an append-only history of sensitive actions (staff changes, permission changes, PIN resets, etc.), showing who did what and when. This log cannot be edited or deleted, even by the owner.
- **Recovery codes** — generate or view one-time PIN-recovery codes for a staff member.
- **Exports** — export shop data (sales, products, customers, expenses, and more) to a downloadable file for use outside the app.
- **Denomination settings** — configure which bill and coin values are used for cash counting in USD and SYP.

---

### 13. Onboarding & Account
- **Onboarding wizard** (`/onboarding`) — first-run setup: business type, country, and shop name.
- **Welcome page** — the public landing screen shown to anyone not yet logged in.
- **Login / Sign up / Forgot password** — standard account access screens.
- **Feature-locked screen** — if a screen isn't included in the shop's current subscription pack, this upsell screen is shown instead of a broken page, explaining what pack unlocks it.

---

### 14. Always-Visible App Chrome
These aren't separate pages, but appear throughout the app:
- **Connection pill** — always shows whether you're online or offline.
- **Sync indicator** — shows how much is waiting to sync and whether anything failed to sync; anything that permanently fails to sync (due to a conflict or rejection) is quarantined separately so it doesn't block everything else from syncing, and can be retried or discarded.
- **Exchange rate widget** — visible on the dashboard, editable at any time.

---

## How Offline Mode Works

Wafi keeps a full copy of the shop's data on the device itself. Every action — a sale, a stock adjustment, an expense — is saved locally first, so the app works exactly the same with or without internet. When a connection is available, changes sync automatically in both directions between the device and the cloud, without the shop owner needing to do anything.

If a specific change can't be synced (for example, it conflicts with something else), it's set aside separately instead of getting stuck and blocking everything else from syncing — the owner can review and decide what to do with it later.

Because the app is a PWA, updates roll out automatically in the background — you'll see a gentle "update available" notice rather than a forced reload in the middle of a sale.

## Arabic & Currency Support

The app is built Arabic-first: right-to-left layout, Arabic dates, and Arabic labels for roles and screens throughout. Every price is tracked internally in USD and displayed in both USD and SYP using a manually-set, always-visible exchange rate — because in this market, the exchange rate is not a background setting, it's something the owner needs to see and control every day.

## Hardware Support

- **Barcode scanners** — any standard USB or Bluetooth barcode scanner works out of the box (it's treated like a keyboard), with a diagnostics screen to fine-tune timing if a specific scanner needs it. Scanning with the device's own camera is also supported.
- **Receipt printers** — the app is built to support thermal receipt printers through a swappable driver, so new printer models can be added without changing anything else in the app. Receipt content and layout are fully configurable in Settings.
- **Cash drawer** — cash handling (opening/closing counts, denomination breakdowns, movements) is fully supported logically; a hardware drawer-kick trigger will come with a real printer driver, since most thermal printers can trigger the drawer directly.
