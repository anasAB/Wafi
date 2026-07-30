# WAFI-014 Cross-Epic Edge-Case Review Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize cross-feature ripple-effect review so it happens at design time (not just an ad-hoc final-review pass) and produces a visible, required artifact instead of an implicit mental check.

**Architecture:** Pure documentation/process change — no app code, no migration, no tests in the CI sense. Three files change: `AI_PRINCIPAL_ENGINEER_REVIEW.md` gains a concrete Domain Interaction Matrix + a required Cross-Epic Edge-Case Checklist template; `CLAUDE.md` gets one line making both mandatory; and the plan/spec docs for future tickets must include the filled checklist. This plan also does a retroactive validation pass against WAFI-010 and WAFI-016 to prove the process would have caught those bugs earlier.

**Tech Stack:** Markdown only.

## Global Constraints

- No CI/tooling enforcement — enforcement is by instruction (CLAUDE.md + skill workflow), per the approved design.
- The Domain Interaction Matrix must be grounded in real tables/composables that exist in this codebase today, not generic categories.
- The checklist is required twice per future ticket: once in the design spec (design-time), once in the final-review doc (final-review-time) — both are separate required subsections, not one combined step.
- Do not restructure or remove any existing section of `AI_PRINCIPAL_ENGINEER_REVIEW.md` — only insert new content immediately before the existing "RIPPLE EFFECT REVIEW" section.

---

### Task 1: Add Domain Interaction Matrix to AI_PRINCIPAL_ENGINEER_REVIEW.md

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md` (insert new section before line 286, the existing `# RIPPLE EFFECT REVIEW` heading)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a `# DOMAIN INTERACTION MATRIX` section in `AI_PRINCIPAL_ENGINEER_REVIEW.md` that Task 2's checklist template references by name ("Matrix rows consulted"), and that Task 3's CLAUDE.md line references.

- [ ] **Step 1: Insert the Domain Interaction Matrix section**

Open `AI_PRINCIPAL_ENGINEER_REVIEW.md` and insert the following immediately before the line `# RIPPLE EFFECT REVIEW` (currently line 286), keeping the `---` separator that already precedes it:

```markdown
# DOMAIN INTERACTION MATRIX

This is a living reference of how domains in WAFI actually interact,
grounded in real tables and composables — not abstract categories.
When a feature introduces a new domain or a new cross-domain
interaction, add or update a row here as part of that feature's design
spec. There is no separate "matrix owner" — whoever writes the design
spec for a feature touching this table keeps it current.

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

If a feature touches a domain not listed here, add a new row rather
than leaving it undocumented.

---

```

- [ ] **Step 2: Verify placement**

