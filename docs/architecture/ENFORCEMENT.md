# ENFORCEMENT.md — PR checklist, CI setup, security baselines

> Cited by CLAUDE.md. The **how we verify it before merge** companion to PRINCIPLES.md (how)
> and PATTERNS.md (what). Run §1 on every PR review.
> Last updated: 2026-06-23.

---

## 1. PR review checklist

Run the full list on every PR. A "no" on any line blocks merge until resolved or explicitly
waived with a reason in the PR.

### Correctness & tests
- [ ] `npm run test` passes (vitest, jsdom, `fake-indexeddb`; ~73 test files today).
- [ ] `npm run build` passes — **this is also the type gate**: `build` runs `vue-tsc -b` and
      type-checks tests, so a TS error *in a test* blocks the whole build even though `npm run
      dev` would still run. Never merge on a green dev server alone.
- [ ] Business logic changed (store, composable, money math, a guard) → unit tests added/updated.
- [ ] Edge cases covered: empty/zero/negative inputs, missing exchange rate, no stock,
      offline-before-first-sync, duplicate receipt number after reinstall, partial sync.
- [ ] Money invariants preserved (§ below / PATTERNS.md §6): cash totals derive from
      `sale_payments`; `amount_usd` is net-of-change; a credit sale writes **no** payment row;
      returns reverse revenue **and** COGS; reconciliation is per-currency.

### Architecture boundaries (do NOT merge a violation)
- [ ] Cross-feature imports go through `index.ts` only — no reaching into another feature's
      private files (ADR-003).
- [ ] No `db.execute()` / SQL in a `.vue` component for business reads/writes — it lives in a
      store/composable (PRINCIPLES.md §3).
- [ ] No direct `fetch`/HTTP on a POS-critical path (ADR-004).
- [ ] No `localStorage` for store persistence; `persist: true` only on settings/session stores
      (ADR-005). Transactional state is not persisted.
- [ ] No new top-level library without an ADR (PRINCIPLES.md §5).
- [ ] SOLID checklist (PRINCIPLES.md §2) holds for new classes/composables/functions.

### i18n & UX
- [ ] No string literals in templates — all UI text via i18n keys in `ar.ts` (primary) +
      `en.ts` (fallback), namespaced by feature.
- [ ] RTL-correct and renders in both light and dark.
- [ ] Reused an existing `src/components/ui/` component rather than duplicating one (DRY).
- [ ] Errors surfaced to the user are localized Arabic, not raw English/typed-error messages.

### Security (see §3)
- [ ] All SQL parameterized; no string-built queries.
- [ ] No `v-html` on user/customer-supplied data.
- [ ] No secrets/keys/tokens added to source or committed env files.
- [ ] Tenant-scoped queries filter by `shop_id`; new synced tables have RLS + are in the
      PowerSync publication.

### Database
- [ ] Schema change ships as a new sequential, **idempotent** migration in
      `supabase/migrations/` (re-runnable: `drop if exists` / `create or replace`).
- [ ] New synced table added to the publication migration and given RLS scoped via
      `public.auth_shop_id()` (mirror migration 015).
- [ ] `audit_log` remains append-only (no UPDATE/DELETE paths).

### Hygiene
- [ ] No `// TODO: implement` stubs; the real logic is present.
- [ ] Comments explain *why*, not *what*; comment density matches surrounding code.
- [ ] No leftover `console.log` outside intentional driver/dev paths.

---

## 2. CI setup (current state + target)

**What exists today**
- `npm run test` — Vitest, jsdom, globals, `src/__tests__/setup.ts` registers the real i18n +
  PrimeVue (Aura) instances and stubs `localStorage`/`matchMedia`. Tests live in
  `src/**/*.{test,spec}.ts`.
- `npm run build` — `vue-tsc -b && vite build`. Doubles as the type-check gate (incl. tests).
- `npm run type-check:test` — `vue-tsc -p tsconfig.vitest.json --noEmit` for test-only types.
- `npm run lint` / `npm run lint:fix` — ESLint flat config (`eslint.config.js`): Vue 3
  `flat/recommended` + `@typescript-eslint` (parsing `<script lang="ts">` via the TS parser) +
  the curated project rules. Prettier formatting is kept out of lint via
  `@vue/eslint-config-prettier/skip-formatting`. `lint` exits non-zero on any **error**;
  warnings (currently ~287, mostly `vue/attributes-order` and stray `no-explicit-any`) do not
  fail the gate — chip away at them with `lint:fix` over time.

