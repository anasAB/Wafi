import { ref }               from 'vue'
import { db }                from '@/data/powersync/db'
import { useDeviceStore }    from '@/store/device.store'
import { computeCashReconciliation } from './cashReconciliation'
import type { CashierShift, ZReportMetrics } from '../shift.types'

export function useZReport() {
  const metrics = ref<ZReportMetrics | null>(null)
  const loading = ref(false)
  const error   = ref<string | null>(null)

  async function compute(
    shift: CashierShift,
    closingCashUsd: number,
    closingCashSyp: number
  ): Promise<ZReportMetrics> {
    const device   = useDeviceStore()
    const closedAt = new Date().toISOString()
    loading.value  = true
    error.value    = null
    try {
      const [countRow, revenueRow, cashUsdRow, cashSypRow, cardRow, creditRow,
             expUsdRow, expSypRow, refundUsdRow, refundSypRow,
             creditPayUsdRow, creditPaySypRow] =
        await Promise.all([
          // Scope sales/payments by this DEVICE + the shift's time window (open →
          // close). The time window (rather than shift_id) catches sales rung
          // before a shift was opened — those carry a null shift_id and would
          // otherwise be dropped. The device_id filter prevents a second register's
          // overlapping shift from being double-counted into this Z-report.
          db.getOptional<{ count: number }>(
            `SELECT COUNT(*) as count FROM sales WHERE shop_id = ? AND device_id = ? AND created_at BETWEEN ? AND ?`,
            [device.shopId, shift.deviceId, shift.openedAt, closedAt]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales WHERE shop_id = ? AND device_id = ? AND created_at BETWEEN ? AND ?`,
            [device.shopId, shift.deviceId, shift.openedAt, closedAt]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_usd), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shop_id = ? AND s.device_id = ? AND s.created_at BETWEEN ? AND ? AND sp.method = 'cash_usd'`,
            [device.shopId, shift.deviceId, shift.openedAt, closedAt]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_raw), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shop_id = ? AND s.device_id = ? AND s.created_at BETWEEN ? AND ? AND sp.method = 'cash_syp'`,
            [device.shopId, shift.deviceId, shift.openedAt, closedAt]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_usd), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shop_id = ? AND s.device_id = ? AND s.created_at BETWEEN ? AND ? AND sp.method = 'card'`,
            [device.shopId, shift.deviceId, shift.openedAt, closedAt]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales
             WHERE shop_id = ? AND device_id = ? AND created_at BETWEEN ? AND ? AND is_credit = 1`,
            [device.shopId, shift.deviceId, shift.openedAt, closedAt]
          ),
          // Cash expenses, split by currency so each hits the right drawer.
          // NOTE: the `expenses` table has no device_id or shift_id, so in a
          // multi-device shop a cash expense can only be attributed by time window
          // and may be counted by more than one open shift. Disambiguating needs a
          // schema change (add shift_id/device_id to expenses).
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(amount_usd), 0) as total FROM expenses
             WHERE shop_id = ? AND paid_in_cash = 1 AND currency = 'USD' AND created_at BETWEEN ? AND ?`,
            [device.shopId, shift.openedAt, closedAt]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
             WHERE shop_id = ? AND paid_in_cash = 1 AND currency = 'SYP' AND created_at BETWEEN ? AND ?`,
            [device.shopId, shift.openedAt, closedAt]
          ),
          // Cash refunds paid out this shift, by currency. Returns carry shift_id
          // (set to the open shift at refund time), so scope by it directly.
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(refund_amount_usd), 0) as total FROM returns
             WHERE shop_id = ? AND shift_id = ? AND refund_method = 'cash_usd'`,
            [device.shopId, shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(refund_amount_syp), 0) as total FROM returns
             WHERE shop_id = ? AND shift_id = ? AND refund_method = 'cash_syp'`,
            [device.shopId, shift.id]
          ),
          // Cash collected against customer credit this shift, by currency. Only
          // method='cash' enters the drawer (wire/USDT/hawala do not). Like
          // expenses, customer_payments has no device/shift link, so attribute by
          // time window — same multi-device caveat applies.
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(amount_usd), 0) as total FROM customer_payments
             WHERE shop_id = ? AND method = 'cash' AND currency = 'USD' AND created_at BETWEEN ? AND ?`,
            [device.shopId, shift.openedAt, closedAt]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(amount_raw), 0) as total FROM customer_payments
             WHERE shop_id = ? AND method = 'cash' AND currency = 'SYP' AND created_at BETWEEN ? AND ?`,
            [device.shopId, shift.openedAt, closedAt]
          ),
        ])

      const cashUsdSales          = cashUsdRow?.total       ?? 0
      const cashSypSalesRaw       = cashSypRow?.total       ?? 0
      const cashExpensesUsd       = expUsdRow?.total        ?? 0
      const cashExpensesSyp       = expSypRow?.total        ?? 0
      const cashRefundsUsd        = refundUsdRow?.total     ?? 0
      const cashRefundsSyp        = refundSypRow?.total     ?? 0
      const cashCreditPaymentsUsd = creditPayUsdRow?.total  ?? 0
      const cashCreditPaymentsSyp = creditPaySypRow?.total  ?? 0

      const recon = computeCashReconciliation({
        openingCashUsd: shift.openingCashUsd,
        cashUsdSales,
        cashExpensesUsd,
        closingCashUsd,
        cashSypSalesRaw,
        closingCashSyp,
        cashExpensesSyp,
        cashRefundsUsd,
        cashRefundsSyp,
        cashCreditPaymentsUsd,
        cashCreditPaymentsSyp,
      })

      const durationMs = new Date(closedAt).getTime() - new Date(shift.openedAt).getTime()

      const result: ZReportMetrics = {
        invoiceCount:    countRow?.count   ?? 0,
        totalRevenueUsd: revenueRow?.total ?? 0,
        cashUsdSales,
        cashSypSalesRaw,
        cardSales:       cardRow?.total    ?? 0,
        creditSales:     creditRow?.total  ?? 0,
        cashExpensesUsd,
        cashExpensesSyp,
        cashRefundsUsd,
        cashRefundsSyp,
        cashCreditPaymentsUsd,
        cashCreditPaymentsSyp,
        expectedUsd:     recon.expectedUsd,
        actualUsd:       closingCashUsd,
        varianceUsd:     recon.varianceUsd,
        expectedSyp:     recon.expectedSyp,
        actualSyp:       closingCashSyp,
        varianceSyp:     recon.varianceSyp,
        durationMinutes: Math.floor(durationMs / 60_000),
      }

      metrics.value = result
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  function printZReport(
    shift: CashierShift,
    staffName: string,
    deviceCode: string,
    m: ZReportMetrics
  ): void {
    const hours    = Math.floor(m.durationMinutes / 60)
    const mins     = m.durationMinutes % 60
    const duration = hours > 0 ? `${hours}س ${mins}د` : `${mins}د`
    const fmtUsd   = (n: number) => `$${n.toFixed(2)}`
    const fmtSyp   = (n: number) => `${n.toLocaleString()} ل.س`
    const varUsd   = m.varianceUsd
    const varSyp   = m.varianceSyp

    const lines = [
      '================================',
      '         تقرير الوردية',
      '================================',
      `الكاشير:   ${staffName}`,
      `الجهاز:    ${deviceCode}`,
      `فتح:       ${new Date(shift.openedAt).toLocaleTimeString('ar-SY')}`,
      `إغلاق:     ${new Date().toLocaleTimeString('ar-SY')}`,
      `المدة:     ${duration}`,
      '--------------------------------',
      '          المبيعات',
      '--------------------------------',
      `عدد الفواتير:   ${m.invoiceCount}`,
      `إجمالي:         ${fmtUsd(m.totalRevenueUsd)}`,
      '--------------------------------',
      '     تفصيل طريقة الدفع',
      '--------------------------------',
      `نقد دولار:      ${fmtUsd(m.cashUsdSales)}`,
      `نقد ليرة:       ${fmtSyp(m.cashSypSalesRaw)}`,
      `بطاقة:          ${fmtUsd(m.cardSales)}`,
      `آجل (دين):      ${fmtUsd(m.creditSales)}`,
      '--------------------------------',
      '         المصاريف',
      '--------------------------------',
      `مصاريف الوردية: ${fmtUsd(m.cashExpensesUsd)}`,
      '--------------------------------',
      '       حساب الصندوق',
      '--------------------------------',
      `رصيد الفتح:     ${fmtUsd(shift.openingCashUsd)}`,
      `+ نقد مبيعات:   ${fmtUsd(m.cashUsdSales)}`,
      ...(m.cashCreditPaymentsUsd > 0 ? [`+ تحصيل ديون:   ${fmtUsd(m.cashCreditPaymentsUsd)}`] : []),
      `- مصاريف نقدية: ${fmtUsd(m.cashExpensesUsd)}`,
      ...(m.cashRefundsUsd > 0 ? [`- مرتجعات نقدية: ${fmtUsd(m.cashRefundsUsd)}`] : []),
      `= متوقع:        ${fmtUsd(m.expectedUsd)}`,
      `عند العد:       ${fmtUsd(m.actualUsd)}`,
      `الفرق:          ${varUsd >= 0 ? '+' : ''}${fmtUsd(varUsd)}${varUsd < 0 ? ' !!!' : ''}`,
      '',
      `نقد ليرة مبيعات: ${fmtSyp(m.cashSypSalesRaw)}`,
      ...(m.cashCreditPaymentsSyp > 0 ? [`+ تحصيل ديون ليرة: ${fmtSyp(m.cashCreditPaymentsSyp)}`] : []),
      ...(m.cashExpensesSyp > 0 ? [`- مصاريف ليرة:  ${fmtSyp(m.cashExpensesSyp)}`] : []),
      ...(m.cashRefundsSyp > 0 ? [`- مرتجعات ليرة: ${fmtSyp(m.cashRefundsSyp)}`] : []),
      `ليرة متوقع:     ${fmtSyp(m.expectedSyp)}`,
      `ليرة عند العد:  ${fmtSyp(m.actualSyp)}`,
      `فرق الليرة:     ${varSyp >= 0 ? '+' : ''}${fmtSyp(varSyp)}`,
      '================================',
    ]

    const html = `<html dir="rtl"><head><style>
      body { font-family: monospace; font-size: 12px; white-space: pre; margin: 8px; }
      @media print { @page { margin: 5mm; } }
    </style></head><body>${lines.join('\n')}</body></html>`

    const w = window.open('', '_blank', 'width=400,height=650')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return { metrics, loading, error, compute, printZReport }
}
