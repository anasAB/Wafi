# Tier 2 — Accountability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the "see who's stealing" promise real for a shop with staff: an immutable audit log, hardened PINs, complete attribution, and the Manager role.

**Architecture:** Server-side enforcement of audit immutability (migration + trigger), client+schema PIN hardening, audit-event completeness, and a third role. Disjoint from the Tier-1 files — owns `audit/`, `staff/`, `router/permissions.ts`, and migrations 018+.

**Tech Stack:** Supabase Postgres (RLS, triggers), PowerSync, Vue 3 + Pinia, Vitest, TypeScript.

## Global Constraints
- Migrations expand-only and idempotent; never drop/rename live data (policies may be dropped/recreated).
- Offline-first: PIN entry and lockout must work offline (against cached data); audit writes queue and sync.
- Roles: `owner | cashier | manager`. Migration numbering continues from `017`: new files `018`, `019`, …
- The active operator already lives in `sessionStore` (switch-operator work) — read it from there, never re-introduce `shiftStore.activeStaff` for permissions.

## Parallel-safety note
Do NOT edit the Tier-1 files (`useDashboardMetrics.ts`, `useSalesChart.ts`, `useCashDrawer.ts`, `usePayment.ts`, `ProductPhotoUpload.vue`). If a task here needs an audit row written from a Tier-1-owned file, coordinate — otherwise stay in `audit/`, `staff/`, `router/`, migrations.

---

### Task 1 (WAFI-009): Make the audit log append-only at the database

**Files:**
- Create: `supabase/migrations/018_audit_log_append_only.sql`
- Read first: `supabase/migrations/005_audit_log_rls.sql:40-73`, `015_rls_tenant_scoping.sql:74-79` (these create the UPDATE/DELETE policies to remove)
- Modify (if needed): `src/data/powersync/connector.ts` — ensure audit_log is never PATCH/DELETE-uploaded.

**Problem:** `005` and `015` create UPDATE and DELETE RLS policies on `audit_log`, and `002` grants ALL. The log is fully mutable — the opposite of the requirement.

**Interfaces:** Produces an `audit_log` that rejects UPDATE and DELETE for `anon`/`authenticated`, enforced by both policy removal and a trigger.

- [ ] **Step 1: Write the migration** — `018_audit_log_append_only.sql`:

```sql
-- Wafi POS — audit_log is append-only. Remove the UPDATE/DELETE policies created
-- in 005/015, revoke the grants, and add a trigger that hard-blocks modification.
DROP POLICY IF EXISTS audit_log_update_all ON public.audit_log;
DROP POLICY IF EXISTS audit_log_delete_all ON public.audit_log;

REVOKE UPDATE, DELETE ON public.audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_log_block_modify()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON public.audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_modify();
```

- [ ] **Step 2: Apply it** in the Supabase SQL Editor. Expected: `Success`.
- [ ] **Step 3: Verify rejection** — as `authenticated` (impersonated), attempt `UPDATE public.audit_log SET event='x'` and `DELETE FROM public.audit_log` → both must error. Insert still works.
- [ ] **Step 4: Guard the sync path** — confirm `connector.ts` never sends PATCH/DELETE for `audit_log` (audit writes are inserts only). If a path could, exclude `audit_log` from non-PUT ops. Add/adjust a test if practical.
- [ ] **Step 5: Re-run migration 015 mentally/locally** — ensure 015 re-running does NOT recreate audit_log UPDATE/DELETE policies (it currently does at `015:74-79`). Patch 015 (or 018 must run after it) so audit_log is excluded from the generic UPDATE/DELETE policy loop. **Verify ordering: 018 runs after 015.**
- [ ] **Step 6: Commit** — `git commit -m "feat(audit): make audit_log append-only (WAFI-009)"`

---

### Task 2 (WAFI-014): Complete attribution + security events; stop swallowing audit failures

**Files:**
- Modify: `src/features/audit/composables/useAuditLog.ts` (the `catch → console.warn` swallow; add event helpers)
- Modify: `src/features/audit/audit.types.ts` (event union), `src/features/audit/audit.format.ts` (Arabic formatters)
- Modify: `src/features/staff/composables/useStaff.ts:127` (PIN change writes no audit row; owner-overwrite mislabeled)
- Test: `src/__tests__/features/useAuditLog.test.ts`, staff tests

**Interfaces:** Produces audit events `staff.pin_changed`, `auth.login_failed`, `auth.locked_out`; a failed audit write surfaces (toast/throw) rather than silently dropping; every audited action carries a real `staff_id` from `sessionStore.activeStaff` (now reliable post-switch-operator).

