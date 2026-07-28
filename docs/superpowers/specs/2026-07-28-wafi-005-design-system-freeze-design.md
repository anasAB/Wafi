# WAFI-005: Design System Freeze Design

**Date:** 2026-07-28
**Status:** Draft (rev 2 — incorporates founder review)
**Ticket:** WAFI-005 (P1, 1 sprint, "Single canonical system, zero competing redesigns")

## Context

Confirmed via code audit 2026-07-27 (`WAFI_Production_Readiness_Plan_v3.md` status
table): no implementation exists for WAFI-005 today. This is a genuinely unbuilt
ticket.

**This is a governance/documentation ticket, not a feature build.** "Freeze"
means: write down what the canonical system actually is, and put a mechanism
in place so a future PR can't silently introduce a competing pattern. It does
not mean redesigning anything, and — per an explicit scoping decision below —
it does not mean migrating the ~121 files that currently hardcode colors
inline onto a token system. That migration is real, valuable work, but it is
a separate, much larger ticket than "freeze the system," and conflating the
two would turn a 1-sprint governance ticket into an open-ended refactor.

**Audit findings (read-only research, no code changed for this doc):**

- **`Design_Spec_v2.docx` / `Design_Spec_v2_extracted.txt`** (repo root) is a
  pixel-level spec for exactly **two screens** — the POS Sale Screen and the
  Owner Dashboard Home. It defines Tajawal typography (400/500 weight, no
  bold in Arabic body), a 48×48px minimum tap target, brand blue `#1A56DB`,
  specific state colors (success/warning/error), 4px/8px spacing/radius
  conventions, and component behaviors (bottom sheets, sync indicator, pack
  gating). It explicitly says **"light mode only, v1"** — the app has since
  shipped dual light/dark — and ends with an **unchecked "Component Spec
  Required" checklist** (color tokens, type scale, spacing system, icon
  library, button/input/badge variants). That checklist was never completed.
  It covers 2 of the app's ~135 Vue screens/components; it does not, and was
  never meant to, govern the rest of the UI as built.
- **PrimeVue v4 (Aura preset) + Tailwind is the de facto, consistently-applied
  component/theming layer.** `src/main.ts` configures `preset: Aura`,
  `darkModeSelector: '.dark'`, `cssLayer: { order: 'theme, base, primevue' }`
  so Tailwind always wins. Vuetify (the prior library) has been **fully
  removed** — no references anywhere in `src/` or `package.json`. No dead
  legacy CSS files were found either. This part of the system is not in
  dispute or drift.
- **Tajawal is used consistently.** 108 of 111 files with a `font-family`
  declaration reference `'Tajawal', system-ui, sans-serif` verbatim. This is
  the most consistent part of the current system and needs no freeze action
  beyond documenting it.
- **`docs/architecture/PATTERNS.md`** already contains a short, correct UI
  section: PrimeVue v4/Aura is the library, "no internal navbars in pages"
  is a stated rule, reusable UI must live in `src/components/ui/` and be
  reused rather than rebuilt, and new screens should follow "the current
  design system (brand blue `#1A56DB`, glass cards, dual light/dark)."
  `docs/architecture/PRINCIPLES.md` is almost entirely backend/architecture
  (error handling, offline-safety, SQL param rules) with only incidental
  UI-layer mentions.
