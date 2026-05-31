# Epic 2 — Manage Products and Track Stock

**Epic ID:** EPIC-02
**Pack:** Core
**Depends on:** Epic 1 (sales must exist to deduct stock)
**Blocks:** Epic 3 (profit needs cost prices), Epic 4 (sales-on-account need products)

---

## Epic summary

**Goal:** Owner can add products manually, import from Excel, scan barcodes, and the system tracks stock levels and alerts when low. Sales from Epic 1 deduct stock automatically.

**Value delivered:** The product becomes the system of record for inventory. Owner stops using spreadsheets to track stock.

**In scope:** Manual product CRUD, barcode scanning (USB + camera), Excel import wizard, stock deduction on sale, low-stock alerts on home screen, basic stock adjustment.

**Out of scope:** Multi-location stock (Warehouse module, v1.5), composite items / bundles (v1.5), supplier records (later epic), purchase orders (later epic), barcode label printing (v1.5), stock receiving workflow with supplier invoice photo (later epic), product cost history (later — only current cost in this epic).

---

## User stories

### Story 2.1 — Add a product manually

**As an** owner
**I want to** add a product with name, price, stock, and other details
**So that** I can sell it from the POS

**Acceptance criteria:**

- **Given** I am in Back Office or on the phone Products section
  **When** I tap "إضافة منتج" (Add product)
  **Then** the add product form opens

- **Given** the add product form is open
  **When** I view the fields
  **Then** I see (in order): Arabic name (required), English name (optional), barcode (optional), category (optional, free text), cost price USD (required), sale price USD (required), current stock (required), low-stock threshold (optional, defaults to 5), photo (optional)

- **Given** I fill in the required fields
  **When** I tap "حفظ" (Save)
  **Then** the product is saved and I see a success toast "تم حفظ المنتج"

- **Given** I fill in the required fields
  **When** I tap "حفظ وإضافة آخر" (Save and add another)
  **Then** the product is saved AND the form is reset to empty for the next product, with focus on the Arabic name field

- **Given** I leave a required field empty
  **When** I tap Save
  **Then** the empty field is highlighted in red with an error message below: "هذا الحقل مطلوب"

- **Given** I enter a sale price lower than cost price
  **When** I tap Save
  **Then** I see a warning (not blocking): "سعر البيع أقل من سعر التكلفة — هل أنت متأكد؟" with Yes/No

- **Given** I add a photo
  **When** the photo is captured or uploaded
  **Then** it is compressed to max 200KB WebP format before saving locally

- **Given** the form is open
  **When** I tap "إلغاء" (Cancel)
  **Then** I see a confirmation if there are unsaved changes: "تجاهل التغييرات؟" with Yes/No

---

### Story 2.2 — Scan a barcode to find or add a product

**As an** owner
**I want to** scan a barcode with a USB scanner or my phone camera
**So that** I can quickly find or add products

**Acceptance criteria:**

- **Given** a USB barcode scanner is connected (keyboard emulation mode)
  **When** I am on the Products list with the search bar focused
  **And** I scan a barcode
  **Then** the barcode value is entered into the search field

- **Given** I scanned a barcode that matches an existing product
  **When** the search executes
  **Then** the matching product is displayed and can be tapped to edit

- **Given** I scanned a barcode that does NOT match any product
  **When** the search returns 0 results
  **Then** I see a button "إضافة منتج جديد بهذا الباركود" (Add new product with this barcode) — tapping it opens the Add Product form with barcode pre-filled

- **Given** I am on the Add Product form
  **When** I tap the barcode field's camera icon
  **Then** my phone camera opens for barcode scanning using the `@zxing/browser` library

- **Given** the camera is open for scanning
  **When** a barcode is detected
  **Then** the value fills the barcode field and the camera closes within 1 second

- **Given** the camera is open for scanning
  **When** I tap "إلغاء" (Cancel) or the back button
  **Then** the camera closes and the barcode field stays empty

- **Given** the camera scan fails to read any barcode for 30 seconds
  **When** the timeout occurs
  **Then** I see "لم نتمكن من قراءة الباركود — أدخل يدوياً" (Could not read barcode — enter manually) with the camera still active

