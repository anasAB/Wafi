import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import CustomerPickerModal from '@/features/customers/components/CustomerPickerModal.vue'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountPicker(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(CustomerPickerModal, {
    props,
    global: {
      plugins: [pinia, router],
      stubs: { Teleport: true },
    },
  })
}

describe('CustomerPickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('shows search input on mount', () => {
    const w = mountPicker()
    expect(w.find('[data-testid="search-input"]').exists()).toBe(true)
  })

  it('shows customer rows from loaded list', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'c1', shop_id: 's1', name: 'أبو خالد', phone: null, mobile: null, address: null, deleted: 0, created_at: '', sync_status: '' },
    ])
    const w = mountPicker()
    await new Promise(r => setTimeout(r, 10))
    expect(w.find('[data-testid="customer-c1"]').exists()).toBe(true)
  })

  it('emits select with customer when row is tapped', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([
      { id: 'c1', shop_id: 's1', name: 'أبو خالد', phone: null, mobile: null, address: null, deleted: 0, created_at: '', sync_status: '' },
    ])
    const w = mountPicker()
    await new Promise(r => setTimeout(r, 10))
    await w.find('[data-testid="customer-c1"]').trigger('click')
    expect(w.emitted('select')).toBeTruthy()
    expect(w.emitted('select')![0][0]).toMatchObject({ id: 'c1', name: 'أبو خالد' })
  })

  it('shows add-new form when "إضافة زبون جديد" is tapped', async () => {
    const w = mountPicker()
    await w.find('[data-testid="add-new-btn"]').trigger('click')
    expect(w.find('[data-testid="quick-add-form"]').exists()).toBe(true)
  })

  it('emits cancel when backdrop is clicked', async () => {
    const w = mountPicker()
    await w.find('[data-testid="backdrop"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
