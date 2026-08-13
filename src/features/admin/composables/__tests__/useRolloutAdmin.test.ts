import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const rpcMock = vi.fn()
vi.mock('@/data/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

import { useRolloutAdmin } from '@/features/admin/composables/useRolloutAdmin'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    shop_id: 's1', shop_name: 'Al Noor Pharmacy',
    dashboard_v2: false, pos_brain: false, insights: false,
    ...overrides,
  }
}

describe('useRolloutAdmin: load & search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads shops on refresh()', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row()], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()
    expect(rpcMock).toHaveBeenCalledWith('list_shops_for_rollout_admin', { p_query: '' })
    expect(admin.shops.value).toHaveLength(1)
    expect(admin.shops.value[0].shopName).toBe('Al Noor Pharmacy')
  })

  it('sets capped=true when exactly 100 rows return', async () => {
    rpcMock.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => row({ shop_id: `s${i}` })), error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()
    expect(admin.capped.value).toBe(true)
  })

  it('discards a stale response that resolves after a newer request', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    rpcMock.mockReturnValueOnce(new Promise(r => { resolveFirst = r }))
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_name: 'Second' })], error: null })

    const admin = useRolloutAdmin()
    const firstRefresh = admin.refresh()
    admin.query.value = 'Al'
    const secondRefresh = admin.refresh()

    // Second (newer) request resolves first.
    await secondRefresh
    // Now the first (now-stale) request resolves.
    resolveFirst({ data: [row({ shop_name: 'First' })], error: null })
    await firstRefresh
    await nextTick()

    expect(admin.shops.value).toHaveLength(1)
    expect(admin.shops.value[0].shopName).toBe('Second')
  })

  it('on RPC error, stops loading and does not clear existing shops', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row()], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()
    expect(admin.shops.value).toHaveLength(1)

    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await admin.refresh()

    expect(admin.loading.value).toBe(false)
    expect(admin.shops.value).toHaveLength(1)
  })
})

describe('useRolloutAdmin: toggle mutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('commits the optimistic value into local state on success, with no dependency on a fresh refresh', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    rpcMock.mockResolvedValueOnce({ data: null, error: null }) // set_rollout_flag success
    await admin.toggle('s1', 'dashboard_v2')

    expect(admin.valueFor(admin.shops.value[0], 'dashboard_v2')).toBe(true)
    expect(admin.isPending('s1', 'dashboard_v2')).toBe(false)
  })

  it('reverts to the last known server value on RPC failure', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await admin.toggle('s1', 'dashboard_v2')

    expect(admin.valueFor(admin.shops.value[0], 'dashboard_v2')).toBe(false)
    expect(admin.isPending('s1', 'dashboard_v2')).toBe(false)
  })

  it('a second click while the first is pending is a no-op', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    let resolveSet: (v: unknown) => void = () => {}
    rpcMock.mockReturnValueOnce(new Promise(r => { resolveSet = r }))
    const first = admin.toggle('s1', 'dashboard_v2')
    const second = admin.toggle('s1', 'dashboard_v2') // no-op: already pending

    resolveSet({ data: null, error: null })
    await first
    await second
    expect(rpcMock).toHaveBeenCalledTimes(2) // 1 refresh + 1 set_rollout_flag, not 2
  })

  it('a stale list response arriving after a successful mutation does not revert it', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    const admin = useRolloutAdmin()
    await admin.refresh()

    // A search request starts but hasn't resolved yet.
    let resolveStaleList: (v: unknown) => void = () => {}
    rpcMock.mockReturnValueOnce(new Promise(r => { resolveStaleList = r }))
    const staleRefresh = admin.refresh()

    // The mutation completes before that stale search response arrives.
    rpcMock.mockResolvedValueOnce({ data: null, error: null })
    await admin.toggle('s1', 'dashboard_v2')

    // Now the stale (pre-mutation) search response arrives.
    resolveStaleList({ data: [row({ shop_id: 's1', dashboard_v2: false })], error: null })
    await staleRefresh

    expect(admin.valueFor(admin.shops.value[0], 'dashboard_v2')).toBe(true)
  })
})
