import { defineStore } from 'pinia'

export const useDeviceStore = defineStore('device', () => {
  // Epic 1 stub — replaced by real auth in a later epic.
  // Values match supabase/seed.sql and .env.local.example.
  const shopId     = import.meta.env.VITE_STUB_SHOP_ID    as string ?? '00000000-0000-0000-0000-000000000001'
  const deviceId   = import.meta.env.VITE_STUB_DEVICE_ID  as string ?? '00000000-0000-0000-0000-000000000002'
  const deviceCode = import.meta.env.VITE_STUB_DEVICE_CODE as string ?? 'A'

  return { shopId, deviceId, deviceCode }
})
