# Review Summary
**Application:** WAFI (offline-first retail POS)
**Version/Commit Hash:** main @ 77cd991 (49 commits ahead of origin/main)
**Reviewer(s):** AI (Claude Sonnet 5), via security-review skill + subagent fan-out
**Review Date:** 2026-07-22
**Scope:** Full baseline review — every file under `src/` (all `features/*`, `store/*`, `router`, `App.vue`, `main.ts`, `store.ts`, `config`, `components`, `shared`, `composables`, `i18n`, `data`, `pages`) and all 65 Supabase SQL migrations (`supabase/migrations/001` through `065`)

### Findings Summary
- **Critical:** 0
- **High:** 1
- **Medium:** 1
- **Low:** 0
- **Informational:** 0

### Key Recommendations
1. Add explicit ownership-scoped UPDATE/DELETE RLS policies for `cashier_shifts` and drop the stale shop-wide-only policies from migration 015 (Vuln 1) — this is the highest-impact gap, letting any cashier tamper with or delete any other cashier's shift record.
2. Extend the WAFI-202 staff-attribution pattern (already applied to the sales domain in migration 064) to `cash_movements` and `cashier_shifts` INSERT policies (Vuln 2).
3. No other confirmed high-confidence issues were found across the client codebase (no XSS, no hardcoded secrets, no SSRF, no CSV injection meeting the confidence bar) — the RLS layer added by WAFI-122/202/203 is otherwise sound and independently verified against a wide set of candidate findings that were traced back to already-fixed states or non-issues.

### Overall Risk Assessment
**Medium** - Two confirmed RLS gaps allow same-shop staff to tamper with or misattribute cash/shift records via direct API calls; no cross-tenant, remote-code-execution, or credential-exposure issues were confirmed. Both findings are narrowly scoped, already have an established fix pattern elsewhere in the same migration series, and do not affect sales/returns financial immutability (which was independently hardened and verified).

---

# Vuln 1: Stale permissive RLS policy leaves `cashier_shifts` UPDATE/DELETE open to any shop staff

