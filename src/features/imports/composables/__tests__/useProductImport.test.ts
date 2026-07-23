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
