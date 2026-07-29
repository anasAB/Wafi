import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/features/products/composables/useInventoryMovements', () => ({
  useInventoryMovements: vi.fn(),
}))

import { useStockTakeVariance } from '../useStockTakeVariance'
import { useInventoryMovements } from '@/features/products/composables/useInventoryMovements'

describe('useStockTakeVariance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('computes netMovementDelta as the sum of movement deltas, and unexplainedVariance as variance minus that sum', async () => {
    const getMovements = vi.fn().mockResolvedValue([
      { id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'sale', delta: -3 },
      { id: 'b', timestamp: '2026-07-29T10:50:00Z', reason: 'return', delta: 1 },
    ])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    const result = await loadMovements('p1', -7, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(result.netMovementDelta).toBe(-2)      // -3 + 1
    expect(result.unexplainedVariance).toBe(-5)   // -7 - (-2)
    expect(result.entries).toHaveLength(2)
  })

  it('handles zero movements: unexplainedVariance equals the full variance', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    const result = await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(result.netMovementDelta).toBe(0)
    expect(result.unexplainedVariance).toBe(-13)
  })

  it('handles a positive variance from an over-receiving correctly (not labeled shrinkage)', async () => {
    const getMovements = vi.fn().mockResolvedValue([
      { id: 'a', timestamp: '2026-07-29T10:32:00Z', reason: 'receiving', delta: 10 },
    ])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    const result = await loadMovements('p1', 20, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(result.netMovementDelta).toBe(10)
    expect(result.unexplainedVariance).toBe(10)
  })

  it('caches by productId+window: a second call with the same key does not re-invoke getMovements', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(getMovements).toHaveBeenCalledTimes(1)
  })

  it('does not share a cache entry across two different products', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    await loadMovements('p2', -5, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')

    expect(getMovements).toHaveBeenCalledTimes(2)
  })

  it('does not share a cache entry across two different windows for the same product', async () => {
    const getMovements = vi.fn().mockResolvedValue([])
    vi.mocked(useInventoryMovements).mockReturnValue({ getMovements })

    const { loadMovements } = useStockTakeVariance()
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T11:00:00Z')
    await loadMovements('p1', -13, '2026-07-29T10:00:00Z', '2026-07-29T12:00:00Z')

    expect(getMovements).toHaveBeenCalledTimes(2)
  })
})
