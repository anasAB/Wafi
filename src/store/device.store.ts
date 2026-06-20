import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { db } from '@/data/powersync/db'

// Dev/transition fallback: until the owner's shop row has synced locally, fall
// back to a configured shop so the app stays usable. In production (no
// VITE_STUB_SHOP_ID) this is '' — falsy, so "no shop yet" guards still work and
// any write under that state fails closed under RLS. shopId stays a non-null
// string so every consumer can use it directly.
const FALLBACK_SHOP_ID = (import.meta.env.VITE_STUB_SHOP_ID as string | undefined) ?? ''

export const useDeviceStore = defineStore('device', () => {
  // shop_id is resolved from the owner's locally-synced `shops` row. This mirrors
  // the server's `shops.owner_user_id → auth.uid()` sync/RLS mapping, so it needs
  // NO custom JWT claim and NO access-token hook. Persisted (see `persist` below)
  // so an offline cold-start reuses the last known shop immediately; refreshed
  // whenever a sync connects (see useSync) and on sign-in.
  const shopId = ref<string>(FALLBACK_SHOP_ID)

  // deviceId/deviceCode remain stubbed — real device registration is Sub-project 3.
  const deviceId   = (import.meta.env.VITE_STUB_DEVICE_ID   ?? '00000000-0000-0000-0000-000000000002') as string
  const deviceCode = (import.meta.env.VITE_STUB_DEVICE_CODE ?? 'A') as string

  /**
   * Resolve shopId from the locally-synced `shops` table. The sync rules only
   * ever sync the signed-in account's own shop, so a single row is expected.
   * Works offline once the first sync has populated `shops`; before that, the
   * persisted/fallback value stands. Never throws — a missing/unready DB leaves
   * the current value untouched.
   */
  async function refreshShopId(): Promise<void> {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user?.id
    if (!userId) return  // not signed in — keep current; sign-out clears it
    try {
      // Scope the lookup to the signed-in account's own shop, mirroring the
      // server's `shops.owner_user_id → auth.uid()` mapping. Filtering by
      // owner_user_id means a `shops` row left in the local DB by a previous
      // account is never adopted by a different one.
      const row = await db.getOptional<{ id: string }>(
        'SELECT id FROM shops WHERE owner_user_id = ? LIMIT 1', [userId]
      )
      if (row?.id) shopId.value = row.id
    } catch {
      // DB not ready yet (pre-connect) — keep persisted/fallback value.
    }
  }

  // Keep shopId in sync with sign-in / sign-out.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      shopId.value = FALLBACK_SHOP_ID
      return
    }
    if (event === 'SIGNED_IN') {
      // New sign-in: drop any shop cached (persisted) from a previous account
      // before re-resolving, so the new session can't briefly read the prior
      // account's shop while its own data is still syncing.
      shopId.value = FALLBACK_SHOP_ID
    }
    void refreshShopId()
  })

  return { shopId, deviceId, deviceCode, refreshShopId }
}, {
  // Persist only shopId — deviceId/deviceCode are env-derived constants.
  persist: { pick: ['shopId'] },
})
