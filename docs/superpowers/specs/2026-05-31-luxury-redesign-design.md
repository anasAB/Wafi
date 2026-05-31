# Wafi — Luxury Redesign Design Spec
**Date:** 2026-05-31
**Status:** Approved
**Scope:** Landing page (new) + full app UI redesign (Approach B — Selective Glass)

---

## 1. Overview

Redesign the Wafi brand and application UI to an elegant dark-luxury aesthetic with liquid glass effects. The redesign covers two distinct surfaces:

- **Landing page** — a new marketing page (pre-login) with full luxury immersion: liquid glass, storytelling sections, product showcase, brand values, and an exclusive founding membership CTA.
- **App UI** — the POS, Home, History, and Settings screens redesigned under Approach B: ambient/navigational screens get full luxury treatment; the POS sale flow uses selective glass only on headers and overlays, keeping transactional screens fast and readable.

All screens are **mobile-first** and fully responsive across mobile (375px+), tablet (768px+), and desktop (1024px+).

---

## 2. Design System

### 2.1 Color Tokens

| Token | Value | Usage |
|---|---|---|
| `bg-void` | `#05080F` | Base background |
| `surface-glass` | `rgba(255,255,255,0.06)` | Glass card base |
| `surface-raised` | `rgba(255,255,255,0.10)` | Elevated glass |
| `gold-primary` | `#C9A84C` | Primary CTAs, highlights |
| `gold-gradient` | `#C9A84C → #A07830` | Button fills |
| `gold-subtle` | `rgba(201,168,76,0.25)` | Glows, soft borders |
| `platinum` | `#E8E8E8` | Secondary accents |
| `text-primary` | `#F5F0E8` | Warm white — primary text |
| `text-muted` | `#8A8070` | Secondary/helper text |
| `border-glass` | `rgba(255,255,255,0.12)` | Glass panel borders |
| `border-gold` | `rgba(201,168,76,0.30)` | Gold accent borders |

### 2.2 Glass System

| Level | CSS | Used On |
|---|---|---|
| `glass-sm` | `backdrop-filter: blur(12px) saturate(160%)` | List rows, small cards |
| `glass-md` | `backdrop-filter: blur(20px) saturate(180%)` | Panels, section cards |
| `glass-lg` | `backdrop-filter: blur(32px) saturate(200%)` | Hero overlays, modals, sheets |

All glass surfaces: `background: surface-glass`, `border: 1px solid border-glass`, `border-radius: 16px`.

### 2.3 Typography

| Role | Font | Weight | Notes |
|---|---|---|---|
| Display / Hero headings (EN) | Cormorant Garant | 300–600 | Elegant serif, luxury feel |
| Display / Hero headings (AR) | Amiri | 400–700 | Classical Arabic serif for hero moments |
| UI body + labels (EN) | Inter | 400–600 | Clean, readable at all sizes |
| UI body + labels (AR) | Tajawal | 400–700 | Already in use, keep |

Minimum body size: 16px. Line height: 1.6 for body, 1.2 for display. No emoji used as icons anywhere.

### 2.4 Spacing & Breakpoints

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px
- Breakpoints: `sm: 375px` / `md: 768px` / `lg: 1024px` / `xl: 1440px`
- Container max-width: `max-w-2xl` (mobile content) / `max-w-6xl` (desktop landing)
- Touch targets: minimum 44×44px on all interactive elements

### 2.5 Theme Variants (selectable in Settings)

| Name | Background | Primary Accent | Feel |
|---|---|---|---|
| **Dark Luxury** *(default)* | `#05080F` | Gold `#C9A84C` | High jeweler |
| Light Ivory | `#FAF8F4` | Champagne `#B8965A` | Dior / Chanel |
| Deep Jewel | `#080D1A` | Emerald `#2ECC8F` + silver | Private members club |
| Sapphire | `#05080F` | Brand blue `#1A56DB` elevated | Tech luxury |

Theme is stored in `settings.store.ts` alongside existing `theme` (light/dark/auto) and `textSize` preferences.

---

## 3. Landing Page

### 3.1 Route & File

- New route: `/` → `LandingPage.vue` (new)
- Current homepage moves to `/home` → `HomePage.vue` (route rename only, no logic change)
- Landing page CTAs ("Start Now" / "Reserve Your Spot") link to `/home`
- No auth guard required at this stage — auth is not yet wired up in the router
- New file: `src/pages/LandingPage.vue`
- Router change: `{ path: '/' }` → `LandingPage`, add `{ path: '/home' }` → `HomePage`, update catch-all redirect from `/` to `/home`

