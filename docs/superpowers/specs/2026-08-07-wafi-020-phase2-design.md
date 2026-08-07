# WAFI-020 (Phase 2): Authenticated Lighthouse CI, Operation Benchmarks & Android Runbook — Design

**Date:** 2026-08-07
**Status:** Approved direction, ready for spec self-review
**Scope:** Phase 2 of WAFI-020 (Performance & Load Testing) — the three pieces
Phase 1 (`docs/superpowers/specs/2026-07-30-wafi-020-lighthouse-ci-design.md`)
explicitly deferred: authenticated-route Lighthouse audits, operation
benchmarks, and a cheap-Android-device testing runbook.

## Problem

Phase 1 shipped Lighthouse CI for exactly one page — `/welcome` — because it is
the only route reachable with no login session. Every route that actually
matters to a cashier or owner (`/pos`, `/products`, `/`) requires
authentication, and Phase 1 explicitly named the prerequisites as follow-up
work: a persistent CI test account, a scripted login, and a saved
authenticated session. Separately, no benchmark of any specific operation
exists (the ticket's own example: "load POS with 2,000 products"), and no
real-device testing procedure exists despite Sacred Rule #3 committing to
acceptable performance on cheap Android hardware.

## Cross-Epic Edge-Case Checklist (design time)

```
Domains touched: Products (read-only seed data for benchmarking), none of the
  financial/customer/staff domains — this is CI tooling, not a shipped feature.
Matrix rows consulted: n/a — this ticket adds no production code path; it adds
  CI infrastructure that reads/seeds a dedicated non-production-use shop's
  product catalog. No DOMAIN INTERACTION MATRIX row applies.
Open cross-feature questions: none identified — the CI test shop is isolated
  by shop_id scoping (RLS applies identically to it as any real shop) and no
  other shop's data is read or written by any script in this design.
```

## Decisions carried over from clarification

- All three sub-scopes (authenticated Lighthouse, benchmarks, Android runbook)
  are covered by this one design.
- No new e2e framework (no Playwright). Authenticated audits and benchmarks
  both use `puppeteer-core` directly — already a transitive dependency of
  `@lhci/cli` — via LHCI's own `puppeteerScript` hook and a standalone
  benchmark script, respectively.
- CI test account lives in **production Supabase** (not a second disposable
  project), as a real signed-up shop, clearly named, with its `shop_id`
  hardcoded as an equality check inside every script that writes to it —
  a leaked or misconfigured secret cannot cause a write to any other shop,
  because the script's own source must also agree on the expected ID.
- Both the authenticated Lighthouse audits and the operation benchmarks are
  **informational-only** — `continue-on-error`, no pass/fail threshold —
  matching Phase 1's precedent, since no baseline exists yet for either.
- Login uses **direct session injection** (headless `signInWithPassword`,
  write the resulting `sb-<ref>-auth-token` into `localStorage` before page
  load), not driving the real login form — faster, and doesn't couple a
  performance check's stability to unrelated login-UI changes.
- Benchmark suite covers exactly three operations: POS load with a
  2,000-product catalog, checkout/confirm-sale, Dashboard load.

## 1. Shared infrastructure: CI test shop

**One-time manual setup** (not scripted, done once by a human): sign up a real
owner account in production Supabase via the normal flow, named unambiguously
(e.g. shop name `"WAFI CI TEST — DO NOT DELETE"`, phone
`+00000000001`). Its `shop_id` is captured once and stored as a GitHub Actions
secret (`CI_TEST_SHOP_ID`), alongside `CI_TEST_PHONE`/`CI_TEST_PASSWORD` for
headless login. This mirrors how `bootstrap_owner_identity()` is the only
sanctioned way shops get created (confirmed via code audit — shop/staff/device
provisioning is server-side-only, triggered by real signup; no script in this
design creates a shop directly).

### `scripts/get-ci-session.mjs`

Headless `supabase.auth.signInWithPassword({ phone: CI_TEST_PHONE, password:
CI_TEST_PASSWORD })` against the production project, writes the resulting
session JSON to a local file (`.ci-session.json`, gitignored, workflow-local
only). Both the Lighthouse authenticated-audit job and the benchmark job
depend on this running first and consume the same file — one login call, not
duplicated per job.

### `scripts/seed-ci-benchmark-data.mjs`

Follows the existing `scripts/generate-mock-seed-sql.mjs` convention (raw
batched `INSERT INTO products (...) VALUES (...), (...), ...;` SQL applied
directly, bypassing PowerSync — the existing script's own rationale for why
2,000 rows through PowerSync's per-row local-transaction-plus-async-upload
path is the wrong tool applies identically here).

- **Guard**: refuses to run unless `process.env.CI_TEST_SHOP_ID` matches a
  second, hardcoded expected value baked into the script's own source. Two
  independent places have to agree before any write happens.
- Seeds ~2,000 products tagged `created_via: 'ci_benchmark_seed'`, scoped to
  `shop_id = CI_TEST_SHOP_ID`.
- **Idempotent**: checks for existing `created_via = 'ci_benchmark_seed'` rows
  for that shop before inserting again — repeated CI runs never accumulate
  duplicate catalogs.
- Run once per relevant CI job; both the authenticated-Lighthouse job and the
  benchmark job depend on this catalog existing (auditing `/pos`/`/products`
  against a populated catalog is more representative than against an empty
  one, not only the benchmark's concern).

## 2. Phase 2a: Authenticated Lighthouse audits

**Two separate LHCI config files, not one merged list** — required by a
concrete guard behavior confirmed in `src/router/index.ts`:

```ts
// router/index.ts (existing, unchanged)
if (!isAuthenticated && !PUBLIC_PATHS.includes(to.path)) return '/welcome'
if (isAuthenticated && PUBLIC_PATHS.includes(to.path)) return '/'
```

An authenticated visitor requesting `/welcome` is redirected to `/`. A single
config auditing `["/welcome", "/", "/pos", "/products"]` with a global session
injection would silently audit `/` twice (once under the `/welcome` URL) and
never measure the actual logged-out page — the exact "auth-wall" mistake
Phase 1's design avoided, in reverse. Splitting into two files removes the
possibility structurally rather than relying on remembering not to combine
them.

```json
// .lighthouserc.public.json (Phase 1's config, renamed, unchanged behavior)
{
  "ci": {
    "collect": {
      "staticDistDir": "./dist",
      "isSinglePageApplication": true,
      "url": ["http://localhost/welcome"]
    }
  }
}
```

```json
// .lighthouserc.authenticated.json (new)
{
  "ci": {
    "collect": {
      "staticDistDir": "./dist",
      "isSinglePageApplication": true,
      "url": [
        "http://localhost/",
        "http://localhost/pos",
        "http://localhost/products"
      ],
      "puppeteerScript": "./scripts/lhci-auth-setup.mjs"
    }
  }
}
```

`scripts/lhci-auth-setup.mjs` reads `.ci-session.json` (written by
`get-ci-session.mjs`) and, via `page.evaluateOnNewDocument`, injects the
`sb-<ref>-auth-token` key into `localStorage` before each of the three
authenticated URLs loads.

The GitHub Actions workflow (`lighthouse-ci.yml`) gains a second job (or a
second step sequence) that: runs `get-ci-session.mjs` and
`seed-ci-benchmark-data.mjs`, then runs `treosh/lighthouse-ci-action` a second
time with `configPath: './.lighthouserc.authenticated.json'`. Same
`continue-on-error: true`, `runs: 1` as Phase 1.

**Deliberate scope note on `temporaryPublicStorage: true`**: authenticated
reports now contain the CI test shop's synthetic product names/prices in
report screenshots. Since this is CI-only synthetic data with no real
customer information, uploading it to Lighthouse's public temporary storage
is acceptable — stated explicitly here as a considered decision, not an
oversight.

## 3. Phase 2b: Operation benchmarks

**New script: `scripts/benchmark-operations.mjs`**, run as its own CI job
(separate from the Lighthouse workflow — different tool, different failure
mode, no reason to couple their pass/fail semantics). Uses `puppeteer-core`
directly plus the same `.ci-session.json` injection as 2a.

### Prerequisite: instrumentation hooks (Task 0)

A repo-wide check found none of the three flows have `data-testid` markers a
benchmark script can reliably target — the closest existing hooks
(`fast-cash-usd`/`fast-cash-syp` in `SalePanel.vue`,
`profit-estimated-badge` in `HomePage.vue`) don't cover what's needed. Adding
these is a small, explicit, behavior-neutral prerequisite task — matching
the pattern `LoginPage.vue` already uses (`data-testid="login-phone"` etc.) —
not scope creep, since the alternative is polling CSS classes that
`DESIGN_SYSTEM.md` (WAFI-005) already documents as subject to drift:

| File | Addition |
|---|---|
| `src/features/pos/ProductGrid.vue` | `data-testid="product-grid"` on the container; `data-testid="product-tile"` on each tile button |
| `src/features/pos/SalePanel.vue` | `data-testid="confirm-pay-button"` on the pay button (~line 422) |
| `src/features/pos/SaleConfirmationScreen.vue` | `data-testid="sale-confirmation-screen"` on the root element |
| `src/pages/HomePage.vue` | `data-testid="dashboard-loaded"` on whichever element gates on KPI data resolution (verify against `useDashboardMetrics`'s loading state at implementation time; if no explicit loading boolean exists, gate the marker the same way `AnomalyBanner` gates its own rendering — presence conditioned on data being present, not on the shell mounting) |

### Measured operations

Each measured via the browser's own `performance.now()` deltas captured
in-page (not Node-side wall-clock, which would be polluted by CI-runner
scheduling jitter):

1. **POS load, 2,000-product catalog** — navigate to `/pos`, measure
   navigation-start → first `[data-testid="product-tile"]` present.
2. **Checkout/confirm-sale** — scripted: click a product tile, click
   `[data-testid="confirm-pay-button"]`, measure click → 
   `[data-testid="sale-confirmation-screen"]` present. Acknowledged as the
   most brittle of the three (the only one requiring interaction scripting,
   not just navigation) — a POS UI change could break this benchmark without
   breaking the app itself. Stated here as a known, accepted maintenance cost.
3. **Dashboard load** — navigate to `/`, measure navigation-start →
   `[data-testid="dashboard-loaded"]` present.

### Output

A JSON summary per run (`{ operation, durationMs, timestamp, commitSha }`)
written as a workflow artifact, plus a table printed to
`$GITHUB_STEP_SUMMARY` — matching Lighthouse's own visibility mechanism
(no PR-comment bot, no new GitHub App permissions).

**Explicitly deferred, not silently dropped**: cross-run trend tracking
(would require persistent storage — a hosted service or committing results
back to the repo — both real infrastructure decisions out of scope for this
pass) and any pass/fail threshold (no baseline exists yet).

## 4. Phase 2c: Cheap-Android-device runbook

Pure documentation, no code. New `docs/PERFORMANCE_TESTING.md`, following the
existing `docs/DEPLOYMENT.md`/`docs/BACKUP.md`/`docs/RUNBOOK.md` convention:

- Device(s): the $100-200 Android tablets from the Week-1 hardware order
  (per `CLAUDE.md`).
- Fixed manual procedure: load POS against the same CI test shop's
  2,000-product catalog (reusing `seed-ci-benchmark-data.mjs`'s output so
  numbers are comparable to the automated benchmark), time-to-interactive by
  stopwatch, a subjective scroll-jank note, and a battery/heat observation
  over a 15-minute continuous-use session.
- Explicitly **manual and periodic** (e.g. before each release, added as a
  `docs/DEPLOYMENT.md` checklist item), not CI-enforced — matching Phase 1's
  own framing that real-device testing is inherently human-executed.
- A running results log table (date, device, Android version, observations)
  appended over time, in the same spirit as `docs/releases/`.

## What you'd actually see

- Lighthouse job summaries for both the public and authenticated configs,
  same as Phase 1's existing visibility (GitHub's automatic workflow-run job
  summary, no extra setup).
- A benchmark job summary table with three operation timings per PR run.
- `docs/PERFORMANCE_TESTING.md` as the durable record of manual device checks
  over time.

## Explicitly out of scope (this design)

- Any pass/fail threshold or hard CI gate for either the authenticated
  Lighthouse audits or the benchmarks — no baseline exists yet.
- A second, disposable Supabase project for CI isolation — reusing
  production per the explicit decision above.
- Playwright or any general e2e framework — `puppeteer-core` only, scoped to
  these specific scripts.
- Cross-run trend tracking / historical dashboards for benchmark results.
- Automating the cheap-Android-device pass — inherently manual by nature.
