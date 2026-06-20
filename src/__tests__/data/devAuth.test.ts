import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the auth client, PowerSync db, and connector so bootstrapDevAuth runs
// without any real network or database. Spies are created via vi.hoisted so they
// exist when the (hoisted) vi.mock factories run.
const { getSession, signInWithPassword, signUp, connect } = vi.hoisted(() => ({
  getSession:         vi.fn(),
  signInWithPassword: vi.fn(),
  signUp:             vi.fn(),
  connect:            vi.fn(),
}))
vi.mock('@/data/supabase/client', () => ({
  supabase: { auth: { getSession, signInWithPassword, signUp } },
}))
vi.mock('@/data/powersync/db', () => ({ db: { connect } }))
vi.mock('@/data/powersync/connector', () => ({ SupabaseConnector: class {} }))

import { bootstrapDevAuth } from '@/data/supabase/devAuth'

describe('bootstrapDevAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A signed-out-but-reachable baseline: no session, sign-in succeeds.
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    signUp.mockResolvedValue({ data: { session: null }, error: null })
    connect.mockResolvedValue(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Default: opt-in ON with valid creds and a PowerSync URL.
    vi.stubEnv('VITE_DEV_AUTO_SIGNIN', 'true')
    vi.stubEnv('VITE_DEV_SUPABASE_EMAIL', 'brother@example.com')
    vi.stubEnv('VITE_DEV_SUPABASE_PASSWORD', 'secret')
    vi.stubEnv('VITE_POWERSYNC_URL', 'https://ps.example.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('does nothing when the opt-in flag is off (AC 8)', async () => {
    vi.stubEnv('VITE_DEV_AUTO_SIGNIN', 'false')
    await bootstrapDevAuth()
    expect(getSession).not.toHaveBeenCalled()
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('warns and stays local-only when credentials are missing (AC 10)', async () => {
    vi.stubEnv('VITE_DEV_SUPABASE_EMAIL', '')
    vi.stubEnv('VITE_DEV_SUPABASE_PASSWORD', '')
    await bootstrapDevAuth()
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('credentials are missing'))
  })

  it('signs in and connects when there is no existing session (AC 1)', async () => {
    await bootstrapDevAuth()
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'brother@example.com', password: 'secret',
    })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('reuses a valid persisted session without re-signing-in (AC 2)', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'existing' } }, error: null })
    await bootstrapDevAuth()
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(connect).toHaveBeenCalledTimes(1)  // still connects on reload
  })

  it('does not attempt to connect when no PowerSync URL is set (AC 11)', async () => {
    vi.stubEnv('VITE_POWERSYNC_URL', '')
    await bootstrapDevAuth()
    expect(signInWithPassword).toHaveBeenCalledTimes(1)
    expect(connect).not.toHaveBeenCalled()
  })

  it('degrades gracefully (no throw) when sign-in fails, e.g. offline (AC 4/10)', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Network request failed' } })
    await expect(bootstrapDevAuth()).resolves.toBeUndefined()
    expect(connect).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Auto sign-in failed'), expect.anything())
  })

  it('warns that credentials are embedded when running in a production build (AC 9)', async () => {
    vi.stubEnv('PROD', true)
    await bootstrapDevAuth()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('single-device use only'))
  })

  it('does not emit the embedded-credentials warning in a non-production build', async () => {
    // PROD is false under vitest by default.
    await bootstrapDevAuth()
    const warned = vi.mocked(console.warn).mock.calls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('single-device use only'),
    )
    expect(warned).toBe(false)
  })
})
