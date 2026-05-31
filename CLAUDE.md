# CLAUDE.md — Project Context

> Read this before making any product, technical, or strategic suggestions.
> Last updated: full rebuild reflecting confirmed decisions after extended strategy session.

---

## What We Are Building

**A cloud-based retail operations platform (POS + inventory + reporting + profitability views) for shop owners in Syria and the broader Middle East.**

This is NOT an accounting platform. It is a retail operations platform. Shop owners don't think in accounting terms — they think "am I making money, what do I have in stock, are my employees stealing." The product speaks that language.

Long-term: B2B marketplace connecting retailers to wholesalers (year 3-4), then wholesale POS as a second product line (year 3-4, after retail is established).

---

## Founders & Operating Reality

- CEO (outside Syria, visits 2x/year) + CTO (co-founder, Vue 3 developer, no accounting domain experience)
- Both maintain full-time day jobs — side project, ~20-25 hrs/week each
- Cash budget: €100-200/month
- Founder agreement: **DONE**
- Brother conversation: **DONE**
- Brother runs an electronics shop in Syria — customer #0, demo site, referral source
- CEO has additional contacts across other retail/services verticals — additional reference customers
- No outside funding year 1. Day jobs are the seed funding.

---

## Strategic Locks

Do not revisit these without a deliberate founder decision.

### Vertical
- **Year 1:** General retail (any product type). Brother's electronics shop is one example, not the vertical.
- **v1.5:** Deeper general retail, then pharmacy
- **v2+:** Other verticals as customer demand emerges
- **NOT electronics-only** — this was the original framing, user correctly pushed back. The real impulse was retail breadth, not category change to accounting.

### Reference Shape
- **Loyverse** — small-shop self-serve SaaS, mobile-first, modular pricing. Our shape model.
- NOT Tilroy (enterprise omnichannel — architectural mirror only)
- NOT Qoyod-shape (accounting-first horizontal — different category, different strategy)

### Architecture
- Vue 3 + Tailwind + PrimeVue/Vuetify — **locked**
- Postgres on Supabase or Neon
- Offline-first sync via PowerSync, ElectricSQL, or RxDB — **do not hand-roll**
- PWA (Progressive Web App) — not native mobile
- Vercel + Cloudflare hosting
- Monorepo structure
- **ERPNext and all open-source ERP frameworks: closed.** Reasons: desktop-first architecture fights our PWA disciplines, offline-first not supported, Frappe framework is a skill set tax, infrastructure cost $10-20/customer/month vs $2-4 on modern stack.

### Product Disciplines (Loyverse-shape, all locked)
1. **Phone-first design** — POS designed for one-handed phone use. Back Office is desktop-led. Owner Dashboard is phone-only read-only.
2. **Composable architecture** — POS app + Back Office + Owner Dashboard + future modules, sharing one backend.
3. **Self-serve-capable, sales-led delivered** — product works without our help; year 1 sales are human-touch.
4. **Vertical landing pages from one product** — Electronics page, Pharmacy page, etc. Same codebase, multiple marketing doors.

### Pricing — Option C Modular (locked)

| Pack | Price | Included |
|---|---|---|
| **Core (required)** | $12/month | POS, inventory, profitability dashboard, offline, dual currency, 1 user, 1 device, Excel export |
| Staff Pack | +$5/month | Cashier shifts, Z-report, up to 5 users, role permissions, audit log |
| Customer Pack | +$5/month | Customer credit ledger, payment recording, AR aging, customer statement via WhatsApp |
| Reporting Pack | +$5/month | Advanced charts/reports, P&L view, owner WhatsApp digest |
| Electronics Pro | +$8/month | IMEI tools, repair tickets, warranty tracking, repair profitability report |
| Warehouse (v1.5) | +$8/month | Multi-location stock, transfers, per-location permissions, per-branch reports |

- Setup fee: $25 one-time
- Founding customer rate: 50% off total for 12 months (first 10-15 pilots)
- Annual prepay: 17% off
- 30-day money-back guarantee
- No freemium, no gradual feature shutoff

