import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { resolveFlag, FLAG_KEYS } from '@/features/flags/flagRegistry'
import { useFlagsStore } from '@/features/flags/flags.store'
import { db } from '@/data/powersync/db'

describe('flagRegistry.resolveFlag (WAFI-131 semantics)', () => {
  it('null features (legacy / not yet synced shop row) → everything ON (grandfathered)', () => {
    for (const key of FLAG_KEYS) expect(resolveFlag(null, key)).toBe(true)
  })

  it('key missing from the blob → OFF (new features default closed)', () => {
    expect(resolveFlag({}, 'reporting_pack')).toBe(false)
    expect(resolveFlag({ staff_pack: true }, 'reporting_pack')).toBe(false)
  })

  it('explicit true/false are honored; garbage values are OFF', () => {
    expect(resolveFlag({ reporting_pack: true }, 'reporting_pack')).toBe(true)
    expect(resolveFlag({ reporting_pack: false }, 'reporting_pack')).toBe(false)
    expect(resolveFlag({ reporting_pack: 'yes' }, 'reporting_pack')).toBe(false)
  })
})

describe('useFlagsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('reads the synced shops row and gates by it', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      features: JSON.stringify({ staff_pack: true, reporting_pack: false }),
    } as any)
    const store = useFlagsStore()
    await store.ensureLoaded()

    expect(store.isEnabled('staff_pack')).toBe(true)
    expect(store.isEnabled('reporting_pack')).toBe(false)
    expect(store.isEnabled('customer_pack')).toBe(false) // missing → closed
  })

  it('no shop row yet (first-sync race) → all on, never bricks the app', async () => {
    vi.mocked(db.getOptional).mockResolvedValue(null)
    const store = useFlagsStore()
    await store.ensureLoaded()
    expect(store.isEnabled('reporting_pack')).toBe(true)
  })

  it('unreadable blob → fail open with grandfather semantics', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ features: '{not json' } as any)
    const store = useFlagsStore()
    await store.ensureLoaded()
    expect(store.isEnabled('staff_pack')).toBe(true)
  })

  it('ensureLoaded reads once; load() re-reads (flag change applies on next app start/sync)', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({ features: '{}' } as any)
    const store = useFlagsStore()
    await store.ensureLoaded()
    await store.ensureLoaded()
    expect(db.getOptional).toHaveBeenCalledTimes(1)

    vi.mocked(db.getOptional).mockResolvedValue({ features: JSON.stringify({ reporting_pack: true }) } as any)
    await store.load()
    expect(store.isEnabled('reporting_pack')).toBe(true)
  })
})
