/**
 * useSendStatement — compose and send a customer statement via WhatsApp.
 *
 * Pure: no DB calls, no I/O, no Vue reactivity. Rows are assembled from the
 * already-loaded openInvoices (newest-first) returned by useCustomerBalance.
 *
 * Deferred (explicitly out of scope for this task):
 *  - Per-payment history rows (payments are netted into remainingUsd/balanceUsd).
 *  - Strict month-range filtering (statement covers all open invoices to-date).
 *  - Itemised sales lines per invoice (just displayNumber + itemsSummary for now).
 */

import type { OpenInvoice } from '@/features/customers/customer.types'
import { formatStatementText } from './statementText'
import { resolvePhone, openWhatsApp } from './whatsapp'

export interface PrepareStatementInput {
  customerName:  string
  shopName:      string
  /** Caller-supplied label, e.g. "كشف حساب حتى ٢٣/٦/٢٠٢٦". */
  periodLabel:   string
  /** Authoritative total owing from useCustomerBalance. */
  balanceUsd:    number
  /** Newest-first, as returned by useCustomerBalance. */
  openInvoices:  OpenInvoice[]
  /** Raw phone string (customer.phone || customer.mobile). Optional. */
  phoneRaw?:     string
}

export interface PreparedStatement {
  text:  string
  phone: string | null
}

export function useSendStatement() {
  /**
   * Build the WhatsApp statement text and resolve the phone (if supplied).
   * Pure — no DB, no I/O, no new Date().
   */
  function prepare(input: PrepareStatementInput): PreparedStatement {
    const { customerName, shopName, periodLabel, balanceUsd, openInvoices, phoneRaw } = input

    // Reverse to chronological order (oldest → newest).
    const chronological = [...openInvoices].reverse()

    // Compute cumulative running balance.
    let running = 0
    const rows = chronological.map(inv => {
      running += inv.remainingUsd
      // Use only the date portion (YYYY-MM-DD) for a compact display.
      const date = inv.saleDate.slice(0, 10)
      // Optionally append a short itemsSummary if present.
      const label = inv.itemsSummary
        ? `فاتورة ${inv.displayNumber} — ${inv.itemsSummary}`
        : `فاتورة ${inv.displayNumber}`
      return {
        date,
        label,
        amountUsd:  inv.remainingUsd,
        runningUsd: running,
      }
    })

    // Reconcile: if store-credit refunds on cash sales (WAFI-026/027) mean
    // balanceUsd < Σ remainingUsd, append one reconciling row so the running
    // column ends exactly at the authoritative balance.
    const runningTotal = rows.length ? rows[rows.length - 1].runningUsd : 0
    if (Math.abs(balanceUsd - runningTotal) > 0.01) {
      rows.push({
        date:       '',
        label:      'دفعات/إرجاع/رصيد لكم',
        amountUsd:  balanceUsd - runningTotal,
        runningUsd: balanceUsd,
      })
    }

    const text = formatStatementText({
      customerName,
      shopName,
      periodLabel,
      rows,
      balanceUsd,
    })

    const phone = phoneRaw?.trim()
      ? resolvePhone(phoneRaw.trim(), '963')
      : null

    return { text, phone }
  }

  /** Open WhatsApp with the resolved phone and the (possibly edited) text. */
  function send(phone: string, text: string): void {
    openWhatsApp(phone, text)
  }

  return { prepare, send }
}
