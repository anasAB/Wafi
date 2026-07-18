# ADR-008: Per-Shop Feature Flags via a JSONB Column on `shops`

**Status:** Accepted · **Date:** 2026-07-18 · **Ticket:** WAFI-131

## Context

Option C modular pricing (locked business model) requires switching packs per
customer, and CLAUDE.md's week-1 decision #3 mandates feature-flag
infrastructure before v1 ships. Nothing could be switched per customer: the
only flag was a compile-time env boolean (`src/config/featureFlags.ts`).

Options considered: (a) LaunchDarkly/GrowthBook — recurring cost and an online
dependency in an offline-first product for ~4 flags; rejected. (b) a
`shop_features` table — more moving parts (new sync rule, N rows to join) for
the same information; rejected. (c) **a `features` JSONB column on `shops`** —
the shops row already syncs to every device of the shop, flags are one blob
per shop, zero new sync rules.

## Decision

- `shops.features jsonb` (migration 041), values set exclusively by us
  server-side; a trigger blocks JWT-carrying (client) updates to the column.
- Semantics: `NULL` → all packs ON (explicit grandfathering of existing
  shops, backfilled in the migration); key missing → OFF (new features
  default closed for old rows); otherwise the boolean value.
- Client: `src/features/flags/flagRegistry.ts` is the single key registry
  (staff_pack, customer_pack, reporting_pack, electronics_pro) with pack →
  feature mapping; `useFlagsStore` reads the synced row once per app session.
- Gating points: route `meta.feature` (router guard → `/feature-locked`
  teaser), nav items (`feature` key on nav defs). Data keeps syncing when a
  pack is off — gating hides UI, never deletes anything.
- Flag changes apply at next app start / navigation, never mid-operation.
- Proof gate: `/reports` (+ its nav entries) gated by `reporting_pack`.

## Consequences

- Client-side gating is UX, not security — a tampering user can flip local
  state. Revenue-critical enforcement is WAFI-122's server-side sync model.
- The pre-auth build-time flags (`src/config/featureFlags.ts`) remain for
  surfaces with no customer to flag against (landing page); the registry
  lists `electronics_pro` in both worlds until the pack ships.
- Adding a flag = one registry entry + gating points; no schema change.
