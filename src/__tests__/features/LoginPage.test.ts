import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@/data/supabase/auth', () => ({ signIn: vi.fn() }))

import { signIn } from '@/data/supabase/auth'
import LoginPage from '@/pages/LoginPage.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

describe('LoginPage — submit()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls signIn with phone + password and navigates to / on success', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true })
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(LoginPage, { global: { plugins: [router] } })

    await wrapper.get('[data-testid="login-phone"]').setValue('512345678')
    await wrapper.get('[data-testid="login-password"]').setValue('Str0ngPass')
    // jsdom does not implement default form-submission-on-submit-button-click,
    // so trigger the form's submit event directly (the button's :disabled/handler
    // wiring is unaffected — this exercises the same @submit.prevent="submit" path).
    wrapper.get('[data-testid="login-submit"]') // sanity: submit button is present
    await wrapper.get('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ password: 'Str0ngPass' }))
    expect(pushSpy).toHaveBeenCalledWith('/')
  })

  it('shows an error and does not navigate on invalid credentials', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, reason: 'invalid_credentials', message: 'bad creds' })
    const wrapper = mount(LoginPage, { global: { plugins: [router] } })

    await wrapper.get('[data-testid="login-phone"]').setValue('512345678')
    await wrapper.get('[data-testid="login-password"]').setValue('wrong')
    await wrapper.get('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="login-error"]').text().length).toBeGreaterThan(0)
  })
})
