import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

// WAFI-121: the commit path goes through adjustStockBy (delta), never absolute
// writes — spy on it so tests assert the exact deltas applied.
const adjustStockBy = vi.fn(async () => {})
const adjustStock   = vi.fn(async () => {})
vi.mock('@/features/products/composables/useProducts', () => ({
  useProducts: () => ({ adjustStockBy, adjustStock }),
}))

import { db } from '@/data/powersync/db'
import { useStockTake, StockTakeOverlapError } from '@/features/stock-take/composables/useStockTake'

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
    vi.mocked(db.getOptional).mockResolvedValue({
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

    const result = await confirmSession()
    expect(result).toBe('committed')

    const sessionUpdate = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_sessions/.test(sql))
    expect(sessionUpdate![1]).toContain('completed')
  })

  it('recordCount computes variance_value_usd from the product cost_price_usd, or null if missing', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/cost_price_usd/.test(sql)) return { cost_price_usd: 5 } as any
      return null
    })
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: null, variance: null, variance_value_usd: null },
    ] as any)

    const { loadSession, recordCount } = useStockTake()
    await loadSession('s1')
    await recordCount('l1', 8)

    const updateCall = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE stock_take_lines/.test(sql))
    // variance = 8 - 10 = -2, variance_value_usd = -2 * 5 = -10
    expect(updateCall![1]).toEqual(expect.arrayContaining([8, -2, -10]))
  })
})

// ── WAFI-121: delta commit, double-commit guard, overlap block ──────────────

function mockSession(over: Record<string, unknown> = {}) {
  return {
    id: 's1', shop_id: 'shop1', started_at: '2026-07-14T00:00:00Z',
    completed_at: null, status: 'in_progress', created_by: 'dev1', scope: null,
    scope_category_id: null, scope_subcategory_id: null, ...over,
  }
}

describe('useStockTake — WAFI-121 delta commit', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('commits DELTAS so a sale rung mid-count survives: snapshot 10, sold 2 (live 8), counted 9 → delta −1', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(mockSession() as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'منتج ١', expected_stock: 10, counted_stock: 9, variance: -1, variance_value_usd: null, live_stock: 8 },
    ] as any)

    const { loadSession, confirmSession } = useStockTake()
    await loadSession('s1')
    const result = await confirmSession()

    expect(result).toBe('committed')
    // Delta applied to LIVE stock (8 + (−1) = 7), never an absolute SET to 9.
    expect(adjustStockBy).toHaveBeenCalledWith('p1', -1, 'stocktake', expect.any(String))
    expect(adjustStock).not.toHaveBeenCalled()
  })

  it('return-restock during count: counted above snapshot commits a positive delta', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(mockSession() as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'م', expected_stock: 5, counted_stock: 7, variance: 2, variance_value_usd: null, live_stock: 6 },
    ] as any)

    const { loadSession, confirmSession } = useStockTake()
    await loadSession('s1')
    await confirmSession()

    expect(adjustStockBy).toHaveBeenCalledWith('p1', 2, 'stocktake', expect.any(String))
  })

  it('zero-variance-with-movement: counted 10 = snapshot 10 but live 8 → NO write, sale preserved', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(mockSession() as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'م', expected_stock: 10, counted_stock: 10, variance: 0, variance_value_usd: null, live_stock: 8 },
    ] as any)

    const { loadSession, confirmSession } = useStockTake()
    await loadSession('s1')
    const result = await confirmSession()

    expect(result).toBe('committed')
    expect(adjustStockBy).not.toHaveBeenCalled()
  })

  it('uncounted lines are skipped (no delta, no write)', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(mockSession() as any)
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'م', expected_stock: 10, counted_stock: null, variance: null, variance_value_usd: null, live_stock: 10 },
    ] as any)

    const { loadSession, confirmSession } = useStockTake()
    await loadSession('s1')
    await confirmSession()

    expect(adjustStockBy).not.toHaveBeenCalled()
  })

  it('double confirmSession is a guarded no-op: second call re-reads status and refuses', async () => {
    // First status read: in_progress; after commit the session is completed.
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce(mockSession() as any)                       // loadSession
      .mockResolvedValueOnce(mockSession() as any)                       // 1st confirm status check
      .mockResolvedValue(mockSession({ status: 'completed' }) as any)    // 2nd confirm status check
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'l1', session_id: 's1', product_id: 'p1', name_ar: 'م', expected_stock: 10, counted_stock: 9, variance: -1, variance_value_usd: null, live_stock: 10 },
    ] as any)

    const { loadSession, confirmSession } = useStockTake()
    await loadSession('s1')

    expect(await confirmSession()).toBe('committed')
    adjustStockBy.mockClear()

    expect(await confirmSession()).toBe('already-completed')
    expect(adjustStockBy).not.toHaveBeenCalled() // adjustments never re-run
  })
})

