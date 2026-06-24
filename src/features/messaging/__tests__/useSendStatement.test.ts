import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock whatsapp module BEFORE importing useSendStatement
vi.mock('../whatsapp', () => ({
  resolvePhone: vi.fn((raw: string | null | undefined, _cc?: string) => {
    if (!raw) return null
    const d = raw.replace(/\D/g, '')
    return d.length >= 11 ? d : null
  }),
  openWhatsApp: vi.fn(),
}))

import { useSendStatement } from '../useSendStatement'
import { formatStatementText } from '../statementText'
import * as whatsapp from '../whatsapp'
import type { OpenInvoice } from '@/features/customers/customer.types'

// Two open invoices in newest-first order (as useCustomerBalance returns them)
const openInvoices: OpenInvoice[] = [
  {
    saleId:        'sale-002',
    displayNumber: 'A-000002',
    saleDate:      '2026-06-20T10:00:00Z',
    totalUsd:      150,
    remainingUsd:  150,
    itemsSummary:  'تلفاز Samsung',
  },
  {
    saleId:        'sale-001',
    displayNumber: 'A-000001',
    saleDate:      '2026-06-10T08:00:00Z',
    totalUsd:      100,
    remainingUsd:  80,
    itemsSummary:  'شاشة LG',
  },
]

const baseInput = {
  customerName: 'أحمد محمود',
  shopName:     'محل وافي',
  periodLabel:  'كشف حساب حتى ٢٣/٦/٢٠٢٦',
  balanceUsd:   230,
  openInvoices,
}

