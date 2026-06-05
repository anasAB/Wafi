# Design Spec: Modern SaaS Redesign — Gradient Glow System

**Date:** 2026-06-05  
**Scope:** Full product redesign — Landing page + all app pages  
**Status:** Approved, ready for implementation planning

---

## Summary

Refactor the entire visual design to a **gradient-glow glassmorphism** aesthetic: blue-tinted glass cards with ambient glow, living metric cards, and a rebuilt landing page. The design system change is token-first — updating `style.css` propagates the new look across all pages automatically, with targeted enhancements on the homepage dashboard and navigation.

---

## Decisions Made

| Decision | Choice |
|---|---|
| Scope | Both landing page + all app pages |
| Glass treatment | Gradient Glow — blue-tinted glass, ambient glow, accent borders |
| Hero visual | Floating metric cards (stacked, slight rotation, live pulse dot) |
| Landing page structure | Full + Story (9 sections) |
| Implementation approach | Approach A — design token + component upgrade |

---

## Section 1: Design System (`src/style.css`)

### New tokens

```css
--color-glow-blue:  rgba(26, 86, 219, 0.15);   /* ambient blue glow */
--color-border-glow: rgba(26, 86, 219, 0.28);   /* blue-tinted card border */
--color-glow-green: rgba(34, 197, 94, 0.12);    /* green card glow */
--color-glow-amber: rgba(245, 158, 11, 0.10);   /* amber card glow */
```

### Updated glass utilities

`glass-sm`, `glass-md`, `glass-lg` — all get:
- Background: `linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.04))`
- Border: `1px solid rgba(26,86,219,0.28)`
- Box shadow: `0 4px 24px rgba(26,86,219,0.12), inset 0 1px 0 rgba(255,255,255,0.07)`
- Blur values unchanged (12px / 20px / 32px respectively)

### Updated `card` utility

Replaces flat `#0D1828` background with gradient-glow treatment:
- Background: `linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04))`
- Border: `1px solid rgba(26,86,219,0.28)`
- Box shadow: `0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07)`

### New utilities

| Utility | Purpose |
|---|---|
| `card-green` | Profit/positive metric cards — background `linear-gradient(135deg, rgba(34,197,94,0.09), rgba(255,255,255,0.03))`, border `rgba(34,197,94,0.28)`, shadow `0 4px 16px rgba(34,197,94,0.08)` |
| `card-amber` | Warning/alert cards — background `linear-gradient(135deg, rgba(245,158,11,0.09), rgba(255,255,255,0.03))`, border `rgba(245,158,11,0.25)`, shadow `0 4px 16px rgba(245,158,11,0.08)` |
| `glow-ring` | Reusable ambient radial gradient div for section backgrounds (`radial-gradient(ellipse 60% 50% at 50% 40%, rgba(26,86,219,0.15), transparent)`) |
| `accent-bar` | Gradient bottom-line accent: height `2px`, border-radius `1px`, width `60%`, `background: linear-gradient(90deg, #1A56DB, transparent)` |

---

## Section 2: Landing Page (`src/pages/LandingPage.vue`)

Full rebuild. 9 sections in order:

### 1. Hero
- Full-viewport, breathing radial glow background
- Left: Arabic+English headline, subtitle, two CTA buttons (`ابدأ الآن / Start Now` + `شاهد العرض`)
- Right: 3 floating metric cards stacked with slight rotation (`rotate(-1deg)`, `rotate(0.5deg)`, `rotate(-0.5deg)`)
  - Card 1 (blue): Live sales today — `$4,820`, `↑ 12% عن أمس`, live green pulse dot
  - Card 2 (green): Total profit — `$1,240`, margin percentage
  - Card 3 (amber): Inventory alert — low stock count warning
- Scroll chevron animating at bottom

### 2. Stats Bar
- 4-column strip, full-width
- Values: `< 10s` (Sale time), `2` (Currencies), `∞` (Offline time), `30 min` (Onboarding)
- Arabic labels below each value
- Flat glass chips with muted border

### 3. Features Grid
- 6 icon cards in a 2×3 grid (mobile: 1 col, desktop: 3 col)
- Cards use `glass-md` gradient glow treatment
- Features:
  1. ⚡ دائماً يعمل — offline-first, syncs on return
  2. 🌐 عربي + دولار + ليرة — exchange rate control
  3. 📱 أي جهاز — PWA, no app store
  4. 👥 وردية الصندوق — cashier shifts, Z-report
  5. 📒 دفتر الزبائن — credit ledger, WhatsApp statement
  6. 📸 تتبع المصاريف — photo expense capture

