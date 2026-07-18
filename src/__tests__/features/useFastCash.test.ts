import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useFastCash } from '@/features/payment/useFastCash'
import { useFastCashSettings } from '@/features/payment/useFastCashSettings'
import { useSaleStore } from '@/store/sale.store'
import { db } from '@/data/powersync/db'

// Same transaction harness as usePayment.test.ts: capture tx.execute calls.
function setupTx(stockRow = { cost_price_usd: 4, current_stock: 10 }) {
  const exec = vi.fn().mockImplementation(async (sql: unknown) => {
    if (typeof sql === 'string' && sql.trim().startsWith('SELECT')) {
      return { rows: { _array: [stockRow] } }
    }
    return { rows: { _array: [] } }
  })
  vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: exec }) })
  return exec
}

describe('useFastCash (WAFI-124)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    const store = useSaleStore()
    store.clear()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.setLockedRate(14500)
  })

  it('exact USD cash = one sale_payments leg with zero change, identical shape to the modal flow', async () => {
    const exec = setupTx()
    const { payExactCash } = useFastCash()

    const sale = await payExactCash('USD')

    expect(sale).not.toBeNull()
    expect(sale!.paymentMethod).toBe('cash_usd')
    expect(sale!.changeDue).toBeUndefined()

    const paymentInserts = exec.mock.calls.filter(([sql]) => /INSERT INTO sale_payments/.test(sql as string))
    expect(paymentInserts).toHaveLength(1)
    const params = paymentInserts[0][1] as unknown[]
    expect(params).toContain('cash_usd')
    expect(params).toContain(10)      // amount_raw = exact USD total
    // change_due param is null (exact tender)
    expect(params[8]).toBeNull()
  })

  it('exact SYP cash tenders the rounded whole-number SYP total at the locked rate', async () => {
    const exec = setupTx()
    const { payExactCash } = useFastCash()

    const sale = await payExactCash('SYP')

    expect(sale!.paymentMethod).toBe('cash_syp')
    const params = exec.mock.calls.filter(([sql]) => /INSERT INTO sale_payments/.test(sql as string))[0][1] as unknown[]
    expect(params).toContain('cash_syp')
    expect(params).toContain(145000)  // 10 USD × 14500, whole SYP
    expect(params).toContain('SYP')
  })

  it('blocked on empty cart / zero total', async () => {
    useSaleStore().clear()
    const { payExactCash } = useFastCash()
    expect(await payExactCash('USD')).toBeNull()
  })

  it('SYP fast tender refuses when no rate is locked', async () => {
    setActivePinia(createPinia())
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'م', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    // no setLockedRate
    const { payExactCash } = useFastCash()
    expect(await payExactCash('SYP')).toBeNull()
  })

  it('double-tap = one sale (busy guard)', async () => {
    const exec = setupTx()
    const { payExactCash } = useFastCash()

    const [first, second] = await Promise.all([payExactCash('USD'), payExactCash('USD')])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    const saleInserts = exec.mock.calls.filter(([sql]) => /INSERT INTO sales /.test(sql as string))
    expect(saleInserts).toHaveLength(1)
  })
})

describe('useFastCashSettings (WAFI-124)', () => {
  beforeEach(() => { localStorage.clear() })

  it('defaults: both buttons, SYP first', () => {
    const { fastButtons } = useFastCashSettings()
    expect(fastButtons.value).toEqual(['SYP', 'USD'])
  })

  it('order and visibility follow the stored setting', async () => {
    const { settings, fastButtons } = useFastCashSettings()
    settings.value.sypFirst = false
    expect(fastButtons.value).toEqual(['USD', 'SYP'])
    settings.value.showUsd = false
    expect(fastButtons.value).toEqual(['SYP'])
  })

  it('persists across instances', async () => {
    const a = useFastCashSettings()
    a.settings.value.showSyp = false
    await Promise.resolve() // let the deep watcher flush
    await new Promise(r => setTimeout(r))
    const b = useFastCashSettings()
    expect(b.fastButtons.value).toEqual(['USD'])
  })
})