### Wholesale Strategy
- **Years 1-2:** Wholesalers are NOT POS customers. They participate in v3 marketplace as suppliers (Path B).
- **Year 3-4:** Wholesale POS as a SECOND product line. ~5-9 months of focused engineering. Built after retail is established.
- **Wholesale-aware schema from day one:** items support unit conversions, customers support price-list assignments, invoices/payments linked. Costs nothing now, saves months of migration later.
- **Warehouse module ≠ wholesale support.** Warehouse module = retail customer's back-stockroom. Different feature, different customer, ~3-5 weeks of work.

### Collection Strategy (Syria-specific)
- Cash by local helper (brother → part-time salesperson)
- USD bank wire (~20-30%)
- USDT crypto on Tron/BSC
- Hawala for specific cases
- No Stripe

---

## Three Sacred Rules (entry tickets)

Failing any disqualifies us before the demo conversation.

1. **Offline-first** — works fully offline, syncs transparently
2. **Arabic + SYP + configurable exchange rate** — RTL-first, exchange-rate as prominent action
3. **Hardware support** — Epson TM-T20, Star TSP143, generic Chinese 80mm; USB barcode scanner; cash drawer trigger

---

## Three Demo Moments

1. **"Runs on whatever device you have"** — phone, tablet, laptop, browser. PWA install from a link.
2. **"Works without internet"** — turn off WiFi mid-demo, keep selling, watch sync.
3. **"Fits any retail shop"** — customize for their product type, grows with them via packs.

---

## The Litmus Test

> "If this were the only thing we shipped, would a Syrian retail shop owner pay $25/month for it?"

If not an immediate yes — defer to a later version.

---

## Product Roadmap (Versioned Commitments)

### Demo (months 1-6, before any customer)
Sales artifact. Job: earn "when can I have it?" in 5 minutes.
- POS in Arabic, USD/SYP dual pricing, barcode scan, ESC/POS thermal print
- Inventory with stock tracking, low-stock alerts
- Business health dashboard (home screen): revenue today, expenses this week, profit this month, low stock, outstanding credit
- Offline mode with strong sync UI
- Basic expense logging

### v1 — Production-ready core (months 4-9)
- **Business health dashboard** — default home screen, every owner sees health at a glance
- Customer credit ledger (running balance, payment recording) — non-negotiable for Syrian shops
- Cashier shifts (open/close, Z-report, cash variance, employee attribution)
- Receipt template editor (logo, tax number, footer)
- WhatsApp receipt option
- **Photo-first expense capture** — owner photos receipt, enters amount, picks category, photo stored as proof
- Excel import wizard (auto-detect Arabic+English columns)
- Staff permissions + audit log
- Returns and refunds workflow
- Repair tickets (Electronics Pro pack)
- Warranty tracking (Electronics Pro pack)
- **Repair job profitability report** (Electronics Pro pack) — parts cost + labor vs repair fee = profit per job
- Simplified supplier/stock-receiving (supplier name + photo of invoice)
- Owner Dashboard mobile app (phone-only, read-only)
- Daily WhatsApp digest to owner
- **Customer statement via WhatsApp** — one-tap monthly statement per credit customer
- **Payment confirmation link via WhatsApp** — customer receives confirmation when balance paid
- Split payments (cash USD + cash SYP + card)
- Excel/CSV exports
- Tax number on every invoice
- Public Tested Hardware list
- Self-serve onboarding (30 min, no help needed)

### v1.5 — Retail depth + Warehouse module (months 9-15)
**v1.5 does NOT add wholesale POS features.** Wholesalers are not our POS customers.

**Warehouse module:**
- Multi-location data model, stock transfers, per-location stock visibility, per-location permissions, warehouse receiving, per-branch reports

**Other v1.5 features:**
- Customer credit limits + AR aging
- Margin report per customer/product
- Vertical starter templates
- Supplier price comparison dashboard
- Customer Display app (trust signal for high-value sales)
- Composite items/bundles
- Cashier commission tracking
- Barcode label printing
- Live exchange rate API
- Loyalty/points program (retail only)
- Custom report builder (after 7 fixed reports first)
- Expense approval workflow
- **Recurring invoices** (for shops with rental/subscription models)

### v2 — Network foundations (year 2, after 50+ customers)
- B2B marketplace v0 — supplier catalog browse + one-click PO
- 30/60/90 cash flow forecast
- ABC and dead-stock analysis
- Tamper-evident audit log (cryptographic chaining)
- Branch readiness dashboard
- Predictive inventory/demand forecasting
- Second vertical module (clothing or pharmacy)
- E-invoicing with QR + signed PDF
- Public API for third parties
- AI Business Assistant (natural-language queries)
- **Photo OCR for expense capture** (AI reads amount from expense photo)

