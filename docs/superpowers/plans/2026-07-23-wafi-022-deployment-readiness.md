# WAFI-022 Deployment Readiness & Operational Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real release versioning (version/git SHA/build date/migration number, replacing a hardcoded placeholder), a deployment runbook covering staging/rollback/PWA-cache verification with a Before/During/After checklist, a `docs/releases/` log, and a guided real backup-verification walkthrough.

**Architecture:** `vite.config.ts` computes build-time constants once (git SHA, build date, highest migration number) via a `define` block; `src/version.ts` exposes them typed. `SettingsPage.vue`'s two existing hardcoded `APP_VERSION = 'v0.1.0'` display sites get wired to the real value. Everything else is documentation.

**Tech Stack:** Vite, TypeScript, Vue 3, Vitest, Node `fs`/`child_process` (build-time only, inside `vite.config.ts`).

## Global Constraints

- No CI/CD pipeline, no new hosted Supabase project for staging — matches the founders' part-time/low-budget constraint (same as WAFI-023).
- Version/SHA/date computation happens once at build time inside `vite.config.ts` (Node build tooling), never as a runtime call inside the shipped app bundle.
- Documentation must be self-contained — never justify a claim by referencing "this session" or a chat transcript. State claims the doc owns (e.g. "The local Supabase verification workflow has repeatedly identified migration and database issues before production deployment, and is therefore the project's standard pre-deployment verification process.").
- Rollback documentation must state plainly that **data rollback is impossible** (migrations are additive-only per `ENFORCEMENT.md` §6) — never hedge this into sounding reversible.
- The backup-verification walkthrough (Task 5) requires direct interaction with the user's real Supabase dashboard — this step cannot be delegated to a subagent; whoever executes this plan must run it as a direct conversation with the user, not dispatch it as an implementer task.

---

### Task 1: Build-time version info (`src/version.ts`)

**Files:**
- Modify: `vite.config.ts`
- Create: `src/version.ts`
- Modify: `src/vite-env.d.ts` (ambient type declarations for the `define`d globals)
- Test: `src/__tests__/version.test.ts`

**Interfaces:**
- Produces: `BUILD_INFO: { version: string; gitSha: string; buildDate: string; migrationNumber: number }` exported from `@/version`. Task 2 imports this.
- Consumes: Vite's `define` mechanism (global constants `__APP_VERSION__`, `__GIT_SHA__`, `__BUILD_DATE__`, `__MIGRATION_NUMBER__`, computed inside `vite.config.ts` at build time).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/version.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BUILD_INFO } from '@/version'

