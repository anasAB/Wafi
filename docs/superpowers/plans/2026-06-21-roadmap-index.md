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
| Switch operator (no shift change) | spec `specs/2026-06-21-switch-operator-design.md` · plan `plans/2026-06-21-switch-operator.md` · ticket WAFI-053 | ✅ DONE + verified (9/9 AC pass, 62/62 tests). Closed WAFI-011 too. |

---

## Post-pivot build order (decided 2026-06-21)

**Strategy change:** real inventory loads *after* the trip (CEO provides the catalog on return). The trip is now a **demo + buy-in** moment (shown with sample data); the brother's real daily use begins post-trip. So we invest now in making the *single shop* correct, trustworthy, and complete — not in scaling features. The brother **has 1+ employees**, so the accountability cluster is day-one valuable to him.

**Build now, in order:**
- **Tier 1 — Correctness & trust:** WAFI-002 ✅done · WAFI-003 ✅done · WAFI-004 · WAFI-005 · WAFI-006 · WAFI-007 · WAFI-008. Plan: `plans/2026-06-21-tier1-correctness.md`.
- **Tier 2 — Accountability (has staff):** WAFI-009 (immutable audit) ✅done (client/DB trigger; server-side gating still in the Role-Enforcement epic) · WAFI-012 (PIN hardening) ✅done (salted hash + per-device offline lockout; server-coordinated lockout deferred to WAFI-010) · WAFI-014 (attribution/events) ✅done · WAFI-013 (Manager role) ✅done · switch-operator ✅done. Plan: `plans/2026-06-21-tier2-accountability.md`.
- **Tier 3 — Usability polish:** WAFI-018 · WAFI-030 · WAFI-031 · WAFI-025 · WAFI-026/027 · WAFI-021/022 · WAFI-032. Plan: `plans/2026-06-21-tier3-usability.md`.

**Deferred (scaling, not the brother's benefit):** WAFI-001 full (run on the stub) · Auth self-serve epic · device registration WAFI-016 (only if a 2nd physical register) · Excel import wizard (white-glove load instead) · **WAFI-010 server-side role epic** (heavy, fights offline — the immutable audit log covers ~90% of the practical "see who's stealing" value for one trusted shop; revisit when scaling to pilots).

**Not blocked by inventory, still required:** verify the golden path (sign-in → sync → offline reload → isolation) with sample data.

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
