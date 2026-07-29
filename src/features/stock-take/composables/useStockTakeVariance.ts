import { useInventoryMovements, type InventoryMovement } from '@/features/products/composables/useInventoryMovements'

export interface LineMovements {
  entries:              InventoryMovement[]
  netMovementDelta:     number
  unexplainedVariance:  number
}

/**
 * Layers stock-take-specific arithmetic on top of the shared movement query:
 * netMovementDelta (sum of every movement's delta in the window) and
 * unexplainedVariance (variance minus that sum — deliberately NOT called
 * "shrinkage": it can be positive, e.g. an over-receiving, so the name must
 * work for both signs).
 *
 * Cached per `${productId}:${windowStart}:${windowEnd}` for the lifetime of
 * one useStockTakeVariance() call (i.e. one review-screen mount) — expanding
 * the same line twice must not re-query SQLite, and a future window change
 * (e.g. a "refresh" affordance) must not silently serve a stale window's
 * result under the same product's cache slot.
 */
export function useStockTakeVariance() {
  const { getMovements } = useInventoryMovements()
  const cache = new Map<string, LineMovements>()

  async function loadMovements(
    productId: string, variance: number, windowStart: string, windowEnd: string, shopId: string,
  ): Promise<LineMovements> {
    const key = `${productId}:${windowStart}:${windowEnd}`
    const cached = cache.get(key)
    if (cached) return cached

    const entries = await getMovements(productId, windowStart, windowEnd, shopId)
    const netMovementDelta = entries.reduce((sum, e) => sum + e.delta, 0)
    const result: LineMovements = {
      entries,
      netMovementDelta,
      unexplainedVariance: variance - netMovementDelta,
    }
    cache.set(key, result)
    return result
  }

  return { loadMovements }
}