- **The actual gap: no canonical token source, no drift-catching mechanism.**
  Of 135 `.vue` files, **121 hardcode raw hex color literals** in their
  `<style>` blocks (83 of those reference the brand colors `#1A56DB`/
  `#0D1828` directly as hex), versus only 4 files referencing `var(--...)`
  CSS custom properties (and those 4 belong to an unrelated theme-picker
  feature, not general component styling). **No central token file exists**
  anywhere in the repo (no `tokens.css`, no shared palette module) — the
  brand palette is a convention enforced entirely by copy-paste. **No
  stylelint config, no ESLint rule targeting colors/fonts, and no CI lint
  gate exists** (`.github/workflows` wasn't found) — enforcement today is
  purely manual, PR-review-based, with nothing in tooling to catch an
  off-brand color or a stray font-family in a new PR.

## 1. What "freeze" actually produces — three artifacts, not a redesign

**Decision:** WAFI-005 delivers exactly three things, in order, and stops:

1. **A single canonical design-system document** (§2) — becomes the
   canonical design-system reference for future work, replacing
   `Design_Spec_v2` as the thing PRs are reviewed against, written from what
   the app *actually does today* (PrimeVue/Aura, Tajawal, brand blue, dual
   light/dark, glass-card pattern, RTL-first), not a re-imagining of it.
2. **A written freeze rule** (§3) — what's allowed going forward, stated as
   an explicit constraint a reviewer (human or automated) can check a PR
   against.
3. **One lightweight enforcement mechanism** (§4) — something that actually
   fires on a PR, not just prose nobody re-reads. Scoped small deliberately
   (see §4) — a full stylelint rollout across 121 already-hardcoded files is
   explicitly out of scope (§6).

No migration of existing files, no new components, no visual changes to any
screen. This ticket's success condition is "the next PR that tries to
introduce a third color/font/pattern gets caught," not "every existing file
now uses tokens."

## 2. The canonical document

New file: `docs/architecture/DESIGN_SYSTEM.md`.

- **Becomes the canonical design-system reference for future work** — the
  document new UI work is reviewed against, in place of `Design_Spec_v2`.
  `Design_Spec_v2` is **not deleted** (it still has real, specific pixel
  guidance for the two screens it covers) but is explicitly marked in this
  new doc as historical/partial, not authoritative for the rest of the app —
  this stops a future contributor from treating its "light mode only, v1"
  framing or its incomplete checklist as still-current guidance.
- Documents, as **fact about the current system**, not aspiration, everything
  this ticket freezes:
  - **Library:** PrimeVue v4/Aura + Tailwind, `cssLayer` order.
  - **Typography — frozen as a full set, not just "the font name":** Tajawal
    specifically; the 400/500-no-bold-Arabic-body weight convention from
    `Design_Spec_v2` (confirmed still followed); the app's default heading
    hierarchy as it exists in practice today; and RTL-first as a structural
    layout assumption, not a per-screen opt-in. These were only mentioned
    incidentally in this spec's Context section — `DESIGN_SYSTEM.md` states
    them as frozen rules in their own right, same as the palette below.
  - **Brand palette:** `#1A56DB` brand blue, `#0D1828` card background, and
    the existing success/warning/error colors — pulled from `Design_Spec_v2`
    since the audit found no evidence they've drifted. **Once copied into
    `DESIGN_SYSTEM.md`, these values become canonical there, not in
    `Design_Spec_v2`** — a future palette change updates `DESIGN_SYSTEM.md`
    directly; `Design_Spec_v2` is not touched again and is not where a
    future contributor should look to update a color.
  - **Visual pattern:** dual light/dark via the `.dark` selector, the
    glass-card pattern.
  - **Cross-referenced, not duplicated, from existing docs:** the "no
    internal navbars in pages" / "reuse `src/components/ui/`" rules already
    stated in `PATTERNS.md`, and any relevant architectural constraints
    already stated in `PRINCIPLES.md` (e.g. UI logic staying separate from
    business logic) — `DESIGN_SYSTEM.md` points at both docs for their
    respective rules rather than restating them, matching this codebase's
    existing discipline of one source of truth per rule (seen in the
    reused-composable pattern from WAFI-017).
- Explicitly documents the token gap as a **known, accepted state**, not a
  defect this ticket fixes: "components today reference brand colors as raw
  hex literals, not CSS custom properties or a token file; migrating to a
  token system is out of scope for this freeze — see WAFI-005 doc §6." This
  sentence exists specifically so a future reader doesn't assume the freeze
  silently fixed this.

## 3. The freeze rule itself

Stated plainly enough to be a real review gate, not vibes:

> **From this point forward, any new or modified screen must use the
> existing PrimeVue v4/Aura components, Tailwind utilities, Tajawal
> typography, and the documented brand palette (§2) — not a new component
> library, a different font, or a new one-off color introduced without
> updating `DESIGN_SYSTEM.md` first. Any PR introducing a new visual pattern
> (a new color, a new component category not covered by
> `src/components/ui/`) must update `DESIGN_SYSTEM.md` in the same PR — a
> PR that introduces a new pattern without that update is incomplete, not
> merely undocumented.**

This is deliberately not "no new colors ever" — CLAUDE.md's own working
principles already caution against over-rigid process ("defer eagerly," "be
direct") — it's "don't introduce one silently." The mechanism in §4 is what
makes "must update the doc" checkable rather than a rule nobody enforces.

## 4. Enforcement mechanism — the invariant, not a specific implementation

**The invariant this mechanism must hold:** detect a newly introduced color
value in a PR's diff that is not part of the documented palette in
`DESIGN_SYSTEM.md`, and flag it (not hard-block) with a message pointing at
the doc. That invariant, not any specific technique, is what this ticket
commits to — stated this way deliberately so the contract survives even if
the implementation underneath it changes or improves later.

**Initial implementation (rev 1 of the mechanism, allowed to be superseded
without a spec change):** a CI job that greps the diff of a PR for new
6-hex-digit color literals in changed `.vue`/`.css` files, checked against
the palette already documented in `DESIGN_SYSTEM.md`. This is a known-narrow
first pass — it does **not** catch `rgb()`/`hsl()`/`oklch()` functions, CSS
custom properties (`var(--...)`), inline `style` bindings, or Tailwind
arbitrary-value classes (`bg-[#...]`), all of which can introduce an
undocumented color just as easily as a bare hex literal. Closing that gap
(broadening detection to those forms) is legitimate future work *on this
same mechanism* — it does not require re-opening this ticket or this spec,
because §4's actual commitment is the invariant above, not "grep for hex."
- Only scans the **diff**, not the whole repository — pre-existing hardcoded
  colors in files nobody touched in a given PR don't trip it. Retrofitting
  the 121 existing files is explicitly out of scope (§6).
- Deliberately not a full `stylelint` install + ruleset + baseline-exemption
  list — that's real setup/tuning work proportional to a bigger ticket than
  a 1-sprint freeze. The grep-based first pass is the smallest thing that
  actually fires on a PR, which is the bar this ticket needs to clear (§1).

**Implementation dependency, stated explicitly:** this mechanism requires a
CI pipeline to run in. No `.github/workflows` (or equivalent) exists in this
repo today — confirmed in the audit. **This ticket does not include standing
up general CI infrastructure** (that's WAFI-022's territory). If WAFI-022 (or
equivalent CI availability) hasn't landed by the time WAFI-005 is
implemented, the implementer's choice is either (a) add the minimal single
workflow file needed to run this one check — not a general CI rollout — or
(b) treat §4 as blocked and ship §2/§3 (the document + the rule) alone,
flagging §4 as a follow-up once CI exists. Either is acceptable; silently
skipping §4 without noting why is not.

## 5. What counts as "done"

- `docs/architecture/DESIGN_SYSTEM.md` exists, documents the current system
  as fact, becomes the canonical design-system reference for future work
  (§2), and states the token gap as a known/accepted limitation.
- The freeze rule (§3) is written down in that doc.
- The enforcement mechanism (§4) satisfies its stated invariant — some
  implementation of it exists and demonstrably flags a test PR that
  introduces a new, undocumented color, without failing on unrelated
  pre-existing files — or §4 is explicitly deferred per its stated CI
  dependency, not silently skipped.
- `Design_Spec_v2` is annotated (not deleted) pointing to the new doc.

**Review checklist for the document itself** — a documentation ticket's
"done" needs a way to check the *document*, not just check that a file
exists:
- Every rule stated in `DESIGN_SYSTEM.md` corresponds to something that
  actually exists in the codebase today (no aspirational rules — e.g. don't
  document a token system that doesn't exist, per the audit's finding that
  none does).
- Every file path referenced in `DESIGN_SYSTEM.md` (e.g. `PATTERNS.md`,
  `src/components/ui/`, `Design_Spec_v2`) actually exists at the path
  written.
- Nothing in the doc contradicts this spec's explicit Out of Scope list
  (§6) — e.g. it should not imply a token migration already happened.

## 6. Out of scope

- **Migrating any of the 121 files with hardcoded hex colors onto a token
  system.** This is the largest, most valuable follow-on work this audit
  surfaced, but it is a separate ticket — likely sized closer to WAFI-005's
  original "1 sprint" estimate on its own, once scoped. Flag it as a
  candidate follow-up ticket, don't fold it in here.
- **A full stylelint/design-token enforcement pipeline.** §4's grep-based CI
  check is the deliberately small version; a real stylelint rollout with a
  baseline-exemption list for existing files is future work if the grep
  check proves too coarse in practice.
- **Redesigning or visually changing any existing screen.** Zero pixels
  change as a result of this ticket.
- **Completing `Design_Spec_v2`'s original "Component Spec Required"
  checklist** (formal type scale, spacing system, icon library, button/input/
  badge variants as a full component library spec) — `DESIGN_SYSTEM.md`
  documents what exists today; building out a from-scratch formal component
  spec for two screens' worth of unfinished checklist items is a distinct,
  larger effort.
- **Dark-mode-specific guidance beyond confirming it exists** — `Design_Spec_v2`
  predates dual light/dark entirely; a proper dark-mode design spec (states,
  contrast, elevation in dark) is not written here, only the fact that dark
  mode exists and is governed by the `.dark` selector.
