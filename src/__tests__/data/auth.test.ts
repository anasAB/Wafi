import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Supabase auth client so the service runs with no network. Spies are
// hoisted so they exist when the (hoisted) vi.mock factory runs.
const { signUp, signInWithPassword, signOut, getUser } = vi.hoisted(() => ({
  signUp:             vi.fn(),
  signInWithPassword: vi.fn(),
  signOut:            vi.fn(),
  getUser:            vi.fn(),
}))
vi.mock('@/data/supabase/client', () => ({
  supabase: { auth: { signUp, signInWithPassword, signOut, getUser } },
}))

import { phoneToEmail, signUpOwner, signIn, signOut as serviceSignOut, verifyAccountPassword } from '@/data/supabase/auth'

describe('phoneToEmail', () => {
  it('strips spaces, dashes and the leading + to a stable synthetic local-part', () => {
    // The shop owner authenticates by phone; we have no SMS provider (no OTP), so
    // the phone is keyed as a synthetic email behind a non-delivering domain.
    expect(phoneToEmail('+963 944 123-456')).toBe('963944123456@wafi.app')
  })

  it('is deterministic — the same phone always maps to the same email', () => {
    expect(phoneToEmail('0944123456')).toBe(phoneToEmail('0944123456'))
  })

  it('ignores formatting differences that represent the same digits', () => {
    expect(phoneToEmail('(963) 944 123 456')).toBe('963944123456@wafi.app')
  })
})

describe('signUpOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: { access_token: 't' } }, error: null })
  })

  it('signs up with the synthetic email and carries shop details in user metadata', async () => {
    const res = await signUpOwner({
      phone: '+963944123456', password: 'secret123',
      shopName: 'متجر أحمد', businessType: 'electronics', country: 'SY',
    })
    expect(res.ok).toBe(true)
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: '963944123456@wafi.app',
      password: 'secret123',
      options: { data: expect.objectContaining({
        shop_name: 'متجر أحمد', business_type: 'electronics', country: 'SY', phone: '+963944123456',
      }) },
    }))
  })

  it('reports a duplicate account instead of a generic error', async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'User already registered' } })
    const res = await signUpOwner({ phone: '0944', password: 'secret123', shopName: 's', businessType: 'general', country: 'SY' })
    expect(res).toEqual({ ok: false, reason: 'duplicate', message: expect.any(String) })
  })

  it('reports offline (no fake success) when the network is unreachable', async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Network request failed' } })
    const res = await signUpOwner({ phone: '0944', password: 'secret123', shopName: 's', businessType: 'general', country: 'SY' })
    expect(res).toEqual({ ok: false, reason: 'offline', message: expect.any(String) })
  })

  it('reports a weak password distinctly so the form can guide the owner', async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Password should be at least 6 characters' } })
    const res = await signUpOwner({ phone: '0944', password: '12', shopName: 's', businessType: 'general', country: 'SY' })
    expect(res).toEqual({ ok: false, reason: 'weak_password', message: expect.any(String) })
  })

  it('treats a thrown network error as offline rather than crashing', async () => {
    signUp.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await signUpOwner({ phone: '0944', password: 'secret123', shopName: 's', businessType: 'general', country: 'SY' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('offline')
  })

  it('carries a trimmed, lowercased recovery_email in metadata when provided', async () => {
    await signUpOwner({
      phone: '+963944123456', password: 'secret123',
      shopName: 's', businessType: 'general', country: 'SY',
      recoveryEmail: '  Owner@Example.COM ',
    })
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: { data: expect.objectContaining({ recovery_email: 'owner@example.com' }) },
    }))
  })

  it('omits recovery_email entirely when not provided or blank', async () => {
    await signUpOwner({ phone: '0944', password: 'secret123', shopName: 's', businessType: 'general', country: 'SY', recoveryEmail: '   ' })
    expect(signUp).toHaveBeenCalled()
    const call = signUp.mock.calls.at(-1)![0]
    expect(call.options.data).not.toHaveProperty('recovery_email')
  })
})

describe('signIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
  })

  it('signs in with the synthetic email derived from the phone', async () => {
    const res = await signIn({ phone: '+963944123456', password: 'secret123' })
    expect(res.ok).toBe(true)
    expect(signInWithPassword).toHaveBeenCalledWith({ email: '963944123456@wafi.app', password: 'secret123' })
  })

  it('maps invalid credentials to a distinct reason', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } })
    const res = await signIn({ phone: '0944', password: 'wrong' })
    expect(res).toEqual({ ok: false, reason: 'invalid_credentials', message: expect.any(String) })
  })

  it('maps a network failure to offline', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Network request failed' } })
    const res = await signIn({ phone: '0944', password: 'secret123' })
    expect(res).toEqual({ ok: false, reason: 'offline', message: expect.any(String) })
  })
})

describe('verifyAccountPassword (WAFI-056 owner self-recovery)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({ data: { user: { email: '963944123456@wafi.app' } }, error: null })
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
  })

  it('verifies the current account against its own email + the supplied password', async () => {
    const res = await verifyAccountPassword('secret123')
    expect(res.ok).toBe(true)
    expect(signInWithPassword).toHaveBeenCalledWith({ email: '963944123456@wafi.app', password: 'secret123' })
  })

  it('reports invalid credentials on a wrong password (does not reset the PIN)', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } })
    const res = await verifyAccountPassword('wrong')
    expect(res).toEqual({ ok: false, reason: 'invalid_credentials', message: expect.any(String) })
  })

  it('reports offline when there is no reachable account identity', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Failed to fetch' } })
    const res = await verifyAccountPassword('secret123')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('offline')
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('treats a thrown network error as offline', async () => {
    getUser.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await verifyAccountPassword('secret123')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('offline')
  })
})

describe('signOut', () => {
  it('delegates to the Supabase client', async () => {
    signOut.mockResolvedValue({ error: null })
    await serviceSignOut()
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
