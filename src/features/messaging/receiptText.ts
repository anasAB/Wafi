import type { ReceiptData, PaymentMethod } from '@/composables/usePrinter'

/** Formats a number as thousands-grouped Latin digits (locale-stable). */
function fmtSyp(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Formats a USD amount as "$X.XX". */
function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash_usd: 'نقداً (دولار)',
  cash_syp: 'نقداً (ليرة سورية)',
  card:     'بطاقة',
  credit:   'على الحساب (آجل)',
  split:    'دفع مقسّم',
}

function formatDate(iso: string): string {
  // "2026-06-23T10:00:00Z" → "2026-06-23 10:00"
  // Intentionally UTC — Asia/Damascus localization deferred to v1.5.
  const d = new Date(iso)
  const date = d.toISOString().slice(0, 10)
  const time = d.toISOString().slice(11, 16)
  return `${date} ${time}`
}

/**
 * Turns a ReceiptData into Arabic WhatsApp receipt text.
 * Pure function — no I/O, no Vue, no DB.
 */
export function formatReceiptText(
  receipt: ReceiptData,
  opts?: { returnPolicy?: string },
): string {
  const lines: string[] = []

  // ── Header ─────────────────────────────────────────────────────────────────
  if (receipt.isFullyReturned) {
    lines.push('[ مُرتجع ]')
  }

  lines.push(receipt.shopName)
  if (receipt.headerText) lines.push(receipt.headerText)
  if (receipt.taxNumber) lines.push(`الرقم الضريبي: ${receipt.taxNumber}`)
  lines.push('─────────────────────')

  // ── Receipt number + date ──────────────────────────────────────────────────
  lines.push(`رقم الفاتورة: ${receipt.displaySaleNumber}`)
  lines.push(`التاريخ: ${formatDate(receipt.createdAt)}`)
  lines.push('─────────────────────')

  // ── Sale lines ─────────────────────────────────────────────────────────────
  for (const line of receipt.lines) {
    lines.push(`${line.nameAr} × ${line.quantity} = ${fmtUsd(line.lineTotalUsd)}`)
  }
  lines.push('─────────────────────')

  // ── Totals ─────────────────────────────────────────────────────────────────
  lines.push(`الإجمالي: ${fmtUsd(receipt.totalUsd)}`)
  lines.push(`الإجمالي بالليرة: ${fmtSyp(receipt.totalSyp)} ل.س`)
  lines.push(`سعر الصرف: ${fmtSyp(receipt.exchangeRate)} ل.س/$`)
  lines.push('─────────────────────')

  // ── Payment ────────────────────────────────────────────────────────────────
  const payLabel = PAYMENT_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod
  lines.push(`الدفع: ${payLabel}`)

  if (receipt.paymentMethod === 'split' && receipt.splitPayments?.length) {
    for (const leg of receipt.splitPayments) {
      const legLabel = PAYMENT_LABEL[leg.method] ?? leg.method
      lines.push(`  • ${legLabel}: ${fmtUsd(leg.amountUsd)}`)
    }
  }

  if (
    receipt.amountReceived !== undefined &&
    receipt.amountReceived !== null
  ) {
    const curr = receipt.amountReceivedCurrency === 'SYP' ? ' ل.س' : '$'
    const amt =
      receipt.amountReceivedCurrency === 'SYP'
        ? fmtSyp(receipt.amountReceived)
        : receipt.amountReceived.toFixed(2)
    lines.push(`المبلغ المستلم: ${amt}${curr}`)
  }

  if (receipt.changeDue !== undefined && receipt.changeDue > 0) {
    const changeFormatted =
      receipt.amountReceivedCurrency === 'SYP'
        ? `${fmtSyp(receipt.changeDue)} ل.س`
        : fmtUsd(receipt.changeDue)
    lines.push(`الباقي (الفكة): ${changeFormatted}`)
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  if (receipt.footerText || opts?.returnPolicy) {
    lines.push('─────────────────────')
    if (receipt.footerText) lines.push(receipt.footerText)
    if (opts?.returnPolicy) lines.push(opts.returnPolicy)
  }

  return lines.join('\n')
}
