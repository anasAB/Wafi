# Wafi Operations

## Weekly Review Checklist

Run through this once a week (not automated — a founder practice):

1. **Sentry** — open the project dashboard, check for new or recurring
   errors since last week. Anything affecting the live shop (customer #0)
   is priority; anything else, triage by frequency.
2. **WhatsApp** — check the support number for any unresolved messages
   from the "report a problem" flow or `ForgotPasswordPage.vue`'s contact
   button. Respond per the SLA below.
3. **Audit log** — spot-check `/settings/audit-log` for anything unusual
   (repeated failed logins, unexpected deactivations, large discounts) —
   this is the same trail WAFI-007's financial-write wrapper guarantees
   gets written on every financial action.

## Support SLA

Given the founders' part-time availability (day jobs, side-project hours),
this is an honest, sustainable commitment — not a 24/7 enterprise SLA:

- **Weekday evenings**: same-day response to WhatsApp support messages.
- **Weekends / outside evening hours**: next business day.
- **Data-loss or complete inability to sell**: treated as urgent regardless
  of time — reach out directly, don't wait for the weekly review cycle.

This SLA is what WAFI-022's "monitoring tested" checklist item should
point back to once that ticket is picked up.

## Error Tracking (Sentry)

- Free tier, client-side only (`src/sentry.ts`).
- Disabled unless `VITE_SENTRY_DSN` is set in the deployed build's
  environment, and only active in production builds.
- PII (customer names, phone numbers) is scrubbed before events leave the
  browser — see `scrubPiiBeforeSend` in `src/sentry.ts`.

## In-App Reporting

- Settings → "الإبلاغ عن مشكلة" (`/settings/report-problem`) and
  `ForgotPasswordPage.vue`'s support button both open WhatsApp to
  `VITE_SUPPORT_WHATSAPP_PHONE` — the founders' own number, configured
  per deployment.
