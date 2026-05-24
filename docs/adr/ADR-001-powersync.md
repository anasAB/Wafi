# ADR-001 — PowerSync as offline-first sync layer

| Field      | Value                          |
|------------|-------------------------------|
| Date       | 2026-05-20                    |
| Status     | Accepted                      |
| Deciders   | Anas Baaj (CTO)               |
| Supersedes | None                          |

## Context
App must work fully offline on phones with unreliable connectivity in Syria.
Data must sync transparently when connectivity returns. Rolling the sync layer
would take months and be a permanent maintenance burden.

## Decision
Use `@powersync/web` as the offline-first sync engine. Local SQLite via WASM
serves all reads and writes; PowerSync syncs changes to Supabase Postgres in
the background.

## Alternatives Considered
| Option | Why Rejected |
|--------|-------------|
| RxDB | More setup, custom sync protocol, less production maturity at scale |
| ElectricSQL | Postgres-first, excellent, but less battle-tested on mobile PWA |
| Hand-rolled sync | Months of work, conflict resolution is a solved problem |

## Consequences
**Positive:** Offline-first guaranteed; conflict resolution built-in; scales to 100+ devices.
**Negative:** WASM bundle adds ~500KB; debugging sync requires PowerSync dashboard.

## Architecture Guidelines
- All reads via `db.execute()` — no direct Supabase reads in composables
- All writes via `db.execute()` — PowerSync queues uploads automatically
- `connector.ts` is the only file that touches Supabase client directly
- VITE_POWERSYNC_URL blank = offline-only mode (acceptable for development)

## Review Date
Revisit at 100 customers if PowerSync pricing becomes significant.
