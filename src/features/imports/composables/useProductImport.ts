import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { toUsd } from '../lib/convert'
import type { ImportResult, PriceCurrency, RowStatus } from '../import.types'

const DEFAULT_LOW_STOCK = 5

export function useProductImport() {
  const { logProductsImported } = useAuditLog()

  async function fetchExistingBarcodes(): Promise<Set<string>> {
    const device = useDeviceStore()
    const rows = await db.getAll<{ barcode: string | null }>(
      `SELECT barcode FROM products
       WHERE shop_id = ? AND barcode IS NOT NULL AND (deleted = 0 OR deleted IS NULL)`,
      [device.shopId],
    )
    return new Set(rows.map((r) => r.barcode).filter((b): b is string => !!b))
  }

  async function commitImport(
    statuses: RowStatus[],
    ctx: { rate: number; priceCurrency: PriceCurrency; costCurrency: PriceCurrency },
  ): Promise<ImportResult> {
    const device = useDeviceStore()
    const toInsert = statuses.filter((s) => s.kind === 'import')
    const skipped  = statuses.filter((s) => s.kind === 'skip').length
    const errored  = statuses.filter((s) => s.kind === 'error').length
    const now = new Date().toISOString()

    if (toInsert.length > 0) {
      await db.writeTransaction(async (tx) => {
        for (const s of toInsert) {
          const r = s.row
          const priceUsd = toUsd(r.salePriceRaw as number, ctx.priceCurrency, ctx.rate)
          const costUsd  = r.costRaw === null ? null : toUsd(r.costRaw, ctx.costCurrency, ctx.rate)
          // The sheet's free-text category column isn't resolved to a
          // category_id/subcategory_id here — that would need a lookup-or-create
          // step out of scope for this DB-write task. Imported products land
          // uncategorized (category/category_id/subcategory_id all null), same
          // as manually adding a product without picking a category; the owner
          // can assign a category afterward from Products.
          // WAFI-013: stamped unconditionally when the imported cost is real —
          // entering a cost via a bulk import is exactly as much a confirmation
          // of that value as typing it into the product form by hand.
          const costUpdatedAt = costUsd !== null && costUsd > 0 ? now : null
          await tx.execute(
            `INSERT INTO products
               (id, shop_id, name_ar, name_en, barcode, category, category_id, subcategory_id,
                price_usd, cost_price_usd, current_stock, low_stock_threshold, photo_url,
                is_active, deleted, sync_status, created_at, updated_at, cost_updated_at, created_via)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, 'pending', ?, ?, ?, ?)`,
            [
              uuidv4(), device.shopId, r.nameAr, r.nameEn, r.barcode, null, null, null,
              priceUsd, costUsd ?? 0,
              r.currentStock ?? 0, r.lowStockThreshold ?? DEFAULT_LOW_STOCK,
              now, now, costUpdatedAt, 'import',
            ],
          )
        }
      })
      await logProductsImported(toInsert.length, skipped)
    }

    return { inserted: toInsert.length, skipped, errored, statuses }
  }

  return { fetchExistingBarcodes, commitImport }
}
