# PRINCIPLES.md — Decision rules, engineering principles, ADR template

> Cited by CLAUDE.md. Read before writing any code or making any technical suggestion.
> This file is the **how we build** contract. PATTERNS.md is **what shapes to reach for**.
> ENFORCEMENT.md is **how we verify it before merge**.
> Last updated: 2026-06-23.

---

## 0. Operating Role & Engineering Mandate

**Role:** Act as an expert Senior Full Stack Developer on Wafi.

**Objective:** Implement features for our SaaS product with a strict focus on clean
architecture, maintainability, and robust engineering. Wafi runs in real Syrian shops,
offline, on cheap devices, handling real money. Correctness and durability beat cleverness
every time.

### Context to analyze before writing a line of code
1. **Architecture & standards** — Read `CLAUDE.md` (product locks, tech stack, sacred rules)
   and this `docs/architecture/` set (PRINCIPLES, PATTERNS, ENFORCEMENT). Read the relevant
   ADRs in `docs/adr/`.
2. **The existing code** — Analyze the feature(s) you are touching. Match their patterns,
   naming, comment density, and idioms. Integration must be seamless, not bolted on.

### Core engineering principles (apply to every change)

- **KISS — Keep It Simple.** Write the simplest code that solves the *actual* problem.
  No clever one-liners that the next developer (or the CTO at 1am during a shop install)
  can't read. Clarity is a feature.
- **DRY — Don't Repeat Yourself.** Extract reusable logic into composables (`src/composables/`),
  store actions, `src/shared/` helpers, or `src/components/ui/` components. But see YAGNI:
  don't abstract on the *first* occurrence — abstract on the *second or third*, when the
  shared shape is actually known. Premature abstraction is its own kind of repetition.
- **YAGNI — You Aren't Gonna Need It.** Build only what the feature/spec explicitly requires.
  No speculative config, no "we might need this later" parameters, no unused branches. The
  roadmap in CLAUDE.md already tells us what's deferred — respect the deferrals. (The
  *wholesale-aware schema* note in CLAUDE.md is a deliberate, documented exception; it is not
  license for general speculation.)
- **SOLID & Clean Code** — single responsibility, intention-revealing names, separation of
  concerns. **UI logic stays separate from business/data logic** (see §3 and PATTERNS.md §5).

### Implementation rules

- Use clear code blocks; match the file's existing style (2-space indent, no semicolons where
  the file omits them, aligned object literals where the surrounding code aligns them).
- **Comments explain "why", not "what".** The codebase already does this well — e.g. the
  receipt-counter durability note in `sale.store.ts` explains *why* localStorage alone is
  fragile. Mirror that. Don't narrate obvious code.
- **Strict type safety.** No `any` to dodge a type. The one tolerated exception is the
  PowerSync result shape `(result as any).rows._array`, which the driver types poorly — keep
  it localized to the query call site, never let `any` leak into a return type or store state.
- **Robust error handling with typed errors.** Throw domain error classes with a *stable
  English message* (machine-facing, asserted in tests); the UI layer maps the typed error to
  a localized Arabic string. See `ExchangeRateNotSetError` in `src/features/pos/useSale.ts`.
- **No placeholders.** Never leave `// TODO: implement logic here`. Write the real logic. If
  something genuinely can't be finished, say so explicitly to the user and stop — don't ship a
  stub that looks done.
- **Cover edge cases.** Empty cart, zero/negative quantities, missing exchange rate, no stock,
  offline with no local cache, duplicate receipt number after reinstall, partial/failed sync.
  The existing code guards these — keep that bar.

### Strict constraints

- Base implementations strictly on CLAUDE.md, the ADRs, and existing codebase patterns.
  **Do not introduce a new library or paradigm without an ADR and explicit approval** (§5).
- **Security:** sanitize/parameterize all inputs. Never build SQL by string concatenation —
  `db.execute(sql, params)` with bound parameters only (the codebase already does this
  everywhere). Never render unsanitized user/customer text as HTML (XSS) — Vue escapes by
  default, so never reach for `v-html` on user data. Secrets never in source (§ENFORCEMENT 3).
