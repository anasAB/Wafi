# ADR-002 — Supabase as Postgres backend

| Field      | Value           |
|------------|----------------|
| Date       | 2026-05-20      |
| Status     | Accepted        |
| Deciders   | Anas Baaj (CTO) |
| Supersedes | None            |

## Context
Need managed Postgres compatible with PowerSync's change-data-capture sync.
Budget is €100-200/month. CTO has no DBA background.

## Decision
Use Supabase for hosted Postgres, Auth, and Storage. Free tier covers 0-15 customers.

## Alternatives Considered
| Option | Why Rejected |
|--------|-------------|
| Neon | Good option, but Supabase Auth + Storage integration saves time |
| Self-hosted Postgres | Ops overhead not justified at current scale |
| PlanetScale | MySQL — not compatible with PowerSync Postgres CDC |

## Consequences
**Positive:** Managed backups, dashboard, Auth, RLS, Storage bundled.
**Negative:** Vendor lock-in; pricing changes at scale.

## Architecture Guidelines
- Schema changes via `supabase/migrations/` only — never manual dashboard edits
- Follow expand-contract migration pattern (ENFORCEMENT.md §6)
- RLS policies added when real multi-tenant auth ships

## Review Date
Revisit at 50 customers for cost/performance check.
