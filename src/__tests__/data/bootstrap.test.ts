import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()

vi.mock('@/data/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}))

describe('bootstrap.ts constants and RPC wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports the three named constants with their exact string values', async () => {
    const { BOOTSTRAP_SUCCESS, BOOTSTRAP_ALREADY_COMPLETE, BOOTSTRAP_INVALID_STATE } =
      await import('@/data/supabase/bootstrap')
    expect(BOOTSTRAP_SUCCESS).toBe('success')
    expect(BOOTSTRAP_ALREADY_COMPLETE).toBe('already_bootstrapped')
    expect(BOOTSTRAP_INVALID_STATE).toBe('invalid_state')
  })

  it('calls the bootstrap_owner_identity RPC with exactly the four expected params', async () => {
    rpcMock.mockResolvedValue({ data: 'success', error: null })
    const { callBootstrapOwnerIdentity } = await import('@/data/supabase/bootstrap')

    const result = await callBootstrapOwnerIdentity({
      deviceId: 'd1', staffId: 's1', staffName: 'Owner', pin: '1234',
    })

    expect(rpcMock).toHaveBeenCalledWith('bootstrap_owner_identity', {
      p_device_id: 'd1', p_staff_id: 's1', p_staff_name: 'Owner', p_pin: '1234',
    })
    expect(result).toBe('success')
  })

  it('throws if the RPC itself errors (e.g. network failure)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network error' } })
    const { callBootstrapOwnerIdentity } = await import('@/data/supabase/bootstrap')

    await expect(
      callBootstrapOwnerIdentity({ deviceId: 'd1', staffId: 's1', staffName: 'Owner', pin: '1234' })
    ).rejects.toThrow('network error')
  })
})
