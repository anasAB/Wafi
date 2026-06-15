import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { ExportDateRange } from '../export.types'

const PAYMENT_LABELS: Record<string, string> = {
  cash_usd: 'نقد دولار',
  cash_syp: 'نقد ليرة',
  card:     'بطاقة',
  credit:   'آجل',
  split:    'دفع مختلط',
}

type SaleRow = {
  display_sale_number: string
  created_at: string
  total_usd: number
  payment_method: string
  cashier_name: string | null
  product_name: string
  qty: number
  unit_price_usd: number
  unit_price_syp: number
}

export async function fetchSalesRows(
  range: ExportDateRange,
): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<SaleRow>(
    `SELECT
       s.display_sale_number,
       s.created_at,
       s.total_usd,
       s.payment_method,
       st.name    AS cashier_name,
       p.name_ar  AS product_name,
       li.quantity AS qty,
       li.unit_price_usd,
       ROUND(li.unit_price_usd * s.exchange_rate_at_sale) AS unit_price_syp
     FROM sales s
     JOIN sale_line_items li ON li.sale_id = s.id
     JOIN products p         ON p.id = li.product_id
     LEFT JOIN cashier_shifts cs ON cs.id = s.shift_id
     LEFT JOIN staff st          ON st.id = cs.staff_id
     WHERE s.shop_id = ?
       AND DATE(s.created_at, 'localtime') >= ?
       AND DATE(s.created_at, 'localtime') <= ?
     ORDER BY s.created_at DESC, li.id ASC`,
    [shopId, range.start, range.end],
  )
  return rows.map(r => ({
    'رقم البيع':        r.display_sale_number,
    'التاريخ':          r.created_at.slice(0, 16).replace('T', ' '),
    'المنتج':           r.product_name,
    'الكمية':           r.qty,
    'سعر الوحدة $':     r.unit_price_usd,
    'سعر الوحدة ل.س':   r.unit_price_syp,
    'إجمالي السطر $':   Number((r.qty * r.unit_price_usd).toFixed(2)),
    'طريقة الدفع':      PAYMENT_LABELS[r.payment_method] ?? r.payment_method,
    'الكاشير':          r.cashier_name ?? '—',
    'إجمالي الفاتورة $': r.total_usd,
  }))
}

type ExpenseRow = {
  expense_date: string
  category: string
  description: string | null
  amount_usd: number
  amount_syp: number
}

export async function fetchExpensesRows(
  range: ExportDateRange,
): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<ExpenseRow>(
    `SELECT expense_date, category, notes AS description, amount_usd,
            CASE WHEN currency = 'SYP' THEN amount ELSE 0 END AS amount_syp
     FROM expenses
     WHERE shop_id = ?
       AND expense_date BETWEEN ? AND ?
     ORDER BY expense_date DESC, created_at DESC`,
    [shopId, range.start, range.end],
  )
  return rows.map(r => ({
    'التاريخ':   r.expense_date,
    'الفئة':     r.category,
    'الوصف':     r.description ?? '',
    'المبلغ $':  r.amount_usd,
    'المبلغ ل.س': r.amount_syp,
  }))
}

type ProductRow = {
  name: string
  barcode: string | null
  sale_price_usd: number
  sale_price_syp: number
  cost_usd: number | null
  current_stock: number
}

export async function fetchProductsRows(): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<ProductRow>(
    `SELECT
       name_ar        AS name,
       barcode,
       price_usd      AS sale_price_usd,
       ROUND(price_usd * COALESCE(
         (SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1), 0)) AS sale_price_syp,
       cost_price_usd AS cost_usd,
       current_stock
     FROM products
     WHERE shop_id = ?
       AND is_active = 1
       AND (deleted = 0 OR deleted IS NULL)
     ORDER BY name_ar ASC`,
    [shopId, shopId],
  )
  return rows.map(r => ({
    'الاسم':          r.name,
    'الباركود':       r.barcode ?? '—',
    'سعر البيع $':    r.sale_price_usd,
    'سعر البيع ل.س':  r.sale_price_syp,
    'التكلفة $':      r.cost_usd ?? '—',
    'المخزون الحالي': r.current_stock,
    'قيمة المخزون $': r.cost_usd != null
      ? Number((r.current_stock * r.cost_usd).toFixed(2))
      : '—',
  }))
}

type CustomerRow = {
  name: string
  phone: string | null
  balance_usd: number
  balance_syp: number
  last_purchase: string | null
}

export async function fetchCustomersRows(): Promise<Record<string, unknown>[]> {
  const { shopId } = useDeviceStore()
  // Use correlated subqueries, NOT joined SUMs. Joining sales AND customer_payments
  // then SUM()-ing fans out (N sales × M payments), inflating both totals.
  const rows = await db.getAll<CustomerRow>(
    `SELECT
       c.name,
       c.phone,
       (COALESCE((SELECT SUM(total_usd)  FROM sales            WHERE customer_id = c.id AND is_credit = 1 AND shop_id = ?), 0)
        - COALESCE((SELECT SUM(amount_usd) FROM customer_payments WHERE customer_id = c.id                   AND shop_id = ?), 0)
        - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id WHERE s.customer_id = c.id AND s.is_credit = 1 AND r.shop_id = ?), 0)) AS balance_usd,
       ROUND(
         (COALESCE((SELECT SUM(total_usd)  FROM sales            WHERE customer_id = c.id AND is_credit = 1 AND shop_id = ?), 0)
          - COALESCE((SELECT SUM(amount_usd) FROM customer_payments WHERE customer_id = c.id                   AND shop_id = ?), 0)
          - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id WHERE s.customer_id = c.id AND s.is_credit = 1 AND r.shop_id = ?), 0))
         * COALESCE((SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1), 0)
       ) AS balance_syp,
       (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id AND shop_id = ?) AS last_purchase
     FROM customers c
     WHERE c.shop_id = ?
       AND (c.deleted = 0 OR c.deleted IS NULL)
     ORDER BY c.name`,
    [shopId, shopId, shopId, shopId, shopId, shopId, shopId, shopId, shopId],
  )
  return rows.map(r => ({
    'الاسم':               r.name,
    'الهاتف':              r.phone ?? '—',
    'الرصيد المستحق $':    r.balance_usd,
    'الرصيد المستحق ل.س':  r.balance_syp,
    'آخر شراء':            r.last_purchase
      ? r.last_purchase.slice(0, 16).replace('T', ' ')
      : '—',
  }))
}
