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
})
