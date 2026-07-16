import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface CategoryBreakdownRow {
  categoryId:       string
  categoryName:     string
  revenueUsd:       number
  cogsUsd:          number
  profitUsd:        number
  hasMissingCost:   boolean
}

type Row = {
  category_id: string; category_name: string
  revenue_usd: number; cogs_usd: number; has_missing_cost: number
}

export function useCategoryBreakdown() {
  const rows = ref<CategoryBreakdownRow[]>([])

  async function load(start: string, end: string): Promise<void> {
    const device = useDeviceStore()
    const result = await db.getAll<Row>(
      `SELECT c.id AS category_id, c.name AS category_name,
              COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0) AS revenue_usd,
              COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs_usd,
              MAX(CASE WHEN p.cost_price_usd IS NULL OR p.cost_price_usd <= 0 THEN 1 ELSE 0 END) AS has_missing_cost
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY c.id, c.name
       ORDER BY (COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0)
                 - COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0)) DESC`,
      [device.shopId, start, end]
    )

    rows.value = result.map(r => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      revenueUsd: r.revenue_usd,
      cogsUsd: r.cogs_usd,
      profitUsd: r.revenue_usd - r.cogs_usd,
      hasMissingCost: r.has_missing_cost === 1,
    }))
  }

  async function loadSubcategoryRows(categoryId: string, start: string, end: string): Promise<CategoryBreakdownRow[]> {
    const device = useDeviceStore()
    const result = await db.getAll<Row & { category_id: string }>(
      `SELECT sc.id AS category_id, sc.name AS category_name,
              COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0) AS revenue_usd,
              COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) AS cogs_usd,
              MAX(CASE WHEN p.cost_price_usd IS NULL OR p.cost_price_usd <= 0 THEN 1 ELSE 0 END) AS has_missing_cost
       FROM sale_line_items sli
       JOIN sales s ON s.id = sli.sale_id
       JOIN products p ON p.id = sli.product_id
       JOIN subcategories sc ON sc.id = p.subcategory_id
       WHERE s.shop_id = ? AND p.category_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sc.id, sc.name
       ORDER BY (COALESCE(SUM(sli.quantity * sli.unit_price_usd), 0)
                 - COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0)) DESC`,
      [device.shopId, categoryId, start, end]
    )

    return result.map(r => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      revenueUsd: r.revenue_usd,
      cogsUsd: r.cogs_usd,
      profitUsd: r.revenue_usd - r.cogs_usd,
      hasMissingCost: r.has_missing_cost === 1,
    }))
  }

  return { rows, load, loadSubcategoryRows }
}
