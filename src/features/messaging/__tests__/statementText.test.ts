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

  it('includes final balance owing in plain language (الرصيد المستحق)', () => {
    const t = formatStatementText(baseInput)
    expect(t).toContain('الرصيد المستحق')
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

  it('handles zero rows gracefully — shows greeting, shopName, and zero/own balance', () => {
    const t = formatStatementText({ ...baseInput, rows: [], balanceUsd: 0 })
    expect(t).toContain('أبو محمد')
    expect(t).toContain('محل وافي')
    expect(t).toContain('الرصيد المستحق')
    expect(t).toContain('$0.00')
  })

  it('handles zero balance (fully settled) gracefully', () => {
    const t = formatStatementText({ ...baseInput, balanceUsd: 0 })
    expect(t).toContain('الرصيد المستحق')
    expect(t).toContain('$0.00')
  })

  it('handles a negative balance (credit in customer favour) gracefully', () => {
    const t = formatStatementText({ ...baseInput, balanceUsd: -5.0 })
    expect(t).toContain('الرصيد المستحق')
    // Negative amount must appear
    expect(t).toContain('-$5.00')
  })

  it('row amounts are formatted with $X.XX style (matches receiptText.ts convention)', () => {
    const t = formatStatementText(baseInput)
    // Row amount column: $50.00, $30.00, -$20.00
    expect(t).toContain('$50.00')
    expect(t).toContain('$30.00')
    expect(t).toContain('-$20.00')
  })
})