- [ ] **Step 1: Write failing tests** — (a) formatting each new event yields an Arabic sentence; (b) `updateStaffPin` produces a `staff.pin_changed` audit row; (c) an audit-write failure does not silently resolve (asserts it throws or signals).
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** — add the events to the union + formatters; have `updateStaffPin` log `staff.pin_changed` (and label owner-overwrite correctly, not `permissions_changed`); change the swallow so a failed sensitive-action audit write surfaces (re-throw or emit an error the UI shows). Ensure the author `staff_id` comes from `sessionStore.activeStaff`.
- [ ] **Step 4: Run, verify they pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(audit): pin-change + auth events; surface audit-write failures (WAFI-014)"`

---

### Task 3 (WAFI-012): PIN brute-force lockout + salted hashing

**Files:**
- Create: `supabase/migrations/019_staff_pin_salt.sql` (add a per-staff salt column)
- Modify: `src/features/staff/composables/usePinAuth.ts` (hashing), consumers that set/verify PINs (`useStaff.ts`, `StaffForm.vue`)
- Modify: lockout state — persist attempts/lockout (e.g. in `device.store.ts` or a small store) so it survives reload
- Modify: `src/data/powersync/schema.ts` staff table (+ salt column) — coordinate (this is a schema file; you own staff changes, dev #1 isn't touching it)
- Test: `src/features/staff/composables/__tests__/usePinAuth.test.ts`

**Problem:** unsalted SHA-256 of a 4-digit PIN, synced to the cloud; no attempt limiting.

**Interfaces:** Produces salted PIN hashing (per-staff salt) and a lockout: N wrong attempts → timed lockout, persisted, with an `auth.locked_out` audit event (Task 2).

- [ ] **Step 1: Write failing tests** — (a) two staff with the same PIN produce different hashes (salted); (b) after N wrong attempts `verify`/the prompt reports locked out; (c) lockout persists across a store reload.
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Migration** — `019_staff_pin_salt.sql`: `ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS pin_salt TEXT;` and add `pin_salt: column.text` to the staff table in `schema.ts`.
- [ ] **Step 4: Implement hashing** — generate a random per-staff salt on PIN set; hash `salt + pin`; store both. Existing PINs rehash on next set (document: pre-existing unsalted hashes verified until reset, or force-reset on first login — pick one and note it).
- [ ] **Step 5: Implement lockout** — track attempts; after N (e.g. 5) lock for a cooldown; persist; emit `auth.locked_out`. Reset on success.
- [ ] **Step 6: Run, verify pass.**
- [ ] **Step 7: Commit** — `git commit -m "feat(staff): salted PIN hashing + brute-force lockout (WAFI-012)"`

---

### Task 4 (WAFI-013): Manager role

**Files:**
- Create: `supabase/migrations/020_staff_role_manager.sql` (widen the role CHECK)
- Modify: `src/features/staff/staff.types.ts` (role union + permission matrix), `StaffForm.vue` (role picker), `router/permissions.ts` + `AppSidebar.vue` (handle three roles)
- Test: `src/__tests__/router/permissions.test.ts`, staff tests

**Problem:** brief says Owner/Manager/Cashier; code has only `owner | cashier`.

**Interfaces:** Produces a `manager` role: cashier permissions + edit products + view revenue/profit/reports; cannot manage staff or change settings.

- [ ] **Step 1: Write failing tests** — a manager session: allowed on `/products` and reports; redirected from `/settings/staff` and `/settings` (settings mgmt).
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Migration** — `020_staff_role_manager.sql`: drop+recreate the `staff.role` CHECK to include `'manager'` (idempotent; expand-only on values):

```sql
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE public.staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('owner','cashier','manager'));
```

- [ ] **Step 4: Implement** — add `'manager'` to the role union and define its permission matrix; surface it in `StaffForm`'s role picker; ensure `permissions.ts`/`AppSidebar` gate correctly for all three (they read `sessionStore` already).
- [ ] **Step 5: Run, verify pass.** Also update the Epic-5 spec note that Manager is now built.
- [ ] **Step 6: Commit** — `git commit -m "feat(staff): add Manager role (WAFI-013)"`

---

## Self-Review
- WAFI-009 → Task 1 ✓ · WAFI-014 → Task 2 ✓ · WAFI-012 → Task 3 ✓ · WAFI-013 → Task 4 ✓
- Migration numbers 018/019/020 follow 017; no collision with Tier 1 (Tier 1 adds no migrations).
- Files are disjoint from Tier 1 — safe to run in parallel.
- Reads-before-edit: migrations 005/015 (Task 1), `usePinAuth` + staff consumers (Task 3), `permissions.ts` matrix (Task 4). Match existing signatures.
- Embedded decision: Task 3 — how to handle pre-existing unsalted PIN hashes (verify-until-reset vs force-reset). Pick and document before coding.
- Note: full server-side role enforcement (WAFI-010) is deferred; this tier makes the audit log the real defense, which is the agreed v1 posture.
