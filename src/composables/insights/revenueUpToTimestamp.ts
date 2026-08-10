import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

/**
 * Revenue (sales total minus refunds) for a single local calendar date,
 * bounded to records created at or before `cutoffIso`. Used only for the
 * 'day' period's comparison-day truncation while today is still in progress
 * (see the WAFI-144 design spec's "Data-layer constraint" note) — mirrors
 * useDashboardMetrics' revenue formula (revenueUsd = sales total - refunds)
 * but scoped to one date with a timestamp upper bound instead of
 * DATE(created_at,'localtime') BETWEEN start AND end, which cannot express
 * "before 14:30 today."
 */
export async function getRevenueUsdUpToTimestamp(dateStr: string, cutoffIso: string): Promise<number> {
  const device = useDeviceStore()
  const [salesRow, refundRow] = await Promise.all([
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(total_usd), 0) as total
       FROM sales
       WHERE shop_id = ? AND DATE(created_at, 'localtime') = ? AND created_at <= ?`,
      [device.shopId, dateStr, cutoffIso],
    ),
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(r.refund_amount_usd), 0) as total
       FROM returns r
       JOIN sales s ON s.id = r.original_sale_id
       WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') = ? AND r.created_at <= ?`,
      [device.shopId, dateStr, cutoffIso],
    ),
  ])
  const refunds = refundRow?.total ?? 0
  return (salesRow?.total ?? 0) - refunds
}