describe('useSendStatement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('prepare()', () => {
    it('builds rows in chronological order (oldest first — reverses newest-first array)', () => {
      const { prepare } = useSendStatement()
      const { text } = prepare({ ...baseInput })

      // A-000001 (older) must appear before A-000002 (newer) in the text
      const idx1 = text.indexOf('A-000001')
      const idx2 = text.indexOf('A-000002')
      expect(idx1).toBeGreaterThan(-1)
      expect(idx2).toBeGreaterThan(-1)
      expect(idx1).toBeLessThan(idx2)
    })

    it('builds cumulative runningUsd: first row = 80, second row = 80+150 = 230', () => {
      const { prepare } = useSendStatement()
      const { text } = prepare({ ...baseInput })

      // Running balances rendered by formatStatementText as "$80.00" then "$230.00"
      const idx80  = text.indexOf('$80.00')
      const idx230 = text.indexOf('$230.00')
      expect(idx80).toBeGreaterThan(-1)
      expect(idx230).toBeGreaterThan(-1)
      // $80.00 running appears before $230.00 running
      expect(idx80).toBeLessThan(idx230)
    })

    it('produces text via formatStatementText containing the customer name', () => {
      const { prepare } = useSendStatement()
      const { text } = prepare({ ...baseInput })
      expect(text).toContain(baseInput.customerName)
    })

    it('produces text containing the total owing (balanceUsd)', () => {
      const { prepare } = useSendStatement()
      const { text } = prepare({ ...baseInput })
      // formatStatementText renders balanceUsd as "$230.00"
      expect(text).toContain('$230.00')
    })

    it('returns phone=null when no phoneRaw supplied', () => {
      const { prepare } = useSendStatement()
      const { phone } = prepare({ ...baseInput })
      expect(phone).toBeNull()
    })

    it('returns phone=null when phoneRaw is empty string', () => {
      const { prepare } = useSendStatement()
      const { phone } = prepare({ ...baseInput, phoneRaw: '' })
      expect(phone).toBeNull()
    })

    it('returns phone=null for an unresolvable number (too short)', () => {
      const { prepare } = useSendStatement()
      const { phone } = prepare({ ...baseInput, phoneRaw: '123' })
      expect(phone).toBeNull()
    })

    it('resolves a valid international phone number', () => {
      const { prepare } = useSendStatement()
      const { phone } = prepare({ ...baseInput, phoneRaw: '+963912345678' })
      expect(phone).not.toBeNull()
      expect(typeof phone).toBe('string')
    })

    it('calls resolvePhone with the raw phone and country code 963', () => {
      const { prepare } = useSendStatement()
      prepare({ ...baseInput, phoneRaw: '0912345678' })
      expect(whatsapp.resolvePhone).toHaveBeenCalledWith('0912345678', '963')
    })

    it('produces deterministic output matching formatStatementText directly', () => {
      const { prepare } = useSendStatement()
      const { text } = prepare({ ...baseInput })

      // Reconstruct expected rows in chronological order — mirror the implementation
      // which appends itemsSummary when present.
      const sorted = [...openInvoices].reverse()
      let running = 0
      const rows = sorted.map(inv => {
        running += inv.remainingUsd
        const label = inv.itemsSummary
          ? `فاتورة ${inv.displayNumber} — ${inv.itemsSummary}`
          : `فاتورة ${inv.displayNumber}`
        return {
          date:       inv.saleDate.slice(0, 10),
          label,
          amountUsd:  inv.remainingUsd,
          runningUsd: running,
        }
      })
      const expected = formatStatementText({
        customerName: baseInput.customerName,
        shopName:     baseInput.shopName,
        periodLabel:  baseInput.periodLabel,
        rows,
        balanceUsd:   baseInput.balanceUsd,
      })
      expect(text).toBe(expected)
    })

    it('handles an empty openInvoices list gracefully', () => {
      const { prepare } = useSendStatement()
      const { text, phone } = prepare({ ...baseInput, openInvoices: [], balanceUsd: 0 })
      expect(text).toContain(baseInput.customerName)
      expect(phone).toBeNull()
    })

    it('passes negative balanceUsd through — footer shows credit label with positive amount', () => {
      const { prepare } = useSendStatement()
      const { text } = prepare({ ...baseInput, openInvoices: [], balanceUsd: -50 })
      // Sign-aware footer: credit → رصيد لكم لدى المحل: $50.00 (positive)
      expect(text).toContain('رصيد لكم لدى المحل')
      expect(text).toContain('$50.00')
      // Footer line must show positive amount, not leading minus
      expect(text).not.toContain('لدى المحل: -$')
    })

    // ── Reconciling row ───────────────────────────────────────────────────────

    it('appends a reconciling row when Σ remainingUsd ≠ balanceUsd (e.g. store-credit refunds)', () => {
      const { prepare } = useSendStatement()
      // One open invoice with remainingUsd: 100, but authoritative balanceUsd: 70
      // (difference of -30 = credit/refund that created no open invoice)
      const invoices: OpenInvoice[] = [
        {
          saleId:        'sale-001',
          displayNumber: 'A-000001',
          saleDate:      '2026-06-01T08:00:00Z',
          totalUsd:      100,
          remainingUsd:  100,
          itemsSummary:  'بضاعة',
        },
      ]
      const { text } = prepare({
        ...baseInput,
        openInvoices: invoices,
        balanceUsd: 70,
      })

      // The reconciling label must be present
      expect(text).toContain('دفعات/إرجاع/رصيد لكم')

      // The final running balance shown in rows must reach $70.00 (authoritative)
      // $100.00 running from invoice row, then $70.00 after reconciling row
      expect(text).toContain('$100.00')
      expect(text).toContain('$70.00')

      // Footer (sign-aware, positive balance) must also show $70.00
      expect(text).toContain('الرصيد المستحق عليكم: $70.00')
    })

    it('does NOT append a reconciling row when running total already equals balanceUsd', () => {
      const { prepare } = useSendStatement()
      // baseInput: 80 + 150 = 230 = balanceUsd — no reconciling row needed
      const { text } = prepare({ ...baseInput })
      expect(text).not.toContain('دفعات/إرجاع/رصيد لكم')
    })

    // ── Whitespace-only phone → null ──────────────────────────────────────────

    it('returns phone=null when phoneRaw is whitespace-only', () => {
      const { prepare } = useSendStatement()
      const { phone } = prepare({ ...baseInput, phoneRaw: '   ' })
      expect(phone).toBeNull()
    })

    it('returns phone=null when phoneRaw is tab/newline whitespace', () => {
      const { prepare } = useSendStatement()
      const { phone } = prepare({ ...baseInput, phoneRaw: '\t\n' })
      expect(phone).toBeNull()
    })
  })

  describe('send()', () => {
    it('calls openWhatsApp with the phone and text', () => {
      const { send } = useSendStatement()
      send('963912345678', 'كشف حساب')
      expect(whatsapp.openWhatsApp).toHaveBeenCalledWith('963912345678', 'كشف حساب')
    })

    it('calls openWhatsApp exactly once', () => {
      const { send } = useSendStatement()
      send('963912345678', 'some text')
      expect(whatsapp.openWhatsApp).toHaveBeenCalledTimes(1)
    })
  })
})
