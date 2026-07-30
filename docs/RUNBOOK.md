# Runbook Index — "Something's wrong, what do I do?"

> Cited by CLAUDE.md, part of WAFI-021 (Documentation & Runbook). This is the front door
> for production incidents — it doesn't contain procedures itself, it routes to the doc
> that does. If you're here mid-incident, find your situation below and go straight to the
> linked section. For engineering "where does X live" questions (not incidents), see
> `docs/architecture/ARCHITECTURE.md` §7 instead.
> Last updated: 2026-07-30.

---

## By situation

| Situation | Go to |
|---|---|
| A deployment just went out and something looks broken | `docs/DEPLOYMENT.md` § Rollback → "1. Application rollback" |
| A migration shipped a bug against production data | `docs/DEPLOYMENT.md` § Rollback → "2. Data rollback (impossible)" — the fix is a forward migration, never an edit to applied history |
| Actual data loss or corruption (not a migration bug) | `docs/DEPLOYMENT.md` § Rollback → "3. Emergency recovery", then `docs/BACKUP.md` — **read this first**: production is on Supabase Free tier with zero backup capability, so today there is no recovery path other than whatever survives on individual devices' local PowerSync/SQLite caches |
| A customer reports the app is broken / can't sell | `docs/DEPLOYMENT.md` § After Deployment, step 9 (smoke test checklist) to reproduce; check `docs/OPERATIONS.md` § Error Tracking (Sentry) for a matching error |
| Sync stuck, or a write was rejected and quarantined | `docs/architecture/ARCHITECTURE.md` §4 "Dead-letter queue" — surfaced in-app via `src/features/sync/SyncIndicator.vue` |
| A customer's PWA seems to be running an old version after a deploy | `docs/DEPLOYMENT.md` § After Deployment, step 12 — service worker runs in `prompt` mode; "deployed" and "customer is running the new bundle" are different facts |
| New/unfamiliar errors piling up | `docs/OPERATIONS.md` § Weekly Review Checklist → Sentry step |
| A support message came in via WhatsApp | `docs/OPERATIONS.md` § Support SLA for response-time commitment |
| Something looks off in the audit trail (unexpected deactivation, repeated failed logins, large discount) | `docs/OPERATIONS.md` § Weekly Review Checklist → Audit log step; underlying guarantee is WAFI-007's financial-write wrapper |
| A new "first write for this identity" flow (bootstrap, registration, pairing) is locking users out | `docs/architecture/ARCHITECTURE.md` §5 "Circular-lockout case study" — this exact shape has recurred twice (migrations `069`, `072`) |
| About to deploy | `docs/DEPLOYMENT.md` § Before Deployment / During Deployment |
| Need to know if a ticket is actually done before relying on it | `WAFI_Production_Readiness_Plan_v3.md`'s IMPLEMENTATION STATUS table — verify against the code, it has been caught stale before |

## Escalation

Given the founders' part-time availability, there is no 24/7 on-call — see
`docs/OPERATIONS.md` § Support SLA for the honest response-time commitment. The one
exception: **data-loss or complete inability to sell is treated as urgent regardless of
time**, per that same section.

## Doc map

| Doc | Covers |
|---|---|
| `docs/OPERATIONS.md` | Weekly review checklist, support SLA, error tracking, in-app reporting |
| `docs/DEPLOYMENT.md` | Pre/during/post-deploy checklist, the three rollback situations |
| `docs/BACKUP.md` | Current (lack of) backup capability, restore procedure, last-verified-restore date |
| `docs/architecture/ARCHITECTURE.md` | System shape, known architectural gaps/trade-offs |
| `docs/architecture/DATA_MODEL.md` | Tables, invariants, which migration to open |
| `docs/architecture/API_CONTRACTS.md` | RPC surface, contract stability |
