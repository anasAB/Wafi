# Switch Operator (no shift change) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators (owner/staff) swap at the register via a quick PIN re-auth without closing/opening the cash shift, with correct per-operator sale attribution.

**Architecture:** Make `sessionStore.activeStaff` the single source of truth for the *active operator* (fixing the WAFI-011 split), keep `shiftStore` for the *shift only*, add `sales.staff_id` so each sale records who completed it, and add a "Switch operator" action that re-uses the existing PIN prompt and leaves the open shift untouched.

**Tech Stack:** Vue 3 + Pinia, PowerSync + Supabase (Postgres), Vitest, TypeScript.

## Global Constraints

- Migrations are expand-only and idempotent (`IF NOT EXISTS`); never drop/rename live data.
- Offline-first must hold: switching authenticates against the locally cached PIN hash; no network call required.
- Plain-language Arabic for user-facing strings (e.g. "تبديل المستخدم").
- Roles are `owner | cashier | manager` (manager per WAFI-013); permission checks must handle all three.
- Migration numbering continues from existing `016`: new file is `017`.

---

### Task 1: Add `sales.staff_id` (per-operator attribution column)

**Files:**
- Create: `supabase/migrations/017_sales_staff_id.sql`
- Modify: `src/data/powersync/schema.ts:32-49` (the `sales` table)

**Interfaces:**
- Produces: `public.sales.staff_id uuid` (nullable, FK → `staff.id`) — read by the Z-report (Task 5), written at sale confirm (Task 4).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/017_sales_staff_id.sql`:

```sql
-- Wafi POS — Record which operator completed each sale, so one shift can be
-- broken down per operator (operator switching, no shift change). Nullable +
-- expand-only: existing rows stay valid; shift_id remains the cash-period link.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff(id);
```

- [ ] **Step 2: Apply the migration**

Run the file in the Supabase SQL Editor. Expected: `Success. No rows returned`.
`sales` is already in the PowerSync publication (migration 010), so no publication change is needed.

- [ ] **Step 3: Add the column to the client schema**

In `src/data/powersync/schema.ts`, inside the `sales = new Table({ ... })` block, add:

```ts
  staff_id:                 column.text,   // operator who completed the sale (nullable)
```

- [ ] **Step 4: Verify the app still builds/syncs**

Run: `npx vue-tsc --noEmit -p tsconfig.json`
Expected: exit 0. Manually confirm a sale still syncs (no schema-mismatch error in console).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/017_sales_staff_id.sql src/data/powersync/schema.ts
git commit -m "feat(sales): add staff_id for per-operator attribution"
```

---

### Task 2: Make `sessionStore` the single active-operator source (WAFI-011)

**Files:**
- Modify: `src/store/session.store.ts`
- Modify: `src/router/permissions.ts`, `src/router/index.ts:47-51`
- Modify: `src/components/layout/AppSidebar.vue:35-51`, `src/components/layout/AppBottomNav.vue` (same `shiftStore`→`sessionStore` repoint)
- Test: `src/__tests__/store/session.store.test.ts`

**Interfaces:**
- Consumes: `Staff`, `StaffPermissions` from `@/features/staff/staff.types`.
- Produces: `useSessionStore()` now exposes `activeStaff`, `permissions: StaffPermissions | null`, `setActiveStaff(staff)`, `clearSession()`. The route guard and nav read the active operator from **here**, not `shiftStore`.

> Why: today login writes `sessionStore.activeStaff` but the guard/nav read `shiftStore.activeStaff` (only set on shift open) → guards fail open and permissions don't re-scope. Switching can't work until the operator lives in one place.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/store/session.store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '@/store/session.store'

const cashier = { id: 's1', name: 'Sami', role: 'cashier',
  permissions: { can_manage_products: false } } as any

