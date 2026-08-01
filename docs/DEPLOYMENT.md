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
   entry in this release's `docs/releases/vX.Y.Z.md` file. If a migration
   adds a column to a table PowerSync syncs, confirm the project's
   PowerSync sync rules include that column (check the PowerSync dashboard
   directly — this cannot be verified from this repository, since no
   sync-rules file is version-controlled here). A column missing from the
   sync rules fails silently: writes succeed locally but the value never
   reaches any device. The same applies to a migration that adds a whole
   new TABLE the client reads or writes: the table needs its own sync-rule
   bucket entry before it syncs at all, otherwise every local write queues
   forever and no server row ever arrives. Tables added by WAFI-140 Sprint 1
   that need this: `events` and `daily_event_counts`.
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

**As of the current release this path does not exist** — the production
project is on Supabase's Free tier, which has no backup capability at
all (confirmed directly against the dashboard, see `docs/BACKUP.md`). A
data-loss event today has no restore path.
