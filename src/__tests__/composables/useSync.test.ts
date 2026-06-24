import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ refreshShopId: vi.fn() }) }))
vi.mock('@/data/supabase/client', () => ({ supabase: { auth: { getSession: vi.fn() } } }))

const countDeadLetter    = vi.fn(async () => 0)
const listDeadLetter     = vi.fn(async () => [] as any[])
const retryDeadLetterOp  = vi.fn(async () => ({ status: 'recovered' }))
const discardDeadLetterOp = vi.fn(async () => {})
vi.mock('@/data/powersync/dead-letter', () => ({
  countDeadLetter:    (...a: any[]) => countDeadLetter(...a),
  listDeadLetter:     (...a: any[]) => listDeadLetter(...a),
  retryDeadLetterOp:  (...a: any[]) => retryDeadLetterOp(...a),
  discardDeadLetterOp: (...a: any[]) => discardDeadLetterOp(...a),
}))

import { useSync } from '@/features/sync/useSync'
import { db } from '@/data/powersync/db'
import { useSyncStore } from '@/store/sync.store'

function mountSync() {
  let api: ReturnType<typeof useSync>
  const w = mount({ setup: () => { api = useSync(); return () => null } })
  return { api: api!, w }
}

describe('useSync — pending + blocked counts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([{ n: 0 }] as any)
    countDeadLetter.mockResolvedValue(0)
    listDeadLetter.mockResolvedValue([])
  })

  it('pendingCount reflects the real ps_crud upload-queue depth on mount', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{ n: 4 }] as any)
    mountSync()
    await nextTick(); await nextTick()

    expect(vi.mocked(db.getAll)).toHaveBeenCalledWith(expect.stringContaining('ps_crud'))
    expect(useSyncStore().pendingCount).toBe(4)
  })

  it('blockedCount reflects the dead-letter holding depth on mount', async () => {
    countDeadLetter.mockResolvedValue(2)
    const { api } = mountSync()
    await nextTick(); await nextTick()

    expect(useSyncStore().blockedCount).toBe(2)
    expect(api.blockedCount.value).toBe(2)
  })

  it('retryBlocked delegates to the holding and refreshes the list + counts', async () => {
    const { api } = mountSync()
    await nextTick()
    retryDeadLetterOp.mockResolvedValueOnce({ status: 'recovered' })

    const result = await api.retryBlocked('dl-1')

    expect(retryDeadLetterOp).toHaveBeenCalledWith(db, 'dl-1')
    expect(result.status).toBe('recovered')
    expect(listDeadLetter).toHaveBeenCalled()       // list refreshed
    expect(countDeadLetter).toHaveBeenCalled()       // count refreshed
  })

  it('discardBlocked delegates to the holding and refreshes', async () => {
    const { api } = mountSync()
    await nextTick()

    await api.discardBlocked('dl-9')

    expect(discardDeadLetterOp).toHaveBeenCalledWith(db, 'dl-9')
    expect(listDeadLetter).toHaveBeenCalled()
  })

  it('refreshDeadLetter loads the held ops into the exposed list', async () => {
    listDeadLetter.mockResolvedValue([
      { id: 'dl-1', op_type: 'PUT', table_name: 'sales', row_id: 's1', error_message: 'dup', failed_at: 't' },
    ] as any)
    const { api } = mountSync()
    await api.refreshDeadLetter()

    expect(api.deadLetter.value).toHaveLength(1)
    expect(api.deadLetter.value[0].row_id).toBe('s1')
  })
})
