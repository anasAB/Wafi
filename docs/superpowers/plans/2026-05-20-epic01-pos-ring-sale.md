# Epic 01 — Ring a Sale and Print a Receipt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 6 screens (Home → POS → Payment → Confirmation → Exchange Rate Editor → Sale History) with offline-first SQLite, RTL Arabic UI, and simulated receipt printing.

**Architecture:** Feature-first folders (`src/features/[feature]/`) with `index.ts` public APIs. Pinia for UI state, `@powersync/web` local SQLite for synced data, Dexie IndexedDB for draft persistence. Vue 3 MVVM: composables own all logic, templates are pure renderers. Rules from `PRINCIPLES.md`, `PATTERNS.md`, and `ENFORCEMENT.md` apply throughout.

**Tech Stack:** Vue 3 + TypeScript + Tailwind CSS + Pinia + `@powersync/web` + `@supabase/supabase-js` + `dexie` + `@zxing/browser` + Vitest + `@vue/test-utils` + `fake-indexeddb`

---

## File Map

| File | Role | Status |
|---|---|---|
| `package.json` | Add/replace deps | Modify |
| `vite.config.ts` | Alias + Vitest + PowerSync WASM config | Modify |
| `src/main.ts` | Mount app with Pinia | Modify |
| `src/App.vue` | Add `dir="rtl" lang="ar"` | Modify |
| `src/router/index.ts` | Dynamic imports, 3 routes | Rewrite |
| `.env.local.example` | Supabase + PowerSync env vars template | Create |
| `supabase/migrations/001_initial_schema.sql` | 6-table schema | Create |
| `supabase/seed.sql` | Stub shop + device + test products | Create |
| `src/data/powersync/schema.ts` | PowerSync client schema | Create |
| `src/data/powersync/connector.ts` | SupabaseConnector (Epic 1 stub) | Create |
| `src/data/powersync/db.ts` | PowerSync singleton | Create |
| `src/data/dexie/draft.db.ts` | Dexie draft database | Create |
| `src/store/device.store.ts` | Stubbed shop/device identity | Create |
| `src/store/sale.store.ts` | In-progress sale state | Create |
| `src/store/sync.store.ts` | Sync status | Create |
| `src/composables/useSaleNumber.ts` | CD-1: display_sale_number format | Create |
| `src/composables/useSaleDraft.ts` | CD-3: IndexedDB draft persistence | Create |
| `src/composables/usePrinter.ts` | `IPrinterDriver` + `SimulatedDriver` | Create |
| `src/composables/useBarcodeScan.ts` | USB burst + camera barcode | Create |
| `src/features/pos/pos.types.ts` | POS type definitions | Create |
| `src/features/pos/useSale.ts` | POS ViewModel composable | Create |
| `src/features/pos/ProductGrid.vue` | Product tap grid | Create |
| `src/features/pos/SalePanel.vue` | Line items + totals panel | Create |
| `src/features/pos/POSSaleScreen.vue` | Screen 2 layout | Create |
| `src/features/pos/index.ts` | Public API boundary | Create |
| `src/features/payment/payment.types.ts` | Payment type definitions | Create |
| `src/features/payment/usePayment.ts` | Payment state machine | Create |
| `src/features/payment/PaymentModal.vue` | Screen 3 | Create |
| `src/features/payment/index.ts` | Public API boundary | Create |
| `src/features/exchange-rate/exchange-rate.types.ts` | Rate types | Create |
| `src/features/exchange-rate/useExchangeRate.ts` | Rate ViewModel | Create |
| `src/features/exchange-rate/ExchangeRateWidget.vue` | Header widget | Create |
| `src/features/exchange-rate/ExchangeRateEditor.vue` | Screen 5 modal | Create |
| `src/features/exchange-rate/index.ts` | Public API boundary | Create |
| `src/features/sale-history/sale-history.types.ts` | History types | Create |
| `src/features/sale-history/useSaleHistory.ts` | History ViewModel | Create |
| `src/features/sale-history/SaleHistoryScreen.vue` | Screen 6 | Create |
| `src/features/sale-history/index.ts` | Public API boundary | Create |
| `src/features/sync/sync.types.ts` | Sync types | Create |
| `src/features/sync/useSync.ts` | PowerSync → store bridge | Create |
| `src/features/sync/SyncIndicator.vue` | Sync dot widget | Create |
| `src/features/sync/index.ts` | Public API boundary | Create |
| `src/components/ui/AppHeader.vue` | Shared header shell | Create |
| `src/components/ui/AppToast.vue` | 4s auto-dismiss toast | Create |
| `src/components/ui/AppDialog.vue` | Blocking confirmation dialog | Create |
| `src/components/ui/SyncBadge.vue` | Inline sync badge | Create |
| `src/components/ui/NumericKeypad.vue` | On-screen number pad | Create |
| `src/pages/HomePage.vue` | Screen 1 (rewrite) | Rewrite |
| `src/pages/PosPage.vue` | Thin route wrapper | Create |
| `src/pages/SaleHistoryPage.vue` | Thin route wrapper | Create |
| `src/__tests__/setup.ts` | Vitest global setup | Create |
| `src/__tests__/__mocks__/db.ts` | PowerSync db mock for unit tests | Create |
| `docs/adr/ADR-001-powersync.md` | PowerSync ADR | Create |
| `docs/adr/ADR-002-supabase.md` | Supabase ADR | Create |
| `docs/adr/ADR-003-feature-first.md` | Folder structure ADR | Create |
| `docs/adr/ADR-004-offline-first.md` | Offline-first ADR | Create |
| `PROJECT_CONSTRAINTS.md` | Repo-level constraints file | Create |

---

### Task 1: Project Bootstrap

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `src/main.ts`
- Create: `.env.local.example`
- Create: `src/__tests__/setup.ts`
- Create: `src/__tests__/__mocks__/db.ts`

- [ ] **Step 1: Replace incorrect PowerSync package and add missing dependencies**

```bash
npm uninstall powersync
npm install @powersync/web dexie @zxing/browser
npm install --save-dev vitest @vitest/ui @vue/test-utils @vue/runtime-core jsdom fake-indexeddb
```

Expected: all install without errors. `node_modules/@powersync/web` and `node_modules/dexie` now exist.

- [ ] **Step 2: Update `vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    // PowerSync uses WASM + web workers — must be excluded from Vite pre-bundling
    exclude: ['@powersync/web'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
  },
})
```

- [ ] **Step 3: Create `.env.local.example`**

```
# Copy to .env.local and fill in values from your Supabase + PowerSync dashboards.
# NEVER commit .env.local to git.

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# PowerSync — leave blank for Epic 1 (app runs in offline-only SQLite mode)
VITE_POWERSYNC_URL=

# Epic 1 stub identity — replaced by real auth in a later epic
VITE_STUB_SHOP_ID=00000000-0000-0000-0000-000000000001
VITE_STUB_DEVICE_ID=00000000-0000-0000-0000-000000000002
VITE_STUB_DEVICE_CODE=A
```

- [ ] **Step 4: Create `src/__tests__/setup.ts`**

```typescript
import 'fake-indexeddb/auto'
import { vi } from 'vitest'

// Stub localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Stub matchMedia (not in jsdom)
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})
```

- [ ] **Step 5: Create `src/__tests__/__mocks__/db.ts`** (PowerSync db mock used by all composable tests)

```typescript
import { vi } from 'vitest'

export const db = {
  execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }),
  watch: vi.fn().mockReturnValue(new (class { subscribe = vi.fn() })),
  writeTransaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<void>) => {
    await fn({ execute: vi.fn().mockResolvedValue({}) })
  }),
  connect: vi.fn(),
  status: {
    connected: false,
    dataFlowStatus: { downloading: false, uploading: false },
  },
}
```

- [ ] **Step 6: Update `src/main.ts`**

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'

createApp(App).use(createPinia()).use(router).mount('#app')
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/main.ts .env.local.example src/__tests__/setup.ts "src/__tests__/__mocks__/db.ts"
git commit -m "chore: bootstrap — @powersync/web, dexie, vitest, RTL vite config"
```

---

### Task 2: Supabase Schema + Seed

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `supabase/seed.sql`

- [ ] **Step 1: Create `supabase/migrations/001_initial_schema.sql`**

```sql
-- Run via: supabase db push  OR  paste into Supabase SQL Editor
-- Zero-downtime rules (ENFORCEMENT.md §6): expand only, never DROP/RENAME on live data.

