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

Inventory movements are currently distributed across multiple persistence sources
rather than stored in a single movement ledger. Confirmed by reading every write path
directly:

| Movement | Writes to | Confirmed at |
|---|---|---|
| Sale | `stock_adjustments`, `reason='sale'` | `usePayment.ts:327-330` |
| Return | `stock_adjustments`, `reason='return'` | `useReturnSheet.ts` |
| Manual (damaged/lost/other) | `stock_adjustments` via `adjustStock`/`adjustStockBy` | `useProducts.ts` |
| Stock-take commit | `stock_adjustments`, `reason='stocktake'` | `useStockTake.ts::confirmSession` |
| Supplier receiving | `stock_receiving_line_items` + direct `products.current_stock` write — **no `stock_adjustments` row** | `useReceivingSheet.ts:92-110` |

A timeline built off `stock_adjustments` alone would silently omit every supplier
delivery — worse than no timeline, since it would present itself as complete.

**This must not be a UNION query embedded inside the stock-take feature.** Writing
`stock_adjustments UNION stock_receiving_line_items` directly inside
`useStockTakeVariance.ts` encodes "here is the complete list of inventory-movement
sources" into a screen that has no business owning that knowledge. Six months from now,
someone adding an inventory-transfer feature or a recipe-consumption feature has no
reason to remember that a stock-take review screen also needs updating — and won't.

**Fix: extract a shared query into the products/inventory domain**, consumed by (not
duplicated inside) the stock-take feature:

```ts
// src/features/products/composables/useInventoryMovements.ts
export interface InventoryMovement {
  id: string          // tie-breaker for deterministic ordering (see below)
  timestamp: string
  reason: string
  delta: number
}

export function useInventoryMovements() {
  async function getMovements(
    productId: string, windowStart: string, windowEnd: string,
  ): Promise<InventoryMovement[]> {
    return db.getAll<InventoryMovement>(
      `SELECT id, created_at AS timestamp, reason, (new_value - old_value) AS delta
       FROM stock_adjustments
       WHERE product_id = ? AND reason != 'stocktake'
         AND created_at >= ? AND created_at <= ?

       UNION ALL

       SELECT srl.id, sr.received_at AS timestamp, 'receiving' AS reason, srl.qty_received AS delta
       FROM stock_receiving_line_items srl
       JOIN stock_receivings sr ON sr.id = srl.receiving_id
       WHERE srl.product_id = ?
         AND sr.received_at >= ? AND sr.received_at <= ?

       ORDER BY timestamp ASC, id ASC`,
      [productId, windowStart, windowEnd, productId, windowStart, windowEnd],
    )
  }
  return { getMovements }
}
```

This is the ONE place that knows every inventory-movement source. When a future feature
adds a new stock-affecting write path, it extends this function's UNION — every
consumer (this stock-take screen, and any future one — e.g. a per-product activity
view) picks up the new source automatically, with zero changes to the stock-take
feature itself. `useStockTakeVariance.ts` calls `getMovements()` and layers the
stock-take-specific arithmetic (`netMovementDelta`, `unexplainedVariance`) on top; it
does not know or care what sources fed the list.

**Ordering invariant:** `ORDER BY timestamp ASC, id ASC`, not `timestamp` alone. SQLite
timestamp columns here are ISO strings without guaranteed sub-second uniqueness — two
movements written in the same millisecond (plausible: a receiving confirmed right after
a sale) would otherwise sort in a query-plan-dependent, effectively random order,
making the UI's displayed sequence flicker between renders. `id` (every table's implicit
PowerSync primary key, a UUID, present even though never declared in `schema.ts`'s
column list) gives a stable secondary key. This does not claim to recover the *true*
sub-millisecond chronological order between two ties — only that the displayed order is
deterministic and stable across repeated queries.

