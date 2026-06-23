import { describe, it, expect } from 'vitest'
import { formatReceiptText } from '../receiptText'

const receipt = {
  saleId: 's1', displaySaleNumber: 'A-000247', shopName: 'محل وافي',
  createdAt: '2026-06-23T10:00:00Z',
  lines: [{ nameAr: 'قهوة', quantity: 2, unitPriceUsd: 1.5, lineTotalUsd: 3 }],
  totalUsd: 3, totalSyp: 43500, exchangeRate: 14500, paymentMethod: 'cash_usd',
} as any

describe('formatReceiptText', () => {
  it('includes shop, number, item, both totals', () => {
    const t = formatReceiptText(receipt)
    expect(t).toContain('محل وافي')
    expect(t).toContain('A-000247')
    expect(t).toContain('قهوة')
    expect(t).toMatch(/3(\.00)?\s*\$|\$\s*3/)
    expect(t).toContain('43,500')
  })

  it('includes a return-policy line when given', () =>
    expect(formatReceiptText(receipt, { returnPolicy: 'الإرجاع خلال ٧ أيام' })).toContain('الإرجاع خلال ٧ أيام'))

  it('shows credit/deferred label for credit payment, no invented balance', () => {
    const t = formatReceiptText({ ...receipt, paymentMethod: 'credit' })
    expect(t).toContain('آجل')
    // Must NOT contain a "رصيد" or "balance" line — there's no balance in ReceiptData
    expect(t).not.toMatch(/رصيد جديد|new balance/i)
  })

  it('shows change line when changeDue is present and > 0', () => {
    const t = formatReceiptText({
      ...receipt,
      amountReceived: 5,
      amountReceivedCurrency: 'USD',
      changeDue: 2,
    })
    expect(t).toMatch(/الباقي|المتبقي|الفكة/)
    expect(t).toContain('$2.00')
  })

  it('formats SYP change in ل.س with thousands grouping, not as USD', () => {
    const t = formatReceiptText({
      ...receipt,
      amountReceived: 20000,
      amountReceivedCurrency: 'SYP',
      changeDue: 5000,
    })
    expect(t).toMatch(/الباقي|المتبقي|الفكة/)
    expect(t).toContain('5,000')
    expect(t).toContain('ل.س')
    expect(t).not.toContain('$5')
  })

  it('includes footerText when present', () => {
    const t = formatReceiptText({ ...receipt, footerText: 'شكراً لزيارتكم' })
    expect(t).toContain('شكراً لزيارتكم')
  })

  it('includes headerText after shop name when present', () => {
    const t = formatReceiptText({ ...receipt, headerText: 'الفرع الرئيسي' })
    expect(t).toContain('الفرع الرئيسي')
  })

  it('lists split payment legs for split method', () => {
    const t = formatReceiptText({
      ...receipt,
      paymentMethod: 'split',
      splitPayments: [
        { method: 'cash_usd', amountUsd: 2 },
        { method: 'cash_syp', amountUsd: 1 },
      ],
    })
    // Arabic label for split appears
    expect(t).toContain('دفع مقسّم')
    // Each leg amount appears
    expect(t).toContain('$2.00')
    expect(t).toContain('$1.00')
  })

  it('marks fully-returned receipts', () => {
    const t = formatReceiptText({ ...receipt, isFullyReturned: true })
    expect(t).toMatch(/مرتجع|مُرتجع/)
  })

  it('shows receipt number prominently (on its own labeled line)', () => {
    const t = formatReceiptText(receipt)
    const lines = t.split('\n')
    const receiptNumLine = lines.find(l => l.includes('A-000247'))
    expect(receiptNumLine).toBeTruthy()
    expect(receiptNumLine).toMatch(/رقم|فاتورة/)
  })
})
