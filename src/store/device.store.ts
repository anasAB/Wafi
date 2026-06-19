import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { shopIdFromToken } from '@/data/supabase/jwt'

// Dev/transition fallback: until the access-token hook reliably injects the
// shop_id claim, fall back to a configured shop so the app stays usable instead
// of firing writes with shop_id = null. In production (no VITE_STUB_SHOP_ID)
// this is null, which fails closed under RLS — the JWT claim is then required.
const FALLBACK_SHOP_ID = (import.meta.env.VITE_STUB_SHOP_ID as string | undefined) ?? null

/** JWT claim wins; fall back to the configured shop only when no claim is present. */
function resolveShopId(token: string | null | undefined): string | null {
  return shopIdFromToken(token) ?? FALLBACK_SHOP_ID
}

export const useDeviceStore = defineStore('device', () => {
  // shop_id comes from the signed-in account's JWT claim (set by the custom
  // access token hook), falling back to FALLBACK_SHOP_ID when absent.
  const shopId = ref<string | null>(resolveShopId(null))

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
