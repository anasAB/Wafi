# ADR-003 — Feature-first folder structure with index.ts public APIs

| Field      | Value           |
|------------|----------------|
| Date       | 2026-05-20      |
| Status     | Accepted        |
| Deciders   | Anas Baaj (CTO) |
| Supersedes | None            |

## Context
Single developer initially. Will onboard 1-2 more. Need clear ownership
boundaries to prevent spaghetti imports as the codebase grows.

## Decision
Feature-first folders: `src/features/[feature]/`. Each feature exposes only
`index.ts` as its public API. Cross-feature imports must go through `index.ts`.

## Architecture Guidelines
- `src/features/[feature]/index.ts` — public API only
- Internal files within a feature are private
- `src/components/ui/` — domain-agnostic, presentational only
- `src/composables/` — cross-cutting composables (used by 2+ features)
- Enforce with import-linter when CI is set up (ENFORCEMENT.md §2)

## Review Date
Stable — revisit only if team grows past 5 developers.
