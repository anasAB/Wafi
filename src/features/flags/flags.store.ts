import { ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { resolveFlag, resolveRollout, type FlagKey, type RolloutFlagKey } from './flagRegistry'

/**
 * WAFI-131: per-shop flags, read from the synced shops row. Loaded once per
 * app session (and re-read on demand) so features never yank mid-operation —
 * a server-side flag change applies after refresh/next sync, per the ticket.
 * Offline devices keep the last-synced value indefinitely (the local shops
 * row IS the last-synced state).
 */
export const useFlagsStore = defineStore('featureFlags', () => {
  const features = ref<Record<string, unknown> | null>(null)
  const loaded   = ref(false)

  async function load(): Promise<void> {
    try {
      const device = useDeviceStore()
      const row = await db.getOptional<{ features: string | null }>(
        `SELECT features FROM shops WHERE id = ?`, [device.shopId]
      )
      // No shop row yet (first sync pending) → null → all-on, same as a
      // grandfathered row: never brick the app on a race.
      features.value = row?.features ? (JSON.parse(row.features) as Record<string, unknown>) : null
    } catch {
      features.value = null // unreadable blob → fail open (grandfather semantics)
    }
    loaded.value = true
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await load()
  }

  function isEnabled(key: FlagKey): boolean {
    return resolveFlag(features.value, key)
  }

  function isRolloutEnabled(key: RolloutFlagKey): boolean {
    return resolveRollout(features.value, key)
  }

  return { features, loaded, load, ensureLoaded, isEnabled, isRolloutEnabled }
})
