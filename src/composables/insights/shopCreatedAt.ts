import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

/**
 * Reads `shops.created_at` for the current device's shop. Not exposed by any
 * existing store/composable (device.store.ts, flags.store.ts,
 * useDiscountCaps.ts each select other columns only) — used to distinguish a
 * "missing" comparison period (shop didn't exist yet) from a genuine $0
 * result. See the WAFI-144 design spec's "Missing is a precise term" note.
 */
export async function getShopCreatedAt(): Promise<string | null> {
  const device = useDeviceStore()
  const row = await db.getOptional<{ created_at: string }>(
    `SELECT created_at FROM shops WHERE id = ?`,
    [device.shopId],
  )
  return row?.created_at ?? null
}