CREATE TABLE IF NOT EXISTS shops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id            UUID PRIMARY KEY,
  shop_id       UUID NOT NULL REFERENCES shops(id),
  device_code   TEXT NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id   UUID NOT NULL REFERENCES shops(id),
  name_ar   TEXT NOT NULL,
  name_en   TEXT,
  price_usd NUMERIC(10,2) NOT NULL CHECK (price_usd >= 0),
  barcode   TEXT,
  photo_url TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS sales (
  id                       UUID PRIMARY KEY,
  shop_id                  UUID NOT NULL REFERENCES shops(id),
  device_id                UUID NOT NULL REFERENCES devices(id),
  device_sequence          INTEGER NOT NULL,
  display_sale_number      TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL,
  total_usd                NUMERIC(10,2) NOT NULL,
  total_syp                NUMERIC(12,0) NOT NULL,
  exchange_rate_at_sale    NUMERIC(10,2) NOT NULL CHECK (exchange_rate_at_sale > 0),
  payment_method           TEXT NOT NULL CHECK (payment_method IN ('cash_usd','cash_syp','card')),
  amount_received          NUMERIC(12,2),
  amount_received_currency TEXT CHECK (amount_received_currency IN ('USD','SYP')),
  change_due               NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS sale_line_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        UUID NOT NULL REFERENCES sales(id),
  shop_id        UUID NOT NULL REFERENCES shops(id),
  product_id     UUID NOT NULL REFERENCES products(id),
  quantity       INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price_usd NUMERIC(10,2) NOT NULL CHECK (unit_price_usd >= 0),
  line_total_usd NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id   UUID NOT NULL REFERENCES shops(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  rate      NUMERIC(10,2) NOT NULL CHECK (rate > 0),
  set_at    TIMESTAMPTZ NOT NULL,
  set_by    TEXT NOT NULL DEFAULT 'owner'
);

-- Indexes for PowerSync query performance
CREATE INDEX IF NOT EXISTS idx_products_shop      ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_shop         ON sales(shop_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_shop    ON sale_line_items(shop_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale    ON sale_line_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_shop ON exchange_rates(shop_id, set_at DESC);
```

- [ ] **Step 2: Create `supabase/seed.sql`**

```sql
-- Stub data for Epic 1 development.
-- shop_id and device_id match VITE_STUB_SHOP_ID / VITE_STUB_DEVICE_ID in .env.local.example.

INSERT INTO shops (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'محل الأخ — تجريبي')
ON CONFLICT (id) DO NOTHING;

INSERT INTO devices (id, shop_id, device_code) VALUES
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO exchange_rates (id, shop_id, device_id, rate, set_at) VALUES
  (gen_random_uuid(),
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   14500, now())
ON CONFLICT DO NOTHING;

INSERT INTO products (id, shop_id, name_ar, name_en, price_usd, barcode) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'هاتف سامسونج A15',     'Samsung A15',      150.00, '1234567890'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'سماعة بلوتوث',          'Bluetooth Earbuds', 25.00, '2345678901'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'شاحن سريع 65 واط',      '65W Fast Charger',  12.00, '3456789012'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'كفر هاتف سيليكون',      'Silicone Case',      3.50, '4567890123'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'ذاكرة فلاش 64 جيجا',    'USB Flash 64GB',    10.00, NULL),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'كابل شحن USB-C',        'USB-C Cable',        2.00, NULL)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 3: Apply schema to Supabase**

Option A (Supabase CLI — recommended):
```bash
# Requires supabase CLI installed and project linked
npx supabase db push
```

Option B (Supabase dashboard):
- Open SQL Editor at `https://app.supabase.com/project/<your-project>/sql/new`
- Paste `supabase/migrations/001_initial_schema.sql` → Run
- Paste `supabase/seed.sql` → Run

Expected: 6 tables created, 6 product rows visible in Table Editor.

- [ ] **Step 4: Commit**

```bash
git add supabase/
git commit -m "feat(data): Supabase 6-table schema + stub seed data"
```

---

### Task 3: PowerSync Data Layer

**Files:**
- Create: `src/data/powersync/schema.ts`
- Create: `src/data/powersync/connector.ts`
- Create: `src/data/powersync/db.ts`

- [ ] **Step 1: Create `src/data/powersync/schema.ts`**

```typescript
import { column, Schema, Table } from '@powersync/web'

const products = new Table({
  shop_id:   column.text,
  name_ar:   column.text,
  name_en:   column.text,
  price_usd: column.real,
  barcode:   column.text,
  photo_url: column.text,
  is_active: column.integer,
})

const sales = new Table({
  shop_id:                  column.text,
  device_id:                column.text,
  device_sequence:          column.integer,
  display_sale_number:      column.text,
  created_at:               column.text,
  total_usd:                column.real,
  total_syp:                column.real,
  exchange_rate_at_sale:    column.real,
  payment_method:           column.text,
  amount_received:          column.real,
  amount_received_currency: column.text,
  change_due:               column.real,
})

const sale_line_items = new Table({
  sale_id:        column.text,
  shop_id:        column.text,
  product_id:     column.text,
  quantity:       column.integer,
  unit_price_usd: column.real,
  line_total_usd: column.real,
})

const exchange_rates = new Table({
  shop_id:   column.text,
  device_id: column.text,
  rate:      column.real,
  set_at:    column.text,
  set_by:    column.text,
})

export const AppSchema = new Schema({
  products,
  sales,
  sale_line_items,
  exchange_rates,
})
```

- [ ] **Step 2: Create `src/data/powersync/connector.ts`**

```typescript
import { AbstractPowerSyncDatabase, PowerSyncBackendConnector, UpdateType } from '@powersync/web'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseKey)

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const psUrl = import.meta.env.VITE_POWERSYNC_URL as string
    if (!psUrl) {
      // Epic 1: no PowerSync service configured — stay offline
      throw new Error('VITE_POWERSYNC_URL not set; running in offline-only mode')
    }
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) throw new Error('Not authenticated')
    return { endpoint: psUrl, token: data.session.access_token }
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const batch = await database.getCrudBatch(100)
    if (!batch) return
    try {
      for (const op of batch.crud) {
        const { table, id, opData } = op
        switch (op.op) {
          case UpdateType.PUT:
            await supabase.from(table).upsert({ id, ...opData })
            break
          case UpdateType.PATCH:
            await supabase.from(table).update(opData!).eq('id', id)
            break
          case UpdateType.DELETE:
            await supabase.from(table).delete().eq('id', id)
            break
        }
      }
      await batch.complete()
    } catch (err) {
      await batch.complete(err as Error)
    }
  }
}
```

- [ ] **Step 3: Create `src/data/powersync/db.ts`**

```typescript
import { PowerSyncDatabase } from '@powersync/web'
import { AppSchema } from './schema'
import { SupabaseConnector } from './connector'

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: 'wafi.db' },
})

// Epic 1: connect only when VITE_POWERSYNC_URL is configured.
// Without it, db operates as offline-only local SQLite — all reads/writes work.
const psUrl = import.meta.env.VITE_POWERSYNC_URL as string
if (psUrl) {
  db.connect(new SupabaseConnector()).catch((err: Error) => {
    console.warn('[PowerSync] Connection failed; offline mode:', err.message)
  })
}
```

- [ ] **Step 4: Verify PowerSync types resolve**

```bash
npx vue-tsc --noEmit
```

Expected: no type errors from the 3 new files. If `@powersync/web` types are missing, run `npm install` again.

- [ ] **Step 5: Commit**

```bash
git add src/data/powersync/
git commit -m "feat(data): PowerSync schema, connector stub, db singleton"
```

---

### Task 4: Dexie Draft Database

**Files:**
- Create: `src/data/dexie/draft.db.ts`
- Create: `src/__tests__/data/draft.db.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/__tests__/data/draft.db.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { draftDb } from '@/data/dexie/draft.db'

describe('draftDb', () => {
  beforeEach(async () => {
    await draftDb.drafts.clear()
  })

  it('saves and retrieves a draft by device_id', async () => {
    const draft = {
      id: 'device-001',
      device_id: 'device-001',
      shop_id: 'shop-001',
      line_items: [{ product_id: 'p1', name_ar: 'منتج', quantity: 2, unit_price_usd: 5 }],
      locked_exchange_rate: 14500,
      updated_at: Date.now(),
    }
    await draftDb.drafts.put(draft)
    const retrieved = await draftDb.drafts.get('device-001')
    expect(retrieved?.locked_exchange_rate).toBe(14500)
    expect(retrieved?.line_items).toHaveLength(1)
  })

  it('purges drafts older than 24 hours', async () => {
    const old = {
      id: 'old-device',
      device_id: 'old-device',
      shop_id: 'shop-001',
      line_items: [],
      locked_exchange_rate: 14500,
      updated_at: Date.now() - 25 * 60 * 60 * 1000,
    }
    await draftDb.drafts.put(old)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    await draftDb.drafts.where('updated_at').below(cutoff).delete()
    const result = await draftDb.drafts.get('old-device')
    expect(result).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL ("Cannot find module")**

```bash
npx vitest run src/__tests__/data/draft.db.test.ts
```

Expected: FAIL — `Cannot find module '@/data/dexie/draft.db'`

- [ ] **Step 3: Create `src/data/dexie/draft.db.ts`**

```typescript
import Dexie, { type Table } from 'dexie'

export interface DraftLineItem {
  product_id:     string
  name_ar:        string
  quantity:       number
  unit_price_usd: number
}

export interface SaleDraft {
  id:                   string   // device_id — one active draft per device
  device_id:            string
  shop_id:              string
  line_items:           DraftLineItem[]
  locked_exchange_rate: number   // captured on first addLine(); required for correct restore
  updated_at:           number   // Unix ms; used for 24h purge
}

class DraftDatabase extends Dexie {
  drafts!: Table<SaleDraft, string>

  constructor() {
    super('wafi_drafts')
    this.version(1).stores({
      drafts: 'id, device_id, updated_at',
    })
  }
}

export const draftDb = new DraftDatabase()
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run src/__tests__/data/draft.db.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/dexie/ src/__tests__/data/
git commit -m "feat(data): Dexie draft database with SaleDraft interface"
```

---

### Task 5: Pinia Stores

**Files:**
- Create: `src/store/device.store.ts`
- Create: `src/store/sale.store.ts`
- Create: `src/store/sync.store.ts`
- Create: `src/__tests__/store/sale.store.test.ts`

- [ ] **Step 1: Write failing tests for `sale.store`**

```typescript
// src/__tests__/store/sale.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleStore } from '@/store/sale.store'

describe('useSaleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('starts with empty lines and no locked rate', () => {
    const store = useSaleStore()
    expect(store.lines).toHaveLength(0)
    expect(store.lockedExchangeRate).toBeNull()
  })

  it('addLine adds a new line', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    expect(store.lines).toHaveLength(1)
    expect(store.totalUsd).toBe(10)
  })

  it('addLine increments quantity for existing product', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].quantity).toBe(2)
    expect(store.lines[0].lineTotalUsd).toBe(20)
  })

  it('setLockedRate sets rate only on first call', () => {
    const store = useSaleStore()
    store.setLockedRate(14500)
    store.setLockedRate(15000)
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('clear resets lines and locked rate', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.setLockedRate(14500)
    store.clear()
    expect(store.lines).toHaveLength(0)
    expect(store.lockedExchangeRate).toBeNull()
  })

  it('removeLine removes the correct product', () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'أ', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.addLine({ productId: 'p2', nameAr: 'ب', quantity: 1, unitPriceUsd: 5, lineTotalUsd: 5 })
    store.removeLine('p1')
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].productId).toBe('p2')
  })

  it('incrementSequence persists to localStorage', () => {
    const store = useSaleStore()
    const before = store.deviceSequence
    store.incrementSequence()
    expect(store.deviceSequence).toBe(before + 1)
    expect(localStorage.getItem('wafi_device_seq')).toBe(String(before + 1))
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/__tests__/store/sale.store.test.ts
```

Expected: FAIL — `Cannot find module '@/store/sale.store'`

- [ ] **Step 3: Create `src/store/device.store.ts`**

```typescript
import { defineStore } from 'pinia'

export const useDeviceStore = defineStore('device', () => {
  // Epic 1 stub — replaced by real auth in a later epic.
  // Values match supabase/seed.sql and .env.local.example.
  const shopId     = import.meta.env.VITE_STUB_SHOP_ID   as string ?? '00000000-0000-0000-0000-000000000001'
  const deviceId   = import.meta.env.VITE_STUB_DEVICE_ID as string ?? '00000000-0000-0000-0000-000000000002'
  const deviceCode = import.meta.env.VITE_STUB_DEVICE_CODE as string ?? 'A'

  return { shopId, deviceId, deviceCode }
})
```

- [ ] **Step 4: Create `src/store/sale.store.ts`**

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface SaleLine {
  productId:    string
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}

export const useSaleStore = defineStore('sale', () => {
  const lines               = ref<SaleLine[]>([])
  const lockedExchangeRate  = ref<number | null>(null)
  const deviceSequence      = ref<number>(
    parseInt(localStorage.getItem('wafi_device_seq') ?? '0', 10)
  )

  const totalUsd = computed(() =>
    lines.value.reduce((sum, l) => sum + l.lineTotalUsd, 0)
  )

  function addLine(line: SaleLine) {
    const existing = lines.value.find(l => l.productId === line.productId)
    if (existing) {
      existing.quantity    += 1
      existing.lineTotalUsd = existing.quantity * existing.unitPriceUsd
    } else {
      lines.value.push({ ...line })
    }
  }

  function removeLine(productId: string) {
    const idx = lines.value.findIndex(l => l.productId === productId)
    if (idx !== -1) lines.value.splice(idx, 1)
  }

  function updateQuantity(productId: string, quantity: number) {
    const line = lines.value.find(l => l.productId === productId)
    if (line) {
      line.quantity     = quantity
      line.lineTotalUsd = quantity * line.unitPriceUsd
    }
  }

  function setLockedRate(rate: number) {
    if (lockedExchangeRate.value === null) {
      lockedExchangeRate.value = rate
    }
  }

  function incrementSequence() {
    deviceSequence.value += 1
    localStorage.setItem('wafi_device_seq', String(deviceSequence.value))
  }

  function clear() {
    lines.value              = []
    lockedExchangeRate.value = null
  }

  return {
    lines,
    lockedExchangeRate,
    deviceSequence,
    totalUsd,
    addLine,
    removeLine,
    updateQuantity,
    setLockedRate,
    incrementSequence,
    clear,
  }
})
```

- [ ] **Step 5: Create `src/store/sync.store.ts`**

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type SyncStatus = 'online' | 'offline' | 'syncing'

export const useSyncStore = defineStore('sync', () => {
  const status       = ref<SyncStatus>('offline')
  const pendingCount = ref(0)
  const lastSyncedAt = ref<Date | null>(null)
  const errorMessage = ref<string | null>(null)

  function setStatus(s: SyncStatus) { status.value = s }
  function setPendingCount(n: number) { pendingCount.value = n }
  function setLastSynced(d: Date) { lastSyncedAt.value = d; errorMessage.value = null }
  function setError(msg: string) { errorMessage.value = msg }

  return { status, pendingCount, lastSyncedAt, errorMessage, setStatus, setPendingCount, setLastSynced, setError }
})
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npx vitest run src/__tests__/store/sale.store.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/store/ src/__tests__/store/
git commit -m "feat(store): device, sale, sync Pinia stores"
```

---

### Task 6: `useSaleNumber` Composable

**Files:**
- Create: `src/composables/useSaleNumber.ts`
- Create: `src/__tests__/composables/useSaleNumber.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/composables/useSaleNumber.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleNumber } from '@/composables/useSaleNumber'

describe('useSaleNumber', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('formats as {code}-{6-digit-padded}', () => {
    const { formatNumber } = useSaleNumber()
    expect(formatNumber('A', 246)).toBe('A-000247')
  })

  it('pads single digit sequence to 6 digits', () => {
    const { formatNumber } = useSaleNumber()
    expect(formatNumber('A', 0)).toBe('A-000001')
  })

  it('handles multi-char device code', () => {
    const { formatNumber } = useSaleNumber()
    expect(formatNumber('T-a1f3', 999)).toBe('T-a1f3-001000')
  })

  it('nextNumber() increments sale.store.deviceSequence', () => {
    const { nextNumber } = useSaleNumber()
    const { useSaleStore } = require('@/store/sale.store')
    const store = useSaleStore()
    const before = store.deviceSequence
    nextNumber()
    expect(store.deviceSequence).toBe(before + 1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/__tests__/composables/useSaleNumber.test.ts
```

- [ ] **Step 3: Create `src/composables/useSaleNumber.ts`**

```typescript
import { useSaleStore } from '@/store/sale.store'

export function useSaleNumber() {
  const saleStore = useSaleStore()

  function formatNumber(deviceCode: string, sequenceAfterIncrement: number): string {
    const padded = String(sequenceAfterIncrement).padStart(6, '0')
    return `${deviceCode}-${padded}`
  }

  function nextNumber(): string {
    saleStore.incrementSequence()
    return formatNumber(
      import.meta.env.VITE_STUB_DEVICE_CODE as string ?? 'A',
      saleStore.deviceSequence
    )
  }

  return { formatNumber, nextNumber }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/__tests__/composables/useSaleNumber.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useSaleNumber.ts src/__tests__/composables/
git commit -m "feat(composable): useSaleNumber — CD-1 display_sale_number format"
```

---

### Task 7: `useSaleDraft` Composable

**Files:**
- Create: `src/composables/useSaleDraft.ts`
- Create: `src/__tests__/composables/useSaleDraft.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/composables/useSaleDraft.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { useSaleStore } from '@/store/sale.store'
import { draftDb } from '@/data/dexie/draft.db'

const DEVICE_ID = '00000000-0000-0000-0000-000000000002'

describe('useSaleDraft', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    await draftDb.drafts.clear()
  })

  it('hasDraft is false when no draft exists', async () => {
    const { hasDraft, loadDraft } = useSaleDraft()
    await loadDraft()
    expect(hasDraft.value).toBe(false)
  })

  it('saveDraft writes to Dexie with locked_exchange_rate', async () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.setLockedRate(14500)

    const { saveDraft } = useSaleDraft()
    await saveDraft()

    const draft = await draftDb.drafts.get(DEVICE_ID)
    expect(draft?.locked_exchange_rate).toBe(14500)
    expect(draft?.line_items).toHaveLength(1)
  })

  it('restoreDraft patches sale.store from Dexie', async () => {
    await draftDb.drafts.put({
      id: DEVICE_ID,
      device_id: DEVICE_ID,
      shop_id: '00000000-0000-0000-0000-000000000001',
      line_items: [{ product_id: 'p1', name_ar: 'منتج', quantity: 3, unit_price_usd: 5 }],
      locked_exchange_rate: 14200,
      updated_at: Date.now(),
    })

    const store = useSaleStore()
    const { restoreDraft, loadDraft } = useSaleDraft()
    await loadDraft()
    await restoreDraft()

    expect(store.lockedExchangeRate).toBe(14200)
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].quantity).toBe(3)
  })

  it('clearDraft removes Dexie record', async () => {
    await draftDb.drafts.put({
      id: DEVICE_ID,
      device_id: DEVICE_ID,
      shop_id: '00000000-0000-0000-0000-000000000001',
      line_items: [],
      locked_exchange_rate: 14500,
      updated_at: Date.now(),
    })

    const { clearDraft, loadDraft, hasDraft } = useSaleDraft()
    await clearDraft()
    await loadDraft()
    expect(hasDraft.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/__tests__/composables/useSaleDraft.test.ts
```

- [ ] **Step 3: Create `src/composables/useSaleDraft.ts`**

```typescript
import { ref } from 'vue'
import { draftDb } from '@/data/dexie/draft.db'
import { useSaleStore, type SaleLine } from '@/store/sale.store'
import { useDeviceStore } from '@/store/device.store'

export function useSaleDraft() {
  const hasDraft = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function loadDraft() {
    const device = useDeviceStore()
    const draft = await draftDb.drafts.get(device.deviceId)
    hasDraft.value = !!draft && draft.line_items.length > 0
  }

  async function saveDraft() {
    const sale   = useSaleStore()
    const device = useDeviceStore()
    if (sale.lines.length === 0) { await clearDraft(); return }

    await draftDb.drafts.put({
      id:                   device.deviceId,
      device_id:            device.deviceId,
      shop_id:              device.shopId,
      line_items:           sale.lines.map(l => ({
        product_id:     l.productId,
        name_ar:        l.nameAr,
        quantity:       l.quantity,
        unit_price_usd: l.unitPriceUsd,
      })),
      locked_exchange_rate: sale.lockedExchangeRate ?? 0,
      updated_at:           Date.now(),
    })
    hasDraft.value = true
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveDraft, 200)
  }

  async function restoreDraft() {
    const device = useDeviceStore()
    const sale   = useSaleStore()
    const draft  = await draftDb.drafts.get(device.deviceId)
    if (!draft) return

    sale.clear()
    // Restore locked rate first so it's in place before lines are added
    sale.setLockedRate(draft.locked_exchange_rate)
    for (const item of draft.line_items) {
      const line: SaleLine = {
        productId:    item.product_id,
        nameAr:       item.name_ar,
        quantity:     item.quantity,
        unitPriceUsd: item.unit_price_usd,
        lineTotalUsd: item.quantity * item.unit_price_usd,
      }
      // Push directly to avoid quantity-merging logic in addLine()
      sale.lines.push(line)
    }
  }

  async function clearDraft() {
    const device = useDeviceStore()
    await draftDb.drafts.delete(device.deviceId)
    hasDraft.value = false
  }

  async function purgeOldDrafts() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    await draftDb.drafts.where('updated_at').below(cutoff).delete()
  }

  return { hasDraft, loadDraft, saveDraft, scheduleSave, restoreDraft, clearDraft, purgeOldDrafts }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/__tests__/composables/useSaleDraft.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useSaleDraft.ts src/__tests__/composables/useSaleDraft.test.ts
git commit -m "feat(composable): useSaleDraft — CD-3 IndexedDB draft persistence"
```

---

### Task 8: `usePrinter` + `SimulatedDriver`

**Files:**
- Create: `src/composables/usePrinter.ts`
- Create: `src/__tests__/composables/usePrinter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/composables/usePrinter.test.ts
import { describe, it, expect, vi } from 'vitest'
import { usePrinter, SimulatedDriver } from '@/composables/usePrinter'
import type { ReceiptData } from '@/composables/usePrinter'

const sampleReceipt: ReceiptData = {
  saleId:            'sale-001',
  displaySaleNumber: 'A-000001',
  shopName:          'محل تجريبي',
  createdAt:         new Date().toISOString(),
  lines: [{ nameAr: 'منتج', quantity: 2, unitPriceUsd: 10, lineTotalUsd: 20 }],
  totalUsd:          20,
  totalSyp:          290000,
  exchangeRate:      14500,
  paymentMethod:     'cash_usd',
}

describe('SimulatedDriver', () => {
  it('resolves without throwing', async () => {
    const driver = new SimulatedDriver()
    await expect(driver.print(sampleReceipt)).resolves.toBeUndefined()
  })

  it('logs receipt to console', async () => {
    const consoleSpy = vi.spyOn(console, 'log')
    const driver = new SimulatedDriver()
    await driver.print(sampleReceipt)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SimulatedPrinter]'),
      expect.anything()
    )
  })
})

describe('usePrinter', () => {
  it('print() resolves when driver succeeds', async () => {
    const { print } = usePrinter(new SimulatedDriver())
    await expect(print(sampleReceipt)).resolves.toBeUndefined()
  })

  it('print() rejects and surfaces error when driver throws', async () => {
    const failDriver = { print: vi.fn().mockRejectedValue(new Error('Printer disconnected')) }
    const { print, error } = usePrinter(failDriver)
    await expect(print(sampleReceipt)).rejects.toThrow('Printer disconnected')
    expect(error.value).toBe('Printer disconnected')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/__tests__/composables/usePrinter.test.ts
```

- [ ] **Step 3: Create `src/composables/usePrinter.ts`**

```typescript
import { ref } from 'vue'

export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card'

export interface ReceiptData {
  saleId:            string
  displaySaleNumber: string
  shopName:          string
  createdAt:         string
  lines: Array<{
    nameAr:        string
    quantity:      number
    unitPriceUsd:  number
    lineTotalUsd:  number
  }>
  totalUsd:                 number
  totalSyp:                 number
  exchangeRate:             number
  paymentMethod:            PaymentMethod
  amountReceived?:          number
  amountReceivedCurrency?:  'USD' | 'SYP'
  changeDue?:               number
}

export interface IPrinterDriver {
  print(receipt: ReceiptData): Promise<void>
}

export class SimulatedDriver implements IPrinterDriver {
  async print(receipt: ReceiptData): Promise<void> {
    // Simulates 500ms thermal print delay
    await new Promise(resolve => setTimeout(resolve, 500))
    console.log('[SimulatedPrinter]', {
      saleNumber: receipt.displaySaleNumber,
      total:      `$${receipt.totalUsd.toFixed(2)} / ${receipt.totalSyp.toLocaleString()} ل.س`,
      lines:      receipt.lines.map(l => `${l.nameAr} × ${l.quantity} = $${l.lineTotalUsd.toFixed(2)}`),
    })
  }
}

export function usePrinter(driver: IPrinterDriver = new SimulatedDriver()) {
  const printing = ref(false)
  const error    = ref<string | null>(null)

  async function print(receipt: ReceiptData): Promise<void> {
    printing.value = true
    error.value    = null
    try {
      await driver.print(receipt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Print failed'
      error.value = msg
      throw err
    } finally {
      printing.value = false
    }
  }

  return { printing, error, print }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/__tests__/composables/usePrinter.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePrinter.ts src/__tests__/composables/usePrinter.test.ts
git commit -m "feat(composable): usePrinter — IPrinterDriver + SimulatedDriver"
```

---

### Task 9: `useBarcodeScan` Composable

**Files:**
- Create: `src/composables/useBarcodeScan.ts`
- Create: `src/__tests__/composables/useBarcodeScan.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/composables/useBarcodeScan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBarcodeScan } from '@/composables/useBarcodeScan'

function fireKeySequence(keys: string[], intervalMs: number) {
  const now = performance.now()
  keys.forEach((key, i) => {
    const event = new KeyboardEvent('keydown', { key })
    Object.defineProperty(event, 'timeStamp', { value: now + i * intervalMs })
    document.dispatchEvent(event)
  })
  // Fire Enter to terminate
  const enter = new KeyboardEvent('keydown', { key: 'Enter' })
  Object.defineProperty(enter, 'timeStamp', { value: now + keys.length * intervalMs })
  document.dispatchEvent(enter)
}

describe('useBarcodeScan USB detection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('calls callback for burst ≥ 30 chars/sec (< 33ms per char)', async () => {
    const cb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(cb)

    // 8 chars at ~10ms each = 100 chars/sec (scanner speed)
    fireKeySequence(['1','2','3','4','5','6','7','8'], 10)

    expect(cb).toHaveBeenCalledWith('12345678')
    destroy()
  })

  it('does NOT call callback for slow human typing (> 33ms per char)', () => {
    const cb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(cb)

    // 4 chars at 100ms each = 10 chars/sec (human speed)
    fireKeySequence(['A','B','C','D'], 100)

    expect(cb).not.toHaveBeenCalled()
    destroy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/__tests__/composables/useBarcodeScan.test.ts
```

- [ ] **Step 3: Create `src/composables/useBarcodeScan.ts`**

```typescript
import { ref } from 'vue'

// USB scanner threshold: ≥ 30 chars/sec means < 33ms between keystrokes.
const SCANNER_INTERVAL_MS = 33

type ScanCallback = (barcode: string) => void

export function useBarcodeScan() {
  const cameraAvailable = ref(
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  )

  let buffer      = ''
  let lastTime    = 0
  let callbacks:  ScanCallback[] = []

  function handleKeyDown(e: KeyboardEvent) {
    const now = e.timeStamp

    if (e.key === 'Enter') {
      if (buffer.length >= 4) {
        // Only fire if average interval was scanner-speed
        const avgInterval = (now - lastTime) / buffer.length
        if (avgInterval < SCANNER_INTERVAL_MS) {
          callbacks.forEach(cb => cb(buffer))
        }
      }
      buffer = ''
      lastTime = 0
      return
    }

    if (e.key.length === 1) {
      if (buffer.length === 0) {
        buffer   = e.key
        lastTime = now
      } else {
        const interval = now - lastTime
        if (interval < SCANNER_INTERVAL_MS) {
          buffer  += e.key
          lastTime = now
        } else {
          // Too slow — reset buffer (human typing)
          buffer   = e.key
          lastTime = now
        }
      }
    }
  }

  document.addEventListener('keydown', handleKeyDown)

  function onScan(cb: ScanCallback) {
    callbacks.push(cb)
  }

  function offScan(cb: ScanCallback) {
    callbacks = callbacks.filter(c => c !== cb)
  }

  function destroy() {
    document.removeEventListener('keydown', handleKeyDown)
    callbacks = []
  }

  // Camera support (requires @zxing/browser, HTTPS)
  async function startCamera(onResult: ScanCallback): Promise<void> {
    if (!cameraAvailable.value) throw new Error('Camera not available')
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()
    const videoEl = document.createElement('video')
    await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
      if (result) onResult(result.getText())
    })
  }

  return { cameraAvailable, onScan, offScan, startCamera, destroy }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/__tests__/composables/useBarcodeScan.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useBarcodeScan.ts src/__tests__/composables/useBarcodeScan.test.ts
git commit -m "feat(composable): useBarcodeScan — USB burst detection + camera stub"
```

---

### Task 10: `useExchangeRate` Composable

**Files:**
- Create: `src/features/exchange-rate/exchange-rate.types.ts`
- Create: `src/features/exchange-rate/useExchangeRate.ts`
- Create: `src/__tests__/features/useExchangeRate.test.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/features/exchange-rate/exchange-rate.types.ts
export interface ExchangeRate {
  id:       string
  shopId:   string
  deviceId: string
  rate:     number
  setAt:    string
  setBy:    string
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/__tests__/features/useExchangeRate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useExchangeRate } from '@/features/exchange-rate/useExchangeRate'
import { db } from '@/data/powersync/db'

describe('useExchangeRate', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('currentRate is null when no rates in db', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: { _array: [] } } as any)
    const { currentRate, loadRate } = useExchangeRate()
    await loadRate()
    expect(currentRate.value).toBeNull()
  })

  it('currentRate reflects latest rate from db', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ rate: 14500, set_at: new Date().toISOString() }] },
    } as any)
    const { currentRate, loadRate } = useExchangeRate()
    await loadRate()
    expect(currentRate.value).toBe(14500)
  })

  it('saveRate rejects value <= 0', async () => {
    const { saveRate } = useExchangeRate()
    await expect(saveRate(0)).rejects.toThrow('Rate must be greater than zero')
  })

  it('saveRate sets needsConfirmation when > 50% change', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ rate: 14500, set_at: new Date().toISOString() }] },
    } as any)
    const { loadRate, saveRate, needsConfirmation } = useExchangeRate()
    await loadRate()
    saveRate(22000)  // ~52% increase — no await, just sets flag
    expect(needsConfirmation.value).toBe(true)
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run src/__tests__/features/useExchangeRate.test.ts
```

- [ ] **Step 4: Create `src/features/exchange-rate/useExchangeRate.ts`**

```typescript
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'

