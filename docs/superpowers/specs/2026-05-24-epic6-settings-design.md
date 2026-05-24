# Epic 6 — Settings and Account Control: Implementation Design

| Field | Value |
|---|---|
| Date | 2026-05-24 |
| Epic | EPIC-06 |
| Status | Approved — ready for implementation plan |
| Author | CTO / Claude Code |
| Depends on | Epic 1 (exchange rate, device codes), Epic 2 (low-stock threshold), Epic 3 (business day start), Epic 5 stubs (canUserDo, audit log) |

---

## 1. Scope

17 user stories across 11 screens. A single, predictable place where the owner controls the shop and every user controls their own experience. Three outcomes:

1. Brother self-configures his shop in one session (<15 min) without calling us.
2. Any shop owner in any city can install and configure without our help (self-serve onboarding commitment).
3. Cashiers can change their personal language/theme on a shared tablet without affecting the owner's preferences.

**Out of scope (confirmed):** receipt template designer with arbitrary layout (v1.5), OAuth/SSO (v1.5), OS-level push notifications (v1.5), cross-device personal preference sync (v1.5), subscription payment processing (human-touch in v1).

---

## 2. Folder Structure & Module Boundaries

```
src/
  features/
    settings/
      index.ts                          ← CD-10 public API only
      settings.types.ts                 ← shared types + Epic 5 stubs
      SettingsRoot.vue                  ← navigation shell, single entry point at /settings
      personal/
        usePersonalPrefsStore.ts        ← Pinia, Dexie-backed
        PersonalPrefsScreen.vue
        NotificationPrefsScreen.vue
      shop/
        useShopSettingsStore.ts         ← Pinia, PowerSync-backed
        ShopProfileEditor.vue
        LogoManager.vue
      receipt/
        useReceiptTemplateStore.ts      ← Pinia, PowerSync-backed
        ReceiptTemplateEditor.vue
      exchange-rate-history/
        useExchangeRateHistory.ts       ← composable, PowerSync-backed
        ExchangeRateHistoryScreen.vue
      hardware/
        useHardware.ts                  ← composable
        HardwareScreen.vue
      devices/
        useDevices.ts                   ← composable
        DevicesScreen.vue
      billing/
        BillingScreen.vue               ← static + WhatsApp deep links, no composable needed
      data/
        useDataSync.ts                  ← composable
        DataSyncScreen.vue
      about/
        AboutScreen.vue                 ← static + clipboard, no composable needed
```

**Boundary rules (non-negotiable):**
- Nothing outside `src/features/settings/` imports from sub-module paths. Only `index.ts` is public.
- `SettingsRoot.vue` is the only registered route component. Sub-screens are rendered inside it via internal navigation state (not separate routes), except for the receipt template editor which gets its own full-screen route (`/settings/receipt`) due to the two-column desktop layout.
- The gear icon in `AppHeader.vue` navigates to `/settings`. No other entry point exists.

---

## 3. Data Layer

### Storage backend split (CD-1)

| Data | Backend | Sync |
|---|---|---|
| Personal preferences (language, theme, text size, notifications, biometric) | Dexie | Never — per-device-per-user by design |
| Shop settings, receipt template, logos, hardware, devices, exchange rate history | PowerSync → Postgres | All shop devices |

### Dexie — version 2

`src/data/dexie/draft.db.ts` bumped to version 2. New table:

```ts
// version 2
user_preferences: '[employee_id+device_id], device_id, employee_id, updated_at'
```

Fields: `employee_id` (string), `device_id` (string), `language` ('ar' | 'en', default 'ar'), `theme` ('light' | 'dark' | 'auto', default 'auto'), `text_size` ('small' | 'default' | 'large' | 'xlarge', default 'default'), `biometric_unlock_enabled` (boolean, default false), `notification_low_stock` (boolean, default true), `notification_sync_failure` (boolean, default true), `notification_shift_variance` (boolean, default true), `notification_pin_lockout` (boolean, default true), `notification_digest_reminder` (boolean, default false), `updated_at` (number — Unix ms).

### PowerSync — 6 new tables

Added to `src/data/powersync/schema.ts`:

```ts
const shop_settings = new Table({
  shop_id:                      column.text,
  name_ar:                      column.text,   // required, max 200
  name_en:                      column.text,
  address:                      column.text,
  phone:                        column.text,
  tax_number:                   column.text,   // max 50, any format (CD-7)
  active_logo_id:               column.text,   // FK to shop_logos.id, nullable
  business_day_start_hour:      column.integer, // 0-23, default 6
  business_day_start_minute:    column.integer, // 0-59, default 0
  default_low_stock_threshold:  column.integer, // >= 0, default 5
  default_currency_display:     column.text,   // 'usd_only' | 'syp_only' | 'both'
  default_printer_id:           column.text,   // FK to hardware_printers.id, nullable
  scanner_mode:                 column.text,   // 'usb' | 'camera' | 'both'
  cash_drawer_auto_open:        column.integer, // boolean 0/1
  sync_status:                  column.text,
})

const shop_logos = new Table({
  shop_id:     column.text,
  color_url:   column.text,  // compressed <500KB
  bw_url:      column.text,  // auto-generated B&W for thermal print (CD-6)
  uploaded_at: column.text,  // ISO timestamp — FIFO eviction key
  uploaded_by: column.text,  // employee_id
  sync_status: column.text,
})

const receipt_template = new Table({
  shop_id:                       column.text,
  receipt_language:              column.text,   // 'ar' | 'en', default 'ar'
  header_text:                   column.text,   // max 200
  footer_text:                   column.text,   // default 'شكراً لزيارتكم', max 200
  show_logo:                     column.integer,
  show_tax_number:               column.integer,
  show_sale_number:              column.integer,
  show_cashier_name:             column.integer,
  show_customer_name_on_credit:  column.integer,
  show_syp_totals:               column.integer,
  show_exchange_rate_line:       column.integer,
  show_shop_address:             column.integer,
  show_shop_phone:               column.integer,
  sync_status:                   column.text,
})

const hardware_printers = new Table({
  shop_id:           column.text,
  device_id:         column.text,  // printer registered per device (USB-attached)
  friendly_name:     column.text,
  model:             column.text,  // 'epson_tm_t20' | 'star_tsp143' | 'generic_escpos_80mm' | 'other'
  connection_status: column.text,  // 'connected' | 'disconnected'
  is_default:        column.integer,
  last_connected_at: column.text,
})

const exchange_rate_history = new Table({
  shop_id:               column.text,
  rate:                  column.real,
  old_value:             column.real,
  new_value:             column.real,
  changed_by:            column.text,  // employee_id
  changed_at:            column.text,  // ISO timestamp
  change_type:           column.text,  // 'manual_edit' | 'rollback' | 'initial'
  rollback_of_change_id: column.text,  // nullable — set when change_type = 'rollback'
  source_device_id:      column.text,
})

const devices = new Table({
  shop_id:                       column.text,
  device_code:                   column.text,  // 'A', 'B', 'T-a1f3' per Epic 1 CD-1
  friendly_name:                 column.text,
  user_agent:                    column.text,
  first_signed_in_at:            column.text,
  last_signed_in_at:             column.text,
  last_synced_at:                column.text,
  remote_signout_requested_at:   column.text,  // nullable
  remote_signout_completed_at:   column.text,  // nullable
})
```

The existing `exchange_rates` table (Epic 1) stays unchanged as the "current rate" table. `exchange_rate_history` is the append-only audit trail. `useExchangeRate.ts` is extended to write one `exchange_rate_history` row on every rate save — no breaking change to its public API.

One Supabase SQL migration file: `supabase/migrations/20260524_epic6_settings.sql` creates all 6 tables in Postgres with matching columns, RLS policies scoped to `shop_id`, and indexes on `shop_id` for all tables.

---

## 4. State Management

### Pinia stores (cross-component, persist across navigation)

**`usePersonalPrefsStore`** — reads/writes Dexie `user_preferences` for the current `(employee_id, device_id)`. Keyed to "device_default" employee UUID before sign-in. Exposes `resolvedTheme` computed (auto → reads `window.matchMedia`).

**`useShopSettingsStore`** — reads PowerSync `shop_settings` row for current `shop_id`. Reactive: PowerSync notifies on any remote change, store updates within 2 seconds (CD-10 propagation window met without polling).

**`useReceiptTemplateStore`** — reads PowerSync `receipt_template` for current `shop_id`. Same reactive update pattern.

### Composables (single screen, not shared)

`useExchangeRateHistory`, `useHardware`, `useDevices`, `useDataSync` — scoped to their screen component, instantiated on mount, torn down on unmount.

### Local component state

Form dirty flags, validation errors, modal open/close, upload progress, export progress. Never promoted to store.

### App.vue wiring

```ts
// Three watchers on usePersonalPrefsStore — applied to document root
watch(prefs.language, lang => {
  document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.lang = lang
})
watch(prefs.resolvedTheme, theme => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
})
watch(prefs.textSize, size => {
  document.documentElement.dataset.textSize = size
})
```

`{ immediate: true }` on all three so correct values apply on cold boot before first render.

---

## 5. CD-10 Public API (`index.ts`)

The only surface other features may import from `@/features/settings`:

```ts
export function getReceiptTemplate(): ReceiptTemplate
// Returns current template from useReceiptTemplateStore.
// Safe default if store not yet loaded: all show_* = true, footer = 'شكراً لزيارتكم', language = 'ar'.

export function getBusinessDayStart(): { hour: number; minute: number }
// Returns from useShopSettingsStore. Safe default: { hour: 6, minute: 0 }.

export function getDefaultLowStockThreshold(): number
// Returns from useShopSettingsStore. Safe default: 5.

export { usePersonalPrefsStore }   // App.vue needs language/theme/textSize
export { useShopSettingsStore }    // AppHeader needs shop name; print job needs name + tax number
```

All getters are synchronous — they read already-loaded Pinia stores. Callers never await. Safe defaults prevent crashes during cold boot before the first PowerSync sync completes.

---

## 6. Epic 5 Stubs

Both stubs live in `src/features/settings/settings.types.ts` and are imported inside composables only (not in components). When Epic 5 ships, only the two composables (`useShopSettingsStore`, `useReceiptTemplateStore`) need updating — not every screen.

```ts
// TODO(epic5): replace with real canUserDo() from Staff Pack
export function canUserDo(_action: string): boolean {
  return true  // owner-only until Epic 5 ships
}

// TODO(epic5): replace with real audit log writer
export function writeAuditLog(_entry: AuditEntry): void {
  // no-op — entries will be written when Epic 5 audit log ships
}

export interface AuditEntry {
  action:    string
  entity:    string
  entity_id: string
  before?:   unknown
  after?:    unknown
}
```

CD-4 (role-gated section visibility) is also stubbed: `SettingsRoot.vue` shows all sections for now. A single `v-if="canUserDo('view:section')"` per section is added as a comment placeholder, enabled when Epic 5 ships.

---

## 7. CD-12 Save-Confirmation Guard

Applies to exactly three fields: `tax_number`, `name_ar` (shop), and the entire `receipt_template` object. Implemented as a shared `useConfirmBeforeSave` composable inside the `settings/` feature:

```ts
// settings/useConfirmBeforeSave.ts
export function useConfirmBeforeSave(sensitiveFields: string[]) {
  // Returns: { confirmIfSensitive(fieldName, newValue, onConfirm) }
  // Shows AppDialog before committing; calls onConfirm() if user confirms
  // "تعديل" in dialog returns focus to the field without committing
}
```

Used by `ShopProfileEditor.vue` and `ReceiptTemplateEditor.vue`. Not used by any other field.

---

## 8. Implementation Sequencing (4 Waves)

### Wave 0 — Foundation (no visible UI)
1. Dexie v2 migration
2. 6 PowerSync tables + Supabase SQL migration
3. `usePersonalPrefsStore`, `useShopSettingsStore`, `useReceiptTemplateStore` (Pinia) with safe defaults
4. `index.ts` CD-10 getters wired to live stores
5. Epic 5 stubs in `settings.types.ts`
6. `SettingsRoot.vue` navigation shell + `/settings` route
7. Gear icon in `AppHeader.vue`

### Wave 1 — Brother's self-configure path (DoD milestone)
- Story 6.1: Language switch (`PersonalPrefsScreen.vue`, Dexie write, App.vue RTL wiring)
- Story 6.2: Theme (`PersonalPrefsScreen.vue`, App.vue dark class wiring)
- Story 6.3: Text size (`PersonalPrefsScreen.vue`, CSS `[data-text-size]` scale tokens)
- Story 6.4: Shop profile editor (`ShopProfileEditor.vue` + `LogoManager.vue`, CD-12 guard on name_ar + tax_number, FIFO logo eviction)
- Story 6.5: Receipt template editor (`ReceiptTemplateEditor.vue`, live 80mm preview, CD-12 guard on full template, test print button)
- Story 6.6: Business day start (field row inside `ShopProfileEditor.vue`, time picker)

### Wave 2 — Operations
- Story 6.8: Hardware (`HardwareScreen.vue`, printer list, test print, scanner mode toggle, cash drawer toggle)
- Story 6.7: Exchange rate history + rollback (`ExchangeRateHistoryScreen.vue`, `useExchangeRateHistory.ts`, extend `useExchangeRate.ts` to write history row)
- Story 6.15: Sign out (bottom of `PersonalPrefsScreen.vue`, open-shift warning)
- Story 6.16: About + diagnostics (`AboutScreen.vue`, clipboard JSON, update banner)

### Wave 3 — Advanced
- Story 6.10: Plan & billing (`BillingScreen.vue`, read-only + WhatsApp deep links, payment-method microcopy)
- Story 6.11: Manual sync + status (`DataSyncScreen.vue` top section)
- Story 6.14: Notification preferences (`NotificationPrefsScreen.vue`, in-app only per CD-11)
- Story 6.9: Devices + remote sign-out (`DevicesScreen.vue`, `useDevices.ts`, open-shift checkbox per CD-8)
- Story 6.12: Data export (`DataSyncScreen.vue` export section, CD-9 streaming write, progress dialog)
- Story 6.13: Clear local cache (`DataSyncScreen.vue` advanced section, two-step confirmation, shop name re-entry)

