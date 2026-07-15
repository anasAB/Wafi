# Installment Plans (التقسيط) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier sell an item on a structured installment plan (down payment + fixed term + schedule), collect each due against that schedule, and remind customers via WhatsApp — reusing Epic 4's customer ledger, payment recording, and WhatsApp plumbing rather than duplicating it.

**Architecture:** Two new synced tables (`installment_plans`, `installment_dues`) plus a nullable `due_id` tag on the existing `customer_payments` table. A new `installments` feature folder holds the pure schedule generator, the plan/due composable, and the dashboard-alert composable. The existing POS payment flow (`usePayment.ts`/`PaymentModal.vue`) gains a fourth "installment" method that behaves like the existing "credit" (آجل) method at the `sales` row level (`is_credit = 1`, unpaid at sale time) but additionally creates the plan + schedule immediately after the sale commits. The down payment and every later due collection post through the existing `customer_payments` table/composable, so the customer's ledger balance, statement, and Z-report cash-drawer attribution all pick up installment activity for free with zero changes to that existing code.

**Tech Stack:** Vue 3 `<script setup>`, Pinia stores, PowerSync `db` (offline-first SQLite synced to Supabase Postgres), `wa.me` WhatsApp deep links, Vitest.

## Global Constraints

- **Offline-first.** Every new write goes through `db.writeTransaction`/`db.execute` against the local PowerSync SQLite db with `sync_status = 'pending'` where the table has that column, never blocking on network.
- **Arabic RTL, plain-language.** All new UI is `dir="rtl"`, shop-owner language, matching the existing product voice (e.g. "دفعة أولى", "أقساط مستحقة" — not "installment" or "principal").
- **Dual currency internals, USD ledger.** `installment_plans`/`installment_dues` amounts are USD-internal, matching every other ledger table (`customer_payments`, `sales`) in this schema — SYP is a display concern only, computed via the shared exchange rate where shown.
- **Reuse, don't duplicate.** The down payment and per-due collections MUST go through the existing `customer_payments` table (same columns, same Z-report attribution) — no new "installment payment" ledger.
- **`due_id`/`plan_id` etc. use snake_case in SQL and camelCase in TypeScript**, matching every existing composable's `rowToX` mapping convention in this codebase.
- **Build gate.** `npm run build` type-checks test files too — a TS error in any test blocks the whole build. Run `npm run build` before considering the plan done.
- **Tests.** Match this repo's existing convention exactly: `vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))` at the top of the test file, `setActivePinia(createPinia())` + `vi.clearAllMocks()` in `beforeEach`, assert SQL shape via `expect.stringContaining(...)` (not exact string match), and for `db.writeTransaction` mock via `vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn) => { await fn({ execute: txExecute }) })` and assert on the inner `txExecute` spy.
- **Out of scope for this plan** (per spec): automatic/unattended reminder push, late fees/penalty interest, credit scoring, multi-plan-per-sale, renegotiating an existing plan's schedule, AR aging integration.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/033_installment_plans.sql` | **Already created.** Two new tables, `customer_payments.due_id`, widened `sales.payment_method` CHECK, RLS, PowerSync publication. |
| `src/data/powersync/schema.ts` | Client-side table defs for `installment_plans`/`installment_dues`, `due_id` added to `customer_payments`. |
| `powersync.yaml` | Two new sync stream lines. |
| `src/features/installments/installment.types.ts` | `InstallmentPlan`, `InstallmentDue`, `NewInstallmentPlanInput`, `TermFrequency`, `PlanStatus`, `DueStatus`, `DueBucket`, pure `dueBucket()` helper. |
| `src/features/installments/installmentSchedule.ts` | Pure `generateInstallmentSchedule()` — even-split due schedule, no DB/Vue. |
| `src/features/installments/composables/useInstallmentPlan.ts` | `createPlan`, `recordDuePayment`, `cancelPlan`, `loadActivePlanForCustomer`, `loadPlan`. |
| `src/features/installments/composables/useInstallmentsDueAlert.ts` | Dashboard-card data (mirrors `useLowStockAlerts.ts` shape). |
| `src/features/audit/audit.types.ts` / `useAuditLog.ts` / `audit.format.ts` | Three new audit events for plan created/payment recorded/plan cancelled. |
| `src/features/messaging/useSendInstallmentReminder.ts` + `index.ts` | WhatsApp reminder composable, mirrors `useSendStatement.ts` shape. |
| `src/features/payment/payment.types.ts` / `usePayment.ts` / `PaymentModal.vue` | New `'installment'` payment method + `'installment-confirm'` state. |
| `src/features/payment/components/InstallmentPlanForm.vue` | New down-payment/term/frequency/start-date form + schedule preview, rendered inside `PaymentModal.vue`. |
| `src/features/customers/components/InstallmentPlanSection.vue` | Active plan + due list + record-payment + cancel + reminder, mounted on `CustomerDetailPage.vue`. |
| `src/pages/HomePage.vue` | One new "أقساط مستحقة" signal-row card. |
| `src/features/installments/InstallmentsDuePage.vue` + `src/router/index.ts` | `/installments` route — full due list sorted soonest-first, tapped from the dashboard card. |

---

### Task 1: Migration — installment tables (already written, verify + apply)

**Files:**
- Verify: `supabase/migrations/033_installment_plans.sql` (already created this session)

- [ ] **Step 1: Read the migration file and confirm it matches this plan's data model**

Open `supabase/migrations/033_installment_plans.sql` and confirm it contains:
- `CREATE TABLE public.installment_plans` with columns `plan_id, shop_id, customer_id, sale_id, total_amount_usd, down_payment_usd, term_count, term_frequency, start_date, status, created_at, created_by, sync_status`.
- `CREATE TABLE public.installment_dues` with columns `due_id, plan_id, shop_id, due_date, amount_due_usd, amount_paid_usd, status, sync_status`.
- `ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS due_id ...`.
- A `sales_payment_method_check3` CHECK widened to include `'installment'`.
- RLS (SELECT/INSERT/UPDATE) for both new tables using `auth_shop_id()`.
- A PowerSync publication `DO $$` block adding both tables.

If any piece is missing, add it following the exact patterns in `supabase/migrations/027_cash_movements.sql` (RLS + publication) and `supabase/migrations/011_sales_payment_method_credit_split.sql` (CHECK-constraint widening).

- [ ] **Step 2: Apply the migration to the hosted Supabase project**

Run `033_installment_plans.sql` in the Supabase SQL editor (or your migration runner). Expected: no errors; `\d public.installment_plans` and `\d public.installment_dues` show the new tables.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/033_installment_plans.sql
git commit -m "feat: add installment_plans/installment_dues tables and widen sales.payment_method"
```

---

### Task 2: PowerSync client schema + sync stream

**Files:**
- Modify: `src/data/powersync/schema.ts:95-108` (add `due_id` to `customer_payments`), and add two new `Table` definitions before the `AppSchema` export (currently ends at `src/data/powersync/schema.ts:294`).
- Modify: `powersync.yaml` (add two stream lines after the `customer_payments` line, currently at line 41 of the `streams:` block).
- Test: `src/__tests__/features/installmentSchema.test.ts` (new)

**Interfaces:**
- Produces: `AppSchema` now recognizes `installment_plans` and `installment_dues` tables locally, and `customer_payments.due_id` — every later composable task in this plan depends on this.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/installmentSchema.test.ts
import { describe, it, expect } from 'vitest'
import { AppSchema } from '@/data/powersync/schema'

describe('AppSchema — installment tables', () => {
  it('registers installment_plans with the expected columns', () => {
    const table = (AppSchema as any).tables.find((t: any) => t.name === 'installment_plans')
    expect(table).toBeTruthy()
    const cols = Object.keys(table.columns)
    expect(cols).toEqual(expect.arrayContaining([
      'shop_id', 'customer_id', 'sale_id', 'total_amount_usd', 'down_payment_usd',
      'term_count', 'term_frequency', 'start_date', 'status', 'created_at', 'created_by', 'sync_status',
    ]))
  })

  it('registers installment_dues with the expected columns', () => {
    const table = (AppSchema as any).tables.find((t: any) => t.name === 'installment_dues')
    expect(table).toBeTruthy()
    const cols = Object.keys(table.columns)
    expect(cols).toEqual(expect.arrayContaining([
      'plan_id', 'shop_id', 'due_date', 'amount_due_usd', 'amount_paid_usd', 'status', 'sync_status',
    ]))
  })

  it('adds due_id to customer_payments', () => {
    const table = (AppSchema as any).tables.find((t: any) => t.name === 'customer_payments')
    expect(Object.keys(table.columns)).toContain('due_id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/installmentSchema.test.ts`
Expected: FAIL — `installment_plans`/`installment_dues` tables not found, `due_id` not in `customer_payments`.

> Note: `PowerSync`'s `Schema`/`Table` internal shape (`.tables`, `.columns`) matches what `@powersync/web` exposes at runtime in this repo's installed version — if the property names differ, inspect `AppSchema` in a `node -e` REPL or the `@powersync/web` type defs and adjust the test's property access accordingly; the assertions on *which columns exist* are what matters, not the exact internal accessor path.

- [ ] **Step 3: Add `due_id` to `customer_payments` and define the two new tables**

In `src/data/powersync/schema.ts`, modify the existing `customer_payments` table (around line 95):

```ts
const customer_payments = new Table({
  shop_id:                  column.text,
  customer_id:              column.text,
  sale_id:                  column.text,
  amount_usd:               column.real,
  currency:                 column.text,
  amount_raw:               column.real,
  method:                   column.text,   // 'cash' | 'transfer' | 'usdt' | 'hawala' — only cash hits the drawer
  exchange_rate_at_payment: column.real,
  notes:                    column.text,
  paid_at:                  column.text,
  created_at:               column.text,
  sync_status:              column.text,
  due_id:                   column.text,   // tags a payment against a specific installment_dues row; null for the plan's down payment
})
```

Then add two new table definitions right after `customer_payments` (before `receipt_settings`):

```ts
const installment_plans = new Table({
  shop_id:          column.text,
  customer_id:      column.text,
  sale_id:          column.text,
  total_amount_usd: column.real,
  down_payment_usd: column.real,
  term_count:       column.integer,
  term_frequency:   column.text,   // 'weekly' | 'monthly'
  start_date:       column.text,   // YYYY-MM-DD
  status:           column.text,   // 'active' | 'completed' | 'defaulted' | 'cancelled'
  created_at:       column.text,
  created_by:       column.text,
  sync_status:      column.text,
})

const installment_dues = new Table({
  plan_id:         column.text,
  shop_id:         column.text,
  due_date:        column.text,   // YYYY-MM-DD
  amount_due_usd:  column.real,
  amount_paid_usd: column.real,
  status:          column.text,   // 'pending' | 'paid' | 'voided'
  sync_status:     column.text,
})
```

Then register both in `AppSchema` (around line 272):

```ts
export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
  customers,
  customer_payments,
  receipt_settings,
  sale_payments,
  staff,
  cashier_shifts,
  cash_movements,
  returns,
  return_line_items,
  return_reasons,
  sync_dead_letter,
  audit_log,
  suppliers,
  stock_receivings,
  stock_receiving_line_items,
  installment_plans,
  installment_dues,
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/installmentSchema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the two new streams to `powersync.yaml`**

In `powersync.yaml`, in the `streams: shop_data: queries:` list, add two lines after the `customer_payments` line:

```yaml
      - SELECT * FROM public.installment_plans        WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
      - SELECT * FROM public.installment_dues          WHERE shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.user_id())
