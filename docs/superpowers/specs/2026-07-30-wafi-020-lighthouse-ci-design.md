# WAFI-020 (Phase 1): Lighthouse CI — Design

**Date:** 2026-07-30
**Status:** Approved direction, ready for spec self-review
**Scope:** Phase 1 of WAFI-020 (Performance & Load Testing) — automated Lighthouse
scoring on every pull request. Benchmarks (timed tests for specific operations) and
real cheap-Android device testing are explicitly separate, later phases of the same
ticket, not covered here.

## Problem

No performance measurement of any kind exists in this codebase today (confirmed via
code audit 2026-07-27 and re-confirmed 2026-07-30 — no benchmark scripts, no Lighthouse
config, no CI performance gate anywhere). The project's own Sacred Rule #3 commits to
running acceptably on cheap Android hardware, but nothing currently catches a
performance regression before it ships.

## Why Lighthouse CI first

Of the three things WAFI-020 asks for, this is the cheapest to stand up: no new test
code to write, no real device needed, and — once merged — it runs forever on every
future pull request with zero ongoing effort from anyone. It's also the one piece that
prevents *regressions*, as opposed to benchmarks/device-testing which mostly establish a
*baseline*.

## Tool choice: `treosh/lighthouse-ci-action`, not a hosted LHCI server

This repo has exactly one prior CI workflow — `.github/workflows/design-system-check.yml`
(WAFI-005) — and its own comment states it explicitly: "the first CI workflow in this
repo; scoped to exactly this one check, not a general CI rollout." This design follows
the same discipline: `treosh/lighthouse-ci-action` is a free GitHub Action that builds
the app, serves it from a throwaway local static server inside the CI runner, and runs
Lighthouse against it — no hosted Lighthouse CI server, no new monthly cost, fits the
project's €100-200/month budget with zero added spend. A hosted LHCI server (with
historical trend tracking, a dashboard, budget assertions) is real infrastructure this
project doesn't need yet for one score-on-every-PR check.

**Informational only, matching the WAFI-005 precedent exactly**: `continue-on-error:
true`. There is no "must be above X" threshold in Phase 1, because there is no existing
baseline to set a sane threshold against — inventing one now would be arbitrary. Once
real scores accumulate over a few weeks, a follow-up decision can add a hard gate if
warranted.

## The auth-wall finding — and why Phase 1 audits only `/welcome`

**This is the load-bearing finding of this design, surfaced before writing any
workflow config, not discovered after shipping something broken.**

