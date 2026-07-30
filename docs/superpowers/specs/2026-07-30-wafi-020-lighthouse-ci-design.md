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
ticket's worth of work, not squeezed into this one.

## Workflow

New file: `.github/workflows/lighthouse-ci.yml`

```yaml
name: Lighthouse CI

# WAFI-020 Phase 1. Informational only — continue-on-error, matching the
# design-system-check.yml (WAFI-005) precedent: report, never block. Audits
# /welcome only — the one route reachable with no login session (see design
# doc's "auth-wall finding" for why /pos, /products, etc. are out of scope
# for this first pass).

on:
  pull_request:

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run Lighthouse CI
        continue-on-error: true
        uses: treosh/lighthouse-ci-action@v11
        with:
          urls: |
            http://localhost:4173/welcome
          uploadArtifacts: true
          temporaryPublicStorage: true
          runs: 1
        # The action starts its own static server (via `npm run preview` or an
        # equivalent) to serve the build output before auditing — configured via
        # the action's `staticDistDir`/`startServerCommand` inputs at
        # implementation time, pointed at this project's `vite preview` output
        # (see package.json: "preview": "vite preview").
```

**Not scoped by changed file paths** (unlike `design-system-check.yml`'s `paths:
['**.vue', '**.css']`) — deliberately runs on every pull request, since a performance
regression can come from a dependency bump, a router change, or a build-config change,
none of which are `.vue`/`.css` files. Design-system color drift is inherently
CSS/template-scoped; performance is not.

**`temporaryPublicStorage: true`** uses Lighthouse CI's own free, temporary public
report hosting (no account, no cost) so the full detailed report is a clickable link,
not just a number — the action prints that link directly into the GitHub Actions job
summary.

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
