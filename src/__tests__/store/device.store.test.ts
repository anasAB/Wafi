import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const session = { access_token: '' }
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: session.access_token ? session : null } })),
      onAuthStateChange: vi.fn(),
    },
  },
}))

function tokenWith(payload: object): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `h.${b64}.s`
}

describe('useDeviceStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts with null shopId before auth', async () => {
    const { useDeviceStore } = await import('@/store/device.store')
    expect(useDeviceStore().shopId).toBeNull()
  })

  it('reads shopId from the session token on refreshShopId()', async () => {
    session.access_token = tokenWith({ shop_id: 'shop-xyz' })
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()
    expect(store.shopId).toBe('shop-xyz')
  })
})
