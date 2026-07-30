# WAFI-014: Cross-Epic Edge-Case Review Process — Design

Date: 2026-07-30
Status: Draft — pending user review

## Problem

Cross-feature bugs are being caught too late (after merge, requiring
fix-up commits) and some features are shipped inconsistent with how
similar features already behave elsewhere in the app. Recent tickets
(WAFI-009, WAFI-010) only caught these interactions during an ad-hoc
"final whole-branch review" pass — there is no formal, mandatory step
that forces this check earlier, and no concrete reference for what
actually touches what in this codebase.

`AI_PRINCIPAL_ENGINEER_REVIEW.md` already contains a "RIPPLE EFFECT
REVIEW" section, but it lists abstract categories ("Tables written",
"Reports affected", etc.) with no codebase-grounded content — it's a
lens to apply, not a filled-in reference. Nothing requires the check to
produce a visible artifact, so it depends on whoever is reviewing
happening to think of the right cross-feature interaction.

## Goals

- Catch cross-feature ripple effects at design time, not just at final
  review.
- Make the check a required, visible artifact (a filled-in checklist),
  not an implicit mental exercise.
- Ground the check in this specific codebase's actual domains, tables,
  and composables — not generic categories.
- No new tooling/CI — this is a process and documentation change only.

## Non-goals

- No automated enforcement (no CI gate, no lint rule). Enforcement is
  by instruction (CLAUDE.md + skill workflow), consistent with how this
  project already works.
- Not a replacement for `AI_PRINCIPAL_ENGINEER_REVIEW.md`'s existing
  sections — it extends them with concrete content and a required
  artifact, it doesn't restructure the whole document.
- Not scoped to build a ripple-effect dependency graph generator (that
  already exists as a stated goal of WAFI-142, Business Event Registry,
  in Macro-Phase 2 — out of scope here).

## Design

### 1. Domain Interaction Matrix

A new section added to `AI_PRINCIPAL_ENGINEER_REVIEW.md`, immediately
before the existing "RIPPLE EFFECT REVIEW" section. A concrete table
grounded in the current codebase:

| Domain | Writes to (tables) | Reads from (other domains) | Key composables | Reports/Dashboards affected |
|---|---|---|---|---|
| Sales | `sales`, `sale_line_items` | Inventory (stock/cost), Customer Credit (debt), Installments | `usePayment` | Profit report, Staff performance, Dashboard, Cost freshness |
| Returns | `returns`, `return_line_items` | Sales (original sale), Installments (plan status), Inventory (restock) | `useReturnSheet` | Profit report, Money Owed |
| Installments | `installment_plans`, `installment_dues` | Sales (originating sale), Returns (cancellation trigger) | `useInstallmentPlan` | Money Owed, Collections worklist |
| Cash / Shifts | `cash_movements`, `cashier_shifts` | Sales (cash totals), Staff (attribution) | `useCashMovements`, shift composables | Z-report, Reports (deliberately excluded — WAFI-016) |
| Customer Credit | `customer_ledger` | Sales, Returns | `useCustomerBalance` | Money Owed, Collections worklist |
| Staff | `staff_ledger`, `staff_settlements` | Sales (attribution), Cash/Shifts | staff-ledger composables | Staff performance dashboard |
| Products / Cost | `products` | Receiving, Import | `useProducts`, `useReceivingSheet`, `useProductImport` | Cost freshness indicator, Dashboard, Profit report |
| Audit | `audit_log` | All of the above | `executeFinancialWrite` wrapper | Audit log page |

This table is a living reference, not a one-time snapshot — when a
new domain or interaction is introduced (e.g. a future Supplier
Ledger), it gets a new row as part of that feature's own design spec.
It is maintained by whoever writes the design spec for a feature that
introduces or changes a domain interaction; there is no separate
"matrix owner" role.

### 2. Cross-Epic Edge-Case Checklist

A new required section, filled in twice per ticket rather than
written once and forgotten:

**At spec time** (part of the brainstorming design doc, added as a
required subsection of every design spec from now on):

```
## Cross-Epic Edge-Case Checklist (design time)
Domains touched: [list]
Matrix rows consulted: [list, or "n/a — new domain, row added above"]
Open cross-feature questions: [list, or "none identified"]
```

**At final-review time** (part of the existing "final whole-branch
review" step already practiced on recent tickets — formalized as a
required subsection of that review's output, not a new review pass):

```
## Cross-Epic Edge-Case Checklist (final review)
Matrix rows re-checked after implementation: [list]
Domains touched but not covered in the original spec checklist: [list, or "none"]
```

If a "final review" finds a domain that was touched but not in the
spec's checklist, that's the concrete signal WAFI-014 is designed to
surface — it means the design-time check missed something, which is
useful data even after the fact.

### 3. CLAUDE.md update

One line added to the existing "Mandatory Review Lens" section,
making explicit that both the Domain Interaction Matrix and the
Cross-Epic Edge-Case Checklist are required steps — not just "apply
`AI_PRINCIPAL_ENGINEER_REVIEW.md` in full" as currently written, since
that phrasing doesn't make clear that a *visible artifact* (the filled
checklist) is required in the spec and final-review docs.

### 4. Validation (retroactive test of the process)

Since this ticket produces no app code, its own "test" is applying the
new checklist retroactively to 2-3 already-shipped tickets that had
real cross-feature bugs, to confirm the process would have surfaced
them earlier:

- **WAFI-010** (installment plans + returns): the original design spec
  for the returns feature (pre-WAFI-010) would have needed a "Domains
  touched: Returns" checklist entry prompting a matrix-row check
  against Installments — which didn't exist as a matrix row at the
  time, meaning this interaction wasn't checked until WAFI-010 itself.
- **WAFI-016** (cash movements excluded from profit report): a
  Cash/Shifts feature's checklist would prompt checking the
  Reports/Dashboards column, which explicitly notes the exclusion —
  preventing the confusion WAFI-016 had to retroactively document.

This validation is a written note added to the retrospective (see
Implementation Status entry for WAFI-014), not new test code.

## Testing

- No unit/integration tests (process/doc-only change).
- Retroactive validation as described above, documented in the
  implementation status table entry for WAFI-014.

## Open questions

None — all resolved during brainstorming.
