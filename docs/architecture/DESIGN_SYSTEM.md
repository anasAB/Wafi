# Design System (WAFI-005 Freeze)

**Status:** Canonical — this document is the design-system reference new UI
work is reviewed against, in place of `Design_Spec_v2` (see §7).
**Last verified against the codebase:** 2026-07-28.

This document describes what the app's UI **actually does today**, verified
against the codebase, not an aspiration for what it should look like. It
exists so a new PR has one place to check before introducing a new color,
font, or component pattern. See
`docs/superpowers/specs/2026-07-28-wafi-005-design-system-freeze-design.md`
for the full rationale behind this document and the freeze rule in §8.

## 1. Component library

**PrimeVue v4 (Aura preset) + Tailwind.** Configured in `src/main.ts`:
`preset: Aura`, `darkModeSelector: '.dark'` (matches this app's own
class-based dark-mode toggle, not PrimeVue's `system` default), and
`cssLayer: { order: 'theme, base, primevue' }` so Tailwind utility classes
always win over PrimeVue's own styles. Vuetify (the prior library) has been
fully removed — do not reintroduce it or any other component library.

## 2. Typography

- **Font:** Tajawal (`'Tajawal', system-ui, sans-serif`), used in 219+ of the
  app's component style blocks — this is the dominant, consistent choice and
  is frozen as the app's typeface.
- **Weight convention (Arabic body text):** 400 regular / 500 medium. No 700
  bold in Arabic body text (per `Design_Spec_v2`, still followed).
- **Heading hierarchy in practice:** page titles ~1.1–1.2rem / 800 weight;
  section/card labels ~0.75–0.9rem / 600–700 weight; body/table text
  ~0.8–0.9rem / 400–600 weight. There is no single centrally-defined type
  scale file — this is the range observed consistently across recent
  screens (Reports, Staff Performance, Money Owed).
- **RTL-first, structurally, not per-screen:** every screen is designed
  Arabic-RTL-first (`dir="rtl"` at the screen root); an LTR/English mirror
  flips direction and swaps copy, it does not re-layout. This is a
  structural assumption of the app, not an opt-in per screen.

## 3. Brand palette

The values below are the values actually in consistent use across recent,
representative screens (Reports, Staff Performance, Money Owed, Collections
Worklist) — verified by direct grep against the codebase, not copied
unverified from any older spec.

| Role | Value | Notes |
|---|---|---|
| Brand blue (primary) | `#1A56DB` | Buttons, active states, links, focus rings |
| Brand blue (gradient end) | `#1248B3` | Used with `#1A56DB` in gradient fills |
| Page background | `#06090F` | Dark, near-black base |
| Card/glass background | `linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04))` | The recurring "glass card" pattern |
| Card border | `rgba(26,86,219,0.28)` | Paired with the glass card background |
| Primary text | `#E8EDF5` | |
| Secondary/muted text | `#93A3B8` or `#637285` | Both appear; no single canonical choice was found — treat either as acceptable until unified |
| Success | `#22C55E` | 42 occurrences |
| Error/destructive | `#EF4444` (general), `#DC2626` (confirm-destructive actions) | 76 + 2 occurrences respectively — two shades in use, not one |
| Warning/amber | `#F59E0B` or `#FBBF24` | Both appear (34 + 18 occurrences) — same "two shades, not unified" situation as secondary text |

**Known inconsistency, documented rather than silently accepted:** muted
text and warning-amber each have two co-existing values in real use, not
one. This freeze does not pick a winner between them — doing so would be a
design decision this ticket isn't scoped to make (see the design doc's
Out of Scope) — it only records that both exist today so a future PR
copying either isn't "introducing a new color," while genuinely picking a
*third* shade would be.

## 4. Known competing/unused system — `--color-gold-*` tokens in `style.css`

**This is real, verified drift, not a hypothetical risk this document is
guarding against abstractly.** `src/style.css` defines an `@theme` block of
CSS custom properties (`--color-gold-primary`, `--color-bg-void`,
`--color-surface-glass`, etc.) plus alternate palette overrides under
`[data-luxury-theme="..."]` selectors (`light-ivory`, `deep-jewel`,
`sapphire`). These are wired to a real, live feature —
`useThemePalette.ts` / a settings-store `luxuryTheme` preference that sets
`data-luxury-theme` on `<html>` — so this is not dead code in the sense of
being unreachable.

However:
- The token *names* are a leftover from `docs/superpowers/specs/2026-05-31-luxury-redesign-design.md`,
  an earlier gold/luxury aesthetic. `--color-gold-primary`'s **current
  default value is `#1A56DB` (blue)**, not gold — the variable name and its
  value have diverged after the brand pivoted to blue.
- Also defines `--font-display: 'Cormorant Garant', Georgia, serif` and
  `--font-body: 'Inter', system-ui, sans-serif` — **neither font appears
  anywhere in any component's actual `font-family` declaration** (verified:
  zero matches for Cormorant/Inter across `.vue` files). These typography
  tokens are defined but unreferenced.
