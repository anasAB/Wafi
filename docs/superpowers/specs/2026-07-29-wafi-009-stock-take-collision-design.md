# WAFI-009: Stock-Take + Active Sales Collision — Design

**Date:** 2026-07-29
**Status:** Documentation of existing implementation + scoped remaining work

## Context

The roadmap's WAFI-009 line reads: "Variance adjustment, timeline visualization" — the
concern that a stock-take (physical inventory count) session can overlap in time with
live sales activity on the same products, and the app must handle that collision without
producing a wrong variance or clobbering a sale's stock decrement.

## Implementation status

**The stock-take feature already exists in production, and the collision-safety
mechanics this ticket is nominally about are already built and shipped.** This ticket
does not introduce stock-taking itself — that shipped under the original guided
stock-take work (`docs/superpowers/specs/2026-07-14-guided-stock-take-design.md`). What
this document does is formalize and record the concurrency hardening that was added
*later*, under a different ticket number (**WAFI-121 / WAFI-134**, an undocumented
bug-fix pass — no dedicated design doc existed for it before this one), consisting of:

- delta-based commit (not absolute overwrite)
- idempotent confirmation
- overlapping-session guard
- snapshot preservation under concurrent sales

This is a real instance of the ticket-numbering collision already tracked in memory
(`project_wafi_ticket_numbering`): WAFI-009 in the roadmap's Macro-Phase 1 table and
WAFI-121/WAFI-134 in the codebase's actual commit history/comments refer to the same
underlying concern, resolved under the latter.

**What remains unbuilt** is the one piece of the roadmap line this document does *not*
retroactively cover: **timeline visualization**. No UI today shows *when* a stock-take
session ran relative to the sales/stock movements that happened during it — the review
screen only shows a textual flag ("تحرّك أثناء الجرد" / "moved during count") when live
stock differs from the frozen snapshot, with no visual timeline of the movements
themselves. Scoping and designing that piece, if wanted, is a separate follow-up
brainstorm, not covered here.

## What was wrong before (the bug this hardening fixes)

**Before (bug):**

```
current_stock = counted_stock          -- absolute overwrite
```

A stock-take session snapshots `expected_stock` at start, but if the *commit* step
simply set `current_stock` to whatever the operator counted, any sale rung between
session start and commit — which already correctly decremented `current_stock` — gets
silently erased. The counted number replaces reality instead of reconciling with it.

**After (fix):**

```
current_stock += (counted_stock − expected_stock)     -- delta applied to LIVE stock
```

The variance between what was counted and what was expected at snapshot time is applied
as an adjustment *on top of* whatever `current_stock` has become by commit time — not as
a replacement for it.

## Core invariant

> The quantity counted by the operator represents the physical inventory at the time of
> counting. The system must therefore apply only the *difference* between the frozen
> snapshot and the counted quantity. Any inventory movements committed after the
> snapshot but before confirmation must be preserved.

Every implementation detail below — delta commit, idempotency, the overlap guard,
snapshot immutability — exists to preserve this one invariant. None of them is
independently motivated; they are all consequences of taking this sentence seriously.

**Restated formally:** a stock-take is a *reconciliation against the snapshot*, not a
*replacement of current stock*.

## Why delta commit is correct — worked example

```
Stock before session starts:        100

Session starts:
  expected_stock (frozen snapshot): 100

Meanwhile, a sale rings during the count:
  current_stock: 100 → 95            (sale of 5 units, correctly applied)

Operator finishes counting:
  counted_stock:                    92

Variance (counted − expected):      92 − 100 = −8

Commit applies the variance to LIVE stock, not to the snapshot:
  current_stock: 95 + (−8) = 87

WRONG (absolute-write bug, pre-fix):
  current_stock: 95 → 92             (the sale's -5 vanishes; shrinkage is
                                       overcounted by exactly the sale's quantity)
```

