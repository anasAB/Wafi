import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { useSaleStore } from '@/store/sale.store'
import { draftDb } from '@/data/dexie/draft.db'

const DEVICE_ID = '00000000-0000-0000-0000-000000000002'

describe('useSaleDraft', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    await draftDb.drafts.clear()
  })

  it('hasDraft is false when no draft exists', async () => {
    const { hasDraft, loadDraft } = useSaleDraft()
    await loadDraft()
    expect(hasDraft.value).toBe(false)
  })

  it('saveDraft writes to Dexie with locked_exchange_rate', async () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })
    store.setLockedRate(14500)

    const { saveDraft } = useSaleDraft()
    await saveDraft()

    const draft = await draftDb.drafts.get(DEVICE_ID)
    expect(draft?.locked_exchange_rate).toBe(14500)
    expect(draft?.line_items).toHaveLength(1)
  })

  it('restoreDraft patches sale.store from Dexie', async () => {
    await draftDb.drafts.put({
      id: DEVICE_ID,
      device_id: DEVICE_ID,
      shop_id: '00000000-0000-0000-0000-000000000001',
      line_items: [{ product_id: 'p1', name_ar: 'منتج', quantity: 3, unit_price_usd: 5 }],
      locked_exchange_rate: 14200,
      updated_at: Date.now(),
    })

    const store = useSaleStore()
    const { restoreDraft, loadDraft } = useSaleDraft()
    await loadDraft()
    await restoreDraft()

    expect(store.lockedExchangeRate).toBe(14200)
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].quantity).toBe(3)
  })

  it('clearDraft removes Dexie record', async () => {
    await draftDb.drafts.put({
      id: DEVICE_ID,
      device_id: DEVICE_ID,
      shop_id: '00000000-0000-0000-0000-000000000001',
      line_items: [],
      locked_exchange_rate: 14500,
      updated_at: Date.now(),
    })

    const { clearDraft, loadDraft, hasDraft } = useSaleDraft()
    await clearDraft()
    await loadDraft()
    expect(hasDraft.value).toBe(false)
  })
})
