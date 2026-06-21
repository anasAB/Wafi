# Task 2 — Provision the Brother's Account & Shop (manual, single shop)

> Date: 2026-06-20
> Owner: CTO (dev) — mostly Supabase environment work, not app code.
> Priority: **P0** — unblocks Task 1 verification (AC 1, 7, 12) and the trip.
> Depends on nothing. **Unblocks:** Task 1 end-to-end ACs.

---

## Why this exists

Task 1 wires the app to sign in; this task gives it an account to sign in *as*
and an isolated shop to sign in *to*. RLS (`auth_shop_id()`, migration 015) and
the PowerSync sync rules both scope data by the `shops.owner_user_id → auth.uid()`
mapping. Until a real account is linked to the brother's shop, that mapping
resolves to nothing and Task 1's AC 1 / AC 7 / AC 12 cannot be verified.

**Account model (do not misread):** one Supabase auth account = one shop's cloud
identity, inside the existing single Supabase project. Not per-person, not
per-device. Cashier accountability stays on the `staff` + PIN layer. Signup
automation is a **parked post-trip epic** — this task is by hand, one shop only.

---

## User Story

**As** the operator setting up customer #0,
**I want** to create the brother's Supabase account and link it to his shop,
**so that** his device (Task 1) signs in and syncs only his shop's data, isolated
from everyone else.

---

## Acceptance Criteria

1. A Supabase auth account exists for the brother (email + password, **Auto
   Confirm ON**). Email is one you control.
2. `shops.owner_user_id` on the seed shop `00000000-0000-0000-0000-000000000001`
   equals his user id (`UPDATE 1`).
3. The unique constraint holds: his account maps to exactly **one** shop row.
4. Signed in as him (via the Task 1 build), the app lands on Home with **his**
   shop's data synced — closes Task 1 **AC 1**.
5. Installed PWA and a browser tab on the same origin show the **same** shop and
   data — closes Task 1 **AC 7**.
6. A second throwaway account, signed in, sees **zero** of his rows across every
   synced table — closes Task 1 **AC 12**.
7. **No data migration:** existing local/seed rows already carry
   `shop_id = …0001`, so once the mapping is set, local and server align with no
   row changes.

## Runbook (steps the dev executes)

1. **Create the account** — Supabase → Authentication → Users → Add user
   (email + password, Auto Confirm ON). Copy the new `user id` (uuid).
2. **Link the shop** —
   `update public.shops set owner_user_id = '<HIS_UID>' where id = '00000000-0000-0000-0000-000000000001';`
   Expect `UPDATE 1`. If `UPDATE 0`, insert the seed shop from `supabase/seed.sql` first, then re-run.
3. **Verify the mapping** —
   `select id, name, owner_user_id from public.shops where owner_user_id = '<HIS_UID>';`
   Expect one row.
4. **Verify isolation without a second device** — in the SQL editor, impersonate:
   `set local role authenticated;` + `set local request.jwt.claims = '{"sub":"<HIS_UID>"}';`
   then confirm `select count(*) from public.sales;` returns only his rows, and an
   insert with a different `shop_id` is rejected by RLS.
5. **End-to-end** — build with Task 1's env, sign in on a phone, confirm Home +
   sync (AC 4), then repeat in installed-PWA mode (AC 5), then sign in a throwaway
   account and confirm it sees nothing of his (AC 6).

## Edge Cases to Cover (do not skip)

- **Seed shop row missing** → step 2 returns `UPDATE 0`; insert it first.
- **Account with no linked shop** → `auth_shop_id()` resolves to NULL and the
  account sees none of its own data with no error shown. Confirm the mapping
  (step 3) *before* relying on the build, so this silent-lockout state is never
  what the brother hits.
- **Trying to link a second shop to the same account** → blocked by the unique
  index on `owner_user_id`; expected, one shop per account for now.

## Co-dependency (flag, not part of this task)

End-to-end sync (AC 4) also requires the **PowerSync sync rules to be deployed**
(`powersync.yaml`). If they aren't saved/accepted in the dashboard, the device
authenticates but syncs nothing. Verify that separately before declaring AC 4 met.

## Out of Scope

Signup/login UI, self-serve provisioning, multiple shops, device registration.

## Definition of Done

- [ ] Brother's account created, Auto Confirm ON (AC 1).
- [ ] `shops.owner_user_id` set on `…0001`, verified (AC 2–3).
- [ ] Signed-in build lands on Home with his data synced (AC 4 → Task 1 AC 1).
- [ ] PWA and browser tab match (AC 5 → Task 1 AC 7).
- [ ] Throwaway account sees none of his rows (AC 6 → Task 1 AC 12).
- [ ] Confirmed no row migration was needed (AC 7).