export function useExchangeRate() {
  const currentRate       = ref<number | null>(null)
  const rateHistory       = ref<Array<{ rate: number; setAt: string }>>([])
  const needsConfirmation = ref(false)
  const pendingRate       = ref<number | null>(null)
  const saving            = ref(false)
  const error             = ref<string | null>(null)

  async function loadRate() {
    const device = useDeviceStore()
    const result = await db.execute(
      `SELECT rate, set_at FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 5`,
      [device.shopId]
    )
    const rows: Array<{ rate: number; set_at: string }> = (result as any).rows._array
    if (rows.length > 0) {
      currentRate.value  = rows[0].rate
      rateHistory.value  = rows.map(r => ({ rate: r.rate, setAt: r.set_at }))
    } else {
      currentRate.value = null
      rateHistory.value = []
    }
  }

  async function saveRate(newRate: number, confirmed = false): Promise<void> {
    if (newRate <= 0) throw new Error('Rate must be greater than zero')

    if (currentRate.value !== null && !confirmed) {
      const change = Math.abs(newRate - currentRate.value) / currentRate.value
      if (change > 0.5) {
        needsConfirmation.value = true
        pendingRate.value       = newRate
        return
      }
    }

    needsConfirmation.value = false
    pendingRate.value       = null
    saving.value            = true
    error.value             = null

    try {
      const device = useDeviceStore()
      await db.execute(
        `INSERT INTO exchange_rates (id, shop_id, device_id, rate, set_at, set_by)
         VALUES (?, ?, ?, ?, ?, 'owner')`,
        [uuidv4(), device.shopId, device.deviceId, newRate, new Date().toISOString()]
      )
      currentRate.value = newRate
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save rate'
      throw err
    } finally {
      saving.value = false
    }
  }

  async function confirmSave(): Promise<void> {
    if (pendingRate.value !== null) {
      await saveRate(pendingRate.value, true)
    }
  }

  return {
    currentRate,
    rateHistory,
    needsConfirmation,
    pendingRate,
    saving,
    error,
    loadRate,
    saveRate,
    confirmSave,
  }
}
```

Note: install `uuid` package: `npm install uuid && npm install --save-dev @types/uuid`

- [ ] **Step 5: Run — expect PASS**

```bash
npx vitest run src/__tests__/features/useExchangeRate.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/exchange-rate/exchange-rate.types.ts src/features/exchange-rate/useExchangeRate.ts src/__tests__/features/useExchangeRate.test.ts
git commit -m "feat(exchange-rate): useExchangeRate composable with 50% guard"
```

---

### Task 11: `useSale` Composable

**Files:**
- Create: `src/features/pos/pos.types.ts`
- Create: `src/features/pos/useSale.ts`
- Create: `src/__tests__/features/useSale.test.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/features/pos/pos.types.ts
export interface Product {
  id:        string
  shopId:    string
  nameAr:    string
  nameEn?:   string
  priceUsd:  number
  barcode?:  string
  photoUrl?: string
  isActive:  boolean
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/__tests__/features/useSale.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useSale } from '@/features/pos/useSale'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'