describe('sessionStore.permissions', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('is null with no active staff', () => {
    expect(useSessionStore().permissions).toBeNull()
  })
  it('reflects the active staff permissions', () => {
    const s = useSessionStore()
    s.setActiveStaff(cashier)
    expect(s.permissions?.can_manage_products).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/__tests__/store/session.store.test.ts`
Expected: FAIL — `permissions` is not exported by `sessionStore`.

- [ ] **Step 3: Add the `permissions` getter to `sessionStore`**

In `src/store/session.store.ts`, add a computed and export it:

```ts
import { computed, ref } from 'vue'
// ...
  const permissions = computed<StaffPermissions | null>(() => activeStaff.value?.permissions ?? null)
// ...
  return { activeStaff, permissions, setActiveStaff, clearSession }
```

(Add `import type { Staff, StaffPermissions } from '@/features/staff/staff.types'`.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/__tests__/store/session.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Repoint the route guard to `sessionStore` and fail closed**

In `src/router/index.ts`, replace the `useShiftStore().activeStaff` read with `useSessionStore().activeStaff`. In `src/router/permissions.ts`, change the null-staff branch so a permission-gated route with no active staff returns **false** (redirect), not `true`.

- [ ] **Step 6: Repoint the nav components**

In `AppSidebar.vue` and `AppBottomNav.vue`, replace `shiftStore.permissions` / `shiftStore.activeStaff` reads with `useSessionStore()` equivalents. Leave `shiftStore` usage that is genuinely about the *shift* (e.g. `isShiftOpen`) alone.

- [ ] **Step 7: Update the permissions guard test + run the suite**

Update `src/__tests__/router/permissions.test.ts` so the null-staff-on-gated-route case asserts a redirect. Run: `npx vitest run` and `npx vue-tsc --noEmit`. Expected: all pass, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/store/session.store.ts src/router/ src/components/layout/ src/__tests__/
git commit -m "fix(auth): single active-operator source in sessionStore; guard fails closed (WAFI-011)"
```

---

### Task 3: `operator.switched` audit event

**Files:**
- Modify: `src/features/audit/audit.types.ts` (event union), `src/features/audit/audit.format.ts` (Arabic formatter)
- Modify: `src/features/audit/composables/useAuditLog.ts` (if a typed helper per event exists)
- Test: `src/__tests__/features/useAuditLog.test.ts`

**Interfaces:**
- Produces: an audit row with `event: 'operator.switched'`, `meta` carrying `{ from_staff_id, from_name, to_staff_id, to_name }`. Consumed by the audit history UI and called from Task 4.

- [ ] **Step 1: Write the failing test**

Add a case to `src/__tests__/features/useAuditLog.test.ts` asserting that formatting an `operator.switched` entry produces an Arabic sentence naming both operators, e.g. `"تبديل المستخدم: من <from> إلى <to>"`.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts`
Expected: FAIL — event/formatter not handled.

- [ ] **Step 3: Add the event + formatter**

Add `'operator.switched'` to the event union in `audit.types.ts`, and a branch in `audit.format.ts` rendering the Arabic sentence from `meta.from_name`/`meta.to_name`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/__tests__/features/useAuditLog.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/audit/ src/__tests__/features/useAuditLog.test.ts
git commit -m "feat(audit): operator.switched event + Arabic formatter"
```

---

### Task 4: Switch-operator action (account menu → PIN prompt)

**Files:**
- Modify: the header account menu (in `AppSidebar.vue` bottom section / the header component that renders the account entry) — add a "تبديل المستخدم" action.
- Modify: `src/features/shifts/components/LockScreen.vue` (reused as the switch surface) to support a "switch" mode that, on successful PIN, calls `sessionStore.setActiveStaff(staff)` + emits an `operator.switched` audit row, **without** opening/closing a shift.
- Modify: `src/features/payment/usePayment.ts` — see Task 4b note.
- Test: `src/features/staff/composables/__tests__/` — add a unit test for the switch handler (extract the switch logic into a small composable `useOperatorSwitch.ts` so it is testable without mounting the screen).

**Interfaces:**
- Consumes: `useSessionStore().setActiveStaff`, `useShiftStore()` (read-only — must NOT call `openShift`/`closeShift`), the audit logger from Task 3, the existing PIN-verify util (`usePinAuth`).
- Produces: `useOperatorSwitch().switchTo(staff: Staff): Promise<void>` — sets the active operator and writes the audit row; never touches the shift.

- [ ] **Step 1: Write the failing test**

Create `src/features/staff/composables/__tests__/useOperatorSwitch.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

describe('useOperatorSwitch', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('sets the new active operator and does NOT touch the shift', async () => {
    const { useSessionStore } = await import('@/store/session.store')
    const { useShiftStore }   = await import('@/features/shifts/shift.store')
    const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

    const shift = useShiftStore()
    const closeSpy = vi.spyOn(shift, 'closeShift')
    const owner = { id: 'o1', name: 'Owner', role: 'owner', permissions: {} } as any

    await useOperatorSwitch().switchTo(owner)

    expect(useSessionStore().activeStaff?.id).toBe('o1')
    expect(closeSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/features/staff/composables/__tests__/useOperatorSwitch.test.ts`
Expected: FAIL — `useOperatorSwitch` does not exist.

- [ ] **Step 3: Implement `useOperatorSwitch`**

Create `src/features/staff/composables/useOperatorSwitch.ts`:

```ts
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import type { Staff } from '@/features/staff/staff.types'

export function useOperatorSwitch() {
  const session = useSessionStore()
  const audit = useAuditLog()

  async function switchTo(staff: Staff): Promise<void> {
    const from = session.activeStaff
    session.setActiveStaff(staff)        // shift is intentionally NOT touched
    await audit.log('operator.switched', {
      entity_type: 'staff', entity_id: staff.id,
      meta: { from_staff_id: from?.id ?? null, from_name: from?.name ?? null,
              to_staff_id: staff.id, to_name: staff.name },
    })
  }

  return { switchTo }
}
```

(Confirm the exact `useAuditLog().log(...)` signature against the existing composable and match it.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/features/staff/composables/__tests__/useOperatorSwitch.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the UI**

Add a "تبديل المستخدم" item to the header account menu. On tap, present the existing pick-your-face + PIN prompt (`LockScreen` in a "switch" mode). On a verified PIN for the selected staff, call `useOperatorSwitch().switchTo(staff)` and dismiss. On cancel, dismiss with no change. Do not call `openShift`/`closeShift` anywhere in this path.

- [ ] **Step 6: Manual verification**

Sign in, open a shift. Use Switch → pick a different staff → enter PIN. Confirm: the active operator changed, the sidebar/permissions re-scoped, the shift stayed open (no cash-count prompt), and an `operator.switched` row appears in the audit log. Switch back to owner requires the owner PIN. Verify it works with the network off.

- [ ] **Step 7: Commit**

```bash
git add src/features/staff/ src/features/shifts/components/LockScreen.vue src/components/layout/
git commit -m "feat(staff): switch operator without changing the shift"
```

#### Task 4b: stamp `staff_id` on sale confirm

- [ ] **Step 8: Stamp the operator at confirm**

In `src/features/payment/usePayment.ts`, where the sale row is written, set `staff_id` from `useSessionStore().activeStaff?.id` (the operator active at confirmation — the attribution rule). Add/extend a test asserting a confirmed sale row carries the current active operator's id. Run `npx vitest run` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/payment/usePayment.ts src/__tests__/
git commit -m "feat(payment): attribute sale to the active operator at confirm"
```

---

### Task 5: Z-report per-operator breakdown

**Files:**
- Modify: `src/features/shifts/composables/useZReport.ts`
- Modify: `src/features/shifts/components/ZReportScreen.vue` (render the breakdown)
- Test: `src/features/shifts/composables/__tests__/useZReport.test.ts`

**Interfaces:**
- Consumes: `sales.staff_id` (Task 1), `staff.name`.
- Produces: the Z-report result gains a `byOperator: Array<{ staff_id, name, salesCount, totalUsd }>` field; cash variance remains a single shift-level figure (unchanged).

- [ ] **Step 1: Write the failing test**

Add a case to `useZReport.test.ts`: given a shift with sales by two `staff_id`s, the report's `byOperator` has two entries with correct per-operator counts/totals, and the shift cash variance is unchanged (single figure).

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/features/shifts/composables/__tests__/useZReport.test.ts`
Expected: FAIL — `byOperator` not present.

- [ ] **Step 3: Implement the breakdown**

In `useZReport.ts`, add a query that groups the shift's sales by `staff_id` joined to `staff.name`, producing `byOperator`. Do not change the existing cash-reconciliation math.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/features/shifts/composables/__tests__/useZReport.test.ts`
Expected: PASS.

- [ ] **Step 5: Render it**

In `ZReportScreen.vue`, add a "المبيعات حسب المستخدم" (sales by operator) section listing `byOperator`. Keep the single cash-variance figure as-is.

- [ ] **Step 6: Commit**

```bash
git add src/features/shifts/ src/__tests__/
git commit -m "feat(shifts): Z-report per-operator sales breakdown"
```

---

## Self-Review

**Spec coverage:**
- One shift per session; operators swap inside it → Tasks 2 + 4 (no shift open/close in the switch path) ✓
- Cart + locked rate preserved across switch → no code clears the cart on switch (switch only calls `setActiveStaff`); verified in Task 4 Step 6 ✓
- Attribution = operator who completes the sale → Task 1 (`staff_id`) + Task 4b (stamp at confirm) ✓
- Trigger = account menu → reuse PIN prompt → Task 4 Steps 5 ✓
- Escalation to owner requires owner PIN → inherent (you authenticate as the target) ✓
- Audit `operator.switched` → Task 3 + Task 4 ✓
- Z-report per-operator breakdown → Task 5 ✓
- Offline switch (cached hash) → Task 4 Step 6 verification ✓
- Permissions re-scope on switch → Task 2 (single store, guard fails closed) ✓
- Dependency on WAFI-011 → made explicit and resolved as Task 2 ✓

**Known reads-before-edit for the implementer:** confirm the exact `useAuditLog().log(...)` signature (Task 3/4), the sale-write block in `usePayment.ts` (Task 4b), and the current `LockScreen.vue` props/emit shape before adding "switch" mode (Task 4). Match existing signatures rather than inventing new ones.

**Scope:** single feature, one shift model, no idle auto-lock, no dedicated switcher screen, client-side permission re-scope only (server-side is the Role-Enforcement epic).
