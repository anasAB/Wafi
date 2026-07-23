# WAFI-022: Production Deployment Checklist Design

**Date:** 2026-07-23
**Status:** Approved
**Ticket:** WAFI-022 (P2, 0.25 sprint, "Staging, monitoring, backup, rollback tested")

## Context

Investigation found this ticket genuinely unbuilt (no CI/CD, no staging
project, no monitoring, no confirmed backup, no rollback runbook), same
class as WAFI-023 before it shipped. WAFI-023 has since shipped Sentry
error tracking, which removes "monitoring" from this ticket's remaining
scope — the other three items (staging, backup, rollback) are still real
gaps.

**Constraint this design is built around** (same as WAFI-023): part-time
founders, €100-200/month budget, one live customer today. A real second
hosted Supabase project for staging, or automated CI/CD, would add ongoing
cost and maintenance burden disproportionate to the product's current
stage — so this ticket is scoped as **documentation + guided verification
of what already works**, not new infrastructure.

## What's changing

### 1. Staging — formalize the existing local-Supabase workflow

No new hosted project. This session already proved `npx supabase start` +
`npx supabase test db` catches real bugs before they'd ever reach
production (the `037_devices.sql` fix, the duplicate-migration-`038`
collision, the pgTAP fixture/session-id bugs from WAFI-002/003/007 — all
found by running the local stack for real, not by inspection). Document
this explicitly as the project's pre-deploy verification step in a new
`docs/DEPLOYMENT.md`, rather than leaving it as tribal knowledge from this
session's transcripts.

### 2. Backup — guided real verification, not a guess

A new section in `docs/DEPLOYMENT.md` explaining what to check in the
Supabase dashboard (project tier, whether Point-in-Time Recovery or daily
backups are enabled, how to trigger/download a manual backup) — written
generically enough to serve as a checklist for any Supabase project, not
assuming a specific tier. Since I cannot access the actual production
Supabase dashboard, this section's real-world confirmation happens as a
guided walkthrough with the user (outside the coding/subagent pipeline —
this is a "do this together" step, not a "subagent verifies this" step),
and the doc gets updated with the actual, confirmed answer once done.

### 3. Rollback runbook — two distinct cases

New `docs/DEPLOYMENT.md` sections (or a dedicated `docs/ROLLBACK.md` if
the combined doc gets unwieldy — implementer's call, default to one file
unless it clearly needs splitting):

- **App-deploy rollback**: generalizes the pattern already documented in
  `docs/superpowers/plans/2026-07-22-wafi-002-customer0-login-migration-runbook.md`
  (keep the previous build deployable as a fallback; the known PWA
  service-worker gotcha — a prompt-mode service worker caches the old
  bundle and needs a second online reload to actually take control —
  applies generally, not just to that one migration).
- **Migration rollback**: migrations are additive-only on live data
  (`ENFORCEMENT.md` §6 — "expand only, never DROP/RENAME on live data").
  A bad migration therefore can't be undone in place; document the real
  procedure — ship a corrective forward migration, never edit already-run
  migration history, and if the bad migration broke something functional
  client-side, that's an app-deploy rollback (above), not a database
  rollback.

### 4. Pre-deploy checklist

A literal, short checklist in `docs/DEPLOYMENT.md` that ties the above
together — the actual "checklist" the ticket's title asks for:

1. Full test suite passing (`npm test`)
2. `npx supabase db reset` + `npx supabase test db` clean against a fresh
   local stack (the staging step)
3. `npm run build` clean (type-check + bundle)
4. Sentry confirmed active (check the dashboard shows recent events, or a
   deliberate test error, from the current deployment)
5. Backup status confirmed within a reasonable recency window (document
   what "reasonable" means once the guided verification in #2 above
   establishes the actual tier/schedule)
6. Rollback plan understood by whoever is deploying — links to the
   runbook sections above

## Testing

Documentation-only ticket — no code changes, no automated tests. The
"testing" this ticket produces is the guided backup-verification
walkthrough itself (a one-time, human-executed confirmation, similar in
spirit to WAFI-002/003/004's manual verification steps), and the fact that
the staging step it documents (`supabase db reset` + `test db`) is already
proven to work by this session's own history.

## Out of scope

- Any CI/CD pipeline (GitHub Actions, automated deploy-on-push) — not
  something to build at this stage per the budget/staffing constraint.
- A real second hosted Supabase project for staging — explicitly rejected
  in favor of the local-Supabase workflow above.
- Automating the rollback procedures themselves (e.g. a one-command
  revert script) — these are documented manual procedures, matching this
  project's existing "manual deploy, whoever has access to the device"
  reality (per the WAFI-002 customer-0 runbook).
