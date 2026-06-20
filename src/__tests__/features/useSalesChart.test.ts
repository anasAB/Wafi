import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useSalesChart } from '@/features/dashboard/composables/useSalesChart'
import { db } from '@/data/powersync/db'

describe('useSalesChart — local-time bucketing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([] as any)
  })

  // created_at is stored as UTC (toISOString). The dashboard metrics bucket with
  // DATE(created_at, 'localtime'); the chart MUST match or the two disagree and
  // late-night sales land on the wrong bar. Guard the SQL string directly.
  it('buckets sales by local-time date', async () => {
    const { load } = useSalesChart()
    await load('week')
    const salesSql = vi.mocked(db.getAll).mock.calls[0][0]
    expect(salesSql).toContain("DATE(created_at, 'localtime')")
    expect(salesSql).not.toMatch(/DATE\(created_at\)/)
  })

  it('buckets COGS by local-time date', async () => {
    const { load } = useSalesChart()
    await load('week')
    const cogsSql = vi.mocked(db.getAll).mock.calls[1][0]
    expect(cogsSql).toContain("DATE(s.created_at, 'localtime')")
    expect(cogsSql).not.toMatch(/DATE\(s\.created_at\)(?!,)/)
  })
})
