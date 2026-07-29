import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { db } from '@/data/powersync/db'
import { SupabaseConnector } from '@/data/powersync/connector'
import { useDeviceRegistration } from '@/features/devices/composables/useDeviceRegistration'
import { touchDeviceLastSeen } from '@/features/devices/composables/useDevices'
import { decodeSessionIdClaim } from '@/features/staff/composables/useOperatorSwitch'

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

  // WAFI-203: the last staff id the SERVER confirmed as this device's active
  // operator (set only on a successful switch_active_operator RPC call, in
  // lockstep with the JWT's staff_id claim actually changing). Lets a
  // returning/resuming operator re-establish their own identity fully
  // offline, since the JWT already carries their id from the earlier
  // confirmation — while a genuinely different identity still requires one
  // successful round trip. See docs/superpowers/specs/2026-07-22-wafi-203-operator-identity-design.md.
  const lastConfirmedOperatorId = ref<string | null>(null)

  // In-flight guard: ensureDeviceRegistered() is called from two uncoordinated
  // places (this store's own onAuthStateChange handler, and useSync on
  // connect/reconnect). Without this, two overlapping calls could both pass
  // the `deviceCode.value` check below before the first `await registerDevice`
  // resolves, registering the same physical device twice. Tracking the
  // in-progress promise here means a concurrent call reuses it instead of
  // starting a second registration.
  let registrationInFlight: Promise<void> | null = null
  // WAFI-130: last-seen heartbeat fires at most once per app session.
  let lastSeenTouched = false
  // WAFI-003: record this device's own auth session id once per app session,
  // independent of PIN-switch activity — establishOperatorIdentity's
  // offline-same-identity shortcut (WAFI-203) can leave device_sessions
  // .session_id stale across a sign-out/sign-in cycle otherwise, which would
  // make a later revoke_device_session() call target a dead session.
  let sessionIdRecorded = false

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
      // registerDevice mints its own id and is the sole source of truth for
      // it — adopting a separately-generated id here would diverge from the
      // actual devices.id row it registered, breaking every later
      // switch_active_operator lookup (found live 2026-07-29).
      const { id, code } = await registerDevice(shopId.value)
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
        // WAFI-130: heartbeat for the owner's device list ("last seen"), once
        // per app session. Best-effort; never blocks resolution.
        if (!lastSeenTouched) {
          lastSeenTouched = true
          void touchDeviceLastSeen(shopId.value, deviceCode.value)
        }
        if (!sessionIdRecorded && deviceId.value) {
          const accessToken = data.session?.access_token
          const sessionId = accessToken ? decodeSessionIdClaim(accessToken) : null
          if (sessionId) {
            sessionIdRecorded = true
            void (async () => {
              try {
                await supabase.rpc('record_device_session_id', {
                  p_device_id:  deviceId.value,
                  p_session_id: sessionId,
                })
              } catch {
                // advisory signal only, same as touchDeviceLastSeen
              }
            })()
          }
        }
      }
    } catch {
      // DB not ready yet (pre-connect) — keep persisted/fallback value.
    }
  }

  // Tracks which account last completed a SIGNED_IN/SIGNED_OUT resolution on
  // this device, so a different account signing in on the same device can be
  // detected and the previous account's synced local rows cleared before the
  // new one reads. Only the SIGNED_IN/SIGNED_OUT branches below may read or
  // write this — refreshShopId() itself must NOT touch it. refreshShopId() is
  // also invoked from unrelated code paths (e.g. useSync on PowerSync
  // reconnect), and if it set lastUserId too, a reconnect call interleaved
  // during the SIGNED_IN IIFE's own `await getSession()` could overwrite
  // lastUserId before the IIFE's compare ran, silently defeating the
  // clear-and-reconnect guard (TOCTOU race).
  let lastUserId: string | null = null

  // In-flight guard for the SIGNED_IN clear-and-reconnect block, mirroring
  // registrationInFlight above: two rapid SIGNED_IN events (e.g. a token
  // refresh racing a real sign-in) would otherwise both read lastUserId and
  // compare against it before either had a chance to write the new value,
  // letting a second clear-and-reconnect run against a stale comparison or
  // be skipped entirely. Serializing on this promise makes the read-compare-
  // write of lastUserId atomic relative to other SIGNED_IN invocations.
  let signInInFlight: Promise<void> | null = null

  // Keep shopId in sync with sign-in / sign-out.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      shopId.value = FALLBACK_SHOP_ID
      lastUserId = null
      // WAFI-003 fix: a fresh SIGNED_IN issues a new GoTrue session_id, and
      // without clearing this guard refreshShopId() would never re-record it
      // (record_device_session_id stays skipped), leaving device_sessions
      // .session_id pointing at the now-dead prior session. A later
      // revoke_device_session() would then delete that stale row instead of
      // the actually-live one, silently failing to sign the device out.
      sessionIdRecorded = false
      return
    }
    if (event === 'SIGNED_IN') {
      // New sign-in: drop any shop cached (persisted) from a previous account
      // before re-resolving, so the new session can't briefly read the prior
      // account's shop while its own data is still syncing.
      shopId.value = FALLBACK_SHOP_ID
      void (async () => {
        if (signInInFlight) {
          // A SIGNED_IN resolution is already in progress — wait for it
          // instead of running a second, overlapping compare-and-clear.
          await signInInFlight
          return
        }
        signInInFlight = (async () => {
          const { data } = await supabase.auth.getSession()
          const userId = data.session?.user?.id ?? null
          const previousUserId = lastUserId
          if (previousUserId !== null && userId !== null && userId !== previousUserId) {
            // A different account signed in on this device — the previous
            // account's synced rows must not bleed into the new one.
            await db.disconnectAndClear()
            await db.connect(new SupabaseConnector())
          }
          lastUserId = userId
          await refreshShopId()
        })()
        try {
          await signInInFlight
        } finally {
          signInInFlight = null
        }
      })()
      return
    }
    void refreshShopId()
  })

  return { shopId, deviceId, deviceCode, lastConfirmedOperatorId, refreshShopId, ensureDeviceRegistered }
}, {
  // Persist shopId plus the claimed device identity, so an offline cold-start
  // reuses this device's registered code instead of re-registering.
  persist: { pick: ['shopId', 'deviceId', 'deviceCode', 'lastConfirmedOperatorId'] },
})
