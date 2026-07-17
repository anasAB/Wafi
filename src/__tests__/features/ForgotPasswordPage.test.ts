import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue'

describe('ForgotPasswordPage', () => {
  it('shows the assisted-reset instructions in Arabic', () => {
    const wrapper = mount(ForgotPasswordPage)
    expect(wrapper.text()).toContain('تواصل')
  })
})
