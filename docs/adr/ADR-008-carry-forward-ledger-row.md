# ADR-008 — Carry-forward ledger row for partial settlement remainders

| Field      | Value                       |
|------------|-----------------------------|
| Date       | 2026-07-19                  |
| Status     | Accepted                    |
| Deciders   | Anas Baaj (CTO), PO         |
| Supersedes | None                        |

## Context
WAFI-138 lets a settlement apply less than the full `amount_usd` of a staff
ledger entry (e.g. an advance larger than the cash the staff member can repay
this cycle). The remainder must survive the settlement as an auditable,
still-open ledger row: the original entry cannot be silently truncated or
edited after the fact (audit trail integrity, WAFI-138 domain types +
`executeFinancialWrite` invariants), and the design spec
(`docs/superpowers/specs/2026-07-19-wafi-138-staff-ledger-settlement-design.md`)
requires that partial application be queryable without a separate
applied-amount ledger.

## Decision
`finalize()` settles an entry in two steps:
1. The original ledger row is linked to the settlement as **fully consumed**
   (`settlement_id` set on the row, its full `amount_usd` treated as applied).
2. If the entry was only partially applied, a **new row** is inserted with
   `entry_type = 'carry_forward'`, `amount_usd` equal to the unapplied
   remainder, and `source_id` pointing back at the original entry. This new
   row is left open (no `settlement_id`) so it appears in the next
   settlement cycle like any other unsettled entry.

This was chosen over a normalized "applied amount" event model (a running
ledger of partial-application events against a single immutable entry row)
for v1 query simplicity: "is this entry settled" and "what's outstanding"
both reduce to "does a row exist with `settlement_id IS NULL`," with no join
across an applied-amount history table.

## Alternatives Considered
| Option | Why Rejected |
|--------|--------------|
| Normalized "applied amount" ledger (entry + many partial-application events) | Correct model long-term but adds a join to answer "what's outstanding" on every settlement screen; more migration and query work than v1 needs. |
| Mutate the original row's `amount_usd` down to the remainder | Destroys the audit trail — the original entry amount must stay recorded exactly as agreed with the staff member. |
| Split the original row instead of chaining via `source_id` | Loses the direct link back to the entry that produced the remainder, making it harder to trace a carry-forward row's provenance. |

## Consequences
**Positive:** Settlement and outstanding-balance queries stay simple —
"unsettled" is just `settlement_id IS NULL`. Every settled entry keeps its
original `amount_usd` untouched, preserving the audit trail.

**Negative / trade-offs:**
- A ledger row's `amount_usd` alone does not tell you how much of it was
  actually collected without cross-referencing any resulting `carry_forward`
  row via `source_id`. Future engineers must not "fix" this into a
  derived-balance model without a major version bump (per the design spec
  and product ticket).
- **Carry-forward rows don't preserve original direction.** All
  carry-forward rows are inserted with `entry_type = 'carry_forward'`
  regardless of whether the original entry was an `advance`/`penalty`
  (which reduce a settlement) or a `bonus` (which increases one). The
  settlement direction-calculation logic keys off `entry_type` alone
  (`entry_type === 'bonus' ? 1 : -1`), and `carry_forward` always evaluates
  to `-1`. This means a remainder carried forward from an original `bonus`
  will be treated with negative-direction semantics in the next settlement,
  which is incorrect. This is a known, currently-unaddressed consequence of
  the design and is not resolved elsewhere in WAFI-138. Fixing it — e.g. by
  storing the original direction on the carry-forward row, or splitting
  `carry_forward` into `carry_forward_credit`/`carry_forward_debit` — is
  future work, not required by this task.

## Architecture Guidelines
- Never derive "amount collected" from an entry row's `amount_usd` alone;
  always check for a `carry_forward` row with `source_id` pointing at it.
- Do not mutate a settled entry's `amount_usd`. The original row is
  immutable once written; only `settlement_id` linkage changes.
- Any change to settlement direction logic (`entry_type === 'bonus' ? 1 : -1`)
  must account for `carry_forward` rows originating from a `bonus`, or must
  first land the direction-preserving fix described above.

## Review Date
Revisit the direction-loss consequence before wholesale/warehouse ledger
reuse (v1.5+) or if bonus-heavy carry-forward volume becomes material.

## Related
- Design spec: `docs/superpowers/specs/2026-07-19-wafi-138-staff-ledger-settlement-design.md`