**Severity:** High
**CWE:** CWE-863 (Incorrect Authorization) / CWE-284 (Improper Access Control)
**Location:** `supabase/migrations/058_cash_shifts_domain_rls.sql:14` (policy gap originates in `supabase/migrations/015_rls_tenant_scoping.sql`, `cashier_shifts_update_all` / `cashier_shifts_delete_all`)
**Description:** Migration 058's stated intent is that "cashier sees only their own shifts," and it does replace the SELECT policy with an ownership-aware `cashier_shifts_select_own_or_manager`. However, it only drops `cashier_shifts_select_all` — it never drops or replaces `cashier_shifts_update_all` / `cashier_shifts_delete_all`, which migration 015 created scoped solely by `shop_id = auth_shop_id()`, with no staff/role/ownership check. Postgres RLS policies of the same command type are combined with `OR` (permissive by default), so this stale, wide-open policy alone is sufficient to authorize the action regardless of any newer, more restrictive policy. No migration through 065 (the current HEAD) ever drops these two policy names.
**Impact:** Any authenticated staff member (including a plain cashier) in the shop can modify or delete any `cashier_shifts` row belonging to any other staff member — not just their own — via a direct PostgREST/Supabase REST call. This breaks shift-integrity and audit-trail guarantees the rest of the WAFI-122/WAFI-202 RLS rewrite is built to enforce.
**Reproduction:**
1. Authenticate as a cashier-role staff member on a shop with at least one other open/closed shift belonging to a different staff member.
2. Send `PATCH /rest/v1/cashier_shifts?id=eq.<other-staff-shift-id>` with body such as `{"status":"closed","closing_cash_usd":0,"staff_id":"<self>"}`.
3. Observe the request succeeds — RLS only checks `shop_id = auth_shop_id()`.
4. Alternatively, send `DELETE /rest/v1/cashier_shifts?id=eq.<other-staff-shift-id>` and observe the row is deleted.
**Recommendation:** Add explicit UPDATE and DELETE policies on `cashier_shifts` mirroring the ownership check already used for SELECT (`staff_id = auth_staff_id()` for the shift's own cashier, or `auth_role() IN ('owner','manager')`), and explicitly `DROP POLICY cashier_shifts_update_all` and `DROP POLICY cashier_shifts_delete_all` before adding the replacements — do not merely add a new restrictive policy alongside the old permissive one, since permissive policies are OR'd together. If the shift-lifecycle model intends shifts to be append-only/closed-only-through-a-controlled-workflow, consider disallowing client-side UPDATE/DELETE entirely and requiring a dedicated close-shift RPC instead.
**References:** CWE-863: https://cwe.mitre.org/data/definitions/863.html · OWASP Top 10 A01:2021 – Broken Access Control · Postgres RLS docs on permissive vs. restrictive policies
**Status:** Open
**Assignee:** TBD
**Due Date:** TBD

---

# Vuln 2: `cash_movements` and `cashier_shifts` INSERT lack staff-attribution enforcement

**Severity:** Medium
**CWE:** CWE-863 (Incorrect Authorization)
**Location:** `supabase/migrations/058_cash_shifts_domain_rls.sql:43`
**Description:** Migration 064 (WAFI-202) added `staff_id = auth_staff_id()` to the INSERT `WITH CHECK` clause for the sales-domain tables (`sales`, `sale_line_items`, `sale_payments`, `returns`, `return_line_items`), closing a class of gap where a caller could insert a row attributed to an arbitrary staff member. Migration 058's own inline comments explicitly acknowledge the same class of gap exists for `cash_movements` and `cashier_shifts` ("a cashier could insert a movement/shift misattributed to another staff member via direct API. Tracked as WAFI-202."), but no migration through 065 has applied the equivalent fix to these two tables. This is a currently-live gap, not a historical/superseded one — it remains exploitable on `main` HEAD as reviewed.
**Impact:** A cashier can misattribute a cash pay-in/pay-out/drop, or a shift-open event, to a different staff member, bypassing the PIN-verified `switch_active_operator()` path that is the only legitimate way to act as another staff member. This can be used to shift blame for a till shortfall onto a coworker, or fabricate a shift record under someone else's identity.
**Reproduction:**
1. Authenticate as a cashier-role staff member.
2. Send `POST /rest/v1/cash_movements` with body including `"staff_id": "<other-staff-id>"` (same shop).
3. Observe the insert succeeds — RLS only checks `shop_id = auth_shop_id()`, not that `staff_id` matches the caller's own `auth_staff_id()`.
4. Repeat against `POST /rest/v1/cashier_shifts` with a different staff member's id in `staff_id`.
**Recommendation:** Extend the WAFI-202 attribution pattern already used in migration 064 to these two tables' INSERT `WITH CHECK` clauses: add `staff_id = (SELECT public.auth_staff_id())`, consistent with the sales-domain treatment.
**References:** CWE-863: https://cwe.mitre.org/data/definitions/863.html · OWASP Top 10 A01:2021 – Broken Access Control · Internal ticket WAFI-202
**Status:** Open (tracked internally as WAFI-202, but not yet remediated for these two tables)
**Assignee:** TBD
**Due Date:** TBD

---

## Findings Investigated and Excluded (for audit trail)

The following candidate findings were surfaced during the review's identify phase but did not survive independent false-positive verification, and are recorded here for traceability rather than action:

| Candidate | Why excluded |
|---|---|
| PowerSync bulk-sync bypasses RLS, exposing staff PII/audit data on synced devices | Pre-existing, already-tracked architectural gap (ADR-010 / WAFI-201), documented as out of scope for this migration series, not newly introduced |
| `staff.role`/`permissions` client-writable, no server-side role check | Fixed by migration 055 (`staff_update_owner`, requires `auth_role() = 'owner'`) — gap only existed in intermediate history |
| `staff` credential columns (`pin_hash`/`pin_salt`) readable by any staff member + weak hash | Fixed by migration 055 (`staff_select_owner_manager` restricts SELECT to owner/manager); residual owner/manager full-column visibility is a consciously deferred, documented follow-up, not a silent hole |
| `staff_ledger`/`staff_settlements` writable with no role/permission check | Fixed by migration 060 (`can('can_view_staff_ledger')`-gated policies replace the unrestricted ones) |
| Backfill migration 063 defaults `can_view_staff_ledger` to `true` for managers | Misread — the actual code correctly defaults to `false`, matching the header comment's stated intent |
| Early migrations 005/006/008/012 create unscoped `USING(true)` policies | Fully superseded by migration 015's explicit drop-and-replace; no residual permissive policy exists at current HEAD |
| `switch_active_operator` trusts client-supplied `p_session_id`, no exception handling on unique-constraint violation | Verified as partially real but only reached confidence 7/10 — same-shop only (not cross-tenant), requires the attacker to already hold valid staff credentials on the same shop |
| Full `Staff` object (incl. `pin_hash`/`pin_salt`) persisted to `localStorage` via Pinia `persist: true` | The same credential material is already resident in the local PowerSync SQLite DB for legitimate offline PIN verification; localStorage persistence adds no new distinct exposure surface |
| CSV/Excel formula injection on data export (`useExportFile.ts`/`useExportData.ts`) | Real and unmitigated technically, but reached only confidence 6/10 — the untrusted input reaches the export one step removed, via staff transcription, not direct attacker control |
| Staff-ledger writes gated on `can_view_expenses` instead of `can_view_staff_ledger` (client/router) | Server-side RLS (migration 060) independently enforces the correct permission; the client/router mismatch is a UX bug, not an exploitable bypass |
| `VITE_DEV_AUTO_SIGNIN` mechanism could embed a real password in the client bundle | The actual exposed password exists only in a gitignored, untracked local `.env.local`, not the committed codebase; the code path is a deliberate, documented single-device provisioning tradeoff (with a console warning), not an unguarded oversight — confidence 4/10 |
| `/customers/collections` route gated on `can_view_reports` instead of `can_manage_customers` | Client-side navigation gate only; no security impact (RLS is the real authorization boundary) — confidence 5.5/10 |
