import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'

export function useExchangeRate() {
  const currentRate       = ref<number | null>(null)
  const rateHistory       = ref<Array<{ rate: number; setAt: string }>>([])
  const needsConfirmation = ref(false)
  const pendingRate       = ref<number | null>(null)
  const saving            = ref(false)
  const error             = ref<string | null>(null)

  async function loadRate() {
    const device = useDeviceStore()
    const result = await db.execute(
      `SELECT rate, set_at FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 5`,
      [device.shopId]
    )
    const rows: Array<{ rate: number; set_at: string }> = (result as any).rows._array
    if (rows.length > 0) {
      currentRate.value = rows[0].rate
      rateHistory.value = rows.map(r => ({ rate: r.rate, setAt: r.set_at }))
    } else {
      currentRate.value = null
      rateHistory.value = []
    }
  }

  async function saveRate(newRate: number, confirmed = false): Promise<void> {
    if (newRate <= 0) throw new Error('Rate must be greater than zero')

    if (currentRate.value !== null && !confirmed) {
      const change = Math.abs(newRate - currentRate.value) / currentRate.value
      if (change > 0.5) {
        needsConfirmation.value = true
        pendingRate.value       = newRate
        return
      }
    }

    needsConfirmation.value = false
    pendingRate.value       = null
    saving.value            = true
    error.value             = null

    try {
      const device = useDeviceStore()
      await db.execute(
        `INSERT INTO exchange_rates (id, shop_id, device_id, rate, set_at, set_by)
         VALUES (?, ?, ?, ?, ?, 'owner')`,
        [uuidv4(), device.shopId, device.deviceId, newRate, new Date().toISOString()]
      )
      currentRate.value = newRate
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save rate'
      throw err
    } finally {
      saving.value = false
    }
  }

  async function confirmSave(): Promise<void> {
    if (pendingRate.value !== null) {
      await saveRate(pendingRate.value, true)
    }
  }

  return {
    currentRate,
    rateHistory,
    needsConfirmation,
    pendingRate,
    saving,
    error,
    loadRate,
    saveRate,
    confirmSave,
  }
}