### 3.2 Sections (top to bottom)

#### Section 1 — Hero
- Full viewport height (`min-h-dvh`)
- Background: `bg-void` with slow-animated radial gradient (gold → void, 8s loop, `@keyframes breathe`)
- **Headline** (Cormorant Garant, 56px mobile / 80px desktop):
  > *"Your store.*
  > *Fully in command."*
- **Subline** (Inter, 16px, `text-muted`): "The retail platform built for Syrian merchants — offline-first, Arabic-native, runs on any device you own."
- **CTAs**: Gold primary button ("ابدأ الآن / Start Now") + ghost secondary ("شاهد العرض / Watch Demo")
- **Device mockup**: Floating glass frame containing a static POS screenshot. Bottom-right on desktop (`lg:`), below text centered on mobile.
- Scroll indicator: Thin gold animated chevron at bottom center

#### Section 2 — The Three Pillars
- 3 glass cards (`glass-md`), horizontal on desktop, vertical stack on mobile
- Gold icon (SVG, from Lucide or Heroicons) + bold heading + one-line body per card
- Cards:
  1. **Always On** — "Works fully offline. Syncs when you're back."
  2. **Speaks Your Language** — "Arabic-first. SYP + USD. Your exchange rate, your way."
  3. **Any Device You Have** — "Phone, tablet, laptop. Install from a link. No app store."

#### Section 3 — Product Story (× 3 alternating editorial blocks)
- Full-width sections, alternating image-left/text-right (desktop), image above text (mobile)
- Product screenshots inside glass frames with floating gold labels
- Stories:
  1. *"Ring up a sale in under 10 seconds."* → POS screen
  2. *"Know your numbers before you open the door."* → Dashboard/Home screen
  3. *"Your customers trust you. The numbers prove it."* → Sale history + credit view

#### Section 4 — Brand Values
- Full-bleed dark section, centered layout
- Cormorant Garant display size:
  > *"Built for the Syrian merchant.*
  > *Engineered for the world."*
- Three gold-line statements below in Inter:
  - "Offline when the power cuts. Online when it returns."
  - "Your currency, your language, your rules."
  - "No setup maze. No salesperson required."

#### Section 5 — By the Numbers
- Horizontal stats strip (`flex`, wraps on mobile to 2×2 grid)
- Four stats: `< 10s` sale time / `2` currencies / `∞` offline time / `30 min` onboarding
- Numbers: Cormorant Garant, platinum. Labels: Inter, `text-muted`. Gold vertical dividers between items (desktop only).

#### Section 6 — Exclusive Founding Membership CTA
- Full-width glass panel (`glass-lg`), animated gold border shimmer (`@keyframes shimmer`)
- Headline (Cormorant Garant): *"Join the founding circle."*
- Body: "First 15 merchants get 50% off — permanently. Setup handled personally. Direct line to the founders."
- Gold primary button: "احجز مكانك / Reserve Your Spot"
- Scarcity line (Inter, small, `text-muted`): "12 of 15 spots remaining."

#### Section 7 — Footer
- `bg-void`, thin `border-gold` top border
- Left: Wafi logo + tagline
- Center: Three link columns — Product / Company / Contact
- Right: Payment method icons (USDT / Wire / Cash), language toggle (AR / EN)
- Bottom: Copyright line, Inter 12px, `text-muted`

### 3.3 Animations
- Hero gradient: CSS `@keyframes breathe`, 8s ease-in-out infinite
- CTA border shimmer: CSS `@keyframes shimmer`, gold gradient rotating around border
- Section entrance: `IntersectionObserver` fade-up, `opacity 0→1 + translateY 24px→0`, 400ms ease-out, respects `prefers-reduced-motion`
- Device mockup: Subtle float, `translateY ±8px`, 4s loop

---

## 4. App Screen Redesigns

### 4.1 AppHeader (shared)
- `position: sticky; top: 0; z-index: 30`
- Glass: `glass-md`, `border-bottom: 1px solid border-gold`
- Title: Cormorant Garant, `text-primary`
- ExchangeRateWidget: Gold-tinted chip, `border-gold`
- SyncIndicator: Pulsing dot — gold (synced), amber (pending), red (error)

