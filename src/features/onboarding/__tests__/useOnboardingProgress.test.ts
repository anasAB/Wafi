import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { loadOnboardingProgress } from '@/features/onboarding/useOnboardingProgress'

describe('loadOnboardingProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all false when shop id is missing', async () => {
    const progress = await loadOnboardingProgress('')

    expect(progress).toEqual({
      productsDone: false,
      posDone: false,
      teamDone: false,
      profileDone: false,
    })
    expect(db.getOptional).not.toHaveBeenCalled()
  })

  it('maps db counts and receipt profile fields to progress', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ count: 3 } as any)
      .mockResolvedValueOnce({ count: 1 } as any)
      .mockResolvedValueOnce({ count: 2 } as any)
      .mockResolvedValueOnce({ shop_name: '', tax_number: '123', header_text: '', footer_text: '' } as any)

    const progress = await loadOnboardingProgress('shop-1')

    expect(progress).toEqual({
      productsDone: true,
      posDone: true,
      teamDone: true,
      profileDone: true,
    })
  })

  it('keeps profile step incomplete when receipt settings are empty', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ count: 1 } as any)
      .mockResolvedValueOnce({ count: 0 } as any)
      .mockResolvedValueOnce({ count: 0 } as any)
      .mockResolvedValueOnce({ shop_name: '', tax_number: '', header_text: '', footer_text: '' } as any)

    const progress = await loadOnboardingProgress('shop-1')

    expect(progress.profileDone).toBe(false)
    expect(progress.posDone).toBe(false)
    expect(progress.teamDone).toBe(false)
  })
})
