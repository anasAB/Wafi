import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/composables/usePrinter', () => ({
  usePrinter: () => ({ print: vi.fn(), error: { value: null } }),
}))

import { useSaleHistory } from '@/features/sale-history/useSaleHistory'
import { db } from '@/data/powersync/db'

describe('useSaleHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('loadHistory without dateRange queries last 7 days using created_at >=', async () => {
    const { loadHistory } = useSaleHistory()
    await loadHistory()
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('created_at >='),
      expect.any(Array)
    )
  })

  it('loadHistory with dateRange queries using BETWEEN', async () => {
    const { loadHistory } = useSaleHistory()
    await loadHistory({ start: '2025-01-01', end: '2025-01-31' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('BETWEEN'),
      expect.arrayContaining(['2025-01-01', '2025-01-31'])
    )
  })

  it('flags hasReturn and isFullyReturned from the returns query', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: { _array: [
        { id: 's1', total_usd: 75 },
        { id: 's2', total_usd: 50 },
        { id: 's3', total_usd: 30 },
      ] } } as any) // sales
      .mockResolvedValueOnce({ rows: { _array: [] } } as any) // ps_crud (pending)
      .mockResolvedValueOnce({ rows: { _array: [
        { sale_id: 's1', fully_returned: 1 }, // all items returned
        { sale_id: 's2', fully_returned: 0 }, // partial return
      ] } } as any) // returns

    const { sales, loadHistory } = useSaleHistory()
    await loadHistory()

    const byId = Object.fromEntries(sales.value.map(s => [s.id, s]))
    expect(byId['s1'].hasReturn).toBe(true)
    expect(byId['s1'].isFullyReturned).toBe(true)
    expect(byId['s2'].hasReturn).toBe(true)
    expect(byId['s2'].isFullyReturned).toBe(false)
    expect(byId['s3'].hasReturn).toBe(false)
    expect(byId['s3'].isFullyReturned).toBe(false)
  })
})
