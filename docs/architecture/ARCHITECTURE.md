# ARCHITECTURE.md — System shape, at a glance

> Cited by CLAUDE.md, part of WAFI-021 (Documentation & Runbook). The **where does this
> live** companion to PRINCIPLES.md (how), PATTERNS.md (what shapes), and ENFORCEMENT.md
> (verify). This file is a map, not a tutorial — each section links to the doc that owns
> the detail.
> Last updated: 2026-07-30.

---

## 1. What WAFI is

An offline-first PWA retail POS (Vue 3 + TypeScript) for small shops in Syria/MENA:
checkout, inventory, customer credit, cash-shift reconciliation, and owner reporting.
Arabic-first (RTL primary, English fallback), dual USD/SYP currency, designed to run on
cheap Android phones with unreliable connectivity. See the project's `CLAUDE.md` for the
product/business context — this doc only covers the engineering shape.

## 2. High-level shape

```
Vue 3 SPA (PWA)
  │
  ├─ Local-first data layer: PowerSync (client) ── wa-sqlite (local DB, source of truth
  │    for reads/writes while offline) ── syncs bidirectionally to Postgres
  │
  └─ Postgres (Supabase): source of truth for auth, RLS-enforced tenant isolation,
       and the few operations that must be server-authoritative (see API_CONTRACTS.md)
```

There is **no custom backend/API server** — the client talks to Supabase directly
(Postgres + PowerSync sync rules + a small set of Postgres RPC functions). See
API_CONTRACTS.md.

## 3. Business logic layer: composable-based, not service-based

As of this writing, business logic lives in feature composables (`use<Feature>.ts` per
PATTERNS.md §1), not in a dedicated service class layer (`SalesService`,
`InventoryService`, etc.). This is a **known, tracked architectural gap**: the v3
production-readiness roadmap's Macro-Phase 2A (`WAFI-152`, Business Services Layer) plans
to extract one, specifically so future consumers (a real API, batch import, an event bus)
can reuse the same logic without duplicating it out of Vue composables. Until WAFI-152
ships, treat composables as the de facto business logic layer and keep them
framework-light (minimal direct Vue reactivity coupling in the parts that are pure
calculation) so the eventual extraction is mechanical, not a rewrite.

## 4. Offline-first data layer

- **Sync engine:** PowerSync (`@powersync/web`). Local storage is SQLite via wa-sqlite,
  which the app treats as the source of truth for both reads and writes — every screen
  reads/writes locally first; PowerSync replicates to/from Postgres in the background.
  Implementation lives in `src/data/powersync/` (`db.ts` — the db handle, `schema.ts` —
  local table schema, `connector.ts` — sync wiring, `ops.ts`).
- **Dead-letter queue:** writes the server RLS/validation layer rejects are not retried
  forever or silently dropped — `src/data/powersync/dead-letter.ts`'s `quarantineOp()`
  parks them in a local `sync_dead_letter` table for owner/manager review (retry or
  discard), surfaced in the sync detail panel (`src/features/sync/SyncIndicator.vue`).
  See DATA_MODEL.md for the table.
- Rationale for local-first over a thin/cached client: ADR-004 (offline-first).

## 5. Auth & multi-tenancy

- Tenant isolation is enforced by Postgres RLS keyed on `shop_id`/`owner_user_id`, not a
  client-side filter — see the tenant-isolation memory/ADR trail and
  `docs/adr/ADR-009-server-side-financial-role-enforcement.md` (server-side role
  enforcement) and `docs/adr/ADR-010-powersync-role-based-sync-gap.md`.
- **Known accepted gap (ADR-010):** PowerSync's sync stream itself is not role-aware —
  once a device syncs, its local SQLite copy holds every row PowerSync replicates for that
  shop (including tables like `staff`/`audit_log`), regardless of the signed-in operator's
  role. Enforcement for those tables is RLS (server writes) + client-side display
  restriction (UI never shows the data), **not** withholding rows from the sync stream.
  This is a deliberate, documented trade-off — do not "fix" it by trying to filter
  PowerSync's replication without re-reading ADR-010 first.
- Role is carried as a JWT claim (`active_role`), re-resolved on every token refresh, so
  RLS policies and PowerSync sync-rule branching can both read it.
- **Circular-lockout case study**: server-authoritative identity bootstrapping is easy to
  get wrong in a way that locks out every new signup at once. Migration `069`
  (`bootstrap_owner_identity`) fixed the original owner-bootstrap chicken-and-egg problem;
  a second instance of the same shape recurred for device registration (RLS required
  `active_role='owner'` to write a `device_sessions` row, but establishing `active_role`
  required registration to have already happened) and was fixed by the `register_device`
  `SECURITY DEFINER` RPC in migration `072`. If you add a new "first write for this
  identity" flow, check whether it can hit this pattern before shipping it.

## 6. Feature-flag / pack gating

Per-shop feature packs (Core/Staff/Customer/Reporting/Electronics Pro — see CLAUDE.md's
pricing section) are gated by a `shops.features` JSONB flag column (migration 041),
exposed client-side via `useFlagsStore`/`flagRegistry` (`src/features/flags/`) and
enforced both in the router (`meta.feature` on a route, per `src/router/index.ts`) and
inline in nav components. See ADR-008 (per-shop feature flags).

## 7. Where to look next

| Question | Doc |
|---|---|
| What folder does new code go in? | PATTERNS.md §1 |
| What are the engineering ground rules / SOLID checklist? | PRINCIPLES.md |
| What must a PR pass before merge? | ENFORCEMENT.md |
| What tables exist and what do they mean? | DATA_MODEL.md |
| What RPCs/API surface does the client call? | API_CONTRACTS.md, `WAFI-122-rpc-audit.md` |
| Why was decision X made? | `docs/adr/ADR-NNN-*.md` |
| Is a given ticket done? | `WAFI_Production_Readiness_Plan_v3.md`'s IMPLEMENTATION STATUS table — **verify against the code before trusting it**, this table has been caught stale before |
| Something's broken in production right now | `docs/RUNBOOK.md` — situation-indexed, routes to the right procedure |