**Delta invariant — document why, not just what:** `delta = new_value − old_value` for
`stock_adjustments` rows is derived from the row's own before/after state, not from
`reason`. This is intentional: `old_value`/`new_value` are the canonical record of what
actually happened to `current_stock` at that moment, while `reason` is a label. A future
maintainer must not "simplify" this into a `reason`-keyed sign table (e.g. `sale → -qty`,
`return → +qty`) — that would duplicate business logic that already lives correctly in
each write path's own delta computation, and would silently diverge the moment any write
path's sign convention changes without this code being touched.

**Receiving sign invariant:** `stock_receiving_line_items.qty_received` is treated as
always positive (a receiving only ever adds stock in this codebase today — confirmed,
`useReceivingSheet.ts` has no negative-quantity or correction path). If a future ticket
introduces a receiving correction/negative-quantity path, this UNION's `qty_received AS
delta` line must be revisited — it is not automatically sign-correct.

**Receiving timestamp:** `stock_receivings` has exactly one timestamp column,
`received_at` (confirmed against `schema.ts:355-365` — no separate `created_at`/
`confirmed_at`), so there is no ambiguity about which column is inventory-effective.

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

`src/features/products/composables/useInventoryMovements.ts` (shared, above) supplies
raw movements. The stock-take-specific layer — `useStockTakeVariance.ts`, in
`stock-take/composables/` — consumes it and adds the stock-take-only arithmetic:

```ts
export interface LineMovements {
  entries: InventoryMovement[]
  netMovementDelta: number
  unexplainedVariance: number
}

function useStockTakeVariance() {
  const { getMovements } = useInventoryMovements()
  // Keyed by `${productId}:${windowStart}:${windowEnd}`, not productId alone — the
  // window is fixed per review-screen mount today (see "Window boundary" above), but
  // this key shape means a future feature that re-runs the query with a different
  // window (e.g. a "refresh" affordance) gets a correct cache miss instead of silently
  // serving a stale window's result under the same product's cache slot.
  const cache = new Map<string, LineMovements>()

  async function loadMovements(
    productId: string, variance: number, windowStart: string, windowEnd: string,
  ): Promise<LineMovements> {
    const key = `${productId}:${windowStart}:${windowEnd}`
    if (cache.has(key)) return cache.get(key)!
    const entries = await getMovements(productId, windowStart, windowEnd)
    const netMovementDelta = entries.reduce((sum, e) => sum + e.delta, 0)
    const result: LineMovements = { entries, netMovementDelta, unexplainedVariance: variance - netMovementDelta }
    cache.set(key, result)
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
10. A movement timestamped one second before `session.startedAt` — **excluded**.
11. A movement timestamped one second after `reviewedAt` — **excluded**. (Together with
    8-9, this verifies both edges of the boundary are correct, not just that something
    inside the window is included.)
12. An unrecognized `reason` value — renders with the generic fallback icon/label,
    does not crash, still contributes correctly to `netMovementDelta`.
13. Two movements with identical timestamps (down to whatever precision the stored ISO
    string carries) — order is deterministic and stable across repeated calls (assert
    by running the query twice and comparing the returned order), not merely "doesn't
    crash."
14. A receiving-only case (no `stock_adjustments` rows at all for this product in the
    window) — the union's second half alone still produces a correct, non-empty result;
    proves the fix for the `stock_adjustments`-only gap end-to-end, not just at the SQL
    level.
15. Expand → collapse → expand the same line twice — second expand does not issue a
    second SQL query (cache hit) — assert via a mock call-count.
16. Two different lines expanded in sequence — each gets its own cache entry; expanding
    line B does not evict or corrupt line A's cached result.

## Explicitly out of scope

- Any change to the delta-commit, idempotency, or overlap-guard mechanics — untouched,
  already correct per the collision-handling design doc.
- A session-level (not per-line) aggregate timeline view — the accordion-per-line
  design was the explicitly chosen direction over a separate session-wide tab.
- Editing/dismissing/annotating movements from this view — read-only display only.
