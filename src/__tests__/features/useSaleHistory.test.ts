import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
const { printSpy } = vi.hoisted(() => ({ printSpy: vi.fn() }))
vi.mock('@/composables/usePrinter', () => ({
  usePrinter: () => ({ print: printSpy, error: { value: null } }),
}))

import { useSaleHistory, buildReceiptData } from '@/features/sale-history/useSaleHistory'
import { db } from '@/data/powersync/db'

describe('useSaleHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('loadHistory without dateRange queries last 7 days using created_at >=', async () => {
    const { loadHistory } = useSaleHistory()
    await loadHistory()
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('created_at >='),
      expect.any(Array)
    )
  })

  it('loadHistory with dateRange queries using BETWEEN', async () => {
    const { loadHistory } = useSaleHistory()
    await loadHistory({ start: '2025-01-01', end: '2025-01-31' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('BETWEEN'),
      expect.arrayContaining(['2025-01-01', '2025-01-31'])
    )
  })

  it('flags hasReturn and isFullyReturned from the returns query', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [
        { id: 's1', total_usd: 75 },
        { id: 's2', total_usd: 50 },
        { id: 's3', total_usd: 30 },
      ] } } as any) // sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // ps_crud (pending)
      .mockResolvedValueOnce({ rows: { _array: [
        { sale_id: 's1' },
        { sale_id: 's2' },
      ] } } as any) // returned sales
      .mockResolvedValueOnce({ rows: { _array: [
        { sale_id: 's1' }, // all items returned
      ] } } as any) // fully returned sales

    const { sales, loadHistory } = useSaleHistory()
    await loadHistory()

    const byId = Object.fromEntries(sales.value.map(s => [s.id, s]))
    expect(byId['s1'].hasReturn).toBe(true)
    expect(byId['s1'].isFullyReturned).toBe(true)
    expect(byId['s2'].hasReturn).toBe(true)
    expect(byId['s2'].isFullyReturned).toBe(false)
    expect(byId['s3'].hasReturn).toBe(false)
    expect(byId['s3'].isFullyReturned).toBe(false)
  })

  // ── searchByNumber ──────────────────────────────────────────────────────────

  it('searchByNumber issues a LIKE query scoped to shop_id with query + % param', async () => {
    const { useDeviceStore } = await import('@/store/device.store')
    const device = useDeviceStore()
    const expectedShopId = device.shopId

    const { searchByNumber } = useSaleHistory()
    await searchByNumber('A-000247')
    // Must use display_sale_number LIKE and shop_id
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringMatching(/display_sale_number\s+LIKE/),
      expect.arrayContaining(['A-000247%'])
    )
    // shop_id param must also be present (scoped) — verify both params
    const calls = vi.mocked(db.execute).mock.calls
    const likeCall = calls.find(([sql]) => /display_sale_number\s+LIKE/.test(sql as string))
    expect(likeCall).toBeDefined()
    expect(likeCall![1]).toEqual([expectedShopId, 'A-000247%'])
  })

  it('searchByNumber maps returned rows with enrichment fields (hasReturn, isFullyReturned, isPending)', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [
        { id: 's1', shop_id: 'shop1', device_id: 'd1', device_sequence: 1,
          display_sale_number: 'A-000247', created_at: '2026-06-01T10:00:00Z',
          total_usd: 75, total_syp: 1087500, exchange_rate_at_sale: 14500,
          payment_method: 'cash_usd', amount_received: 75,
          amount_received_currency: 'USD', change_due: null, is_split: 0 },
      ] } } as any) // sales LIKE query
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)  // ps_crud
      .mockResolvedValueOnce({ rows: { _array: [{ sale_id: 's1' }] } } as any) // returned sales
      .mockResolvedValueOnce({ rows: { _array: [{ sale_id: 's1' }] } } as any) // fully returned

    const { sales, searchByNumber } = useSaleHistory()
    await searchByNumber('A-000247')

    expect(sales.value).toHaveLength(1)
    expect(sales.value[0].id).toBe('s1')
    expect(sales.value[0].displaySaleNumber).toBe('A-000247')
    expect(sales.value[0].hasReturn).toBe(true)
    expect(sales.value[0].isFullyReturned).toBe(true)
    expect(sales.value[0].isPending).toBe(false)
  })

  // WAFI-127: bare-number entry matches the numeric suffix across device prefixes,
  // tolerant of the 6-digit zero-padding ("45" and "000045" both find "A1-000045").
  it('digits-only query also matches the numeric suffix (unpadded entry, any device prefix)', async () => {
    const { useDeviceStore } = await import('@/store/device.store')
    const expectedShopId = useDeviceStore().shopId

    const { searchByNumber } = useSaleHistory()
    await searchByNumber('45')

    const call = vi.mocked(db.execute).mock.calls.find(([sql]) => /display_sale_number\s+LIKE/.test(sql as string))
    expect(call).toBeDefined()
    expect(call![0]).toMatch(/CAST\(substr\(display_sale_number/)  // suffix numeric compare
    expect(call![1]).toEqual([expectedShopId, '45%', '45'])
  })

  it('prefixed query stays a plain prefix LIKE (no suffix clause)', async () => {
    const { searchByNumber } = useSaleHistory()
    await searchByNumber('A1-45')

    const call = vi.mocked(db.execute).mock.calls.find(([sql]) => /display_sale_number\s+LIKE/.test(sql as string))
    expect(call![0]).not.toMatch(/CAST\(substr/)
    expect(call![1]).toContain('A1-45%')
  })

  it('searchByNumber with empty/whitespace query does not run an unbounded LIKE query', async () => {
    const { searchByNumber } = useSaleHistory()
    await searchByNumber('   ')
    // No call with a LIKE clause should have been made
    const calls = vi.mocked(db.execute).mock.calls
    const likeCall = calls.find(([sql]) => /display_sale_number\s+LIKE/.test(sql as string))
    expect(likeCall).toBeUndefined()
  })

  it('searchByNumber prefix A-0002 returns all matching sales', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [
        { id: 's1', shop_id: 'shop1', device_id: 'd1', device_sequence: 1,
          display_sale_number: 'A-000247', created_at: '2026-06-01T10:00:00Z',
          total_usd: 75, total_syp: 1087500, exchange_rate_at_sale: 14500,
          payment_method: 'cash_usd', amount_received: 75,
          amount_received_currency: 'USD', change_due: null, is_split: 0 },
        { id: 's2', shop_id: 'shop1', device_id: 'd1', device_sequence: 2,
          display_sale_number: 'A-000248', created_at: '2026-06-01T11:00:00Z',
          total_usd: 50, total_syp: 725000, exchange_rate_at_sale: 14500,
          payment_method: 'cash_syp', amount_received: 725000,
          amount_received_currency: 'SYP', change_due: null, is_split: 0 },
      ] } } as any) // sales LIKE query
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)  // ps_crud
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)  // returned sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any)  // fully returned

    const { sales, searchByNumber } = useSaleHistory()
    await searchByNumber('A-0002')

    expect(sales.value).toHaveLength(2)
    // LIKE param must be prefix
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringMatching(/display_sale_number\s+LIKE/),
      expect.arrayContaining(['A-0002%'])
    )
  })

  it('searchByNumber unknown number returns empty sales', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // sales LIKE query returns nothing
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // ps_crud
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // returned
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // fully returned

    const { sales, searchByNumber } = useSaleHistory()
    await searchByNumber('Z-999999')
    expect(sales.value).toHaveLength(0)
  })

  it('reprint uses the real shop name + split breakdown and marks fully-returned (WAFI-031)', async () => {
    vi.mocked(db.execute).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sales WHERE id')) return { rows: { _array: [{
        id: 's1', display_sale_number: 'A-000009', total_usd: 50, total_syp: 725000,
        exchange_rate_at_sale: 14500, payment_method: 'split', amount_received: 50,
        amount_received_currency: 'USD', change_due: null, created_at: '2026-06-21T09:00:00Z', is_split: 1,
      }] } } as any
      if (sql.includes('FROM sale_line_items')) return { rows: { _array: [
        { name_ar: 'سماعة', quantity: 1, unit_price_usd: 50, line_total_usd: 50 },
      ] } } as any
      if (sql.includes('FROM receipt_settings')) return { rows: { _array: [
        { shop_name: 'محل أحمد', tax_number: '123', header_text: 'هدر', footer_text: 'فوتر' },
      ] } } as any
      if (sql.includes('FROM sale_payments')) return { rows: { _array: [
        { method: 'cash_usd', amount_usd: 30 },
        { method: 'card',     amount_usd: 20 },
      ] } } as any
      if (sql.includes('qty_returned')) return { rows: { _array: [{ sale_id: 's1' }] } } as any // fully returned
      return { rows: { _array: [] } } as any
    })

    const { reprint } = useSaleHistory()
    await reprint('s1')

    const receipt = printSpy.mock.calls[0][0]
    expect(receipt.shopName).toBe('محل أحمد')          // real name, not the shop UUID
    expect(receipt.taxNumber).toBe('123')
    expect(receipt.splitPayments).toHaveLength(2)
    expect(receipt.splitPayments[1].method).toBe('card')
    expect(receipt.isFullyReturned).toBe(true)
  })

  // ── isReprint ────────────────────────────────────────────────────────────

  function mockSaleQueries() {
    vi.mocked(db.execute).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sales WHERE id')) return { rows: { _array: [{
        id: 'sale-001', display_sale_number: 'A-000001', total_usd: 20, total_syp: 290000,
        exchange_rate_at_sale: 14500, payment_method: 'cash_usd', amount_received: 20,
        amount_received_currency: 'USD', change_due: 0, created_at: new Date().toISOString(), is_split: 0,
      }] } } as any
      if (sql.includes('FROM sale_line_items')) return { rows: { _array: [
        { name_ar: 'منتج', quantity: 2, unit_price_usd: 10, line_total_usd: 20 },
      ] } } as any
      if (sql.includes('FROM receipt_settings')) return { rows: { _array: [{ shop_name: 'محل تجريبي' }] } } as any
      return { rows: { _array: [] } } as any
    })
  }

  it('buildReceiptData defaults isReprint to false when no options are passed', async () => {
    mockSaleQueries()
    const receipt = await buildReceiptData('sale-001')
    expect(receipt.isReprint).toBe(false)
  })

  it('buildReceiptData sets isReprint to true when requested', async () => {
    mockSaleQueries()
    const receipt = await buildReceiptData('sale-001', { isReprint: true })
    expect(receipt.isReprint).toBe(true)
  })

  it('reprint() builds the receipt with isReprint: true', async () => {
    mockSaleQueries()
    const { reprint } = useSaleHistory()
    await reprint('sale-001')
    expect(printSpy).toHaveBeenCalledWith(expect.objectContaining({ isReprint: true }))
  })
})
