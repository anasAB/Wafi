import { describe, it, expect, beforeEach } from 'vitest'
import { draftDb } from '@/data/dexie/draft.db'

describe('draftDb', () => {
  beforeEach(async () => {
    await draftDb.drafts.clear()
  })

  it('saves and retrieves a draft by device_id', async () => {
    const draft = {
      id: 'device-001',
      device_id: 'device-001',
      shop_id: 'shop-001',
      line_items: [{ product_id: 'p1', name_ar: 'منتج', quantity: 2, unit_price_usd: 5 }],
      locked_exchange_rate: 14500,
      updated_at: Date.now(),
    }
    await draftDb.drafts.put(draft)
    const retrieved = await draftDb.drafts.get('device-001')
    expect(retrieved?.locked_exchange_rate).toBe(14500)
    expect(retrieved?.line_items).toHaveLength(1)
  })

  it('purges drafts older than 24 hours', async () => {
    const old = {
      id: 'old-device',
      device_id: 'old-device',
      shop_id: 'shop-001',
      line_items: [],
      locked_exchange_rate: 14500,
      updated_at: Date.now() - 25 * 60 * 60 * 1000,
    }
    await draftDb.drafts.put(old)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    await draftDb.drafts.where('updated_at').below(cutoff).delete()
    const result = await draftDb.drafts.get('old-device')
    expect(result).toBeUndefined()
  })
})