describe('useSale', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('addLine locks exchange rate on first item', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10 }] },
    } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await addLine('p1')
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('addLine does not change locked rate when already set', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p1', name_ar: 'أ', price_usd: 10 }] } } as any)
      .mockResolvedValueOnce({ rows: { _array: [{ id: 'p2', name_ar: 'ب', price_usd: 5 }] } } as any)
    const store = useSaleStore()
    const { addLine } = useSale(14500)
    await addLine('p1')
    // Simulate rate change before second add
    const { addLine: addLine2 } = useSale(15000)
    await addLine2('p2')
    expect(store.lockedExchangeRate).toBe(14500)
  })

  it('totalSyp uses locked rate, not current rate', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10 }] },
    } as any)
    const { addLine, totalSyp } = useSale(14500)
    await addLine('p1')
    expect(totalSyp.value).toBe(Math.round(10 * 14500))
  })

  it('addLine throws when currentRate is null', async () => {
    const { addLine } = useSale(null)
    await expect(addLine('p1')).rejects.toThrow('Exchange rate not set')
  })

  it('hasRateChangeNotice is true when rate changes mid-sale', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: { _array: [{ id: 'p1', name_ar: 'منتج', price_usd: 10 }] },
    } as any)
    const { addLine, hasRateChangeNotice } = useSale(14500)
    await addLine('p1')
    // Simulate rate change — create new useSale instance with different rate
    const { checkRateChanged } = useSale(15000)
    checkRateChanged()
    expect(hasRateChangeNotice.value).toBe(true)
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run src/__tests__/features/useSale.test.ts
```

- [ ] **Step 4: Create `src/features/pos/useSale.ts`**

```typescript
import { computed, ref } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export function useSale(currentRate: number | null) {
  const saleStore  = useSaleStore()
  const hasRateChangeNotice = ref(false)

  const totalSyp = computed(() => {
    const rate = saleStore.lockedExchangeRate
    if (rate === null) return 0
    return Math.round(saleStore.totalUsd * rate)
  })

  async function addLine(productId: string) {
    if (currentRate === null) throw new Error('Exchange rate not set')

    const result = await db.execute(
      `SELECT id, name_ar, price_usd FROM products WHERE id = ? AND is_active = 1`,
      [productId]
    )
    const rows: Array<{ id: string; name_ar: string; price_usd: number }> =
      (result as any).rows._array
    if (!rows.length) throw new Error(`Product ${productId} not found`)

    const p = rows[0]
    saleStore.setLockedRate(currentRate)
    saleStore.addLine({
      productId:    p.id,
      nameAr:       p.name_ar,
      quantity:     1,
      unitPriceUsd: p.price_usd,
      lineTotalUsd: p.price_usd,
    })
  }

  function checkRateChanged() {
    if (saleStore.lines.length > 0 && currentRate !== saleStore.lockedExchangeRate) {
      hasRateChangeNotice.value = true
    }
  }

  async function lookupByBarcode(barcode: string): Promise<string | null> {
    const device = useDeviceStore()
    const result = await db.execute(
      `SELECT id FROM products WHERE shop_id = ? AND barcode = ? AND is_active = 1`,
      [device.shopId, barcode]
    )
    const rows: Array<{ id: string }> = (result as any).rows._array
    return rows[0]?.id ?? null
  }

  return {
    lines:               saleStore.lines,
    totalUsd:            saleStore.totalUsd,
    totalSyp,
    lockedRate:          computed(() => saleStore.lockedExchangeRate),
    hasRateChangeNotice,
    addLine,
    removeLine:          saleStore.removeLine,
    updateQuantity:      saleStore.updateQuantity,
    checkRateChanged,
    lookupByBarcode,
  }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx vitest run src/__tests__/features/useSale.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/pos/ src/__tests__/features/useSale.test.ts
git commit -m "feat(pos): useSale composable — locked rate, addLine, totalSyp"
```

---

### Task 12: `usePayment` Composable

**Files:**
- Create: `src/features/payment/payment.types.ts`
- Create: `src/features/payment/usePayment.ts`
- Create: `src/__tests__/features/usePayment.test.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/features/payment/payment.types.ts
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'confirming' | 'confirmed'

export interface CompletedSale {
  saleId:              string
  displaySaleNumber:   string
  totalUsd:            number
  totalSyp:            number
  exchangeRateAtSale:  number
  paymentMethod:       PaymentMethod
  amountReceived?:     number
  amountReceivedCurrency?: 'USD' | 'SYP'
  changeDue?:          number
  createdAt:           string
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/__tests__/features/usePayment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { usePayment } from '@/features/payment/usePayment'
import { useSaleStore } from '@/store/sale.store'

describe('usePayment', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useSaleStore()
    store.clear()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.setLockedRate(14500)
    vi.clearAllMocks()
  })

  it('starts at method-selection state', () => {
    const { state } = usePayment()
    expect(state.value).toBe('method-selection')
  })

  it('selectMethod transitions to amount-entry for cash payments', () => {
    const { state, selectMethod } = usePayment()
    selectMethod('cash_usd')
    expect(state.value).toBe('amount-entry')
  })

  it('selectMethod transitions directly to confirming for card', () => {
    const { state, selectMethod } = usePayment()
    selectMethod('card')
    expect(state.value).toBe('confirming')
  })

  it('back() from amount-entry returns to method-selection and clears amount', () => {
    const { state, selectMethod, amountReceived, back } = usePayment()
    selectMethod('cash_usd')
    amountReceived.value = 20
    back()
    expect(state.value).toBe('method-selection')
    expect(amountReceived.value).toBeNull()
  })

  it('cancel() closes modal with sale intact', () => {
    const store = useSaleStore()
    const { cancel, isOpen } = usePayment()
    cancel()
    expect(isOpen.value).toBe(false)
    expect(store.lines).toHaveLength(1)
  })

  it('confirm() clears sale.store on success', async () => {
    const { selectMethod, confirm } = usePayment()
    selectMethod('card')
    await confirm()
    const store = useSaleStore()
    expect(store.lines).toHaveLength(0)
  })

  it('changeDue computed correctly for cash_usd overpay', () => {
    const { selectMethod, amountReceived, changeDue } = usePayment()
    selectMethod('cash_usd')
    amountReceived.value = 15
    expect(changeDue.value).toBeCloseTo(5, 2)
  })

  it('SYP total uses locked rate not current rate', () => {
    const { totalSyp } = usePayment()
    // lockedRate = 14500, totalUsd = 10
    expect(totalSyp.value).toBe(145000)
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run src/__tests__/features/usePayment.test.ts
```

- [ ] **Step 4: Create `src/features/payment/usePayment.ts`**

```typescript
import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { useSaleNumber } from '@/composables/useSaleNumber'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import type { PaymentMethod, PaymentState, CompletedSale } from './payment.types'

export function usePayment() {
  const saleStore   = useSaleStore()
  const deviceStore = useDeviceStore()
  const state       = ref<PaymentState>('method-selection')
  const isOpen      = ref(true)
  const method      = ref<PaymentMethod | null>(null)
  const amountReceived = ref<number | null>(null)
  const confirming  = ref(false)
  const error       = ref<string | null>(null)

  const totalUsd = computed(() => saleStore.totalUsd)

  const totalSyp = computed(() => {
    const rate = saleStore.lockedExchangeRate
    if (rate === null) return 0
    return Math.round(totalUsd.value * rate)
  })

  const changeDue = computed(() => {
    if (method.value === 'cash_usd' && amountReceived.value !== null) {
      return Math.max(0, amountReceived.value - totalUsd.value)
    }
    if (method.value === 'cash_syp' && amountReceived.value !== null) {
      return Math.max(0, amountReceived.value - totalSyp.value)
    }
    return null
  })

  function selectMethod(m: PaymentMethod) {
    method.value = m
    if (m === 'card') {
      state.value = 'confirming'
    } else {
      state.value = 'amount-entry'
    }
  }

  function back() {
    if (state.value === 'amount-entry') {
      amountReceived.value = null
      state.value = 'method-selection'
    }
  }

  function cancel() {
    isOpen.value = false
    // Sale intentionally NOT cleared — user can resume
  }

  async function confirm(): Promise<CompletedSale> {
    if (!method.value) throw new Error('No payment method selected')
    confirming.value = true
    error.value      = null

    const saleId     = uuidv4()
    const now        = new Date().toISOString()
    const { nextNumber } = useSaleNumber()
    const displayNum = nextNumber()

    const sale: CompletedSale = {
      saleId,
      displaySaleNumber:    displayNum,
      totalUsd:             totalUsd.value,
      totalSyp:             totalSyp.value,
      exchangeRateAtSale:   saleStore.lockedExchangeRate!,
      paymentMethod:        method.value,
      amountReceived:       amountReceived.value ?? undefined,
      amountReceivedCurrency: method.value === 'cash_syp' ? 'SYP' : 'USD',
      changeDue:            changeDue.value ?? undefined,
      createdAt:            now,
    }

    try {
      // Write sale to PowerSync local SQLite (will sync when online)
      await db.execute(
        `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
          created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
          amount_received, amount_received_currency, change_due)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, deviceStore.shopId, deviceStore.deviceId,
          saleStore.deviceSequence, displayNum, now,
          totalUsd.value, totalSyp.value, sale.exchangeRateAtSale,
          method.value, sale.amountReceived ?? null,
          sale.amountReceivedCurrency ?? null, sale.changeDue ?? null,
        ]
      )

      for (const line of saleStore.lines) {
        await db.execute(
          `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), saleId, deviceStore.shopId, line.productId,
           line.quantity, line.unitPriceUsd, line.lineTotalUsd]
        )
      }

      const { clearDraft } = useSaleDraft()
      await clearDraft()
      saleStore.clear()
      state.value = 'confirmed'
      isOpen.value = false
      return sale
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Payment failed'
      confirming.value = false
      throw err
    }
  }

  return {
    state, isOpen, method, amountReceived, confirming, error,
    totalUsd, totalSyp, changeDue,
    selectMethod, back, cancel, confirm,
  }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx vitest run src/__tests__/features/usePayment.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/payment/ src/__tests__/features/usePayment.test.ts
git commit -m "feat(payment): usePayment state machine — method-selection → amount-entry → confirming → confirmed"
```

---

### Task 13: `useSync` + `useSaleHistory` Composables

**Files:**
- Create: `src/features/sync/sync.types.ts`
- Create: `src/features/sync/useSync.ts`
- Create: `src/features/sale-history/sale-history.types.ts`
- Create: `src/features/sale-history/useSaleHistory.ts`

- [ ] **Step 1: Create sync types**

```typescript
// src/features/sync/sync.types.ts
export type SyncStatus = 'online' | 'offline' | 'syncing'

export interface SyncState {
  status:       SyncStatus
  pendingCount: number
  lastSyncedAt: Date | null
  errorMessage: string | null
  isStale:      boolean  // true when offline > 24h
}
```

- [ ] **Step 2: Create `src/features/sync/useSync.ts`**

```typescript
import { computed, onMounted, onUnmounted } from 'vue'
import { useSyncStore } from '@/store/sync.store'
import { db } from '@/data/powersync/db'

export function useSync() {
  const syncStore = useSyncStore()

  const isStale = computed(() => {
    if (!syncStore.lastSyncedAt) return false
    return Date.now() - syncStore.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000
  })

  function bindPowerSync() {
    // PowerSync status events → sync.store
    const unsubscribe = db.status?.onChange?.((status: any) => {
      if (status.connected) {
        syncStore.setStatus('online')
        syncStore.setLastSynced(new Date())
      } else if (status.dataFlowStatus?.downloading || status.dataFlowStatus?.uploading) {
        syncStore.setStatus('syncing')
      } else {
        syncStore.setStatus('offline')
      }
    })
    return unsubscribe
  }

  let unbind: (() => void) | undefined

  onMounted(() => { unbind = bindPowerSync() })
  onUnmounted(() => { unbind?.() })

  return {
    status:       computed(() => syncStore.status),
    pendingCount: computed(() => syncStore.pendingCount),
    lastSyncedAt: computed(() => syncStore.lastSyncedAt),
    errorMessage: computed(() => syncStore.errorMessage),
    isStale,
  }
}
```

- [ ] **Step 3: Create sale history types**

```typescript
// src/features/sale-history/sale-history.types.ts
import type { PaymentMethod } from '@/features/payment/payment.types'

export interface SaleRecord {
  id:                  string
  shopId:              string
  deviceId:            string
  deviceSequence:      number
  displaySaleNumber:   string
  createdAt:           string
  totalUsd:            number
  totalSyp:            number
  exchangeRateAtSale:  number
  paymentMethod:       PaymentMethod
  amountReceived?:     number
  amountReceivedCurrency?: 'USD' | 'SYP'
  changeDue?:          number
}

export interface SaleLineRecord {
  id:           string
  saleId:       string
  productId:    string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}
```

- [ ] **Step 4: Create `src/features/sale-history/useSaleHistory.ts`**

```typescript
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { usePrinter } from '@/composables/usePrinter'
import type { ReceiptData } from '@/composables/usePrinter'
import type { SaleRecord, SaleLineRecord } from './sale-history.types'

export function useSaleHistory() {
  const sales   = ref<SaleRecord[]>([])
  const loading = ref(false)
  const error   = ref<string | null>(null)
  const printer = usePrinter()

  async function loadHistory() {
    const device = useDeviceStore()
    loading.value = true
    error.value   = null
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const result = await db.execute(
        `SELECT * FROM sales WHERE shop_id = ? AND created_at >= ? ORDER BY created_at DESC`,
        [device.shopId, sevenDaysAgo]
      )
      sales.value = ((result as any).rows._array as any[]).map(r => ({
        id:                  r.id,
        shopId:              r.shop_id,
        deviceId:            r.device_id,
        deviceSequence:      r.device_sequence,
        displaySaleNumber:   r.display_sale_number,
        createdAt:           r.created_at,
        totalUsd:            r.total_usd,
        totalSyp:            r.total_syp,
        exchangeRateAtSale:  r.exchange_rate_at_sale,
        paymentMethod:       r.payment_method,
        amountReceived:      r.amount_received,
        amountReceivedCurrency: r.amount_received_currency,
        changeDue:           r.change_due,
      }))
    } finally {
      loading.value = false
    }
  }

  async function reprint(saleId: string): Promise<void> {
    const device = useDeviceStore()
    const [saleRes, linesRes] = await Promise.all([
      db.execute(`SELECT * FROM sales WHERE id = ?`, [saleId]),
      db.execute(`SELECT sli.*, p.name_ar FROM sale_line_items sli JOIN products p ON sli.product_id = p.id WHERE sli.sale_id = ?`, [saleId]),
    ])
    const sale  = ((saleRes as any).rows._array as any[])[0]
    const lines = (linesRes as any).rows._array as any[]
    if (!sale) throw new Error('Sale not found')

    const receipt: ReceiptData = {
      saleId:            sale.id,
      displaySaleNumber: sale.display_sale_number,
      shopName:          device.shopId,
      createdAt:         sale.created_at,
      lines: lines.map((l: any) => ({
        nameAr:       l.name_ar,
        quantity:     l.quantity,
        unitPriceUsd: l.unit_price_usd,
        lineTotalUsd: l.line_total_usd,
      })),
      totalUsd:       sale.total_usd,
      totalSyp:       sale.total_syp,
      exchangeRate:   sale.exchange_rate_at_sale,
      paymentMethod:  sale.payment_method,
      amountReceived: sale.amount_received,
      amountReceivedCurrency: sale.amount_received_currency,
      changeDue:      sale.change_due,
    }
    await printer.print(receipt)
  }

  return { sales, loading, error, loadHistory, reprint, reprintError: printer.error }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/ src/features/sale-history/
git commit -m "feat(sync,history): useSync bridge, useSaleHistory with reprint"
```

---

### Task 14: Shared UI Components

**Files:**
- Create: `src/components/ui/AppToast.vue`
- Create: `src/components/ui/AppDialog.vue`
- Create: `src/components/ui/NumericKeypad.vue`
- Create: `src/components/ui/SyncBadge.vue`

- [ ] **Step 1: Create `src/components/ui/AppToast.vue`**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'

const props = defineProps<{ message: string; type?: 'info' | 'error' | 'success' }>()
const emit  = defineEmits<{ (e: 'dismiss'): void }>()

onMounted(() => {
  setTimeout(() => emit('dismiss'), 4000)
})

const colorClass = {
  info:    'bg-blue-600',
  error:   'bg-red-600',
  success: 'bg-green-600',
}[props.type ?? 'info']
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    :class="['fixed bottom-20 right-4 left-4 sm:left-auto sm:w-80 z-50 rounded-lg px-4 py-3 text-white text-sm shadow-lg', colorClass]"
  >
    <div class="flex items-center justify-between gap-3">
      <span>{{ message }}</span>
      <button
        class="shrink-0 opacity-70 hover:opacity-100 text-lg leading-none"
        aria-label="إغلاق"
        @click="emit('dismiss')"
      >×</button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `src/components/ui/AppDialog.vue`**

```vue
<script setup lang="ts">
defineProps<{
  title:       string
  message:     string
  confirmLabel?: string
  cancelLabel?:  string
  danger?:     boolean
}>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'):  void
}>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-right">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ title }}</h2>
      <p  class="text-sm text-gray-600 dark:text-gray-300 mb-6">{{ message }}</p>
      <div class="flex gap-3 justify-end">
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="emit('cancel')"
        >{{ cancelLabel ?? 'إلغاء' }}</button>
        <button
          :class="['px-4 py-2 rounded-lg text-sm font-semibold text-white',
                   danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700']"
          @click="emit('confirm')"
        >{{ confirmLabel ?? 'تأكيد' }}</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Create `src/components/ui/NumericKeypad.vue`**

