import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { shopIdFromToken } from '@/data/supabase/jwt'

export const useDeviceStore = defineStore('device', () => {
  // shop_id now comes from the signed-in account's JWT claim (set by the
  // custom access token hook). Null until auth completes.
  const shopId = ref<string | null>(null)

  // deviceId/deviceCode remain stubbed — real device registration is Sub-project 3.
  const deviceId   = (import.meta.env.VITE_STUB_DEVICE_ID   ?? '00000000-0000-0000-0000-000000000002') as string
  const deviceCode = (import.meta.env.VITE_STUB_DEVICE_CODE ?? 'A') as string

  async function refreshShopId(): Promise<void> {
    const { data } = await supabase.auth.getSession()
    shopId.value = shopIdFromToken(data.session?.access_token)
  }

  // Keep shopId in sync with sign-in / refresh / sign-out.
  supabase.auth.onAuthStateChange((_event, sess) => {
    shopId.value = shopIdFromToken(sess?.access_token)
  })

  return { shopId, deviceId, deviceCode, refreshShopId }
})
