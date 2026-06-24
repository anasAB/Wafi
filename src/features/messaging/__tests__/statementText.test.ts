import { describe, it, expect } from 'vitest'
import { formatStatementText } from '../statementText'

const baseInput = {
  customerName: 'أبو محمد',
  shopName: 'محل وافي',
  periodLabel: 'يونيو 2026',
  rows: [
    { date: '2026-06-01', label: 'بيع بالآجل', amountUsd: 50.0,   runningUsd: 50.0   },
    { date: '2026-06-10', label: 'بيع بالآجل', amountUsd: 30.0,   runningUsd: 80.0   },
    { date: '2026-06-15', label: 'دفعة',        amountUsd: -20.0,  runningUsd: 60.0   },
  ],
  balanceUsd: 60.0,
}

describe('formatStatementText', () => {
  it('includes a greeting with the customerName', () => {
    const t = formatStatementText(baseInput)
    expect(t).toContain('أبو محمد')
  })

  it('includes the shopName', () => {
    const t = formatStatementText(baseInput)
    expect(t).toContain('محل وافي')
  })

  it('includes the periodLabel', () => {
    const t = formatStatementText(baseInput)
    expect(t).toContain('يونيو 2026')
  })

  it('includes one line per row with its date and label', () => {
    const t = formatStatementText(baseInput)
    expect(t).toContain('2026-06-01')
    expect(t).toContain('2026-06-10')
    expect(t).toContain('2026-06-15')
    expect(t).toContain('بيع بالآجل')
    expect(t).toContain('دفعة')
  })

  it('includes the running balance for each row', () => {
    const t = formatStatementText(baseInput)
    // Running balances $50.00, $80.00, $60.00 must appear
    expect(t).toContain('$50.00')
    expect(t).toContain('$80.00')
    expect(t).toContain('$60.00')
  })

  it('includes final balance owing in plain language (الرصيد المستحق عليكم) for positive balance', () => {
    const t = formatStatementText(baseInput)
    // baseInput.balanceUsd = 60.0 → customer owes → "الرصيد المستحق عليكم"
    expect(t).toContain('الرصيد المستحق عليكم')
    expect(t).toContain('$60.00')
  })

  it('uses locale-stable thousands-grouped formatting for large running balance', () => {
    const input = {
      ...baseInput,
      rows: [
        { date: '2026-06-01', label: 'بيع بالآجل', amountUsd: 1500.0,  runningUsd: 1500.0  },
        { date: '2026-06-05', label: 'بيع بالآجل', amountUsd: 500.0,   runningUsd: 2000.0  },
      ],
      balanceUsd: 2000.0,
    }
    const t = formatStatementText(input)
    // $2,000.00 or similar — must not be "$2000.00" (no thousands separator)
    expect(t).toContain('$2,000.00')
    expect(t).toContain('$1,500.00')
  })

  it('includes a polite closing', () => {
    const t = formatStatementText(baseInput)
    // Some form of thanks / polite Arabic closing
    expect(t).toMatch(/شكر|حفظك|تحياتنا|وافي|بخير/)
  })

  it('handles zero rows gracefully — shows greeting, shopName, and settled message', () => {
    const t = formatStatementText({ ...baseInput, rows: [], balanceUsd: 0 })
    expect(t).toContain('أبو محمد')
    expect(t).toContain('محل وافي')
    // Zero balance → settled label, no amount
    expect(t).toContain('مسوّى')
  })

  it('handles zero balance (fully settled) gracefully', () => {
    const t = formatStatementText({ ...baseInput, balanceUsd: 0 })
    // Zero balance → settled label
    expect(t).toContain('مسوّى')
    // Footer must not contain an amount line
    expect(t).not.toContain('الرصيد المستحق عليكم')
    expect(t).not.toContain('رصيد لكم لدى المحل')
  })

  it('handles a negative balance (credit in customer favour) gracefully', () => {
    const t = formatStatementText({ ...baseInput, balanceUsd: -5.0 })
    // Negative balance → credit label with POSITIVE display amount
    expect(t).toContain('رصيد لكم لدى المحل')
    expect(t).toContain('$5.00')
    // Must NOT show a leading minus in the footer amount
    expect(t).not.toContain('لدى المحل: -$')
  })

  it('row amounts are formatted with $X.XX style (matches receiptText.ts convention)', () => {
    const t = formatStatementText(baseInput)
    // Row amount column: $50.00, $30.00, -$20.00
    expect(t).toContain('$50.00')
    expect(t).toContain('$30.00')
    expect(t).toContain('-$20.00')
  })

  // ── Sign-aware footer label — three states ─────────────────────────────────

  it('footer: positive balance → الرصيد المستحق عليكم with amount', () => {
    const t = formatStatementText({ ...baseInput, balanceUsd: 120.5 })
    expect(t).toContain('الرصيد المستحق عليكم: $120.50')
    expect(t).not.toContain('مسوّى')
    expect(t).not.toContain('رصيد لكم')
  })

  it('footer: exactly-zero balance → الحساب مسوّى ✓ with no amount', () => {
    const t = formatStatementText({ ...baseInput, balanceUsd: 0 })
    expect(t).toContain('الحساب مسوّى ✓')
    expect(t).not.toContain('الرصيد المستحق عليكم')
    expect(t).not.toContain('رصيد لكم')
  })

  it('footer: negative balance → رصيد لكم لدى المحل with POSITIVE amount (no leading -)', () => {
    const t = formatStatementText({ ...baseInput, balanceUsd: -50.0 })
    expect(t).toContain('رصيد لكم لدى المحل: $50.00')
    // Must not show "-$50.00" in the footer line
    expect(t).not.toContain('لدى المحل: -$')
    expect(t).not.toContain('مسوّى')
    expect(t).not.toContain('الرصيد المستحق عليكم')
  })

  // ── Empty-date row renders without stray leading whitespace ─────────────────

  it('a row with empty date renders its label without a stray leading space or date prefix', () => {
    const input = {
      ...baseInput,
      rows: [
        { date: '2026-06-01', label: 'فاتورة A-001', amountUsd: 100, runningUsd: 100 },
        { date: '',           label: 'دفعات/إرجاع/رصيد لكم', amountUsd: -30, runningUsd: 70 },
      ],
      balanceUsd: 70,
    }
    const t = formatStatementText(input)
    // The reconciling label must appear
    expect(t).toContain('دفعات/إرجاع/رصيد لكم')
    // Must NOT start with leading spaces before the label
    const lines = t.split('\n')
    const labelLine = lines.find(l => l.includes('دفعات/إرجاع/رصيد لكم'))
    expect(labelLine).toBeDefined()
    // The label line itself must not start with spaces (no stray date prefix)
    expect(labelLine!.startsWith(' ')).toBe(false)
    // Must not have "  " (two spaces = leftover date separator) before the label
    expect(labelLine).not.toMatch(/^\s{2,}/)
  })
})
