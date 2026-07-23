import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const openWhatsAppMock = vi.fn()
vi.mock('@/features/messaging/whatsapp', () => ({
  openWhatsApp: (...args: unknown[]) => openWhatsAppMock(...args),
}))

import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue'

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPPORT_WHATSAPP_PHONE', '963900000000')
  })

  it('shows the assisted-reset instructions in Arabic', () => {
    const wrapper = mount(ForgotPasswordPage)
    expect(wrapper.text()).toContain('تواصل')
  })

  it('opens WhatsApp to the support number when the contact button is clicked', async () => {
    const wrapper = mount(ForgotPasswordPage)
    const contactButton = wrapper.findAll('button').find(b => b.text().includes('واتساب'))
    expect(contactButton).toBeTruthy()
    await contactButton!.trigger('click')
    expect(openWhatsAppMock).toHaveBeenCalledWith('963900000000', expect.any(String))
  })
})
