# وافي (Wafi) — QA Test Report

**Build:** `wafi` v0.1.5 · Vue 3 + Pinia + PrimeVue + PowerSync/wa-sqlite + Supabase
**Environment:** `http://localhost:5173` · Chrome 151 · Windows · viewport 1118×742 → 1080×718 · shop `d8483aaf…30058` · device **E** · operator **Anas** (owner)
**Session:** 22–23 Aug 2026, ~23:58 → ~00:55 local (UTC+3)
**Tester:** Senior QA — exploratory + functional + logical + UI/UX, black-box with source cross-reference via the Vite dev server

---

## 1. Verdict

**Not shippable.** There is one **blocker** that makes the whole product non-functional as a system of record: *every* write to `sales`, `sale_line_items`, `sale_payments`, `stock_adjustments` and `events` is rejected by the backend with a row-level-security violation. 47 transactions are stuck. The app writes to the local SQLite replica, tells the user "تم البيع بنجاح", and nothing ever reaches the server. Lose the device, lose the business.

Behind that sit two **critical** frontend defects that are independent of the backend problem — a broken event-projection pipeline that zeroes out every profit/revenue KPI on the owner's home screen, and inconsistent UTC/local date handling that makes a saved expense vanish from "today".

The good news: the **money arithmetic is correct** everywhere I could check it — cart totals, discounts, margins, SYP conversion at 14,000/$, cash-drawer running balance, debt tracking, and the shift report's payment-mix reconciliation all balance to the cent. The bugs are in plumbing, state, dates and feedback — not in the maths.

### Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Critical | 5 |
| High | 7 |
| Medium | 16 |
| Low | 15 |
| **Total** | **44** |

