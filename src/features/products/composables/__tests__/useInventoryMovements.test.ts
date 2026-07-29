import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useInventoryMovements } from '../useInventoryMovements'
import { db } from '@/data/powersync/db'

describe('useInventoryMovements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries both stock_adjustments and stock_receiving_line_items with the same bound window, and passes reason/id through untouched', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'adj-1', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -5 },
      { id: 'recv-1', timestamp: '2026-07-29T10:50:00Z', reason: 'receiving', delta: 10 },
    ] as any)

    const { getMovements } = useInventoryMovements()
    const result = await getMovements('p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM stock_adjustments'),
      ['p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z', 'p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z'],
    )
    const sql = vi.mocked(db.getAll).mock.calls[0][0] as string
    expect(sql).toContain('UNION ALL')
    expect(sql).toContain('FROM stock_receiving_line_items')
    expect(sql).toContain("reason != 'stocktake'")
    expect(sql).toContain('ORDER BY timestamp ASC, id ASC')

    expect(result).toEqual([
      { id: 'adj-1', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -5 },
      { id: 'recv-1', timestamp: '2026-07-29T10:50:00Z', reason: 'receiving', delta: 10 },
    ])
  })

  it('returns an empty array when there are no movements in the window', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([] as any)
    const { getMovements } = useInventoryMovements()
    const result = await getMovements('p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    expect(result).toEqual([])
  })

  // With a mocked db.getAll, we cannot verify that SQLite actually includes/
  // excludes rows at the exact window boundary, or that a real tie in
  // `timestamp` sorts deterministically by `id` — the mock returns whatever
  // we tell it to, regardless of the WHERE/ORDER BY clauses' real behavior.
  // That is true of every query test in this codebase (no in-memory SQLite
  // test harness is used anywhere). What IS verified here, and would catch
  // a real regression, is that our code emits the correct comparison
  // operators and column names in the first place — a typo'd `>` instead of
  // `>=`, or the wrong column, would fail this test even though it can never
  // fail a boundary-inclusion test against a mock.
  it('uses inclusive (>=/<=) bounds on both halves of the union, against the correct timestamp columns', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([] as any)
    const { getMovements } = useInventoryMovements()
    await getMovements('p1', '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    const sql = vi.mocked(db.getAll).mock.calls[0][0] as string
    expect(sql).toContain('created_at >= ?')
    expect(sql).toContain('created_at <= ?')
    expect(sql).toContain('sr.received_at >= ?')
    expect(sql).toContain('sr.received_at <= ?')
  })
})