Confirm the file still reads correctly end-to-end: the new section sits between the existing `# TECHNICAL DEBT REVIEW`/whatever section ends at line 285 and the original `# RIPPLE EFFECT REVIEW` heading, with exactly one `---` separator before and after (matching the existing document's separator convention). Open the file and read from the end of the prior section through the start of `# RIPPLE EFFECT REVIEW` to confirm no duplicate `---` lines and no broken heading levels.

- [ ] **Step 3: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md
git commit -m "docs(WAFI-014): add Domain Interaction Matrix to review lens"
```

---

### Task 2: Add Cross-Epic Edge-Case Checklist template

**Files:**
- Modify: `AI_PRINCIPAL_ENGINEER_REVIEW.md` (insert new section after the Domain Interaction Matrix from Task 1, still before `# RIPPLE EFFECT REVIEW`)

**Interfaces:**
- Consumes: the `# DOMAIN INTERACTION MATRIX` section name from Task 1 (referenced in the checklist's "Matrix rows consulted" prompt).
- Produces: a `# CROSS-EPIC EDGE-CASE CHECKLIST` section containing two named templates (`## Design-Time Checklist` and `## Final-Review Checklist`) that Task 3's CLAUDE.md line and Task 4's retroactive validation both reference by these exact heading names.

- [ ] **Step 1: Insert the checklist section**

Insert immediately after the Domain Interaction Matrix table and its trailing `---` (from Task 1), still before `# RIPPLE EFFECT REVIEW`:

```markdown
# CROSS-EPIC EDGE-CASE CHECKLIST

This checklist is required twice per feature — once at design time,
once at final review — as a filled-in artifact, not an implicit
mental check. Copy the relevant template into the feature's design
spec and, separately, into its final-review write-up.

## Design-Time Checklist

Copy this block into the feature's design spec (`docs/superpowers/specs/`):

```
## Cross-Epic Edge-Case Checklist (design time)
Domains touched: [list]
Matrix rows consulted: [list, or "n/a — new domain, row added to DOMAIN INTERACTION MATRIX above"]
Open cross-feature questions: [list, or "none identified"]
```

## Final-Review Checklist

Copy this block into the feature's final whole-branch review write-up:

```
## Cross-Epic Edge-Case Checklist (final review)
Matrix rows re-checked after implementation: [list]
Domains touched but not covered in the original spec checklist: [list, or "none"]
```

If final review finds a domain touched but not in the spec's
checklist, that is a signal the design-time check missed something —
worth noting in the ticket's status entry even after the fact, so the
gap is visible rather than silently patched.

---

```

- [ ] **Step 2: Verify placement**

Read the file from the end of Task 1's inserted section through the start of `# RIPPLE EFFECT REVIEW` to confirm the new section sits correctly, with proper `---` separators and no duplicated headings.

- [ ] **Step 3: Commit**

```bash
git add AI_PRINCIPAL_ENGINEER_REVIEW.md
git commit -m "docs(WAFI-014): add Cross-Epic Edge-Case Checklist templates"
```

---

### Task 3: Update CLAUDE.md to make both steps mandatory

**Files:**
- Modify: `CLAUDE.md` (the "Mandatory Review Lens" section near the top)

**Interfaces:**
- Consumes: the exact section names `DOMAIN INTERACTION MATRIX` and `CROSS-EPIC EDGE-CASE CHECKLIST` produced in Tasks 1–2.
- Produces: nothing consumed by later tasks — this is the enforcement instruction read by Claude/collaborators going forward.

- [ ] **Step 1: Locate and update the Mandatory Review Lens section**

In `CLAUDE.md`, find:

```markdown
## Mandatory Review Lens

Before implementing any new feature, reviewing any PR, or testing/evaluating any release, load and apply `AI_PRINCIPAL_ENGINEER_REVIEW.md` (repo root). It defines the review role, invariants, and evaluation framework that every feature/PR/release must be checked against — apply it in full, not as an optional checklist.
```

Replace it with:

```markdown
## Mandatory Review Lens

Before implementing any new feature, reviewing any PR, or testing/evaluating any release, load and apply `AI_PRINCIPAL_ENGINEER_REVIEW.md` (repo root). It defines the review role, invariants, and evaluation framework that every feature/PR/release must be checked against — apply it in full, not as an optional checklist.

**Cross-epic edge-case review is mandatory, not implicit (WAFI-014):** every design spec must include the filled `Cross-Epic Edge-Case Checklist (design time)` block, consulting the `DOMAIN INTERACTION MATRIX` in `AI_PRINCIPAL_ENGINEER_REVIEW.md`; every final whole-branch review must include the filled `Cross-Epic Edge-Case Checklist (final review)` block. A design or review write-up missing its checklist block is incomplete.
```

- [ ] **Step 2: Verify the diff**

Run `git diff CLAUDE.md` and confirm only the "Mandatory Review Lens" section changed — no other section was touched.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(WAFI-014): make cross-epic edge-case checklist mandatory in CLAUDE.md"
```

---

### Task 4: Retroactive validation against WAFI-010 and WAFI-016

**Files:**
- Modify: `WAFI_Production_Readiness_Plan_v3.md` (add a new IMPLEMENTATION STATUS row for WAFI-014, following the existing table format used by other rows)

**Interfaces:**
- Consumes: the `DOMAIN INTERACTION MATRIX` and `CROSS-EPIC EDGE-CASE CHECKLIST` sections from Tasks 1–2 (referenced by name in the write-up).
- Produces: nothing consumed by later tasks — this is the final documentation of the ticket's completion, mirroring how every other shipped ticket in this table documents its own outcome.

- [ ] **Step 1: Write the retroactive validation note**

In `WAFI_Production_Readiness_Plan_v3.md`, find the IMPLEMENTATION STATUS table (the one starting near line 14, with rows like `| WAFI-001 (Server-Side Role Enforcement) | ✅ ... |`). Add a new row immediately after the WAFI-013 row (the row ending `...Merged to main.` for Cost Freshness Indicator) and before the `| WAFI-012, WAFI-014, WAFI-015, WAFI-020 ...` summary row. Since WAFI-014 is now shipped, first remove `WAFI-014` from that summary row's ticket list (it currently reads `WAFI-012, WAFI-014, WAFI-015, WAFI-020 (remaining Macro-Phase 1)`; change to `WAFI-012, WAFI-015, WAFI-020 (remaining Macro-Phase 1)`), then insert:

```markdown
| WAFI-014 (Cross-Epic Edge-Case Review Process) | ✅ Shipped 2026-07-30 | Process/documentation ticket, no app code. Design spec: `docs/superpowers/specs/2026-07-30-wafi-014-cross-epic-edge-case-review-design.md`. Added a **Domain Interaction Matrix** (concrete table of real domains/tables/composables/reports, not abstract categories) and a **Cross-Epic Edge-Case Checklist** (required twice per future ticket — design-time and final-review-time) to `AI_PRINCIPAL_ENGINEER_REVIEW.md`; `CLAUDE.md`'s "Mandatory Review Lens" section now names both as required artifacts, not implicit review. **Retroactive validation**: applying the design-time checklist to the pre-WAFI-010 returns feature would have prompted a matrix-row check against Installments — a row that didn't exist until this ticket, meaning that interaction genuinely wasn't checkable until now; applying it to a hypothetical Cash/Shifts feature's checklist surfaces the Reports/Dashboards column's explicit note that cash movements are excluded from the profit report (WAFI-016), which is exactly the confusion WAFI-016 had to retroactively document. No CI/tooling enforcement — this is enforced by instruction only, per the approved design's explicit non-goal. |
```

- [ ] **Step 2: Verify the table renders correctly**

Read the modified section of `WAFI_Production_Readiness_Plan_v3.md` and confirm the markdown table isn't broken (each row still has the same number of `|`-delimited columns as the header) and that the WAFI-014 row sits in the correct position (after WAFI-013, before the "remaining Macro-Phase 1" summary row).

- [ ] **Step 3: Commit**

```bash
git add WAFI_Production_Readiness_Plan_v3.md
git commit -m "docs(WAFI-014): record shipped status and retroactive validation in roadmap"
```

---

## Post-plan note

This plan intentionally has no automated test suite to run — it is a documentation/process change. The "test" of this ticket is Task 4's retroactive validation, and going forward, whether future design specs and final-review write-ups actually include the two checklist blocks (a matter of following CLAUDE.md's updated instruction, not something this plan can verify ahead of time).
