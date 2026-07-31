import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const openWhatsAppMock = vi.fn()
vi.mock('@/features/messaging/whatsapp', () => ({
  openWhatsApp: (...args: unknown[]) => openWhatsAppMock(...args),
}))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => ({ path: '/settings/report-problem' }),
}))

import ReportProblemScreen from '@/features/settings/screens/ReportProblemScreen.vue'
import { db } from '@/data/powersync/db'

describe('ReportProblemScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPPORT_WHATSAPP_PHONE', '963900000000')
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('opens WhatsApp with the support phone and a message containing the current route', async () => {
    const wrapper = mount(ReportProblemScreen)
    await wrapper.find('button').trigger('click')

    expect(openWhatsAppMock).toHaveBeenCalledTimes(1)
    const [phone, text] = openWhatsAppMock.mock.calls[0]
    expect(phone).toBe('963900000000')
    expect(text).toContain('/settings/report-problem')

    expect(db.execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['messaging.whatsapp_composed', 'messaging']),
    )
  })

  it('includes the entered description text in the WhatsApp message', async () => {
    const wrapper = mount(ReportProblemScreen)
    await wrapper.find('textarea').setValue('البرنامج توقف عند البيع')
    await wrapper.find('button').trigger('click')

    const [, text] = openWhatsAppMock.mock.calls[0]
    expect(text).toContain('البرنامج توقف عند البيع')
  })
})
