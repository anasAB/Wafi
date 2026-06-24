import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
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

// The owner row as it lives in the DB (the single source PinRecovery/LockScreen
// verify against). loadStaff() populates the staff list with this row.
const ownerRow = { id: 'owner-DB', name: 'أحمد', role: 'owner', permissions: {} }
const staffRef = ref<any[]>([])
const loadStaff = vi.fn(async () => { staffRef.value = [ownerRow] })
vi.mock('@/features/staff/composables/useStaff', () => ({
  useStaff: () => ({ staff: staffRef, loadStaff }),
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
    staffRef.value = []
    remaining.mockResolvedValue(8)
  })

  it('reveals the generated codes exactly once and hides them again on done', async () => {
    generate.mockResolvedValue(['ABCD2345', 'EFGH6789'])
    const w = mountIt()
    await flushPromises()
    await w.get('[data-test="generate"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('ABCD2345')
    await w.get('[data-test="codes-done"]').trigger('click')
    expect(w.text()).not.toContain('ABCD2345')
  })

  it('generates against the live DB owner row, not a stale persisted session id', async () => {
    // Regression: codes were generated against session.activeStaff.id, which can
    // be a stale persisted id that no longer matches the live owner row. The
    // write then hit zero rows while the screen still showed "success", so the
    // codes never verified. Generation must key off the same row verification reads.
    useSessionStore().setActiveStaff({ id: 'owner-STALE', name: 'أحمد', role: 'owner' } as any)
    generate.mockResolvedValue(['ABCD2345'])
    const w = mountIt()
    await flushPromises()
    await w.get('[data-test="generate"]').trigger('click')
    await flushPromises()
    expect(generate).toHaveBeenCalledWith('owner-DB')
  })
})