describe('BUILD_INFO', () => {
  it('exposes non-empty version, gitSha, buildDate, and a positive migrationNumber', () => {
    expect(typeof BUILD_INFO.version).toBe('string')
    expect(BUILD_INFO.version.length).toBeGreaterThan(0)

    expect(typeof BUILD_INFO.gitSha).toBe('string')
    expect(BUILD_INFO.gitSha.length).toBeGreaterThan(0)

    expect(typeof BUILD_INFO.buildDate).toBe('string')
    expect(BUILD_INFO.buildDate.length).toBeGreaterThan(0)

    expect(typeof BUILD_INFO.migrationNumber).toBe('number')
    expect(BUILD_INFO.migrationNumber).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/version.test.ts`
Expected: FAIL — `@/version` module does not exist yet.

- [ ] **Step 3: Add build-time constants to `vite.config.ts`**

Modify `vite.config.ts` — add these imports at the top (alongside the existing ones):

```ts
import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
```

Add this helper function and the computed values, before `export default defineConfig({`:

```ts
function getHighestMigrationNumber(): number {
  const files = readdirSync(path.resolve(__dirname, 'supabase/migrations'))
  const numbers = files
    .map(f => /^(\d+)_.+\.sql$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => parseInt(m[1], 10))
  return numbers.length > 0 ? Math.max(...numbers) : 0
}

const gitSha = execSync('git rev-parse --short HEAD').toString().trim()
const buildDate = new Date().toISOString()
const migrationNumber = getHighestMigrationNumber()
```

Then add a `define` block to the `defineConfig({...})` object (as a sibling to `plugins`, `server`, `resolve`, etc.):

```ts
  define: {
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_DATE__: JSON.stringify(buildDate),
    __MIGRATION_NUMBER__: JSON.stringify(migrationNumber),
  },
```

Note: `__APP_VERSION__` is NOT added here — Vite already exposes `package.json`'s `version` field at runtime via `import.meta.env.npm_package_version` in some setups, but this project doesn't rely on that; instead `src/version.ts` reads it directly (see Step 4) to avoid a second, redundant `define` entry for a value already available another way.

- [ ] **Step 4: Create `src/version.ts`**

```ts
import pkg from '../package.json'

declare const __GIT_SHA__: string
declare const __BUILD_DATE__: string
declare const __MIGRATION_NUMBER__: string

/**
 * Real build identification (WAFI-022) -- replaces the hardcoded
 * APP_VERSION = 'v0.1.0' constant that previously lived in
 * SettingsPage.vue. Answers "which deployment?" when something breaks:
 * version + git SHA + build date + the highest applied migration number
 * at build time.
 */
export const BUILD_INFO = {
  version: pkg.version,
  gitSha: __GIT_SHA__,
  buildDate: __BUILD_DATE__,
  migrationNumber: parseInt(__MIGRATION_NUMBER__, 10),
}
```

- [ ] **Step 5: Add ambient type declarations**

Modify `src/vite-env.d.ts` to declare the injected globals so TypeScript
doesn't complain about `__GIT_SHA__` etc. being undefined identifiers:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __GIT_SHA__: string
declare const __BUILD_DATE__: string
declare const __MIGRATION_NUMBER__: string
```

(Yes, this duplicates the `declare const` lines from `src/version.ts` —
that file's own `declare const` statements are needed for its local type
checking in isolation, while `vite-env.d.ts`'s ambient declarations are
what suppress the "cannot find name" error project-wide. Both are
required; this is a normal TypeScript pattern for Vite `define` globals,
not an oversight.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/version.test.ts`
Expected: PASS.

Note: Vite's `define` substitution applies during the actual Vite build/dev
pipeline. Vitest also runs through Vite, so `__GIT_SHA__` etc. should
resolve correctly under `vitest run` too — if the test fails with
"__GIT_SHA__ is not defined" instead of a real assertion failure, the
`define` block needs to also be visible to Vitest's config resolution
(this project's `vite.config.ts` already has a single shared `test: {...}`
block in the same file, so `define` at the top level should already apply
to both — investigate and fix in place if this doesn't hold, don't skip
the test).

- [ ] **Step 7: Run the full test suite once**

Run: `npm test`
Expected: PASS (176 → 177 test files).

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts src/version.ts src/vite-env.d.ts src/__tests__/version.test.ts
git commit -m "feat(wafi-022): add real build-time version info

vite.config.ts now computes git SHA, build date, and the highest applied
migration number once at build time. src/version.ts exposes these plus
package.json's version as a typed BUILD_INFO object -- this is what makes
'which deployment broke this' answerable, and what the PWA-cache
verification step in docs/DEPLOYMENT.md checks against."
```

---

### Task 2: Wire real version info into `SettingsPage.vue`

**Files:**
- Modify: `src/pages/SettingsPage.vue:11,286,456`
- Modify: `src/__tests__/pages/SettingsPage.test.ts`

**Interfaces:**
- Consumes: `BUILD_INFO` from `@/version` (Task 1).
- Produces: no new exports — this is a display wiring change to an existing page.

- [ ] **Step 1: Run the existing test file first, for a baseline**

Run: `npx vitest run src/__tests__/pages/SettingsPage.test.ts`
Expected: PASS (3 tests) — confirms nothing is already broken before this change.

- [ ] **Step 2: Write the new test**

Add this test to `src/__tests__/pages/SettingsPage.test.ts` (add the
import at the top, add the `it` block inside the existing `describe`):

```ts
import { BUILD_INFO } from '@/version'

// ...inside the existing describe block, alongside the other 3 tests:

  it('shows the real build version (not a hardcoded placeholder)', async () => {
    const w = await mountAt('/settings')
    expect(w.text()).toContain(BUILD_INFO.version)
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/pages/SettingsPage.test.ts`
Expected: FAIL — the page still shows the hardcoded `'v0.1.0'` string, not
`BUILD_INFO.version` (these will coincidentally match if `package.json`'s
version happens to already be `0.1.0` by the time this runs — if Task 4
hasn't bumped it yet and it's still `0.0.0`, this test correctly fails
since `w.text()` would contain `v0.1.0` from the old hardcoded constant,
not `0.0.0`).

- [ ] **Step 4: Implement**

In `src/pages/SettingsPage.vue`, add the import (alongside the existing
imports at the top of `<script setup>`):

```ts
import { BUILD_INFO } from '@/version'
```

Replace line 11 (`const APP_VERSION = 'v0.1.0'`) with:

```ts
const APP_VERSION = `v${BUILD_INFO.version}`
```

Leave both display sites (`{{ APP_VERSION }}` at the mobile "about" row
and the desktop sidebar "about" row) exactly as they are — they already
reference `APP_VERSION`, which now resolves to the real value. Add a
`title` attribute to both spans so the fuller build info (SHA, date,
migration number) is available without cluttering the compact badge —
modify line 286:

```vue
<span class="version-badge" :title="`${BUILD_INFO.gitSha} · ${BUILD_INFO.buildDate} · migration ${BUILD_INFO.migrationNumber}`">{{ APP_VERSION }}</span>
```

And line 456:

```vue
<span class="version-mono" :title="`${BUILD_INFO.gitSha} · ${BUILD_INFO.buildDate} · migration ${BUILD_INFO.migrationNumber}`">{{ APP_VERSION }}</span>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/pages/SettingsPage.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Run the full test suite once**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/SettingsPage.vue src/__tests__/pages/SettingsPage.test.ts
git commit -m "feat(wafi-022): show real build version in Settings, not a hardcoded placeholder

Both existing 'about' rows (mobile badge, desktop sidebar) now read
BUILD_INFO.version instead of the hardcoded 'v0.1.0' string, with the
full git SHA/build date/migration number available via a title tooltip.
This is what the PWA-cache verification step in docs/DEPLOYMENT.md
checks against after a deployment."
```

---

### Task 3: `docs/DEPLOYMENT.md` — the runbook

**Files:**
- Create: `docs/DEPLOYMENT.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write the document**

Create `docs/DEPLOYMENT.md`:

```markdown
# Wafi Deployment Readiness & Operational Runbook

## Before Deployment

1. Full test suite passing: `npm test`
2. Clean build (type-check + bundle): `npm run build`
3. Local Supabase verification against a fresh stack:
   ```
   npx supabase db reset
   npx supabase test db
   ```
   The local Supabase verification workflow has repeatedly identified
   migration and database issues before production deployment, and is
   therefore the project's standard pre-deployment verification process
   — this is Wafi's staging step. There is no separate hosted staging
   project; this local workflow serves that purpose at this project's
   current scale.
4. Review migrations added since the last release — confirm each is
   additive-only (no `DROP`/`RENAME`/destructive `ALTER` on live data,
   per `ENFORCEMENT.md` §6), and note anything that needs a breaking-change
   entry in this release's `docs/releases/vX.Y.Z.md` file.
5. Increment the version in `package.json`, matching what this release
   will be called in `docs/releases/`.

## During Deployment

6. Deploy the frontend build.
7. Verify the deployment actually completed — check the hosting
   dashboard/logs show a successful deploy, not just that the local
   build command exited 0.
8. Verify environment variables are correct for this deployment target:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_POWERSYNC_URL`,
   `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`,
   `VITE_SUPPORT_WHATSAPP_PHONE` — these differ between a real deployment
   and a local dev machine, and a stale/missing value fails silently
   (Sentry/WhatsApp no-op without them) rather than erroring loudly.

## After Deployment

9. **Smoke test (mandatory, ~5 minutes).** Run through this on the real,
   deployed app on a real device — not the local dev server:
   - ✓ Login
   - ✓ Open a shift
   - ✓ Ring a sale
   - ✓ Record a payment
   - ✓ Confirm sync completes (while online)
   - ✓ Logout

   This is mandatory, not optional. Five minutes here catches deployment
   mistakes that pass every automated check but break the golden path.

10. Verify Sentry shows this deployment's `environment` tag (see
    `VITE_SENTRY_ENVIRONMENT`, WAFI-023) on any new events, confirming
    the deployed build is actually the one sending telemetry.

11. Verify sync completes end-to-end against the real backend (covered
    by the smoke test above, called out again because it's the step most
    likely to silently fail on a misconfigured `VITE_SUPABASE_URL`/
    `VITE_POWERSYNC_URL`).

12. **Verify the PWA actually updated** — this project's service worker
    runs in `prompt` mode (see `vite.config.ts`), meaning it caches the
    previous bundle and shows a non-blocking "update available" toast
    rather than force-reloading. "Deployed successfully" and "customers
    are running the new bundle" are two different facts. Confirm:
    - The in-app version shown in Settings (see `src/version.ts`,
      WAFI-022) matches the version/git SHA just deployed — open
      Settings, check the version badge (its tooltip shows the full git
      SHA/build date/migration number).
    - The service worker has actually activated the new version, not
      just installed-and-waiting (check the browser's Application/Service
      Worker devtools panel, or confirm after tapping the in-app update
      toast if one appeared).

13. **Record the deployment** — create `docs/releases/vX.Y.Z.md` (see
    that directory's own README/template) documenting what shipped, any
    breaking changes, rollback notes, and known issues.

## Rollback — Three Distinct Situations

These are genuinely different problems with genuinely different fixes.
Do not conflate them.

### 1. Application rollback (possible)

Deploy the previous known-good build. Keep the prior build artifact
available/deployable as a matter of routine, not something assembled
under pressure. After rolling back, use the in-app version display
(Settings, `src/version.ts`) to confirm the *previous* version is what's
actually live — the same PWA-cache caveat from step 12 above applies to a
rollback deploy too: a customer's device may keep running the
just-rolled-back-from bundle until the service worker actually updates.

### 2. Data rollback (impossible — do not attempt)

Migrations are additive-only on live data (`ENFORCEMENT.md` §6: expand
only, never `DROP`/`RENAME` on live data). There is no "undo" for a
migration that has already run against production. If a migration causes
a problem, the only real path is a **forward migration** that corrects
it — never edit already-applied migration history. Document the
corrective migration's own rationale the same way any other migration is
documented in this codebase.

### 3. Emergency recovery (last resort)

Restoring from a backup. This is the path for actual data loss or
corruption — not "a migration had a bug" (that's case 2). This is only as
good as the backup verification actually performed — see
`docs/BACKUP.md`, which documents this project's real, confirmed backup
frequency, restore procedure, and last-verified-restore date (not a
guess or a template placeholder).
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs(wafi-022): add deployment readiness and operational runbook

Before/During/After deployment checklist, a mandatory 5-minute smoke
test, explicit PWA/service-worker cache verification (this app's
prompt-mode service worker means 'deployed' and 'customers are on the
new bundle' are different facts), and a three-way rollback split
(application rollback is possible, data rollback is not -- forward
migration only -- emergency recovery is the last-resort backup path).
Self-contained: states the local-Supabase-as-staging claim as something
this document owns, not something borrowed from a chat session."
```

---

### Task 4: `docs/releases/` log

**Files:**
- Create: `docs/releases/README.md` (the template)
- Create: `docs/releases/v0.1.0.md` (the first real entry)
- Modify: `package.json` (bump `"version"` from `"0.0.0"` to `"0.1.0"`)

**Interfaces:** none — documentation, plus a one-line `package.json` change that Task 1/2's `BUILD_INFO.version` will read.

- [ ] **Step 1: Bump the version**

In `package.json`, change:
```json
"version": "0.0.0",
```
to:
```json
"version": "0.1.0",
```

This is the project's first real, tracked version — matches the value
that was already hardcoded as the display placeholder in
`SettingsPage.vue` before Task 2's change, so this isn't picking an
arbitrary number, it's making the number that was already being shown
actually mean something.

- [ ] **Step 2: Write the template**

Create `docs/releases/README.md`:

```markdown
# Release Log

One file per release: `vX.Y.Z.md`. Created as the last step of every
deployment (see `docs/DEPLOYMENT.md`'s "After Deployment" checklist,
item 13). This accumulates over time — the value isn't in any single
entry, it's in being able to answer "which deployment, what changed, how
do we back out" months later without re-deriving it from git log.

## Template

```markdown
# vX.Y.Z — YYYY-MM-DD

**Git SHA:** `abc1234`
**Migrations included (this release):** 068, 069 (or "none — code-only release")

## Changes
- ...

## Breaking changes
- None. (Or: describe, and what a deployer must do about it.)

## Rollback notes
- Application: previous build was vX.Y.(Z-1), SHA `...`
- Database: (state whether any migration in this release is one-way --
  per docs/DEPLOYMENT.md's rollback section, describe the forward-fix
  path if something goes wrong, don't claim a migration can be undone)

## Known issues
- None. (Or: list, so "was this always broken or did we just break it"
  has an answer.)
```
```

- [ ] **Step 3: Write the first real entry**

Create `docs/releases/v0.1.0.md`. Fill in the actual git SHA by running
`git rev-parse --short HEAD` at the time this task is executed (do not
guess or leave a placeholder — this is exactly the kind of empty template
field the design explicitly rejected):

```markdown
# v0.1.0 — 2026-07-23

**Git SHA:** `<run: git rev-parse --short HEAD, paste the real value here>`
**Migrations included (this release):** none — this release establishes
real version tracking (WAFI-022); it does not itself add a migration.

## Changes
- Real build-time version info (`src/version.ts`): version, git SHA,
  build date, and highest-applied-migration-number, replacing a
  hardcoded `'v0.1.0'` placeholder in `SettingsPage.vue`.
- `docs/DEPLOYMENT.md`: Before/During/After deployment checklist,
  mandatory smoke test, PWA-cache verification, three-way rollback
  split (application / data-impossible / emergency-recovery).
- `docs/releases/` established as the ongoing release log (this file is
  its first entry).
- `docs/BACKUP.md` documents this project's real, confirmed backup
  frequency, restore procedure, and last-verified-restore date (see
  Task 5 of this feature's implementation plan).

## Breaking changes
- None.

## Rollback notes
- Application: no prior tracked version exists (this is the first real
  release) — there is no "previous version" to roll back to yet.
  Starting with this release, every future release's rollback notes
  should name the specific prior version/SHA.
- Database: no migration in this release; not applicable.

## Known issues
- None.
```

- [ ] **Step 4: Commit**

```bash
git add package.json docs/releases/README.md docs/releases/v0.1.0.md
git commit -m "docs(wafi-022): establish docs/releases/ log, bump to v0.1.0

First real tracked version -- matches what was already hardcoded as a
display placeholder before this feature made it mean something. Template
plus the first real entry, documenting this feature's own changes."
```

---

### Task 5: Backup verification (guided, human-executed)

**Files:**
- Create: `docs/BACKUP.md`

**Interfaces:** none — documentation, filled in via direct conversation with the user, not delegated to a subagent.

**This task cannot be dispatched as an implementer subagent.** It requires
checking the user's actual production Supabase dashboard together. If
executing this plan via subagent-driven-development, the controller must
run this task directly with the user, not spawn an agent for it.

- [ ] **Step 1: Walk through the Supabase dashboard with the user**

Ask the user to open their production Supabase project's dashboard and
check (or check together via screen-share/description):
- **Project tier** (Free / Pro / Team — determines what backup
  capabilities are even available).
- **Backup schedule** — whether Point-in-Time Recovery (PITR) is enabled
  (Pro+ tiers), or what the daily-backup retention actually is.
- Whether a manual backup/restore has ever actually been tested on this
  project.

- [ ] **Step 2: Attempt or confirm a real restore test, if feasible**

If the tier and situation allow it safely (e.g. a non-destructive
point-in-time query against a backup, or restoring into a throwaway
project to confirm the backup file is valid) — do this together and
record the real result. If a full restore test genuinely isn't safe or
practical to perform right now (e.g. it would require downtime on the
live customer's shop), document that explicitly as the current state
rather than fabricating a "verified" date — the whole point of this
document is that the "last verified restore date" field must be true.

- [ ] **Step 3: Write `docs/BACKUP.md` with the real, confirmed answers**

```markdown
# Backup & Recovery

## Current backup configuration

**Supabase project tier:** <fill in from Step 1 — real value>
**Backup frequency:** <fill in — e.g. "daily" or "continuous (PITR)" or
  "none configured" — real value, not a guess>

## Restore procedure

<Write the actual, concrete steps to restore this specific Supabase
project from a backup, as confirmed in Step 1/2 -- e.g. via the Supabase
dashboard's Database > Backups page, or `supabase db dump`/restore CLI
flow if applicable. Detailed enough that someone under pressure can
follow it without re-discovering it.>

## Last verified restore date

**<real date from Step 2, or an honest statement that a full restore has
not yet been tested and why -- do not fabricate a date>**

## When to use this (Emergency Recovery)

See `docs/DEPLOYMENT.md`'s "Rollback — Three Distinct Situations"
section. This is the last-resort path for actual data loss or
corruption — not for "a migration had a bug" (that's a forward migration,
documented there, not a restore).
```

- [ ] **Step 4: Commit**

```bash
git add docs/BACKUP.md
git commit -m "docs(wafi-022): document real, confirmed backup status and restore procedure

Answers 'can I restore a backup', not just 'do backups exist' -- tier,
frequency, concrete restore steps, and a real (not fabricated)
last-verified-restore-date, confirmed directly with the project owner
against the actual production Supabase dashboard."
```

---

### Task 6: Final verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, 177 test files (176 baseline + `version.test.ts`;
`SettingsPage.test.ts` is extended in place, not added as a new file).

- [ ] **Step 2: Type-check and build**

Run: `npm run build`
Expected: exit 0, no TypeScript errors. Confirm the build output actually
contains real values for the injected constants — e.g.
`grep -o '"gitSha":"[a-f0-9]*"' dist/assets/*.js | head -1` (adjust the
glob if the built filename pattern differs) should show a real short SHA,
not a literal `__GIT_SHA__` placeholder string (which would indicate the
`define` substitution didn't apply).

- [ ] **Step 3: Confirm all new docs exist**

Run: `ls docs/DEPLOYMENT.md docs/BACKUP.md docs/releases/README.md docs/releases/v0.1.0.md`
Expected: all four files listed, no "No such file" errors.

- [ ] **Step 4: Confirm `docs/BACKUP.md` has no unfilled template fields**

Run: `grep -n "fill in\|<real\|<Write the actual" docs/BACKUP.md`
Expected: no output — if this matches anything, Task 5's guided
walkthrough wasn't actually completed with real answers, and this task
should return to Task 5 rather than being marked done.

- [ ] **Step 5: No commit needed** — this task is verification only; if any check fails, return to the relevant earlier task and fix it there.
