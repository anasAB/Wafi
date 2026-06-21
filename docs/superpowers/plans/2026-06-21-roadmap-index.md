# Wafi — Planning Roadmap & Index

> Date: 2026-06-21 · Maintained by: PO
> One map for all current planning artifacts: what each is, its status, and the order to do them.
> Anchor goal: get customer #0 (the brother) ringing real sales daily on the Syria trip, then make the product able to hold more than one shop.

---

## Time horizon 1 — Before the trip (the golden path)

Goal: the brother opens Wafi, is already signed in, his real inventory is loaded, he rings sales offline, numbers are correct. **No new features — harden one shop.**

| Item | Artifact | Status |
|---|---|---|
| Single-device auth session | `plans/2026-06-20-task1-single-device-auth-session.md` | Speced; dev reports code complete, blocked on Task 2 to verify |
| Provision brother's account + shop | `plans/2026-06-20-task2-provision-brother-account-shop.md` | Speced; ready to execute (unblocks Task 1) |
| Verify `powersync.yaml` deploys | (co-dependency in Task 2) | Pending — load-bearing infra risk |
| Tenant-scoping trip workaround | Audit ticket WAFI-001 (stub) | Set `VITE_STUB_SHOP_ID` to his shop id |
| Rate-lock fix | Ticket WAFI-002 | Pre-trip fix |
| Double-tap pay fix | Ticket WAFI-003 | Pre-trip fix |
| Dashboard day-boundary | Ticket WAFI-007 | If time |
| Load his real inventory | (white-glove script) | **Blocked: need his spreadsheet** |
| Offline rehearsal on his phone | (test task) | Before flying |

**Dev order:** Task 2 → verify powersync deploy → Task 1 verify → WAFI-001 stub → WAFI-002 + WAFI-003 → inventory load → offline rehearsal.

## Time horizon 2 — Post-trip epics (make it hold >1 shop)

| Epic | Artifact | Why it's next |
|---|---|---|
| Real Auth & Self-Serve Onboarding + Device Registration | `plans/2026-06-20-epic-real-auth-onboarding-device-registration.md` | The gate between one hand-provisioned shop and self-onboarding pilots. Absorbs WAFI-001 (full), WAFI-016. |
| Server-Side Role Enforcement | `plans/2026-06-20-epic-server-side-role-enforcement.md` | Makes roles real (the "see who's stealing" security half). Depends on the Auth epic. Two open design decisions (KD-2, KD-3) deferred. Absorbs server side of WAFI-009, WAFI-012. |

**Parked (post-trip, inside the Auth epic):** self-serve signup/login — deliberately not built for the trip.

## Time horizon 3 — Backlog

| Item | Artifact | Status |
|---|---|---|
| Full audit findings (52 tickets, WAFI-001…052) | `plans/2026-06-20-audit-findings-tickets.md` | Tiered P0–P3; 4 PO decisions locked |
| Switch operator (no shift change) | spec `specs/2026-06-21-switch-operator-design.md` · plan `plans/2026-06-21-switch-operator.md` · ticket WAFI-053 | Speced + planned; carries WAFI-011 |

---

## Locked PO decisions (2026-06-20/21)

- **Manager role** — build in v1 (WAFI-013).
- **Negative stock** — forbid/keep the block; update Epic 2.4/2.7 spec to match (WAFI-019).
- **Permissions** — build server-side enforcement; promoted to its own epic (WAFI-010).
- **Exchange rate** — integer-only (WAFI-035).
- **Shift model** — one shift per working session; operators swap inside it (switch-operator spec).
- **Sale attribution** — the operator who *completes* the sale (switch-operator spec).

## Open / pending

- **From CEO:** the brother's inventory spreadsheet (unblocks the pre-trip inventory load).
- **Deferred decisions:** Role-Enforcement KD-2 (sync-time gating vs online-only) and KD-3 (shared-device offline downgrade) — settle with the dev before that epic starts.
- **`devAuth.ts`** — the PO's accidental edit was reverted; the change itself is specified in Task 1 for the dev to make.

## Note on the "see who's stealing" promise

It depends on a cluster that must ship together to be real: immutable audit log (WAFI-009), server-side roles (WAFI-010 epic), and PIN hardening (WAFI-012). Any one alone is theater. Track them as a set.
