# Import / Export — Plan & Trip Data-Collection Checklist

> Date: 2026-06-23 · Owner: PO/CEO + dev
> Three distinct workstreams. Export exists; catalog import is white-glove; historical-sales import is a new post-trip epic that depends on collecting a real export file on the trip.

## The three workstreams

| # | Workstream | Status | Mechanism | Timing |
|---|---|---|---|---|
| 1 | **Export to PC** | ✅ Built (`features/exports`, CSV/XLSX) | Open Wafi in the **PC browser**, sign in, Export screen → download. (Or export on phone, transfer.) | Now — verify on his build + WAFI-033 fixes |
| 2 | **Catalog import (products)** | White-glove (no wizard) | Dev runs a one-off script from his product spreadsheet into his shop | Trip (load so he can sell) |
| 3 | **Historical sales import (2 yrs)** | New epic, not built | Import a real old-POS export → store as separate historical summary → Reports unions it | Collect on trip → build after |
| (2b) | Self-serve Excel import wizard | Stub (~5%) | Epic 2.3 — for pilots #2+ | Post-trip |

## Export (workstream 1)
Already works: `useExportData` + `useExportFile` produce CSV/XLSX. Cleanest path to a PC (it's a PWA): the owner opens Wafi in a desktop browser, signs in, and exports there → file lands on the PC. Needs: verify on the brother's build + the WAFI-033 fixes (range validation, large-data, LEFT-join deleted products, truthful payment-method label). **Not a new feature.**

## Catalog import (workstream 2) — the trip mechanism
- Define a simple spreadsheet format: **Arabic name, English name, barcode, cost price, sale price, current stock, category**.
- Dev writes a **one-off import script** that reads it and inserts products into the brother's provisioned shop (reusing the `useProducts.save` duplicate-barcode guard / currency rules).
- This is the realistic "import on the trip" — white-glove, single shop. The self-serve wizard (Epic 2.3) is a separate post-trip build for pilots.
- **Cost prices matter:** for *live* profit (the Profit Report) to be correct going forward, his catalog must carry cost. Collect cost per product.

## Historical sales import (workstream 3) — the new epic
**Honest reality of old Syrian POS exports (Al-Ameen/Noor/etc.):** SYP-only, often no cost, no per-sale exchange rate, format unknown until seen.

- **Truthful outcomes:** units sold + SYP revenue over 2 years are reliable. USD requires reconstructed historical rates (approximation). Profit only if the export carries cost.
- **Architecture (do NOT fake transactions):** store imported history as a **separate, clearly-flagged historical period-summary** (month-level: units, SYP revenue, and cost/profit only if present) — never as live `sales` rows (which would pollute sale history, returns, Z-reports, dashboards). The Reports screen **unions** live-computed periods with imported-summary periods, marked "imported," with currency/cost caveats on screen.
- **Cannot be designed blind** — the importer must be built against a real export file (see checklist). Detailed spec waits for that file.
- Ties to the Profit Report spec's data-integrity note and the pre-aggregation trigger.

## TRIP DATA-COLLECTION CHECKLIST (the actionable part)

Bring these back or the post-trip build is blocked:

- [ ] **His product list** as a spreadsheet — for the catalog load (workstream 2). Include **cost price** per product.
- [ ] **A real export file from his old POS** — even one month's worth. *This is the decisive artifact for the historical importer.*
- [ ] **The full 2-year export** (once the sample format is understood).
- [ ] **Note the old POS** name + version (so we can anticipate the format/encoding).
- [ ] **Inspect what the export actually contains** and record it:
  - Itemized (sale-by-sale + line items) or summary (daily/monthly totals)?
  - Is there a **cost** column? (decides whether historical *profit* is possible)
  - Is it **SYP-only**, or any USD?
  - Date format + file encoding (likely Windows-1256 Arabic).
- [ ] Confirm whether his old POS tracked **cost** at all (many don't).

## Post-trip sequence
1. Load his catalog (script) → he sells with real inventory; live profit correct from go-live.
2. With the real export in hand: **design the historical importer** against the actual format (brainstorm → spec → plan).
3. Build it (separate historical store) + Reports union (live + imported), SYP/units truthful, USD/profit gated on available data.
4. Add pre-aggregation if the volume warrants it (the bulk import is the trigger).
5. Verify export (WAFI-033) on his build.
