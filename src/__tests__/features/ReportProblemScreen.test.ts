import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

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

describe('ReportProblemScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPPORT_WHATSAPP_PHONE', '963900000000')
  })

  it('opens WhatsApp with the support phone and a message containing the current route', async () => {
    const wrapper = mount(ReportProblemScreen)
    await wrapper.find('button').trigger('click')

    expect(openWhatsAppMock).toHaveBeenCalledTimes(1)
    const [phone, text] = openWhatsAppMock.mock.calls[0]
    expect(phone).toBe('963900000000')
    expect(text).toContain('/settings/report-problem')
  })

  it('includes the entered description text in the WhatsApp message', async () => {
    const wrapper = mount(ReportProblemScreen)
    await wrapper.find('textarea').setValue('البرنامج توقف عند البيع')
    await wrapper.find('button').trigger('click')

    const [, text] = openWhatsAppMock.mock.calls[0]
    expect(text).toContain('البرنامج توقف عند البيع')
  })
})