```

- [ ] **Step 6: Deploy the updated `powersync.yaml`**

Follow this project's existing PowerSync deploy process (same one used for every prior `powersync.yaml` change, e.g. when `cash_movements` was added). Verify the PowerSync dashboard shows no sync-rule errors after deploy.

- [ ] **Step 7: Commit**

```bash
git add src/data/powersync/schema.ts powersync.yaml src/__tests__/features/installmentSchema.test.ts
git commit -m "feat: add installment_plans/installment_dues to the PowerSync client schema and sync rules"
```

---

### Task 3: Types + pure schedule generator

**Files:**
- Create: `src/features/installments/installment.types.ts`
- Create: `src/features/installments/installmentSchedule.ts`
- Test: `src/__tests__/features/installmentSchedule.test.ts`

**Interfaces:**
- Produces: `TermFrequency`, `PlanStatus`, `DueStatus`, `DueBucket`, `InstallmentPlan`, `InstallmentDue`, `NewInstallmentPlanInput`, `dueBucket(due, today): DueBucket`, `generateInstallmentSchedule(totalAmountUsd, downPaymentUsd, termCount, termFrequency, startDate): InstallmentDueSeed[]` where `InstallmentDueSeed = { dueDate: string; amountDueUsd: number }`. Every later task in this plan imports from these two files.

- [ ] **Step 1: Write the failing test for the schedule generator**

```ts
// src/__tests__/features/installmentSchedule.test.ts
import { describe, it, expect } from 'vitest'
import { generateInstallmentSchedule } from '@/features/installments/installmentSchedule'

describe('generateInstallmentSchedule', () => {
  it('splits the financed amount evenly across monthly terms', () => {
    const schedule = generateInstallmentSchedule(300, 0, 3, 'monthly', '2026-08-01')
    expect(schedule).toHaveLength(3)
    expect(schedule[0]).toEqual({ dueDate: '2026-08-01', amountDueUsd: 100 })
    expect(schedule[1]).toEqual({ dueDate: '2026-09-01', amountDueUsd: 100 })
    expect(schedule[2]).toEqual({ dueDate: '2026-10-01', amountDueUsd: 100 })
  })

  it('subtracts the down payment before splitting', () => {
    const schedule = generateInstallmentSchedule(300, 60, 3, 'monthly', '2026-08-01')
    const sum = schedule.reduce((s, d) => s + d.amountDueUsd, 0)
    expect(Math.round(sum * 100) / 100).toBe(240)
  })

  it('absorbs rounding remainder into the last installment', () => {
    // financed = 100, 3 terms -> 33.33 + 33.33 + 33.34
    const schedule = generateInstallmentSchedule(100, 0, 3, 'monthly', '2026-08-01')
    expect(schedule[0].amountDueUsd).toBe(33.33)
    expect(schedule[1].amountDueUsd).toBe(33.33)
    expect(schedule[2].amountDueUsd).toBe(33.34)
    const sum = schedule.reduce((s, d) => s + d.amountDueUsd, 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
  })

  it('steps weekly due dates by 7 days', () => {
    const schedule = generateInstallmentSchedule(200, 0, 2, 'weekly', '2026-08-01')
    expect(schedule[0].dueDate).toBe('2026-08-01')
    expect(schedule[1].dueDate).toBe('2026-08-08')
  })

  it('throws for a non-positive term_count', () => {
    expect(() => generateInstallmentSchedule(100, 0, 0, 'monthly', '2026-08-01')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/installmentSchedule.test.ts`
Expected: FAIL with "Cannot find module '@/features/installments/installmentSchedule'".

- [ ] **Step 3: Write `installment.types.ts`**

```ts
// src/features/installments/installment.types.ts

export type TermFrequency = 'weekly' | 'monthly'
export type PlanStatus    = 'active' | 'completed' | 'defaulted' | 'cancelled'

// The DB only ever stores 'pending' | 'paid' | 'voided'. The spec's
// upcoming/due/overdue distinction is a DISPLAY bucket derived at read time
// from due_date vs "today" (see dueBucket() below), not a stored value — there
// is no background scheduler in this offline-first app to keep a stored bucket
// from going stale, matching how zombie-shift detection already works
// read-time-only in this codebase.
export type DueStatus = 'pending' | 'paid' | 'voided'
export type DueBucket = 'upcoming' | 'due' | 'overdue' | 'paid' | 'voided'

export interface InstallmentPlan {
  planId:         string
  shopId:         string
  customerId:     string
  saleId:         string
  totalAmountUsd: number
  downPaymentUsd: number
  termCount:      number
  termFrequency:  TermFrequency
  startDate:      string   // YYYY-MM-DD
  status:         PlanStatus
  createdAt:      string
  createdBy:      string
}

export interface InstallmentDue {
  dueId:         string
  planId:        string
  shopId:        string
  dueDate:       string   // YYYY-MM-DD
  amountDueUsd:  number
  amountPaidUsd: number
  status:        DueStatus
}

export interface NewInstallmentPlanInput {
  customerId:     string
  saleId:         string
  totalAmountUsd: number
  downPaymentUsd: number
  termCount:      number
  termFrequency:  TermFrequency
  startDate:      string   // YYYY-MM-DD
}

/**
 * Display bucket for one due, derived from its stored status + due_date vs
 * "today" (caller-supplied ISO date, e.g. `new Date().toISOString().slice(0,10)`
 * — kept as a parameter, not `new Date()` inside, so this stays pure/testable).
 */
export function dueBucket(due: Pick<InstallmentDue, 'status' | 'dueDate'>, today: string): DueBucket {
  if (due.status === 'paid')   return 'paid'
  if (due.status === 'voided') return 'voided'
  if (due.dueDate < today)     return 'overdue'
  if (due.dueDate === today)   return 'due'
  return 'upcoming'
}
```

- [ ] **Step 4: Write `installmentSchedule.ts`**

```ts
// src/features/installments/installmentSchedule.ts
import type { TermFrequency } from './installment.types'

export interface InstallmentDueSeed {
  dueDate:      string   // YYYY-MM-DD
  amountDueUsd: number
}

function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addPeriod(date: Date, frequency: TermFrequency): Date {
  const d = new Date(date)
  if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7)
  } else {
    d.setMonth(d.getMonth() + 1)
  }
  return d
}

/**
 * Generate the even-split due schedule for an installment plan. The financed
 * amount (total - down payment) is split evenly across term_count dues; any
 * rounding remainder is absorbed into the LAST installment so the schedule
 * always sums exactly to the financed amount.
 */
export function generateInstallmentSchedule(
  totalAmountUsd: number,
  downPaymentUsd: number,
  termCount: number,
  termFrequency: TermFrequency,
  startDate: string,
): InstallmentDueSeed[] {
  if (termCount <= 0 || !Number.isInteger(termCount)) {
    throw new Error('term_count must be a positive integer')
  }

  const financed = Math.round((totalAmountUsd - downPaymentUsd) * 100) / 100
  const baseCents = Math.floor((financed * 100) / termCount)
  const base = baseCents / 100
  const lastAmount = Math.round((financed - base * (termCount - 1)) * 100) / 100

  const [y, m, d] = startDate.split('-').map(Number)
  let due = new Date(y, m - 1, d)

  const dues: InstallmentDueSeed[] = []
  for (let i = 0; i < termCount; i++) {
    dues.push({
      dueDate: toIsoDate(due),
      amountDueUsd: i === termCount - 1 ? lastAmount : base,
    })
    due = addPeriod(due, termFrequency)
  }
  return dues
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/installmentSchedule.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/installments/installment.types.ts src/features/installments/installmentSchedule.ts src/__tests__/features/installmentSchedule.test.ts
git commit -m "feat: add installment plan types and pure schedule generator"
```

---

### Task 4: Audit log — three new events

**Files:**
- Modify: `src/features/audit/audit.types.ts:1-42` (add 3 `AuditEvent` values + `'installment_plan'` to `AuditEntityType`)
- Modify: `src/features/audit/composables/useAuditLog.ts:336-341` area (add 3 new `log*` helpers + export them)
- Modify: `src/features/audit/audit.format.ts` (add 3 `eventLabel` cases, reusing the existing `str`/`num`/`usd` helpers)
- Test: `src/__tests__/features/useAuditLog.test.ts` (extend)

**Interfaces:**
- Consumes: `_log` from `useAuditLog.ts` (already defined, unchanged signature: `_log(event, entityType, entityId, meta)`).
- Produces: `logInstallmentPlanCreated(planId, customerId, totalUsd, downPaymentUsd, termCount)`, `logInstallmentPaymentRecorded(dueId, planId, amountUsd)`, `logInstallmentPlanCancelled(planId)` — Task 5/6/7's `useInstallmentPlan.ts` composable calls these three.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/features/useAuditLog.test.ts` (inside the existing top-level `describe('useAuditLog', ...)` block, alongside the other `logX` tests):

```ts
it('logInstallmentPlanCreated writes an installment_plan.created row', async () => {
  const session = useSessionStore()
  session.setActiveStaff(mockStaff)
  const { logInstallmentPlanCreated } = useAuditLog()

  await logInstallmentPlanCreated('plan-1', 'cust-1', 300, 60, 3)

  expect(db.execute).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO audit_log'),
    expect.arrayContaining(['installment_plan.created', 'installment_plan', 'plan-1']),
  )
})

it('logInstallmentPaymentRecorded writes an installment_payment.recorded row', async () => {
  const { logInstallmentPaymentRecorded } = useAuditLog()
  await logInstallmentPaymentRecorded('due-1', 'plan-1', 100)
  expect(db.execute).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO audit_log'),
    expect.arrayContaining(['installment_payment.recorded', 'installment_plan', 'plan-1']),
  )
})

it('logInstallmentPlanCancelled writes an installment_plan.cancelled row', async () => {
  const { logInstallmentPlanCancelled } = useAuditLog()
  await logInstallmentPlanCancelled('plan-1')
  expect(db.execute).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO audit_log'),
    expect.arrayContaining(['installment_plan.cancelled', 'installment_plan', 'plan-1']),
  )
})
```

Also add (as a new top-level `describe`, mirroring the "missing/legacy meta" block already in this file):

```ts
describe('eventLabel — installment events', () => {
  it('renders installment_plan.created with amounts and term count', () => {
    const entry = {
      event: 'installment_plan.created',
      meta: { customerId: 'cust-1', totalUsd: 300, downPaymentUsd: 60, termCount: 3 },
    } as unknown as AuditLog
    const label = eventLabel(entry)
    expect(label).toContain('$300.00')
    expect(label).toContain('$60.00')
    expect(label).toContain('3')
  })

  it('renders installment_payment.recorded with the amount', () => {
    const entry = { event: 'installment_payment.recorded', meta: { dueId: 'due-1', amountUsd: 100 } } as unknown as AuditLog
    expect(eventLabel(entry)).toContain('$100.00')
  })

  it('renders installment_plan.cancelled', () => {
    const entry = { event: 'installment_plan.cancelled', meta: {} } as unknown as AuditLog
    expect(eventLabel(entry)).toContain('ألغى خطة تقسيط')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts`
Expected: FAIL — `logInstallmentPlanCreated is not a function`, etc.

- [ ] **Step 3: Extend `audit.types.ts`**

```ts
export type AuditEvent =
  | 'sale.completed'
  | 'sale.deleted'
  | 'return.processed'
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'product.price_changed'
  | 'expense.created'
  | 'expense.updated'
  | 'expense.deleted'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'customer.payment_recorded'
  | 'stock.adjusted'
  | 'shift.opened'
  | 'shift.closed'
  | 'shift.force_closed'
  | 'exchange_rate.changed'
  | 'settings.receipt_updated'
  | 'staff.created'
  | 'staff.updated'
  | 'staff.deactivated'
  | 'staff.permissions_changed'
  | 'staff.pin_changed'
  | 'staff.recovery_codes_generated'
  | 'staff.recovery_code_used'
  | 'auth.login_failed'
  | 'auth.locked_out'
  | 'supplier.created'
  | 'supplier.updated'
  | 'receiving.created'
  | 'operator.switched'
  | 'cash_movement.recorded'
  | 'cash_movement.voided'
  | 'installment_plan.created'
  | 'installment_payment.recorded'
  | 'installment_plan.cancelled'

export type AuditEntityType =
  | 'sale' | 'return' | 'product' | 'expense'
  | 'customer' | 'stock' | 'shift'
  | 'exchange_rate' | 'settings' | 'staff'
  | 'supplier' | 'receiving' | 'cash_movement'
  | 'installment_plan'
```

- [ ] **Step 4: Add the three helpers to `useAuditLog.ts`**

Add right after `logCashMovementVoided` (near line 335):

```ts
  const logInstallmentPlanCreated = (
    planId: string, customerId: string, totalUsd: number, downPaymentUsd: number, termCount: number,
  ) => _log('installment_plan.created', 'installment_plan', planId,
            { customerId, totalUsd, downPaymentUsd, termCount })

  const logInstallmentPaymentRecorded = (dueId: string, planId: string, amountUsd: number) =>
    _log('installment_payment.recorded', 'installment_plan', planId, { dueId, amountUsd })

  const logInstallmentPlanCancelled = (planId: string) =>
    _log('installment_plan.cancelled', 'installment_plan', planId, {})
```

Add the three names to the composable's `return { ... }` block, next to `logCashMovementVoided`:

```ts
    logInstallmentPlanCreated,
    logInstallmentPaymentRecorded,
    logInstallmentPlanCancelled,
```

- [ ] **Step 5: Add the three `eventLabel` cases**

In `src/features/audit/audit.format.ts`, add right after the `cash_movement.voided` case:

```ts
    case 'installment_plan.created':
      return `أنشأ خطة تقسيط بقيمة ${usd(m.totalUsd)} (دفعة أولى ${usd(m.downPaymentUsd)}, ${num(m.termCount)} دفعات)`
    case 'installment_payment.recorded':
      return `سجّل دفعة قسط ${usd(m.amountUsd)}`
    case 'installment_plan.cancelled':
      return `ألغى خطة تقسيط`
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 7: Commit**

```bash
git add src/features/audit/audit.types.ts src/features/audit/composables/useAuditLog.ts src/features/audit/audit.format.ts src/__tests__/features/useAuditLog.test.ts
git commit -m "feat: add installment plan audit events"
```

---

### Task 5: `useInstallmentPlan` composable — `createPlan`

**Files:**
- Create: `src/features/installments/composables/useInstallmentPlan.ts`
- Test: `src/__tests__/features/useInstallmentPlan.test.ts`

**Interfaces:**
- Consumes: `generateInstallmentSchedule` (Task 3), `useAuditLog().logInstallmentPlanCreated` (Task 4), `useDeviceStore` (`shopId`, `deviceId`), `useSessionStore` (`activeStaff?.name`), `db.writeTransaction` from `@/data/powersync/db`, `v4 as uuidv4` from `'uuid'`.
- Produces: `useInstallmentPlan()` → `{ createPlan(input: NewInstallmentPlanInput): Promise<InstallmentPlan>, recordDuePayment, cancelPlan, loadActivePlanForCustomer, loadPlan }` — this task implements only `createPlan`; the other four are stubbed to throw `'not implemented'` so the file compiles, and Tasks 6/7 replace the stubs.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/useInstallmentPlan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInstallmentPlan } from '@/features/installments/composables/useInstallmentPlan'
import { db } from '@/data/powersync/db'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

const mockStaff: Staff = {
  id: 'staff-1', shopId: 'shop-1', name: 'أحمد', pinHash: 'abc', pinSalt: null,
  role: 'owner',
  permissions: {
    can_view_reports: true, can_manage_products: true,
    can_manage_customers: true, can_view_expenses: true, can_manage_settings: true,
  },
  isActive: true, createdAt: '2026-01-01T00:00:00Z',
}

describe('useInstallmentPlan.createPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
  })

  it('inserts one installment_plans row, one installment_dues row per term, and the down payment as a customer_payments row', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { createPlan } = useInstallmentPlan()
    const plan = await createPlan({
      customerId: 'cust-1',
      saleId: 'sale-1',
      totalAmountUsd: 300,
      downPaymentUsd: 60,
      termCount: 3,
      termFrequency: 'monthly',
      startDate: '2026-08-01',
    })

    expect(plan.customerId).toBe('cust-1')
    expect(plan.status).toBe('active')

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.filter(sql => sql.includes('INSERT INTO installment_plans'))).toHaveLength(1)
    expect(calls.filter(sql => sql.includes('INSERT INTO installment_dues'))).toHaveLength(3)
    expect(calls.filter(sql => sql.includes('INSERT INTO customer_payments'))).toHaveLength(1)
  })

  it('skips the customer_payments insert when down payment is 0', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { createPlan } = useInstallmentPlan()
    await createPlan({
      customerId: 'cust-1', saleId: 'sale-1', totalAmountUsd: 300, downPaymentUsd: 0,
      termCount: 3, termFrequency: 'monthly', startDate: '2026-08-01',
    })

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.filter(sql => sql.includes('INSERT INTO customer_payments'))).toHaveLength(0)
  })

  it('writes an audit log row after the transaction commits', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { createPlan } = useInstallmentPlan()
    await createPlan({
      customerId: 'cust-1', saleId: 'sale-1', totalAmountUsd: 300, downPaymentUsd: 60,
      termCount: 3, termFrequency: 'monthly', startDate: '2026-08-01',
    })

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.created', 'installment_plan']),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts`
Expected: FAIL with "Cannot find module '@/features/installments/composables/useInstallmentPlan'".

- [ ] **Step 3: Write the composable (with `createPlan` implemented, the rest stubbed)**

```ts
// src/features/installments/composables/useInstallmentPlan.ts
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { generateInstallmentSchedule } from '@/features/installments/installmentSchedule'
import type { InstallmentPlan, InstallmentDue, NewInstallmentPlanInput } from '@/features/installments/installment.types'

export function useInstallmentPlan() {
  const device  = useDeviceStore()
  const session = useSessionStore()
  const { logInstallmentPlanCreated, logInstallmentPaymentRecorded, logInstallmentPlanCancelled } = useAuditLog()

  async function createPlan(input: NewInstallmentPlanInput): Promise<InstallmentPlan> {
    const planId = uuidv4()
    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    const createdBy = session.activeStaff?.name ?? 'system'

    const schedule = generateInstallmentSchedule(
      input.totalAmountUsd, input.downPaymentUsd, input.termCount, input.termFrequency, input.startDate,
    )

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO installment_plans
           (plan_id, shop_id, customer_id, sale_id, total_amount_usd, down_payment_usd,
            term_count, term_frequency, start_date, status, created_at, created_by, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 'pending')`,
        [
          planId, device.shopId, input.customerId, input.saleId,
          input.totalAmountUsd, input.downPaymentUsd, input.termCount,
          input.termFrequency, input.startDate, now, createdBy,
        ],
      )

      for (const due of schedule) {
        await tx.execute(
          `INSERT INTO installment_dues
             (due_id, plan_id, shop_id, due_date, amount_due_usd, amount_paid_usd, status, sync_status)
           VALUES (?, ?, ?, ?, ?, 0, 'pending', 'pending')`,
          [uuidv4(), planId, device.shopId, due.dueDate, due.amountDueUsd],
        )
      }

      // Down payment posts as an immediate payment against the customer's ledger
      // balance, reusing the existing customer_payments table (Epic 4) so the
      // balance/statement/Z-report queries pick it up with no changes. due_id is
      // left null — the down payment isn't collected against any single
      // scheduled due, it's the plan's own initiation payment.
      if (input.downPaymentUsd > 0) {
        await tx.execute(
          `INSERT INTO customer_payments
             (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
              method, exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
           VALUES (?, ?, ?, ?, NULL, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, 'pending')`,
          [
            uuidv4(), device.shopId, input.customerId, input.saleId,
            input.downPaymentUsd, input.downPaymentUsd, today, now,
          ],
        )
      }
    })

    await logInstallmentPlanCreated(planId, input.customerId, input.totalAmountUsd, input.downPaymentUsd, input.termCount)

    return {
      planId, shopId: device.shopId, customerId: input.customerId, saleId: input.saleId,
      totalAmountUsd: input.totalAmountUsd, downPaymentUsd: input.downPaymentUsd,
      termCount: input.termCount, termFrequency: input.termFrequency, startDate: input.startDate,
      status: 'active', createdAt: now, createdBy,
    }
  }

  async function recordDuePayment(_dueId: string, _amountUsd: number): Promise<void> {
    throw new Error('not implemented — see Task 6')
  }

  async function cancelPlan(_planId: string): Promise<void> {
    throw new Error('not implemented — see Task 7')
  }

  async function loadActivePlanForCustomer(
    _customerId: string,
  ): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    throw new Error('not implemented — see Task 7')
  }

  async function loadPlan(_planId: string): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    throw new Error('not implemented — see Task 7')
  }

  return { createPlan, recordDuePayment, cancelPlan, loadActivePlanForCustomer, loadPlan }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/installments/composables/useInstallmentPlan.ts src/__tests__/features/useInstallmentPlan.test.ts