### 4.2 HomePage (full luxury)
- Date: Amiri italic, `gold-subtle` color
- Greeting: Cormorant Garant, warm white — no emoji
- **Today Sales card**: `glass-md` panel, `border-gold` shimmer on mount. Number in Cormorant Garant display size, `$` in platinum, figure in gold
- **No-rate warning**: Amber glass panel (`rgba(255,180,0,0.08)` bg), gold-amber border, SVG warning icon — no harsh yellow
- **"بيع جديد" button**: Gold gradient, 56px height, `rounded-2xl`, `box-shadow: 0 0 24px rgba(201,168,76,0.3)`
- **"آخر المبيعات"**: Ghost button, `border-glass`, platinum text

### 4.3 POS Screen (selective glass)
- **Header strip**: `glass-sm`, back arrow, sale total in Inter bold (warm white, high contrast — no gold, legibility first)
- **Product grid**: `bg: #0D1117` cards, `border-glass`, product name Inter medium, price platinum. No backdrop blur — speed matters
- **Sale panel**: Bottom sheet (mobile) / right panel (desktop). `bg: #0D1117`, thin `border-gold` top/left edge. Line items Inter, total warm white large
- **Payment button**: Gold gradient, same as homepage CTA
- **Numeric keypad**: `rgba(255,255,255,0.08)` keys, Inter numbers large, high contrast — zero glass blur
- **Payment modal**: `glass-lg` overlay, gold-bordered card, split-payment options as glass toggles

### 4.4 SaleHistoryPage (full luxury)
- Each row: `glass-sm` card, left border gold (2px) on unsynced rows
- Sale total: Cormorant Garant, warm white
- Date/time: Inter, `text-muted`
- Empty state: Cormorant Garant italic centered, ghost CTA button

### 4.5 SettingsPage (full luxury + theme picker)
- **Theme Picker** (top of Personal Preferences): Horizontal scroll row of 4 swatches. Each swatch: miniature glass card (80×56px), palette name in Inter 11px, color dot. Selected: `border: 2px solid gold-primary`
- Section groups: `glass-sm` surface, gold section label above each group
- List rows: Glass surface, `border-glass`, chevron in platinum
- Destructive rows: Visually separated, `rgba(239,68,68,0.1)` tint, red-glass border

---

## 5. Responsive Behavior

| Element | Mobile (375px+) | Tablet (768px+) | Desktop (1024px+) |
|---|---|---|---|
| Hero layout | Text stacked, mockup below | Text left, mockup right | Text left, mockup right, larger |
| Three Pillars | Vertical stack | 3-column row | 3-column row, wider cards |
| Product Story | Image above text | Alternating 50/50 | Alternating 50/50 |
| Stats bar | 2×2 grid | Horizontal strip | Horizontal strip |
| POS Sale panel | Bottom sheet | Bottom sheet | Right sidebar |
| Settings Theme Picker | Horizontal scroll | 2×2 grid | 2×2 grid |
| Footer | Stacked single column | 2-column | 4-column |

---

## 6. New Files & Changes

### New files
- `src/pages/LandingPage.vue` — full landing page
- `src/composables/useThemePalette.ts` — manages luxury palette tokens on top of existing theme system
- `src/features/settings/screens/ThemePickerScreen.vue` — theme swatch picker component

### Modified files
- `src/router/index.ts` — add `/` → LandingPage (unauthenticated), guard `/home` for authenticated
- `src/pages/HomePage.vue` — luxury redesign
- `src/pages/PosPage.vue` — selective glass redesign
- `src/pages/SaleHistoryPage.vue` — luxury redesign
- `src/pages/SettingsPage.vue` — luxury redesign + theme picker integration
- `src/features/settings/screens/PersonalPreferencesScreen.vue` — add theme palette selector
- `src/features/settings/settings.types.ts` — add `luxuryTheme` field
- `src/features/settings/settings.store.ts` — persist `luxuryTheme`
- `src/components/ui/AppHeader.vue` — luxury glass treatment
- `src/style.css` — glass utility classes, Cormorant Garant + Amiri font imports, animation keyframes

### Not changed
- All store logic, composables, data layer, PowerSync, Supabase — zero changes
- All test files
- `vite.config.ts`, `tsconfig`, build config

---

## 7. Out of Scope
- New features or screens beyond the listed pages
- Changes to business logic, sync, or data layer
- Vuetify integration (not used in this project)
- PWA manifest / icons update
