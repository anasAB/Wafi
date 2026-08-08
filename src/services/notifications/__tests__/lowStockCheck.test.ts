import { describe, it, expect, vi } from 'vitest'
import { checkLowStockCrossing } from '../lowStockCheck'

function fakeTx(threshold: number) {
  return {
    execute: vi.fn(async (sql: string) => {
      if (sql.includes('select low_stock_threshold')) {
        return { rows: { _array: [{ low_stock_threshold: threshold, name_ar: 'منتج' }] } } as any
      }
      return {} as any
    }),
  } as any
}

it('inserts a notification when stock crosses from above to at-or-below the threshold', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 6, 4, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('inserts when crossing exactly onto the threshold (boundary inclusive)', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 6, 5, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('does not insert when already below the threshold (no new crossing)', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 4, 3, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledTimes(1) // only the threshold lookup, no insert
})

it('does not insert when crossing back above the threshold', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 3, 6, '2026-01-01T00:00:00.000Z')
  expect(tx.execute).toHaveBeenCalledTimes(1)
})

it('fires again on a second crossing after having reset above the threshold', async () => {
  const tx = fakeTx(5)
  await checkLowStockCrossing(tx, 'shop1', 'p1', 3, 6, '2026-01-01T00:00:00.000Z') // reset, no fire
  await checkLowStockCrossing(tx, 'shop1', 'p1', 6, 5, '2026-01-01T00:00:00.000Z') // crosses down again
  expect(tx.execute).toHaveBeenCalledTimes(3) // 2 lookups + 1 insert
})