- **Given** I scanned a barcode that already exists on another product
  **When** I try to save
  **Then** I see an error: "هذا الباركود مستخدم على منتج آخر: [product name]" with a button to view that product

---

### Story 2.3 — Import products from Excel

**As an** owner
**I want to** upload an Excel file with my products and have them imported in bulk
**So that** I can set up my shop in minutes instead of hours

**Acceptance criteria:**

- **Given** I am on the Products list
  **When** I tap "استيراد من Excel" (Import from Excel)
  **Then** the import wizard opens at Step 1

**Step 1 — Upload**
- **Given** I am on Step 1
  **When** I view the screen
  **Then** I see a large drag-and-drop area with text "اسحب الملف هنا أو اضغط للاختيار" and accepted formats: .xlsx, .xls, .csv

- **Given** I drop a valid file
  **When** the file is parsed
  **Then** I advance to Step 2 with the file's data loaded

- **Given** I drop an invalid file (wrong format, corrupt, or >5MB)
  **When** the upload fails
  **Then** I see a specific error message: "الملف يجب أن يكون Excel أو CSV" / "الملف تالف" / "الحجم أكبر من 5 ميغابايت"

**Step 2 — Map columns**
- **Given** the file is parsed and Step 2 opens
  **When** I view the screen
  **Then** I see the file's columns on the left and our system's fields on the right (Arabic name, English name, barcode, cost USD, sale USD, stock, category, low-stock threshold)

- **Given** the system attempts auto-detection
  **When** column headers contain known terms
  **Then** matches are pre-filled:
  - "الاسم" / "اسم المنتج" / "name" / "product name" → Arabic name OR English name (based on text content)
  - "السعر" / "سعر البيع" / "price" / "selling price" → Sale price USD
  - "التكلفة" / "سعر الشراء" / "cost" → Cost price USD
  - "الكمية" / "المخزون" / "qty" / "quantity" / "stock" → Current stock
  - "الباركود" / "barcode" → Barcode
  - "الفئة" / "category" → Category

- **Given** the system detects currency
  **When** values in a price column are >5,000
  **Then** the system suggests SYP and shows a toggle to convert at current exchange rate to USD

- **Given** the system detects currency
  **When** values in a price column are 1-5,000
  **Then** the system suggests USD by default

- **Given** I can manually adjust mappings
  **When** I tap a column-to-field mapping
  **Then** I can change it via dropdown

- **Given** a required field (Arabic name, sale price, stock) has no mapping
  **When** I try to proceed
  **Then** I see "يجب ربط: [الاسم العربي، سعر البيع، المخزون]" and the Continue button is disabled

- **Given** Step 2 is configured
  **When** I view the preview section
  **Then** I see the first 5 rows as they will be imported with all fields mapped

**Step 3 — Confirm and import**
- **Given** I tap "متابعة" (Continue)
  **When** Step 3 loads
  **Then** I see a summary: "سيتم استيراد 247 منتج" with a list of any warnings (duplicates, missing optional fields, invalid values)

- **Given** there are validation errors (e.g., negative prices, missing required fields)
  **When** I view Step 3
  **Then** the count is split: "240 منتج صالح، 7 منتجات بأخطاء — هل تريد تخطي الأخطاء أو الإصلاح؟"

- **Given** I tap "استيراد"
  **When** the import runs
  **Then** I see a progress bar with count "150 / 247" and an estimated time

- **Given** the import completes
  **When** I view the result
  **Then** I see "تم استيراد 240 منتج بنجاح" with a button to view the products list

- **Given** there were skipped errors
  **When** I view the result
  **Then** I see a button "تنزيل ملف الأخطاء" (Download errors file) that gives me back the rows that failed with the reason

- **Given** a product with the same barcode already exists
  **When** the import encounters it
  **Then** I see in the warnings: "X منتجات تطابق باركود موجود — هل تريد التحديث أو التخطي؟" with Update / Skip choices

---

### Story 2.4 — Stock deducts automatically when sales are rung

**As an** owner
**I want** stock to decrease automatically whenever a sale is completed
**So that** I don't have to manually update inventory

