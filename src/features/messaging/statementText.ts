/**
 * Turns a customer's credit activity into Arabic WhatsApp statement text.
 * Pure function — no I/O, no Vue, no DB.
 *
 * Rows are assumed to be pre-ordered and to carry a running balance already;
 * this formatter only RENDERS them.
 */

/** Formats a USD amount as "$X,XXX.XX" (locale-stable, thousands-grouped). */
function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `-$${abs}` : `$${abs}`
}

export interface StatementRow {
  date: string
  label: string
  amountUsd: number
  runningUsd: number
}

export interface StatementInput {
  customerName: string
  shopName: string
  periodLabel: string
  rows: StatementRow[]
  balanceUsd: number
}

/**
 * Returns an Arabic WhatsApp statement string for the given customer.
 */
export function formatStatementText(input: StatementInput): string {
  const { customerName, shopName, periodLabel, rows, balanceUsd } = input

  const lines: string[] = []

  // ── Greeting ───────────────────────────────────────────────────────────────
  lines.push(`السلام عليكم ${customerName}،`)
  lines.push(`نُرسل إليكم كشف حسابكم من ${shopName}.`)
  lines.push('─────────────────────')

  // ── Period ─────────────────────────────────────────────────────────────────
  lines.push(`الفترة: ${periodLabel}`)
  lines.push('─────────────────────')

  // ── Transaction rows ────────────────────────────────────────────────────────
  if (rows.length === 0) {
    lines.push('لا توجد حركات في هذه الفترة.')
  } else {
    for (const row of rows) {
      // Short date + label + amount + running balance
      lines.push(`${row.date}  ${row.label}`)
      lines.push(`  المبلغ: ${fmtUsd(row.amountUsd)}   الرصيد: ${fmtUsd(row.runningUsd)}`)
    }
  }
  lines.push('─────────────────────')

  // ── Final balance owing (plain language) ───────────────────────────────────
  lines.push(`الرصيد المستحق: ${fmtUsd(balanceUsd)}`)
  lines.push('─────────────────────')

  // ── Polite closing ─────────────────────────────────────────────────────────
  lines.push(`شكراً لثقتكم بمحل ${shopName}.`)
  lines.push('نتمنى لكم دوام الصحة والعافية.')

  return lines.join('\n')
}
