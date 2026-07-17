import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// A mutable fake session + auth-change capture so tests can drive sign-in/out.
const session: { value: { access_token: string; user?: { id: string } } | null } = { value: null }
let authCb: ((event: string) => void) | undefined

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: session.value } })),
      onAuthStateChange: vi.fn((cb: (event: string) => void) => { authCb = cb }),
    },
  },
}))

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const registerDeviceMock = vi.fn()
vi.mock('@/features/devices/composables/useDeviceRegistration', () => ({
  useDeviceRegistration: () => ({ registerDevice: registerDeviceMock }),
}))

import { db } from '@/data/powersync/db'

// shopId persists via pinia-plugin-persistedstate in the app, but the test pinia
// has no plugin, so each fresh pinia starts at the fallback.
const FALLBACK = (import.meta.env.VITE_STUB_SHOP_ID as string | undefined) ?? ''

// Flush pending microtasks/timers so a fire-and-forget refreshShopId() settles.
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('useDeviceStore', () => {
  beforeEach(() => {
    session.value = null
    authCb = undefined
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    registerDeviceMock.mockReset()
  })

  it('uses the configured fallback shop before any shop has synced', async () => {
    const { useDeviceStore } = await import('@/store/device.store')
    expect(useDeviceStore().shopId).toBe(FALLBACK)
  })

  it('resolves shopId from the locally-synced shops row when signed in', async () => {
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-xyz' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()
    expect(store.shopId).toBe('shop-xyz')
    expect(db.getOptional).toHaveBeenCalledWith(expect.stringContaining('FROM shops'), expect.any(Array))
  })

  it('scopes the shops lookup to the signed-in account (owner_user_id)', async () => {
    // The lookup must be filtered by the current account so a shops row left
    // locally by a previous account can never be adopted by a new one.
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    await useDeviceStore().refreshShopId()
    expect(db.getOptional).toHaveBeenCalledWith(expect.stringContaining('owner_user_id'), ['user-a'])
  })

  it('does not change shopId when not signed in', async () => {
    session.value = null
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-xyz' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()
    expect(store.shopId).toBe(FALLBACK)
    expect(db.getOptional).not.toHaveBeenCalled()
  })

  it('resets shopId to the fallback on sign-out', async () => {
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-xyz' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()
    expect(store.shopId).toBe('shop-xyz')
    // Drive the captured auth callback with a sign-out event.
    authCb?.('SIGNED_OUT')
    expect(store.shopId).toBe(FALLBACK)
  })

  it('clears a previously-resolved shop on a new sign-in until the new account syncs', async () => {
    // Account A is resolved first.
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()
    expect(store.shopId).toBe('shop-a')

    // Account B signs in on the same device; its shop has not synced yet, so the
    // owner-scoped lookup finds no row. Account A's shop must NOT linger.
    session.value = { access_token: 'tok2', user: { id: 'user-b' } }
    vi.mocked(db.getOptional).mockResolvedValue(null)
    authCb?.('SIGNED_IN')
    expect(store.shopId).toBe(FALLBACK)  // cleared synchronously on sign-in
    await flush()
    expect(store.shopId).toBe(FALLBACK)  // stays cleared — no foreign row adopted
  })

  it('clears local data when a different account signs in on the same device', async () => {
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()

    session.value = { access_token: 'tok2', user: { id: 'user-b' } }
    authCb?.('SIGNED_IN')
    await flush()

    expect(db.disconnectAndClear).toHaveBeenCalled()
  })

  it('does not clear local data when the same account re-authenticates (token refresh)', async () => {
    session.value = { access_token: 'tok', user: { id: 'user-a' } }
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'shop-a' } as any)
    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    await store.refreshShopId()

    vi.mocked(db.disconnectAndClear).mockClear()
    authCb?.('SIGNED_IN')  // same user-a session
    await flush()

    expect(db.disconnectAndClear).not.toHaveBeenCalled()
  })

  it('only registers once when ensureDeviceRegistered is called concurrently', async () => {
    let resolveRegister: (v: { code: string; isTemporary: boolean }) => void
    registerDeviceMock.mockImplementation(() => new Promise(resolve => { resolveRegister = resolve }))

    const { useDeviceStore } = await import('@/store/device.store')
    const store = useDeviceStore()
    store.shopId = 'shop-a'
    store.deviceCode = ''  // override the env-stub default so registration actually runs

    // Two concurrent calls before the first registration resolves.
    const p1 = store.ensureDeviceRegistered()
    const p2 = store.ensureDeviceRegistered()

    expect(registerDeviceMock).toHaveBeenCalledTimes(1)

    resolveRegister!({ code: 'B', isTemporary: false })
    await Promise.all([p1, p2])

    expect(registerDeviceMock).toHaveBeenCalledTimes(1)
    expect(store.deviceCode).toBe('B')
  })
})