**Acceptance criteria:**

- **Given** a sale is confirmed in the POS (Epic 1, Story 1.3)
  **When** the sale completes
  **Then** for each line item, the product's stock field is decreased by the line quantity

- **Given** a product has stock 10
  **When** a sale is rung for quantity 3
  **Then** the product's stock is now 7

- **Given** a product has stock 2
  **When** a sale is rung for quantity 5
  **Then** the sale completes successfully, stock becomes -3, AND the sale line is flagged with a small warning icon visible in sale history

- **Given** stock becomes negative
  **When** I view the Products list
  **Then** the product row shows a yellow warning indicator and the stock number is displayed in red

- **Given** the device is offline
  **When** a sale is rung
  **Then** stock is decremented locally in the cache; sync queues the change

- **Given** two devices both offline sell the same product (last unit)
  **When** they sync
  **Then** both sales record (no rejection), the second device's stock will reflect negative, owner sees this in Products list as a warning

---

### Story 2.5 — See low-stock alerts on the home screen

**As an** owner
**I want to** see at a glance which products are running low
**So that** I can reorder before I run out

**Acceptance criteria:**

- **Given** at least one product has stock at or below its low-stock threshold
  **When** I view the home screen
  **Then** I see a card titled "مخزون منخفض" with the count and top 3 product names

- **Given** no products are below threshold
  **When** I view the home screen
  **Then** the low-stock card shows "كل المنتجات متوفرة" (All products in stock) with a check icon

- **Given** I tap the low-stock card
  **When** the full list opens
  **Then** I see all products at or below threshold, sorted by how far below threshold (most critical first)

- **Given** I view the low-stock list
  **When** I see a product
  **Then** I see: name, current stock, threshold, "تم الطلب" (Mark as reordered) button

- **Given** I tap "Mark as reordered" on a product
  **When** the action records
  **Then** the product is hidden from the low-stock list for 7 days (even if still below threshold), with a small "تم طلبه" indicator

- **Given** 7 days pass after "Mark as reordered"
  **When** the product is still below threshold
  **Then** it reappears in the low-stock list

- **Given** a product reaches its low-stock threshold during a sale
  **When** the sale is confirmed
  **Then** the home screen low-stock card updates within 1 minute (real-time push if online, on next visit if offline)

- **Given** the low-stock card uses color
  **When** I view it
  **Then** the accent color is yellow (NOT red — red is reserved for offline/errors)

---

### Story 2.6 — Edit a product

**As an** owner
**I want to** update a product's price, stock, name, or other details
**So that** I can keep my catalog accurate

**Acceptance criteria:**

- **Given** I am on the Products list
  **When** I tap a product
  **Then** the edit screen opens with all current values pre-filled

- **Given** I change one or more values
  **When** I tap Save
  **Then** the changes are saved and a success toast appears

- **Given** I change the sale price
  **When** the change is saved
  **Then** all past sales of this product retain their original sale price (no retroactive update)

- **Given** I change the cost price
  **When** the change is saved
  **Then** all past sales retain the cost price that was active at the time of sale (needed for Epic 3 profit calculations)

- **Given** I view the bottom of the edit screen
  **When** the product has any change history
  **Then** I see "آخر تعديل: قبل ساعتين" (Last edited: 2 hours ago)

- **Given** I want to manually adjust stock (correction, not a sale)
  **When** I edit the stock field directly
  **Then** I am prompted: "سبب التعديل" (Reason for adjustment) with options: "جرد" (Stocktake), "تالف" (Damaged), "مفقود" (Lost), "أخرى" (Other — free text)

- **Given** I save a stock adjustment
  **When** the change is recorded
  **Then** an entry is created in the product's history with: old value, new value, reason, timestamp (visible in Epic 5's audit log)

- **Given** I want to delete a product
  **When** I tap "حذف"
  **Then** I see a confirmation: "حذف هذا المنتج؟ لن يظهر في القائمة بعد الآن، لكن سجلات البيع السابقة ستبقى."

- **Given** I confirm delete
  **When** the action completes
  **Then** the product is soft-deleted (hidden from lists but past sales still reference it correctly)

