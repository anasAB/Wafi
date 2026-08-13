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

  it('isRolloutEnabled reads rollout state from the same loaded features as isEnabled, with no extra query', async () => {
    vi.mocked(db.getOptional).mockResolvedValue({
      features: JSON.stringify({ staff_pack: true, rollout: { dashboard_v2: true } }),
    } as any)
    const store = useFlagsStore()
    await store.ensureLoaded()
    expect(db.getOptional).toHaveBeenCalledTimes(1)

    // Call both isEnabled and isRolloutEnabled multiple times; verify no extra queries
    expect(store.isEnabled('staff_pack')).toBe(true)
    expect(store.isRolloutEnabled('dashboard_v2')).toBe(true)
    expect(store.isRolloutEnabled('pos_brain')).toBe(false)
    expect(store.isEnabled('reporting_pack')).toBe(false)
    expect(db.getOptional).toHaveBeenCalledTimes(1) // Still only 1 call from ensureLoaded
  })
})

import { resolveRollout, ROLLOUT_FLAG_KEYS } from '@/features/flags/flagRegistry'

describe('flagRegistry.resolveRollout (WAFI-155 semantics)', () => {
  it('is fail-closed for every non-true rollout value', () => {
    const cases: unknown[] = [undefined, null, false, 0, 'true', {}, []]
    for (const rollout of cases) {
      expect(resolveRollout({ rollout } as any, 'dashboard_v2')).toBe(false)
    }
  })

  it('resolves true only when the value is the literal boolean true', () => {
    expect(resolveRollout({ rollout: { dashboard_v2: true } }, 'dashboard_v2')).toBe(true)
  })

  it('resolves false when features itself is null', () => {
    expect(resolveRollout(null, 'dashboard_v2')).toBe(false)
  })

  it('exposes exactly the three documented rollout keys', () => {
    expect(ROLLOUT_FLAG_KEYS).toEqual(['dashboard_v2', 'pos_brain', 'insights'])
  })
})