git commit -m "feat: add useInstallmentPlan.createPlan"
```

---

### Task 6: `useInstallmentPlan` composable — `recordDuePayment`

**Files:**
- Modify: `src/features/installments/composables/useInstallmentPlan.ts` (replace the `recordDuePayment` stub)
- Test: `src/__tests__/features/useInstallmentPlan.test.ts` (extend)

**Interfaces:**
- Consumes: `db.getOptional`, `db.writeTransaction` from `@/data/powersync/db`; `logInstallmentPaymentRecorded` (Task 4).
- Produces: `recordDuePayment(dueId: string, amountUsd: number): Promise<void>` — Task 12's `InstallmentPlanSection.vue` calls this when the owner records a collection against a specific due.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/features/useInstallmentPlan.test.ts`:

```ts
describe('useInstallmentPlan.recordDuePayment', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const session = useSessionStore()
    session.setActiveStaff(mockStaff)
  })

  it('inserts a customer_payments row tagged with due_id and updates amount_paid_usd/status to paid when fully covered', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 100, amount_paid_usd: 0, customer_id: 'cust-1',
    } as any)
    // "are there any other unpaid/unvoided dues left on this plan?" check
    vi.mocked(db.getOptional).mockResolvedValueOnce({ count: 0 } as any)

    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordDuePayment } = useInstallmentPlan()
    await recordDuePayment('due-1', 100)

    const calls = txExecute.mock.calls.map((c: any[]) => ({ sql: c[0] as string, params: c[1] }))
    const paymentInsert = calls.find(c => c.sql.includes('INSERT INTO customer_payments'))
    expect(paymentInsert).toBeTruthy()
    expect(paymentInsert!.params).toEqual(expect.arrayContaining(['due-1']))

    const dueUpdate = calls.find(c => c.sql.includes('UPDATE installment_dues'))
    expect(dueUpdate!.sql).toContain(`status = 'paid'`)

    const planUpdate = calls.find(c => c.sql.includes('UPDATE installment_plans'))
    expect(planUpdate).toBeTruthy() // no other unpaid dues -> plan completes
  })

  it('leaves the due pending on a partial payment and does not touch the plan status', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 100, amount_paid_usd: 0, customer_id: 'cust-1',
    } as any)

    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordDuePayment } = useInstallmentPlan()
    await recordDuePayment('due-1', 40)

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    const dueUpdate = calls.find(sql => sql.includes('UPDATE installment_dues'))!
    expect(dueUpdate).toContain(`status = 'pending'`)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans'))).toBe(false)
  })

  it('rejects a payment exceeding the remaining amount on the due', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'due-1', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 100, amount_paid_usd: 80, customer_id: 'cust-1',
    } as any)

    const { recordDuePayment } = useInstallmentPlan()
    await expect(recordDuePayment('due-1', 30)).rejects.toThrow('يتجاوز')
  })

  it('rejects when the due is not found', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { recordDuePayment } = useInstallmentPlan()
    await expect(recordDuePayment('missing', 10)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts`