### v3 — Marketplace launch + Wholesale POS (year 3-4)
- B2B marketplace full launch (retailer orders from wholesaler in one click)
- Wholesaler-side onboarding using captured supplier graph
- **Wholesale POS second product line** — quote-to-cash, customer-specific pricing, AR aging, multi-unit conversion, pick lists, delivery tracking (~5-9 months engineering)
- Logistics/delivery tracking
- Multi-region expansion (Lebanon, Iraq, Jordan)
- Accountant/bookkeeper marketplace
- Embedded payments rail (when viable)

### Explicitly cut (not coming back)
- ERPNext or any open-source ERP as foundation
- Pure freemium (Loyverse-style free forever)
- Gradual feature shutoff after trial
- Per-user pricing in v1
- Hand-rolling the sync layer
- eCommerce sync (Shopify, WooCommerce)
- Self-checkout, Kitchen Display, restaurant features in v1
- Gift cards and loyalty in v1 (loyalty in v1.5 only)

---

## Features Inspired by Western ERP Research

Studied: Striven, QuickBooks Online, Xero, Sage 50cloud, Zoho Books, FreshBooks, Wave, Kashoo, AccountEdge, OneUp, GnuCash, ZipBooks, LessAccounting, Patriot, ClearBooks.

### Borrowed directly
- **Business health dashboard** (QuickBooks/Xero) — revenue, expenses, profit, alerts on home screen
- **Beautiful invoice/receipt templates** (FreshBooks) — professional defaults, easy customization
- **Plain-language UI discipline** (Wave) — "money coming in" not "revenue," "what customers owe you" not "AR"
- **Photo-first expense capture** (QuickBooks/Xero) — photo + manual amount, OCR in v2
- **Customer statements** (ZipBooks/FreshBooks) — but delivered via WhatsApp not email
- **Double-entry data model under the hood** (GnuCash) — correct financial structure hidden from users
- **Repair job profitability** (inspired by FreshBooks project tracking) — parts + labor vs fee charged

### Adapted for Syrian market
- **Bank reconciliation → cash reconciliation** — no bank API; instead, easy matching of WhatsApp/cash payments against customer credit balances
- **Client portal → WhatsApp payment link** — customers don't log into portals; they open WhatsApp
- **Recurring invoices** (Xero/QuickBooks) — adapted for shops with rental/subscription revenue

### Explicitly not borrowing
- Payroll with tax filing integration (no Syrian e-filing)
- ACH/bank transfer payment processing (no Stripe in Syria)
- US/UK tax compliance forms
- Time tracking (we sell products, not hours)
- Mileage tracking
- Check/cheque printing

---

## Tech Stack

```
Frontend:     Vue 3 + Tailwind + PrimeVue (or Vuetify)
PWA:          Vite PWA plugin — installs from browser link, no app store
Backend:      Node.js (Hono/Fastify) or Python (FastAPI) — CTO's call
Database:     Postgres — Supabase or Neon
Sync layer:   PowerSync OR ElectricSQL OR RxDB — 3-5 day spike before committing
Auth:         Supabase Auth or Clerk
Hosting:      Vercel + Cloudflare
Structure:    Monorepo
```

### Week-1 architecture decisions (do not skip)

**1. Sync layer spike (3-5 days).** Evaluate PowerSync vs ElectricSQL vs RxDB on: production maturity at 100+ customers, pricing at 100/500/1000 customers, conflict resolution, Postgres compat, community, self-host option. This is the highest-leverage technical decision in the plan.

**2. Hardware abstraction layer.** Every printer/scanner/drawer model is one driver file. No direct hardware calls in POS code. Adding the 11th printer model should not touch the POS.

**3. Feature flag infrastructure.** Every gated feature flagged at customer level. LaunchDarkly, GrowthBook, or simple Postgres flag table — choose one before v1 ships.

**4. Wholesale-aware schema.** Items support unit conversions, customers support price-list assignments, invoices/payments linked. Costs nothing now. Saves months of migration when wholesale POS ships in year 3-4.

**5. Flexible permissions framework.** Role-based with custom permissions (not hardcoded owner/manager/cashier). Must support wholesale roles in year 3-4 without rebuilding.

