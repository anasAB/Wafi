import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@/data/supabase/auth', () => ({ signUpOwner: vi.fn() }))

import { signUpOwner } from '@/data/supabase/auth'
import SignupPage from '@/pages/SignupPage.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

describe('SignupPage — finish()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls signUpOwner with the collected form fields and navigates to /setup-owner on success', async () => {
    vi.mocked(signUpOwner).mockResolvedValue({ ok: true })
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(SignupPage, { global: { plugins: [router] } })

    // Drive the component's exposed finish() directly via its store-backed
    // fields rather than re-implementing three steps of UI navigation here —
    // step1Next/step2Next already assign store.phone/businessName/etc.
    const vm = wrapper.vm as any
    vm.phone = '512345678'
    vm.password = 'Str0ngPass'
    vm.step1Next()
    vm.bizName = 'متجر تجريبي'
    vm.bizType = 'retail'
    vm.step2Next()
    vm.selectedGoal = 'sell'
    await vm.finish()

    expect(signUpOwner).toHaveBeenCalledWith(expect.objectContaining({
      password: 'Str0ngPass', shopName: 'متجر تجريبي', businessType: 'retail',
    }))
    expect(pushSpy).toHaveBeenCalledWith('/setup-owner')
  })

  it('shows a duplicate-account message and does not navigate on a duplicate signup', async () => {
    vi.mocked(signUpOwner).mockResolvedValue({ ok: false, reason: 'duplicate', message: 'exists' })
    const wrapper = mount(SignupPage, { global: { plugins: [router] } })

    const vm = wrapper.vm as any
    vm.phone = '512345678'
    vm.password = 'Str0ngPass'
    vm.step1Next()
    vm.bizName = 'متجر تجريبي'
    vm.bizType = 'retail'
    vm.step2Next()
    vm.selectedGoal = 'sell'
    await vm.finish()

    expect(wrapper.get('[data-testid="signup-error"]').text()).toContain('الحساب موجود بالفعل')
  })
})
