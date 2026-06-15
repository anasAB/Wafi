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
             expUsdRow, expSypRow, refundUsdRow, refundSypRow] =
        await Promise.all([
          db.getOptional<{ count: number }>(
            `SELECT COUNT(*) as count FROM sales WHERE shift_id = ?`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales WHERE shift_id = ?`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_usd), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shift_id = ? AND sp.method = 'cash_usd'`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_raw), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shift_id = ? AND sp.method = 'cash_syp'`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(sp.amount_usd), 0) as total
             FROM sale_payments sp JOIN sales s ON sp.sale_id = s.id
             WHERE s.shift_id = ? AND sp.method = 'card'`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales
             WHERE shift_id = ? AND is_credit = 1`,
            [shift.id]
          ),
          // Cash expenses, split by currency so each hits the right drawer.
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
          // Cash refunds paid out this shift, by currency.
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(refund_amount_usd), 0) as total FROM returns
             WHERE shift_id = ? AND refund_method = 'cash_usd'`,
            [shift.id]
          ),
          db.getOptional<{ total: number }>(
            `SELECT COALESCE(SUM(refund_amount_syp), 0) as total FROM returns
             WHERE shift_id = ? AND refund_method = 'cash_syp'`,
            [shift.id]
          ),
        ])

      const cashUsdSales    = cashUsdRow?.total    ?? 0
      const cashSypSalesRaw = cashSypRow?.total    ?? 0
      const cashExpensesUsd = expUsdRow?.total     ?? 0
      const cashExpensesSyp = expSypRow?.total     ?? 0
      const cashRefundsUsd  = refundUsdRow?.total  ?? 0
      const cashRefundsSyp  = refundSypRow?.total  ?? 0

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
      `- مصاريف نقدية: ${fmtUsd(m.cashExpensesUsd)}`,
      ...(m.cashRefundsUsd > 0 ? [`- مرتجعات نقدية: ${fmtUsd(m.cashRefundsUsd)}`] : []),
      `= متوقع:        ${fmtUsd(m.expectedUsd)}`,
      `عند العد:       ${fmtUsd(m.actualUsd)}`,
      `الفرق:          ${varUsd >= 0 ? '+' : ''}${fmtUsd(varUsd)}${varUsd < 0 ? ' !!!' : ''}`,
      '',
      `نقد ليرة مبيعات: ${fmtSyp(m.cashSypSalesRaw)}`,
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
