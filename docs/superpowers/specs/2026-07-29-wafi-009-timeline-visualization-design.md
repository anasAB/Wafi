# WAFI-009 (remaining piece): Stock-Take Variance Timeline — Design

**Date:** 2026-07-29
**Status:** Approved direction, ready for spec self-review
**Scope:** The one piece of the original WAFI-009 roadmap line left unbuilt after
`2026-07-29-wafi-009-stock-take-collision-design.md` documented the already-shipped
collision-safety mechanics (WAFI-121/134). This document covers the "timeline
visualization" gap only.

## Problem

`StockTakeReviewScreen.vue` shows a line's variance (`counted − expected`) and, if live
stock has moved since the snapshot, a one-line text flag ("تحرّك أثناء الجرد" / "moved
during count"). It does not show *what* moved, *when*, or *how much of the variance that
movement explains* — an owner reviewing a -13 variance can't tell whether that's 10
units of real shrinkage plus a 3-unit sale mid-count, or something else entirely.

## Data source — verified, not assumed

There is **no single unified inventory-movement ledger** in this codebase. Confirmed by
reading every write path directly:

| Movement | Writes to | Confirmed at |
|---|---|---|
| Sale | `stock_adjustments`, `reason='sale'` | `usePayment.ts:327-330` |
| Return | `stock_adjustments`, `reason='return'` | `useReturnSheet.ts` |
| Manual (damaged/lost/other) | `stock_adjustments` via `adjustStock`/`adjustStockBy` | `useProducts.ts` |
| Stock-take commit | `stock_adjustments`, `reason='stocktake'` | `useStockTake.ts::confirmSession` |
| Supplier receiving | `stock_receiving_line_items` + direct `products.current_stock` write — **no `stock_adjustments` row** | `useReceivingSheet.ts:92-110` |

A timeline built off `stock_adjustments` alone would silently omit every supplier
delivery — worse than no timeline, since it would present itself as complete. The
correct query is a `UNION` of two sources, normalized to one shape.

```sql
SELECT created_at AS ts, reason, (new_value - old_value) AS delta
FROM stock_adjustments
WHERE product_id = ? AND reason != 'stocktake'
  AND created_at >= ? AND created_at <= ?

UNION ALL

SELECT sr.received_at AS ts, 'receiving' AS reason, srl.qty_received AS delta
FROM stock_receiving_line_items srl
JOIN stock_receivings sr ON sr.id = srl.receiving_id
WHERE srl.product_id = ?
  AND sr.received_at >= ? AND sr.received_at <= ?

ORDER BY ts ASC
```

(Six bound params: `productId, windowStart, windowEnd` repeated for both halves of the
union — `db.getAll` takes a flat params array in this codebase's convention.)

## Window boundary — fixed, not live

The window's upper bound is captured **once**, when `StockTakeReviewScreen.vue` mounts
(a local `const reviewedAt = new Date().toISOString()`, or — if the session already has
a `completedAt` from a prior confirm attempt that hit the idempotency no-op path —
`session.completedAt` instead), and reused for every line's query. It must NOT be
`now()` evaluated fresh per query: an owner spending 15 minutes reviewing must see the
same timeline for the entire review, not one that grows a new sale into it mid-review
while they're trying to reconcile a number they already looked at.

The window's lower bound is `session.startedAt` (the existing frozen-snapshot moment).

## The three numbers, always shown together

Per your framing: showing icons alone (🛒 ↩️ ⚠️) invites the reader to do arithmetic in
their head. Show the arithmetic:

```
09:14  بيع        -3
09:28  مرتجع       +1
09:40  تالف        -2
────────────────────
صافي الحركة:        -4
فرق الجرد:          -7
الفرق غير المفسّر:   -3
```

- **صافي الحركة (net movement)** — `sum(delta)` across every unioned row in the window.
- **فرق الجرد (session variance)** — the line's existing `variance` (`counted −
  expected`), unchanged, already computed by `recordCount()`.
- **الفرق غير المفسّر (unexplained variance)** — `variance − netMovementDelta`.

**Deliberately not called "shrinkage."** Your own example is the reason: expected 100,
counted 120, variance +20, a supplier accidentally over-delivered 10 → net movement
+10 → unexplained variance +10. That's a positive number nobody would call shrinkage.
The field name and label must work for both signs — this is the actual meaning of the
number (whatever the movements in view don't already explain), not a shrinkage
estimate.

## Composable

New: `useStockTakeVariance.ts` (or added to the existing `stock-take/composables/`
directory — final filename is a planning-time call, not a design decision). Shape:

```ts
export interface MovementEntry {
  timestamp: string
  reason: string        // 'sale' | 'return' | 'damaged' | 'lost' | 'other' | 'receiving' | anything future
  delta: number
}

export interface LineMovements {
  entries: MovementEntry[]
  netMovementDelta: number
  unexplainedVariance: number
}

function useStockTakeVariance() {
  const cache = new Map<string, LineMovements>()   // keyed by productId — one fetch per line per review session

  async function loadMovements(
    productId: string, variance: number, windowStart: string, windowEnd: string,
  ): Promise<LineMovements> {
    if (cache.has(productId)) return cache.get(productId)!
    // ... run the UNION query, compute netMovementDelta, unexplainedVariance ...
    cache.set(productId, result)
    return result
  }

  return { loadMovements }
}
```

The cache lives for the lifetime of one `useStockTakeVariance()` call (i.e. one mount
of the review screen) — expand → collapse → expand again on the same line must not
re-query SQLite. A fresh mount (leaving and re-entering the review screen) is a fresh
cache; this is a display feature, not a source of truth, so there is no staleness risk
worth solving beyond "don't refetch while this screen is open."

## Reason display

```ts
const REASON_DISPLAY: Record<string, { icon: string; label: string }> = {
  sale:      { icon: '🛒', label: 'بيع' },
  return:    { icon: '↩️', label: 'مرتجع' },
  damaged:   { icon: '⚠️', label: 'تالف' },
  lost:      { icon: '⚠️', label: 'فاقد' },
  other:     { icon: '📝', label: 'أخرى' },
  receiving: { icon: '📦', label: 'توريد' },
}
function displayFor(reason: string) {
  return REASON_DISPLAY[reason] ?? { icon: '❔', label: reason }
}
```

Any future reason value falls through to the raw string with a generic icon — never a
crash, matching this feature area's existing "unrecognized value degrades gracefully"
discipline (WAFI-010's decision-table fallback is the precedent).

## UI

`StockTakeReviewScreen.vue`'s `.line-card`, for any line already in `reviewLines`
(nonzero variance — no new filtering needed), becomes expandable:

- A local `expandedProductId = ref<string | null>(null)` toggled on click (single-open
  accordion — expanding one collapses another, keeping the list scannable).
- On first expand of a given line, call `loadMovements(...)`; subsequent
  expand/collapse of the same line reuses the cached result.
- Expanded content: the movement list (timestamp, reason icon+label, delta), then the
  three-number block (net movement / session variance / unexplained variance).
- **Zero-movements case**: still expandable. Shows "لا توجد حركات خلال فترة الجرد — الفرق
  بالكامل غير مفسّر" (no movements during the count — the entire variance is
  unexplained), with `unexplainedVariance === variance` displayed via the same
  three-number block rather than a special-cased empty state.

## Testing (edge cases carried into the eventual plan)

1. Multiple sales in the window — all appear, net movement sums correctly.
2. Sales + a return — signs net correctly (a return is a positive delta).
3. A manual adjustment (`damaged`/`lost`/`other`) appears alongside sales.
4. A receiving appears (the union's second half) — proves the fix for the
   `stock_adjustments`-only gap.
5. Zero movements — unexplained variance equals the full variance, UI shows the
   no-movements message, not an empty/broken list.
6. Only positive movements (e.g. two returns, no sales).
7. Only negative movements.
8. A movement timestamped exactly at `session.startedAt` — included (`>=`).
9. A movement timestamped exactly at `reviewedAt` (the window's upper bound) —
   included (`<=`).
10. An unrecognized `reason` value — renders with the generic fallback icon/label,
    does not crash, still contributes correctly to `netMovementDelta`.
11. Expand → collapse → expand the same line twice — second expand does not issue a
    second SQL query (cache hit) — assert via a mock call-count.
12. Two different lines expanded in sequence — each gets its own cache entry; expanding
    line B does not evict or corrupt line A's cached result.

## Explicitly out of scope

- Any change to the delta-commit, idempotency, or overlap-guard mechanics — untouched,
  already correct per the collision-handling design doc.
- A session-level (not per-line) aggregate timeline view — the accordion-per-line
  design was the explicitly chosen direction over a separate session-wide tab.
- Editing/dismissing/annotating movements from this view — read-only display only.
