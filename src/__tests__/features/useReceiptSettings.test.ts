import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'
import { db } from '@/data/powersync/db'

describe('useReceiptSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('settings defaults to empty strings', () => {
    const { settings } = useReceiptSettings()
    expect(settings.value.shopName).toBe('')
    expect(settings.value.taxNumber).toBe('')
    expect(settings.value.headerText).toBe('')
    expect(settings.value.footerText).toBe('')
  })

  it('load sets settings to empty defaults when no row exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { settings, load } = useReceiptSettings()
    await load()
    expect(settings.value.shopName).toBe('')
  })

  it('load maps row to settings', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 's1', shop_id: 's1', shop_name: 'محل الإلكترونيات',
      tax_number: '12345678', header_text: 'Accessories', footer_text: 'شكراً',
      updated_at: '2025-01-01T00:00:00Z', sync_status: 'synced',
    } as any)
    const { settings, load } = useReceiptSettings()
    await load()
    expect(settings.value.shopName).toBe('محل الإلكترونيات')
    expect(settings.value.taxNumber).toBe('12345678')
    expect(settings.value.footerText).toBe('شكراً')
  })

  it('save calls INSERT OR REPLACE INTO receipt_settings', async () => {
    const { save } = useReceiptSettings()
    await save({ shopName: 'محل', taxNumber: '999', headerText: '', footerText: 'شكراً' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO receipt_settings'),
      expect.any(Array)
    )
  })

  it('save updates settings ref after saving', async () => {
    const { settings, save } = useReceiptSettings()
    await save({ shopName: 'New Shop', taxNumber: '', headerText: '', footerText: '' })
    expect(settings.value.shopName).toBe('New Shop')
  })
})
