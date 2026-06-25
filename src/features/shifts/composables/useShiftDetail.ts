import { db }            from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { CashierShift } from '../shift.types'

/** A sale rung during the shift (drill-down list row). */
export interface ShiftSale {
  id:            string
  displayNumber: string
  createdAt:     string
  totalUsd:      number
  paymentMethod: string
  staffId:       string | null
}

/** A cash/non-cash expense logged during the shift window. */
export interface ShiftExpense {
  id:        string
  category:  string
  amount:    number
  currency:  string
  amountUsd: number
  createdAt: string
}

/** A customer credit payment recorded during the shift window. */
export interface ShiftPayment {
  id:           string
  customerName: string | null
  amountRaw:    number
  currency:     string
  method:       string
  amountUsd:    number
  createdAt:    string
}

export interface ShiftDetailData {
  sales:    ShiftSale[]
  expenses: ShiftExpense[]
  payments: ShiftPayment[]
}

/**
 * Loads the sales / expenses / customer-payments that belong to a shift, for the
 * history drill-down (WAFI-061, epic Screen 9). Scoped exactly like the Z-report:
 * sales by device + the shift's time window (open → close, or → now while open),
 * which catches sales rung before the shift_id link existed; expenses/payments by
 * time window (those tables carry no device/shift id — same multi-device caveat the
 * Z-report documents). Read-only — never mutates the shift.
 */
export function useShiftDetail() {
  const device = useDeviceStore()

  async function loadDetail(shift: CashierShift): Promise<ShiftDetailData> {
    const start = shift.openedAt
    const end   = shift.closedAt ?? new Date().toISOString()

    const [saleRows, expenseRows, paymentRows] = await Promise.all([
      db.getAll<any>(
        `SELECT id, display_sale_number, created_at, total_usd, payment_method, staff_id
         FROM sales
         WHERE shop_id = ? AND device_id = ? AND created_at BETWEEN ? AND ?
         ORDER BY created_at DESC`,
        [device.shopId, shift.deviceId, start, end]
      ),
      db.getAll<any>(
        `SELECT id, category, amount, currency, amount_usd, created_at
         FROM expenses
         WHERE shop_id = ? AND created_at BETWEEN ? AND ?
         ORDER BY created_at DESC`,
        [device.shopId, start, end]
      ),
      db.getAll<any>(
        `SELECT cp.id, cp.amount_raw, cp.currency, cp.method, cp.amount_usd, cp.created_at,
                c.name AS customer_name
         FROM customer_payments cp
         LEFT JOIN customers c ON c.id = cp.customer_id
         WHERE cp.shop_id = ? AND cp.created_at BETWEEN ? AND ?
         ORDER BY cp.created_at DESC`,
        [device.shopId, start, end]
      ),
    ])

    return {
      sales: saleRows.map(r => ({
        id:            r.id,
        displayNumber: r.display_sale_number,
        createdAt:     r.created_at,
        totalUsd:      r.total_usd ?? 0,
        paymentMethod: r.payment_method,
        staffId:       r.staff_id ?? null,
      })),
      expenses: expenseRows.map(r => ({
        id:        r.id,
        category:  r.category,
        amount:    r.amount ?? 0,
        currency:  r.currency,
        amountUsd: r.amount_usd ?? 0,
        createdAt: r.created_at,
      })),
      payments: paymentRows.map(r => ({
        id:           r.id,
        customerName: r.customer_name ?? null,
        amountRaw:    r.amount_raw ?? 0,
        currency:     r.currency,
        method:       r.method,
        amountUsd:    r.amount_usd ?? 0,
        createdAt:    r.created_at,
      })),
    }
  }

  return { loadDetail }
}