describe('useStockTake — WAFI-121 concurrent-session guard + WAFI-134 category scoping', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function mockProductsAndSessions(openSessions: unknown[], products: unknown[] = [{ id: 'p1', current_stock: 4 }]) {
    vi.mocked(db.getAll).mockImplementation(async (sql: string) => {
      if (/FROM stock_take_sessions/.test(sql)) return openSessions as any
      if (/FROM products/.test(sql)) return products as any
      return []
    })
  }

  it('WAFI-134: scoping by category filters products on category_id, not the dead free-text column', async () => {
    mockProductsAndSessions([])
    const { startSession } = useStockTake()
    await startSession({ categoryId: 'cat-1', scopeName: 'موبايلات' })

    const productQuery = vi.mocked(db.getAll).mock.calls.find(([sql]) => /FROM products/.test(sql))!
    expect(productQuery[0]).toContain('category_id')
    expect(productQuery[0]).not.toMatch(/AND category = \?/)
    expect(productQuery[1]).toContain('cat-1')

    const sessionInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => /INSERT INTO stock_take_sessions/.test(sql))!
    expect(sessionInsert[1]).toContain('cat-1')     // scope_category_id persisted
    expect(sessionInsert[1]).toContain('موبايلات')  // human-readable snapshot for history
  })

  it('WAFI-134: subcategory scope filters on subcategory_id too', async () => {
    mockProductsAndSessions([])
    const { startSession } = useStockTake()
    await startSession({ categoryId: 'cat-1', subcategoryId: 'sub-2', scopeName: 'موبايلات — سامسونج' })

    const productQuery = vi.mocked(db.getAll).mock.calls.find(([sql]) => /FROM products/.test(sql))!
    expect(productQuery[0]).toContain('subcategory_id')
    expect(productQuery[1]).toContain('sub-2')
  })

  it('blocks starting when an all-products session is already open', async () => {
    mockProductsAndSessions([mockSession({ scope_category_id: null })])
    const { startSession } = useStockTake()
    await expect(startSession({ categoryId: 'cat-1', scopeName: 'x' })).rejects.toBeInstanceOf(StockTakeOverlapError)
  })

  it('blocks an all-products start while any scoped session is open', async () => {
    mockProductsAndSessions([mockSession({ scope_category_id: 'cat-9' })])
    const { startSession } = useStockTake()
    await expect(startSession(null)).rejects.toBeInstanceOf(StockTakeOverlapError)
  })

  it('blocks same-category overlap, allows disjoint categories to run concurrently', async () => {
    mockProductsAndSessions([mockSession({ scope_category_id: 'cat-1' })])
    const { startSession } = useStockTake()

    await expect(startSession({ categoryId: 'cat-1', scopeName: 'a' })).rejects.toBeInstanceOf(StockTakeOverlapError)
    await expect(startSession({ categoryId: 'cat-2', scopeName: 'b' })).resolves.toBeTypeOf('string')
  })

  it('two disjoint subcategories of the same category may run concurrently; same subcategory blocks', async () => {
    mockProductsAndSessions([mockSession({ scope_category_id: 'cat-1', scope_subcategory_id: 'sub-1' })])
    const { startSession } = useStockTake()

    await expect(startSession({ categoryId: 'cat-1', subcategoryId: 'sub-1', scopeName: 'a' })).rejects.toBeInstanceOf(StockTakeOverlapError)
    await expect(startSession({ categoryId: 'cat-1', subcategoryId: 'sub-2', scopeName: 'b' })).resolves.toBeTypeOf('string')
    // whole-category start overlaps its open subcategory
    await expect(startSession({ categoryId: 'cat-1', scopeName: 'c' })).rejects.toBeInstanceOf(StockTakeOverlapError)
  })
})
