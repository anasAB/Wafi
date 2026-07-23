import { describe, it, expect } from 'vitest'
import { buildCanonicalRows, validateRows } from '../useImportValidation'
import type { FieldMapping } from '../../import.types'

const MAP: FieldMapping = {
  nameAr: 'name', nameEn: null, barcode: 'barcode', category: null,
  salePrice: 'price', cost: 'cost', currentStock: 'stock', lowStockThreshold: null,
  priceCurrency: 'SYP', costCurrency: 'SYP',
}

describe('buildCanonicalRows', () => {
  it('maps and normalizes cells', () => {
    const rows = buildCanonicalRows(
      [{ name: ' iPhone ', barcode: '123', price: '١٥٠٠', cost: '1,000', stock: '5' }],
      MAP,
    )
    expect(rows[0]).toMatchObject({
      nameAr: 'iPhone', barcode: '123', salePriceRaw: 1500, costRaw: 1000, currentStock: 5,
    })
  })
  it('blank optional cells → null', () => {
    const rows = buildCanonicalRows([{ name: 'X', price: '10', barcode: '', cost: '', stock: '' }], MAP)
    expect(rows[0].barcode).toBeNull()
    expect(rows[0].costRaw).toBeNull()
    expect(rows[0].currentStock).toBeNull()
  })
})

describe('validateRows', () => {
  const rows = (over: Partial<Record<string, unknown>>[]) =>
    buildCanonicalRows(over.map((o) => ({ name: 'X', price: '10', ...o })), MAP)

  it('valid new row → import', () => {
    const r = validateRows(rows([{ barcode: 'A' }]), new Set())
    expect(r[0].kind).toBe('import')
  })
  it('missing name → error', () => {
    const r = validateRows(buildCanonicalRows([{ name: '', price: '10' }], MAP), new Set())
    expect(r[0].kind).toBe('error')
  })
  it('missing/zero price → error', () => {
    expect(validateRows(buildCanonicalRows([{ name: 'X', price: '' }], MAP), new Set())[0].kind).toBe('error')
    expect(validateRows(buildCanonicalRows([{ name: 'X', price: '0' }], MAP), new Set())[0].kind).toBe('error')
  })
  it('negative stock → error', () => {
    const r = validateRows(buildCanonicalRows([{ name: 'X', price: '10', stock: '-1' }], MAP), new Set())
    expect(r[0].kind).toBe('error')
  })
  it('missing cost → import with no-cost flag', () => {
    const r = validateRows(buildCanonicalRows([{ name: 'X', price: '10', cost: '' }], MAP), new Set())
    expect(r[0].kind).toBe('import')
    expect(r[0].flags).toContain('no-cost')
  })
  it('barcode already in catalog → skip', () => {
    const r = validateRows(rows([{ barcode: 'DUP' }]), new Set(['DUP']))
    expect(r[0].kind).toBe('skip')
  })
  it('in-file duplicate barcode → keep first, skip rest', () => {
    const r = validateRows(rows([{ barcode: 'B' }, { barcode: 'B' }]), new Set())
    expect(r[0].kind).toBe('import')
    expect(r[1].kind).toBe('skip')
  })
})
