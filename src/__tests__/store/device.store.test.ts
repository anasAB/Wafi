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

// Whatever the test env provides — the store falls back to exactly this when no
// claim is present (null when VITE_STUB_SHOP_ID is unset).
const FALLBACK = (import.meta.env.VITE_STUB_SHOP_ID as string | undefined) ?? null

describe('useDeviceStore', () => {
  beforeEach(() => {
    session.access_token = ''
    setActivePinia(createPinia())
  })

  it('uses the configured fallback shop when the token has no claim', async () => {
    const { useDeviceStore } = await import('@/store/device.store')
    expect(useDeviceStore().shopId).toBe(FALLBACK)
  })

  it('prefers the JWT shop_id claim over the fallback', async () => {
    session.access_token = tokenWith({ shop_id: 'shop-xyz' })
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()
    expect(store.shopId).toBe('shop-xyz')
  })
})