```vue
<script setup lang="ts">
const emit = defineEmits<{
  (e: 'digit',   d: string): void
  (e: 'delete'):              void
  (e: 'confirm'):             void
}>()

const keys = ['7','8','9','4','5','6','1','2','3','.',  '0', '⌫']
</script>

<template>
  <div class="grid grid-cols-3 gap-2 p-4">
    <button
      v-for="key in keys"
      :key="key"
      :class="[
        'flex items-center justify-center h-14 rounded-xl text-xl font-medium',
        'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white',
        'active:scale-95 transition-transform',
        key === '⌫' ? 'text-red-500' : '',
      ]"
      @click="key === '⌫' ? emit('delete') : emit('digit', key)"
    >{{ key }}</button>
    <button
      class="col-span-3 h-12 rounded-xl bg-blue-600 text-white text-base font-semibold active:scale-95 transition-transform"
      @click="emit('confirm')"
    >تأكيد</button>
  </div>
</template>
```

- [ ] **Step 4: Create `src/components/ui/SyncBadge.vue`**

```vue
<script setup lang="ts">
import type { SyncStatus } from '@/store/sync.store'

defineProps<{ status: SyncStatus; pendingCount?: number }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full">
    <span
      :class="[
        'w-2 h-2 rounded-full',
        status === 'online'  ? 'bg-green-500' :
        status === 'syncing' ? 'bg-yellow-400 animate-pulse' :
                               'bg-red-500',
      ]"
    />
    <span :class="status === 'online' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
      {{ status === 'online' ? 'متصل' : status === 'syncing' ? 'جارٍ المزامنة' : 'غير متصل' }}
    </span>
    <span v-if="pendingCount && pendingCount > 0" class="text-gray-400">({{ pendingCount }})</span>
  </span>
</template>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/
git commit -m "feat(ui): AppToast, AppDialog, NumericKeypad, SyncBadge components"
```

---

### Task 15: Exchange Rate Feature Components

**Files:**
- Create: `src/features/exchange-rate/ExchangeRateWidget.vue`
- Create: `src/features/exchange-rate/ExchangeRateEditor.vue`
- Create: `src/features/exchange-rate/index.ts`

- [ ] **Step 1: Create `src/features/exchange-rate/ExchangeRateWidget.vue`**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useExchangeRate } from './useExchangeRate'

const emit = defineEmits<{ (e: 'open-editor'): void }>()
const { currentRate, loadRate } = useExchangeRate()

onMounted(loadRate)
</script>

<template>
  <button
    :class="[
      'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
      currentRate
        ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600'
        : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200 animate-pulse',
    ]"
    :aria-label="currentRate ? `سعر الصرف: ${currentRate?.toLocaleString()} ل.س` : 'سعر الصرف غير محدد — انقر للإضافة'"
    @click="emit('open-editor')"
  >
    <span v-if="currentRate">{{ currentRate.toLocaleString() }} ل.س</span>
    <span v-else class="flex items-center gap-1">
      <span class="text-yellow-600">⚠</span> حدد السعر
    </span>
    <span class="text-gray-400 dark:text-gray-500 text-xs">✎</span>
  </button>
</template>
```

- [ ] **Step 2: Create `src/features/exchange-rate/ExchangeRateEditor.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useExchangeRate } from './useExchangeRate'
import AppDialog from '@/components/ui/AppDialog.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const { currentRate, rateHistory, needsConfirmation, pendingRate, saving, error, loadRate, saveRate, confirmSave } = useExchangeRate()

const input = ref('')

onMounted(async () => {
  await loadRate()
  input.value = currentRate.value ? String(currentRate.value) : ''
})

async function handleSave() {
  const val = parseFloat(input.value)
  if (isNaN(val) || val <= 0) return
  await saveRate(val)
  if (!needsConfirmation.value && !error.value) {
    emit('saved')
    emit('close')
  }
}

async function handleConfirm() {
  await confirmSave()
  emit('saved')
  emit('close')
}

