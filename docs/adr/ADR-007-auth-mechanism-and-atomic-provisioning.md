# ADR-007 — Phone-as-synthetic-email auth + atomic server-side shop provisioning

| Field      | Value                       |
|------------|-----------------------------|
| Date       | 2026-06-24                  |
| Status     | Accepted                    |
| Deciders   | Anas Baaj (CTO), PO         |
| Supersedes | None                        |

## Context
WAFI-055 turns the product from "one hand-provisioned shop" into self-serve
onboarding. Two decisions shape the whole flow and the epic flags both as
prerequisites (Decisions 1 & 2 of `plans/2026-06-20-epic-real-auth-onboarding...`):

1. **How does an owner authenticate?** We have no SMS provider — Syrian SMS
   delivery is unreliable and an SMS/OTP vendor is a cost/sanctions problem at
   €100–200/mo (CLAUDE.md budget lock). But owners think in phone numbers, not
   emails.
2. **How is the shop created at signup?** An auth account that exists *without* a
   linked shop silently locks the owner out: RLS (`auth_shop_id()`, migration 015)
   and the PowerSync rules resolve the tenant from `shops.owner_user_id = auth.uid()`,
   so "no shop row" means no data and no recovery. This is the #1 failure to prevent.

## Decision
1. **Authenticate by phone + password, NO OTP.** Map the phone to a stable
   *synthetic email* (`<digits>@wafi.app`) and use Supabase's standard
   email/password provider with email confirmation **off**. The owner only ever
   sees "phone"; the email is an internal key. A real email for assisted recovery
   is a separate, optional field. The single seam is `src/data/supabase/auth.ts`
   (`phoneToEmail`, `signUpOwner`, `signIn`, `signOut`); pages never touch
   `supabase.auth` directly.
2. **Provision the shop server-side and atomically.** An `AFTER INSERT` trigger on
   `auth.users` (`provision_shop_for_new_user`, migration 021) creates the `shops`
   row with `owner_user_id = NEW.id` in the **same transaction** as the user insert.
   If shop creation raises, the user insert rolls back with it — signup yields
   `{account + shop}` or nothing. Shop name / business type / country ride along in
   `raw_user_meta_data` (set by `signUpOwner`).
3. **The owner `staff` row + PIN are created client-side at first run**, not in the
   trigger: `staff.pin_hash` is `NOT NULL` and the PIN is chosen by the owner. The
   existing `/setup-owner` flow already mints salt+hash locally and syncs up. The
   trigger's job is only to remove the lockout risk (account ⟹ shop); the PIN layer
   then completes against a shop that already exists.

## Alternatives Considered
| Option | Why Rejected |
|--------|--------------|
| Supabase phone provider + SMS OTP | Needs an SMS vendor — cost + sanctions risk; unreliable delivery in Syria. Revisit at scale. |
| Client-side shop creation after signup | Non-atomic: a crash between "account created" and "shop created" strands the owner locked-out — the exact bug we must prevent. |
| Trigger also inserts the owner `staff` row | `pin_hash` is `NOT NULL`; a placeholder PIN is a security smell and forces extra client reconciliation. Reusing `/setup-owner` is simpler and already proven. |
| Email-as-username (ask owners for email) | Owners don't think in email; higher signup friction; recovery email should be optional, not the primary key. |

## Consequences
**Positive:** No SMS dependency or cost. Signup can never produce an account
without a shop. Auth logic is centralised and unit-tested with no network.
**Negative / trade-offs:** Synthetic emails are opaque in the Supabase dashboard
(mitigated: phone is stored in user metadata). Assisted password reset only for v1
(bends Working Principle #9 — revisit before self-serve scale). The trigger lives
on `auth.users`, a Supabase-managed table — keep it minimal and well-tested.

## Architecture Guidelines
- All auth goes through `src/data/supabase/auth.ts`. No component calls
  `supabase.auth.*` directly (devAuth.ts remains the single-device convenience).
- Provisioning is trigger-only; never create `shops` from the client.
- The synthetic-email domain (`wafi.app`) is a constant in `auth.ts` — never send
  mail to it; it is non-delivering by design.
- Migration 021 must be applied AND verified on a live Supabase before the signup
  UI is shipped: test the success path and a forced-failure path (confirm no
  orphaned `auth.users` row remains).

## Review Date
Revisit OTP and self-serve password reset at ~50 customers (scaling milestone).