Expected: FAIL — `recordDuePayment` throws `'not implemented — see Task 6'`.

- [ ] **Step 3: Implement `recordDuePayment`**

Replace the stub in `src/features/installments/composables/useInstallmentPlan.ts`:

```ts
  async function recordDuePayment(dueId: string, amountUsd: number): Promise<void> {
    const due = await db.getOptional<{
      due_id: string; plan_id: string; sale_id: string; shop_id: string;
      amount_due_usd: number; amount_paid_usd: number; customer_id: string;
    }>(
      `SELECT d.due_id, d.plan_id, p.sale_id, d.shop_id, d.amount_due_usd, d.amount_paid_usd, p.customer_id
       FROM installment_dues d
       JOIN installment_plans p ON p.plan_id = d.plan_id
       WHERE d.due_id = ?`,
      [dueId],
    )
    if (!due) throw new Error('لم يتم العثور على القسط')

    const newPaid = due.amount_paid_usd + amountUsd
    if (newPaid - due.amount_due_usd > 0.01) {
      throw new Error('المبلغ المدخل يتجاوز المبلغ المتبقي لهذا القسط')
    }

    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    const newStatus: 'pending' | 'paid' = newPaid >= due.amount_due_usd - 0.01 ? 'paid' : 'pending'

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO customer_payments
           (id, shop_id, customer_id, sale_id, due_id, amount_usd, currency, amount_raw,
            method, exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 'cash', NULL, NULL, ?, ?, 'pending')`,
        [uuidv4(), due.shop_id, due.customer_id, due.sale_id, dueId, amountUsd, amountUsd, today, now],
      )

      await tx.execute(
        `UPDATE installment_dues SET amount_paid_usd = ?, status = ? WHERE due_id = ?`,
        [newPaid, newStatus, dueId],
      )

      if (newStatus === 'paid') {
        const remaining = await tx.execute(
          `SELECT COUNT(*) as count FROM installment_dues
           WHERE plan_id = ? AND due_id != ? AND status = 'pending'`,
          [due.plan_id, dueId],
        )
        const remainingCount = (remaining as any).rows?._array?.[0]?.count ?? 0
        if (remainingCount === 0) {
          await tx.execute(
            `UPDATE installment_plans SET status = 'completed' WHERE plan_id = ?`,
            [due.plan_id],
          )
        }
      }
    })

    await logInstallmentPaymentRecorded(dueId, due.plan_id, amountUsd)
  }