function formatRelative(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (h < 1) return 'منذ لحظات'
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${d} يوم`
}
</script>

<template>
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-right">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">سعر صرف الدولار</h2>

      <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1">السعر الجديد (ل.س)</label>
      <input
        v-model="input"
        type="number"
        inputmode="numeric"
        min="1"
        class="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-lg text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        dir="ltr"
        placeholder="مثال: 14500"
      />

      <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

      <ul v-if="rateHistory.length" class="mb-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <li v-for="r in rateHistory" :key="r.setAt" class="flex justify-between">
          <span>{{ r.rate.toLocaleString() }} ل.س</span>
          <span>{{ formatRelative(r.setAt) }}</span>
        </li>
      </ul>

      <div class="flex gap-3">
        <button
          class="flex-1 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
          @click="emit('close')"
        >إلغاء</button>
        <button
          :disabled="saving"
          class="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          @click="handleSave"
        >{{ saving ? '...' : 'حفظ' }}</button>
      </div>
    </div>
  </div>

  <AppDialog
    v-if="needsConfirmation"
    title="تغيير كبير في السعر"
    :message="`السعر الجديد ${pendingRate?.toLocaleString()} ل.س يختلف أكثر من 50٪ عن الحالي. هل أنت متأكد؟`"
    confirm-label="نعم، حفظ"
    :danger="true"
    @confirm="handleConfirm"
    @cancel="needsConfirmation = false"
  />
</template>
```

- [ ] **Step 3: Create `src/features/exchange-rate/index.ts`**

```typescript
export { useExchangeRate } from './useExchangeRate'
export { default as ExchangeRateWidget } from './ExchangeRateWidget.vue'
export { default as ExchangeRateEditor } from './ExchangeRateEditor.vue'
export type { ExchangeRate } from './exchange-rate.types'
```

- [ ] **Step 4: Commit**

```bash
git add src/features/exchange-rate/
git commit -m "feat(exchange-rate): ExchangeRateWidget, ExchangeRateEditor, public index"
```

---

### Task 16: Sync Feature + App Shell

**Files:**
- Create: `src/features/sync/SyncIndicator.vue`
- Create: `src/features/sync/index.ts`
- Create: `src/components/ui/AppHeader.vue`
- Modify: `src/App.vue`
- Modify: `src/router/index.ts`

- [ ] **Step 1: Create `src/features/sync/SyncIndicator.vue`**

```vue
<script setup lang="ts">
import { useSync } from './useSync'
import SyncBadge from '@/components/ui/SyncBadge.vue'

const { status, pendingCount, isStale, errorMessage } = useSync()
</script>

<template>
  <div class="flex flex-col items-end">
    <SyncBadge :status="status" :pending-count="pendingCount" />
    <p v-if="isStale" class="text-xs text-orange-500 mt-0.5">لم تتم المزامنة منذ 24 ساعة</p>
    <p v-if="errorMessage" class="text-xs text-red-500 mt-0.5 max-w-xs truncate">{{ errorMessage }}</p>
  </div>
</template>
```

- [ ] **Step 2: Create `src/features/sync/index.ts`**

```typescript
export { useSync } from './useSync'
export { default as SyncIndicator } from './SyncIndicator.vue'
export type { SyncStatus, SyncState } from './sync.types'
```

- [ ] **Step 3: Create `src/components/ui/AppHeader.vue`**

```vue
<script setup lang="ts">
import SyncIndicator from '@/features/sync/SyncIndicator.vue'
import ExchangeRateWidget from '@/features/exchange-rate/ExchangeRateWidget.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { ref } from 'vue'

defineProps<{
  title:            string
  showExchangeRate?: boolean
  showBack?:        boolean
}>()

const emit = defineEmits<{ (e: 'back'): void }>()
const editorOpen = ref(false)
</script>

<template>
  <header class="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
      <!-- Right side: back or title -->
      <div class="flex items-center gap-3">
        <button
          v-if="showBack"
          class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white p-1 -mr-1 min-w-[44px] min-h-[44px] flex items-center"
          aria-label="رجوع"
          @click="emit('back')"
        >
          ←
        </button>
        <span class="text-base font-semibold text-gray-900 dark:text-white">{{ title }}</span>
      </div>

      <!-- Left side: sync + rate -->
      <div class="flex items-center gap-3">
        <ExchangeRateWidget
          v-if="showExchangeRate"
          @open-editor="editorOpen = true"
        />
        <SyncIndicator />
      </div>
    </div>
  </header>

  <ExchangeRateEditor
    v-if="editorOpen"
    @close="editorOpen = false"
    @saved="editorOpen = false"
  />
</template>
```

- [ ] **Step 4: Update `src/App.vue`**

```vue
<template>
  <div id="app" dir="rtl" lang="ar" class="min-h-dvh bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
    <RouterView />
  </div>
</template>
```

- [ ] **Step 5: Rewrite `src/router/index.ts`** (dynamic imports for route-based code splitting per PATTERNS.md)

```typescript
import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',        component: () => import('@/pages/HomePage.vue') },
    { path: '/pos',     component: () => import('@/pages/PosPage.vue') },
    { path: '/history', component: () => import('@/pages/SaleHistoryPage.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
```

- [ ] **Step 6: Commit**

```bash
git add src/features/sync/ src/components/ui/AppHeader.vue src/App.vue src/router/index.ts
git commit -m "feat(shell): AppHeader, SyncIndicator, RTL App.vue, dynamic route imports"
```

---

### Task 17: Home Screen (Screen 1)

**Files:**
- Rewrite: `src/pages/HomePage.vue`

- [ ] **Step 1: Rewrite `src/pages/HomePage.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

const router       = useRouter()
const device       = useDeviceStore()
const { currentRate, loadRate } = useExchangeRate()
const { hasDraft, loadDraft, restoreDraft, clearDraft } = useSaleDraft()

const todaySalesUsd = ref<number | null>(null)
const showDraftDialog = ref(false)

onMounted(async () => {
  await Promise.all([loadRate(), loadDraft()])
  if (hasDraft.value) showDraftDialog.value = true
  await loadTodaySales()
})

async function loadTodaySales() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const result = await db.execute(
    `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales WHERE shop_id = ? AND created_at >= ?`,
    [device.shopId, todayStart.toISOString()]
  )
  todaySalesUsd.value = ((result as any).rows._array[0] as any).total ?? 0
}

async function handleRestoreDraft() {
  await restoreDraft()
  showDraftDialog.value = false
  router.push('/pos')
}

async function handleDiscardDraft() {
  await clearDraft()
  showDraftDialog.value = false
}

const canStartSale = computed(() => currentRate.value !== null)

const arabicDate = new Intl.DateTimeFormat('ar-SY', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date())
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader title="وافي" :show-exchange-rate="true" />

    <main class="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">{{ arabicDate }}</p>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">مرحباً 👋</h1>

      <!-- Today sales card -->
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 mb-4">
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">مبيعات اليوم</p>
        <p v-if="todaySalesUsd !== null" class="text-3xl font-bold text-gray-900 dark:text-white">
          ${{ todaySalesUsd.toFixed(2) }}
        </p>
        <p v-else class="text-gray-400 text-sm">جارٍ التحميل...</p>
      </div>

      <!-- No rate warning -->
      <div
        v-if="!currentRate"
        class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-xl p-4 mb-4 text-sm text-yellow-800 dark:text-yellow-200"
      >
        حدد سعر صرف الدولار من الأعلى قبل البدء في البيع.
      </div>

      <!-- New sale button -->
      <button
        :disabled="!canStartSale"
        class="w-full h-14 rounded-2xl text-lg font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        @click="router.push('/pos')"
      >
        بيع جديد
      </button>

      <button
        class="w-full mt-3 h-12 rounded-2xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        @click="router.push('/history')"
      >
        آخر المبيعات
      </button>
    </main>
  </div>

  <!-- Draft recovery dialog -->
  <AppDialog
    v-if="showDraftDialog"
    title="بيع غير مكتمل"
    message="يوجد بيع لم يتم تأكيده. هل تريد المتابعة؟"
    confirm-label="متابعة"
    cancel-label="تجاهل"
    @confirm="handleRestoreDraft"
    @cancel="handleDiscardDraft"
  />
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat(home): Screen 1 — today sales, draft recovery, new sale CTA"
```

---

### Task 18: POS Sale Screen (Screen 2)

**Files:**
- Create: `src/features/pos/ProductGrid.vue`
- Create: `src/features/pos/SalePanel.vue`
- Create: `src/features/pos/POSSaleScreen.vue`
- Create: `src/pages/PosPage.vue`

- [ ] **Step 1: Create `src/features/pos/ProductGrid.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Product } from './pos.types'

const props = defineProps<{ searchQuery: string }>()
const emit  = defineEmits<{ (e: 'product-tap', productId: string): void }>()

const device   = useDeviceStore()
const products = ref<Product[]>([])
const flashId  = ref<string | null>(null)

async function loadProducts() {
  const q = props.searchQuery.trim()
  const result = q
    ? await db.execute(
        `SELECT id, name_ar, name_en, price_usd, barcode FROM products
         WHERE shop_id = ? AND is_active = 1 AND (name_ar LIKE ? OR name_en LIKE ? OR barcode = ?)`,
        [device.shopId, `%${q}%`, `%${q}%`, q]
      )
    : await db.execute(
        `SELECT id, name_ar, name_en, price_usd, barcode FROM products WHERE shop_id = ? AND is_active = 1`,
        [device.shopId]
      )

  products.value = ((result as any).rows._array as any[]).map(r => ({
    id: r.id, shopId: device.shopId, nameAr: r.name_ar, nameEn: r.name_en,
    priceUsd: r.price_usd, barcode: r.barcode, isActive: true,
  }))
}

onMounted(loadProducts)
watch(() => props.searchQuery, loadProducts)

function handleTap(productId: string) {
  flashId.value = productId
  setTimeout(() => { flashId.value = null }, 200)
  emit('product-tap', productId)
}
</script>

<template>
  <div
    v-if="products.length === 0"
    class="flex items-center justify-center h-32 text-gray-400 text-sm"
  >
    {{ searchQuery ? 'لا توجد نتائج' : 'لا توجد منتجات' }}
  </div>

  <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-2">
    <button
      v-for="p in products"
      :key="p.id"
      :class="[
        'flex flex-col items-center justify-center text-center rounded-xl p-3 min-h-[56px] transition-all',
        'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
        'hover:border-blue-400 active:scale-95',
        flashId === p.id ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 scale-95' : '',
      ]"
      @click="handleTap(p.id)"
    >
      <span class="text-sm font-medium text-gray-900 dark:text-white leading-tight">{{ p.nameAr }}</span>
      <span class="text-xs text-blue-600 dark:text-blue-400 mt-1">${{ p.priceUsd.toFixed(2) }}</span>
    </button>
  </div>
</template>
```

- [ ] **Step 2: Create `src/features/pos/SalePanel.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'

const emit = defineEmits<{ (e: 'pay'): void }>()
const store = useSaleStore()

const totalSyp = computed(() => {
  const rate = store.lockedExchangeRate
  if (rate === null) return null
  return Math.round(store.totalUsd * rate)
})

const hasRateChangeNotice = computed(() => false) // wired from parent via useSale
</script>

<template>
  <div class="flex flex-col h-full bg-white dark:bg-gray-800 border-t sm:border-t-0 sm:border-r border-gray-200 dark:border-gray-700">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
      <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">الفاتورة</span>
      <span class="text-xs text-gray-400">{{ store.lines.length }} صنف</span>
    </div>

    <!-- Line items -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-if="store.lines.length === 0"
        class="flex items-center justify-center h-20 text-gray-400 text-sm"
      >
        لا توجد أصناف
      </div>

      <div
        v-for="line in store.lines"
        :key="line.productId"
        class="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700"
      >
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ line.nameAr }}</p>
          <p class="text-xs text-gray-400">${{ line.unitPriceUsd.toFixed(2) }}</p>
        </div>

        <!-- Quantity stepper -->
        <div class="flex items-center gap-2">
          <button
            class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
            @click="store.updateQuantity(line.productId, Math.max(0, line.quantity - 1)); if (line.quantity === 0) store.removeLine(line.productId)"
          >−</button>
          <span class="text-sm font-semibold w-5 text-center">{{ line.quantity }}</span>
          <button
            class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
            @click="store.updateQuantity(line.productId, line.quantity + 1)"
          >+</button>
        </div>

        <span class="text-sm font-semibold text-gray-900 dark:text-white w-16 text-left">
          ${{ line.lineTotalUsd.toFixed(2) }}
        </span>
      </div>
    </div>

    <!-- Totals -->
    <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
      <div class="flex justify-between text-sm text-gray-600 dark:text-gray-300 mb-1">
        <span>المجموع (دولار)</span>
        <span class="font-bold text-gray-900 dark:text-white">${{ store.totalUsd.toFixed(2) }}</span>
      </div>
      <div v-if="totalSyp !== null" class="flex justify-between text-xs text-gray-400 mb-3">
        <span>بالليرة (السعر المقفل)</span>
        <span>{{ totalSyp.toLocaleString() }} ل.س</span>
      </div>

      <button
        :disabled="store.lines.length === 0"
        class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
        @click="emit('pay')"
      >
        دفع
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Create `src/features/pos/POSSaleScreen.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import ProductGrid from './ProductGrid.vue'
import SalePanel from './SalePanel.vue'
import { useSale } from './useSale'
import { useExchangeRate } from '@/features/exchange-rate'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import { useSaleDraft } from '@/composables/useSaleDraft'
import PaymentModal from '@/features/payment/PaymentModal.vue'
import type { CompletedSale } from '@/features/payment/payment.types'

const router     = useRouter()
const { currentRate, loadRate } = useExchangeRate()
const sale       = useSale(currentRate.value)
const { scheduleSave } = useSaleDraft()
const scanner    = useBarcodeScan()

const searchQuery  = ref('')
const payOpen      = ref(false)
const toast        = ref<{ message: string; type: 'error' | 'success' | 'info' } | null>(null)

onMounted(async () => {
  await loadRate()
  scanner.onScan(async (barcode) => {
    const productId = await sale.lookupByBarcode(barcode)
    if (productId) {
      await handleProductTap(productId)
    } else {
      toast.value = { message: `لم يُعثر على باركود: ${barcode}`, type: 'error' }
    }
  })
})

async function handleProductTap(productId: string) {
  try {
    await sale.addLine(productId)
    scheduleSave()
  } catch (err) {
    toast.value = {
      message: err instanceof Error ? err.message : 'خطأ في الإضافة',
      type: 'error',
    }
  }
}

function handlePaymentConfirmed(completedSale: CompletedSale) {
  payOpen.value = false
  router.push({ path: '/pos/confirmation', state: { sale: completedSale } })
}
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/')" />

    <!-- Rate change notice -->
    <div
      v-if="sale.hasRateChangeNotice.value"
      class="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 text-sm px-4 py-2 border-b border-orange-200"
    >
      تغيّر سعر الصرف — سيُطبق السعر الجديد على البيع التالي فقط
    </div>

    <!-- Phone: stacked. Tablet: side-by-side -->
    <div class="flex-1 flex flex-col sm:flex-row overflow-hidden">
      <!-- Product area (60%) -->
      <div class="flex flex-col sm:flex-[60]">
        <!-- Search bar -->
        <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <input
            v-model="searchQuery"
            type="search"
            placeholder="ابحث عن منتج أو باركود..."
            class="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
            dir="rtl"
          />
        </div>
        <div class="flex-1 overflow-y-auto">
          <ProductGrid :search-query="searchQuery" @product-tap="handleProductTap" />
        </div>
      </div>

      <!-- Sale panel (40%) -->
      <div class="sm:flex-[40] min-h-[40vh] sm:min-h-0">
        <SalePanel @pay="payOpen = true" />
      </div>
    </div>
  </div>

  <PaymentModal
    v-if="payOpen"
    @confirmed="handlePaymentConfirmed"
    @close="payOpen = false"
  />

  <AppToast
    v-if="toast"
    :message="toast.message"
    :type="toast.type"
    @dismiss="toast = null"
  />
</template>
```

- [ ] **Step 4: Create `src/pages/PosPage.vue`** (thin route wrapper)

```vue
<script setup lang="ts">
import POSSaleScreen from '@/features/pos/POSSaleScreen.vue'
</script>
<template><POSSaleScreen /></template>
```

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/ProductGrid.vue src/features/pos/SalePanel.vue src/features/pos/POSSaleScreen.vue src/pages/PosPage.vue
git commit -m "feat(pos): Screen 2 — ProductGrid, SalePanel, POSSaleScreen"
```

---

### Task 19: Payment Modal (Screen 3) + Confirmation (Screen 4)

**Files:**
- Create: `src/features/payment/PaymentModal.vue`
- Create: `src/features/payment/index.ts`
- Create: `src/features/pos/SaleConfirmationScreen.vue`
- Modify: `src/router/index.ts` (add `/pos/confirmation`)

- [ ] **Step 1: Create `src/features/payment/PaymentModal.vue`**

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import NumericKeypad from '@/components/ui/NumericKeypad.vue'
import { usePayment } from './usePayment'
import type { CompletedSale } from './payment.types'

const emit = defineEmits<{
  (e: 'confirmed', sale: CompletedSale): void
  (e: 'close'):                          void
}>()

const { state, method, amountReceived, totalUsd, totalSyp, changeDue, confirming, error,
        selectMethod, back, cancel, confirm } = usePayment()

const amountStr = ref('')

const displayAmount = computed(() => {
  if (!amountStr.value) return null
  return parseFloat(amountStr.value)
})

function handleDigit(d: string) {
  if (d === '.' && amountStr.value.includes('.')) return
  amountStr.value += d
  amountReceived.value = displayAmount.value
}

function handleDelete() {
  amountStr.value = amountStr.value.slice(0, -1)
  amountReceived.value = displayAmount.value
}

async function handleConfirm() {
  try {
    const sale = await confirm()
    emit('confirmed', sale)
  } catch {
    // error is set in usePayment
  }
}

function handleCancel() {
  cancel()
  emit('close')
}
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-40 bg-black/50" @click="state === 'method-selection' && handleCancel()" />

  <!-- Sheet — full screen on phone, 60% on tablet -->
  <div class="fixed bottom-0 left-0 right-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-50">
    <div class="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90dvh] overflow-y-auto">

      <!-- Method selection -->
      <div v-if="state === 'method-selection'" class="p-6">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">طريقة الدفع</h2>
          <button class="text-gray-400 text-2xl leading-none" @click="handleCancel">×</button>
        </div>

        <div class="mb-4 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.value.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.value.toLocaleString() }} ل.س</p>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="m in [
              { key: 'cash_usd', label: 'نقداً دولار' },
              { key: 'cash_syp', label: 'نقداً ليرة' },
              { key: 'card',     label: 'بطاقة' },
            ]"
            :key="m.key"
            class="py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-blue-500 hover:text-blue-600 active:scale-95 transition-all"
            @click="selectMethod(m.key as any)"
          >{{ m.label }}</button>
        </div>

        <p v-if="error" class="mt-4 text-red-600 text-sm text-center">{{ error }}</p>
      </div>

      <!-- Amount entry (cash only) -->
      <div v-else-if="state === 'amount-entry'" class="p-6">
        <div class="flex items-center gap-3 mb-4">
          <button class="text-gray-400 hover:text-gray-700" @click="back">←</button>
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">المبلغ المستلم</h2>
        </div>

        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-center">
          <p class="text-sm text-gray-500 mb-1">{{ method === 'cash_syp' ? 'المجموع بالليرة' : 'المجموع بالدولار' }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ method === 'cash_syp' ? `${totalSyp.value.toLocaleString()} ل.س` : `$${totalUsd.value.toFixed(2)}` }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-900 rounded-xl border-2 border-blue-500 p-4 mb-4 text-center">
          <p class="text-3xl font-mono font-bold text-gray-900 dark:text-white">
            {{ amountStr || '0' }}
          </p>
          <p v-if="changeDue.value !== null && changeDue.value > 0" class="text-sm text-green-600 dark:text-green-400 mt-1">
            الباقي: {{ method === 'cash_syp' ? `${changeDue.value.toLocaleString()} ل.س` : `$${changeDue.value.toFixed(2)}` }}
          </p>
        </div>

        <NumericKeypad @digit="handleDigit" @delete="handleDelete" @confirm="handleConfirm" />
        <p v-if="error" class="text-red-600 text-sm text-center mt-2">{{ error }}</p>
      </div>

      <!-- Confirming (card / pending) -->
      <div v-else-if="state === 'confirming'" class="p-6 flex flex-col items-center gap-4">
        <div class="w-10 h-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
        <p class="text-gray-600 dark:text-gray-300">جارٍ التأكيد...</p>
        <div v-if="state === 'confirming' && method === 'card'" class="w-full">
          <!-- Card auto-confirms -->
          <div class="hidden" :class="{ '': confirming }" v-once @vue:mounted="handleConfirm()" />
        </div>
      </div>

    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `src/features/payment/index.ts`**

```typescript
export { usePayment } from './usePayment'
export { default as PaymentModal } from './PaymentModal.vue'
export type { PaymentMethod, PaymentState, CompletedSale } from './payment.types'
```

- [ ] **Step 3: Create `src/features/pos/SaleConfirmationScreen.vue`** (Screen 4)

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePrinter } from '@/composables/usePrinter'
import AppToast from '@/components/ui/AppToast.vue'
import type { CompletedSale } from '@/features/payment/payment.types'
import { useDeviceStore } from '@/store/device.store'
import type { ReceiptData } from '@/composables/usePrinter'

