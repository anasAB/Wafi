# WAFI-023: Post-Launch Monitoring & Feedback Design

**Date:** 2026-07-23
**Status:** Approved
**Ticket:** WAFI-023 (P2, Ongoing, "Sentry, in-app reporting, weekly review, SLA")

## Context

Confirmed via investigation: no monitoring or feedback infrastructure exists
today. No Sentry/PostHog/any error-tracking SDK in `package.json` or `src/`.
No in-app bug-report or feedback flow (a repo-wide search for
report/feedback UI only matched unrelated form labels). `ForgotPasswordPage.vue`
already tells users to "contact support via WhatsApp" but has no working
button — just prose.

This is a genuinely unbuilt ticket, unlike WAFI-002/003/004/007 in this
session, which turned out mostly-built on investigation.

**Constraint this design is built around:** part-time founders, €100-200/month
budget, one live customer today (customer #0). Scope is deliberately small —
free-tier tools, no new backend, reusing this app's existing WhatsApp-first
support philosophy (CLAUDE.md: "No Stripe... Collection Strategy" — the same
reasoning applies to support/feedback channels, not just payments).

## What's changing

### 1. Sentry error tracking

- Add `@sentry/vue` (free tier).
- Initialize in `src/main.ts`, gated by `import.meta.env.PROD` — matches
  this repo's existing pattern of no-op-ing integrations when unconfigured
  (`src/data/supabase/client.ts` already warns and no-ops when its env vars
  are unset).
- New env var `VITE_SENTRY_DSN` (empty by default in `.env.local.example`;
  when empty, Sentry init is skipped entirely rather than erroring).
- A `beforeSend` hook scrubs PII before any event leaves the browser: strip
  values for known-sensitive field names appearing in event `extra`/
  breadcrumb data (`phone`, `customerName`, `nameAr`, `name`) and redact any
  string matching a phone-number-like pattern (`\+?\d{9,}`). This is real
  Syrian shop customer data going to Sentry's (US-based) servers — scrub
  first, not an afterthought.

### 2. In-app "report a problem"

- New Settings screen, `src/features/settings/screens/ReportProblemScreen.vue`,
  routed at `/settings/report-problem` (added to the `/settings` children
  array in `src/router/index.ts`, alongside the existing `devices`/
  `recovery-codes` entries).
- Reuses the existing `openWhatsApp(phone, text)` helper from
  `src/features/messaging/whatsapp.ts` verbatim — no new messaging code.
- New env var `VITE_SUPPORT_WHATSAPP_PHONE` (the founders' own support
  number — distinct from any shop customer's phone).
- The screen has one optional text field ("صف المشكلة باختصار") and a
  single button that opens WhatsApp via `openWhatsApp`, with a prefilled
  message built from: the current route path and the user's optional text.
  (No app-version stamp: `package.json`'s `"version": "0.0.0"` is an
  unmaintained placeholder, not a real build identifier — including it
  would add a hollow field rather than useful debugging context. Adding
  real version stamping is a separate concern, not part of this ticket.)
- `ForgotPasswordPage.vue` gets the same treatment: its existing "contact
  support via WhatsApp" prose becomes a real button using the same
  `openWhatsApp` call and the same `VITE_SUPPORT_WHATSAPP_PHONE` env var —
  two lines, reusing the exact same helper, no new component needed there.

### 3. Weekly review + SLA (documentation only)

New `docs/OPERATIONS.md`:

- **Weekly review checklist**: check Sentry for new/recurring errors, check
  WhatsApp for unresolved support messages, spot-check the audit log
  (`/settings/audit-log`, already built) for anything unusual. A short,
  practical checklist — not a tool, not automated.
- **SLA**: an honest, written response-time commitment matching the
  founders' actual part-time availability (e.g. same-day response during
  weekday evenings, next business day otherwise) — not an enterprise 24/7
  SLA. This document is what WAFI-022's later "SLA" checklist item will
  point back to.

## Testing

- Sentry: a unit test for the `beforeSend` scrubber function in isolation
  (pass a fabricated event containing a phone-number-shaped string and a
  `customerName` field, assert both are redacted in the returned event) —
  do not attempt to test real Sentry network calls.
- In-app reporting: a unit test for `ReportProblemScreen.vue` (or its
  underlying composable, if one is extracted) asserting `openWhatsApp` is
  called with the configured support phone and a message containing the
  route path and any entered text.
- `ForgotPasswordPage.vue`: extend its existing behavior with a test
  confirming the new button calls `openWhatsApp` with the support phone.
- No test for `docs/OPERATIONS.md` — it's prose, not code.

## Out of scope

- Weekly review automation (e.g. a scheduled report) — this is a founder
  practice, not a feature to build.
- Any backend/database changes — Sentry and the WhatsApp flow are both
  client-only integrations against existing helpers/env vars.
- WAFI-022's actual "staging/backup/rollback tested" checklist — this
  ticket only unblocks WAFI-022's monitoring-related checklist item by
  making monitoring exist; the rest of WAFI-022 is separate, later work.
- Session replay, performance monitoring, or any Sentry feature beyond
  basic error capture — matches the "free tier, minimal footprint" budget
  constraint.
