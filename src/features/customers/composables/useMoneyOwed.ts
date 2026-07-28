import { ref } from 'vue'
import { useDeviceStore } from '@/store/device.store'
import { fetchCreditDebtors } from './creditDebtors'
import { fetchPendingInstallmentDues } from '@/features/installments/composables/installmentDues'

// WAFI-017. Combines credit + installments into one per-customer "money
// owed" row with a shared aging bucket. Depends on the plain data-access
// helpers (fetchCreditDebtors, fetchPendingInstallmentDues), not on
// useCollectionsWorklist()/useInstallmentsDueAlert() — see the design doc's
// §4 reuse-mechanism decision: a business/aggregation composable must not
// depend on UI-oriented composables that are free to grow UI-only concerns
// (search, pagination, selection state) later.

export type AgingBucket = '0_30' | '31_60' | '60_plus'

export interface MoneyOwedRow {
  customerId: string
  customerName: string
  creditOwedUsd: number
  installmentOwedUsd: number
  totalOwedUsd: number
  ageDays: number
  bucket: AgingBucket
}

export type MoneyOwedTotals = Record<AgingBucket, number> & { grandTotal: number }

// "Today" = the device's local calendar day — same convention dueBucket()
// and periodUtils.ts already use (see design doc §0). Calendar-day diff on
// date-only strings, not a full-timestamp diff (that's `daysBetween` in
// creditDebtors.ts, reused verbatim for the credit component's age instead
// of being recomputed here).
function calendarDaysBetween(fromDateStr: string, todayDateStr: string): number {
  const from = new Date(fromDateStr + 'T00:00:00')
  const today = new Date(todayDateStr + 'T00:00:00')
  const ms = today.getTime() - from.getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 30) return '0_30'
  if (ageDays <= 60) return '31_60'
  return '60_plus'
}

export function useMoneyOwed() {
  const rows = ref<MoneyOwedRow[]>([])
  const totals = ref<MoneyOwedTotals>({ '0_30': 0, '31_60': 0, '60_plus': 0, grandTotal: 0 })

  async function load() {
    const device = useDeviceStore()
    const shopId = device.shopId
    const today = new Date().toISOString().slice(0, 10)

    const [debtors, dues] = await Promise.all([
      fetchCreditDebtors(shopId),
      fetchPendingInstallmentDues(shopId),
    ])

    // Only pending dues at or past their due date count as currently owed
    // (bucket 'due' or 'overdue') — a not-yet-due installment is scheduled,
    // not currently collectible (design doc §3).
    const qualifyingDues = dues.filter(d => d.bucket === 'due' || d.bucket === 'overdue')

    type InstallmentAgg = { customerName: string; owedUsd: number; oldestDueDate: string }
    const installmentByCustomer = new Map<string, InstallmentAgg>()
    for (const due of qualifyingDues) {
      const remaining = due.amountDueUsd - due.amountPaidUsd
      const existing = installmentByCustomer.get(due.customerId)
      if (!existing) {
        installmentByCustomer.set(due.customerId, {
          customerName: due.customerName,
          owedUsd: remaining,
          oldestDueDate: due.dueDate,
        })
      } else {
        existing.owedUsd += remaining
        if (due.dueDate < existing.oldestDueDate) existing.oldestDueDate = due.dueDate
      }
    }

    const built: MoneyOwedRow[] = []
    const seenCustomerIds = new Set<string>()

    for (const debtor of debtors) {
      if (debtor.balanceUsd <= 0.001) continue // shop-owes-customer rows aren't "money owed"
      seenCustomerIds.add(debtor.customerId)

      const installment = installmentByCustomer.get(debtor.customerId)
      const creditOwedUsd = debtor.balanceUsd
      const installmentOwedUsd = installment?.owedUsd ?? 0
      const totalOwedUsd = creditOwedUsd + installmentOwedUsd
      if (totalOwedUsd <= 0.001) continue

      const creditAge = debtor.daysOutstanding
      const installmentAge = installment
        ? calendarDaysBetween(installment.oldestDueDate, today)
        : 0
      const ageDays = Math.max(creditAge, installmentAge)

      built.push({
        customerId: debtor.customerId,
        customerName: debtor.customerName,
        creditOwedUsd,
        installmentOwedUsd,
        totalOwedUsd,
        ageDays,
        bucket: bucketFor(ageDays),
      })
    }

    // Installment-only debtors (no credit balance at all, so not present in
    // fetchCreditDebtors' results — that helper only returns customers with a
    // non-zero credit balance).
    for (const [customerId, installment] of installmentByCustomer) {
      if (seenCustomerIds.has(customerId)) continue
      if (installment.owedUsd <= 0.001) continue

      const ageDays = calendarDaysBetween(installment.oldestDueDate, today)
      built.push({
        customerId,
        customerName: installment.customerName,
        creditOwedUsd: 0,
        installmentOwedUsd: installment.owedUsd,
        totalOwedUsd: installment.owedUsd,
        ageDays,
        bucket: bucketFor(ageDays),
      })
    }

    rows.value = built

    const t: MoneyOwedTotals = { '0_30': 0, '31_60': 0, '60_plus': 0, grandTotal: 0 }
    for (const row of built) {
      t[row.bucket] += row.totalOwedUsd
      t.grandTotal += row.totalOwedUsd
    }
    totals.value = t
  }

  return { rows, totals, load }
}