Coverage: 11 of ~55 routes exercised end-to-end. Testing stopped early — see [§9 Not tested](#9-not-tested).

---

## 2. How to read this report

Every finding has a stable ID (`WAFI-nn`), the exact screen, numbered reproduction steps, **Observed** vs **Expected**, and — where I could pin it down — the responsible file and the reason. Findings are ordered by severity, not by discovery order.

Anything I *verified as working* is in [§8](#8-what-works). Please read that section too; several of the bugs below are inconsistencies against behaviour the app already gets right elsewhere, and the fix is often "do it the way the shift-close screen does it".

---

## 3. Blocker

### WAFI-01 — Every write is rejected by the backend (RLS), while the UI reports success
**Severity:** Blocker · **Area:** Sync / backend · **Reproducible:** 100%

**Steps**
1. Open the app. Look at the header: `⚠ 46 معاملة متوقفة — بحاجة لمراجعة`.
2. Edit any product and save (e.g. `/products` → مقص متعدد الاستخدام → change a price → حفظ).
3. The header flashes `فشل رفع التغييرات إلى الخادم [PowerSync upl…` and the counter increments to **47**.
4. Click the header banner to open **حالة المزامنة**.

**Observed** — the panel lists stalled transactions under *"معاملات متوقفة عن المزامنة — رفضها الخادم ولم تُحذف"*, each with the error:

```
new row violates row-level security policy (USING expression) for table "sales"
new row violates row-level security policy (USING expression) for table "sale_line_items"
new row violates row-level security policy (USING expression) for table "sale_payments"
new row violates row-level security policy (USING expression) for table "stock_adjustments"
new row violates row-level security policy (USING expression) for table "events"
```

**Expected** — writes reach Postgres; or, if they legitimately cannot, the user is told loudly and clearly that the shop is operating in a state where data will be lost.

**Why this is a blocker**
- Sales, payments, stock movements and the entire event log are local-only. A device wipe / browser reset / new device = total data loss.
- `events` being rejected means the audit trail is local-only too, so there is no server-side record of what happened.
- POS still reports `تم البيع بنجاح` with an invoice number for every one of these. The cashier has no way to know.

**Four UI defects stacked on top of it** (fix these regardless of the RLS policy):
| ID | Problem |
|---|---|
| WAFI-01a | The connection chip stays **green "متصل"** while 47 transactions are permanently rejected. Connectivity ≠ health. |
| WAFI-01b | The error strings are **truncated with an ellipsis** in the panel (`…expression) for table 'sales'`). The operator physically cannot read what went wrong. |
| WAFI-01c | Errors are **raw English Postgres text** inside an Arabic RTL UI. |
| WAFI-01d | The stalled-sync banner is **absent from the Home dashboard** (`/`) — the one screen the owner actually looks at. It only appears on `/products`, `/pos`, `/history`, … |

**Note on the RLS policy itself:** the message says `USING expression`, not `WITH CHECK`. For an `INSERT`, Postgres normally reports `WITH CHECK`; a `USING`-clause violation on insert usually means the policy is `FOR ALL` and the `USING` predicate does not match the rows the client is writing (most often a `shop_id` / `staff_id` / JWT-claim mismatch). Worth checking that the client's inserted `shop_id` equals the one in the auth token.

---

## 4. Critical

### WAFI-02 — Event projections crash on every event, so all profit/revenue KPIs read $0
**Severity:** Critical · **Area:** Home dashboard, reports, event pipeline · **Reproducible:** 100%

**Root cause (found in source)** — `src/services/events/processProjectionAtMostOnce.ts`:

```sql
insert into local_event_processed_ledger (subscriber_id, event_id, processed_at)
values (?, ?, ?)
```

`id` is omitted, but it is the `NOT NULL` primary key of the PowerSync local table. Every call throws:

```
NOT NULL constraint failed: ps_data_local__local_event_processed_ledger.id
```

logged from `src/services/events/useEventSubscription.ts:52` as
`[useEventSubscription] watch loop failed sale.completed` and `… expense.recorded`.

The sibling file `src/services/events/runDurableSubscriber.ts` gets this right — it does include `id`:
`insert into local_subscriber_processed_events (id, subscriber_name, event_id, processed_at) values (?, ?, ?, ?)`.

**Consequence** — `dashboardRevenueProjection`, `profitCacheProjection` and `dailyEventCountsProjection` never advance.

**Steps to see the user-facing damage**
1. In POS, sell one حافظة قهوة كبيره — sell $15.00, cost $10.00, so profit should be $5.00.
2. Go to الرئيسية → tab **اليوم**.

**Observed** — the four KPI tiles contradict each other and contradict the panels below them:

| Tile / panel | Shows | Should show |
|---|---|---|
| النقد في الصندوق | **$15** ✅ | $15 |
| النشاط المباشر | **$15.00** ✅ | $15.00 |
| أكثر المنتجات مبيعاً | **حافظة قهوة كبيره · 1 مبيعة · $15** ✅ | same |
| الفواتير | **0** ❌ | 1 |
| المال الداخل | **$0** ❌ | $15 |
| الربح الإجمالي | **$0**, هامش **0%** ❌ | $5, 33% |
| إشارات الصحة | red **"الهامش 0% — هامش منخفض"** ❌ | no alert |

The cash drawer and top-products panels read straight from tables, which is exactly why only they are right. Everything driven by a projection is stuck at zero — including the false red "low margin" health alarm, which will train owners to ignore health alerts.

**Fix** — add `id` (a generated UUID) to the insert. One line. Then rebuild projections (`npm run projections:rebuild` exists in `package.json`).

---

### WAFI-03 — Boot-time SQL syntax error: `DELETE … alias` is invalid in SQLite
**Severity:** Critical · **Area:** Local DB maintenance · **Reproducible:** 100%, 7+ times per boot

**Steps** — open the app with DevTools console open.

**Observed** — repeated uncaught exceptions from `src/services/events/cleanupLocalEventTables.ts:18`:

```
Error: near "l": syntax error
```

**Root cause** — the statement is:

```sql
delete from local_event_processed_ledger l
 where not exists (select 1 from events e where e.id = l.event_id)
```

SQLite does not support a table alias in `DELETE FROM`. The `l` is the syntax error.

**Fix**

```sql
delete from local_event_processed_ledger
 where not exists (
   select 1 from events e where e.id = local_event_processed_ledger.event_id
 )
```

**Impact** — local event tables are never pruned, so the on-device SQLite grows without bound. On a POS tablet running for months this becomes a performance and storage problem. It is also 7 uncaught exceptions per boot masking real errors in the console.

---

### WAFI-04 — A saved expense disappears from "مصاريف اليوم"
**Severity:** Critical · **Area:** Expenses, date handling · **Reproducible:** 100%

**Steps**
1. Go to `/expenses`. The **اليوم** tab is active by default. The app header says today is **الأحد، ٢٣ آب ٢٠٢٦**.
2. Click **إضافة مصروف**.
3. Note that **تاريخ المصروف is pre-filled as `2026-08-22`** — *yesterday*, per the app's own header.
4. Leave the date alone. Enter المبلغ = `5` USD, الفئة = **إيجار**, طريقة الدفع = **نقدًا**. Click **حفظ**.
5. Toast: **"تم حفظ المصروف"**. The page still shows **"لا توجد مصاريف في هذه الفترة"**.
6. Switch to the **الأسبوع** tab.

**Observed** — the expense is there, and the list renders its date as **"٢٣ آب، ١٢:٣٧ ص"**. Three components disagree about the same record:

| Component | Says |
|---|---|
| Dialog date default | `2026-08-22` |
| List date formatter | `٢٣ آب ١٢:٣٧ ص` |
| "اليوم" period filter | excludes it |

**Expected** — an expense recorded now appears under "today", and one timezone (the shop's) is used for the form default, the stored value, every formatter and every period filter.

**Impact** — the owner records a real expense, gets a success toast, and the expense is not in today's expenses. Silent data-shaped loss. Same root cause as WAFI-05.

**Note** — the *receiving* dialog gets this right (`التاريخ: ٢٣ آب ٢٠٢٦`), so the correct behaviour already exists in the codebase.

---

### WAFI-05 — Records created minutes apart are dated on different days
**Severity:** Critical · **Area:** Dates, reporting, shift reconciliation · **Reproducible:** near midnight

**Steps**
1. ~00:31 local — create a credit (آجل) sale for QA Test Customer. Open the customer page: the open invoice **E-000014** is dated **٢٣ آب ٢٠٢٦**.
2. ~00:35 local — record an $8.00 payment against it (تسجيل دفعة).
3. Look at **سجل الدفعات** on the same page.

**Observed** — the payment is dated **٢٢ آب ٢٠٢٦**. Two records four minutes apart, rendered one day apart, on the same screen.

**Cause** — one path formats in local time, the other in UTC. Local is UTC+3, so 00:35 local = 21:35 UTC the previous day.

**Impact** — daily sales and collection reports, and shift reconciliation, will attribute cash to the wrong day for anything transacted between midnight and 03:00. For a shop that closes late this is every night.

---

### WAFI-06 — The app spontaneously performs a full page reload, destroying in-progress work
**Severity:** Critical · **Area:** App shell · **Reproducible:** twice observed, ~15s–2.5min after landing on a page

**Steps**
1. Go to `/pos`. Add items to the cart (I had حافظة قهوة كبيره ×4 with a $1 discount + زيت طبخ, total $56.00).
2. Click **دفع** → **نقدي دولار**. Type an amount.
3. Wait.

**Observed** — the payment dialog closes itself, the cart empties, and POS returns to `اضغط على منتج لإضافته`. Confirmed as a genuine document reload, not a route change:

```js
performance.getEntriesByType('navigation')[0].type  // → "reload"
performance.timeOrigin                              // → 12:20:41 AM, while sitting on /pos
```

Injected instrumentation (`window.__qaInstalled`) was wiped, confirming a fresh document. The same thing happened earlier on `/products/:id/edit`, ~15 seconds after arriving, showing the full `وافي / جارِ التحميل…` boot splash.

**Expected** — no unprompted reloads; and if a reload is genuinely required (schema migration, version bump), block it while a cart or a dirty form exists, or warn first.

**Impact** — a cashier loses a rung-up basket mid-transaction in front of a customer. An editor loses unsaved form data. Find what calls `location.reload()` (a schema/version watchdog or a sync error handler are the likely suspects) and gate it.

---

## 5. High

### WAFI-07 — Save/confirm buttons fail silently, in four separate dialogs
**Severity:** High · **Area:** Cross-cutting · **Reproducible:** 100%

This is one defect wearing four hats. In each case a primary action button looks fully enabled, the user clicks it, and **absolutely nothing happens** — no toast, no spinner, no scroll, no focus change. The validation message does render, but off-screen, above the fold, next to a field the user cannot see from the button.

| # | Screen | Steps | What the user never sees |
|---|---|---|---|
| a | `/products/:id/edit` | Open any product with no category (e.g. مقص متعدد الاستخدام). Scroll to the bottom. Click **حفظ**. | `هذا الحقل مطلوب` under الفئة, ~700px above |
| b | `/products/:id/edit` | Set سعر التكلفة 100, سعر البيع 50. Click **حفظ**. | The confirm prompt `سعر البيع أقل من سعر التكلفة – هل أنت متأكد؟` with نعم، احفظ / لا، تراجع, rendered up next to التسعير |
| c | `/expenses` → إضافة مصروف | Scroll to the bottom without filling anything. Click **حفظ**. | `أدخل المبلغ` and `اختر فئة` at the top of the dialog |
| d | `/customers/:id` → تسجيل دفعة | Tick invoice E-000014 (remaining $12.00), change the amount to `50`. إجمالي الدفعة shows **$50.00** and تأكيد الدفعة renders bright blue. Click it. | *nothing at all* — no message is rendered anywhere. Tested twice, including a direct DOM-targeted click. |

**Expected** — on a blocked submit: scroll the first invalid field into view, focus it, and raise a toast.

**The app already does this correctly** on the shift-close screen, which renders `الفرق يتجاوز 5% – أدخل سبب الفرق قبل الإغلاق.` directly under the field, in context, in Arabic. And the toast system works (`تم إضافة الزبون`, `تم تسجيل الدفعة`, `تم حفظ المصروف`). Copy that pattern into these four dialogs.

**Case (d) additionally needs a real fix:** the per-invoice amount input should be capped at the remaining balance, or show `المبلغ أكبر من المتبقي`. Right now over-payment is accepted by the input, displayed in the total, and then rejected in silence.

---

### WAFI-08 — Negative selling price is accepted, saved, then silently rolled back — taking unrelated edits with it
**Severity:** High · **Area:** Products · **Reproducible:** 100%

**Steps**
1. `/products` → search `مقص` → open **مقص متعدد الاستخدام** (starts at cost $0.00, sell $0.00, no category).
2. Set الفئة = **غير مصنف**.
3. Set سعر التكلفة = `100`, سعر البيع = `-10`.
4. The **هامش الربح على التكلفة** indicator silently *disappears* (it correctly showed `-50%` for 100/50; for a negative price it renders nothing instead of flagging the problem).
5. Click **حفظ** → scroll up → confirm **نعم، احفظ**.
6. The list now shows **التكلفة $100.00 · البيع $-10.00 · غير مصنف**.
7. Wait ~60s, or navigate away and back.

**Observed** — the product is silently back to **التكلفة $0.00 · البيع $0.00 · الفئة "—"**. The category change made in the *same* save is gone too. No error, no toast, no indication anything was undone. The stalled-sync counter incremented 46 → 47 at the moment of that save.

**Control test (proves normal edits do persist):** same product, الفئة = CUps, cost `5`, sell `9` → saved, and still $5.00/$9.00/CUps after 60s and after navigating away. So the rollback is specific to the invalid value.

**Root cause of the input gap** — the price fields are `<input type="number">` with **no `min` attribute**, so the browser happily accepts `-10`.

**Expected** — reject negative prices at the input; and never roll a save back without telling the user.

---

### WAFI-09 — Fully-returned sale still counts toward sales totals and is still labelled "مدفوع"
**Severity:** High · **Area:** Sales history, returns · **Reproducible:** 100%

**Steps**
1. POS: sell حافظة قهوة كبيره ×1 for $15.00, نقدي دولار, exact cash. Invoice **E-000013**.
2. `/history` → **إرجاع** on that row → tick the item → refund method **نقد $** → **تأكيد الإرجاع**.

**Observed** on `/history` (tab اليوم):
- The row gets a green badge **مرتجع بالكامل** ✅
- The **الحالة** column still reads **مدفوع** ❌ — directly contradicting the badge next to it
- The page total still reads **إجمالي: $15.00** ❌

**Expected** — net the refund out of the period total (day nets to $0.00) and set the status to مرتجع.

**Related — WAFI-09a (Medium):** `الرئيسية` → **أكثر المنتجات مبيعاً** still shows *حافظة قهوة كبيره — 1 مبيعة — $15* after the full refund. Should be 0 / $0.

*(Stock and cash were both handled correctly — see [§8](#8-what-works).)*

---

### WAFI-10 — Shift report's "حساب الصندوق" does not add up
**Severity:** High · **Area:** Shifts / cash reconciliation · **Reproducible:** 100%

**Steps** — `/shifts/history` → **إغلاق الوردية** on the جهاز E shift → count cash → **التالي – عرض تقرير الوردية**.

**Observed** — the USD column of حساب الصندوق reads:

```
رصيد الفتح          $0.00
+ نقد مبيعات        $358.24
- مصاريف نقدية      $327.00
──────────────────────────
متوقع              $24.24      ← the three lines above sum to $31.24
```

**A $7.00 gap.** It is not a maths bug — it is real money that *is* in the total but is *not* shown as a line item. The missing movements are a **+$8.00 customer debt collection** and a **−$15.00 sale refund** made during this shift: `358.24 + 8 − 15 − 327 = 24.24` ✓.

**Expected** — every cash movement that affects متوقع gets its own line (تحصيل ديون, مرتجعات نقدية, حركة نقدية, …). A cashier being asked to explain a variance must be able to derive the expected figure from the numbers on screen. Right now the panel is unauditable.

---

### WAFI-11 — Three shifts open simultaneously, with no guard
**Severity:** High · **Area:** Shifts · **Reproducible:** current state

**Steps** — go to `/shifts/history`.

**Observed** — the section headed **"وردية مفتوحة"** (singular) lists **three** shifts in state **مفتوحة** at once — جهاز **D**, جهاز **E**, جهاز **B** — all for cashier **Anas**, all badged **مفتوحة منذ فترة طويلة**, all فتح بـ $0.00.

**Expected** — at most one open shift per device, and a hard block (or an explicit, audited takeover) when one is already open.

**Impact** — it is undefined which shift a POS sale is attributed to, and cash reconciliation across three overlapping open shifts is meaningless. Note the dashboard's `النقد في الصندوق` said **$3** while the shift report for the same moment expected **$24.24** — two numbers under effectively the same label, computed over different scopes.

---

### WAFI-12 — Staff PIN hash *and salt* are stored in browser localStorage
**Severity:** High · **Area:** Security · **Reproducible:** 100%

**Steps** — DevTools → Application → Local Storage → key **`shift`**.

**Observed** — the `activeStaff` object contains, in clear:

```
"role":"owner", "pinHash":"7d526ce1fc7281cb442b181f11cb4e7482f05fa40da03513859fb8a66316ac6c",
"pinSalt":"399c82f9fbe20bb4e4f9…"
```

The PIN is **4 digits** (the entry UI shows 4 dots). With the hash and salt in hand, all 10,000 candidates can be enumerated offline in milliseconds against a fast hash like SHA-256.

**Impact** — this defeats the two controls the PIN exists to enforce:
- the manager-approval gate on over-limit discounts (`تخفيض يتجاوز الحد المسموح — يلزم رمز المالك أو المدير`)
- the staff-switch / sign-in gate

**Recommendation** — verify PINs server-side. If an offline-capable check is genuinely required, use a slow KDF (argon2id / scrypt / bcrypt) with a high work factor, add server-side attempt throttling, and never ship the owner's hash to a device a cashier can use. (A `wafi.pin_lockout` key exists, so client-side throttling is already in place — but client-side throttling is irrelevant once the hash has been copied out.)

---

### WAFI-13 — POS payment keypad re-lays out after the first digit, causing mis-taps
**Severity:** High · **Area:** POS · **Reproducible:** 100%

**Steps**
1. `/pos` → add any item → **دفع** → **نقدي دولار**.
2. Tap **5**, then — without moving your hand — tap where **0** was.

**Observed** — after the first digit, **مسح** and **إضافة دفعة أخرى** appear and the entire keypad shifts **up ~32px**, so the second tap lands on a different key (or between keys). My tap sequence 5 → 0 produced just `5`.

**Expected** — reserve the space for those controls so the keypad never moves once entry begins.

**Impact** — this is the highest-frequency interaction in the whole product, on a touch device, handling money.

---

## 6. Medium

### WAFI-14 — Product quick-create in Receiving bypasses product validation *(root cause of WAFI-15 and WAFI-16)*
**Steps** — `/suppliers` → **تسجيل استلام** → **أضف صنفاً** → **+ منتج جديد**.

**Observed** — the quick-create form collects only **الاسم · الباركود · سعر البيع · سعر التكلفة**. There is **no الفئة field**, and prices default to `0` and are not required. But the primary product form (`/products/add`, `/products/:id/edit`) marks **الفئة, سعر التكلفة and سعر البيع as required (\*)**.

So this path mints products the app's own main form considers invalid. This is almost certainly why **29 of 35** existing products have no category and $0.00 prices.

**Expected** — one validation contract for products, wherever they are created.

---

### WAFI-15 — Legacy products cannot be edited without filling fields their creator never saw
Consequence of WAFI-14. 29 of 35 products have no category and $0.00 prices, yet الفئة / سعر التكلفة / سعر البيع are required on the edit form. An owner who just wants to correct a stock count is forced to invent a category and prices first — and gets no visible error when they don't (WAFI-07a).

Also: the list renders a missing category as **"—"** while the form offers a real **"غير مصنف"** option. Two representations of the same state.

---

### WAFI-16 — POS sells unpriced products at $0.00 with no warning
**Steps** — `/pos` → tap **زيت طبخ 1.5 لتر** (tile shows **$0.00**).

**Observed** — added to the cart, total unchanged, no warning, and checkout is allowed. These are the same 28 products the products page explicitly flags as **بدون سعر دقيق** — the app knows they are unpriced and sells them anyway.

**Expected** — hide or disable unpriced items in POS, or prompt for a price at the point of sale.

**Impact** — silent revenue loss and unrecorded shrinkage: stock leaves, $0 revenue is booked.

---

### WAFI-17 — Two numeric keypads in the same flow use *opposite* digit order
| Dialog | Top row → bottom row |
|---|---|
| Manager PIN (`تخفيض يتجاوز الحد المسموح`) | `3 2 1` / `6 5 4` / `9 8 7` |
| Cash received (`المبلغ المستلم`) | `9 8 7` / `6 5 4` / `3 2 1` |

Same session, same operator, vertically inverted. Guaranteed mis-taps on a touch POS. (The sign-in PIN pad matches the manager-PIN order, so the cash keypad is the odd one out.)

---

### WAFI-18 — Underpayment silently disables تأكيد with no explanation
**Steps** — `/pos` → add حافظة قهوة كبيره ($15.00) → **دفع** → **نقدي دولار** → enter `10`.

**Observed** — **تأكيد** greys out. No message, no `المتبقي: $5.00`. The cashier cannot tell whether the button is broken or the amount is wrong.

**Expected** — show the shortfall (`المتبقي: $5.00`) and why the button is unavailable. Same family as WAFI-07.

---

### WAFI-19 — Category dropdown does not close after selecting, and blocks the fields beneath it
**Steps** — `/products/:id/edit` → click the **الفئة** dropdown → click any option.

**Observed** — the option is applied, but the panel **stays open**, overlaying سعر التكلفة and سعر البيع. The next click hits the panel instead of the field. Escape is required to dismiss it.

---

### WAFI-20 — Dialogs are translucent; page content bleeds through
Affects **حالة المزامنة**, the POS payment-method dialog, and the PIN dialog. Text and shapes from the page behind show through the panel background — clearly visible as grey ghost text between **إلغاء** and **رجوع إلى السلة** on the payment dialog. Reduces legibility, especially on the sync panel where the content is diagnostic text.

---

### WAFI-21 — No phone-number validation on customers
**Steps** — `/customers` → **إضافة زبون** → الاسم `QA Test Customer`, هاتف ثابت `1`, جوال `abc123` → **إضافة زبون**.

**Observed** — saved. The customer detail page shows **جوال: abc123**. Nothing checks digits, length, or the documented formats the placeholders advertise (`011XXXXXXX` / `09XXXXXXXX`).

**Knock-on risk** — **إرسال كشف الحساب عبر واتساب** stays enabled with a non-numeric mobile and will build a broken `wa.me` link. (I did not click it — that would send a message.)

---

### WAFI-22 — Open-shift card shows a bare time for a shift that is 19 days old
`/shifts/history` shows **"بدأت 08:47 ص"**, which reads as *this morning*. The shift report for the same shift says **المدة: 471س 57د** — about 19.6 days. Show the date whenever a shift spans more than one day.

---

### WAFI-23 — Closing a shift force-signs-out with no warning and no confirmation
**Steps** — `/shifts/history` → إغلاق الوردية → count cash → التالي → enter سبب الفرق → **إغلاق بدون طباعة**.

**Observed** — the app jumps straight to the **"من أنت؟"** staff picker and then demands a 4-digit PIN. There is no **تم إغلاق الوردية** confirmation and no warning beforehand that closing will sign you out.

**Impact** — on a live counter this strands the cashier mid-service. It also ended this test session (see [§9](#9-not-tested)).

---

### WAFI-24 — Receiving picker offers to create a product literally named "بدون اسم"
**Steps** — `/suppliers` → تسجيل استلام → أضف صنفاً → leave the search box **empty**.

**Observed** — the list still offers **"+ منتج جديد «بدون اسم»"**. It should be hidden or disabled until the user has typed a name to create.

---

### WAFI-25 — Secondary text fails WCAG AA contrast, app-wide
Measured on the live DOM against the app background `rgb(6,9,15)`:

| Colour | Size | Ratio | Verdict | Used for |
|---|---|---|---|---|
| `rgb(99,114,133)` | 13–14px | **4.06:1** | ✗ fails AA (needs 4.5) | `أدخل الرقم السري`, `رجوع`, most secondary labels |
| `rgb(61,79,107)` | 11px | **2.40:1** | ✗ fails badly | `يمكنك الكتابة من لوحة المفاتيح`, hints |
| `rgb(26,86,219)` | 40px/800 | **3.22:1** | ~ scrapes the 3:1 large-text bar | the وافي logotype |

The same muted greys carry every secondary label in the app (`المتبقي:`, `لا يوجد سعر`, table column headers, field hints). 11px is also below a sane minimum for a POS read at arm's length.

---

### WAFI-26 — No `aria-live` regions anywhere
`document.querySelectorAll('[aria-live]').length === 0`. Toasts (`تم إضافة الزبون`) and inline validation errors are never announced to a screen reader — which bites hardest exactly where the app already fails sighted users (WAFI-07).

---

### WAFI-27 — Products count ignores the active filter
`/products` header shows **"35 منتج"** even with the **مخزون منخفض** filter active and only 12 rows rendered. Also inconsistent: **بدون سعر دقيق** carries a count badge (28/29) while **الكل** and **مخزون منخفض** carry none.

---

### WAFI-28 — Cash-count row layout detaches the count from its denomination
In **عدّ الصندوق** the per-denomination quantity renders at the far left, *outside* the `(−)(+)` pair, with a wide dead gap in the middle of the row. The count reads as belonging to nothing.

---

### WAFI-29 — Inconsistent disabled-state convention on primary buttons
| Dialog | With required fields empty |
|---|---|
| Supplier (`مورّد جديد`) | **حفظ correctly disabled** ✅ |
| Expense (`إضافة مصروف`) | حفظ looks enabled, silently no-ops ❌ |
| Product edit | حفظ looks enabled, silently no-ops ❌ |
| Customer payment | تأكيد الدفعة looks enabled on over-payment, silently no-ops ❌ |
| Shift close | `طباعة وإغلاق` bright / `إغلاق بدون طباعة` dimmed — **same gate, two states** ❌ |

Pick one convention and apply it everywhere.

---

## 7. Low / polish

| ID | Finding |
|---|---|
| WAFI-30 | **Product search matches stock quantity**, which the placeholder doesn't advertise (`بحث بالاسم، الباركود، الفئة، السعر`). Repro: search `120` → returns مقص متعدد الاستخدام, whose only `120` is its stock (barcode `6221040100026`, price 0, no category). Searching `20` returns unrelated products. |
| WAFI-31 | **Arabic plural not handled.** Product edit page: `تم بيع هذا المنتج 3 مرة.` → should be `3 مرات`. |
| WAFI-32 | **Three different words for "customer"** on one screen: sidebar `العملاء`, page title `الزبائن`, buttons `إضافة زبون`, audit log `أضاف عميل`. |
| WAFI-33 | **Audit log misses customer payments.** The customer's `السجل` lists `أضاف عميل` and `تغيّر دين عميل` but not the $8.00 payment — that appears only in `سجل الدفعات`. Money-in belongs in the audit trail. |
| WAFI-34 | **Junk custom expense category `"s"`** is selectable (stored in `localStorage` → `wafi_custom_expense_cats`). Custom category names aren't validated for length or content. |
| WAFI-35 | **Suppliers toolbar is misaligned** vs every other list page — `مورّد جديد` + search sit centred with a large empty gap on the left, where `/products`, `/customers` and `/expenses` put the primary action flush at the RTL start. |
| WAFI-36 | **Products table header is not sticky** — scrolling the inner table region scrolls `صورة / الاسم / الفئة / التكلفة / البيع / المخزون` out of view. The page also has nested scrollbars (page + table body). |
| WAFI-37 | **Cart item names truncate very aggressively** — `حافظة قهوة كبيره` renders as `حافظة قه…` in a panel with plenty of free width. |
| WAFI-38 | **Cart badge counts lines, not units.** `الفاتورة 2` with 5 physical units in the basket. Ambiguous label. |
| WAFI-39 | **Quantity cap is silent.** The POS `+` button correctly stops at available stock but says nothing about why. |
| WAFI-40 | **Manual price override doesn't recalculate until blur.** Typing `5` over `15` leaves the line and totals showing the old figures until focus leaves the field. |
| WAFI-41 | **Credit-sale receipt omits the customer name.** The `تم البيع بنجاح` screen for an آجل sale shows only `طريقة الدفع: آجل` — not who owes the money. |
| WAFI-42 | **Slow cold start** — ~7–10s to interactive on `/products`, 10s+ on `/products/:id/edit`, on localhost with a warm cache. |
| WAFI-43 | **`إضافة زبون` needed several attempts to open** (intermittent). The first two clicks — empty-state CTA and header button — produced no dialog; DOM inspection showed it mounting and then unmounting. Opened normally on later attempts. Not reliably reproducible; worth a look at whether a sync re-render tick can swallow the open. |
| WAFI-44 | **`checkHealthAlerts: evaluate_health_alerts_foreground failed`** console warning (×2). A backend RPC is failing; likely related to WAFI-01. |

---

## 8. What works

Worth stating plainly, because it narrows where the risk actually is: **I could not find a single arithmetic error in the money maths.**

**Calculations — all verified correct**
- Cart line: 4 × $15.00 = $60.00; profit 4 × ($15.00 − $10.00) = $20.00.
- Manual price override 15 → 14: line $56.00, discount badge `$1.00 ▼`, profit $16.00.
- Margin indicator: cost 14 / sell 20 → **43%** ✓; cost 100 / sell 50 → **−50%** ✓.
- SYP conversion, consistently at 14,000/$: $15→210,000 · $20→280,000 · $56→784,000 · $60→840,000.
- Cash drawer across the whole session: `+$15 (cash sale) −$15 (refund) +$0 (credit sale) +$8 (debt collection) −$5 (cash expense) = $3` — dashboard showed exactly **$3**.
- Shift-report payment mix: `$358.24 USD cash + 3,479,000 SYP (=$248.50) + $0.00 card + $20.00 credit = $626.74` = إجمالي المبيعات, to the cent, across 14 invoices.
- Partial debt payment: $8.00 against a $20.00 invoice → balance $12.00, invoice `12.00$ من 20.00$`, `سجل الدفعات +$8.00`.
- Receiving: 5 × $13.00 = $65.00; product cost 12 → 13, stock 3 → 8; supplier `إجمالي المشتريات 65$`.

**Guards that behave correctly**
- Cart quantity is capped at available stock; the `+` button disables at qty = stock.
- Out-of-stock products are correctly disabled in POS (`نفد المخزون`).
- Return quantity is capped at the quantity originally sold.
- `تأكيد الإرجاع` stays disabled until both an item and a refund method are chosen.
- A price override below the allowed discount cap correctly demands an owner/manager PIN, and cancelling the PIN dialog correctly reverts the price.
- Shift-close variance policy is enforced **with a visible, in-context, Arabic error message** — `الفرق يتجاوز 5% – أدخل سبب الفرق قبل الإغلاق.` **This is the pattern the rest of the app should copy.**
- Route guard works: navigating directly to `/reports` while signed out lands on the staff picker.

**Flows that completed end-to-end**
- Cash sale → receipt (E-000013) → appears in `/history` with correct totals → stock 4 → 3.
- Full return → `مرتجع بالكامل`, stock restored 3 → 4, cash drawer $15 → $0.
- Credit sale → debt $20.00 recorded, cash drawer correctly *not* increased, home health signal correctly flipped to `1 زبون بفواتير آجل`, honest `بانتظار المزامنة` badge.
- Customer created with a working toast and an audit entry (`أضاف عميل`, with user and timestamp).
- Supplier created → receiving recorded → cost and stock updated → supplier totals updated.

**Nice touches worth keeping**
- The explicit, pre-ticked `تحديث سعر التكلفة؟ $12 ← $13` confirmation before overwriting a cost on receiving.
- The denomination-counting sheet with its `عدّ الفئات / إدخال المبلغ` toggle.
- The return dialog telling you no return reasons are configured and pointing at Settings.
- `بانتظار المزامنة` badges — the app is honest about local-only state in places.

**Accessibility basics that pass**
`<html lang="ar" dir="rtl">` correct · viewport meta with `viewport-fit=cover` · `theme-color` set · no `<img>` missing `alt` · no button without an accessible name · no input without a label · keyboard focus **is** visible (real Tab keypresses produce the UA focus ring) with sensible tab order · PIN keypad touch targets 67×52px, above the 44×44 minimum.

---

## 9. Not tested

Testing ended when **closing a shift signed the session out** (WAFI-23) and the app demanded Anas's 4-digit PIN, which I do not have and did not attempt to guess.

**Not covered:**
`/reports` · `/reports-list` · `/reports/:reportId` · `/reports/staff` · `/dashboard` (لوحة التحكم الجديدة) · `/settings` and its ~17 sub-pages (personal, receipt, staff, return-reasons, scanner, devices, audit-log, recovery-codes, exports, denominations, discount-caps, notifications, shop, rules) · `/stock-take` (+ history, review) · `/installments` · `/notifications` · `/back-office` · `/categories` · `/products/import` (Excel) · `/staff/:id/ledger` and settlement · `/team-health` · `/health` · `/admin/rollouts` · barcode scanner (camera) · print / WhatsApp send paths (deliberately not triggered — they send)

**Also not verified:** the responsive / mobile layout. Window resizing through the automation bridge did not take effect (viewport stayed 1080px). A mobile bottom-nav does exist in the DOM, so a mobile layout is implemented and needs its own pass.

Give me the PIN and I'll finish these and extend the report.

---

## 10. Suggested fix order

1. **WAFI-01** — the RLS policy. Nothing else matters until writes persist. Check whether the client's inserted `shop_id` matches the JWT claim the policy tests.
2. **WAFI-02** — add `id` to the `local_event_processed_ledger` insert (one line), then rebuild projections. This alone fixes the owner's home dashboard, the false low-margin alarm, and probably the reports I couldn't reach.
3. **WAFI-04 / WAFI-05** — settle on one timezone (the shop's) for form defaults, storage, every formatter and every period filter.
4. **WAFI-06** — find and gate whatever calls `location.reload()`.
5. **WAFI-07** — one shared "blocked submit" behaviour: scroll to + focus the first invalid field, and toast. Four dialogs, one pattern, already implemented correctly on the shift-close screen.
6. **WAFI-03** — drop the alias from the `DELETE`.
7. **WAFI-12** — move PIN verification server-side.
8. **WAFI-14** — one validation contract for products, which also retires WAFI-15 and WAFI-16.
9. **WAFI-13 / WAFI-17** — stabilise the POS keypad layout and unify the digit order.
10. Then WAFI-08, WAFI-09, WAFI-10, WAFI-11.

---

## 11. Test data left behind

Full write access was granted, so this data is still in the shop:

| Where | What |
|---|---|
| Products | `Tess cups` renamed → **`Tess cups QA1`** |
| Products | `coffe cups` — cost $12→**$13**, sell $15→**$16**, stock 3→**8** |
| Products | `مقص متعدد الاستخدام` — category → **CUps**, cost **$5.00**, sell **$9.00** (was 0/0/none) |
| Customers | **`QA Test Customer`** — phone `1`, mobile `abc123`, open balance **$12.00** |
| Sales | **E-000013** $15.00 — fully returned |
| Sales | **E-000014** $20.00 — آجل, $8.00 paid, $12.00 outstanding |
| Expenses | **$5.00 إيجار**, cash, dated 2026-08-22 |
| Suppliers | **`QA Supplier`** — one receiving, $65.00 |
| Shifts | جهاز **E** shift **closed**, variance reason: *"QA test - shift closed during QA testing, drawer not physically counted"* |

Say the word and I'll clean it up.
