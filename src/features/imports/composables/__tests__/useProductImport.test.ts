import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useProductImport } from '@/features/imports/composables/useProductImport'
import { db } from '@/data/powersync/db'
import type { RowStatus } from '@/features/imports/import.types'

const importRow = (over: Partial<RowStatus['row']> = {}): RowStatus => ({
  index: 1, kind: 'import', reason: null, flags: [],
  row: {
    nameAr: 'iPhone', nameEn: null, barcode: 'A1', category: null,
    salePriceRaw: 135000, costRaw: 100000, currentStock: 5, lowStockThreshold: null, ...over,
  },
})

describe('commitImport', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  function setupTx() {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementation(async (fn: any) => { await fn({ execute: txExecute }) })
    return txExecute
  }

  it('inserts only import-kind rows and converts SYP→USD', async () => {
    const txExecute = setupTx()
    const { commitImport } = useProductImport()
    const statuses: RowStatus[] = [
      importRow({ barcode: 'A1' }),
      { index: 2, kind: 'skip', reason: 'dup', flags: [], row: importRow().row },
      { index: 3, kind: 'error', reason: 'bad', flags: [], row: importRow().row },
    ]
    const result = await commitImport(statuses, { rate: 13500, priceCurrency: 'SYP', costCurrency: 'SYP' })

    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.errored).toBe(1)
    // one INSERT into products for the single import row
    const inserts = txExecute.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO products'))
    expect(inserts).toHaveLength(1)
    // price_usd = 135000 / 13500 = 10
    expect(inserts[0][1]).toContain(10)
  })

  it('writes exactly one audit row', async () => {
    setupTx()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    const { commitImport } = useProductImport()
    await commitImport([importRow()], { rate: 13500, priceCurrency: 'SYP', costCurrency: 'SYP' })
    const auditCalls = vi.mocked(db.execute).mock.calls.filter((c) => String(c[0]).includes('INSERT INTO audit_log'))
    expect(auditCalls).toHaveLength(1)
  })

  it('marks new products with created_via = import', async () => {
    const txExecute = setupTx()
    const { commitImport } = useProductImport()
    await commitImport([importRow()], { rate: 13500, priceCurrency: 'SYP', costCurrency: 'SYP' })
    const insert = txExecute.mock.calls.find((c) => String(c[0]).includes('INSERT INTO products'))!
    expect(insert[1]).toContain('import')
  })
})

// The INSERT interleaves literal values (NULL, 1, 0, 'pending') with `?`
// placeholders, so a column's position in the column list does not equal
// its position in the params array — only actual `?` placeholders consume
// a params slot. This walks both lists together to find the real params
// index for a given column name.
function paramIndexForColumn(sql: string, columnName: string): number {
  const columnsPart = sql.slice(sql.indexOf('('), sql.indexOf(')'))
  const columns = columnsPart.split(',').map((s) => s.trim())
  const valuesPart = sql.slice(sql.indexOf('VALUES (') + 'VALUES ('.length, sql.lastIndexOf(')'))
  const values = valuesPart.split(',').map((s) => s.trim())
  const colIndex = columns.indexOf(columnName)
  if (colIndex === -1) throw new Error(`column ${columnName} not found`)
  if (values[colIndex] !== '?') throw new Error(`column ${columnName} is not a placeholder`)
  return values.slice(0, colIndex).filter((v) => v === '?').length
}

describe('useProductImport.commitImport — cost_updated_at stamping (WAFI-013)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('stamps cost_updated_at for an imported row with a real cost', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
      await fn({ execute: txExecute })
    })

    const { commitImport } = useProductImport()
    await commitImport([importRow({ costRaw: 6 })], { rate: 1, priceCurrency: 'USD', costCurrency: 'USD' })

    const insertCall = (txExecute.mock.calls as any[]).find(
      ([sql]: [string]) => sql.includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall[0]).toContain('cost_updated_at')
    const sql = insertCall[0] as string
    const params = insertCall[1] as any[]
    const costUpdatedAtIndex = paramIndexForColumn(sql, 'cost_updated_at')
    expect(params[costUpdatedAtIndex]).not.toBeNull()
  })

  it('leaves cost_updated_at null for an imported row with no cost column value', async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: { _array: [] } })
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
      await fn({ execute: txExecute })
    })

    const { commitImport } = useProductImport()
    await commitImport([importRow({ costRaw: null })], { rate: 1, priceCurrency: 'USD', costCurrency: 'USD' })

    const insertCall = (txExecute.mock.calls as any[]).find(
      ([sql]: [string]) => sql.includes('INSERT INTO products'),
    )
    expect(insertCall).toBeDefined()
    const sql = insertCall[0] as string
    const params = insertCall[1] as any[]
    const costUpdatedAtIndex = paramIndexForColumn(sql, 'cost_updated_at')
    expect(params[costUpdatedAtIndex]).toBeNull()
  })
})
