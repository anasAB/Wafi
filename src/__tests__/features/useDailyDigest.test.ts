import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { useDailyDigest } from '@/features/messaging/useDailyDigest'
import { useSettingsStore } from '@/features/settings'

describe('useDailyDigest', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue({ total: 0 } as any)
  })

  it('does not prompt before configured hour', () => {
    const settings = useSettingsStore()
    settings.dailyDigestEnabled = true
    settings.dailyDigestPhone = '0991234567'
    settings.dailyDigestHour = 20

    const digest = useDailyDigest()
    expect(digest.shouldPromptNow(new Date('2026-07-13T19:00:00'))).toBe(false)
  })

  it('prompts after hour when enabled and phone exists', () => {
    const settings = useSettingsStore()
    settings.dailyDigestEnabled = true
    settings.dailyDigestPhone = '0991234567'
    settings.dailyDigestHour = 20

    const digest = useDailyDigest()
    expect(digest.shouldPromptNow(new Date('2026-07-13T21:00:00'))).toBe(true)
  })

  it('prepareIfReady marks today and returns digest text', async () => {
    const settings = useSettingsStore()
    settings.dailyDigestEnabled = true
    settings.dailyDigestPhone = '0991234567'
    settings.dailyDigestHour = 8

    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ total: 420 } as any)
      .mockResolvedValueOnce({ total: 250 } as any)
      .mockResolvedValueOnce({ total: 75 } as any)
      .mockResolvedValueOnce({ count: 3 } as any)
      .mockResolvedValueOnce({ total: 1200 } as any)

    const digest = useDailyDigest()
    const result = await digest.prepareIfReady(new Date('2026-07-13T09:00:00'))

    expect(result.ready).toBe(true)
    expect(result.text).toContain('مبيعات اليوم')
    expect(result.text).toContain('ربح اليوم')

    expect(digest.shouldPromptNow(new Date('2026-07-13T10:00:00'))).toBe(false)
  })
})
