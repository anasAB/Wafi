import { ref } from 'vue'
import { draftDb } from '@/data/dexie/draft.db'
import { useSaleStore, type SaleLine } from '@/store/sale.store'
import { useDeviceStore } from '@/store/device.store'

export function useSaleDraft() {
  const hasDraft = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function loadDraft() {
    const device = useDeviceStore()
    const draft = await draftDb.drafts.get(device.deviceId)
    hasDraft.value = !!draft && draft.line_items.length > 0
  }

  async function saveDraft() {
    const sale = useSaleStore()
    const device = useDeviceStore()
    if (sale.lines.length === 0) {
      await clearDraft()
      return
    }

    await draftDb.drafts.put({
      id: device.deviceId,
      device_id: device.deviceId,
      shop_id: device.shopId,
      line_items: sale.lines.map(l => ({
        product_id: l.productId,
        name_ar: l.nameAr,
        quantity: l.quantity,
        unit_price_usd: l.unitPriceUsd,
      })),
      locked_exchange_rate: sale.lockedExchangeRate ?? 0,
      updated_at: Date.now(),
    })
    hasDraft.value = true
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveDraft, 200)
  }

  async function restoreDraft() {
    const device = useDeviceStore()
    const sale = useSaleStore()
    const draft = await draftDb.drafts.get(device.deviceId)
    if (!draft) return

    sale.clear()
    // Restore locked rate first so it's in place before lines are added
    sale.setLockedRate(draft.locked_exchange_rate)
    for (const item of draft.line_items) {
      const line: SaleLine = {
        productId: item.product_id,
        nameAr: item.name_ar,
        quantity: item.quantity,
        unitPriceUsd: item.unit_price_usd,
        lineTotalUsd: item.quantity * item.unit_price_usd,
      }
      // Push directly to avoid quantity-merging logic in addLine()
      sale.lines.push(line)
    }
  }

  async function clearDraft() {
    const device = useDeviceStore()
    await draftDb.drafts.delete(device.deviceId)
    hasDraft.value = false
  }

  async function purgeOldDrafts() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    await draftDb.drafts.where('updated_at').below(cutoff).delete()
  }

  return {
    hasDraft,
    loadDraft,
    saveDraft,
    scheduleSave,
    restoreDraft,
    clearDraft,
    purgeOldDrafts,
  }
}
