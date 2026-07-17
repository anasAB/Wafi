import { defineStore } from 'pinia'
import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/data/supabase/client'
import { db } from '@/data/powersync/db'
import { SupabaseConnector } from '@/data/powersync/connector'
import { useDeviceRegistration } from '@/features/devices/composables/useDeviceRegistration'

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

  // deviceId/deviceCode are real, persisted registration values (see
  // ensureDeviceRegistered below). The env vars remain as a dev/test seam —
  // when set, they act as a pre-registered device and ensureDeviceRegistered
  // is a no-op; when unset (production default), the device registers itself
  // for real the first time its shop resolves.
  const deviceId   = ref<string>((import.meta.env.VITE_STUB_DEVICE_ID   ?? '') as string)
  const deviceCode = ref<string>((import.meta.env.VITE_STUB_DEVICE_CODE ?? '') as string)

  // In-flight guard: ensureDeviceRegistered() is called from two uncoordinated
  // places (this store's own onAuthStateChange handler, and useSync on
  // connect/reconnect). Without this, two overlapping calls could both pass
  // the `deviceCode.value` check below before the first `await registerDevice`
  // resolves, registering the same physical device twice. Tracking the
  // in-progress promise here means a concurrent call reuses it instead of
  // starting a second registration.
  let registrationInFlight: Promise<void> | null = null

  /**
   * Claims a device code for this browser/device the first time a shop is
   * known. Guards against re-registering once a code exists (whether from a
   * prior registration or the dev/test env stub), and against registering
   * before a shop has resolved (there's nothing to register the device
   * under yet — refreshShopId() calls this again once shopId is set).
   */
  async function ensureDeviceRegistered(): Promise<void> {
    if (deviceCode.value) return  // already registered (or stubbed) on this device
    if (!shopId.value) return     // no shop resolved yet — retry after refreshShopId()
    if (registrationInFlight) return registrationInFlight  // a registration is already in progress

    registrationInFlight = (async () => {
      const { registerDevice } = useDeviceRegistration()
      const id = uuidv4()
      const { code } = await registerDevice(shopId.value)
      deviceId.value = id
      deviceCode.value = code
    })()

    try {
      await registrationInFlight
    } finally {
      registrationInFlight = null
    }
  }

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
    lastUserId = userId
    try {
      // Scope the lookup to the signed-in account's own shop, mirroring the
      // server's `shops.owner_user_id → auth.uid()` mapping. Filtering by
      // owner_user_id means a `shops` row left in the local DB by a previous
      // account is never adopted by a different one.
      const row = await db.getOptional<{ id: string }>(
        'SELECT id FROM shops WHERE owner_user_id = ? LIMIT 1', [userId]
      )
      if (row?.id) {
        shopId.value = row.id
        await ensureDeviceRegistered()
      }
    } catch {
      // DB not ready yet (pre-connect) — keep persisted/fallback value.
    }
  }

  // Tracks which account last completed a SIGNED_IN resolution on this device,
  // so a different account signing in on the same device can be detected and
  // the previous account's synced local rows cleared before the new one reads.
  let lastUserId: string | null = null

  // Keep shopId in sync with sign-in / sign-out.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      shopId.value = FALLBACK_SHOP_ID
      lastUserId = null
      return
    }
    if (event === 'SIGNED_IN') {
      // New sign-in: drop any shop cached (persisted) from a previous account
      // before re-resolving, so the new session can't briefly read the prior
      // account's shop while its own data is still syncing.
      shopId.value = FALLBACK_SHOP_ID
      void (async () => {
        const { data } = await supabase.auth.getSession()
        const userId = data.session?.user?.id ?? null
        if (lastUserId !== null && userId !== null && userId !== lastUserId) {
          // A different account signed in on this device — the previous
          // account's synced rows must not bleed into the new one.
          await db.disconnectAndClear()
          await db.connect(new SupabaseConnector())
        }
        lastUserId = userId
        await refreshShopId()
      })()
      return
    }
    void refreshShopId()
  })

  return { shopId, deviceId, deviceCode, refreshShopId, ensureDeviceRegistered }
}, {
  // Persist shopId plus the claimed device identity, so an offline cold-start
  // reuses this device's registered code instead of re-registering.
  persist: { pick: ['shopId', 'deviceId', 'deviceCode'] },
})
