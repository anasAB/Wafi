import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { getDateRange } from './periodUtils'
import type { Period } from './periodUtils'

export function useDashboardMetrics() {
  const revenueUsd       = ref(0)
  const cogsUsd          = ref(0)
  const expensesUsd      = ref(0)
  const missingCostCount = ref(0)
  const invoiceCount     = ref(0)

  const profitUsd = computed(() => revenueUsd.value - cogsUsd.value - expensesUsd.value)

  async function load(period: Period) {
    const device = useDeviceStore()
    const { start, end } = getDateRange(period)

    const [revRow, cogsRow, expRow, missingRow, countRow] = await Promise.all([
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(total_usd), 0) as total
         FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?`,
        [device.shopId, start, end]
      ),
      db.getOptional<{ cogs: number }>(
        `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as cogs
         FROM sale_line_items sli
         JOIN sales s ON sli.sale_id = s.id
         WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?`,
        [device.shopId, start, end]
      ),
      db.getOptional<{ total: number }>(
        `SELECT COALESCE(SUM(amount_usd), 0) as total
         FROM expenses WHERE shop_id = ? AND expense_date BETWEEN ? AND ?`,
        [device.shopId, start, end]
      ),
      db.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count FROM products
         WHERE shop_id = ? AND is_active = 1 AND (deleted = 0 OR deleted IS NULL)
           AND (cost_price_usd = 0 OR cost_price_usd IS NULL)`,
        [device.shopId]
      ),
      db.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count FROM sales
         WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ?`,
        [device.shopId, start, end]
      ),
    ])

    revenueUsd.value       = revRow?.total    ?? 0
    cogsUsd.value          = cogsRow?.cogs    ?? 0
    expensesUsd.value      = expRow?.total    ?? 0
    missingCostCount.value = missingRow?.count ?? 0
    invoiceCount.value     = countRow?.count   ?? 0
  }

  return { revenueUsd, cogsUsd, expensesUsd, profitUsd, missingCostCount, invoiceCount, load }
}
