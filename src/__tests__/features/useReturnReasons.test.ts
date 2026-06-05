import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReturnReasons } from '@/features/returns/composables/useReturnReasons'
import { db } from '@/data/powersync/db'

describe('useReturnReasons', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('queries only active reasons for the shop ordered by sort_order', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { loadReasons } = useReturnReasons()
    await loadReasons()
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('is_active'),
      expect.arrayContaining(['00000000-0000-0000-0000-000000000001']),
    )
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('sort_order'),
      expect.any(Array),
    )
  })

  it('maps db rows to ReturnReason objects', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'r1', label: 'عيب في المنتج', sort_order: 0 },
      { id: 'r2', label: 'خطأ في البيع',  sort_order: 1 },
    ])
    const { reasons, loadReasons } = useReturnReasons()
    await loadReasons()
    expect(reasons.value).toHaveLength(2)
    expect(reasons.value[0]).toEqual({ id: 'r1', label: 'عيب في المنتج', sortOrder: 0 })
    expect(reasons.value[1]).toEqual({ id: 'r2', label: 'خطأ في البيع',  sortOrder: 1 })
  })

  it('returns empty array when no reasons configured', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const { reasons, loadReasons } = useReturnReasons()
    await loadReasons()
    expect(reasons.value).toEqual([])
  })
})