- **Performance:** avoid unnecessary re-renders (stable keys, `computed` over methods in
  templates, don't put large transactional arrays in persisted stores — ADR-005). Optimize
  queries: select only needed columns, filter by indexed `shop_id`, never `SELECT *` in a hot
  path. Respect the offline-first primitive — no network round-trip on a POS-critical path.

---

## 1. The decision rules

When choosing how to build something, apply these in order. The first that resolves the
question wins.

1. **Does it violate a Sacred Rule (CLAUDE.md)?** Offline-first, Arabic+SYP+exchange rate,
   hardware support. If yes, stop — the approach is wrong by definition.
2. **Does it violate an architecture lock (CLAUDE.md / ADRs)?** Vue 3 PWA, no ERPNext,
   PowerSync sync layer, feature-first folders, no hand-rolled sync, no direct localStorage
   persistence. If yes, stop.
3. **Does an existing pattern already cover this?** (PATTERNS.md.) Use it. Consistency beats
   novelty.
4. **Apply the Litmus Test (CLAUDE.md).** Would a Syrian shop owner pay for this? If the
   feature itself is questionable, raise it before building.
5. **KISS / YAGNI.** Pick the simplest option that satisfies the spec and nothing more.
6. **If still ambiguous, write an ADR** (§5) and ask. Don't silently pick a load-bearing
   default.

---

## 2. SOLID checklist (every class, composable, store, and function must pass)

CLAUDE.md: *"Every class/function must pass the SOLID checklist in PRINCIPLES.md."*

- [ ] **S — Single Responsibility.** One reason to change. A composable that both queries the
      DB *and* formats Arabic currency *and* drives the printer is three things. Split them.
      (`useSale` orchestrates cart logic; `usePrinter` drives hardware; i18n formats — each
      separate.)
- [ ] **O — Open/Closed.** Extend without editing the core. New printer model = a new class
      implementing `IPrinterDriver`, not an edit to `usePrinter`. New export format = a new
      handler, not a `switch` everyone keeps growing.
- [ ] **L — Liskov.** Any `IPrinterDriver` (Simulated, Epson, Star…) is substitutable without
      the caller knowing which. If a subtype throws on a method the base promises, it fails L.
- [ ] **I — Interface Segregation.** Keep interfaces narrow. `IPrinterDriver` is one method
      (`print`). Don't force a barcode-only consumer to depend on print methods.
- [ ] **D — Dependency Inversion.** Depend on abstractions, inject concretions.
      `usePrinter(driver: IPrinterDriver = new SimulatedDriver())` — the default makes tests
      and the demo trivial; production injects the real driver. Stores/composables take the
      `db` and stores they need rather than reaching into globals where avoidable.

If a function can't pass these, it's doing too much — decompose it.

---

## 3. Separation of concerns — the layers

Wafi has a deliberate layering. Keep logic in the right layer.

```
Vue component (.vue)        UI only: render, bind, dispatch events, show localized strings.
        │                   No SQL, no business arithmetic beyond display formatting.
        ▼
Composable / Store          Business logic & orchestration. Cart rules, rate locking,
(useSale, *.store.ts)       overselling guards, sequence reconciliation. Pure-ish, testable.
        │
        ▼
Data layer (src/data/)      Persistence. db.execute() against local SQLite (PowerSync),
                            Supabase client for auth. The ONLY place that knows the schema.
```

Rules:
- **Components never call `db.execute()` directly** for business reads/writes — go through a
  composable or store. (Display-only helpers may read, but prefer pushing it down.)
- **Business arithmetic lives in stores/composables, not templates.** Totals, profit, change
  due, SYP conversion → `computed`/store getters, asserted by tests. Templates render results.
- **Schema knowledge lives in `src/data/`.** Column names and SQL belong there or in the
  composable that owns the feature's queries — not scattered through components.
- **Money rules are invariants, not per-screen choices.** See PATTERNS.md §6 (payment
  accounting). Cash totals derive from `sale_payments`, `amount_usd` is net-of-change, a credit
  sale writes no payment row, returns reverse revenue/COGS. Never re-derive these ad hoc.

---

## 4. Code generation rules

When generating or modifying code:

1. **Read the target file and its `index.ts` first.** Respect the feature's public API; import
   cross-feature only through `index.ts` (ADR-003).
2. **i18n from the start.** No string literal in a template. Add keys to `src/i18n/ar.ts`
   (primary) and `src/i18n/en.ts` (fallback), namespaced by feature (`pos.addToCart`). The one
   nuance: domain errors carry a stable English `message`; the *UI* maps them to i18n keys.
3. **Parameterized SQL only.** `db.execute(sql, [params])`. Scope by `shop_id`/`device_id`
   where the table is tenant- or device-scoped.
4. **Typed throughout.** Define interfaces for row shapes and store state. Export types via the
   feature `index.ts` when other features need them (`export type { Product }`).
5. **Tests alongside.** Co-locate `*.test.ts`. Business logic (stores, composables, money math,
   guards) must have unit tests. Use the real i18n + PrimeVue setup (`src/__tests__/setup.ts`)
   and `fake-indexeddb`. See ENFORCEMENT.md §1.
6. **Offline-safe.** No POS-critical path may require the network. Wrap DB reads that may run
   before first sync in a try/catch that degrades gracefully (see `reconcileSequenceFromDb`).
7. **Persisted state discipline.** `persist: true` only on settings/preferences/session stores,
   never on cart/inventory/transactional stores (ADR-005). Never touch `localStorage` directly
   for store persistence.
8. **Feature flags for not-yet-shipped capability.** Gate it in `src/config/featureFlags.ts`
   and only flip the flag in the same change that ships the real code (per-customer flags come
   later — see ENFORCEMENT.md §4).

---

## 5. ADR template

Any new library, or any decision that affects >1 feature / is hard to reverse / would cost
>1 sprint to undo → write an ADR. File as `docs/adr/ADR-NNN-short-slug.md` (next number in
sequence). Keep it short; the existing ADRs (001–006) are the length to match.

```markdown
# ADR-NNN — <one-line decision title>

| Field      | Value                  |
|------------|------------------------|
| Date       | YYYY-MM-DD             |
| Status     | Proposed / Accepted / Superseded |
| Deciders   | <names/roles>          |
| Supersedes | ADR-XXX or None        |

## Context
<The forces at play. Why a decision is needed now. Link the Sacred Rule, lock, or
constraint from CLAUDE.md that drives it.>

## Decision
<The choice, stated plainly. What we WILL do.>

## Alternatives Considered
| Option | Why Rejected |
|--------|--------------|
| ...    | ...          |

## Consequences
**Positive:** ...
**Negative / trade-offs:** ...

## Architecture Guidelines
<Concrete rules that flow from this decision — where files live, what's forbidden,
how to enforce it.>

## Review Date
<When to revisit, or "Fundamental — never revisit.">
```

When a decision changes, set the old ADR's Status to **Superseded** and reference the new one;
never silently delete or rewrite history.

### Existing ADRs (index)
- **ADR-001** — PowerSync as the offline sync layer.
- **ADR-002** — Supabase (Postgres + Auth + Storage).
- **ADR-003** — Feature-first folders with `index.ts` public APIs.
- **ADR-004** — Offline-first (local SQLite first, network secondary).
- **ADR-005** — vue-i18n + pinia-plugin-persistedstate.
- **ADR-006** — PWA installable offline shell.

---

## 6. Anti-patterns (do not do)

- Building SQL by string interpolation. (Injection; use bound params.)
- `v-html` on user/customer-supplied text. (XSS.)
- Persisting the POS cart or inventory list to `localStorage`. (ADR-005.)
- A direct `fetch`/HTTP call on a POS-critical read or write. (ADR-004.)
- Cross-feature imports that reach past `index.ts` into a feature's internals. (ADR-003.)
- String literals in templates instead of i18n keys. (ADR-005.)
- Re-deriving money rules per screen instead of using the shared invariants. (§3.)
- Adding a library without an ADR.
- Leaving a `// TODO` stub in shipped code.
- Abstracting before the third occurrence (premature DRY) — or copy-pasting a third time
  (neglected DRY). Both are smells.
