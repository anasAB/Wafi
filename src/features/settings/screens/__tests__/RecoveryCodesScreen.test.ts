import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { i18n } from '@/i18n'

const generate = vi.fn()
const remaining = vi.fn()
vi.mock('@/features/staff/composables/useRecoveryCodes', () => ({
  useRecoveryCodes: () => ({ generate, remaining, verifyAndConsume: vi.fn() }),
  RECOVERY_CODE_COUNT: 8,
}))
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({ logRecoveryCodesGenerated: vi.fn() }),
}))

import RecoveryCodesScreen from '../RecoveryCodesScreen.vue'
import { useSessionStore } from '@/store/session.store'

function mountIt() {
  return mount(RecoveryCodesScreen, {
    global: {
      plugins: [i18n],
      stubs: { AppHeader: true, RouterView: true, RouterLink: true },
    },
  })
}

describe('RecoveryCodesScreen (WAFI-057)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    remaining.mockResolvedValue(8)
    const session = useSessionStore()
    session.setActiveStaff({ id: 'owner-1', name: 'أحمد', role: 'owner' } as any)
  })

  it('reveals the generated codes exactly once and hides them again on done', async () => {
    generate.mockResolvedValue(['ABCD2345', 'EFGH6789'])
    const w = mountIt()
    await w.get('[data-test="generate"]').trigger('click')
    await Promise.resolve(); await Promise.resolve()
    expect(w.text()).toContain('ABCD2345')
    await w.get('[data-test="codes-done"]').trigger('click')
    expect(w.text()).not.toContain('ABCD2345')
  })
})
