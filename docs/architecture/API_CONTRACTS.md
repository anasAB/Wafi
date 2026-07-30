# API_CONTRACTS.md — The client's server-facing surface

> Cited by CLAUDE.md, part of WAFI-021 (Documentation & Runbook). Companion to
> ARCHITECTURE.md and DATA_MODEL.md. There is no custom REST/GraphQL API in this project —
> this doc is "API contracts" in the sense of: every place the client makes a promise about
> what the server will do. Keep this list in sync whenever an RPC is added, renamed, or
> removed — a stale list here is worse than no list.
> Last updated: 2026-07-30.

---

## 1. No custom backend

The client talks to Supabase directly. There is no `src/api/` layer and no Node/Express/
Fastify server in this repo. The "API" is:

1. **PostgREST** (Supabase's auto-generated REST-over-Postgres), gated by RLS — this is
   what PowerSync's sync stream and any direct Supabase client read/write goes through.
2. **PowerSync sync rules** (`powersync.yaml` on the PowerSync service) — determines what
   each device replicates, branching on the JWT's `active_role` claim (ADR-009).
3. **A small set of Postgres RPC functions** for operations that must be server-authoritative
   (see below) — these are the closest thing to a real "API contract" in this codebase.

## 2. RPC functions the client calls

| RPC | Purpose | Why it's server-side, not a local write |
|---|---|---|
| `bootstrap_owner_identity` | Atomically creates the first owner's `devices`/`staff`/`device_sessions` rows on signup | Must be `SECURITY DEFINER` — the client can't create its own `staff` row under RLS before it has a role to create it with (see the owner-bootstrap circular-lockout fix, migration `069`) |
| `switch_active_operator` | Confirms which staff member is the active operator on a device, sets the JWT's `active_role` | Role must be server-confirmed, not client-asserted, so RLS/sync-rule branching can trust it (WAFI-203) |
| `allocate_device_code` | Issues a device pairing code for self-serve multi-device registration | Needs to be unique and server-generated |
| `record_device_session_id` | Records which Supabase Auth session belongs to which device | Enables real remote sign-out (see `record_device_session_id`/`revoke_device_session`, migration `067`) |
| `revoke_device_session` | Revokes a specific device's live Supabase Auth session on remote sign-out | Soft `is_active` flags alone don't kill an existing session — this does |
| `register_device` | Registers a device's `device_sessions` row before the device has an `active_role` to write it under RLS | `SECURITY DEFINER`, added to fix a circular-lockout bug: device registration required `active_role='owner'`, which itself required registration to have already happened (migration `072`) |

**Before adding a new RPC:** check `docs/architecture/WAFI-122-rpc-audit.md` — an existing
RPC-focused security audit that should be extended, not duplicated, when the RPC surface
changes. Every RPC here should also appear there with its grant/security-definer rationale.

## 3. What's NOT server-authoritative (by design)

Everything else — sales, returns, expenses, inventory adjustments, customer/supplier
ledger entries — is written directly by the client to Postgres tables (via PowerSync's
upload queue), gated by RLS, not by an RPC. This is intentional: those writes need to work
fully offline and queue for later sync, which an RPC call cannot do. Only promote a write to
an RPC when it genuinely cannot be expressed as "insert a row that RLS will accept" — e.g.
it requires atomicity across multiple tables that can't each individually pass RLS on their
own (the bootstrap case), or it must mutate server-only state like an auth session.

## 4. Contract stability

There is currently no formal event/payload versioning scheme (that's the v3 roadmap's
Macro-Phase 2B, WAFI-140/142 — not started). Until then, treat any RPC signature change as
breaking: a client on an old build calling a changed RPC will fail loudly, not gracefully,
so an RPC parameter can't be renamed/removed without confirming no in-flight client build
still calls the old shape (relevant given the offline-first upload queue can hold a write
for a long time before it syncs).