```

> Note: this task's second test ("inserts... and updates...") mocks `db.getOptional` a second time for a `remaining` count check that, in the real implementation above, actually runs as `tx.execute` (inside the same transaction) rather than a second `db.getOptional` call — the test's second `mockResolvedValueOnce` on `db.getOptional` is therefore unused by this implementation. Before writing Step 1's test, either align the test to assert on `txExecute`'s `SELECT COUNT(*)` call (recommended — matches the code above) or change the implementation to use `db.getOptional` outside the transaction if you prefer that shape. Pick one and keep test and implementation consistent; the code above (checking remaining count via `tx.execute` inside the same transaction) is the recommended shape since it keeps the "did the plan just complete" check atomic with the due-status update.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts`
Expected: PASS (all `recordDuePayment` tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/installments/composables/useInstallmentPlan.ts src/__tests__/features/useInstallmentPlan.test.ts
git commit -m "feat: add useInstallmentPlan.recordDuePayment"
```

---

### Task 7: `useInstallmentPlan` composable — `cancelPlan`, `loadActivePlanForCustomer`, `loadPlan`

**Files:**
- Modify: `src/features/installments/composables/useInstallmentPlan.ts` (replace the remaining three stubs)
- Test: `src/__tests__/features/useInstallmentPlan.test.ts` (extend)

**Interfaces:**
- Produces: `cancelPlan(planId): Promise<void>`, `loadActivePlanForCustomer(customerId): Promise<{plan, dues} | null>`, `loadPlan(planId): Promise<{plan, dues} | null>` — Task 12's `InstallmentPlanSection.vue` and Task 8's dashboard alert composable depend on these.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/features/useInstallmentPlan.test.ts`:

```ts
describe('useInstallmentPlan.cancelPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('voids every still-pending due and cancels the plan', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    const calls = txExecute.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some(sql => sql.includes('UPDATE installment_dues') && sql.includes(`'voided'`))).toBe(true)
    expect(calls.some(sql => sql.includes('UPDATE installment_plans') && sql.includes(`'cancelled'`))).toBe(true)
  })

  it('writes an installment_plan.cancelled audit row', async () => {
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }) }) })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { cancelPlan } = useInstallmentPlan()
    await cancelPlan('plan-1')

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['installment_plan.cancelled', 'installment_plan', 'plan-1']),
    )
  })
})

describe('useInstallmentPlan.loadActivePlanForCustomer / loadPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns null when the customer has no active plan', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { loadActivePlanForCustomer } = useInstallmentPlan()
    const result = await loadActivePlanForCustomer('cust-1')
    expect(result).toBeNull()
  })

  it('returns the active plan and its dues ordered by due_date', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      plan_id: 'plan-1', shop_id: 'shop-1', customer_id: 'cust-1', sale_id: 'sale-1',
      total_amount_usd: 300, down_payment_usd: 60, term_count: 3, term_frequency: 'monthly',
      start_date: '2026-08-01', status: 'active', created_at: '2026-07-14T00:00:00.000Z', created_by: 'أحمد',
    } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { due_id: 'd1', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-08-01', amount_due_usd: 100, amount_paid_usd: 100, status: 'paid' },
      { due_id: 'd2', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-09-01', amount_due_usd: 100, amount_paid_usd: 0, status: 'pending' },
    ] as any)

    const { loadActivePlanForCustomer } = useInstallmentPlan()
    const result = await loadActivePlanForCustomer('cust-1')

    expect(result?.plan.planId).toBe('plan-1')
    expect(result?.plan.termFrequency).toBe('monthly')
    expect(result?.dues).toHaveLength(2)
    expect(result?.dues[0].dueId).toBe('d1')
  })

  it('loadPlan returns null for an unknown plan id', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { loadPlan } = useInstallmentPlan()
    expect(await loadPlan('missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts`
Expected: FAIL — the three stubs throw `'not implemented — see Task 7'`.

- [ ] **Step 3: Implement the three functions**

Replace the three stubs in `src/features/installments/composables/useInstallmentPlan.ts`. First add row-mapping helpers near the top of the file (after the imports):

```ts
type PlanRow = {
  plan_id: string; shop_id: string; customer_id: string; sale_id: string;
  total_amount_usd: number; down_payment_usd: number; term_count: number;
  term_frequency: 'weekly' | 'monthly'; start_date: string;
  status: 'active' | 'completed' | 'defaulted' | 'cancelled';
  created_at: string; created_by: string;
}
type DueRow = {
  due_id: string; plan_id: string; shop_id: string; due_date: string;
  amount_due_usd: number; amount_paid_usd: number; status: 'pending' | 'paid' | 'voided';
}

function rowToPlan(r: PlanRow): InstallmentPlan {
  return {
    planId: r.plan_id, shopId: r.shop_id, customerId: r.customer_id, saleId: r.sale_id,
    totalAmountUsd: r.total_amount_usd, downPaymentUsd: r.down_payment_usd,
    termCount: r.term_count, termFrequency: r.term_frequency, startDate: r.start_date,
    status: r.status, createdAt: r.created_at, createdBy: r.created_by,
  }
}

function rowToDue(r: DueRow): InstallmentDue {
  return {
    dueId: r.due_id, planId: r.plan_id, shopId: r.shop_id, dueDate: r.due_date,
    amountDueUsd: r.amount_due_usd, amountPaidUsd: r.amount_paid_usd, status: r.status,
  }
}
```

Then replace the three stub functions:

```ts
  async function cancelPlan(planId: string): Promise<void> {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `UPDATE installment_dues SET status = 'voided' WHERE plan_id = ? AND status = 'pending'`,
        [planId],
      )
      await tx.execute(
        `UPDATE installment_plans SET status = 'cancelled' WHERE plan_id = ?`,
        [planId],
      )
    })
    await logInstallmentPlanCancelled(planId)
  }

  async function loadActivePlanForCustomer(
    customerId: string,
  ): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    const planRow = await db.getOptional<PlanRow>(
      `SELECT * FROM installment_plans
       WHERE customer_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    )
    if (!planRow) return null

    const dueRows = await db.getAll<DueRow>(
      `SELECT * FROM installment_dues WHERE plan_id = ? ORDER BY due_date ASC`,
      [planRow.plan_id],
    )
    return { plan: rowToPlan(planRow), dues: dueRows.map(rowToDue) }
  }

  async function loadPlan(planId: string): Promise<{ plan: InstallmentPlan; dues: InstallmentDue[] } | null> {
    const planRow = await db.getOptional<PlanRow>(
      `SELECT * FROM installment_plans WHERE plan_id = ?`,
      [planId],
    )
    if (!planRow) return null

    const dueRows = await db.getAll<DueRow>(
      `SELECT * FROM installment_dues WHERE plan_id = ? ORDER BY due_date ASC`,
      [planId],
    )
    return { plan: rowToPlan(planRow), dues: dueRows.map(rowToDue) }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useInstallmentPlan.test.ts`
Expected: PASS (every test in the file — `createPlan`, `recordDuePayment`, `cancelPlan`, `loadActivePlanForCustomer`/`loadPlan`).

- [ ] **Step 5: Commit**

```bash
git add src/features/installments/composables/useInstallmentPlan.ts src/__tests__/features/useInstallmentPlan.test.ts
git commit -m "feat: add useInstallmentPlan.cancelPlan/loadActivePlanForCustomer/loadPlan"
```

---

### Task 8: Dashboard alert composable — `useInstallmentsDueAlert`

**Files:**
- Create: `src/features/installments/composables/useInstallmentsDueAlert.ts`
- Test: `src/__tests__/features/useInstallmentsDueAlert.test.ts`

**Interfaces:**
- Consumes: `dueBucket` (Task 3), `useDeviceStore`, `db.getAll`.
- Produces: `useInstallmentsDueAlert()` → `{ items, count, totalDueUsd, top3, allClear, load() }` — Task 13 (`HomePage.vue` card) and Task 14 (`InstallmentsDuePage.vue`) both consume this.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/useInstallmentsDueAlert.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInstallmentsDueAlert } from '@/features/installments/composables/useInstallmentsDueAlert'
import { db } from '@/data/powersync/db'

describe('useInstallmentsDueAlert', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('allClear is true and count is 0 when there are no pending dues', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([])
    const { load, allClear, count } = useInstallmentsDueAlert()
    await load()
    expect(allClear.value).toBe(true)
    expect(count.value).toBe(0)
  })

  it('counts only due/overdue buckets (not upcoming) and sums their remaining amount', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

    vi.mocked(db.getAll).mockResolvedValueOnce([
      { due_id: 'd1', plan_id: 'p1', customer_id: 'c1', customer_name: 'محمد', due_date: yesterday, amount_due_usd: 100, amount_paid_usd: 0, status: 'pending' },
      { due_id: 'd2', plan_id: 'p2', customer_id: 'c2', customer_name: 'سارة', due_date: today,     amount_due_usd: 50,  amount_paid_usd: 20, status: 'pending' },
      { due_id: 'd3', plan_id: 'p3', customer_id: 'c3', customer_name: 'علي',  due_date: nextMonth, amount_due_usd: 80,  amount_paid_usd: 0,  status: 'pending' },
    ] as any)

    const { load, count, totalDueUsd, top3, allClear } = useInstallmentsDueAlert()
    await load()

    expect(allClear.value).toBe(false)
    expect(count.value).toBe(2) // overdue (d1) + due-today (d2), not upcoming (d3)
    expect(totalDueUsd.value).toBeCloseTo(100 - 0 + (50 - 20))
    expect(top3.value.map(i => i.dueId)).toEqual(['d1', 'd2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useInstallmentsDueAlert.test.ts`
Expected: FAIL with "Cannot find module '@/features/installments/composables/useInstallmentsDueAlert'".

- [ ] **Step 3: Write the composable**

```ts
// src/features/installments/composables/useInstallmentsDueAlert.ts
import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { dueBucket } from '@/features/installments/installment.types'
import type { DueBucket } from '@/features/installments/installment.types'

export interface DueAlertItem {
  dueId:         string
  planId:        string
  customerId:    string
  customerName:  string
  dueDate:       string
  amountDueUsd:  number
  amountPaidUsd: number
  bucket:        DueBucket
}

type DueAlertRow = {
  due_id: string; plan_id: string; customer_id: string; customer_name: string;
  due_date: string; amount_due_usd: number; amount_paid_usd: number; status: 'pending' | 'paid' | 'voided';
}

export function useInstallmentsDueAlert() {
  const items = ref<DueAlertItem[]>([])

  const dueOrOverdue = computed(() =>
    items.value.filter(i => i.bucket === 'due' || i.bucket === 'overdue'),
  )
  const count = computed(() => dueOrOverdue.value.length)
  const totalDueUsd = computed(() =>
    dueOrOverdue.value.reduce((s, i) => s + (i.amountDueUsd - i.amountPaidUsd), 0),
  )
  const top3 = computed(() => dueOrOverdue.value.slice(0, 3))
  const allClear = computed(() => count.value === 0)

  async function load() {
    const device = useDeviceStore()
    const today = new Date().toISOString().slice(0, 10)

    const rows = await db.getAll<DueAlertRow>(
      `SELECT d.due_id, d.plan_id, p.customer_id, c.name as customer_name,
              d.due_date, d.amount_due_usd, d.amount_paid_usd, d.status
       FROM installment_dues d
       JOIN installment_plans p ON p.plan_id = d.plan_id
       JOIN customers c ON c.id = p.customer_id
       WHERE d.shop_id = ? AND d.status = 'pending' AND p.status = 'active'
       ORDER BY d.due_date ASC`,
      [device.shopId],
    )

    items.value = rows.map(r => ({
      dueId: r.due_id, planId: r.plan_id, customerId: r.customer_id, customerName: r.customer_name,
      dueDate: r.due_date, amountDueUsd: r.amount_due_usd, amountPaidUsd: r.amount_paid_usd,
      bucket: dueBucket({ status: r.status, dueDate: r.due_date }, today),
    }))
  }

  return { items, count, totalDueUsd, top3, allClear, load }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useInstallmentsDueAlert.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/installments/composables/useInstallmentsDueAlert.ts src/__tests__/features/useInstallmentsDueAlert.test.ts
git commit -m "feat: add useInstallmentsDueAlert dashboard-card composable"
```

---

### Task 9: WhatsApp reminder composable — `useSendInstallmentReminder`

**Files:**
- Create: `src/features/messaging/useSendInstallmentReminder.ts`
- Modify: `src/features/messaging/index.ts` (export the new composable + its types)
- Test: `src/__tests__/features/useSendInstallmentReminder.test.ts`

**Interfaces:**
- Consumes: `resolvePhone`, `openWhatsApp` from `./whatsapp` (both already exist, unchanged).
- Produces: `useSendInstallmentReminder()` → `{ prepare(input): PreparedInstallmentReminder, send(phone, text): void }` — Task 12's `InstallmentPlanSection.vue` uses this for the one-tap reminder button.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/features/useSendInstallmentReminder.test.ts
import { describe, it, expect, vi } from 'vitest'
import { useSendInstallmentReminder } from '@/features/messaging/useSendInstallmentReminder'

describe('useSendInstallmentReminder.prepare', () => {
  it('builds the reminder text with name, amount, date, and remaining balance', () => {
    const { prepare } = useSendInstallmentReminder()
    const result = prepare({
      customerName: 'محمد',
      shopName: 'محل الإلكترونيات',
      amountDueUsd: 100,
      dueDate: '2026-09-01',
      remainingUsd: 200,
      phoneRaw: '0944123456',
    })
    expect(result.text).toContain('محمد')
    expect(result.text).toContain('$100.00')
    expect(result.text).toContain('2026-09-01')
    expect(result.text).toContain('$200.00')
    expect(result.text).toContain('محل الإلكترونيات')
    expect(result.phone).toBe('963944123456')
  })

  it('resolves phone to null when none is supplied', () => {
    const { prepare } = useSendInstallmentReminder()
    const result = prepare({
      customerName: 'محمد', shopName: 'المحل', amountDueUsd: 50,
      dueDate: '2026-09-01', remainingUsd: 50,
    })
    expect(result.phone).toBeNull()
  })
})

describe('useSendInstallmentReminder.send', () => {
  it('opens WhatsApp with the given phone and text', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { send } = useSendInstallmentReminder()
    send('963944123456', 'test message')
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/963944123456'),
      '_blank',
    )
    openSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/useSendInstallmentReminder.test.ts`
Expected: FAIL with "Cannot find module '@/features/messaging/useSendInstallmentReminder'".

> Note: if `resolvePhone('0944123456', '963')` doesn't produce exactly `'963944123456'` in this codebase's actual normalization rules, read `src/features/messaging/whatsapp.ts`'s `resolvePhone` implementation first and adjust this test's expected value to match its real output — the point of the test is that `prepare()` calls `resolvePhone` with the raw phone and country code `'963'`, not the exact digits.

- [ ] **Step 3: Write the composable**

```ts
// src/features/messaging/useSendInstallmentReminder.ts
import { resolvePhone, openWhatsApp } from './whatsapp'

export interface PrepareInstallmentReminderInput {
  customerName:  string
  shopName:      string
  amountDueUsd:  number
  dueDate:       string   // YYYY-MM-DD
  /** Total remaining across the whole plan (not just this due). */
  remainingUsd:  number
  phoneRaw?:     string
}

export interface PreparedInstallmentReminder {
  text:  string
  phone: string | null
}

export function useSendInstallmentReminder() {
  function prepare(input: PrepareInstallmentReminderInput): PreparedInstallmentReminder {
    const text =
      `السلام عليكم ${input.customerName}، تذكير بموعد القسط: ` +
      `$${input.amountDueUsd.toFixed(2)} بتاريخ ${input.dueDate}. ` +
      `الرصيد المتبقي: $${input.remainingUsd.toFixed(2)}. — ${input.shopName}`

    const phone = input.phoneRaw?.trim()
      ? resolvePhone(input.phoneRaw.trim(), '963')
      : null

    return { text, phone }
  }

  function send(phone: string, text: string): void {
    openWhatsApp(phone, text)
  }

  return { prepare, send }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/useSendInstallmentReminder.test.ts`
Expected: PASS (3 tests, after any phone-format adjustment from Step 2's note).

- [ ] **Step 5: Export from `messaging/index.ts`**

```ts
export { default as WhatsAppPreviewSheet } from './components/WhatsAppPreviewSheet.vue'
export { useSendReceipt } from './useSendReceipt'
export type { PreparedReceipt } from './useSendReceipt'
export { useSendStatement } from './useSendStatement'
export type { PreparedStatement, PrepareStatementInput } from './useSendStatement'
export { useDailyDigest } from './useDailyDigest'
export { useSendInstallmentReminder } from './useSendInstallmentReminder'
export type { PreparedInstallmentReminder, PrepareInstallmentReminderInput } from './useSendInstallmentReminder'
```

- [ ] **Step 6: Commit**

```bash
git add src/features/messaging/useSendInstallmentReminder.ts src/features/messaging/index.ts src/__tests__/features/useSendInstallmentReminder.test.ts
git commit -m "feat: add useSendInstallmentReminder WhatsApp composable"
```

---

### Task 10: POS payment method — add `'installment'` to `usePayment`/`payment.types`

**Files:**
- Modify: `src/features/payment/payment.types.ts:1-2`
- Modify: `src/features/payment/usePayment.ts:112-125,146-183,289-295`
- Test: `src/__tests__/features/usePayment.test.ts` (extend — locate the existing file's `describe` blocks and add alongside them)

**Interfaces:**
- Produces: `PaymentMethod` now includes `'installment'`; `PaymentState` now includes `'installment-confirm'`; `usePayment().confirm(customerId)` writes `sales.payment_method = 'installment'`, `sales.is_credit = 1` when `method.value === 'installment'`, identical to how it already handles `'credit'`. Task 11's `PaymentModal.vue`/`InstallmentPlanForm.vue` depend on this.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/features/usePayment.test.ts` (find the existing `describe('usePayment'` or similar top-level block and add a sibling `describe`):

```ts
describe('usePayment — installment method', () => {
  beforeEach(() => {
    // Match this file's existing beforeEach pattern (Pinia reset, db mocks,
    // an open shift, a locked exchange rate, at least one sale line) — copy
    // whatever setup the existing 'credit' tests in this file already do.
  })

  it('selectMethod("installment") moves to installment-confirm state', () => {
    const { selectMethod, state, method } = usePayment()
    selectMethod('installment')
    expect(state.value).toBe('installment-confirm')
    expect(method.value).toBe('installment')
  })

  it('confirm() with method installment writes is_credit=1 and payment_method=installment, with no tendered payment', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [{ cost_price_usd: 0, current_stock: 10 }] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { selectMethod, confirm } = usePayment()
    selectMethod('installment')
    const sale = await confirm('cust-1')

    expect(sale.paymentMethod).toBe('installment')
    expect(sale.customerId).toBe('cust-1')

    const saleInsert = txExecute.mock.calls.find((c: any[]) => (c[0] as string).includes('INSERT INTO sales'))!
    // payment_method is the 10th bound param, is_credit the 15th — see the exact
    // column list in usePayment.ts's sales INSERT to confirm these indices match.
    expect(saleInsert[1]).toContain('installment')

    const paymentInserts = txExecute.mock.calls.filter((c: any[]) => (c[0] as string).includes('INSERT INTO sale_payments'))
    expect(paymentInserts).toHaveLength(0) // unpaid at sale time, same as credit
  })

  it('back() from installment-confirm returns to method-selection', () => {
    const { selectMethod, back, state } = usePayment()
    selectMethod('installment')
    back()
    expect(state.value).toBe('method-selection')
  })
})
```

> Note: copy this file's ACTUAL existing setup for a successful `confirm()` call (device store/shift store/session store mocks, `saleStore` with at least one line and a locked exchange rate) from its existing `'credit'`-method tests — every `usePayment().confirm()` test in this file needs that scaffolding already, don't invent a different setup shape for the new tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: FAIL — `'installment'` is not a valid `PaymentMethod`/`selectMethod` doesn't recognize it, TS may also fail to compile the test.

- [ ] **Step 3: Widen `payment.types.ts`**

```ts
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit' | 'split' | 'installment'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'card-confirm' | 'credit-confirm' | 'installment-confirm' | 'confirming' | 'confirmed'
```

- [ ] **Step 4: Update `usePayment.ts`**

In `selectMethod` (around line 112):

```ts
  function selectMethod(m: PaymentMethod) {
    method.value = m
    state.value  = m === 'card'        ? 'card-confirm'
                 : m === 'credit'      ? 'credit-confirm'
                 : m === 'installment' ? 'installment-confirm'
                 : 'amount-entry'
  }
```

In `back` (around line 119):

```ts
  function back() {
    if (
      state.value === 'amount-entry' || state.value === 'card-confirm' ||
      state.value === 'credit-confirm' || state.value === 'installment-confirm'
    ) {
      amountReceived.value = null
      method.value         = null
      state.value          = 'method-selection'
    }
  }
```

In `confirm` (around line 166), widen the credit-detection and `primaryMethod` derivation:

```ts
    // A credit (آجل) or installment sale is unpaid at sale time — it must NOT
    // record any tendered payment. (Installment's down payment posts separately
    // through customer_payments — see useInstallmentPlan.createPlan, called by
    // the caller after this sale commits.)
    const isCredit = (method.value === 'credit' || method.value === 'installment') && pendingPayments.value.length === 0
```

...and further down where `primaryMethod` is derived (around line 182):

```ts
    const isSplit       = entries.length > 1
    const primaryMethod: PaymentMethod =
      method.value === 'installment' ? 'installment'
      : isCredit ? 'credit'
      : isSplit  ? 'split'
      : entries[0].method
```

And in the `catch` block's state-reset (around line 291):

```ts
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Payment failed'
      state.value = method.value === 'card'        ? 'card-confirm'
                  : method.value === 'credit'      ? 'credit-confirm'
                  : method.value === 'installment' ? 'installment-confirm'
                  : 'amount-entry'
      throw err
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: PASS (every existing test in the file plus the 3 new ones — the widened `isCredit`/`primaryMethod` logic must not change behavior for `'credit'`; re-check any existing `'credit'`-method test still asserts `paymentMethod === 'credit'` and `is_credit = 1`).

- [ ] **Step 6: Commit**

```bash
git add src/features/payment/payment.types.ts src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "feat: add installment as a fourth payment method in usePayment"
```

---

### Task 11: POS UI — `InstallmentPlanForm.vue` + `PaymentModal.vue` wiring

**Files:**
- Create: `src/features/payment/components/InstallmentPlanForm.vue`
- Modify: `src/features/payment/PaymentModal.vue` (add a new template branch + wiring, mirroring the existing `credit-confirm` branch)
- Modify: `src/i18n/ar.ts`, `src/i18n/en.ts` (only if this component uses the `useI18n` `t()` pattern — otherwise inline Arabic strings, matching every other payment-flow component in this codebase, e.g. `PaymentModal.vue` itself has no i18n usage and hardcodes Arabic strings directly. Follow that existing convention: hardcode Arabic strings in `InstallmentPlanForm.vue`, do NOT add i18n keys for this component.)

**Interfaces:**
- Consumes: `generateInstallmentSchedule` (Task 3), `useInstallmentPlan().createPlan` (Task 7), `CustomerPickerModal.vue` (existing, unchanged).
- Produces: emits `confirm` with `{ downPaymentUsd, termCount, termFrequency, startDate }` up to `PaymentModal.vue`.

- [ ] **Step 1: Write `InstallmentPlanForm.vue`**

```vue
<!-- src/features/payment/components/InstallmentPlanForm.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { generateInstallmentSchedule } from '@/features/installments/installmentSchedule'
import type { TermFrequency } from '@/features/installments/installment.types'

const props = defineProps<{ totalUsd: number }>()
const emit = defineEmits<{
  (e: 'confirm', payload: { downPaymentUsd: number; termCount: number; termFrequency: TermFrequency; startDate: string }): void
}>()

function defaultStartDate(frequency: TermFrequency): string {
  const d = new Date()
  if (frequency === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const downPaymentStr = ref('0')
const termCountStr    = ref('3')
const termFrequency   = ref<TermFrequency>('monthly')
const startDate       = ref(defaultStartDate('monthly'))
const error           = ref<string | null>(null)

const downPaymentUsd = computed(() => parseFloat(downPaymentStr.value) || 0)
const termCount      = computed(() => parseInt(termCountStr.value, 10) || 0)

function onFrequencyChange(freq: TermFrequency) {
  termFrequency.value = freq
  startDate.value = defaultStartDate(freq)
}

const schedule = computed(() => {
  if (termCount.value <= 0 || downPaymentUsd.value > props.totalUsd || downPaymentUsd.value < 0) return []
  try {
    return generateInstallmentSchedule(props.totalUsd, downPaymentUsd.value, termCount.value, termFrequency.value, startDate.value)
  } catch {
    return []
  }
})

const previewText = computed(() => {
  if (!schedule.value.length) return ''
  const first = schedule.value[0]
  const freqLabel = termFrequency.value === 'weekly' ? 'أسبوعياً' : 'شهرياً'
  return `دفعة أولى: $${downPaymentUsd.value.toFixed(2)}، ثم ${termCount.value} دفعة ${freqLabel} من $${first.amountDueUsd.toFixed(2)} ابتداءً من ${first.dueDate}`
})

function handleConfirm() {
  error.value = null
  if (downPaymentUsd.value < 0 || downPaymentUsd.value > props.totalUsd) {
    error.value = 'الدفعة الأولى يجب أن تكون بين صفر والمجموع الكلي'
    return
  }
  if (termCount.value <= 0) {
    error.value = 'عدد الدفعات يجب أن يكون رقماً أكبر من صفر'
    return
  }
  if (!startDate.value) {
    error.value = 'يرجى اختيار تاريخ الدفعة الأولى'
    return
  }
  emit('confirm', {
    downPaymentUsd: downPaymentUsd.value,
    termCount: termCount.value,
    termFrequency: termFrequency.value,
    startDate: startDate.value,
  })
}
</script>

<template>
  <div class="installment-form" dir="rtl">
    <div class="field-group">
      <label class="field-label">الدفعة الأولى ($)</label>
      <input v-model="downPaymentStr" type="number" inputmode="decimal" min="0" class="field-input" />
    </div>

    <div class="field-group">
      <label class="field-label">عدد الدفعات</label>
      <input v-model="termCountStr" type="number" inputmode="numeric" min="1" class="field-input" />
    </div>

    <div class="field-group">
      <label class="field-label">التكرار</label>
      <div class="freq-toggle">
        <button
          type="button"
          class="freq-btn"
          :class="{ 'freq-btn-active': termFrequency === 'monthly' }"
          @click="onFrequencyChange('monthly')"
        >شهرياً</button>
        <button
          type="button"
          class="freq-btn"
          :class="{ 'freq-btn-active': termFrequency === 'weekly' }"
          @click="onFrequencyChange('weekly')"
        >أسبوعياً</button>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">تاريخ الدفعة الأولى</label>
      <input v-model="startDate" type="date" class="field-input" dir="ltr" />
    </div>

    <p v-if="previewText" class="preview-text">{{ previewText }}</p>
    <p v-if="error" class="form-error">{{ error }}</p>

    <button type="button" class="confirm-btn" @click="handleConfirm">تأكيد خطة التقسيط</button>
  </div>
</template>

<style scoped>
.installment-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: #637285; }
.field-input {
  height: 44px;
  border-radius: 10px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #E8EDF5;
  font-size: 15px;
  font-family: inherit;
}
.freq-toggle { display: flex; gap: 8px; }
.freq-btn {
  flex: 1;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(26, 86, 219, 0.24);
  background: rgba(26, 86, 219, 0.08);
  color: #C8D5E8;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}
.freq-btn-active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  border-color: transparent;
}
.preview-text {
  font-size: 13px;
  color: #60A5FA;
  background: rgba(26, 86, 219, 0.08);
  border: 1px solid rgba(26, 86, 219, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 0;
}
.form-error { color: #EF4444; font-size: 13px; margin: 0; }
.confirm-btn {
  height: 52px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  cursor: pointer;
}
</style>
```

- [ ] **Step 2: Wire it into `PaymentModal.vue`**

In `src/features/payment/PaymentModal.vue`, add the import:

```ts
import InstallmentPlanForm from './components/InstallmentPlanForm.vue'
import { useInstallmentPlan } from '@/features/installments/composables/useInstallmentPlan'
```

Add a handler function near `handleSelectCredit` (around line 82):

```ts
function handleSelectInstallment() {
  selectMethod('installment')
  showPicker.value = true
}

const { createPlan } = useInstallmentPlan()

async function handleInstallmentConfirm(terms: {
  downPaymentUsd: number; termCount: number; termFrequency: 'weekly' | 'monthly'; startDate: string
}) {
  if (!selectedCustomer.value) {
    showPicker.value = true
    return
  }
  try {
    const sale = await confirm(selectedCustomer.value.id)
    await createPlan({
      customerId: selectedCustomer.value.id,
      saleId: sale.saleId,
      totalAmountUsd: sale.totalUsd,
      downPaymentUsd: terms.downPaymentUsd,
      termCount: terms.termCount,
      termFrequency: terms.termFrequency,
      startDate: terms.startDate,
    })
    emit('confirmed', sale)
  } catch {
    // error is set in usePayment; the sale wasn't created, so no plan is created either
  }
}
```

Add the "installment" method tile to the method grid (inside the existing `v-for="m in [...]"` array in the template, right after the `credit` tile block — as its own separate button since it needs its own click handler, matching how the credit tile is a separate button rather than part of the `v-for`):

```vue
            <button
              v-if="pendingPayments.length === 0"
              type="button"
              data-testid="installment-method-btn"
              class="method-tile method-tile-credit"
              @click="handleSelectInstallment"
            >
              <span class="method-tile-icon">🗓️</span>
              <span class="method-tile-label">تقسيط</span>
            </button>
```

Add the new template branch, right after the existing `<!-- ── Credit confirm ── -->` block (after its closing `</div>` around line 415):

```vue
      <!-- ── Installment confirm ── -->
      <div v-else-if="state === 'installment-confirm'" class="state-pad">
        <div class="modal-top-bar">
          <button type="button" class="modal-back-btn" @click="handleBack">رجوع</button>
          <button type="button" class="modal-cancel-btn" @click="handleCancel">إلغاء</button>
        </div>

        <h2 id="payment-modal-title" class="modal-heading">إجمالي البيع</h2>

        <div class="total-block">
          <p class="total-usd">${{ totalUsd.toFixed(2) }}</p>
          <p class="total-syp">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div v-if="selectedCustomer" class="customer-chip">
          <div>
            <p class="customer-chip-name">{{ selectedCustomer.name }}</p>
            <p v-if="selectedCustomer.phone" class="customer-chip-phone">{{ selectedCustomer.phone }}</p>
          </div>
          <button type="button" class="customer-chip-change" @click="showPicker = true">تغيير</button>
        </div>

        <button
          v-else
          type="button"
          class="confirm-btn confirm-btn-amber"
          @click="showPicker = true"
        >اختر الزبون</button>

        <InstallmentPlanForm
          v-if="selectedCustomer"
          :total-usd="totalUsd"
          @confirm="handleInstallmentConfirm"
        />

        <p v-if="error" class="modal-error">{{ error }}</p>
      </div>
```

- [ ] **Step 3: Manually verify the flow**

Run `npm run dev`, ring a sale, tap the new "تقسيط" tile, pick a customer, fill in down payment/terms/frequency/date, confirm. Expected: the sale completes, a plan + due schedule are created (verify via `SELECT * FROM installment_plans`/`installment_dues` in the app's dev tools or a quick debug log), and the customer's balance on `CustomerDetailPage.vue` increases by the full sale total minus the down payment.

- [ ] **Step 4: Commit**

```bash
git add src/features/payment/components/InstallmentPlanForm.vue src/features/payment/PaymentModal.vue
git commit -m "feat: add installment plan creation to the POS payment flow"
```

---

### Task 12: Customer detail — `InstallmentPlanSection.vue`

**Files:**
- Create: `src/features/customers/components/InstallmentPlanSection.vue`
- Modify: `src/features/customers/CustomerDetailPage.vue` (mount the new component)
- Test: `src/features/customers/components/__tests__/InstallmentPlanSection.test.ts` (new — logic-focused, not a full component-mount test; see Step 1)

**Interfaces:**
- Consumes: `useInstallmentPlan()` (Task 7), `useSendInstallmentReminder()` (Task 9), `WhatsAppPreviewSheet` (existing, unchanged), `dueBucket` (Task 3).
- Produces: a self-contained customer-detail section, mirroring how `AuditHistory.vue` is mounted (`<AuditHistory entity-type="customer" :entity-id="..." />`).

- [ ] **Step 1: Write a focused test for the component's data-loading/reminder-prep logic**

Given this codebase has no existing Vue Test Utils component-mount tests for customer-detail children (`AuditHistory.vue` etc. are not directly unit-tested that way), test the two pieces of real logic this component adds — the reminder-prep call shape and the due-payment recording call shape — via a small wrapper, not a full mount:

```ts
// src/features/customers/components/__tests__/InstallmentPlanSection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInstallmentPlan } from '@/features/installments/composables/useInstallmentPlan'
import { useSendInstallmentReminder } from '@/features/messaging/useSendInstallmentReminder'
import { db } from '@/data/powersync/db'

describe('InstallmentPlanSection integration points', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadActivePlanForCustomer + prepare() together produce a reminder for the soonest pending due', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      plan_id: 'plan-1', shop_id: 'shop-1', customer_id: 'cust-1', sale_id: 'sale-1',
      total_amount_usd: 300, down_payment_usd: 60, term_count: 3, term_frequency: 'monthly',
      start_date: '2026-08-01', status: 'active', created_at: '2026-07-14T00:00:00.000Z', created_by: 'أحمد',
    } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { due_id: 'd1', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-08-01', amount_due_usd: 80, amount_paid_usd: 80, status: 'paid' },
      { due_id: 'd2', plan_id: 'plan-1', shop_id: 'shop-1', due_date: '2026-09-01', amount_due_usd: 80, amount_paid_usd: 0, status: 'pending' },
    ] as any)

    const { loadActivePlanForCustomer } = useInstallmentPlan()
    const result = await loadActivePlanForCustomer('cust-1')
    expect(result).toBeTruthy()

    const nextDue = result!.dues.find(d => d.status === 'pending')!
    const remainingUsd = result!.dues.reduce((s, d) => s + (d.amountDueUsd - d.amountPaidUsd), 0)

    const { prepare } = useSendInstallmentReminder()
    const reminder = prepare({
      customerName: 'محمد', shopName: 'المحل',
      amountDueUsd: nextDue.amountDueUsd, dueDate: nextDue.dueDate,
      remainingUsd, phoneRaw: '0944123456',
    })

    expect(reminder.text).toContain('$80.00')
    expect(reminder.text).toContain('2026-09-01')
  })

  it('recordDuePayment is called with the tapped due id and entered amount', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      due_id: 'd2', plan_id: 'plan-1', sale_id: 'sale-1', shop_id: 'shop-1',
      amount_due_usd: 80, amount_paid_usd: 0, customer_id: 'cust-1',
    } as any)
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => { await fn({ execute: txExecute }) })

    const { recordDuePayment } = useInstallmentPlan()
    await recordDuePayment('d2', 80)

    expect(txExecute.mock.calls.some((c: any[]) => (c[0] as string).includes('INSERT INTO customer_payments'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/customers/components/__tests__/InstallmentPlanSection.test.ts`
Expected: PASS immediately IF Tasks 7/9 are already done (this test only exercises composables built in earlier tasks — it's here to document and lock the exact call shape `InstallmentPlanSection.vue` must use). If it fails, Tasks 7/9 are incomplete — fix those first, not this test.

- [ ] **Step 3: Write `InstallmentPlanSection.vue`**

```vue
<!-- src/features/customers/components/InstallmentPlanSection.vue -->
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useInstallmentPlan } from '@/features/installments/composables/useInstallmentPlan'
import { useSendInstallmentReminder, WhatsAppPreviewSheet } from '@/features/messaging'
import { dueBucket } from '@/features/installments/installment.types'
import type { InstallmentPlan, InstallmentDue } from '@/features/installments/installment.types'

const props = defineProps<{
  customerId:    string
  customerName:  string
  customerPhone: string | null
  shopName:      string
}>()

const { loadActivePlanForCustomer, recordDuePayment, cancelPlan } = useInstallmentPlan()
const sendReminder = useSendInstallmentReminder()

const plan = ref<InstallmentPlan | null>(null)
const dues = ref<InstallmentDue[]>([])
const loading = ref(false)
const payingDueId = ref<string | null>(null)
const payAmountStr = ref('')
const error = ref<string | null>(null)
const showReminderSheet = ref(false)
const reminderPreview = ref<{ text: string; phone: string | null } | null>(null)
const showCancelConfirm = ref(false)

const today = new Date().toISOString().slice(0, 10)

const dueRows = computed(() =>
  dues.value.map(d => ({ ...d, bucket: dueBucket(d, today) })),
)

const nextPendingDue = computed(() =>
  dueRows.value.find(d => d.bucket !== 'paid' && d.bucket !== 'voided') ?? null,
)

const remainingUsd = computed(() =>
  dues.value.reduce((s, d) => s + (d.amountDueUsd - d.amountPaidUsd), 0),
)

async function reload() {
  loading.value = true
  try {
    const result = await loadActivePlanForCustomer(props.customerId)
    plan.value = result?.plan ?? null
    dues.value = result?.dues ?? []
  } finally {
    loading.value = false
  }
}

onMounted(reload)

function startPayment(dueId: string) {
  payingDueId.value = dueId
  payAmountStr.value = ''
  error.value = null
}

async function confirmPayment() {
  if (!payingDueId.value) return
  const amount = parseFloat(payAmountStr.value)
  if (isNaN(amount) || amount <= 0) {
    error.value = 'المبلغ غير صحيح'
    return
  }
  try {
    await recordDuePayment(payingDueId.value, amount)
    payingDueId.value = null
    await reload()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'تعذر تسجيل الدفعة'
  }
}

function openReminder() {
  if (!nextPendingDue.value) return
  const prepared = sendReminder.prepare({
    customerName: props.customerName,
    shopName: props.shopName,
    amountDueUsd: nextPendingDue.value.amountDueUsd - nextPendingDue.value.amountPaidUsd,
    dueDate: nextPendingDue.value.dueDate,
    remainingUsd: remainingUsd.value,
    phoneRaw: props.customerPhone ?? undefined,
  })
  reminderPreview.value = prepared
  showReminderSheet.value = true
}

function handleReminderSend(payload: { phone: string; text: string }) {
  sendReminder.send(payload.phone, payload.text)
  showReminderSheet.value = false
}

async function confirmCancelPlan() {
  if (!plan.value) return
  await cancelPlan(plan.value.planId)
  showCancelConfirm.value = false
  await reload()
}
</script>

<template>
  <div v-if="plan" class="installment-section" dir="rtl">
    <div class="section-hdr">
      <span class="section-title">خطة التقسيط</span>
      <button type="button" class="cancel-link" @click="showCancelConfirm = true">إلغاء الخطة</button>
    </div>

    <p class="plan-summary">
      الإجمالي ${{ plan.totalAmountUsd.toFixed(2) }} — دفعة أولى ${{ plan.downPaymentUsd.toFixed(2) }} —
      المتبقي ${{ remainingUsd.toFixed(2) }}
    </p>

    <button
      v-if="nextPendingDue"
      type="button"
      class="reminder-btn"
      @click="openReminder"
    >إرسال تذكير</button>

    <ul class="due-list">
      <li v-for="due in dueRows" :key="due.dueId" class="due-row" :class="`due-${due.bucket}`">
        <div class="due-info">
          <span class="due-date">{{ due.dueDate }}</span>
          <span class="due-amount">${{ due.amountDueUsd.toFixed(2) }}</span>
          <span class="due-badge">
            {{ due.bucket === 'paid' ? 'مدفوع' : due.bucket === 'voided' ? 'ملغى' : due.bucket === 'overdue' ? 'متأخر' : due.bucket === 'due' ? 'مستحق اليوم' : 'قادم' }}
          </span>
        </div>
        <button
          v-if="due.bucket !== 'paid' && due.bucket !== 'voided'"
          type="button"
          class="pay-btn"
          @click="startPayment(due.dueId)"
        >تسجيل دفعة</button>
      </li>
    </ul>

    <div v-if="payingDueId" class="pay-form">
      <input v-model="payAmountStr" type="number" inputmode="decimal" min="0" class="pay-input" placeholder="المبلغ" />
      <button type="button" class="pay-confirm-btn" @click="confirmPayment">تأكيد</button>
      <button type="button" class="pay-cancel-btn" @click="payingDueId = null">إلغاء</button>
    </div>
    <p v-if="error" class="section-error">{{ error }}</p>
  </div>

  <WhatsAppPreviewSheet
    v-if="showReminderSheet && reminderPreview"
    title="تذكير بالقسط"
    :text="reminderPreview.text"
    :phone="reminderPreview.phone"
    @send="handleReminderSend"
    @cancel="showReminderSheet = false"
  />

  <AppDialog
    v-if="showCancelConfirm"
    title="إلغاء خطة التقسيط"
    message="سيتم إلغاء كل الدفعات المتبقية غير المدفوعة. هل أنت متأكد؟"
    confirm-label="نعم، إلغاء"
    :danger="true"
    @confirm="confirmCancelPlan"
    @cancel="showCancelConfirm = false"
  />
</template>

<style scoped>
.installment-section {
  margin-bottom: 16px;
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.10), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(26, 86, 219, 0.24);
  font-family: 'Tajawal', system-ui, sans-serif;
}
.section-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.section-title { font-weight: 700; color: #E8EDF5; font-size: 15px; }
.cancel-link { background: none; border: none; color: #EF4444; font-size: 12px; cursor: pointer; }
.plan-summary { font-size: 13px; color: #C8D5E8; margin: 0 0 10px; }
.reminder-btn {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.12);
  color: #22C55E;
  font-weight: 700;
  cursor: pointer;
  margin-bottom: 10px;
}
.due-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.due-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}
.due-info { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #C8D5E8; }
.due-amount { font-weight: 700; color: #E8EDF5; }
.due-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); }
.due-overdue .due-badge { color: #EF4444; }
.due-due .due-badge { color: #F59E0B; }
.due-upcoming .due-badge { color: #637285; }
.due-paid .due-badge { color: #22C55E; }
.pay-btn {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(26, 86, 219, 0.30);
  background: rgba(26, 86, 219, 0.12);
  color: #60A5FA;
  font-size: 12px;
  cursor: pointer;
}
.pay-form { display: flex; gap: 8px; margin-top: 10px; }
.pay-input {
  flex: 1;
  height: 40px;
  border-radius: 8px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #E8EDF5;
}
.pay-confirm-btn, .pay-cancel-btn {
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  border: none;
}
.pay-confirm-btn { background: #1A56DB; color: #fff; }
.pay-cancel-btn { background: rgba(255,255,255,0.08); color: #C8D5E8; }
.section-error { color: #EF4444; font-size: 12px; margin-top: 8px; }
</style>
```

> Note: `AppDialog` is used without an explicit import in the template above — confirm `CustomerDetailPage.vue` (which already imports `AppDialog` from `@/components/ui/AppDialog.vue`, per Task 12's Step 4 context) either passes it through, or add `import AppDialog from '@/components/ui/AppDialog.vue'` directly to this component's own `<script setup>` — components in this codebase import their own dependencies rather than relying on parent-provided globals, so add the import here.

- [ ] **Step 4: Mount it on `CustomerDetailPage.vue`**

In `src/features/customers/CustomerDetailPage.vue`, add the import near the other component imports:

```ts
import InstallmentPlanSection from './components/InstallmentPlanSection.vue'
```

In the template, add it right before the existing `<AuditHistory ...>` line (around line 260):

```vue
      <InstallmentPlanSection
        v-if="customer"
        :customer-id="route.params.id as string"
        :customer-name="customer.name"
        :customer-phone="customer.phone || customer.mobile"
        :shop-name="receiptSettings.shopName || 'المحل'"
      />
      <AuditHistory entity-type="customer" :entity-id="route.params.id as string" />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/customers/components/__tests__/InstallmentPlanSection.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Manually verify**

Run `npm run dev`, open a customer with an active installment plan (created via Task 11's flow), confirm: the plan summary shows, tapping "تسجيل دفعة" on a pending due records a payment and updates the due's status, tapping "إرسال تذكير" opens the WhatsApp preview sheet with the correct amount/date, and "إلغاء الخطة" voids remaining dues.

- [ ] **Step 7: Commit**

```bash
git add src/features/customers/components/InstallmentPlanSection.vue src/features/customers/CustomerDetailPage.vue src/features/customers/components/__tests__/InstallmentPlanSection.test.ts
git commit -m "feat: show active installment plan on customer detail with reminder/pay/cancel"
```

---

### Task 13: Dashboard card — "أقساط مستحقة" on `HomePage.vue`

**Files:**
- Modify: `src/pages/HomePage.vue:16-44` (imports + composable wiring), `:76-93` (mount), `:507-567` (signals-list template)

**Interfaces:**
- Consumes: `useInstallmentsDueAlert()` (Task 8).

- [ ] **Step 1: Wire the composable**

In `src/pages/HomePage.vue`, add the import near the other feature composable imports (around line 20):

```ts
import { useInstallmentsDueAlert } from '@/features/installments/composables/useInstallmentsDueAlert'
```

Add the composable instance near the other composable instances (around line 37):

```ts
const { count: installmentsDueCount, totalDueUsd: installmentsDueTotalUsd, allClear: installmentsAllClear, load: loadInstallmentsDue } = useInstallmentsDueAlert()
```

Add `loadInstallmentsDue()` to the `onMounted` `Promise.all` alongside `loadAlerts()` (around line 78):

```ts
    await Promise.all([loadRate(), loadDraft(), loadAlerts(), loadInstallmentsDue()])
```

- [ ] **Step 2: Add the signal-row**

In the template's `.signals-list` block (around line 549, right after the existing "open credit" `RouterLink`), add:

```vue
              <RouterLink
                to="/installments"
                class="signal-row"
                :class="installmentsAllClear ? 'sig-green' : 'sig-yellow'"
              >
                <span class="sig-dot" :class="installmentsAllClear ? 'dot-green' : 'dot-yellow'"></span>
                <div class="sig-body">
                  <div class="sig-main">
                    {{ installmentsAllClear ? 'لا أقساط مستحقة' : `${installmentsDueCount} أقساط مستحقة` }}
                  </div>
                  <div v-if="!installmentsAllClear" class="sig-sub">
                    ${{ installmentsDueTotalUsd.toFixed(2) }} إجمالي المستحق
                  </div>
                </div>
                <svg class="sig-arr" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </RouterLink>
```

- [ ] **Step 3: Manually verify**

Run `npm run dev`, open the home dashboard. Expected: with no installment plans, the card reads "لا أقساط مستحقة" in green; after creating an installment plan with a due today/overdue (via Task 11's flow, using a `start_date` in the past for testing), the card shows the count and total in yellow, and tapping it navigates to `/installments` (Task 14 builds that route — until then it 404s, which is expected at this point in the plan).

- [ ] **Step 4: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat: add installments-due card to the home dashboard"
```

---

### Task 14: `/installments` route — full due list

**Files:**
- Create: `src/features/installments/InstallmentsDuePage.vue`
- Modify: `src/router/index.ts` (add the route)
- Test: `src/__tests__/features/useInstallmentsDueAlert.test.ts` (no changes needed — this task is UI-only, consuming the already-tested composable)

**Interfaces:**
- Consumes: `useInstallmentsDueAlert()` (Task 8).

- [ ] **Step 1: Write `InstallmentsDuePage.vue`**

```vue
<!-- src/features/installments/InstallmentsDuePage.vue -->
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useInstallmentsDueAlert } from '@/features/installments/composables/useInstallmentsDueAlert'

const router = useRouter()
const { items, count, allClear, load } = useInstallmentsDueAlert()

onMounted(load)
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="الأقساط المستحقة" :show-back="true" @back="router.push('/')" />

    <div class="page-body">
      <div v-if="allClear" class="empty-card">
        <p class="empty-title">لا أقساط مستحقة</p>
      </div>

      <ul v-else class="due-list">
        <li v-for="item in items" :key="item.dueId" class="due-row">
          <RouterLink :to="`/customers/${item.customerId}`" class="due-link">
            <div class="due-main">
              <span class="due-customer">{{ item.customerName }}</span>
              <span class="due-date">{{ item.dueDate }}</span>
            </div>
            <span class="due-amount">${{ (item.amountDueUsd - item.amountPaidUsd).toFixed(2) }}</span>
          </RouterLink>
        </li>
      </ul>

      <p class="summary-count">{{ count }} قسط مستحق أو متأخر</p>
    </div>
  </div>
</template>

<style scoped>
.page-root { min-height: 100dvh; background: #06090F; color: #E8EDF5; font-family: 'Tajawal', system-ui, sans-serif; }
.page-body { padding: 16px; }
.empty-card { text-align: center; padding: 40px 16px; color: #637285; }
.empty-title { font-weight: 700; }
.due-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.due-row { border-radius: 12px; background: rgba(26, 86, 219, 0.08); border: 1px solid rgba(26, 86, 219, 0.18); }
.due-link { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; color: inherit; text-decoration: none; }
.due-main { display: flex; flex-direction: column; gap: 2px; }
.due-customer { font-weight: 700; }
.due-date { font-size: 12px; color: #637285; }
.due-amount { font-weight: 800; color: #60A5FA; }
.summary-count { margin-top: 12px; font-size: 13px; color: #637285; text-align: center; }
</style>
```

- [ ] **Step 2: Add the route**

In `src/router/index.ts`, add alongside the existing `/customers` routes:

```ts
{ path: '/installments', component: () => import('@/features/installments/InstallmentsDuePage.vue'), meta: { permission: 'can_manage_customers' } },
```

- [ ] **Step 3: Manually verify**

Run `npm run dev`, tap the "أقساط مستحقة" dashboard card (Task 13). Expected: `/installments` loads, lists every due/overdue installment sorted soonest-first (the composable's SQL already orders by `due_date ASC`), tapping a row navigates to that customer's detail page (where Task 12's section is mounted).

- [ ] **Step 4: Commit**

```bash
git add src/features/installments/InstallmentsDuePage.vue src/router/index.ts
git commit -m "feat: add /installments due-list page"
```

---

### Task 15: Full-suite build gate

**Files:**
- None (verification-only task)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test` (or `npx vitest run`)
Expected: every test in the repo passes, including all new files added in Tasks 1-14.

- [ ] **Step 2: Run the full build (type-checks tests too)**

Run: `npm run build`
Expected: no TypeScript errors anywhere, including in the new test files.

- [ ] **Step 3: Walk the golden path once on a real device/browser**

Ring a sale with the "تقسيط" method → confirm a plan with a down payment and 2-3 terms → open the customer's detail page and confirm the plan/due list render correctly → record a payment against the first due → send a WhatsApp reminder for the next due → cancel the plan and confirm remaining dues show "ملغى". Confirm the home dashboard's "أقساط مستحقة" card reflects the plan's state at each step. Confirm the sale's full total and margin show correctly in the Profit Report on the sale date (Definition of Done item from the spec) — no plan-related code should have touched profit/report logic, so this should already work; if it doesn't, that's a regression to investigate before considering this plan done.

- [ ] **Step 4: Commit (if Step 3 surfaced any fixes)**

```bash
git add -A
git commit -m "fix: address golden-path issues found in installment plans manual verification"
```

---

## Self-Review

**1. Spec coverage:**
- Data model (`installment_plan`, `installment_due`) → Task 1/2/3. ✅
- Core flow (payment method → schedule preview → plan+dues created → sale completes → receipt) → Tasks 5, 10, 11. ✅ (Receipt showing the plan summary is the one spec line NOT explicitly wired — see note below.)
- Per-due payment recording → Task 6, 12. ✅
- WhatsApp reminders (dashboard card + one-tap send) → Tasks 8, 9, 12, 13. ✅
- Report/dashboard integration (revenue/profit unchanged, cash position via existing customer_payments/Z-report, no new aggregation for "customers owe you") → verified by design in Task 1's migration notes and Task 15's manual walk; no code changes needed since this plan deliberately reuses `customer_payments`. ✅
- Edge cases: early payoff (plan auto-completes in `recordDuePayment`, Task 6) ✅; missed due (bucket computed as `overdue`, Task 3/8) ✅; partial payment (Task 6) ✅; cancellation voids remaining dues (Task 7) ✅; offline (every write goes through the existing `db.writeTransaction`/PowerSync pattern, no new sync logic) ✅; exchange rate drift (out of scope for down payment/dues since they're USD-only per this plan's simplification — see note below). 
- Definition of Done checklist → covered by Tasks 5-14's individual manual-verify steps + Task 15's end-to-end walk.

**Note — two deliberate scope simplifications not explicitly flagged as spec deviations until now:**
1. **Receipt plan summary.** The spec says "receipt shows the plan summary" — this plan does not modify `SaleConfirmationScreen.vue`'s receipt rendering. Adding it is a small follow-up (pass the created plan's summary text into the existing receipt data object) but is left out here to keep this plan's scope to the data model + core composables + one entry point (customer detail) for managing a plan, matching this plan's "smaller, well-bounded units" file structure. Flag this to the user as a known gap before merging, or add a Task 16 if they want it now.
2. **Down payment and due-collection currency.** The spec's data model marks amounts as USD-internal but doesn't explicitly forbid collecting a down payment or due payment in SYP. This plan hardcodes `currency = 'USD', method = 'cash'` for both (Tasks 5/6) to keep the composable simple — a cashier collecting SYP cash for a down payment would need to convert it to USD themselves before entering the amount. This mirrors this plan's own down-payment field being a single USD number in `InstallmentPlanForm.vue` (Task 11). If SYP collection turns out to matter in practice, extending `recordDuePayment`/`createPlan` to accept a `currency`/`amountRaw` pair (mirroring `PaymentAllocation`) is a contained follow-up.

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later" left in any step's actual code. The two `_dueId`/`_amountUsd`-prefixed stub bodies in Task 5 (`recordDuePayment`, `cancelPlan`, etc.) are intentional, temporary stubs explicitly replaced by name in Tasks 6/7 — not a placeholder left unresolved by the end of the plan.

**3. Scope check:** This is one coherent feature (installment plans) touching several existing subsystems (payment, customers, dashboard, audit, messaging) by necessity — the spec itself frames it as a single epic, and Epic 4/WhatsApp-messaging (its two dependencies) are already shipped, so no further decomposition is needed.

**4. Ambiguity check resolved inline:**
- The spec's `installment_due.status` enum (`upcoming|due|overdue|paid`) doesn't literally match this plan's stored `pending|paid|voided` — resolved explicitly in Task 3 as a deliberate, documented simplification (derive the display bucket at read time; no background scheduler exists in this architecture to keep a stored bucket fresh).
- The spec's edge case 4 ("remaining dues voided, not deleted") introduces a `voided` status not in the main due-status table — resolved by including `voided` in the actual `DueStatus`/`DueBucket` types from the start (Task 3), rather than treating the table and the edge case as contradictory.
- Task 6's test/implementation note about `db.getOptional` vs `tx.execute` for the "any dues left?" check is flagged explicitly as a decision point in Task 6's Step 3, rather than left ambiguous.
