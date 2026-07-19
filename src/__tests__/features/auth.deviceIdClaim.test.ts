import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Spy is hoisted so it exists when the (hoisted) vi.mock factory runs — see
// src/__tests__/data/auth.test.ts for the same pattern.
const { signInWithPasswordMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn().mockResolvedValue({ error: null }),
}))
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: signInWithPasswordMock,
      // device.store.ts wires onAuthStateChange/getSession at module scope —
      // needed here only so importing useDeviceStore doesn't throw.
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}))

import { signIn } from '@/data/supabase/auth'
import { useDeviceStore } from '@/store/device.store'

describe('signIn embeds device_id for the access-token hook', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    signInWithPasswordMock.mockClear()
    useDeviceStore().deviceId = 'device-123'
  })

  it('passes the current device_id in signInWithPassword options.data', async () => {
    await signIn({ phone: '0999999999', password: 'x' })

    expect(signInWithPasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ data: { device_id: 'device-123' } }),
      }),
    )
  })
})
