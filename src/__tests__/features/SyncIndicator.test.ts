import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// Control the composable so the test drives the blocked-ops state directly.
const blockedCount    = ref(0)
const deadLetter      = ref<any[]>([])
const retryBlocked    = vi.fn(async () => ({ status: 'recovered' as const }))
const discardBlocked  = vi.fn(async () => {})
const refreshDeadLetter = vi.fn(async () => {})
// WAFI-135: role gating flags — tests default to full (owner) capability.
const canRetryBlocked   = ref(true)
const canDiscardBlocked = ref(true)
vi.mock('@/features/sync/useSync', () => ({
  useSync: () => ({
    status: ref('online'), pendingCount: ref(0), blockedCount,
    lastSyncedAt: ref(null), isStale: ref(false), errorMessage: ref(null),
    syncNow: vi.fn(), deadLetter, refreshDeadLetter, retryBlocked, discardBlocked,
    canRetryBlocked, canDiscardBlocked,
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
    canRetryBlocked.value = true
    canDiscardBlocked.value = true
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

  // WAFI-135 role gating in the UI (defense-in-depth: functions also refuse).
  it('cashier sees the blocked list with a review notice and NO action buttons', async () => {
    canRetryBlocked.value = false
    canDiscardBlocked.value = false
    deadLetter.value = [entry()]
    const w = mount(SyncIndicator)
    await openPanel(w)

    expect(w.find('.sync-blocked-help').text()).toContain('بحاجة لمراجعة المالك')
    expect(w.find('.sync-mini-btn--retry').exists()).toBe(false)
    expect(w.find('.sync-mini-btn--discard').exists()).toBe(false)
  })

  it('manager sees retry but not discard', async () => {
    canRetryBlocked.value = true
    canDiscardBlocked.value = false
    deadLetter.value = [entry()]
    const w = mount(SyncIndicator)
    await openPanel(w)

    expect(w.find('.sync-mini-btn--retry').exists()).toBe(true)
    expect(w.find('.sync-mini-btn--discard').exists()).toBe(false)
  })

  it('the armed discard confirm shows a readable summary of what will be dropped', async () => {
    deadLetter.value = [entry()]
    const w = mount(SyncIndicator)
    await openPanel(w)

    await w.find('.sync-mini-btn--discard').trigger('click') // arm
    const confirm = w.find('.sync-blocked-confirm')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('بيع')            // op label
    expect(confirm.text()).toContain('duplicate key')  // rejection reason
  })
})