### Hardware to order in week 1 ($300 budget)
- 2-3 thermal printers: Epson TM-T20, Star TSP143, generic Chinese 80mm
- 1-2 USB barcode scanners
- 1-2 cheap Android tablets ($100-200 range)

---

## Competitive Landscape

### Syrian incumbents (all desktop-first, no cloud, no mobile)
| Product | Notes |
|---|---|
| الأمين (Al-Ameen) | Market leader, 25+ yrs, $300-700, tax certified |
| النور (Noor) | Cheapest, $100-250, single-device, our most direct rival |
| آفاق سوفت (Afaq) | Vertical variants, $200-500 |
| الرشيد سوفت (Al-Rashid) | Vertical versions, ~$300 |
| البيان (Al-Bayan) | Industrial, $300+ |
| راما (Rama) | SMB+warehouse, $200-400 |
| روابي (Rawabi) | Wholesale focus, $300-600 |
| سهلي سوفت (Sahli) | Small retailers, mobile-friendly but thin |
| ماس المتكامل (Mas) | Medium/large, ERP-like |

**Common weaknesses across all:** desktop-first, no cloud sync, no real offline, 2010-era UI, no vertical depth, no platform thinking, single-tier pricing.

### International references (not competitors)
- **Loyverse** — shape model. 1M+ businesses, 170 countries. Freemium with paid add-ons. Mobile-first.
- **Qoyod** (qoyod.com) — Saudi cloud accounting + POS. 25k Saudi customers. Validates MENA SaaS scale is achievable. Different category (accounting-led horizontal) and different geography. NOT a competitor. **Product name "Qoyod" is off the table** — same name, same category, same region.
- **Tilroy** — enterprise omnichannel. Architectural mirror only (MACH principles). Not a competitive reference.

---

## Unit Economics (Option C Modular)

### Blended ARPU by stage
| Stage | Mix | Blended ARPU |
|---|---|---|
| Year 1 pilots | Founding rate, 50% off | ~$10-15/customer |
| Year 1 end (paid) | Mixed pack adoption | ~$22/customer |
| Year 2 | Maturing mix | ~$28/customer |
| Year 3+ | Stable mix | ~$30-35/customer |

### Cost by stage
| Stage | Customers | Monthly cost |
|---|---|---|
| Build | 0 | $30-50 |
| Pilot | 1-5 | $50-80 |
| Early paid | 5-15 | $80-150 |
| Growth | 15-25 | $200-250 |
| Stable | 25-50 | $280-340 |
| Scaling | 50-100 | $600-900 |
| Real business | 100+ | $1,200-1,500 |

### Gross profit projections
| Customers | Revenue | Cost | Profit |
|---|---|---|---|
| 10 | ~$150 | ~$100 | ~$50 |
| 25 | ~$550 | ~$220 | ~$330 |
| 50 | ~$1,200 | ~$320 | ~$880 |
| 100 | ~$2,800 | ~$1,300 | ~$1,500 |

Break-even at ~15-20 paying customers. Neither founder paid until ~100 customers.

---

## Timeline

| Phase | Months | Goal |
|---|---|---|
| Demo build | 1-6 | Focused demo. Architecture, hardware integration, sync layer decision. |
| First customer | 6-7 | Brother's shop. Remote install. Daily use. |
| v1 with feedback | 7-12 | Iterate on real usage. Feature flag infra for modular pricing. |
| First Syria trip | 12-13 | 10-15 demos. Goal: 3-5 pilot commitments. |
| Pilot onboarding | 13-18 | Remote onboarding. Convert to paid. |
| Referral growth | 18-24 | 10-20 paying customers. Funding/full-time decision. |
| Real business | Year 3 | 30-50 customers. First full-time founder. v1.5 ships. |
| Marketplace + Wholesale | Year 3-4 | B2B marketplace live. Wholesale POS second product line begins. |

---

## Scaling Milestones

### At 100 customers
- Funding decision: raise $50-150k or transition founders to full-time
- First full-time hires (helper full-time + sales/onboarding person)
- Real support tooling (Intercom/HelpScout)
- Arabic knowledge base
- Billing reconciliation infrastructure

### At 300 customers
- Team of 4-6 full-time
- B2B marketplace activates
- Second vertical module live
- Marketing transitions from referrals to channels (SEO, content, community, paid)
- Possible Series A

