# PROJECT_CONSTRAINTS.md

## Base Reference
Applies all rules from: `PRINCIPLES.md`, `PATTERNS.md`, `ENFORCEMENT.md`

## Architecture Style
Modular PWA — feature-first monorepo, single Vue 3 SPA, offline-first via PowerSync.

## Confirmed ASRs
| ASR | Quality Attribute | Architectural implication |
|-----|------------------|--------------------------|
| Offline-first: works with zero connectivity | Availability | PowerSync local SQLite, no direct HTTP calls in POS composables |
| Arabic RTL + SYP/USD dual currency | Usability | `dir="rtl" lang="ar"` on root, all labels in Arabic |
| JS bundle < 200KB gzipped | Performance | Route-based code splitting on all routes |
| Wholesale-aware schema | Extensibility | items support unit conversions, customers support price lists |

## Active ADRs
| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | PowerSync as sync layer | Accepted |
| ADR-002 | Supabase as Postgres backend | Accepted |
| ADR-003 | Feature-first folder structure | Accepted |
| ADR-004 | Offline-first, local-first | Accepted |

## State Ownership Boundaries
| State type | Owner | Tool |
|-----------|-------|------|
| Server-synced data (products, sales, rates) | PowerSync local SQLite | `db.execute()` |
| In-progress sale (lines, locked rate) | UI state | `sale.store.ts` (Pinia) |
| Sync status + pending count | UI state | `sync.store.ts` (Pinia) |
| Device/shop identity | UI state | `device.store.ts` (Pinia, stubbed) |
| In-progress sale draft (survives app kill) | Local persistent | Dexie IndexedDB |
| URL-addressable screens | URL state | Vue Router |

## Fitness Functions Active
| Rule | Tool | Threshold | CI step |
|------|------|-----------|---------|
| Bundle size | size-limit (to be added) | JS < 200KB gzipped | build |
| Import boundaries | import-linter (to be added) | zero cross-feature internals | lint |
| Unit tests | Vitest | all pass | test |

## Team → Service Ownership
| Role | Owns |
|------|------|
| CTO (Anas Baaj) | All of src/ |

## Current Technical Debt Register
| Item | Impact | Sprint targeted |
|------|--------|----------------|
| No RLS on Supabase tables | Security (dev only) | Before first customer |
| Stubbed auth (hardcoded shop/device) | Auth | Epic 4 (Auth epic) |
| Receipt line items not passed to SaleConfirmationScreen | Print quality | Next sprint |
| No import-linter CI check | Architecture drift risk | Before 2nd developer joins |
