import { db } from '@/data/powersync/db'

export interface InventoryMovement {
  id:        string
  timestamp: string
  reason:    string
  delta:     number
}

/**
 * Single source of truth for "every inventory-movement source in this app."
 * There is no unified movement ledger — sales/returns/manual adjustments
 * write to `stock_adjustments`, while supplier receivings write only to
 * `stock_receiving_line_items` + a direct `products.current_stock` update
 * (confirmed by reading every write path; see
 * docs/superpowers/specs/2026-07-29-wafi-009-timeline-visualization-design.md).
 * Any future stock-affecting write path (transfers, recipe consumption, …)
 * must extend the UNION here — every consumer of this composable picks up
 * the new source automatically, with zero changes at the call site.
 *
 * `reason = 'stocktake'` rows are excluded: that's the stock-take feature's
 * own eventual commit adjustment, not a concurrent movement to explain.
 *
 * Delta is always derived from the row's own before/after state
 * (`new_value - old_value`), never a `reason`-keyed sign table — old/new
 * values are the canonical record of what happened; `reason` is just a label.
 *
 * `qty_received` is treated as always positive — there is no
 * negative-quantity/correction receiving path in this codebase today.
 *
 * Ordered by `timestamp, id` (not timestamp alone) so two movements written
 * in the same instant still return in a stable, deterministic order across
 * repeated calls — `id` is every table's implicit PowerSync primary key.
 */
export function useInventoryMovements() {
  async function getMovements(
    productId: string, windowStart: string, windowEnd: string, shopId: string,
  ): Promise<InventoryMovement[]> {
    return db.getAll<InventoryMovement>(
      `SELECT id, created_at AS timestamp, reason, (new_value - old_value) AS delta
       FROM stock_adjustments
       WHERE product_id = ? AND shop_id = ? AND reason != 'stocktake'
         AND created_at >= ? AND created_at <= ?

       UNION ALL

       SELECT srl.id, sr.received_at AS timestamp, 'receiving' AS reason, srl.qty_received AS delta
       FROM stock_receiving_line_items srl
       JOIN stock_receivings sr ON sr.id = srl.receiving_id
       WHERE srl.product_id = ? AND srl.shop_id = ?
         AND sr.received_at >= ? AND sr.received_at <= ?

       ORDER BY timestamp ASC, id ASC`,
      [productId, shopId, windowStart, windowEnd, productId, shopId, windowStart, windowEnd],
    )
  }

  return { getMovements }
}
