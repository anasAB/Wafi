import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// Control the composable so the test drives the blocked-ops state directly.
const blockedCount    = ref(0)
const deadLetter      = ref<any[]>([])
const retryBlocked    = vi.fn(async () => ({ status: 'recovered' as const }))
const discardBlocked  = vi.fn(async () => {})
const refreshDeadLetter = vi.fn(async () => {})
vi.mock('@/features/sync/useSync', () => ({
  useSync: () => ({
    status: ref('online'), pendingCount: ref(0), blockedCount,
    lastSyncedAt: ref(null), isStale: ref(false), errorMessage: ref(null),
    syncNow: vi.fn(), deadLetter, refreshDeadLetter, retryBlocked, discardBlocked,
  }),
}))
// ConnectionPill pulls in browser listeners — stub it; it's not under test here.
vi.mock('@/components/ui/ConnectionPill.vue', () => ({ default: { template: '<span />' } }))

import SyncIndicator from '@/features/sync/SyncIndicator.vue'

const entry = (over: Record<string, any> = {}) => ({
  id: 'dl-1', client_id: 1, op_type: 'PUT', table_name: 'sales', row_id: 's1',
  op_data: '{}', error_code: '23505', error_message: 'duplicate key', failed_at: 't', ...over,
})

async function openPanel(w: ReturnType<typeof mount>) {
  await w.find('.sync-trigger').trigger('click')
  await w.vm.$nextTick()
}

describe('SyncIndicator — blocked ops', () => {
  beforeEach(() => {
    blockedCount.value = 0
    deadLetter.value = []
    vi.clearAllMocks()
  })

  it('shows a distinct blocked note on the trigger, separate from offline', async () => {
    blockedCount.value = 2
    const w = mount(SyncIndicator)
    const note = w.find('.sync-trigger-note--blocked')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('2')
  })

  it('lists each blocked op with an owner-language label', async () => {
    deadLetter.value = [entry({ table_name: 'customer_payments' })]
    const w = mount(SyncIndicator)
    await openPanel(w)
    expect(refreshDeadLetter).toHaveBeenCalled()
    expect(w.find('.sync-blocked-op').text()).toBe('دفعة عميل')
    expect(w.find('.sync-blocked-reason').text()).toBe('duplicate key')
  })

  it('requires a confirmation tap before discarding (never drops a write on a single click)', async () => {
    deadLetter.value = [entry()]
    const w = mount(SyncIndicator)
    await openPanel(w)

    const discardBtn = w.find('.sync-mini-btn--discard')
    await discardBtn.trigger('click')
    expect(discardBlocked).not.toHaveBeenCalled()      // first tap only arms it
    expect(discardBtn.text()).toBe('تأكيد الحذف')

    await discardBtn.trigger('click')
    expect(discardBlocked).toHaveBeenCalledWith('dl-1') // second tap confirms
  })

  it('surfaces an offline message when a retry fails transiently', async () => {
    deadLetter.value = [entry()]
    retryBlocked.mockResolvedValueOnce({ status: 'transient' as any })
    const w = mount(SyncIndicator)
    await openPanel(w)

    await w.find('.sync-mini-btn--retry').trigger('click')
    await w.vm.$nextTick()

    expect(retryBlocked).toHaveBeenCalledWith('dl-1')
    expect(w.find('.sync-blocked-feedback').text()).toContain('تعذّر الاتصال')
  })
})
