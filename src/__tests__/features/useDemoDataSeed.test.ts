import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const logProductCreated = vi.fn(async () => {})
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({
    logProductCreated, logProductUpdated: vi.fn(), logProductPriceChanged: vi.fn(),
    logProductDeleted: vi.fn(), logStockAdjusted: vi.fn(),
  }),
}))

import { useDemoDataSeed } from '@/features/onboarding/composables/useDemoDataSeed'
import { db } from '@/data/powersync/db'

describe('useDemoDataSeed', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('seeds 5 demo products tagged created_via=demo_seed when the shop has none', async () => {
    const { seedDemoProducts } = useDemoDataSeed()
    await seedDemoProducts()

    const inserts = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => /INSERT INTO products/.test(sql as string)
    )
    expect(inserts).toHaveLength(5)
    for (const [, params] of inserts) {
      expect((params as unknown[])[(params as unknown[]).length - 1]).toBe('demo_seed')
    }
  })

  it('does nothing when the shop already has products (idempotent)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{
      id: 'p1', shop_id: 's1', name_ar: 'موجود', name_en: null,
      price_usd: 1, cost_price_usd: 1, barcode: null, category: null,
      current_stock: 1, low_stock_threshold: 1, photo_url: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      is_active: 1, deleted: 0, sync_status: 'synced',
    }] as any)

    const { seedDemoProducts } = useDemoDataSeed()
    await seedDemoProducts()

    const inserts = vi.mocked(db.execute).mock.calls.filter(
      ([sql]) => /INSERT INTO products/.test(sql as string)
    )
    expect(inserts).toHaveLength(0)
  })
})
