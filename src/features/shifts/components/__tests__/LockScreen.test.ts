import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const pushMock = vi.fn()
const replaceMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, currentRoute: { value: { meta: {} } } }),
}))

const staffMember = { id: 'staff-1', name: 'Owner', role: 'owner', pinHash: 'hash', pinSalt: 'salt' }

vi.mock('@/features/staff/composables/useStaff', () => ({
  useStaff: () => ({ staff: { value: [staffMember] }, loadStaff: vi.fn() }),
}))

// Regression test for the confirmOpen crash fix: verifyPin must resolve truthy
// so onPinComplete proceeds straight to the opening-cash step.
vi.mock('@/features/staff/composables/usePinAuth', () => ({
  verifyPin: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/features/staff/composables/usePinLockout', () => ({
  usePinLockout: () => ({
    isLockedOut: () => false,
    recordFailure: () => ({ locked: false, minutes: 0 }),
    reset: vi.fn(),
  }),
}))

const openShiftMock = vi.fn().mockResolvedValue({ status: 'ok' })
const findOpenShiftForDeviceMock = vi.fn().mockResolvedValue(null)
const loadLastClosedShiftMock = vi.fn().mockResolvedValue(null)
vi.mock('@/features/shifts/composables/useShift', () => ({
  useShift: () => ({
    openShift: openShiftMock,
    loadLastClosedShift: loadLastClosedShiftMock,
    findOpenShiftForDevice: findOpenShiftForDeviceMock,
  }),
}))

vi.mock('@/features/staff/composables/useOperatorSwitch', () => ({
  useOperatorSwitch: () => ({ switchTo: vi.fn() }),
  OperatorSwitchBlockedError: class OperatorSwitchBlockedError extends Error {},
}))

vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({ logLoginFailed: vi.fn(), logLockedOut: vi.fn() }),
}))

vi.mock('@/features/shifts/composables/useDenominationConfig', () => ({
  useDenominationConfig: () => ({
    usd: { value: [] },
    syp: { value: [] },
    load: vi.fn(),
  }),
}))

vi.mock('@/router/permissions', () => ({
  resolveLanding: () => '/pos',
  isRouteAllowed: () => true,
}))

import LockScreen from '@/features/shifts/components/LockScreen.vue'

describe('LockScreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    openShiftMock.mockResolvedValue({ status: 'ok' })
    findOpenShiftForDeviceMock.mockResolvedValue(null)
    loadLastClosedShiftMock.mockResolvedValue(null)
  })

  // Regression test: openingCashSyp/openingCashUsd are typed ref<string | number>
  // because a real <input type="number"> + v-model auto-casts the bound value
  // to a JS Number the instant a digit is typed (Vue 3's vModelText directive
  // does this regardless of the .number modifier). confirmOpen() previously
  // crashed calling .trim() directly on that value when it was a number;
  // this confirms the String(...) coercion fix holds when driven through a
  // real <input type="number"> the way the browser actually produces it.
  it('confirmOpen does not throw when the opening-cash inputs hold a runtime number (as a real <input type="number"> produces)', async () => {
    const wrapper = mount(LockScreen)

    // Step 1: pick staff
    await wrapper.find('.staff-btn').trigger('click')

    // Step 2: PIN entry — PinPad emits 'complete' with a pin string.
    const pinPad = wrapper.findComponent({ name: 'PinPad' })
    await pinPad.vm.$emit('complete', '1234')
    await flushPromises()

    // Now on the opening-cash step.
    expect(wrapper.text()).toContain('كم في الصندوق؟')

    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs.length).toBe(2)

    // setValue on a number input simulates the real DOM: Vue's vModelText
    // casts the bound ref to a Number as soon as a digit is typed.
    await inputs[0].setValue(100)
    await inputs[1].setValue(50)

    const openBtn = wrapper.findAll('button').find(b => b.text().includes('فتح الوردية'))
    expect(openBtn).toBeTruthy()

    await expect(openBtn!.trigger('click')).resolves.not.toThrow()
    await flushPromises()

    expect(openShiftMock).toHaveBeenCalled()
  })
})