### 4. Product Story
- 3 alternating rows (image left/right) — same structure as current page
- Each row: glass mockup placeholder + tag + headline + description
- Stories: POS screen, Dashboard, Customer credit
- Glass mockup placeholders get `glass-md` gradient-glow treatment
- Placeholders remain until real app screenshots are available

### 5. How It Works
- 3 numbered steps, horizontal on desktop, vertical on mobile
- Arabic numerals (١ ٢ ٣) in blue gradient circles
- Arrow separators between steps on desktop
- Steps: Install PWA → Set up shop (30 min) → Start selling

### 6. Pricing Table
- Layout: Core card (featured, left) + 4 pack cards (right column)
- **Core — $12/month** (required): POS, inventory, profitability dashboard, offline, dual currency, 1 user
- **Staff Pack — +$5/month**: shifts, up to 5 users, Z-report
- **Customer Pack — +$5/month**: credit ledger, WhatsApp statement
- **Reporting Pack — +$5/month**: advanced charts, WhatsApp digest
- **Electronics Pro — +$8/month**: IMEI, repair tickets, repair profitability (amber accent)
- Founding badge on Core: `مؤسسون: ٥٠٪ خصم` (green badge)
- Note: Warehouse pack omitted (v1.5, not yet available)

### 7. Trust Badges
- 4 amber-accented badge chips, full-width row
- Badges: 🖨️ Hardware compatibility (Epson · Star · Generic 80mm) | 📡 Works offline | 🔤 Arabic + RTL | 🔗 PWA — no App Store

### 8. Founding CTA
- Glass card (`glass-lg`) with blue glow border
- Headline: `انضم لدائرة المؤسسين`
- Body: 50% off permanently, personal setup, founders direct line
- Primary CTA button
- Spots counter: `١٢ من أصل ١٥ مكاناً متبقية`

### 9. Footer
- Two rows: nav links row + copyright row
- Brand name (وافي) + tagline
- Nav links: Dashboard, POS, About, Contact
- Payment methods strip: `USDT` `Wire` `Cash`
- Copyright line

---

## Section 3: App Pages

### Automatic (via token upgrade — no per-page changes needed)

Every element using `class="card"`, `class="glass-sm/md/lg"`, or `class="form-input"` upgrades automatically:

- All page section cards → gradient-glow
- All modal/sheet backgrounds → blue-tinted glass with glow
- All form input focus rings → blue glow border
- AppDialog → modal container gets `glass-lg` treatment (backdrop-filter + blue glow border) added to existing structure; internal layout unchanged
- AppToast → success gets green-glow border, error gets red-glow border
- AppHeader sticky bar → blue-tinted bottom border

### Targeted: `src/pages/HomePage.vue`

- **KPI cards**: add `card-green` to profit card, `card-amber` to cash-low states; add `accent-bar` under each metric value
- **Chart card**: add blue-tinted border + glow shadow; add live green pulse dot next to chart title
- **Best sellers table**: add blue hover glow on rows
- **Health signals**: amplify existing status dot glow values
- **Rate pill in header**: border switches to `--color-border-glow`

### Targeted: `src/components/layout/AppSidebar.vue`

- Sidebar background: `linear-gradient(180deg, rgba(26,86,219,0.08), rgba(255,255,255,0.02))`
- Sidebar border-right: `1px solid rgba(26,86,219,0.18)`
- Active nav item: gradient-glow pill (blue-tinted bg + blue border)

### Targeted: `src/components/layout/AppBottomNav.vue`

- Bar background: gradient-glow glass treatment
- Bar border-top: `1px solid rgba(26,86,219,0.25)`
- Bar box-shadow: `0 -4px 20px rgba(26,86,219,0.10)` (upward glow)
- Active tab: gradient-glow pill matching sidebar active item

---

## Files Changed

| File | Change type |
|---|---|
| `src/style.css` | Token additions + utility upgrades |
| `src/pages/LandingPage.vue` | Full rebuild (template + scoped styles) |
| `src/pages/HomePage.vue` | Targeted scoped style updates |
| `src/components/layout/AppSidebar.vue` | Targeted scoped style updates |
| `src/components/layout/AppBottomNav.vue` | Targeted scoped style updates |
| All other `.vue` files | Auto-upgraded via token change — no direct edits |

---

## Out of Scope

- No changes to component logic, composables, or Supabase queries
- No new Vue components created
- No routing changes
- No changes to the POS screen (`POSSaleScreen.vue`) — phone-first POS has its own visual discipline
- Product story mockup placeholders stay as placeholders (real screenshots come later)