The correct result is **87**: 8 units are genuinely missing (shrinkage/theft/breakage —
the real -8 variance), on top of the 5 units the sale already, correctly, took out. The
buggy absolute-write result of **92** would silently absorb the sale's -5 into the
variance figure, making the shrinkage report wrong by exactly however many units sold
mid-count — a number that grows with store traffic, not with actual loss.

**Implementation** (`useStockTake.ts`, `confirmSession()`):

```ts
for (const line of lines.value) {
  if (line.countedStock === null) continue
  const delta = line.countedStock - line.expectedStock
  if (delta === 0) continue
  await adjustStockBy(line.productId, delta, 'stocktake', `جرد #${sessionId}`)
}
```

`adjustStockBy` (`useProducts.ts`) reads `current_stock` **fresh, inside its own
transaction**, adds `delta`, clamps at zero (the existing never-below-zero convention),
and writes back — so the delta is applied to whatever the live value has become by the
moment of commit, never to the frozen snapshot.

## Idempotency contract

> `confirmSession()` may safely be retried. A second invocation after successful
> completion must perform no writes.

Before applying any deltas, `confirmSession()` re-reads the session's `status` directly
from the database (not from in-memory state):

```ts
const statusRow = await db.getOptional<{ status: string }>(
  `SELECT status FROM stock_take_sessions WHERE id = ?`, [sessionId]
)
if (!statusRow || statusRow.status !== 'in_progress') {
  return 'already-completed'   // no-op — deltas already applied, or session cancelled
}
```

This guards against a genuinely reachable race in an offline-first, multi-device app: a
double-tap on the confirm button, a retry after a dropped connection, or the *same*
session being confirmed from two devices that both had it open. Without this guard, a
retried confirm would re-apply every line's delta a second time, double-counting every
variance.

## Overlap guard's purpose

The guard in `startSession()` **prevents two active sessions from counting overlapping
product sets, avoiding double application of inventory adjustments.**

Concretely: if session A (scope: all products) and session B (scope: Electronics
category) were both allowed to run `in_progress` at once, both would freeze their own
`expected_stock` snapshot for the same overlapping products at different times, and both
would later commit their own delta against those products independently — the two
variance calculations would corrupt each other's math, since each assumes it is the only
thing measuring the delta between snapshot and commit for that product. The guard blocks
starting a new session whenever its scope overlaps an already-`in_progress` one (same
category, overlapping subcategory, or either side being "all products"), while
correctly allowing two genuinely **disjoint**-scope sessions (e.g. Electronics and
Groceries) to run concurrently, since their delta math never touches the same rows.

## Why the snapshot is never refreshed

A reasonable-sounding but wrong idea: periodically refresh `expected_stock` to the
current live value while the session is still open, so it "stays accurate."

**This would be wrong.** The moment `expected_stock` is refreshed, it stops representing
what the operator is physically counting *right now* and starts representing some later
point in time — but the operator's counted number was produced by looking at the shelf
at the moment they counted it, not at whatever moment the snapshot last refreshed. The
variance calculation (`counted − expected`) is only meaningful if `expected` is frozen at
the exact instant the operator's count-basis was established (session start). Refreshing
it mid-session would silently absorb real sales into the "expected" baseline, making a
genuine shrinkage number disappear into a moving target instead of surfacing as a
variance. The snapshot's immutability for the lifetime of the session **is** the
mechanism that makes the variance number mean anything at all — it is not a
simplification to be improved later.

## Explicitly out of scope (this document)

- **Timeline visualization** — the one piece of the original WAFI-009 roadmap line that
  remains genuinely unbuilt. A future ticket, if wanted, scoping a UI that visually shows
  stock movements (sales, adjustments) that occurred during an open session's window,
  beyond the current textual "moved during count" flag.
- Any change to the delta-commit, idempotency, or overlap-guard mechanics documented
  above — they are correct as shipped; this document records them, it does not propose
  changing them.
