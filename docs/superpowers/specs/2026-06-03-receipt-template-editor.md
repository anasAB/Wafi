# Epic 6 — Receipt Template Editor

> **Status:** Approved for implementation
> **Date:** 2026-06-03
> **Approach:** Settings section + inline live preview, PowerSync storage

---

## Goal

Allow shop owners to configure their receipt template — shop name, tax number, header text, and footer text — and see a live preview. On print, the configured values flow through to `ReceiptData` so every printed receipt reflects the shop's identity.

---

## Out of Scope (this epic)

- **Logo** — image upload/storage deferred to v1.5
- **ESC/POS thermal formatting** — `usePrinter` currently uses `SimulatedDriver`; actual escape-code generation is a separate epic
- **WhatsApp receipt** — deferred to v1
- **Per-sale customization** — template is always shop-level default

---

## Schema

### New table: `receipt_settings`

One row per shop. Upserted on save — no versioning needed.

```ts
const receipt_settings = new Table({
  shop_id:     column.text,
  shop_name:   column.text,
  tax_number:  column.text,
  header_text: column.text,
  footer_text: column.text,
  updated_at:  column.text,
  sync_status: column.text,
})
```

### Modified: `ReceiptData` in `src/composables/usePrinter.ts`

Add three optional fields:

```ts
export interface ReceiptData {
  // ... existing fields unchanged ...
  taxNumber?:   string
  headerText?:  string
  footerText?:  string
}
```

`shopName` already exists in `ReceiptData` — it gets its value from `receipt_settings.shop_name` instead of `device.shopId`.

---

## Feature Structure

```
src/features/receipt/
  receipt.types.ts
  composables/
    useReceiptSettings.ts
```

The UI lives in the existing Settings pages — no new pages or routes needed.

---

## Types

`src/features/receipt/receipt.types.ts`:

```ts
export interface ReceiptSettings {
  shopName:   string
  taxNumber:  string
  headerText: string
  footerText: string
}

export interface ReceiptSettingsRow {
  shop_id:     string
  shop_name:   string
  tax_number:  string
  header_text: string
  footer_text: string
  updated_at:  string
  sync_status: string
}
```

---

## Composable

`src/features/receipt/composables/useReceiptSettings.ts`:

```ts
export function useReceiptSettings() {
  const settings = ref<ReceiptSettings>({
    shopName: '', taxNumber: '', headerText: '', footerText: '',
  })

  async function load(): Promise<void>
  // SELECT * FROM receipt_settings WHERE shop_id = ? LIMIT 1
  // Maps row to settings ref; leaves defaults if no row exists

  async function save(data: ReceiptSettings): Promise<void>
  // INSERT OR REPLACE INTO receipt_settings (id, shop_id, shop_name, tax_number,
  //   header_text, footer_text, updated_at, sync_status)
  // VALUES (shop_id as PK, ?, ?, ?, ?, ?, now, 'pending')
  // Note: uses shop_id as the id (one row per shop, natural key)

  return { settings, load, save }
}
```

---

## Settings UI

### Where it lives

- **Mobile**: New section in `src/pages/SettingsPage.vue` — "معلومات الفاتورة" section added below the existing preferences list, above the session section
- **Desktop**: New group in `src/features/settings/screens/PersonalPreferencesScreen.vue` — same section added

### Form fields

| Field | Arabic label | Placeholder | Required |
|---|---|---|---|
| `shopName` | اسم المحل | محل الإلكترونيات الحديث | No |
| `taxNumber` | الرقم الضريبي | 12345678 | No |
| `headerText` | نص الرأس | Electronics & Accessories | No |
| `footerText` | نص الذيل | شكراً لزيارتكم — نراكم قريباً | No |

All fields are optional. Empty fields are omitted from the receipt.

A single "حفظ" button saves all four fields at once. Toast confirms on success.

### Live preview

Below the form, a receipt preview card renders immediately when any field changes. It uses dummy sale data (one line item, fixed total) so the layout is always visible regardless of whether a sale has been made.

```
┌──────────────────────────┐
│    [shopName]            │  ← bold, centered
│    [headerText]          │  ← smaller, centered, if set
│  الرقم الضريبي: [taxNo]  │  ← if set
│ ─────────────────────── │
│  Samsung A55    ×1  $220 │  ← dummy line
│ ─────────────────────── │
│  المجموع:        $220.00 │
│  بالليرة:   3,190,000 ل.س│
│ ─────────────────────── │
│    [footerText]          │  ← centered, if set
└──────────────────────────┘
```

The preview is read-only, rendered as HTML (not a canvas). Font: Tajawal, monospace-ish layout using flex rows.

---

## Integration: SaleConfirmationScreen

`src/features/pos/SaleConfirmationScreen.vue` — modify `handlePrint()`:

```ts
async function handlePrint() {
  if (!sale) return
  const { settings, load } = useReceiptSettings()
  await load()

  const receipt: ReceiptData = {
    saleId:                 sale.saleId,
    displaySaleNumber:      sale.displaySaleNumber,
    shopName:               settings.value.shopName || device.shopId,
    createdAt:              sale.createdAt,
    lines:                  sale.lines,
    totalUsd:               sale.totalUsd,
    totalSyp:               sale.totalSyp,
    exchangeRate:           sale.exchangeRateAtSale,
    paymentMethod:          sale.paymentMethod,
    amountReceived:         sale.amountReceived,
    amountReceivedCurrency: sale.amountReceivedCurrency,
    changeDue:              sale.changeDue,
    taxNumber:              settings.value.taxNumber   || undefined,
    headerText:             settings.value.headerText  || undefined,
    footerText:             settings.value.footerText  || undefined,
  }
  // ... print as before
}
```

---

## Tests

- `useReceiptSettings.test.ts` — load maps row to settings, load returns defaults when no row, save calls INSERT OR REPLACE with correct columns
- `ReceiptTemplatePreview.test.ts` — renders shopName, renders taxNumber when set, omits taxNumber when empty, renders footerText, dummy line item always visible

---

## New component

`src/features/receipt/components/ReceiptTemplatePreview.vue`

Props: `settings: ReceiptSettings`. Pure display component — no composable calls. Receives settings as props from the parent (Settings page), so it's testable in isolation and renders instantly without async loading.

Key `data-testid` attributes:
- `data-testid="preview-shop-name"` — shop name element
- `data-testid="preview-tax-number"` — tax number line (conditionally rendered)
- `data-testid="preview-header-text"` — header text line (conditionally rendered)
- `data-testid="preview-footer-text"` — footer text line (conditionally rendered)
- `data-testid="preview-dummy-line"` — the dummy sale line always present
