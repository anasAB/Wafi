# ADR-004 — Offline-first architecture (local-first, sync secondary)

| Field      | Value           |
|------------|----------------|
| Date       | 2026-05-20      |
| Status     | Accepted        |
| Deciders   | Anas Baaj (CTO) |
| Supersedes | None            |

## Context
Syrian internet connectivity is unreliable. Shop owners cannot afford to lose
sales because of a network outage. This is Sacred Rule #1 in CLAUDE.md.

## Decision
All reads and writes go to local SQLite first (via PowerSync). Network is
treated as a secondary optimization, not a prerequisite. The app is
fully functional with zero connectivity.

## Architecture Guidelines
- No composable may make a direct HTTP request for POS-critical data
- `db.execute()` is the only data access primitive
- Sync status shown to user but never blocks operations
- Dexie drafts survive app kills — see ADR-003 + useSaleDraft

## Review Date
Fundamental constraint — never revisit.
