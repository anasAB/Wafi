import type { TermFrequency } from './installment.types'

export interface InstallmentDueSeed {
  dueDate:      string   // YYYY-MM-DD
  amountDueUsd: number
}

function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addPeriod(date: Date, frequency: TermFrequency): Date {
  const d = new Date(date)
  if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7)
  } else {
    // Handle end-of-month overflow: clamp day to max day of target month
    const originalDay = d.getDate()
    const currentYear = d.getFullYear()
    const currentMonth = d.getMonth()
    // Calculate target month and year
    const targetMonth = currentMonth + 1
    const targetYear = targetMonth === 12 ? currentYear + 1 : currentYear
    const normalizedTargetMonth = targetMonth % 12
    // Get max day in target month
    const maxDayInTargetMonth = new Date(targetYear, normalizedTargetMonth + 1, 0).getDate()
    // Clamp original day to max day in target month
    const clampedDay = Math.min(originalDay, maxDayInTargetMonth)
    d.setFullYear(targetYear, normalizedTargetMonth, clampedDay)
  }
  return d
}

/**
 * Generate the even-split due schedule for an installment plan. The financed
 * amount (total - down payment) is split evenly across term_count dues; any
 * rounding remainder is absorbed into the LAST installment so the schedule
 * always sums exactly to the financed amount.
 */
export function generateInstallmentSchedule(
  totalAmountUsd: number,
  downPaymentUsd: number,
  termCount: number,
  termFrequency: TermFrequency,
  startDate: string,
): InstallmentDueSeed[] {
  if (termCount <= 0 || !Number.isInteger(termCount)) {
    throw new Error('term_count must be a positive integer')
  }

  const financed = Math.round((totalAmountUsd - downPaymentUsd) * 100) / 100
  const baseCents = Math.floor((financed * 100) / termCount)
  const base = baseCents / 100
  const lastAmount = Math.round((financed - base * (termCount - 1)) * 100) / 100

  const [y, m, d] = startDate.split('-').map(Number)
  let due = new Date(y, m - 1, d)

  const dues: InstallmentDueSeed[] = []
  for (let i = 0; i < termCount; i++) {
    dues.push({
      dueDate: toIsoDate(due),
      amountDueUsd: i === termCount - 1 ? lastAmount : base,
    })
    due = addPeriod(due, termFrequency)
  }
  return dues
}