### Story 6.17 (offline) — cross-cutting
Not a separate wave. Every composable follows: write to local PowerSync SQLite first → queue for server sync → update reactive store → UI reflects change immediately. Verified in every story's acceptance criteria, not shipped as a separate story.

---

## 9. Key Design Constraints (from epic cross-cutting decisions)

| Decision | Rule |
|---|---|
| CD-1 | Personal prefs: Dexie, never synced. Shop settings: PowerSync, always synced. Never mix. |
| CD-2 | Language toggle is immediate, no restart. Receipt language is independent of app language. |
| CD-3 | Three theme options: Light / Dark / Auto. Auto reads `prefers-color-scheme`. Print always black-on-white regardless of theme. |
| CD-4 | Settings access via gear icon only. PIN screen and Close Shift screen hide the gear icon. Cashier sees Personal + About only. Manager sees Personal + read-only shop profile + exchange rate history + limited data sync + About. |
| CD-5 | Every shop-settings change writes an audit log entry (no-op stub until Epic 5). Personal prefs never audited. |
| CD-6 | Logo history capped at 3 (FIFO eviction). No time-based deletion. Removing active logo keeps it in history. |
| CD-7 | Tax number: any string, max 50 chars, no format validation. |
| CD-8 | Remote sign-out dialog shows open-shift checkbox (unchecked default). Force-close sets closing_cash = expected_cash and note "إغلاق عن بُعد — لم يتم عد النقد". |
| CD-9 | Export: estimate before starting, entity-by-entity progress, Cancel always available, streaming write via File System API with in-memory fallback + 100MB warning. |
| CD-10 | Other epics read settings via `getReceiptTemplate()`, `getBusinessDayStart()`, `getDefaultLowStockThreshold()` from `index.ts` only. Never import sub-module internals. |
| CD-11 | Notification prefs screen controls in-app indicators only. No browser permission prompt anywhere in v1. |
| CD-12 | Save-confirmation guard on tax_number, name_ar, receipt_template only. Last-write-wins for all other fields. Conflict-surfacing toast on losing device for these three fields. |

---

## 10. Architecture Compliance

| PRINCIPLES.md rule | How this design satisfies it |
|---|---|
| SRP | Each sub-module composable has one reason to change (personal prefs, shop settings, receipt template, hardware, devices, data). |
| OCP | New settings sections added as new sub-modules without editing existing ones. |
| DIP | Composables depend on `db` (PowerSync) and `draftDb` (Dexie) interfaces, not concrete implementations. Epic 5 stubs are injected via the shared types file. |
| ISP | CD-10 public API exposes only 5 exports. Consumers import only what they need. |
| SoC | Stores handle data loading. Composables handle business logic. Components handle rendering only. |

| PATTERNS.md rule | How this design satisfies it |
|---|---|
| Feature-first folders | `settings/` is one feature with internal domain sub-modules. No cross-feature internal imports. |
| State ownership decision tree | Server data → Pinia stores (backed by PowerSync). Local-only data → Pinia store (backed by Dexie). Component-scoped state → local refs. |
| Design token hierarchy | Theme switches via `dark` class on `<html>`. Text size via `data-text-size` attribute. CSS targets semantic tokens only. |

| ENFORCEMENT.md rule | How this design satisfies it |
|---|---|
| No cross-feature internal imports | Enforced by `index.ts` being the only public surface. |
| State type matches owner | PowerSync data → Pinia. Local-only data → Pinia (Dexie-backed). Form state → local ref. |
| Secrets never in source | No credentials. Logo blob URLs are local. |
| ADR for new libraries | No new libraries introduced. File System API is a browser built-in. |

---

## 11. Definition of Done (from epic spec)

Key items that gate completion:

- [ ] Brother completes self-serve shop setup in <15 min without help
- [ ] Language/theme change takes effect on every screen within 1 second, no restart
- [ ] Dark theme passes WCAG AA contrast on cheap Android tablets
- [ ] Receipt template propagates to next printed receipt within 2 seconds (CD-10)
- [ ] CD-12 guard fires for tax_number, name_ar, receipt_template — and only those three
- [ ] Remote sign-out applies within 60 seconds (online device) or on next connection (offline)
- [ ] Data export: pre-export estimate accurate ±50%, granular progress, Cancel works at any point, ZIP opens in Excel with Arabic intact
- [ ] No browser permission prompt triggered anywhere in notification preferences (CD-11)
- [ ] Every shop-settings change creates audit log entry; personal prefs do not
- [ ] Cashier sees only Personal + About; Manager sees read-only sections per CD-4
- [ ] All settings render and function offline; pending changes show "في الانتظار للمزامنة"
- [ ] Settings root opens in <500ms on cheap Android phone
