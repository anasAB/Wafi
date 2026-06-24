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

// Capture the statusChanged listener bindPowerSync registers so tests can drive
// PowerSync status transitions (the shared db mock has no registerListener).
let captured: { statusChanged?: (s: any) => void } = {}

function mountSync() {
  let api: ReturnType<typeof useSync>
  const w = mount({ setup: () => { api = useSync(); return () => null } })
  return { api: api!, w }
}

function setOnline(v: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true })
}

describe('useSync — pending + blocked counts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([{ n: 0 }] as any)
    countDeadLetter.mockResolvedValue(0)
    listDeadLetter.mockResolvedValue([])
    captured = {}
    ;(db as any).registerListener = vi.fn((l: any) => { captured = l; return () => {} })
    setOnline(true)
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

describe('useSync — download errors are distinct from offline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([{ n: 0 }] as any)
    countDeadLetter.mockResolvedValue(0)
    listDeadLetter.mockResolvedValue([])
    captured = {}
    ;(db as any).registerListener = vi.fn((l: any) => { captured = l; return () => {} })
    setOnline(true)
  })

  it('surfaces a download error (server / sync-rules rejection) as a visible problem, not silent offline', async () => {
    mountSync()
    await nextTick()
    captured.statusChanged!({
      connected: false,
      dataFlowStatus: { downloadError: new Error('sync rules rejected table') },
    })
    await nextTick()

    const store = useSyncStore()
    expect(store.status).toBe('offline')
    expect(store.errorMessage).toContain('الخادم')        // names the server, not connectivity
    expect(store.errorMessage).toContain('sync rules rejected table')
  })

  it('keeps genuine offline silent — a connect error while navigator is offline shows no banner', async () => {
    setOnline(false)
    mountSync()
    await nextTick()
    captured.statusChanged!({
      connected: false,
      dataFlowStatus: { downloadError: new Error('Failed to fetch') },
    })
    await nextTick()

    const store = useSyncStore()
    expect(store.status).toBe('offline')
    expect(store.errorMessage).toBeNull()
  })
})

describe('useSync — isStale is time-reactive', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([{ n: 0 }] as any)
    countDeadLetter.mockResolvedValue(0)
    listDeadLetter.mockResolvedValue([])
    captured = {}
    ;(db as any).registerListener = vi.fn((l: any) => { captured = l; return () => {} })
    setOnline(true)
  })

  it('warns a never-synced device that is holding pending writes', async () => {
    vi.mocked(db.getAll).mockResolvedValue([{ n: 3 }] as any) // ps_crud depth
    const { api } = mountSync()
    await nextTick(); await nextTick() // let refreshCounts populate pendingCount

    expect(useSyncStore().pendingCount).toBe(3)
    expect(api.isStale.value).toBe(true)
  })

  it('does not warn a never-synced device with nothing pending', async () => {
    const { api } = mountSync()
    await nextTick(); await nextTick()
    expect(api.isStale.value).toBe(false)
  })

  it('flips to stale as wall-clock time crosses 24h past the last sync', async () => {
    vi.useFakeTimers()
    try {
      const { api } = mountSync()
      await nextTick()
      useSyncStore().setLastSynced(new Date()) // synced "now"
      expect(api.isStale.value).toBe(false)

      vi.advanceTimersByTime(25 * 60 * 60 * 1000) // 25h later
      await nextTick()
      expect(api.isStale.value).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