`src/router/index.ts`'s global guard (`router.beforeEach`, lines 101-114) redirects any
unauthenticated visitor to `/welcome` for every route except `PUBLIC_PATHS = ['/welcome',
'/login', '/signup', '/forgot-password']`. Lighthouse, run by CI with no login session,
is exactly such a visitor. Pointing this workflow at `/pos`, `/products`, or `/` (the
routes that actually matter for a cashier/owner) would silently audit `/welcome` every
time regardless of the URL configured — the CI run would report a score, it just
wouldn't be a score *of the page anyone asked for*. Shipping that would be worse than
shipping nothing: it would look complete while measuring the wrong thing, the same class
of problem already called out and avoided twice this session (WAFI-009's inventory-
movement data source, WAFI-010's decision-table completeness).

**Phase 1 scope, deliberately limited to what's honestly measurable today:** audit only
`/welcome` — the one page genuinely reachable with no session, so the score reported is
real. **Explicitly out of scope, tracked as follow-up work, not silently dropped:**
auditing `/pos`, `/products`, `/` (Home/Dashboard), or any other authenticated route
requires a dedicated, always-on CI test account (a real shop/staff record in production
Supabase, or a disposable project stood up per-run) plus a scripted login step before
Lighthouse runs, and introduces an ongoing dependency on live Supabase availability
during CI runs. That's real additional infrastructure, not a config tweak — a follow-up
ticket's worth of work, not squeezed into this one. Concretely, that follow-up ticket
must provide: **(1)** a seeded CI-only shop/staff account that persists across runs (not
recreated per-run, to avoid a login race against PowerSync's initial sync), **(2)** a
scripted login step run before Lighthouse (e.g. a small Playwright/Puppeteer script that
signs in and lets the router guard clear), and **(3)** a saved authenticated storage
state (cookies/local-storage snapshot) that Lighthouse's browser context loads instead
of starting from a fresh, logged-out session on every audit.

## Workflow

**Verified against the action's real interface before writing this** (its `action.yml`
and the underlying `@lhci/cli` docs), not assumed:

- `treosh/lighthouse-ci-action`'s own inputs are `urls`, `budgetPath`, `configPath`,
  `uploadArtifacts`, `artifactName`, `temporaryPublicStorage`, `runs`, plus LHCI-server
  inputs not used here. **There is no `serveStatic` or `staticDistDir` input on the
  action itself** — static-directory serving is a property of the underlying `@lhci/cli`
  tool's own config file, reached via the action's `configPath` input pointing at a
  `lighthouserc.json`. An earlier draft of this design used `serveStatic`/`staticDistDir`
  as direct action inputs — verified wrong, corrected below.
- The static server's port is **dynamically chosen by LHCI at run time, not fixed at
  4173** (that's Vite's dev-preview default, irrelevant here since nothing runs `vite
  preview` in this design). LHCI's own docs describe exactly this case: write the URL
  with **no port** (`http://localhost/welcome`) and LHCI rewrites it to whatever port
  its temporary static server actually bound. An earlier draft hard-coded `:4173` —
  verified wrong, corrected below.
- The static server's default behavior for a path with no matching file on disk is a
  **404, not an SPA fallback to `index.html`** — `isSinglePageApplication` must be set to
  `true` explicitly, or requesting `/welcome` directly (as opposed to `/`) would 404
  before Vue Router ever got a chance to render anything, since this is a Vue Router
  *history-mode* SPA with no `/welcome.html` file actually on disk. This is load-bearing
  for the whole design: without it, this workflow would audit a 404 page and silently
  report a meaningless score. An earlier draft didn't set this at all — added below.

New files: `.github/workflows/lighthouse-ci.yml` and `.lighthouserc.json`.

```json
// .lighthouserc.json
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

```yaml
# .github/workflows/lighthouse-ci.yml
name: Lighthouse CI

# WAFI-020 Phase 1. Informational only — continue-on-error, matching the
# design-system-check.yml (WAFI-005) precedent: report, never block. Audits
# /welcome only — the one route reachable with no login session (see design
# doc's "auth-wall finding" for why /pos, /products, etc. are out of scope
# for this first pass).
#
# No browser-install step is needed: GitHub's ubuntu-latest runner ships a
# Chrome/Chromium build already compatible with Lighthouse.

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          # Matches design-system-check.yml's node-version (WAFI-005) — this is
          # not independently pinned anywhere else in the repo (no `engines`
          # field in package.json, no .nvmrc). If the project's Node version is
          # ever bumped, this workflow should be updated alongside
          # design-system-check.yml, the actual precedent it's copied from;
          # nothing currently enforces the two staying in sync automatically.
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run Lighthouse CI
        continue-on-error: true
        uses: treosh/lighthouse-ci-action@v11
        with:
          # staticDistDir/isSinglePageApplication/url all live in
          # .lighthouserc.json (see above), not as direct action inputs —
          # there is no such input on this action. configPath is the only
          # thing wiring the two files together.
          configPath: './.lighthouserc.json'
          uploadArtifacts: true
          # Phase 1 audits only the public /welcome page (see "auth-wall
          # finding" below) — there is no authenticated business data in what
          # gets uploaded, so free temporary public report hosting is fine.
          # This would need re-evaluating if a later phase ever audits an
          # authenticated route.
          temporaryPublicStorage: true
          # Deliberately 1, not Lighthouse's usual multi-run default: this
          # phase is informational-only with no pass/fail gate riding on the
          # score, so the variance-reduction that multiple runs buys isn't
          # worth 3x the CI time yet. Don't "fix" this to 3 without
          # re-reading this comment — it's intentional, not an oversight.
          runs: 1
```

The URL in `.lighthouserc.json` has no port (`http://localhost/welcome`) by design — LHCI
substitutes the port of the temporary static server it starts internally, whatever that
turns out to be for a given run. The only thing this design depends on for that URL to
keep working is the *route* `/welcome` continuing to exist and being reachable with no
session — not any particular port number, since none is hard-coded.

**Lighthouse-infrastructure failures must never block a merge in Phase 1.** If Lighthouse
itself crashes, times out, or the runner has a transient issue, `continue-on-error: true`
on the step means the job still reports success — this is intentional, not a gap: there
is no scoring gate in Phase 1 for an infrastructure hiccup to threaten, so failing the
whole PR over a flaky audit tool would cost real friction for zero benefit.

**Artifact retention:** left at GitHub's default (90 days) rather than set explicitly —
no retention requirement exists yet for these reports; a future phase that adds trend
tracking may want to shorten or extend this deliberately, but Phase 1 has no reason to.

**Not scoped by changed file paths** (unlike `design-system-check.yml`'s `paths:
['**.vue', '**.css']`) — deliberately runs on every pull request, since a performance
regression can come from a dependency bump, a router change, or a build-config change,
none of which are `.vue`/`.css` files. Design-system color drift is inherently
CSS/template-scoped; performance is not. `types: [opened, synchronize, reopened]` is
GitHub's own default trigger set for `pull_request` when unspecified — listed explicitly
here so a future reader doesn't have to know that default to know what re-runs the check.

## What you'd actually see

The GitHub Actions **job summary** for the workflow run — a page GitHub renders
automatically for every workflow, no extra setup — shows each audited URL's category
scores (Performance / Accessibility / Best Practices / SEO) as soon as the run
finishes, plus a link to the full interactive report. This is visible by opening the
pull request, clicking the workflow run, with nothing further to configure. No bot
account, no PR-comment-posting step, no additional GitHub App permissions — the
simplest mechanism that satisfies "does someone need to be able to see this."

## Explicitly out of scope (this design)

- Auditing any authenticated route (`/pos`, `/products`, `/`, etc.) — blocked on a CI
  test-account setup, tracked as follow-up work per the auth-wall finding above.
- Any pass/fail threshold or hard CI gate — no baseline exists yet to set one against.
- Benchmarks (timed tests for specific operations like "load POS with 2,000 products")
  — a separate phase of WAFI-020, not this design.
- Real cheap-Android device testing — a separate phase of WAFI-020, not this design;
  inherently manual/human-executed, not something a design doc for CI tooling covers.
- A hosted Lighthouse CI server with historical trend tracking — real infrastructure
  this project doesn't need yet for a single informational score-on-every-PR check.
