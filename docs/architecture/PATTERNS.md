# PATTERNS.md — Pattern selection, integration, frontend, data

> Cited by CLAUDE.md. The **what shapes to reach for** companion to PRINCIPLES.md (how) and
> ENFORCEMENT.md (verify). Every pattern below is one already in the codebase — copy these,
> don't invent parallels.
> Last updated: 2026-06-23.

---

## 1. Folder structure (ADR-003)

```
src/
  features/<feature>/        # feature-first; one folder per domain capability
    index.ts                 # the ONLY public surface — import across features via this
    <Feature>Screen.vue      # screen-level components
    use<Feature>.ts          # the feature's business logic / orchestration composable
    <feature>.types.ts       # feature-local types (export public ones via index.ts)
    __tests__/ or *.test.ts  # co-located tests
  components/
    ui/                      # domain-agnostic, presentational (App*, Base*, Form*, ...)
    layout/                  # app shell / layout chrome
  composables/               # cross-cutting, used by 2+ features (use* prefix)
  store/                     # Pinia stores (*.store.ts), composition-API style
  data/
    powersync/               # db.ts (the db handle), schema.ts, connector.ts
    supabase/                # client.ts, devAuth.ts
    dexie/                   # offline draft storage
  i18n/                      # ar.ts (primary), en.ts (fallback), index.ts
  config/                    # featureFlags.ts, app config
  shared/                    # tiny cross-cutting helpers (e.g. text/)
  pages/ router/             # routed views + vue-router wiring
```

Current features: `audit, customers, dashboard, exchange-rate, expenses, exports, imports,
payment, pos, products, receipt, returns, sale-history, settings, shifts, staff, suppliers,
sync`. Adding a capability = a new folder here with its own `index.ts`, not files sprinkled
into existing features.

**The `@/` alias** maps to `src/` (vite.config.ts). Always import as `@/store/sale.store`,
never with deep relative `../../../` chains.

---

## 2. Feature module pattern

A feature exposes only what callers need through `index.ts`:

```ts
// src/features/pos/index.ts
export { useSale } from './useSale'
export { default as POSSaleScreen } from './POSSaleScreen.vue'
export { default as SaleConfirmationScreen } from './SaleConfirmationScreen.vue'
export type { Product } from './pos.types'
```

Everything else in the folder (`SalePanel.vue`, `ProductGrid.vue`, `loadCompletedSale.ts`) is
**private**. Another feature importing `pos/SalePanel.vue` directly is a boundary violation
(ENFORCEMENT.md §2).

---

## 3. Composable pattern (business logic)

A feature's logic lives in a `use<Feature>()` composable that wires stores + data, exposes a
small reactive API, and is unit-testable. Template for the shape (from `useSale`):

```ts
export function useSale(currentRateParam: MaybeRef<number | null>) {
  const saleStore = useSaleStore()

  const totalSyp = computed(() => { /* derived state */ })

  async function addLine(productId: string) {
    const currentRate = toValue(currentRateParam)
    if (currentRate === null) throw new ExchangeRateNotSetError()   // typed domain error
    const result = await db.execute(`SELECT ... WHERE id = ?`, [productId])  // bound params
    // guard edge cases (not found, out of stock, oversell) BEFORE mutating store
    saleStore.addLine({ /* ... */ })
  }

  return { /* refs, computeds, and actions only */ }
}
```

Conventions: accept dependencies as args where it aids testing (`MaybeRef` + `toValue` for
inputs that may be a ref or a plain value); return `computed`s for derived state; throw typed
errors for exceptional cases; keep DB access here, not in the component.

**Cross-cutting composables** (`src/composables/`) are the ones used by 2+ features:
`useBarcodeScan, useConnectionStatus, useInstallPrompt, useOnlineStatus, usePrinter,
usePwaLifecycle, useSaleDraft, useSaleNumber, useThemePalette`. If a composable is used by
only one feature, it belongs inside that feature.

---

## 4. Store pattern (Pinia, composition style)

Stores use the setup/composition form of `defineStore` (a function returning refs/computeds/
actions), not the options object:

```ts
export const useSaleStore = defineStore('sale', () => {
  const lines = ref<SaleLine[]>([])
  const totalUsd = computed(() => lines.value.reduce((s, l) => s + l.lineTotalUsd, 0))

  function addLine(line: SaleLine) { /* authoritative guards live here */ }
  function clear() { /* ... */ }

  return { lines, totalUsd, addLine, clear }
})
```

Rules:
- The store holds the **authoritative guard** for its invariant. `useSale.addLine` pre-checks
  stock for a nice message, but `saleStore.addLine` *clamps* so a race can never oversell.
  Pre-check for UX; enforce in the store.
- Export an `interface` for the store's row/line shapes (e.g. `SaleLine`).
- `persist: true` ONLY on settings/preferences/session stores (ADR-005). The transactional
  stores here (`sale.store.ts`) are **not** persisted; durable POS data goes to the DB, and
  in-progress drafts go to Dexie via `useSaleDraft`.
- Existing stores: `device.store.ts, sale.store.ts, session.store.ts, sync.store.ts`.

---

## 5. State ownership decision tree

CLAUDE.md routes state decisions here.

