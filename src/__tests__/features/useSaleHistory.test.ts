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
})
