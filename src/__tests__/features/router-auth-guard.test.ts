import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const session: { value: { user: { id: string } } | null } = { value: null }
vi.mock('@/data/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: session.value } })) } },
}))
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

describe('router auth guard', () => {
  beforeEach(() => {
    session.value = null
    vi.resetModules()
    setActivePinia(createPinia())
  })

  it('redirects an unauthenticated visit to /pos to /login', async () => {
    const { default: router } = await import('@/router/index')
    await router.push('/pos')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('lets an authenticated session reach a normal route', async () => {
    session.value = { user: { id: 'user-a' } }
    const { default: router } = await import('@/router/index')
    await router.push('/history')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/history')
  })

  it('redirects an authenticated user away from /login', async () => {
    session.value = { user: { id: 'user-a' } }
    const { default: router } = await import('@/router/index')
    await router.push('/login')
    await router.isReady()
    expect(router.currentRoute.value.path).not.toBe('/login')
  })
})
