import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

const mockLoad = vi.fn().mockResolvedValue(undefined)
const mockSave = vi.fn().mockResolvedValue(undefined)
const mockCheckSaveFailed = vi.fn().mockResolvedValue(null)
vi.mock('@/features/pos/useDiscountCaps', () => ({
  useDiscountCaps: () => ({
    cashierPct: { value: 5 }, managerPct: { value: 15 }, loaded: { value: true },
    load: mockLoad, save: mockSave, checkSaveFailed: mockCheckSaveFailed,
  }),
}))

import DiscountCapsSettingsScreen from '@/features/pos/DiscountCapsSettingsScreen.vue'

function mountScreen() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div/>' } }],
  })
  return mount(DiscountCapsSettingsScreen, { global: { plugins: [router] } })
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  mockLoad.mockClear()
  mockSave.mockClear()
  mockCheckSaveFailed.mockClear().mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DiscountCapsSettingsScreen', () => {
  it('loads caps on mount', () => {
    mountScreen()
    expect(mockLoad).toHaveBeenCalled()
  })

  it('has an accessible label linked to each input', async () => {
    const wrapper = mountScreen()
    await wrapper.vm.$nextTick()
    const cashierInput = wrapper.find('#cashier-cap-input')
    const managerInput = wrapper.find('#manager-cap-input')
    expect(cashierInput.attributes('aria-labelledby')).toBe('cashier-cap-label')
    expect(managerInput.attributes('aria-labelledby')).toBe('manager-cap-label')
    expect(wrapper.find('#cashier-cap-label').exists()).toBe(true)
    expect(wrapper.find('#manager-cap-label').exists()).toBe(true)
  })

  it('submits the form on Enter without a validation error', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)
  })

  it('shows an inline error and does not open the confirm dialog for a negative value (BUG-01)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('-10')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('يجب أن تكون النسبة بين 0 و100')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows an inline error for a value above 100 (BUG-02)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('150')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('يجب أن تكون النسبة بين 0 و100')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows a cross-field error when cashier exceeds manager (BUG-04)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('90')
    await wrapper.find('#manager-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('لا يمكن أن يتجاوز حد الكاشير حد المدير')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows a required error for an empty field instead of silently saving 0 (BUG-06)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('الرجاء إدخال قيمة')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('opens a confirmation dialog before saving a valid change, and saves only on confirm', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    expect(mockSave).not.toHaveBeenCalled()

    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    expect(mockSave).toHaveBeenCalledWith({ cashierPct: 10, managerPct: 15 })
  })

  it('does not save if the confirmation dialog is cancelled', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')

    await wrapper.find('.btn-ghost').trigger('click')
    expect(mockSave).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
  })

  it('shows a success toast immediately after a confirmed save', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('تم الحفظ')
  })

  it('downgrades the toast to a failure message if checkSaveFailed later reports a rejection (BUG-05)', async () => {
    mockCheckSaveFailed.mockResolvedValue('check constraint violated')
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('تم الحفظ')

    await vi.advanceTimersByTimeAsync(1500)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('لم يتم الحفظ على الخادم')
    expect(wrapper.find('.error-note').exists()).toBe(true)
    expect(wrapper.find('.saved-note').exists()).toBe(false)
  })

  it('shows an error toast and does not schedule the checkSaveFailed poll if save() throws', async () => {
    mockSave.mockRejectedValueOnce(new Error('db error'))
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.error-note').exists()).toBe(true)
    expect(wrapper.text()).toContain('تعذّر الحفظ')

    await vi.advanceTimersByTimeAsync(1500)
    await wrapper.vm.$nextTick()
    expect(mockCheckSaveFailed).not.toHaveBeenCalled()
  })

  it('proceeds to the confirm dialog and calls save again when resubmitting identical values (retry after a dead-lettered save)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('5')
    await wrapper.find('#manager-cap-input').setValue('15')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).not.toContain('لا توجد تغييرات')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)

    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    expect(mockSave).toHaveBeenCalledWith({ cashierPct: 5, managerPct: 15 })
  })

  it('auto-dismisses the toast ~2000ms after the checkSaveFailed result resolves', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('تم الحفظ')

    await vi.advanceTimersByTimeAsync(1500)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('تم الحفظ')

    await vi.advanceTimersByTimeAsync(1999)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.saved-note').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.saved-note').exists()).toBe(false)
    expect(wrapper.find('.error-note').exists()).toBe(false)
  })
})