- Only 4 files in the entire codebase reference any `var(--color-...)`
  token at all, and those 4 belong to the theme-picker feature itself, not
  general component styling. The other 121+ files that use color hardcode
  hex values directly instead of referencing this token system.

**This document does not resolve that split.** It records it as a known,
real inconsistency so a reader understands *why* `style.css` seems to
define a token system that most of the app doesn't use — and so nobody
mistakes the gold-named/Cormorant/Inter tokens for the canonical brand
system described in §2–3 above. Reconciling or removing this — either by
migrating the rest of the app onto these tokens, or by renaming/pruning
them to match reality — is exactly the kind of larger follow-up this
freeze intentionally does not attempt (see the design doc's Out of Scope
and §7 below).

## 5. Visual pattern

- **Dual light/dark**, toggled via the `.dark` class on `<html>`
  (`@custom-variant dark (&:where(.dark, .dark *))` in `style.css`).
- **Glass card pattern**: the gradient/border combination in §3's "Card/glass
  background" row, used consistently for cards across dashboard/reports
  screens.

## 6. Structural rules (cross-referenced, not duplicated)

These rules already have a single source of truth elsewhere in this repo.
This document points at them rather than restating them, so there is exactly
one place to update each:

- **"No internal navbars in pages"** and **reuse `src/components/ui/`
  rather than rebuilding UI** — both stated in `docs/architecture/PATTERNS.md`.
- Any relevant architectural constraints on keeping UI logic separate from
  business logic — stated in `docs/architecture/PRINCIPLES.md`.

## 7. Relationship to `Design_Spec_v2`

`Design_Spec_v2.docx` / `Design_Spec_v2_extracted.txt` (repo root) is a
pixel-level spec for exactly two screens (POS Sale Screen, Owner Dashboard
Home). It is **not deleted** — it still has real, specific guidance for
those two screens (component behaviors, bottom sheets, sync-indicator
states, pack-gating rules) that this document does not restate. But it is
**historical/partial, not authoritative** for the rest of the app:

- It states **"light mode only, v1. Dark mode is not in scope"** — the app
  has since shipped dual light/dark (§5).
- Its own "Component Spec Required" checklist (color tokens, type scale,
  spacing system, icon library, button/input/badge variants) was **never
  completed** — this document is what exists in its place, built from the
  system as actually implemented rather than that unfinished checklist.

**Once a value is copied from `Design_Spec_v2` into this document (as in
§2–3 above), this document is canonical for it going forward.** A future
palette or typography change updates *this* document, not
`Design_Spec_v2` — `Design_Spec_v2` is not touched again for that purpose.

## 8. The freeze rule

> From this point forward, any new or modified screen must use the existing
> PrimeVue v4/Aura components, Tailwind utilities, Tajawal typography, and
> the documented brand palette (§3) — not a new component library, a
> different font, or a new one-off color introduced without updating this
> document first. Any PR introducing a new visual pattern (a new color, a
> new component category not covered by `src/components/ui/`) must update
> this document in the same PR — a PR that introduces a new pattern without
> that update is incomplete, not merely undocumented.

This is not "no new colors ever" — it's "don't introduce one silently."
See `.github/workflows/design-system-check.yml` (§9) for the automated
check that gives this rule a real, checkable trigger rather than relying on
review discipline alone.

## 9. Enforcement mechanism

**The invariant:** detect a newly introduced color value in a PR's diff that
is not part of the documented palette above, and flag it (not hard-block)
with a message pointing back at this document. That invariant — not any one
technique — is the actual commitment; the implementation below is free to
be broadened later without requiring a new spec or a change to this
document's rule in §8.

**Current implementation:** `.github/workflows/design-system-check.yml`
greps a PR's diff for new 6-hex-digit color literals in changed
`.vue`/`.css` files and fails (non-blocking check, informational) if it
finds one not already listed in §3 above. Known gaps in this first pass,
listed here so nobody mistakes narrow detection for a narrow *rule*: it does
not currently catch `rgb()`/`hsl()`/`oklch()` functions, `var(--...)`
references, inline `style` bindings, or Tailwind arbitrary-value classes
(`bg-[#...]`) — any of which can introduce an undocumented color just as
easily as a bare hex literal. Broadening detection to those forms is
legitimate future work on this same check, not a reason to consider this
document out of date.

## 10. Explicitly out of scope for this freeze

- Migrating the ~121 files that hardcode hex colors directly onto a
  token/CSS-variable system (candidate follow-up ticket, not part of this
  freeze).
- Reconciling or removing the `--color-gold-*` token system described in §4.
- A full stylelint/design-token enforcement pipeline (§9's grep-based CI
  check is the deliberately small first version).
- Redesigning or visually changing any existing screen.
- Completing `Design_Spec_v2`'s original "Component Spec Required" checklist
  as a from-scratch formal component library spec.
- Dark-mode-specific design guidance beyond confirming it exists and is
  governed by the `.dark` selector (states, contrast, elevation in dark are
  not specified here).
