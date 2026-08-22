import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkHealthAlerts } from '../healthAlertCheck'

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(async () => ({ data: null, error: null })),
}))

vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: mockRpc } }))

describe('WAFI-148A checkHealthAlerts', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: null, error: null })
  })

  it('calls evaluate_health_alerts_foreground with no shop-identifying parameters', async () => {
    await checkHealthAlerts()

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('evaluate_health_alerts_foreground')

    // Proves reliance on server-side auth_shop_id() derivation, not a
    // client-supplied shop id: the call must not carry a second (params)
    // argument at all.
    const call = mockRpc.mock.calls[0]
    expect(call).toHaveLength(1)
  })

  it('does not throw when the RPC returns an error (fire-and-forget resilience)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    await expect(checkHealthAlerts()).resolves.toBeUndefined()
  })

  it('does not throw when the RPC call itself rejects', async () => {
    mockRpc.mockRejectedValue(new Error('network down'))

    await expect(checkHealthAlerts()).resolves.toBeUndefined()
  })
})
