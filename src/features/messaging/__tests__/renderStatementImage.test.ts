import { describe, expect, it } from 'vitest'
import { renderStatementImage } from '../renderStatementImage'

describe('renderStatementImage', () => {
  it('returns a non-empty PNG data URL for a sample statement', async () => {
    const result = await renderStatementImage({
      shopName: 'محل وافي',
      customerName: 'أحمد محمود',
      periodLabel: 'كشف حساب حتى 13/07/2026',
      balanceUsd: 230,
      rows: [
        {
          date: '2026-07-01',
          label: 'فاتورة A-000001 — شاشة LG',
          amountUsd: 80,
          runningUsd: 80,
        },
        {
          date: '2026-07-09',
          label: 'فاتورة A-000002 — تلفاز Samsung',
          amountUsd: 150,
          runningUsd: 230,
        },
      ],
    })

    expect(result.startsWith('data:image/png;base64,')).toBe(true)
    expect(result.length).toBeGreaterThan(64)
  })
})
