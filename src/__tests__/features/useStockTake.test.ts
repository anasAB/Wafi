import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'

describe('useStockTake — startSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates a session row and one line per active product with frozen expected_stock', async () => {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM products/.test(sql)) {
        return [
          { id: 'p1', current_stock: 10 },
          { id: 'p2', current_stock: 3 },
        ] as any
      }
      return []
    })

    const { startSession } = useStockTake()
    const sessionId = await startSession(null)

    expect(typeof sessionId).toBe('string')

    const insertCalls = vi.mocked(db.execute).mock.calls
    const sessionInsert = insertCalls.find(([sql]) => /INSERT INTO stock_take_sessions/.test(sql))
    expect(sessionInsert).toBeTruthy()
    expect(sessionInsert![1]).toContain('in_progress')

    const lineInserts = insertCalls.filter(([sql]) => /INSERT INTO stock_take_lines/.test(sql))
    expect(lineInserts).toHaveLength(2)
    expect(lineInserts[0][1]).toContain(10)
    expect(lineInserts[1][1]).toContain(3)
  })

  it('loadSession populates session + lines, recordCount updates a line and counted progress', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
      completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
    } as any)
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: null, variance: null, variance_value_usd: null },
      { id: 'l2', session_id: 's1', product_id: 'p2', name_ar: 'منتج ٢', expected_stock: 3, counted_stock: null, variance: null, variance_value_usd: null },
    ] as any)

    const { loadSession, lines, recordCount, progress } = useStockTake()
    await loadSession('s1')

    expect(lines.value).toHaveLength(2)
    expect(progress.value).toEqual({ counted: 0, total: 2 })

    await recordCount('l1', 9)

    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_lines/.test(sql))
    expect(updateCall![1]).toEqual(expect.arrayContaining([9, -1]))
  })

  it('reviewLines excludes zero-variance and confirmSession applies adjustments + completes the session', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({
        id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
        completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
      } as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: 9, variance: -1, variance_value_usd: null },
      { id: 'l2', session_id: 's1', product_id: 'p2', name_ar: 'منتج ٢', expected_stock: 3,  counted_stock: 3, variance: 0,  variance_value_usd: null },
    ] as any)

    const { loadSession, reviewLines, confirmSession } = useStockTake()
    await loadSession('s1')

    expect(reviewLines.value).toHaveLength(1)
    expect(reviewLines.value[0].id).toBe('l1')

    await confirmSession()

    const sessionUpdate = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_sessions/.test(sql))
    expect(sessionUpdate![1]).toContain('completed')
  })
})
