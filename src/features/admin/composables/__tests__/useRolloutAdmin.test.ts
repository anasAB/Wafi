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
})
