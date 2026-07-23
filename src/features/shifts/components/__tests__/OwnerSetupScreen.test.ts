import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }))

vi.mock('@/features/staff/components/StaffForm.vue', () => ({
  default: { template: '<button @click="$emit(\'done\')">done</button>' },
}))

const seedDemoProducts = vi.fn(async () => {})
vi.mock('@/features/onboarding/composables/useDemoDataSeed', () => ({
  useDemoDataSeed: () => ({ seedDemoProducts }),
}))

vi.mock('@/features/exchange-rate/ExchangeRateEditor.vue', () => ({
  default: { template: '<div class="stub-rate-editor" @click="$emit(\'close\')"></div>' },
}))

import { store } from '@/store'
import OwnerSetupScreen from '@/features/shifts/components/OwnerSetupScreen.vue'

describe('OwnerSetupScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store.startGoal = ''
  })

  it('shows the exchange-rate prompt after PIN setup, then routes to /pos for the "sell" goal', async () => {
    store.startGoal = 'sell'
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')  // StaffForm stub emits 'done'

    expect(wrapper.find('.stub-rate-editor').exists()).toBe(true)
    expect(pushMock).not.toHaveBeenCalled()  // not yet -- rate prompt still showing

    await wrapper.find('.stub-rate-editor').trigger('click')  // emits 'close' (skip)
    expect(pushMock).toHaveBeenCalledWith('/pos')
  })

  it('routes to /products/add for the "inventory" goal', async () => {
    store.startGoal = 'inventory'
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')
    await wrapper.find('.stub-rate-editor').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/products/add')
  })

  it('seeds demo products and routes to /onboarding for the "explore" goal', async () => {
    store.startGoal = 'explore'
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')
    await wrapper.find('.stub-rate-editor').trigger('click')

    expect(seedDemoProducts).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/onboarding')
  })

  it('falls back to / when startGoal is empty', async () => {
    store.startGoal = ''
    const wrapper = mount(OwnerSetupScreen)
    await wrapper.find('button').trigger('click')
    await wrapper.find('.stub-rate-editor').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/')
    expect(seedDemoProducts).not.toHaveBeenCalled()
  })
})