**Run before every push (local gate, until CI is wired):**
```bash
npm run lint && npm run test && npm run build
```

**Target CI pipeline (GitHub Actions / Vercel checks) — to wire up:**
1. `npm ci`
2. `npm run lint`
3. `npm run test`
4. `npm run build` (type-check + bundle)
5. Block merge on any red.

**Known gaps (tracked so they aren't forgotten):**
- **Boundary enforcement is manual** (the §1 checklist). ADR-003 anticipates an import linter;
  add an ESLint `no-restricted-imports`/boundaries rule or `dependency-cruiser` to enforce
  "cross-feature imports via `index.ts` only" mechanically. Until then it's reviewer-enforced.
- **~287 lint warnings** remain in existing code (style-level, non-blocking). Drive these to
  zero incrementally; once low, consider promoting the load-bearing ones to `error`.
- **Core JS recommended rules** (`@eslint/js`) are not wired in — the config relies on the
  TS-plugin recommended set + curated rules. Add `@eslint/js` + `js.configs.recommended` if a
  fuller base is wanted (note: that turns on `no-undef`, which needs `globals` configured).

---

## 3. Security baselines

- **Secrets never in source.** Supabase URL/anon key and any service keys come from env
  (`VITE_*` for client-public values only — never put a service-role key in a `VITE_*` var,
  it ships to the browser). `.env*` files stay gitignored. Server-side/service secrets live in
  Vercel/Cloudflare env, not the repo.
- **SQL injection:** bound parameters only (`db.execute(sql, params)`). No template-string SQL.
  This holds for both PowerSync queries and any Supabase RPC.
- **XSS:** rely on Vue's default escaping. `v-html` is forbidden on any user/customer-supplied
  content; if it's ever needed for trusted, fixed markup, document why at the call site.
- **Tenant isolation is defense-in-depth:**
  1. DB RLS via `public.auth_shop_id()` (`shops.owner_user_id → auth.uid()`) on every synced
     table (migration 015) — the authoritative guard.
  2. PowerSync sync rules scope by the same mapping — a device only ever syncs its shop's rows.
  3. Client queries scope by `shop_id` for correctness/indexing, not as the security boundary.
  Verify isolation with `set local role authenticated` + a `request.jwt.claims` GUC — **not** a
  bare query as the table owner / `postgres`, which bypasses RLS.
- **Auth:** single Supabase client (`src/data/supabase/client.ts`). Single-device provisioning
  model (see project memory). Role/permission checks are enforced server-side (staff roles,
  migrations 019/020), not just hidden in the UI.
- **Append-only audit:** `audit_log` accepts inserts only (migration 018). Never add an
  update/delete path; tamper-evident chaining is a v2 item (CLAUDE.md).
- **Input validation** happens in the store/composable layer before persistence (e.g. reject
  negative/NaN prices, clamp quantities to available stock). Don't trust the component to have
  validated.

---

## 4. Feature-flag discipline

- Build-time flags live in `src/config/featureFlags.ts`, overridable via `VITE_FF_*` env.
- **A flag stays `false` until the feature has real code behind it.** Flip it to `true` in the
  *same* change that ships the feature — never advertise/expose a capability that doesn't exist
  (e.g. `electronicsPro` is `false` until the Electronics Pro pack is built).
- Per-customer flags (needed for the Option C modular packs in CLAUDE.md) are a **separate,
  later** mechanism (a Postgres flag table or GrowthBook, per CLAUDE.md week-1 item #3). Choose
  and wire it before v1 modular billing ships. The build-time flag here is only the cheapest
  rung, for pre-auth surfaces (e.g. the marketing landing page) where there is no customer yet.

---

## 5. Definition of Done

A change is done when:
- [ ] §1 checklist passes.
- [ ] `npm run test && npm run build` are green locally.
- [ ] Any new library or load-bearing decision has an ADR.
- [ ] User-facing strings are in `ar.ts` + `en.ts` and render RTL in light + dark.
- [ ] No stubs, no secrets, no boundary violations.
- [ ] If it touches money, sync, or tenancy, the relevant invariant is covered by a test.