---

### Story 2.7 — Browse products offline

**As a** cashier or owner
**I want** the product catalog to work offline
**So that** sales continue when WiFi is down

**Acceptance criteria:**

- **Given** I opened the app at least once online
  **When** I disconnect from network
  **Then** the full product catalog is available for browsing and selling

- **Given** I am offline
  **When** I add a new product or edit an existing one
  **Then** the change is saved locally and queued for sync (Epic 1's sync indicator covers this)

- **Given** I am offline
  **When** I import an Excel file
  **Then** import works locally; sync queues all new products when online

- **Given** I am offline
  **When** I scan a barcode
  **Then** local product cache is searched (no server roundtrip)

- **Given** the product catalog has 5,000 products
  **When** I search
  **Then** results appear within 200ms even offline

---

## Screens and states

### Screen 1: Products list (Back Office)

**Layout (desktop):** Full-page table.

**Columns:** Photo (thumbnail), Arabic name, Barcode, Cost USD, Sale USD, Stock, Threshold, Last sold, Actions (edit/delete icons).

**Above table:** Search bar, filter by category dropdown, sort dropdown, "Add product" button, "Import from Excel" button.

**States:**
- **Default:** Table populated, all controls enabled
- **Empty (no products):** Centered illustration + "ابدأ بإضافة منتجاتك" + two big buttons: "Add product" / "Import from Excel"
- **Search active:** Table filters in real time
- **Low stock filter active:** Only shows products at/below threshold, highlighted yellow
- **Loading:** Skeleton rows

### Screen 2: Products list (phone)

**Layout:** Card-based list.

**Each card:** Thumbnail (left), name + barcode (top right), stock + price (bottom right), warning icon if low/negative stock.

**Above list:** Search bar with barcode-scan camera icon, FAB bottom-start for "Add".

**Pull-to-refresh** triggers manual sync.

### Screen 3: Add/Edit Product form

**Layout:** Single column, scrollable. Form sections:

1. **Basic info:** Arabic name, English name, Barcode (with camera scan icon), Category
2. **Pricing:** Cost USD, Sale USD (with margin % calculated and shown below as helper text)
3. **Inventory:** Current stock, Low-stock threshold
4. **Media:** Photo (with camera and upload options)

**Bottom:** Save button (primary), Save & Add Another (secondary), Cancel.

**States:**
- **Add mode:** All fields empty (except threshold = 5 default)
- **Edit mode:** Fields pre-filled with current values
- **Validation error:** Red border + error message under field
- **Sale price < cost price warning:** Yellow banner above Save
- **Saving:** Save button spinner, all fields disabled

### Screen 4: Excel Import Wizard

**Layout:** Full-screen modal, 3-step progress indicator at top.

**Step 1 — Upload:**
- Drag-and-drop zone (60% of screen)
- "Choose file" button below
- File requirements list (formats, size limit)
- Back button (close wizard)

**Step 2 — Map columns:**
- Two-column layout: left shows file's column headers with sample data, right shows our fields
- Drag-and-drop OR dropdown-based mapping
- Auto-detected mappings pre-filled and highlighted green
- Live preview of first 5 rows as they'll be imported
- Currency override per column
- Back / Continue buttons

**Step 3 — Review and import:**
- Summary: "X products will be imported"
- Warning list (collapsible)
- Duplicate handling choice (Update / Skip)
- Import button (large, primary)
- During import: progress bar
- After import: success summary + "View products" button + optional "Download error file"

### Screen 5: Low-stock list

**Layout:** Filtered version of the products list.

**Each row adds:** "Mark as reordered" button, "Reordered X days ago" badge if applicable.

**Sort:** Most critical (furthest below threshold) first.

### Screen 6: Stock adjustment dialog

**Trigger:** Edit product, change stock value, save.

**Modal asks:** Reason (radio: Stocktake / Damaged / Lost / Other), optional notes textarea, Confirm button.

---

## Fields and validation

### Product record
| Field | Type | Required | Validation |
|---|---|---|---|
| product_id | UUID | yes | Generated locally |
| name_ar | string | yes | Min 1 char, max 200 |
| name_en | string | no | Max 200 |
| barcode | string | no | Unique across products if present, max 50 |
| category | string | no | Max 100, free text |
| cost_price_usd | decimal | yes | ≥ 0 |
| sale_price_usd | decimal | yes | ≥ 0 |
| current_stock | integer | yes | Any integer (can be negative) |
| low_stock_threshold | integer | no | ≥ 0, default 5 |
| photo_url | string | no | Local IndexedDB blob URL or cloud URL |
| created_at | timestamp | yes | Set on creation |
| updated_at | timestamp | yes | Set on every edit |
| deleted | boolean | yes | Soft-delete flag, default false |
| sync_status | enum | yes | pending, syncing, synced, error |

### Stock adjustment record (for manual changes, not sales)
| Field | Type | Required | Validation |
|---|---|---|---|
| adjustment_id | UUID | yes | Generated locally |
| product_id | UUID | yes | Must exist |
| old_value | integer | yes | |
| new_value | integer | yes | |
| reason | enum | yes | stocktake, damaged, lost, other |
| notes | string | no | If reason = other, required |
| created_at | timestamp | yes | |
| device_id | UUID | yes | Which device made the change |

---

## Edge cases

1. **Excel file with merged cells in headers:** Detector treats merged cell text as the column header. If merge spans multiple data columns, prompt user to unmerge in source file.

2. **Excel file with header row not in row 1 (e.g., row 3):** Auto-detect by finding the first row where most cells look like field names. Provide a manual "skip rows" option.

3. **Excel currency formatting like "10,000 ل.س":** Parser strips currency symbols and thousand separators. SYP suggested.

4. **Excel with mixed RTL/LTR text in same cell:** Render correctly using Unicode bidi algorithm.

5. **Excel with empty rows in the middle:** Skip them, don't count as products.

6. **Excel with Arabic + English column names side-by-side:** Detect both, suggest mapping based on the column type.

7. **Excel with duplicate barcodes within the file:** Show in warnings; user chooses to keep first / keep last / skip all duplicates.

8. **Product photo upload of 10MB:** Compress before storing. If browser cannot compress (very old device), reject with clear error.

9. **5,000 products in catalog, search performance:** Use indexed local search (e.g., FlexSearch or similar) with Arabic normalization preprocessing.

10. **Barcode scanner sends Enter after value:** App handles by treating Enter as "search now" — works seamlessly.

11. **Two devices edit same product offline (one changes price, other changes stock):** On sync, both changes apply (different fields). If they edit the same field, last-write-wins by timestamp; show owner a notification in audit log.

12. **Deleting a product that's in a current open sale:** Block delete with message "هذا المنتج في بيع مفتوح حالياً" — owner must close/clear the sale first.

13. **Importing 10,000 products at once:** Import is chunked (500 at a time) to avoid blocking UI. Progress updates in real time.

14. **Stock threshold = 0:** Low-stock alert fires when stock = 0. Out-of-stock card shows.

15. **Product with photo on offline device, syncs to cloud later:** Photo upload happens after metadata sync; offline references local blob URL until cloud URL replaces it.

---

## Definition of Done

- [ ] All 7 stories pass their acceptance criteria
- [ ] Owner can add 50 products manually in under 30 minutes (measured)
- [ ] Owner can import 200 products from a realistic messy Excel in under 5 minutes
- [ ] Barcode scan (USB) returns product in <500ms; camera scan in <2s
- [ ] Stock deducts correctly across 100 consecutive sales (including 20 offline)
- [ ] Low-stock alerts appear on home screen within 1 minute of crossing threshold
- [ ] Excel import tested against at least 5 real spreadsheets from CEO's contacts
- [ ] Product photos compress correctly; 200KB max stored per photo
- [ ] Search returns results in <200ms with 5,000-product catalog, offline
- [ ] Brother's full real inventory is imported and in daily use
- [ ] All edge cases above either handled or explicitly documented as known limitations
- [ ] Tested on cheap Android phone and iPhone for full flow
- [ ] No data loss across offline → online cycles with product edits
