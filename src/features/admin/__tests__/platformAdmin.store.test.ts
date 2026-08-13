import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const maybeSingleMock = vi.fn()
const getSessionMock = vi.fn()
let authChangeCb: ((event: string) => void) | undefined

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (cb: (event: string) => void) => {
        authChangeCb = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: (...args: unknown[]) => maybeSingleMock(...args) }),
      }),
    }),
  },
}))

import { usePlatformAdminStore } from '@/features/admin/platformAdmin.store'

function session(userId: string | null) {
  return { data: { session: userId ? { user: { id: userId } } : null } }
}

describe('usePlatformAdminStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    authChangeCb = undefined
  })

  it('queries once and caches isAdmin for the current user', async () => {
    getSessionMock.mockResolvedValue(session('user-1'))
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })

    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(true)
    expect(await store.ensureChecked()).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('returns false and does not cache on no current user', async () => {
    getSessionMock.mockResolvedValue(session(null))

    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(false)
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  it('resets on a different user (sign-out then sign-in as a non-admin)', async () => {
    getSessionMock.mockResolvedValueOnce(session('admin-1'))
    maybeSingleMock.mockResolvedValueOnce({ data: { user_id: 'admin-1' }, error: null })
    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(true)

    authChangeCb?.('SIGNED_OUT')

    getSessionMock.mockResolvedValueOnce(session('user-2'))
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    expect(await store.ensureChecked()).toBe(false)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('leaves a failed check retryable, not permanently cached as non-admin', async () => {
    getSessionMock.mockResolvedValue(session('user-1'))
    maybeSingleMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ data: { user_id: 'user-1' }, error: null })

    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(false)
    expect(await store.ensureChecked()).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('leaves a failed check retryable when the query resolves with {data:null, error} instead of rejecting', async () => {
    getSessionMock.mockResolvedValue(session('user-1'))
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: new Error('PGRST error') })
      .mockResolvedValueOnce({ data: { user_id: 'user-1' }, error: null })

    const store = usePlatformAdminStore()
    expect(await store.ensureChecked()).toBe(false)
    expect(await store.ensureChecked()).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent calls for the same user into one query', async () => {
    getSessionMock.mockResolvedValue(session('user-1'))
    let resolveQuery: (v: unknown) => void = () => {}
    maybeSingleMock.mockReturnValue(new Promise(r => { resolveQuery = r }))

    const store = usePlatformAdminStore()
    const p1 = store.ensureChecked()
    const p2 = store.ensureChecked()
    resolveQuery({ data: { user_id: 'user-1' }, error: null })

    expect(await p1).toBe(true)
    expect(await p2).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('does not let a stale in-flight query for a previous user overwrite a newer user\'s result', async () => {
    let resolveA: (v: unknown) => void = () => {}
    getSessionMock.mockResolvedValueOnce(session('user-A'))
    maybeSingleMock.mockReturnValueOnce(new Promise(r => { resolveA = r }))

    const store = usePlatformAdminStore()
    const pA = store.ensureChecked() // in-flight for user-A, not yet resolved

    // Session switches to user-B before A's query resolves.
    getSessionMock.mockResolvedValueOnce(session('user-B'))
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    const bResult = await store.ensureChecked()
    expect(bResult).toBe(false)
    expect(store.isAdmin).toBe(false)

    // Now A's stale query resolves as admin=true -- it must NOT overwrite B's result.
    resolveA({ data: { user_id: 'user-A' }, error: null })
    await pA

    expect(store.isAdmin).toBe(false)
  })
})