```
Is the state...
├─ purely local to one component (open/closed, hover, input focus)?
│     → component ref. Do NOT put it in a store.
├─ derived from other state?
│     → computed. Never store a value you can compute.
├─ shared across components within one feature, transient (lost on reload OK)?
│     → that feature's Pinia store (NOT persisted).
├─ a user preference / setting / session identity that must survive reload?
│     → a settings/session Pinia store WITH persist: true (ADR-005).
├─ an in-progress transaction that must survive an app kill (e.g. a half-rung sale)?
│     → Dexie draft (useSaleDraft), NOT localStorage, NOT a persisted store.
└─ durable business data (products, sales, customers, payments)?
      → the database via db.execute() (PowerSync local SQLite). Stores cache/orchestrate
        it; the DB is the source of truth.
```

---

## 6. Data & integration patterns

### Database access (ADR-004)
- `db` from `@/data/powersync/db` is the single handle. `db.execute(sql, params)` is the
  primitive; `db.getOptional<T>(sql, params)` for a single optional row.
- **Always parameterize.** Scope tenant tables by `shop_id`, device-scoped data by `device_id`.
- Result rows come back as `(result as any).rows._array` — type the array element, keep the
  `as any` at the call site only (PRINCIPLES.md §0).
- Reads may run before first sync — wrap in try/catch and degrade (don't crash the POS).

### Sync & tenancy
- PowerSync streams sync the local SQLite to Supabase Postgres. Sync status is **shown but
  never blocks** operations.
- **Tenant isolation** is enforced at the DB by RLS via `public.auth_shop_id()` — the
  `shops.owner_user_id → auth.uid()` mapping — and mirrored by the PowerSync sync rules. There
  is **no JWT claim / access-token hook** (migration 014 is retired). Client code reads its
  shop from the synced `shops` row; it does not assert tenancy itself, but every query should
  still scope by `shop_id` for correctness and index use. See `015_rls_tenant_scoping.sql`.

### Supabase
- `src/data/supabase/client.ts` is the only Supabase client. Used for auth and storage, not for
  POS-critical reads (those go through PowerSync/local SQLite).

### Migrations
- Sequential, numbered SQL in `supabase/migrations/NNN_slug.sql`. Each is **idempotent**
  (`drop ... if exists`, `create or replace`) so it is re-runnable.
- Every synced table gets RLS and is added to the PowerSync publication.
- `audit_log` is **append-only** (migration 018) — no updates/deletes.
- Add the table to the publication migration when introducing a new synced table, or it won't
  sync.

---

## 7. Hardware abstraction pattern (one driver per model)

CLAUDE.md week-1 rule: *every printer/scanner/drawer model is one driver file; no direct
hardware calls in POS code.* The shape (from `usePrinter.ts`):

```ts
export interface IPrinterDriver { print(receipt: ReceiptData): Promise<void> }

export class SimulatedDriver implements IPrinterDriver { /* logs; used in dev/tests/demo */ }
// EpsonTmT20Driver, StarTsp143Driver, Generic80mmDriver each implement IPrinterDriver

export function usePrinter(driver: IPrinterDriver = new SimulatedDriver()) { /* ... */ }
```

- POS code depends on the **interface**, never a concrete device. Adding the 11th printer model
  is a new class, untouched POS code (Open/Closed + Dependency Inversion).
- The composable owns the `printing`/`error` state and the try/finally; the driver owns only
  the bytes-to-device translation.
- Same shape applies to scanners (`useBarcodeScan`) and the cash drawer when added.

---

## 8. Frontend patterns

- **Library:** PrimeVue v4 (Aura preset) is the component library; Vuetify was removed. Tailwind
  v4 for layout/utility. `primeicons` for icons.
- **RTL + Arabic first.** The app is `dir="rtl"`, `lang="ar"`. Design new screens to the
  current design system (brand blue `#1A56DB`, glass cards, dual light/dark). No internal
  per-page navbars — navigation is app-level.
- **Reusable UI lives in `src/components/ui/`** — `AppDialog`, `BaseModal`, `FormField`,
  `EmptyState`, `NumericKeypad`, `ConnectionPill`, `SyncBadge`, etc. Reach for these before
  building a new one (DRY). They are domain-agnostic and presentational.
- **Strings via i18n only.** `useI18n()` + keys in `ar.ts`/`en.ts`. Currency/number/date
  formatting goes through vue-i18n's formatters, not hand-rolled string building.
- **Phone-first POS, desktop-led Back Office, phone-only read-only Owner Dashboard** (CLAUDE.md
  product disciplines). Match the surface you're building to its device target.
- **Charts:** ApexCharts via `vue3-apexcharts`.

---

## 9. Error & messaging pattern

- Throw a **typed error class** with a stable English `message` (asserted by tests):
  `class ExchangeRateNotSetError extends Error`.
- The **UI layer** catches the typed error and renders a localized Arabic string (via i18n or,
  for quick inline cases, an Arabic literal in the composable — but prefer i18n keys for new
  code). Never surface a raw English error to a shop owner.
- Show sync/connection state through the shared UI (`ConnectionPill`, `SyncBadge`) — informative,
  never blocking.

---

## 10. When no pattern fits

If a task doesn't map to a pattern above:
1. Re-check — most POS/inventory/reporting work *does* fit one of these.
2. If it's genuinely new (a new integration class, a new persistence concern), it's an
   architecture decision → write an ADR (PRINCIPLES.md §5) before building.
3. Prefer composing existing patterns over inventing a new one.
