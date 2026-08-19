// src/features/reports/primitives/queryDeadStockRows.ts
// WAFI-147A primitive 5: shared by Inventory Health's Dead Stock section
// (Task 16) and the dedicated Dead Stock report (Task 17) -- ported from
// useDeadStockReport.ts's query (Vue-bound composable's logic, extracted to
// a plain function). Threshold is a parameter (the original report spec
// offers 60/90/180) rather than hardcoded, so both callers can share one
// implementation even with different defaults.
import { db } from '@/data/powersync/db'

export const DEAD_STOCK_ROW_CAP = 500

export interface DeadStockRow {
  productId: string; nameAr: string; currentStock: number; valueUsd: number; lastSoldAt: string | null
}

/** Returns at most DEAD_STOCK_ROW_CAP rows, ordered by capital tied up (highest first) so a
 *  capped result still shows the most material items, plus whether the cap actually truncated
 *  the result -- a neglected shop's dead stock can genuinely run into the thousands, and
 *  rendering that many rows in one DetailSection would freeze the UI thread (§2's ReportColumn/
 *  DetailSection `truncated` field, added post-plan-review). */
export async function queryDeadStockRows(shopId: string, thresholdDays: number): Promise<{ rows: DeadStockRow[]; truncated: boolean }> {
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 3_600_000).toISOString()
  const rows = await db.getAll<{ id: string; name_ar: string; current_stock: number; cost_price_usd: number; last_sold_at: string | null }>(
    `SELECT p.id, p.name_ar, p.current_stock, p.cost_price_usd, ls.last_sold_at
     FROM products p
     LEFT JOIN (
       SELECT sli.product_id, MAX(s.created_at) AS last_sold_at
       FROM sale_line_items sli JOIN sales s ON s.id = sli.sale_id
       WHERE s.shop_id = ? GROUP BY sli.product_id
     ) ls ON ls.product_id = p.id
     WHERE p.shop_id = ? AND (p.deleted = 0 OR p.deleted IS NULL) AND p.current_stock > 0
       AND (ls.last_sold_at IS NULL OR ls.last_sold_at < ?)`,
    [shopId, shopId, cutoff],
  )
  const mapped = rows
    .filter((r) => r.cost_price_usd > 0)
    .map((r) => ({ productId: r.id, nameAr: r.name_ar, currentStock: r.current_stock, valueUsd: r.current_stock * r.cost_price_usd, lastSoldAt: r.last_sold_at }))
    .sort((a, b) => b.valueUsd - a.valueUsd)
  return { rows: mapped.slice(0, DEAD_STOCK_ROW_CAP), truncated: mapped.length > DEAD_STOCK_ROW_CAP }
}
