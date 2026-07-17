import { describe, it, expect, vi, beforeEach } from 'vitest'
import { discardDeadLetterOp, type DeadLetterEntry } from '@/data/powersync/dead-letter'

function makeRow(overrides: Partial<DeadLetterEntry>): DeadLetterEntry {
  return {
    id: 'dl-1',
    client_id: 1,
    op_type: 'PUT' as any,
    table_name: 'categories',
    row_id: 'cat-1',
    op_data: null,
    error_code: '23505',
    error_message: 'duplicate key value violates unique constraint',
    failed_at: '2026-07-17T00:00:00.000Z',
    ...overrides,
  }
}

describe('discardDeadLetterOp', () => {
  let rows: DeadLetterEntry[]
  let db: any

  beforeEach(() => {
    rows = []
    db = {
      getOptional: vi.fn(async (sql: string, params?: unknown[]) => {
        const id = params?.[0] as string | undefined
        return rows.find(r => r.id === id) ?? null
      }),
      getAll: vi.fn(async (sql: string) => {
        if (sql.includes(`table_name = 'subcategories'`)) {
          return rows.filter(r => r.table_name === 'subcategories')
        }
        return rows
      }),
      execute: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('DELETE FROM sync_dead_letter WHERE id = ?')) {
          const id = params?.[0] as string
          rows = rows.filter(r => r.id !== id)
        }
      }),
    }
  })

  it('discards a plain (non-category) entry without touching anything else', async () => {
    rows = [
      makeRow({ id: 'dl-1', table_name: 'sales', row_id: 'sale-1' }),
      makeRow({ id: 'dl-2', table_name: 'sales', row_id: 'sale-2' }),
    ]

    await discardDeadLetterOp(db, 'dl-1')

    expect(rows.map(r => r.id)).toEqual(['dl-2'])
  })

  it('cascades: discarding a failed categories insert also discards subcategories that reference it', async () => {
    rows = [
      makeRow({ id: 'dl-cat', table_name: 'categories', row_id: 'cat-1' }),
      makeRow({
        id: 'dl-sub-1', table_name: 'subcategories', row_id: 'sub-1',
        op_data: JSON.stringify({ category_id: 'cat-1', name: 'A' }),
      }),
      makeRow({
        id: 'dl-sub-2', table_name: 'subcategories', row_id: 'sub-2',
        op_data: JSON.stringify({ category_id: 'cat-1', name: 'B' }),
      }),
      makeRow({
        id: 'dl-sub-other', table_name: 'subcategories', row_id: 'sub-3',
        op_data: JSON.stringify({ category_id: 'cat-OTHER', name: 'C' }),
      }),
    ]

    await discardDeadLetterOp(db, 'dl-cat')

    expect(rows.map(r => r.id)).toEqual(['dl-sub-other'])
  })
})
