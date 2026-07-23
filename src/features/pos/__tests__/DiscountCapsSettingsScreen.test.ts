import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

const mockLoad = vi.fn().mockResolvedValue(undefined)
const mockSave = vi.fn().mockResolvedValue(undefined)
vi.mock('@/features/pos/useDiscountCaps', () => ({
  useDiscountCaps: () => ({
    cashierPct: { value: 5 }, managerPct: { value: 15 }, loaded: { value: true },
    load: mockLoad, save: mockSave,
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
  setActivePinia(createPinia())
  mockLoad.mockClear()
  mockSave.mockClear()
})

describe('DiscountCapsSettingsScreen', () => {
  it('loads caps on mount', () => {
    mountScreen()
    expect(mockLoad).toHaveBeenCalled()
  })

  it('calls save with the edited values on submit', async () => {
    const wrapper = mountScreen()
    await (wrapper.vm as any).submit(10, 25)
    expect(mockSave).toHaveBeenCalledWith({ cashierPct: 10, managerPct: 25 })
  })
})
