import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { shopIdFromToken } from '@/data/supabase/jwt'

// Dev/transition fallback: until the shop_id claim reliably reaches the JWT,
// fall back to a configured shop so the app stays usable. In production (no
// VITE_STUB_SHOP_ID) this is '' — falsy, so "no shop yet" guards still work,
// and any write under that state fails closed under RLS. shopId stays a
// non-null string so every consumer can use it directly.
const FALLBACK_SHOP_ID = (import.meta.env.VITE_STUB_SHOP_ID as string | undefined) ?? ''

/** JWT claim wins; fall back to the configured shop only when no claim is present. */
function resolveShopId(token: string | null | undefined): string {
  return shopIdFromToken(token) ?? FALLBACK_SHOP_ID
}

export const useDeviceStore = defineStore('device', () => {
  // shop_id comes from the signed-in account's JWT claim, falling back to
  // FALLBACK_SHOP_ID when absent (empty string when truly unknown).
  const shopId = ref<string>(resolveShopId(null))

  // deviceId/deviceCode remain stubbed — real device registration is Sub-project 3.
  const deviceId   = (import.meta.env.VITE_STUB_DEVICE_ID   ?? '00000000-0000-0000-0000-000000000002') as string
  const deviceCode = (import.meta.env.VITE_STUB_DEVICE_CODE ?? 'A') as string

  async function refreshShopId(): Promise<void> {
    const { data } = await supabase.auth.getSession()
    shopId.value = resolveShopId(data.session?.access_token)
  }

  // Keep shopId in sync with sign-in / refresh / sign-out.
  supabase.auth.onAuthStateChange((_event, sess) => {
    shopId.value = resolveShopId(sess?.access_token)
  })

  return { shopId, deviceId, deviceCode, refreshShopId }
})
