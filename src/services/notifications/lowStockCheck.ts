// State-derived Low Stock check (WAFI-145 design spec). Must run synchronously
// inside the SAME write transaction as the stock mutation, not as a separately
// scheduled or event-subscriber-driven check -- see the design spec's "Low Stock
// must be checked synchronously inside the inventory mutation flow" requirement.
// Takes `tx` (not `db`), matching the existing convention in sales.service.ts and
// inventory.service.ts where all writes inside a transaction go through `tx`.
//
// No source_event_id (this isn't event-sourced) -- migration 080 made that column
// nullable specifically for this case.

interface TxLike {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>
}

interface ThresholdRow { low_stock_threshold: number; name_ar: string }

export async function checkLowStockCrossing(
  tx: TxLike,
  shopId: string,
  productId: string,
  oldStock: number,
  newStock: number,
  now: string,
): Promise<void> {
  const res = await tx.execute(
    `select low_stock_threshold, name_ar from products where id = ?`, [productId],
  )
  const row = (res as any).rows?._array?.[0] as ThresholdRow | undefined
  if (!row) return
  const threshold = row.low_stock_threshold

  // Boundary inclusive: the threshold itself counts as low. Fires only on the
  // crossing (was above, now at-or-below) -- not on every event while already
  // below, and resets when stock climbs back above the threshold.
  const crossedDown = oldStock > threshold && newStock <= threshold
  if (!crossedDown) return

  await tx.execute(
    `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
     values (?, ?, 'owner', 'inventory.low_stock', ?, ?, 'product', ?, 'WARNING', NULL, ?)`,
    [
      crypto.randomUUID(), shopId,
      'مخزون منخفض',
      `وصل المنتج "${row.name_ar}" إلى الحد الأدنى للمخزون (${newStock} متبقٍ)`,
      productId, now,
    ],
  )
}
