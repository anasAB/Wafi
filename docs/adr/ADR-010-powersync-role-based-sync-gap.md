# ADR-010: PowerSync Sync-Rule Role Branching Is Not Enforced (WAFI-122 Scope Boundary)

**Status:** Accepted
**Date:** 2026-07-21
**Related:** WAFI-122 (Server-Side Role Enforcement), ADR-009 (device-scoped
active_role claim for financial-column visibility)

## Context

WAFI-122 closes the direct-access authorization gap: RLS now blocks a
cashier from reading `staff`, `audit_log`, other shifts' `sales`, etc. via
any request that authenticates through PostgREST using the caller's own
JWT (curl, Postman, a modified client).

PowerSync's bulk-sync replication does not go through PostgREST and does
not authenticate as the end-user's JWT — it connects via its own
sync-service credentials and is governed entirely by the correlated-
subquery rules in `powersync.yaml`, independent of the RLS policies added
in WAFI-122. This project's PowerSync edition was already found (during
ADR-009's implementation) to not reliably support
`subscription.parameter()`-based per-role bucket branching — it returned
zero rows in live testing and the attempt was reverted; `powersync.yaml`
documents this.

## Decision

WAFI-122 does not attempt to make PowerSync's sync stream itself
role-aware. A cashier's device, once synced, holds a full local SQLite
copy of every table PowerSync is configured to sync — including `staff`
(minus what the app chooses to display), `audit_log`, and other staff
members' `sales` rows — regardless of the RLS policies added in WAFI-122.

This is an accepted, explicitly documented platform limitation, not a
silently dropped requirement.

## Consequences

- The WAFI-122 threat model's "Does NOT prevent" list (design spec §8)
  includes offline SQLite inspection on a synced device as an explicit,
  known gap.
- Confidentiality for financial/staff data on a cashier's device currently
  depends entirely on the client application choosing not to query or
  display synced-but-sensitive local tables — NOT on any database-level
  control. This is weaker than the RLS guarantee WAFI-122 provides for
  direct API access, and should be understood as such by anyone reasoning
  about this system's security posture.
- Follow-up ticket **WAFI-201** is filed to investigate: (a) whether a
  newer PowerSync edition/version supports parameterized sync buckets
  reliably, (b) encrypted local SQLite as a mitigation independent of sync
  branching, (c) device attestation / remote revoke as compensating
  controls (partially already possible via the existing `devices` remote
  sign-out flow).

## Alternatives Considered

- **Re-attempt PowerSync role branching as part of WAFI-122** — rejected;
  effort/outcome was unknown given the prior revert, and would have
  blocked shipping the direct-access fix (the more acute, provably-fixable
  vulnerability) on an open-ended spike.
- **Silently accept the gap without documenting it** — rejected; violates
  this project's own principle that server-side authorization must be
  authoritative and explicit about its boundaries (design spec §3.1, INV-007).
