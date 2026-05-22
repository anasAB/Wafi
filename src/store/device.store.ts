import { defineStore } from 'pinia'

export const useDeviceStore = defineStore('device', () => {
  // Epic 1 stub — replaced by real auth in a later epic.
  // Values match supabase/seed.sql and .env.local.example.
  const shopId     = (import.meta.env.VITE_STUB_SHOP_ID    ?? '00000000-0000-0000-0000-000000000001') as string
  const deviceId   = (import.meta.env.VITE_STUB_DEVICE_ID  ?? '00000000-0000-0000-0000-000000000002') as string
  const deviceCode = (import.meta.env.VITE_STUB_DEVICE_CODE ?? 'A') as string

  return { shopId, deviceId, deviceCode }
})