### At 1000 customers
- Team of 6-8 ops, 6-10 engineering
- Multi-region active (Lebanon, Iraq, Jordan)
- Marketplace generating real revenue via take rate
- Wholesale POS established as second product line

---

## International Accessibility

PWA is accessible globally by design. Signups from Lebanon, Iraq, Jordan, and other Arabic-speaking markets are accepted opportunistically.

Year 1 marketing focus stays exclusively on Syrian retail shops. Active regional expansion is a v3 decision.

**Practical implication for build:** self-serve onboarding must work for cold international signups. Don't hardcode Syrian-specific assumptions into onboarding flow.

---

## Open Items

### Urgent (before any branded work)
- **Product name** — "Qoyod" is off the table. Alternatives: Daftar, Suq, Hanut, Mizan, Hisab, Daftari, Suqly. Verify domain, trademark, app stores. Test with brother before locking.

### Documents
- Strategy PDF needs rebuild to reflect all confirmed decisions (section-by-section discussion in progress)
- Sections partially discussed: Section 4 (mostly settled)
- Sections not yet discussed: 3, 7, 9, 5, 6, 11, 12, 13

### Strategic
- v1 feature sequencing within months 7-12
- Stack-specific choices (Supabase vs Neon, PowerSync vs ElectricSQL vs RxDB) — CTO decides after spike
- Marketing foundation work in year 1 (2-3 hrs/week: SEO, community, demo videos)
- Earlier marketplace v0 (worth pulling to month 12-18)
- Funding plan around month 18-24

### Tactical
- Hardware ordering ($300 budget) — week 1 of build
- Competitive research execution (walkthrough of Al-Ameen or Noor)
- Identify specific reference customers from CEO's non-electronics network

---

## Architecture Reference Files

Before writing any code or making any suggestion, read:
- `docs/architecture/PRINCIPLES.md` — decision rules, code generation rules, ADR template
- `docs/architecture/PATTERNS.md` — pattern selection, integration, frontend, data
- `docs/architecture/ENFORCEMENT.md` — PR checklist, CI setup, security baselines

## Rules (non-negotiable)

- Every class/function must pass the SOLID checklist in PRINCIPLES.md
- Every new library or significant decision → produce an ADR using the template in PRINCIPLES.md
- Every PR review → run the full checklist in ENFORCEMENT.md section 1
- Never generate code that violates the Architecture Boundaries checklist in ENFORCEMENT.md
- State management follows the ownership decision tree in PATTERNS.md section 5
- Secrets never in source code — see ENFORCEMENT.md section 3

## Project-Specific Constraints

See: `PROJECT_CONSTRAINTS.md`

---

## Working Principles (for any AI or collaborator)

1. **Apply the Litmus Test.** Would a Syrian retail shop owner pay $25/month for this feature alone? If not, defer.
2. **Respect the locks.** Vertical = general retail. Stack = Vue 3 PWA no ERPNext. Pricing = Option C modular. Wholesale POS = year 3-4 second product line. Reference = Loyverse shape. Name = not Qoyod.
3. **Respect the four product disciplines.** Phone-first, composable, self-serve-capable, vertical landing pages.
4. **Match advice to constraints.** Part-time founders, €100-200/month budget. Don't propose full-time or well-funded plans.
5. **Be direct and critical.** CEO explicitly wants this. Sycophancy is unhelpful.
6. **Don't optimize against wrong references.** Syrian competitors = Al-Ameen, Noor, Afaq. Shape reference = Loyverse. Not QuickBooks, not Square, not Qoyod.
7. **Defer eagerly.** Unsure about v1 vs v1.5? Default to v1.5.
8. **Network density is the moat.** Years 1-2 = retailer density + supplier graph capture. Year 3-4 = marketplace + wholesale POS.
9. **If a feature requires calling the customer to use it, that feature is broken.**
10. **Do NOT conflate Wholesale business with Warehouse module.** Wholesale POS = year 3-4 second product. Warehouse = v1.5 retail customer feature.
11. **Plain-language UI discipline.** "Money coming in" not "revenue." "What customers owe you" not "AR." Shop owner language throughout.
12. **When broader-scope questions keep surfacing, ask what's underneath.** The CEO's impulse toward broader scope during early planning was real signal about retail breadth, not a discipline problem. Don't reflexively argue for focus — ask what the impulse is pointing at.