import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }))

vi.mock('@/features/staff/components/StaffForm.vue', () => ({
  default: { template: '<button @click="$emit(\'submit\', \'Test Owner\', \'0000\')">done</button>' },
}))

const seedDemoProducts = vi.fn(async () => {})
vi.mock('@/features/onboarding/composables/useDemoDataSeed', () => ({
  useDemoDataSeed: () => ({ seedDemoProducts }),
}))

vi.mock('@/features/exchange-rate/ExchangeRateEditor.vue', () => ({
  default: { template: '<div class="stub-rate-editor" @click="$emit(\'close\')"></div>' },
}))

// Added for the bootstrap-RPC rewiring (design doc 2026-07-26).
const bootstrapOwnerMock = vi.fn()
vi.mock('@/features/staff/composables/useOwnerBootstrap', () => ({
  useOwnerBootstrap: () => ({ bootstrapOwner: bootstrapOwnerMock, resumePendingBootstrap: vi.fn() }),
}))
// Pre-existing tests below don't set bootstrapOwnerMock themselves -- give it
// a sane default ('done') so the StaffForm stub's @submit still completes the
// flow the same way its old @done emit used to. clearAllMocks() (used in both
// this file's beforeEach hooks) clears call history, not implementations, so
// this default survives across all tests unless a test overrides it.
bootstrapOwnerMock.mockResolvedValue({ status: 'done' })

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

  it('does not seed demo products twice when ExchangeRateEditor emits both saved and close on a real save (regression)', async () => {
    store.startGoal = 'explore'
    const wrapper = mount(OwnerSetupScreen, {
      global: {
        stubs: {
          ExchangeRateEditor: {
            template: '<div class="stub-rate-editor" @click="$emit(\'saved\'); $emit(\'close\')"></div>',
          },
        },
      },
    })
    await wrapper.find('button').trigger('click')  // StaffForm stub emits 'done'
    await wrapper.find('.stub-rate-editor').trigger('click')  // emits 'saved' then 'close', mirroring real save

    expect(seedDemoProducts).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/onboarding')
  })
})

describe('OwnerSetupScreen bootstrap rewiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bootstrapOwnerMock.mockReset()
    // These tests need the REAL StaffForm (fields/PinPad) to drive the
    // bootstrap flow end to end, unlike the tests above which rely on the
    // file-level StaffForm stub. Unmock + reset the module cache so the
    // dynamic imports below resolve the real component.
    vi.doUnmock('@/features/staff/components/StaffForm.vue')
    vi.resetModules()
  })

  it('calls bootstrapOwner (not the local-only createStaff path) with the entered name and pin', async () => {
    bootstrapOwnerMock.mockResolvedValue({ status: 'done' })
    const { mount } = await import('@vue/test-utils')
    const OwnerSetupScreen = (await import('@/features/shifts/components/OwnerSetupScreen.vue')).default

    const wrapper = mount(OwnerSetupScreen, { global: { stubs: { PinPad: true, ExchangeRateEditor: true } } })
    await wrapper.find('.field-input').setValue('Owner Name')
    await wrapper.find('.btn-next').trigger('click')
    // PinPad is stubbed; simulate its @complete emit twice (pin entry + confirm)
    const pinPad = wrapper.findComponent({ name: 'PinPad' })
    await pinPad.vm.$emit('complete', '1234')
    await pinPad.vm.$emit('complete', '1234')

    expect(bootstrapOwnerMock).toHaveBeenCalledWith('Owner Name', '1234')
  })

  it('shows a retry/continue-later prompt when bootstrapOwner reports a timeout', async () => {
    bootstrapOwnerMock.mockResolvedValue({ status: 'timeout' })
    const { mount } = await import('@vue/test-utils')
    const OwnerSetupScreen = (await import('@/features/shifts/components/OwnerSetupScreen.vue')).default

    const wrapper = mount(OwnerSetupScreen, { global: { stubs: { PinPad: true, ExchangeRateEditor: true } } })
    await wrapper.find('.field-input').setValue('Owner Name')
    await wrapper.find('.btn-next').trigger('click')
    const pinPad = wrapper.findComponent({ name: 'PinPad' })
    await pinPad.vm.$emit('complete', '1234')
    await pinPad.vm.$emit('complete', '1234')
    const { flushPromises } = await import('@vue/test-utils')
    await flushPromises()

    expect(wrapper.text()).toContain('لا يزال قيد المزامنة')
    expect(wrapper.find('.bootstrap-retry-btn').exists()).toBe(true)
    expect(wrapper.find('.bootstrap-continue-later-btn').exists()).toBe(true)
  })
})