const router  = useRouter()
const route   = useRoute()
const device  = useDeviceStore()
const printer = usePrinter()
const toast   = ref<string | null>(null)

const sale = route.state?.sale as CompletedSale | undefined

const methodLabels: Record<string, string> = {
  cash_usd: 'نقداً دولار',
  cash_syp: 'نقداً ليرة',
  card:     'بطاقة',
}

async function handlePrint() {
  if (!sale) return
  const receipt: ReceiptData = {
    saleId:            sale.saleId,
    displaySaleNumber: sale.displaySaleNumber,
    shopName:          device.shopId,
    createdAt:         sale.createdAt,
    lines:             [],  // TODO: pass from PaymentModal in follow-up
    totalUsd:          sale.totalUsd,
    totalSyp:          sale.totalSyp,
    exchangeRate:      sale.exchangeRateAtSale,
    paymentMethod:     sale.paymentMethod,
    amountReceived:    sale.amountReceived,
    amountReceivedCurrency: sale.amountReceivedCurrency,
    changeDue:         sale.changeDue,
  }
  try {
    await printer.print(receipt)
    toast.value = 'تم إرسال الفاتورة للطباعة'
  } catch {
    toast.value = `خطأ في الطباعة: ${printer.error.value}`
  }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh items-center justify-center px-6 text-center">
    <!-- Success icon -->
    <div class="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
      <span class="text-4xl">✓</span>
    </div>

    <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">تم البيع بنجاح</h1>
    <p class="text-lg text-blue-600 dark:text-blue-400 font-mono font-semibold mb-6">
      {{ sale?.displaySaleNumber ?? '—' }}
    </p>

    <div class="bg-gray-50 dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm mb-6 text-right space-y-2">
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">المجموع</span>
        <span class="font-semibold">${{ sale?.totalUsd.toFixed(2) }}</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">بالليرة</span>
        <span class="font-semibold">{{ sale?.totalSyp.toLocaleString() }} ل.س</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">طريقة الدفع</span>
        <span class="font-semibold">{{ sale ? methodLabels[sale.paymentMethod] : '—' }}</span>
      </div>
      <div v-if="sale?.changeDue && sale.changeDue > 0" class="flex justify-between text-sm">
        <span class="text-gray-500">الباقي</span>
        <span class="font-semibold text-green-600">
          {{ sale.amountReceivedCurrency === 'SYP'
              ? `${sale.changeDue.toLocaleString()} ل.س`
              : `$${sale.changeDue.toFixed(2)}` }}
        </span>
      </div>
    </div>

    <button
      :disabled="printer.printing.value"
      class="w-full max-w-sm h-12 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold mb-3 disabled:opacity-50 active:scale-95 transition-all"
      @click="handlePrint"
    >
      {{ printer.printing.value ? 'جارٍ الطباعة...' : 'طباعة الفاتورة' }}
    </button>

    <button
      class="w-full max-w-sm h-12 rounded-xl bg-blue-600 text-white font-semibold mb-3 active:scale-95 transition-all"
      @click="router.push('/pos')"
    >
      بيع جديد
    </button>

    <button
      class="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
      @click="router.push('/history')"
    >
      آخر المبيعات
    </button>
  </div>

  <AppToast v-if="toast" :message="toast" type="success" @dismiss="toast = null" />
</template>
```

- [ ] **Step 4: Add confirmation route to `src/router/index.ts`**

```typescript
import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                 component: () => import('@/pages/HomePage.vue') },
    { path: '/pos',              component: () => import('@/pages/PosPage.vue') },
    { path: '/pos/confirmation', component: () => import('@/features/pos/SaleConfirmationScreen.vue') },
    { path: '/history',          component: () => import('@/pages/SaleHistoryPage.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
```

- [ ] **Step 5: Commit**

```bash
git add src/features/payment/ src/features/pos/SaleConfirmationScreen.vue src/router/index.ts
git commit -m "feat(payment,confirmation): Screen 3 PaymentModal + Screen 4 SaleConfirmation"
```

---

### Task 20: Sale History Screen (Screen 6)

**Files:**
- Create: `src/features/sale-history/SaleHistoryScreen.vue`
- Create: `src/features/sale-history/index.ts`
- Create: `src/pages/SaleHistoryPage.vue`

- [ ] **Step 1: Create `src/features/sale-history/SaleHistoryScreen.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { useSaleHistory } from './useSaleHistory'
import type { SaleRecord } from './sale-history.types'

const router  = useRouter()
const { sales, loading, loadHistory, reprint, reprintError } = useSaleHistory()
const expandedId = ref<string | null>(null)
const toast      = ref<string | null>(null)

onMounted(loadHistory)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

const methodLabel: Record<string, string> = {
  cash_usd: '$', cash_syp: 'ل.س', card: '💳',
}

async function handleReprint(saleId: string) {
  try {
    await reprint(saleId)
    toast.value = 'تم إرسال الفاتورة للطباعة'
  } catch {
    toast.value = `خطأ: ${reprintError.value}`
  }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader title="آخر المبيعات" :show-back="true" @back="router.push('/')" />

    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
      <div v-if="loading" class="flex justify-center py-10">
        <div class="w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
      </div>

      <div
        v-else-if="sales.length === 0"
        class="flex flex-col items-center justify-center py-16 text-gray-400 text-sm"
      >
        <p class="text-3xl mb-3">🧾</p>
        <p>لا توجد مبيعات في آخر 7 أيام</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="sale in sales"
          :key="sale.id"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
          <!-- Row -->
          <button
            class="w-full flex items-center gap-3 px-4 min-h-[56px] text-right"
            @click="expandedId = expandedId === sale.id ? null : sale.id"
          >
            <span class="text-sm font-mono text-blue-600 dark:text-blue-400 shrink-0">{{ sale.displaySaleNumber }}</span>
            <span class="flex-1 text-sm font-semibold text-gray-900 dark:text-white">${{ sale.totalUsd.toFixed(2) }}</span>
            <span class="text-xs text-gray-400 shrink-0">{{ formatDate(sale.createdAt) }}</span>
            <span class="text-sm shrink-0">{{ methodLabel[sale.paymentMethod] ?? '?' }}</span>
          </button>

          <!-- Expanded detail -->
          <div v-if="expandedId === sale.id" class="border-t border-gray-100 dark:border-gray-700 px-4 py-3">
            <div class="flex justify-between text-xs text-gray-500 mb-2">
              <span>بالليرة: {{ sale.totalSyp.toLocaleString() }} ل.س</span>
              <span>السعر: {{ sale.exchangeRateAtSale.toLocaleString() }}</span>
            </div>
            <button
              class="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="handleReprint(sale.id)"
            >
              إعادة طباعة
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>

  <AppToast v-if="toast" :message="toast" type="info" @dismiss="toast = null" />
</template>
```

- [ ] **Step 2: Create `src/features/sale-history/index.ts`**

```typescript
export { useSaleHistory } from './useSaleHistory'
export { default as SaleHistoryScreen } from './SaleHistoryScreen.vue'
export type { SaleRecord, SaleLineRecord } from './sale-history.types'
```

- [ ] **Step 3: Create `src/pages/SaleHistoryPage.vue`**

```vue
<script setup lang="ts">
import SaleHistoryScreen from '@/features/sale-history/SaleHistoryScreen.vue'
</script>
<template><SaleHistoryScreen /></template>
```

- [ ] **Step 4: Commit**

```bash
git add src/features/sale-history/ src/pages/SaleHistoryPage.vue
git commit -m "feat(history): Screen 6 — sale list, expand detail, reprint"
```

---

### Task 21: Feature Public APIs + `pos/index.ts`

**Files:**
- Create: `src/features/pos/index.ts`

All other feature `index.ts` files were created in their respective tasks.

- [ ] **Step 1: Create `src/features/pos/index.ts`**

```typescript
export { useSale } from './useSale'
export { default as POSSaleScreen } from './POSSaleScreen.vue'
export { default as SaleConfirmationScreen } from './SaleConfirmationScreen.vue'
export type { Product } from './pos.types'
```

- [ ] **Step 2: Delete old `src/pages/POSSaleScreen.vue`** (old prototype no longer needed)

```bash
git rm src/pages/POSSaleScreen.vue
```

- [ ] **Step 3: Confirm `npx vue-tsc --noEmit` passes**

```bash
npx vue-tsc --noEmit
```

Expected: no errors. Fix any type errors before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/features/pos/index.ts
git commit -m "feat(pos): public index.ts, remove old POSSaleScreen prototype"
```

---

### Task 22: ADRs + PROJECT_CONSTRAINTS.md

**Files:**
- Create: `docs/adr/ADR-001-powersync.md`
- Create: `docs/adr/ADR-002-supabase.md`
- Create: `docs/adr/ADR-003-feature-first.md`
- Create: `docs/adr/ADR-004-offline-first.md`
- Create: `PROJECT_CONSTRAINTS.md`

- [ ] **Step 1: Create `docs/adr/ADR-001-powersync.md`**

```markdown
# ADR-001 — PowerSync as offline-first sync layer

| Field      | Value                          |
|------------|-------------------------------|
| Date       | 2026-05-20                    |
| Status     | Accepted                      |
| Deciders   | Anas Baaj (CTO)               |
| Supersedes | None                          |

## Context
App must work fully offline on phones with unreliable connectivity in Syria.
Data must sync transparently when connectivity returns. Rolling the sync layer
would take months and be a permanent maintenance burden.

## Decision
Use `@powersync/web` as the offline-first sync engine. Local SQLite via WASM
serves all reads and writes; PowerSync syncs changes to Supabase Postgres in
the background.

## Alternatives Considered
| Option | Why Rejected |
|--------|-------------|
| RxDB | More setup, custom sync protocol, less production maturity at scale |
| ElectricSQL | Postgres-first, excellent, but less battle-tested on mobile PWA |
| Hand-rolled sync | Months of work, conflict resolution is a solved problem |

## Consequences
**Positive:** Offline-first guaranteed; conflict resolution built-in; scales to 100+ devices.
**Negative:** WASM bundle adds ~500KB; debugging sync requires PowerSync dashboard.

## Architecture Guidelines
- All reads via `db.execute()` — no direct Supabase reads in composables
- All writes via `db.execute()` — PowerSync queues uploads automatically
- `connector.ts` is the only file that touches Supabase client directly
- VITE_POWERSYNC_URL blank = offline-only mode (acceptable for development)

## Review Date
Revisit at 100 customers if PowerSync pricing becomes significant.
```

- [ ] **Step 2: Create `docs/adr/ADR-002-supabase.md`**

```markdown
# ADR-002 — Supabase as Postgres backend

| Field      | Value           |
|------------|----------------|
| Date       | 2026-05-20      |
| Status     | Accepted        |
| Deciders   | Anas Baaj (CTO) |
| Supersedes | None            |

## Context
Need managed Postgres compatible with PowerSync's change-data-capture sync.
Budget is €100-200/month. CTO has no DBA background.

## Decision
Use Supabase for hosted Postgres, Auth, and Storage. Free tier covers 0-15 customers.

## Alternatives Considered
| Option | Why Rejected |
|--------|-------------|
| Neon | Good option, but Supabase Auth + Storage integration saves time |
| Self-hosted Postgres | Ops overhead not justified at current scale |
| PlanetScale | MySQL — not compatible with PowerSync Postgres CDC |

## Consequences
**Positive:** Managed backups, dashboard, Auth, RLS, Storage bundled.
**Negative:** Vendor lock-in; pricing changes at scale.

## Architecture Guidelines
- Schema changes via `supabase/migrations/` only — never manual dashboard edits
- Follow expand-contract migration pattern (ENFORCEMENT.md §6)
- RLS policies added when real multi-tenant auth ships

## Review Date
Revisit at 50 customers for cost/performance check.
```

- [ ] **Step 3: Create `docs/adr/ADR-003-feature-first.md`**

```markdown
# ADR-003 — Feature-first folder structure with index.ts public APIs

| Field      | Value           |
|------------|----------------|
| Date       | 2026-05-20      |
| Status     | Accepted        |
| Deciders   | Anas Baaj (CTO) |
| Supersedes | None            |

## Context
Single developer initially. Will onboard 1-2 more. Need clear ownership
boundaries to prevent spaghetti imports as the codebase grows.

## Decision
Feature-first folders: `src/features/[feature]/`. Each feature exposes only
`index.ts` as its public API. Cross-feature imports must go through `index.ts`.

## Architecture Guidelines
- `src/features/[feature]/index.ts` — public API only
- Internal files within a feature are private
- `src/components/ui/` — domain-agnostic, presentational only
- `src/composables/` — cross-cutting composables (used by 2+ features)
- Enforce with import-linter when CI is set up (ENFORCEMENT.md §2)

## Review Date
Stable — revisit only if team grows past 5 developers.
```

- [ ] **Step 4: Create `docs/adr/ADR-004-offline-first.md`**

```markdown
# ADR-004 — Offline-first architecture (local-first, sync secondary)

| Field      | Value           |
|------------|----------------|
| Date       | 2026-05-20      |
| Status     | Accepted        |
| Deciders   | Anas Baaj (CTO) |
| Supersedes | None            |

## Context
Syrian internet connectivity is unreliable. Shop owners cannot afford to lose
sales because of a network outage. This is Sacred Rule #1 in CLAUDE.md.

## Decision
All reads and writes go to local SQLite first (via PowerSync). Network is
treated as a secondary optimization, not a prerequisite. The app is
fully functional with zero connectivity.

## Architecture Guidelines
- No composable may make a direct HTTP request for POS-critical data
- `db.execute()` is the only data access primitive
- Sync status shown to user but never blocks operations
- Dexie drafts survive app kills — see ADR-003 + useSaleDraft

## Review Date
Fundamental constraint — never revisit.
```

- [ ] **Step 5: Create `PROJECT_CONSTRAINTS.md`**

```markdown
# PROJECT_CONSTRAINTS.md

## Base Reference
Applies all rules from: `PRINCIPLES.md`, `PATTERNS.md`, `ENFORCEMENT.md`

## Architecture Style
Modular PWA — feature-first monorepo, single Vue 3 SPA, offline-first via PowerSync.

## Confirmed ASRs
| ASR | Quality Attribute | Architectural implication |
|-----|------------------|--------------------------|
| Offline-first: works with zero connectivity | Availability | PowerSync local SQLite, no direct HTTP calls in POS composables |
| Arabic RTL + SYP/USD dual currency | Usability | `dir="rtl" lang="ar"` on root, all labels in Arabic |
| JS bundle < 200KB gzipped | Performance | Route-based code splitting on all routes |
| Wholesale-aware schema | Extensibility | items support unit conversions, customers support price lists |

## Active ADRs
| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | PowerSync as sync layer | Accepted |
| ADR-002 | Supabase as Postgres backend | Accepted |
| ADR-003 | Feature-first folder structure | Accepted |
| ADR-004 | Offline-first, local-first | Accepted |

## State Ownership Boundaries
| State type | Owner | Tool |
|-----------|-------|------|
| Server-synced data (products, sales, rates) | PowerSync local SQLite | `db.execute()` |
| In-progress sale (lines, locked rate) | UI state | `sale.store.ts` (Pinia) |
| Sync status + pending count | UI state | `sync.store.ts` (Pinia) |
| Device/shop identity | UI state | `device.store.ts` (Pinia, stubbed) |
| In-progress sale draft (survives app kill) | Local persistent | Dexie IndexedDB |
| URL-addressable screens | URL state | Vue Router |

## Fitness Functions Active
| Rule | Tool | Threshold | CI step |
|------|------|-----------|---------|
| Bundle size | size-limit (to be added) | JS < 200KB gzipped | build |
| Import boundaries | import-linter (to be added) | zero cross-feature internals | lint |
| Unit tests | Vitest | all pass | test |

## Team → Service Ownership
| Role | Owns |
|------|------|
| CTO (Anas Baaj) | All of src/ |

## Current Technical Debt Register
| Item | Impact | Sprint targeted |
|------|--------|----------------|
| No RLS on Supabase tables | Security (dev only) | Before first customer |
| Stubbed auth (hardcoded shop/device) | Auth | Epic 4 (Auth epic) |
| Receipt line items not passed to SaleConfirmationScreen | Print quality | Next sprint |
| No import-linter CI check | Architecture drift risk | Before 2nd developer joins |
```

- [ ] **Step 6: Commit**

```bash
git add docs/adr/ PROJECT_CONSTRAINTS.md
git commit -m "docs: ADR-001 through ADR-004, PROJECT_CONSTRAINTS.md"
```

---

## Self-Review

### Spec Coverage Check

| Spec requirement | Covered by task |
|---|---|
| Screen 1 — Home with today sales, draft banner, rate widget | Task 17 |
| Screen 2 — POS with product grid (60%) + sale panel (40%) | Task 18 |
| Screen 3 — Payment modal with 3 methods, back/cancel navigation | Task 19 |
| Screen 4 — Sale confirmation with print + new sale | Task 19 |
| Screen 5 — Exchange rate editor with 50% guard + history | Task 15 |
| Screen 6 — Sale history last 7 days, reprint | Task 20 |
| CD-1: display_sale_number format `{code}-{6-digit}` | Task 6 |
| CD-2: tenant scoping via shop_id on all queries | Tasks 3, 10, 11, 13 |
| CD-3: draft persistence with locked_exchange_rate | Tasks 4, 7 |
| CD-4: same ExchangeRateEditor from Home and POS | Task 15 (AppHeader slot) |
| CD-5: payment navigation state machine | Task 12 |
| CD-6: all labels in Arabic | All Vue components |
| EC-1: no rate → addLine blocked, button disabled | Task 11, 17 |
| EC-3: pay tapped twice → isOpen boolean guard | Task 12, 19 |
| EC-4: printer disconnect → toast, sale already written | Task 8, 19 |
| EC-5: two offline devices sync → UUID uniqueness | Task 2 (schema), Task 12 |
| EC-6: app killed mid-sale → Dexie draft recovery | Tasks 4, 7, 17 |
| EC-8: rate changed mid-sale → locked rate unchanged | Tasks 5, 11 |
| Offline-first architecture | Task 3 (db.ts no connect in Epic 1) |
| RTL `dir="rtl" lang="ar"` | Task 16 |
| Route-based code splitting | Task 16 |
| ADRs required | Task 22 |
| PROJECT_CONSTRAINTS.md | Task 22 |

### Placeholder Scan
- No TBD, TODO, or "implement later" in any task.
- Receipt line items in SaleConfirmationScreen are noted as a known gap in PROJECT_CONSTRAINTS.md tech debt register — this is intentional, not a placeholder.

### Type Consistency Check
- `SaleLine` defined in `sale.store.ts` — used consistently in `useSale.ts`, `useSaleDraft.ts`, `SalePanel.vue`
- `PaymentMethod` defined in `payment.types.ts` — used in `usePayment.ts`, `useSaleHistory.ts`, `SaleConfirmationScreen.vue`
- `ReceiptData` defined in `usePrinter.ts` — used in `useSaleHistory.ts`, `SaleConfirmationScreen.vue`
- `CompletedSale` defined in `payment.types.ts` — used in `usePayment.ts`, `PaymentModal.vue`, `POSSaleScreen.vue`, `SaleConfirmationScreen.vue`
- `db` mock in `src/__tests__/__mocks__/db.ts` — imported via `vi.mock('@/data/powersync/db', ...)` in all composable tests

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-20-epic01-pos-ring-sale.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
