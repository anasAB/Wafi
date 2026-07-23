# WAFI-022: Deployment Readiness & Operational Runbook Design

**Date:** 2026-07-23
**Status:** Approved
**Ticket:** WAFI-022, renamed from "Production Deployment Checklist" to
**"Deployment Readiness & Operational Runbook"** — what this ticket
actually produces (deployment procedure, rollback strategy, backup
verification, release logging, operational documentation) is broader than
a checklist, and the name should say so.

## Context

Investigation found this ticket genuinely unbuilt (no CI/CD, no staging
project, no confirmed backup, no rollback runbook). WAFI-023 has since
shipped Sentry, removing "monitoring" from this ticket's remaining scope.

**Constraint this design is built around** (same as WAFI-023): part-time
founders, €100-200/month budget, one live customer today. No new hosted
infrastructure or CI/CD — this ticket is documentation plus a small,
genuinely load-bearing piece of code: real release versioning, which was
explicitly *dropped* as out of scope during WAFI-023 (app-version stamping
was skipped because `package.json`'s `"version": "0.0.0"` was an
unmaintained placeholder) — this ticket is where that gap gets closed for
real, because release identification turns out to be foundational to
everything else here (rollback, smoke testing, "which deployment broke").

## What's changing

### 1. Release versioning (the missing piece that makes everything else possible)

Without this, "it broke" has no answer to "which deployment?". Every
build needs to identify itself with:

- **Version** — `package.json`'s `version` field, finally made real
  (semver, bumped as part of the deploy checklist below — see "Before
  deployment").
- **Git SHA** — the short commit hash the build was made from.
- **Build date** — when the build was produced.
- **Database migration number** — the highest-numbered file in
  `supabase/migrations/` at build time (currently `067`; this project's
  migrations are sequentially numbered, so "highest number applied" is a
  meaningful, checkable fact).

**Implementation:** `vite.config.ts` gains a `define` block exposing
`__APP_VERSION__`, `__GIT_SHA__`, and `__BUILD_DATE__` as build-time
constants. `git rev-parse --short HEAD` and the current timestamp are
computed once, in the Vite config itself, when the build runs — this is
build-tooling code executed by Node at build time, not app runtime
behavior, so it's a one-time computation baked into the bundle as a
literal string, not a live clock the shipped app calls. A `src/version.ts`
module exports these as a typed `BUILD_INFO` object (migration number
included, read from the highest-numbered file under
`supabase/migrations/` via a small Node `fs.readdirSync` step inside
`vite.config.ts`, not a runtime app dependency).

This `BUILD_INFO` is surfaced in-app (a small line in Settings — "الإصدار:
v0.1.0 · a1b2c3d · 2026-07-23 · migration 067" or similar), which is what
makes the PWA-cache verification in item 6 below actually checkable by a
human without opening dev tools.

### 2. Rollback — three distinct situations, not one

The original draft conflated these. They are genuinely different and
need separate procedures:

- **Application rollback** — deploy the previous known-good build. This
  is real and possible: keep the prior build artifact deployable (matches
  the existing pattern from the WAFI-002 customer-0 runbook), and the new
  `BUILD_INFO` display (item 1) is what lets you confirm which version is
  actually live after doing this.
- **Data rollback** — **impossible**, and the doc must say so plainly, not
  hedge. Migrations are additive-only on live data (`ENFORCEMENT.md` §6).
  The only real path when a migration causes a problem is a **forward
  migration** that corrects it — never editing already-applied history.
- **Emergency recovery** — restoring from a backup. This is the
  last-resort path when data is actually lost or corrupted (not just "a
  migration had a bug") — distinct from both of the above, and only as
  good as the backup-verification work in item 3.

### 3. Backup verification — "can I restore," not "do backups exist"

The original draft's "check the dashboard" is too vague to be useful
later. Document, and get real (not assumed) answers for:

- **Backup frequency** — what the actual configured schedule is (daily?
  continuous/PITR? — depends on the Supabase project's tier, confirmed by
  checking, not guessed).
- **Restore procedure** — the actual steps to restore from a backup on
  this specific Supabase project, written down in enough detail that a
  panicking founder at 11pm can follow it without re-discovering it.
- **Last verified restore date** — the field that actually matters. A
  backup that has never been test-restored is an assumption, not a
  safety net. This gets a real date once the guided walkthrough (below)
  actually performs or confirms a test restore — not left as a
  perpetually-empty template field.

Since I cannot access the actual production Supabase dashboard, this
section's real content is filled in via a guided walkthrough with the
user (a "do this together" step, not something a subagent can verify) —
the plan will produce the document with real answers, not placeholders,
by the time this ticket is done.

### 4. Release log — `docs/releases/`

New directory, one file per release: `docs/releases/v0.1.0.md` (adjust
naming once real semver starts — see item 1). Each file's template:

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
- Database: (state whether any migration in this release is one-way —
  per item 2, describe the forward-fix path if something goes wrong,
  don't claim a migration can be undone)

## Known issues
- None. (Or: list, so "was this always broken or did we just break it"
  has an answer.)
```

This is genuinely valuable specifically because it accumulates — the
first entry is nearly free, and every entry after it is what answers
"which deployment, what changed, how do we back out" months later.

### 5. Smoke test — mandatory, five minutes, after every deployment

A fixed checklist run manually after every deploy, using the real app on
a real device:

- ✓ Login
- ✓ Open shift
- ✓ Ring a sale
- ✓ Record a payment
- ✓ Confirm sync completes (online)
- ✓ Logout

This is mandatory, not optional — it's five minutes and catches the class
of deployment mistake ("looks fine in the build log, breaks the golden
path") that nothing else here catches.

### 6. PWA / browser cache verification — explicit, because this project is a PWA

This project's service worker runs in `prompt` mode (`vite.config.ts`),
and this codebase's own prior work (documented in memory from earlier
sessions) already found that a prompt-mode service worker caches the old
bundle and needs a second online reload to actually take control — so
"deployed successfully" and "customers are running the new bundle" are
two different facts. After every deployment, explicitly verify:

- The new bundle actually loaded (check `BUILD_INFO`'s displayed version/
  SHA in Settings — item 1 — matches what was just deployed).
- The service worker actually updated (not just installed-and-waiting).
- The in-app version display matches the release being deployed.

### 7. Restructured checklist — Before / During / After

Replaces a flat list with the actual sequence, in `docs/DEPLOYMENT.md`:

**Before deployment**
1. Full test suite passing (`npm test`)
2. `npm run build` clean (type-check + bundle)
3. `npx supabase db reset` + `npx supabase test db` clean against a fresh
   local stack (this project's staging step — see below)
4. Review new migrations since the last release (any additive-only
   violations? anything that needs a release-log breaking-change note?)
5. Increment the version (`package.json`), matching what this release
   will be called in `docs/releases/`

**During deployment**
6. Deploy the frontend build
7. Verify the deployment actually completed (not just "the command
   exited 0")
8. Verify environment variables are correct for this deployment target
   (`VITE_SENTRY_DSN`, `VITE_SUPPORT_WHATSAPP_PHONE`, `VITE_SUPABASE_URL`,
   etc. — the ones that differ between a real deploy and a dev machine)

**After deployment**
9. Run the smoke test (item 5)
10. Verify Sentry shows this deployment's `environment`/version tag
    (ties to WAFI-023's `VITE_SENTRY_ENVIRONMENT`)
11. Verify sync completes end-to-end
12. Verify the PWA actually updated (item 6)
13. Record the deployment — create the `docs/releases/vX.Y.Z.md` entry
    (item 4)

### Documentation self-containment

The prior draft's staging section justified the local-Supabase workflow
by saying it was "proven by this session's own history" — this must not
survive into the actual doc. Documentation must stand on its own; it
should never reference "this chat" or "this session" as its evidence.
Instead: **"The local Supabase verification workflow has repeatedly
identified migration and database issues before production deployment,
and is therefore the project's standard pre-deployment verification
process."** — a claim the doc makes and owns, not one borrowed from a
conversation transcript.

## Testing

Documentation-only for items 2–7. Item 1 (version stamping) is real code
and gets real tests: a unit test confirming `BUILD_INFO` exposes non-empty
`version`/`gitSha`/`buildDate`/`migrationNumber` fields, and (if displayed
via a small Settings component) a component test confirming it renders.
The backup-verification walkthrough (item 3) is a one-time, human-executed
confirmation, same pattern as WAFI-002/003/004's manual verification
steps — the deliverable is the document's real, filled-in content, not a
test.

## Out of scope

- Any CI/CD pipeline or automated deploy-on-push.
- A real second hosted Supabase project for staging.
- Automating the rollback procedures themselves (a one-command revert
  script) — documented manual procedures, matching this project's
  existing "manual deploy, whoever has access to the device" reality.
- Any change to `useAuditLog.ts`, `useAuditLog`'s event set, or anything
  from WAFI-007/023 — this ticket only adds version stamping and
  documentation.
