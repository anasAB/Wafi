import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { i18n } from '@/i18n'

const verifyAndConsume = vi.fn()
vi.mock('@/features/staff/composables/useRecoveryCodes', () => ({
  useRecoveryCodes: () => ({ verifyAndConsume, generate: vi.fn(), remaining: vi.fn() }),
  normalizeCode: (s: string) => s, RECOVERY_CODE_COUNT: 8,
}))
const updateStaffPin = vi.fn()
vi.mock('@/features/staff/composables/useStaff', () => ({
  useStaff: () => ({ staff: { value: [] }, loadStaff: vi.fn(), resetStaffPin: vi.fn(), updateStaffPin }),
}))
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({ logRecoveryCodeUsed: vi.fn() }),
}))
vi.mock('@/data/supabase/auth', () => ({ verifyAccountPassword: vi.fn() }))

import PinRecovery from '../PinRecovery.vue'

const owner = { id: 'owner-1', name: 'أحمد', role: 'owner', pinHash: 'x', pinSalt: 's', permissions: {}, isActive: true, shopId: 's', createdAt: '' }

function mountIt() {
  return mount(PinRecovery, { props: { target: owner as any }, global: { plugins: [i18n] } })
}

describe('PinRecovery recovery-code path (WAFI-057)', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('offers the recovery-code option for an owner target', () => {
    const w = mountIt()
    expect(w.text()).toContain(i18n.global.t('staff.byRecoveryCode'))
  })

  it('a valid code advances to set-pin; an invalid one shows an error', async () => {
    verifyAndConsume.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const w = mountIt()
    await w.get('[data-test="path-code"]').trigger('click')
    await w.get('[data-test="code-input"]').setValue('BADCODE0')
    await w.get('[data-test="code-submit"]').trigger('click')
    await Promise.resolve(); await Promise.resolve()
    expect(w.text()).toContain(i18n.global.t('staff.wrongRecoveryCode'))

    await w.get('[data-test="code-input"]').setValue('GOODCODE')
    await w.get('[data-test="code-submit"]').trigger('click')
    await Promise.resolve(); await Promise.resolve()
    // Now on the set-pin step — the PIN pad is shown (prompt changed).
    expect(w.text()).toContain(i18n.global.t('staff.newPinFor', { name: owner.name }))
  })
})
